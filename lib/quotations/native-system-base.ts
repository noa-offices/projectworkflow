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
import { baseModelPricingGroups } from "../products/base-model-pricing-groups";

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
export function systemPriceContribution(row: { price?: number | null; currency?: string | null } | null | undefined, rowCurrency: string, quantity: number = 1) {
  const units = normalizeSystemQuantity(quantity);
  if (!row) return { amount: 0, unitPrice: 0, quantity: units, currency: rowCurrency, matching: 0 };
  const parsed = Number(row.price ?? 0);
  const unitPrice = Number.isFinite(parsed) ? parsed : 0;
  const amount = Math.round(unitPrice * units * 100) / 100;
  const currency = row.currency || rowCurrency;
  const same = currency.trim().toUpperCase() === rowCurrency.trim().toUpperCase();
  return { amount, unitPrice, quantity: units, currency, matching: same ? amount : 0 };
}

/** System / Base units per configured item: an integer >= 1 (default 1). Anything else normalizes to a safe value. */
export function normalizeSystemQuantity(value: unknown): number {
  const parsed = typeof value === "string" && value.trim() === "" ? 1 : Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : 1;
}

/** Server-side strict parse of a submitted quantity: empty means 1; anything not a whole number >= 1 is invalid (null). */
export function strictSystemQuantity(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
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
export function systemPricingSnapshot(groupId: string, row: SystemRowSnapshotSource, quantity: number = 1) {
  return {
    group_id: groupId,
    quantity: normalizeSystemQuantity(quantity),
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
export function systemSelectedOptionSnapshot(groupId: string, row: SystemRowSnapshotSource, quantity: number = 1) {
  const snapshot = systemPricingSnapshot(groupId, row, quantity);
  return {
    item_type: "system_pricing",
    label: "System / Base",
    quantity: snapshot.quantity,
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

/** Saved System quantity; old snapshots without a quantity default to 1. */
export function systemPricingQuantity(sourceData: unknown): number {
  return normalizeSystemQuantity(record(record(sourceData)?.system_pricing)?.quantity);
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
  const unit = Number.isFinite(price) ? price : 0;
  const quantity = systemPricingQuantity(sourceData);
  return { kind: "ok" as const, price: unit, quantity, total: Math.round(unit * quantity * 100) / 100, currency: typeof current.currency === "string" ? current.currency : null };
}

type TargetRule = Record<string, unknown> & { target?: { kind?: string; group_id?: string; row_id?: string } };
type ConditionalGroupLike = { conditional_configuration?: { applicability: TargetRule[] } | undefined };

/**
 * Native System templates: older extractions may have written Base/Model rule targets with the legacy group id (or
 * another id) although the row now lives in a native group. Row ids are unique across Base/Model rows, so the owner
 * group is authoritative. Without this remap such rules never match and the accessory/companion group is hidden.
 * Only call for templates that contain system_base rows; groups without a stale target keep their identity.
 */
export function remapBaseModelTargetsToOwnerGroups<TGroup extends ConditionalGroupLike>(accessoryGroups: TGroup[], baseModelGroups: Array<{ id: string; items: Array<{ id?: string }> }>): TGroup[] {
  const owner = new Map<string, string>();
  baseModelGroups.forEach((group) => group.items.forEach((item) => { if (item.id && !owner.has(item.id)) owner.set(item.id, group.id); }));
  return accessoryGroups.map((group) => {
    const configuration = group.conditional_configuration;
    if (!configuration) return group;
    let changed = false;
    const applicability = configuration.applicability.map((rule) => {
      if (rule.target?.kind === "base_model" && rule.target.row_id) {
        const ownerId = owner.get(rule.target.row_id);
        if (ownerId && ownerId !== rule.target.group_id) { changed = true; return { ...rule, target: { ...rule.target, group_id: ownerId } }; }
      } else if (!rule.target && typeof rule.base_model_row_id === "string") {
        const ownerId = owner.get(rule.base_model_row_id);
        if (ownerId && ownerId !== rule.base_model_group_id) { changed = true; return { ...rule, base_model_group_id: ownerId }; }
      }
      return rule;
    });
    return changed ? { ...group, conditional_configuration: { ...configuration, applicability } } : group;
  });
}

/**
 * Active Base/Model groups of a saved template exactly as the Product Library and the quotation action read them
 * (persisted variant_pricing -> normalized groups -> active groups with active rows). Rows keep every persisted field,
 * including role "system_base".
 */
export function activeBaseModelPricingGroups<TRow extends { id?: string; is_active?: boolean } = { id?: string; is_active?: boolean; [key: string]: unknown }>(variantPricing: unknown) {
  return baseModelPricingGroups<TRow & Record<string, unknown>>(variantPricing as never)
    .filter((group) => group.is_active)
    .map((group) => ({ ...group, items: group.items.filter((row) => row.is_active !== false) }));
}
