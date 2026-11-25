// "Edit accessories" for a linked product: the standalone accessory rules and prices (accessory-rule-setup) applied to
// the linked product's own chosen row. The result is written back as the linked selection's existing
// accessoryQuantities record (item id -> quantity); nothing else is stored.
import type { AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";
import { accessoryPriceLines, evaluateAccessoryRules } from "./accessory-rule-setup";
import { requiredCompanionItems } from "../quotations/required-component-overrides";

type Item = { id?: string; item_name?: string; price?: number | null; prices?: Record<string, number | null>; unavailable_price_categories?: string[]; role?: string };
type Group = { id: string; group_name: string; price_categories?: Array<{ id: string; label: string }>; items: Item[]; conditional_configuration?: { applicability: ReadonlyArray<{ target?: { kind: string } | null }> } | null };

/**
 * Why a linked product keeps the classic panel, or null when the popup can be used. Category-priced accessories need a
 * per-item category choice and structural supports change the targets; the linked format can store neither.
 */
export function linkedAccessoryPopupBlockReason(groups: readonly Group[]) {
  if (groups.some((group) => (group.price_categories ?? []).length > 0)) return "Its accessories are priced by category.";
  if (groups.some((group) => group.items.some((item) => item.role === "structural_support"))) return "It has structural support items.";
  if (groups.some((group) => group.items.some((item) => !item.id))) return "Some accessories have no id.";
  return null;
}

/** The linked product's own chosen row, as the standalone page builds it (resolveMainAccessoryTargets order). */
export function linkedAccessoryTargets(row: { kind: "base_model" | "price_matrix"; groupId: string | null | undefined; rowId: string | null | undefined } | null): AccessoryApplicabilityTarget[] {
  return row?.groupId && row.rowId ? [{ kind: row.kind, group_id: row.groupId, row_id: row.rowId }] : [];
}

export function evaluateLinkedAccessories<G extends Group>({ groups, row, quantities }: {
  groups: G[];
  row: Parameters<typeof linkedAccessoryTargets>[0];
  /** The linked selection's accessoryQuantities, or the popup's working copy of it. */
  quantities: Record<string, number>;
}) {
  const targets = linkedAccessoryTargets(row);
  const base = row?.kind === "base_model" ? row : null;
  // No overrides: the linked format cannot remember a removed required item, so required items stay locked in.
  const rules = evaluateAccessoryRules({ groups, baseModelGroupId: base?.groupId, baseModelRowId: base?.rowId, targets, targetQuantities: {}, quantities, overrides: {} });
  const { configuration } = rules;
  const priceLines = accessoryPriceLines(groups, configuration.activeQuantities, () => undefined);
  const missingModel = configuration.hasConditionalConfiguration && targets.length === 0;
  return {
    ...rules,
    priceLines,
    lockedItemIds: new Set(requiredCompanionItems(configuration.groups).map((entry) => entry.itemId)),
    blocked: !configuration.valid || missingModel,
    missingModel,
    /** Exactly what Apply stores: the visible, selected items and their quantities. */
    savedQuantities: Object.fromEntries(Object.entries(configuration.activeQuantities).filter(([, quantity]) => Number(quantity) > 0)),
  };
}
