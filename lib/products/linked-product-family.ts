// Which rows a linked product offers and which one is chosen. Pure: it only picks rows (using the same family list as
// the standalone page); the builder keeps pricing the chosen row exactly as before.
import { familyKey, mixedProductFamilies, productFamilyOptions, selectedProductFamily, type ProductFamilyOption } from "./product-family-options";

type Row = { id?: string; is_active?: boolean };
type VariantGroup = { id: string; group_name: string; sort_order?: number; items: Row[] };
type CategoryGroup<TRow extends Row> = { id?: string; group_name?: string; sort_order?: number; is_active?: boolean; items: TRow[] };

/** The linked line's stored choice. These are the same ids saved setups already keep; no extra family field exists. */
export type LinkedFamilyStored = { variantRowId?: string; categoryGroupId?: string; categoryId?: string; fabricCategory?: string };

type FamilyData<V extends Row, G extends CategoryGroup<Row>> = {
  variantGroups: readonly VariantGroup[];
  categoryGroups: readonly G[];
  /** All active Base / Model rows, in display order. */
  variantRows: readonly V[];
};

export function resolveLinkedProductFamily<V extends Row, G extends CategoryGroup<Row>>({ variantGroups, categoryGroups, variantRows, nativeSystemActive, stored }: FamilyData<V, G> & { nativeSystemActive: boolean; stored: LinkedFamilyStored }) {
  type M = G["items"][number];
  const categoryGroup: G | null = categoryGroups.find((group) => group.id === stored.categoryGroupId) ?? categoryGroups[0] ?? null;
  const categoryRows: M[] = ((categoryGroup?.items ?? []) as M[]).filter((row) => row.is_active !== false);
  const categoryRow: M | null = categoryRows.find((row) => row.id === stored.categoryId) ?? categoryRows[0] ?? null;
  const pickVariant = (rows: readonly V[]) => rows.find((row) => row.id === stored.variantRowId) ?? rows[0] ?? null;
  const mixed = !nativeSystemActive && variantRows.length > 0 && mixedProductFamilies(variantGroups, categoryGroups);
  const none: ProductFamilyOption[] = [];

  if (!mixed) {
    return { mixed, options: none, selected: null, categoryGroup, categoryRows, categoryRow, variantRows: [...variantRows], variantRow: categoryRow ? null : pickVariant(variantRows) };
  }

  const options = productFamilyOptions(variantGroups, categoryGroups);
  const groupOf = (rowId: string | undefined) => variantGroups.find((group) => group.items.some((row) => row.id === rowId)) ?? null;
  const storedBaseGroup = !stored.categoryId && stored.variantRowId && variantRows.some((row) => row.id === stored.variantRowId) ? groupOf(stored.variantRowId) : null;

  // Nothing stored keeps the previous default (the first matrix row), so an untouched linked line keeps its price.
  const baseGroup = storedBaseGroup ?? (categoryRow ? null : groupOf(variantRows[0]?.id));
  const selected = selectedProductFamily(options, baseGroup ? familyKey("base_model", baseGroup.id) : undefined, { matrixGroupId: categoryGroup?.id ?? null, matrixRowSelected: Boolean(categoryRow), baseGroupId: null });
  if (!baseGroup) {
    return { mixed, options, selected, categoryGroup, categoryRows, categoryRow, variantRows: [] as V[], variantRow: null };
  }
  const familyRows = variantRows.filter((row) => baseGroup.items.some((item) => item.id === row.id));
  return { mixed, options, selected, categoryGroup: null as G | null, categoryRows: [] as M[], categoryRow: null as M | null, variantRows: familyRows, variantRow: pickVariant(familyRows) };
}

/** A family change replaces the whole stored choice: the new family's first row, and nothing from the old one. */
export function linkedProductFamilyChange<V extends Row, G extends CategoryGroup<Row>>(option: ProductFamilyOption, { variantGroups, categoryGroups, variantRows }: FamilyData<V, G>): LinkedFamilyStored {
  const cleared: LinkedFamilyStored = { variantRowId: undefined, categoryGroupId: undefined, categoryId: undefined, fabricCategory: undefined };
  if (option.kind === "price_matrix") {
    const row = categoryGroups.find((group) => group.id === option.id)?.items.find((item) => item.is_active !== false);
    return { ...cleared, categoryGroupId: option.id, categoryId: row?.id };
  }
  const items = variantGroups.find((group) => group.id === option.id)?.items ?? [];
  return { ...cleared, variantRowId: variantRows.find((row) => items.some((item) => item.id === row.id))?.id };
}

export const LINKED_LOCAL_BUILDER_MESSAGE = "A linked Base / Model choice can only be added in the local quotation builder. Open the local builder, or choose a \"price by category\" family.";

/**
 * The older server Add prices a linked line from the first Category / Matrix row when no matrix row is sent, which would
 * differ from the price shown for a Base / Model choice. Only the local builder keeps the shown price.
 */
export function linkedProductNeedsLocalBuilder(lines: ReadonlyArray<{ qty: number; family: { mixed: boolean; variantRow: unknown } }>) {
  return lines.some((line) => line.qty > 0 && line.family.mixed && Boolean(line.family.variantRow));
}
