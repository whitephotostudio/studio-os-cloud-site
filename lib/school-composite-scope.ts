// Class names are identities, not substring searches: Grade 1 must not match
// Grade 10. Folder segments and the optional "Composite" suffix are supported.
export function schoolCompositeClassMatches(value: string | null | undefined, candidates: string[]) {
  const normalize = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const expected = new Set(candidates.map(normalize).filter(Boolean));
  if (!expected.size) return false;
  return (value || "").split(/[\\/]/).some(segment => {
    const stem = segment.replace(/\.(png|jpe?g|webp|gif|avif)$/i, "");
    return expected.has(normalize(stem)) || expected.has(normalize(stem.replace(/[ _-]*(?:class[ _-]*)?(?:composite|group[ _-]*photo|class[ _-]*photo)$/i, "")));
  });
}
