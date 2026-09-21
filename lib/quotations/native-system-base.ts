/**
 * Native System / Base selection for grouped Base/Model pricing.
 *
 * A BaseModelPricingGroup that contains rows with role === "system_base" is a System family:
 * the selected System / Base row decides which group's Main Product subgroups/rows are eligible,
 * so compatibility is structural (no compatibleTargets). Templates with no system_base rows
 * are "inactive" here and every helper returns the input unchanged, keeping old Base/Model
 * behavior identical. Pure functions only; shared by Product Library, quotation actions,
 * the builder repricing path and derived document data.
 */
export const SYSTEM_BASE_ROLE = "system_base" as const;

type RowLike = { id?: string; role?: string | null };
type GroupLike = { id: string; group_name: string; items: RowLike[] };

export function isSystemBaseRow(row: RowLike | null | undefined): boolean {
  return row?.role === SYSTEM_BASE_ROLE;
}

export type NativeSystemOption<TGroup extends GroupLike> = { group: TGroup; row: TGroup["items"][number] };

/**
 * `selectedSystemRowId` is the explicit Product Library choice. Exactly one system row is
 * auto-selected; several valid System rows are never auto-selected.
 * - inactive (no system_base rows): eligibleGroups === groups, nothing else applies.
 * - active + selected: only that System's group, with system rows removed.
 * - active + none selected: only plain groups (none in a pure native template => must choose System first).
 */
export function nativeSystemState<TGroup extends GroupLike>(groups: TGroup[], selectedSystemRowId?: string | null) {
  const options: NativeSystemOption<TGroup>[] = groups.flatMap((group) => group.items.filter(isSystemBaseRow).map((row) => ({ group, row })));
  const active = options.length > 0;
  const selected = options.find((option) => option.row.id && option.row.id === selectedSystemRowId) ?? (options.length === 1 ? options[0] : null);
  const plainGroups = groups.filter((group) => !group.items.some(isSystemBaseRow));
  const eligibleGroups: TGroup[] = !active
    ? groups
    : selected
      ? [{ ...selected.group, items: selected.group.items.filter((row) => !isSystemBaseRow(row)) } as TGroup]
      : plainGroups;
  return { active, options, selected, eligibleGroups, requiresSystem: active && plainGroups.length === 0 };
}

/**
 * System / Base price contribution to the aggregated unit price. `matching` is the amount that is summed
 * directly with the row currency; every amount (matching or not) is also added once to the per-currency
 * totals that drive conversion. Null row (inactive / nothing selected) contributes nothing.
 */
export function systemPriceContribution(row: { price?: number | null; currency?: string | null } | null | undefined, rowCurrency: string) {
  if (!row) return { amount: 0, currency: rowCurrency, matching: 0 };
  const parsed = Number(row.price ?? 0);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const currency = row.currency || rowCurrency;
  const same = currency.trim().toUpperCase() === rowCurrency.trim().toUpperCase();
  return { amount, currency, matching: same ? amount : 0 };
}

/** Main Product rows of a group; system rows never appear. */
export function mainProductRows<TRow extends RowLike>(items: TRow[]): TRow[] {
  return items.filter((row) => !isSystemBaseRow(row));
}

export type NativeBaseModelTarget = { kind: "base_model"; group_id: string; row_id: string };

/** Companion/applicability targets for both native selections (main first, then System); deduplicated downstream by the evaluator. */
export function nativeBaseModelTargets(input: { mainGroupId?: string | null; mainRowId?: string | null; systemGroupId?: string | null; systemRowId?: string | null }): NativeBaseModelTarget[] {
  return [
    ...(input.mainGroupId && input.mainRowId ? [{ kind: "base_model" as const, group_id: input.mainGroupId, row_id: input.mainRowId }] : []),
    ...(input.systemGroupId && input.systemRowId ? [{ kind: "base_model" as const, group_id: input.systemGroupId, row_id: input.systemRowId }] : []),
  ];
}

type SystemRowSnapshotSource = { id?: string; variant_name?: string; display_name?: string; supplier_price_list_code?: string; dimension?: string; price?: number | null; currency?: string; specification?: string };

/** Additive `system_pricing` entry of source_component_data (variant_pricing keeps the Main row). */
export function systemPricingSnapshot(groupId: string, row: SystemRowSnapshotSource) {
  return {
    group_id: groupId,
    row: {
      id: row.id ?? "",
      variant_name: row.variant_name ?? "",
      display_name: row.display_name ?? "",
      supplier_price_list_code: row.supplier_price_list_code ?? "",
      dimension: row.dimension ?? "",
      price: row.price ?? null,
      currency: row.currency ?? "",
      specification: row.specification ?? "",
      role: SYSTEM_BASE_ROLE,
    },
  };
}

/**
 * selected_options display entry. No top-level `id` (component-total code skips id-less entries) and no
 * group_name/item_name pair (so it is never read as an accessory snapshot); price is carried by system_pricing only.
 */
export function systemSelectedOptionSnapshot(groupId: string, row: SystemRowSnapshotSource) {
  const snapshot = systemPricingSnapshot(groupId, row);
  return {
    item_type: "system_pricing",
    label: "System / Base",
    selected_variant: snapshot.row,
    supplier_price_list_code: snapshot.row.supplier_price_list_code || null,
    specification: snapshot.row.specification,
  };
}

/** System / Base specification first, then the Main Product specification; blanks and exact repeats are dropped. */
export function composeSystemAndMainSpecification(systemSpecification?: string | null, mainSpecification?: string | null) {
  const parts = [systemSpecification, mainSpecification].map((value) => value?.trim() ?? "").filter(Boolean);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  return unique.length ? unique.join("\n") : null;
}

type SnapshotRecord = Record<string, unknown>;
const record = (value: unknown): SnapshotRecord | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as SnapshotRecord : null);

/** Saved System row id from source_component_data; null for old snapshots without system_pricing. */
export function systemPricingRowId(sourceData: unknown): string | null {
  const row = record(record(record(sourceData)?.system_pricing)?.row);
  return typeof row?.id === "string" && row.id ? row.id : null;
}

/**
 * Repricing: current System price from the template's rows.
 * - "none": old snapshot without system_pricing (caller changes nothing)
 * - "missing": the saved System row no longer exists (caller must not reprice)
 * - "ok": current price and currency of that row
 */
export function currentSystemPricing(sourceData: unknown, templateRows: Array<Record<string, unknown>>) {
  const id = systemPricingRowId(sourceData);
  if (!id) return { kind: "none" as const };
  const current = templateRows.find((row) => row.id === id);
  if (!current) return { kind: "missing" as const };
  const price = typeof current.price === "number" && Number.isFinite(current.price) ? current.price : Number(current.price ?? 0);
  return { kind: "ok" as const, price: Number.isFinite(price) ? price : 0, currency: typeof current.currency === "string" ? current.currency : null };
}
