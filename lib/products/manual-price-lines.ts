// Pure rules for the "Supplier price lines" window of a manual price check Brand (typed by hand, no price list import).
/**
 * One price cell. `rowKey`/`rowName` say which product variant it belongs to, `columnName` is its price name (GRADE A, Default price ...).
 * `code` and `label` are the plain wording used in messages.
 */
export type ManualPriceLine = { key: string; code: string; label: string; price: number | null; currency: string; rowKey?: string; rowName?: string; modelCode?: string; columnName?: string };
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

type LineSource = { key: string; architecture?: string; group_id?: string; row_id?: string; raw_code: string; code: string; label: string; template_name: string; dimension?: string; dimension_label?: string; physical_field: string; price: number | null; currency: string };
const fieldNames: Record<string, string> = { default_unit_price: "Default price", default_price: "Default price", additional_price: "Additional price" };

/**
 * One window line from a price target. A row with a code looks as before. A row without a code shows its own name (or the model name)
 * in the code cell, and the price name is the column or price field, so no cell is ever empty.
 */
export function manualLineFromTarget(target: LineSource): ManualPriceLine {
  const code = (target.raw_code || target.code).trim();
  const column = (target.dimension_label ?? target.dimension ?? "").trim();
  const columnName = column || fieldNames[target.physical_field] || "Price";
  const template = target.template_name.trim(), variant = target.label.trim();
  const rowName = !variant || variant === template ? template || "Product" : template ? `${template} - ${variant}` : variant;
  const grouping = { rowKey: JSON.stringify([target.architecture ?? "", target.group_id ?? "", target.row_id ?? ""]), rowName, ...(code ? { modelCode: code } : {}), columnName };
  if (code) return { key: target.key, code, label: [target.label, column].filter(Boolean).join(" · "), price: target.price, currency: target.currency, ...grouping };
  return { key: target.key, code: variant || template || "Price", label: columnName, price: target.price, currency: target.currency, ...grouping };
}

export type PriceGridRow = { key: string; name: string; modelCode?: string; cells: Array<ManualPriceLine | null> };
export type PriceGrid = { columns: string[]; rows: PriceGridRow[] };

/**
 * Rows are product variants (first-seen order), columns are price names (first-seen order, matched ignoring case). A variant
 * with no price for a column gets null (a dash). If one variant has two cells with the same price name, the second gets its own column.
 */
export function groupPriceLines(lines: ManualPriceLine[]): PriceGrid {
  const columns: Array<{ id: string; name: string }> = []; const rows: Array<PriceGridRow & { cellsById: Map<string, ManualPriceLine> }> = [];
  for (const line of lines) {
    const name = (line.columnName ?? line.label).trim() || "Price", rowKey = line.rowKey ?? line.key;
    let row = rows.find((item) => item.key === rowKey);
    if (!row) { row = { key: rowKey, name: line.rowName ?? line.code, ...(line.modelCode ? { modelCode: line.modelCode } : {}), cells: [], cellsById: new Map() }; rows.push(row); }
    const base = name.toLowerCase(); let id = base, n = 1;
    while (row.cellsById.has(id)) id = `${base}#${++n}`;
    if (!columns.some((column) => column.id === id)) columns.push({ id, name });
    row.cellsById.set(id, line);
  }
  return { columns: columns.map((column) => column.name), rows: rows.map(({ cellsById, ...row }) => ({ ...row, cells: columns.map((column) => cellsById.get(column.id) ?? null) })) };
}

/** The one currency of all priced lines, or null when they differ (then each cell shows its own). */
export function sharedLineCurrency(lines: ManualPriceLine[]): string | null {
  const currencies = new Set(lines.filter((line) => line.price !== null).map((line) => line.currency));
  return currencies.size === 1 ? [...currencies][0] : null;
}

export const NO_PRICES_MESSAGE = "This product has no prices yet. Add them in Edit Template.";

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
