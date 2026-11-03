// Pure rules for the "Supplier price lines" window of a manual price check Brand (typed by hand, no price list import).
export type ManualPriceLine = { key: string; code: string; label: string; price: number | null; currency: string };
export type ManualPriceChange = { key: string; newPrice: number };
export const STALE_TEMPLATE_MESSAGE = "This Product Template changed. Reload before saving.";
export const MAX_PRICES_PER_SAVE = 50;

/** Numbers only: zero or more, at most 2 decimals. No signs, no thousands separators, no letters. */
export function parsePriceInput(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const clean = text.trim();
  if (!clean) return { ok: false, message: "Enter a price." };
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return { ok: false, message: "Use numbers only, up to 2 decimals." };
  const value = Number(clean);
  return Number.isFinite(value) && value <= 1e12 ? { ok: true, value } : { ok: false, message: "This number is too large." };
}

export const priceInputText = (price: number | null) => price === null ? "" : String(price);

/** Only lines with a price can be typed over; an empty price is set in Edit Template. */
export const isEditableLine = (line: ManualPriceLine) => line.price !== null;

/** Live difference (new minus current), rounded to cents. Null when the input is not a valid number or there is no current price. */
export function priceDifference(line: ManualPriceLine, text: string): number | null {
  const parsed = parsePriceInput(text);
  return parsed.ok && line.price !== null ? Math.round((parsed.value - line.price) * 100) / 100 : null;
}

/** The cells to save: only lines whose valid number differs from the current price. Invalid inputs are reported per line and block the save. */
export function collectPriceChanges(lines: ManualPriceLine[], inputs: Record<string, string>): { changes: ManualPriceChange[]; errors: Record<string, string> } {
  const changes: ManualPriceChange[] = []; const errors: Record<string, string> = {};
  for (const line of lines) {
    if (!isEditableLine(line)) continue;
    const text = inputs[line.key] ?? priceInputText(line.price);
    const parsed = parsePriceInput(text);
    if (!parsed.ok) { errors[line.key] = parsed.message; continue; }
    if (parsed.value !== line.price) changes.push({ key: line.key, newPrice: parsed.value });
  }
  return { changes, errors };
}

/** Server side: refuse bad input again, whatever the browser sent. Returns the clean changes. */
export function validateChangesForSave(lines: ManualPriceLine[], raw: unknown, loadedVersion: string, liveVersion: string): ManualPriceChange[] {
  if (loadedVersion !== liveVersion) throw Error(STALE_TEMPLATE_MESSAGE);
  if (!Array.isArray(raw) || !raw.length) throw Error("There are no price changes to save.");
  if (raw.length > MAX_PRICES_PER_SAVE) throw Error(`Save ${MAX_PRICES_PER_SAVE} prices at most at one time.`);
  const seen = new Set<string>();
  return raw.map((item) => {
    const key = (item as { key?: unknown })?.key, value = (item as { newPrice?: unknown })?.newPrice;
    const line = typeof key === "string" ? lines.find((candidate) => candidate.key === key) : undefined;
    if (!line || !isEditableLine(line) || seen.has(line.key)) throw Error("One of the price lines is not available. Reload and try again.");
    seen.add(line.key);
    const parsed = typeof value === "number" ? parsePriceInput(String(value)) : { ok: false as const, message: "Enter a price." };
    if (!parsed.ok) throw Error(`${line.code}: ${parsed.message}`);
    return { key: line.key, newPrice: parsed.value };
  }).filter((change) => change.newPrice !== lines.find((line) => line.key === change.key)!.price);
}

export const pricesWillChangeText = (count: number) => `${count} ${count === 1 ? "price" : "prices"} will change.`;
