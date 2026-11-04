// Small text rules for the compact product cards (Product Library and Product Management). A line that would only say "nothing here" is left out.
const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

/** "Brand · Main / Sub". Missing categories are left out; the brand alone is returned when there are none. */
export function brandAndCategoryLine(brand: string | null | undefined, categories: Array<string | null | undefined>): string {
  const names = categories.map(clean).filter(Boolean);
  return [clean(brand), names.join(" / ")].filter(Boolean).join(" · ");
}

/** "TEMPLATE / ITEM" or null when neither code exists. */
export function templateCodeLine(templateCode: string | null | undefined, itemCode: string | null | undefined): string | null {
  return [clean(templateCode), clean(itemCode)].filter(Boolean).join(" / ") || null;
}

/** The first of the given texts that is not empty, on one line (the card cuts it with "..."), or null. */
export function oneLineText(...values: Array<string | null | undefined>): string | null {
  return values.map(clean).find(Boolean) ?? null;
}
