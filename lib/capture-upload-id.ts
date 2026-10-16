/** Native photo IDs are UUIDs. Account scoping prevents another signed-in
 * photographer from choosing the storage filename of someone else's retry.
 * Missing IDs retain the existing phone/manual import filename behavior.
 */
export function usbCaptureUploadFileName(captureId: unknown, ownerId: string): string | null {
  if (captureId === null || captureId === undefined) return null;
  const prefix = `usb-${ownerId}-`;
  if (typeof captureId !== "string" || !captureId.startsWith(prefix)) {
    throw new Error("Invalid capture identifier.");
  }
  const photoId = captureId.slice(prefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(photoId)) {
    throw new Error("Invalid capture identifier.");
  }
  return `capture_usb_${photoId.toLowerCase()}.jpg`;
}
