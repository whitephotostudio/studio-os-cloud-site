import { z } from "zod";
export const PORTRAIT_POLICY_VERSION = "school-portrait-1";
const fraction = z.number().min(0).max(1);
const check = z.enum(["pass", "fail", "uncertain", "not_required"]);
export const portraitAssessment = z
  .object({
    faceCount: z.number().int().min(0).max(100),
    confidence: fraction,
    head: z
      .object({
        left: fraction,
        top: fraction,
        right: fraction,
        bottom: fraction,
      })
      .strict(),
    eyeY: fraction,
    fullHeadAndHair: check,
    crop: check,
    backgroundAndEdges: check,
    retouching: check,
    reasons: z.array(z.string().max(400)).max(20),
  })
  .strict();
export type PortraitAssessment = z.infer<typeof portraitAssessment>;
export function evaluatePortraitAssessment(
  input: unknown,
  required: { background: boolean; retouch: boolean },
) {
  const parsed = portraitAssessment.safeParse(input);
  if (!parsed.success)
    return {
      passed: false,
      reasons: ["AI evidence is incomplete. Review the finished print."],
      assessment: null,
    };
  const a = parsed.data,
    h = a.head;
  const reasons = [...a.reasons];
  if (a.faceCount !== 1)
    reasons.push("Group photos or missing faces require review.");
  if (a.confidence < 0.95) reasons.push("AI is uncertain about the portrait.");
  if (
    h.right <= h.left ||
    h.bottom <= h.top ||
    h.bottom - h.top < 0.28 ||
    h.bottom - h.top > 0.45
  )
    reasons.push("Head height must occupy 28–45% of this print.");
  if (
    h.top < 0.04 ||
    h.left < 0.02 ||
    h.right > 0.98 ||
    Math.abs((h.left + h.right) / 2 - 0.5) > 0.05
  )
    reasons.push("Check crown clearance and horizontal centering.");
  if (a.eyeY < 0.25 || a.eyeY > 0.45 || a.eyeY <= h.top || a.eyeY >= h.bottom)
    reasons.push("Check the eye line on this print size.");
  if (a.fullHeadAndHair !== "pass" || a.crop !== "pass")
    reasons.push("Full head, hair and crop must all pass.");
  if (required.background && a.backgroundAndEdges !== "pass")
    reasons.push("Background and hair edges require review.");
  // A final image alone cannot prove a paid retouch request was fulfilled.
  if (required.retouch)
    reasons.push(
      "Purchased retouching needs an operator comparison with the original.",
    );
  return {
    passed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    assessment: a,
  };
}
export function labEmailText(input: {
  labName: string;
  orders: number;
  pieces: number;
  days: number;
  link: string;
  studio: string;
  reference: string;
  date: string;
}) {
  return `Hi ${input.labName},\n\nThank you for your hard work. Here are our print orders prepared on ${input.date}: ${input.orders} orders, ${input.pieces} print pieces, in Noritsu format.\n\nDownload the private ZIP (link expires in 7 days):\n${input.link}\n\nThe included manifest lists each order, print size and quantity. Every included print has passed AI checks or a photographer's review for head size, cropping, background edges and requested retouching. Orders needing attention have been held back.\n\nCould these please be ready in ${input.days} days, if possible? Please reply to confirm receipt and your expected completion date.\n\nThank you!\n${input.studio}\nBatch reference: ${input.reference}`;
}
