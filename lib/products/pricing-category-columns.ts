export const manualDefaultPriceCategories = ["Cat A", "Cat B", "Cat C", "Cat D"];

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
