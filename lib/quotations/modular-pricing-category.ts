import { isDirectModularPricingGroup, type ModularCategoryPricingShape } from "../products/modular-pricing";

type MatrixModularGroup = ModularCategoryPricingShape & {
  items?: Array<ModularCategoryPricingShape & { id?: string; prices?: Record<string, number | null> | null }> | null;
};

/** Returns the submitted category only when it is a real Matrix Modular cell. */
export function resolvedMatrixModularPricingCategory(
  groups: MatrixModularGroup[],
  submittedCategory: string | null,
) {
  if (!submittedCategory) return null;
  return groups
    .filter((group) => !isDirectModularPricingGroup(group))
    .some((group) => (group.items ?? []).some((row) => Object.prototype.hasOwnProperty.call((row as { prices?: Record<string, number | null> | null }).prices ?? {}, submittedCategory)))
    ? submittedCategory
    : null;
}
