export const manualDefaultPriceCategories = ["Cat A", "Cat B", "Cat C", "Cat D"];

export type PricingColumn = { id: string; label: string; dimension_code: string };
export class PricingColumnIdentityError extends Error {}

/** Initial vocabulary only; never infer a Brand-wide equivalence from this code. */
export function initialPricingDimensionCode(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function pricingColumns(group: { price_columns?: unknown; price_categories?: unknown; items?: unknown }): PricingColumn[] {
  if (group.price_columns !== undefined && !Array.isArray(group.price_columns)) throw new PricingColumnIdentityError("Pricing columns must be an array.");
  const existing = Array.isArray(group.price_columns) ? group.price_columns : [];
  const declared = Array.isArray(group.price_categories) ? group.price_categories.filter((value): value is string => typeof value === "string") : [];
  const columns: PricingColumn[] = existing.length ? existing.map((value) => {
    const column = value as Partial<PricingColumn>;
    if (typeof column?.id !== "string" || !column.id || typeof column.label !== "string" || !column.label.trim()) throw new PricingColumnIdentityError("Invalid pricing column identity.");
    return { id: column.id, label: column.label, dimension_code: typeof column.dimension_code === "string" ? column.dimension_code : initialPricingDimensionCode(column.label) };
  }) : [...new Set([
    ...(declared.length ? declared : Array.isArray(group.items) ? group.items.flatMap((row) => row?.prices && typeof row.prices === "object" ? Object.keys(row.prices) : []) : []),
  ])].map((label) => ({ id: label, label, dimension_code: initialPricingDimensionCode(label) }));
  if (existing.length) {
    const keys = [...new Set(declared)];
    keys.filter((key) => !columns.some((column) => column.id === key)).forEach((key) => columns.push({ id: key, label: key, dimension_code: initialPricingDimensionCode(key) }));
  }
  const ids = new Set<string>(); const codes = new Set<string>();
  columns.forEach((column) => {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(column.dimension_code) || ids.has(column.id) || codes.has(column.dimension_code)) throw new PricingColumnIdentityError(`Conflicting pricing column '${column.label}'.`);
    ids.add(column.id); codes.add(column.dimension_code);
  });
  return columns;
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
