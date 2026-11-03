export const manualDefaultPriceCategories = ["Cat A", "Cat B", "Cat C", "Cat D"];

export type PricingColumn = { id: string; label: string; dimension_code: string };
export class PricingColumnIdentityError extends Error {}

const CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const FALLBACK_DIMENSION_CODE = "column";

/**
 * Initial vocabulary only; never infer a Brand-wide equivalence from this code.
 * Common symbols become words so "Grade A" and "Grade A+" stay different; "/" and "-" are separators.
 * Labels with only letters, digits and spaces give the same code as before. Never returns an empty code.
 */
export function initialPricingDimensionCode(label: string): string {
  const code = label.toLowerCase().replace(/\+/g, " plus ").replace(/&/g, " and ").replace(/%/g, " percent ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return code || FALLBACK_DIMENSION_CODE;
}

type DraftColumn = PricingColumn & { auto: boolean };

export function pricingColumns(group: { price_columns?: unknown; price_categories?: unknown; items?: unknown }): PricingColumn[] {
  if (group.price_columns !== undefined && !Array.isArray(group.price_columns)) throw new PricingColumnIdentityError("Pricing columns must be an array.");
  const existing = Array.isArray(group.price_columns) ? group.price_columns : [];
  const declared = Array.isArray(group.price_categories) ? group.price_categories.filter((value): value is string => typeof value === "string") : [];
  const auto = (id: string, label: string): DraftColumn => ({ id, label, dimension_code: "", auto: true });
  const columns: DraftColumn[] = existing.length ? existing.map((value) => {
    const column = value as Partial<PricingColumn>;
    if (typeof column?.id !== "string" || !column.id || typeof column.label !== "string" || !column.label.trim()) throw new PricingColumnIdentityError("Invalid pricing column identity.");
    return typeof column.dimension_code === "string" ? { id: column.id, label: column.label, dimension_code: column.dimension_code, auto: false } : auto(column.id, column.label);
  }) : [...new Set([
    ...(declared.length ? declared : Array.isArray(group.items) ? group.items.flatMap((row) => row?.prices && typeof row.prices === "object" ? Object.keys(row.prices) : []) : []),
  ])].map((label) => auto(label, label));
  if (existing.length) {
    const keys = [...new Set(declared)];
    keys.filter((key) => !columns.some((column) => column.id === key)).forEach((key) => columns.push(auto(key, key)));
  }
  // Explicit codes are checked first and always win. Only then do auto-made codes get a free code (_2, _3 ...) in column order.
  const ids = new Map<string, DraftColumn>(); const codes = new Map<string, DraftColumn>();
  columns.forEach((column) => {
    const sameId = ids.get(column.id);
    if (sameId) throw new PricingColumnIdentityError(`Price columns "${sameId.label}" and "${column.label}" use the same id "${column.id}". Rename one of them.`);
    ids.set(column.id, column);
    if (column.auto) return;
    if (!CODE_PATTERN.test(column.dimension_code)) throw new PricingColumnIdentityError(`Price column "${column.label}" has the code "${column.dimension_code}". A code can only use small letters, digits and single underscores, for example "grade_a".`);
    const sameCode = codes.get(column.dimension_code);
    if (sameCode) throw new PricingColumnIdentityError(`Price columns "${sameCode.label}" and "${column.label}" both use the code "${column.dimension_code}". Give one of them a different code.`);
    codes.set(column.dimension_code, column);
  });
  columns.forEach((column) => {
    if (!column.auto) return;
    const base = initialPricingDimensionCode(column.label);
    let code = base;
    for (let n = 2; codes.has(code); n += 1) code = `${base}_${n}`;
    column.dimension_code = code; codes.set(code, column);
  });
  return columns.map(({ id, label, dimension_code }) => ({ id, label, dimension_code }));
}

export function pricingColumnLabel(group: { price_columns?: unknown }, id: string): string {
  return pricingColumns(group).find((column) => column.id === id)?.label ?? id;
}

function comparableCategoryLabel(value: string) {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

export function explicitPricingCategoryLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  value.forEach((item) => {
    if (typeof item !== "string" || !item.trim() || labels.includes(item.trim())) return;
    labels.push(item.trim());
  });
  return labels;
}

export function explicitCategoryPriceValue(prices: Record<string, unknown> | null | undefined, category: string): unknown {
  if (!prices) return undefined;
  if (Object.prototype.hasOwnProperty.call(prices, category)) return prices[category];
  const normalizedCategory = comparableCategoryLabel(category);
  return Object.entries(prices).find(([key]) => comparableCategoryLabel(key) === normalizedCategory)?.[1];
}
