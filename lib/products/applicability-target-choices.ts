import {
  accessoryApplicabilityTargetKey,
  type AccessoryApplicabilityTarget,
  type AccessoryApplicabilityTargetKind,
} from "./accessory-conditional-configuration";

export type ApplicabilityTargetChoice = {
  key: string;
  kind: AccessoryApplicabilityTargetKind;
  groupId: string;
  rowId: string;
  groupLabel: string;
  code?: string;
  displayName: string;
};

type PricingRow = {
  id?: string;
  display_name?: string;
  variant_name?: string;
  supplier_price_list_code?: string;
  dimension?: string;
  is_active?: boolean;
};

type PricingGroup = {
  id?: string;
  group_name?: string;
  is_active?: boolean;
  items?: PricingRow[];
};

function isGeneratedId(value: string) {
  return /^(?:row|matrix-item|category|item|variant)[-_]?\d/i.test(value);
}

export function applicabilityTargetChoice(
  kind: AccessoryApplicabilityTargetKind,
  group: PricingGroup,
  row: PricingRow,
): ApplicabilityTargetChoice | null {
  if (!group.id || !row.id || group.is_active === false || row.is_active === false) return null;
  const displayName = row.display_name?.trim() || row.variant_name?.trim() || row.dimension?.trim() || "Unnamed model";
  const candidateCode = row.supplier_price_list_code?.trim() || row.variant_name?.trim() || "";
  const code = candidateCode && !isGeneratedId(candidateCode) ? candidateCode : undefined;
  const target: AccessoryApplicabilityTarget = { kind, group_id: group.id, row_id: row.id };
  return { key: accessoryApplicabilityTargetKey(target), kind, groupId: group.id, rowId: row.id, groupLabel: group.group_name?.trim() || "Unnamed pricing group", ...(code ? { code } : {}), displayName };
}

export function applicabilityTargetChoices(
  baseModelGroups: PricingGroup[],
  priceMatrixGroups: PricingGroup[],
  modularGroups: PricingGroup[] = [],
): ApplicabilityTargetChoice[] {
  return [
    ...baseModelGroups.flatMap((group) => (group.items ?? []).flatMap((row) => applicabilityTargetChoice("base_model", group, row) ?? [])),
    ...priceMatrixGroups.flatMap((group) => (group.items ?? []).flatMap((row) => applicabilityTargetChoice("price_matrix", group, row) ?? [])),
    ...modularGroups.flatMap((group) => (group.items ?? []).flatMap((row) => applicabilityTargetChoice("modular", group, row) ?? [])),
  ];
}

export function applicabilityTargetChoiceLabel(choice: ApplicabilityTargetChoice) {
  return choice.code && choice.code !== choice.displayName ? `${choice.code} — ${choice.displayName}` : choice.displayName;
}
