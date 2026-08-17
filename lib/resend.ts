type ResendTag = {
  name: string;
  value: string;
};

export type ResendAttachmentInput = {
  filename: string;
  content?: string | null;
  path?: string | null;
  contentId?: string | null;
};

export type SendResendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  fromName?: string | null;
  replyTo?: string | null;
  tags?: ResendTag[];
  attachments?: ResendAttachmentInput[];
  idempotencyKey?: string | null;
};

type ResendSendResponse = {
  id?: string;
};

export class ResendRequestError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message);
    this.name = "ResendRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string | null | undefined) {
  const email = clean(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function senderEmail() {
  return clean(process.env.RESEND_FROM_EMAIL) || "galleries@studiooscloud.com";
}

function senderName(value: string | null | undefined) {
  const name = clean(value).replace(/[<>"]/g, "");
  return name || "Studio OS Galleries";
}

export function resendConfigured() {
  return looksLikeEmail(senderEmail()) && clean(process.env.RESEND_API_KEY).length > 0;
}

export function resolveReplyTo(value: string | null | undefined) {
  return looksLikeEmail(value) ? clean(value) : null;
}

function retryAfterMilliseconds(value: string | null) {
  const text = clean(value);
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - Date.now());
}

export async function sendResendEmail(input: SendResendEmailInput) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const replyTo = resolveReplyTo(input.replyTo);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(clean(input.idempotencyKey) ? { "Idempotency-Key": clean(input.idempotencyKey) } : {}),
    },
    body: JSON.stringify({
      from: `${senderName(input.fromName)} <${senderEmail()}>`,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: clean(input.subject),
      html: input.html,
      text: clean(input.text) || undefined,
      reply_to: replyTo || undefined,
      tags: input.tags?.filter((tag) => clean(tag.name) && clean(tag.value)) ?? [],
      attachments: input.attachments
        ?.filter(
          (attachment) =>
            clean(attachment.filename) &&
            (clean(attachment.content) || clean(attachment.path)),
        )
        .map((attachment) => ({
          filename: clean(attachment.filename),
          content: clean(attachment.content) || undefined,
          path: clean(attachment.path) || undefined,
          content_id: clean(attachment.contentId) || undefined,
        })),
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as ResendSendResponse & {
    message?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new ResendRequestError(
      payload.error?.message || payload.message || "Failed to send email with Resend.",
      response.status,
      retryAfterMilliseconds(response.headers.get("retry-after")),
    );
  }

  return {
    id: clean(payload.id) || null,
  };
}
