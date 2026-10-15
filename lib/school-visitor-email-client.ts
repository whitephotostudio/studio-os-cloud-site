export type VisitorEmailOutcome = {
  recipientEmail: string;
  status: "sent" | "failed" | "pending";
  providerId?: string;
  error?: string;
};

export type VisitorEmailBatchResult = {
  ok: true;
  total: number;
  offset: number;
  sent: number;
  failed: number;
  pending: number;
  outcomes: VisitorEmailOutcome[];
  nextOffset: number | null;
  paused: boolean;
  retryAllowed?: boolean;
  retryAfterMs?: number;
  providerErrorCode?: string | null;
  message?: string;
};

/** Each bounded request can be replayed with the same campaign and offset.
 * Never advance the cursor until the server has acknowledged a chunk. */
export async function runVisitorEmailCampaign({ offset, recipients, requestBatch, onBatch, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }: {
  offset: number;
  recipients?: readonly string[];
  requestBatch: (offset: number) => Promise<VisitorEmailBatchResult>;
  onBatch: (result: VisitorEmailBatchResult) => void;
  wait?: (milliseconds: number) => Promise<unknown>;
}) {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("The saved email position is invalid. Review the batch before continuing.");
  let cursor = offset;
  let total = recipients?.length;
  for (;;) {
    const result = await requestBatch(cursor);
    const validOutcomes = Array.isArray(result?.outcomes) && result.outcomes.length > 0 && result.outcomes.every(outcome =>
      outcome && typeof outcome.recipientEmail === "string" && !!outcome.recipientEmail.trim() &&
      ["sent", "failed", "pending"].includes(outcome.status) &&
      (outcome.status !== "sent" || (typeof outcome.providerId === "string" && !!outcome.providerId)));
    const count = validOutcomes ? result.outcomes.length : 0;
    const uniqueRecipients = validOutcomes ? new Set(result.outcomes.map(outcome => outcome.recipientEmail.trim().toLowerCase())) : new Set();
    const countsMatch = validOutcomes && (["sent", "failed", "pending"] as const).every(status =>
      result[status] === result.outcomes.filter(outcome => outcome.status === status).length);
    const expectedRecipientsMatch = !recipients || (validOutcomes && result.outcomes.every((outcome, index) =>
      outcome.recipientEmail === recipients[cursor + index]));
    const end = cursor + count;
    if (result?.ok !== true || result.offset !== cursor || !Number.isInteger(result.total) || result.total <= cursor ||
      (total !== undefined && result.total !== total) || !validOutcomes || uniqueRecipients.size !== count ||
      !countsMatch || !expectedRecipientsMatch || end > result.total || typeof result.paused !== "boolean" ||
      (result.retryAfterMs !== undefined && (!Number.isFinite(result.retryAfterMs) || result.retryAfterMs < 0)) ||
      (result.retryAllowed !== undefined && typeof result.retryAllowed !== "boolean") ||
      (result.paused ? result.nextOffset !== cursor :
        result.nextOffset === null ? end !== result.total : result.nextOffset !== end || end >= result.total)) {
      throw new Error("Email progress could not be confirmed. Retry the remaining contacts.");
    }
    total = result.total;
    onBatch(result);
    if (result.paused || result.nextOffset === null) return result;
    cursor = result.nextOffset;
    await wait(1_000);
  }
}

export function visitorEmailProgress(outcomes: Iterable<VisitorEmailOutcome>, total: number) {
  let sent = 0;
  let failed = 0;
  const byRecipient = new Map<string, VisitorEmailOutcome>();
  for (const outcome of outcomes) byRecipient.set(outcome.recipientEmail.trim().toLowerCase(), outcome);
  for (const outcome of byRecipient.values()) {
    if (outcome.status === "sent") sent++;
    if (outcome.status === "failed") failed++;
  }
  return { sent, failed, pending: Math.max(0, total - sent - failed), total };
}
