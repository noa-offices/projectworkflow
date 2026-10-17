/**
 * Display-only, single-line specification preview for Smart Setup tables. The stored
 * specification is never changed; the product name and dimension text that the row already shows in
 * its own columns are simply left out of the preview so the limited width carries new information.
 */
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function smartSetupSpecificationPreview(specification: string | null | undefined, hide: Array<string | null | undefined> = []): string | null {
  let text = (specification ?? "").trim();
  if (!text) return null;
  for (const fragment of [...hide].map((item) => (item ?? "").trim()).filter((item) => item.length >= 3).sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(escapeRegExp(fragment), "gi"), " ");
  }
  const preview = text
    .replace(/\s*[\r\n]+\s*/g, " · ")
    .replace(/\s{2,}/g, " ")
    .replace(/(?:[.,;:|]\s+){2,}/g, "· ")
    .replace(/^[\s.\-–—,;:|·]+|[\s.\-–—,;:|·]+$/g, "")
    .replace(/(?:\s·){2,}/g, " ·")
    .trim();
  return preview || null;
}
