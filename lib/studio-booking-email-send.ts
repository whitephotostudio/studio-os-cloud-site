import {
  ResendRequestError,
  sendResendEmail,
  type SendResendEmailInput,
} from "@/lib/resend";

export function waitForStudioBookingEmail(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function sendStudioBookingEmailWithRetry(
  input: SendResendEmailInput,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sendResendEmail(input);
    } catch (error) {
      const retryable =
        error instanceof ResendRequestError &&
        (error.status === 429 || error.status >= 500);
      if (!retryable || attempt === 2) throw error;
      const delay = Math.min(
        10_000,
        Math.max(750 * 2 ** attempt, error.retryAfterMs ?? 0),
      );
      await waitForStudioBookingEmail(delay);
    }
  }
  throw new Error("Booking email delivery could not be completed.");
}
