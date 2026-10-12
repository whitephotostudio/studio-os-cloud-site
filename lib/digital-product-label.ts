/** Legacy product labels are an eligibility hint, never a substitute for
 * payment and gallery authorization. Match whole words: "Profile prints"
 * must not grant a high-resolution file just because it contains "file".
 */
export function hasDigitalProductLabel(value: string | null | undefined) {
  const text = (value ?? "").trim().toLowerCase();
  if (!text || text.includes("retouch")) return false;
  // Treat underscore-separated saved statuses such as digital_paid as words.
  return /(?:^|[^a-z0-9])(?:digitals?|downloads?|files?|jpe?g|png|usb)(?=$|[^a-z0-9])/.test(text);
}
