/** Null keeps the existing per-surface proof watermark appearance. */
export function normalizeProofWatermarkOpacity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

export function proofWatermarkOpacity(value: unknown, legacyOpacity: number): number {
  return normalizeProofWatermarkOpacity(value) ?? legacyOpacity;
}

export function proofWatermarkVersion(value: unknown): string {
  const opacity = normalizeProofWatermarkOpacity(value);
  return `proof-v1-${opacity === null ? "legacy" : opacity}`;
}
