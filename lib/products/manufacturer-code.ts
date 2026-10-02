/** Comparison identity only. Never replace the original stored/display code. */
export function normalizeManufacturerCode(value: string): string {
  return value.normalize("NFKC")
    .replace(/[\u2010-\u2014\u2212]/g, "-")
    .trim().replace(/\s+/g, " ")
    .replace(/\s*([-\/])\s*/g, "$1")
    .toUpperCase();
}
