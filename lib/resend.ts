type ResendTag = {
  name: string;
  value: string;
};

type SendResendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  fromName?: string | null;
  replyTo?: string | null;
  tags?: ResendTag[];
  idempotencyKey?: string | null;
};

type ResendSendResponse = {
  id?: string;
};

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
      replyTo: replyTo || undefined,
      tags: input.tags?.filter((tag) => clean(tag.name) && clean(tag.value)) ?? [],
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as ResendSendResponse & {
    message?: string;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || "Failed to send email with Resend.");
  }

  return {
    id: clean(payload.id) || null,
  };
}
