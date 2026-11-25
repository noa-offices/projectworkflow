// Universal Screen rules case, rebuilt from its description: saved group ids, item codes and target groups are real;
// row ids, prices, how the 46 targets are split and the other groups' contents are made up.
import type { AccessoryApplicabilityTarget } from "../accessory-conditional-configuration";
import type { ProductTemplateDraft } from "../product-template-draft";
import { productTemplateFormSmartWorkspace } from "../product-template-form-smart-workspace";

export const BASE = { "felt-front": 6, "felt-lateral": 4, "felt-modesty": 3, "mel-front": 6, "sp30-front": 5 } as const;
export const MATRIX = { "us-m-fabric-front": 5, "us-m-sp38-front": 5, "us-m-uph-front": 4, "us-m-uph-front-1bar": 4, "us-m-uph-front-2bar": 4 } as const;
export const ALL_GROUPS: Record<string, number> = { ...BASE, ...MATRIX };
export const rowsOf = (groupId: string) => Array.from({ length: ALL_GROUPS[groupId]! }, (_, i) => `${groupId}-r${i + 1}`);
export const targetsOf = (groupId: string): AccessoryApplicabilityTarget[] => rowsOf(groupId).map((row_id) => ({ kind: groupId in BASE ? "base_model" : "price_matrix", group_id: groupId, row_id }));

export const FRONT = ["880", "883", "885", "464", "465"];
export const FELT = [...FRONT, "887", "466"];
export const itemId = (code: string) => `us-stirrup-${code}`;
export const allowedFor = (groupId: string) => (groupId === "felt-front" ? FELT : groupId === "felt-lateral" || groupId === "felt-modesty" ? ["880"] : FRONT).map(itemId);
export const rule = (target: AccessoryApplicabilityTarget, allowed: string[], required = true) => ({ target, required, visible: true, allowed_item_ids: allowed });
type Rule = ReturnType<typeof rule>;

const savedItem = (id: string, name: string, code: string, price: number, sort = 0) => ({ id, item_name: name, supplier_price_list_code: code, price, currency: "EUR", specification: `${name} spec`, is_active: true, sort_order: sort });
type SavedGroup = { id: string; group_name: string; group_is_required: boolean; items: ReturnType<typeof savedItem>[]; rules: Rule[] };
const group = (id: string, group_name: string, items: SavedGroup["items"], rules: Rule[], group_is_required: boolean): SavedGroup => ({ id, group_name, items, rules, group_is_required });

export const FRONT_ID = "us-og-front-stirrups-880";
export const frontRulesBefore = [...targetsOf("felt-lateral"), ...targetsOf("felt-modesty")].map((t) => rule(t, [itemId("880")]));
export const otherGroups: SavedGroup[] = [
  group("us-og-lateral", "Lateral Stirrups", [savedItem("us-lat-881", "Lateral Kit", "881", 20)], targetsOf("felt-lateral").map((t) => rule(t, ["us-lat-881"])), true),
  group("us-og-modesty", "Modesty Stirrups", [savedItem("us-mod-890", "Modesty Kit", "890", 15)], targetsOf("felt-modesty").map((t) => rule(t, ["us-mod-890"])), true),
  group("us-og-barcover", "Accessory Bar Covers", [savedItem("us-cov-900", "Bar Cover", "900", 5)], targetsOf("us-m-uph-front-1bar").map((t) => rule(t, ["us-cov-900"], false)), false),
  group("us-og-sp-cover", "Sound-Proofing Cover Kits", [savedItem("us-spc-930", "Cover Kit A", "930", 8), savedItem("us-spc-931", "Cover Kit B", "931", 9, 1)], targetsOf("sp30-front").map((t) => rule(t, ["us-spc-930", "us-spc-931"], false)), false),
  group("us-og-optional", "Optional Items", [savedItem("us-opt-920", "Clamp", "920", 3)], [], false),
];

const savedGroups = [group(FRONT_ID, "Front Stirrups Kit Art.880", [savedItem(itemId("880"), "103 880 Front Stirrup", "880", 12)], frontRulesBefore, true), ...otherGroups];
export const snapshot = {
  currency: "EUR",
  desking_size_pricing: "[]",
  modular_item_pricing: "[]",
  variant_pricing: JSON.stringify(Object.keys(BASE).map((id, i) => ({ id, pricing_type: "base_model_group", group_name: id, is_active: true, sort_order: i, items: rowsOf(id).map((row, k) => ({ id: row, variant_name: row, price: 100 + k, currency: "EUR", is_active: true, sort_order: k })) }))),
  category_pricing: JSON.stringify(Object.keys(MATRIX).map((id, i) => ({ id, pricing_type: "category_group", group_name: id, is_active: true, sort_order: i, price_categories: ["B", "C"], items: rowsOf(id).map((row, k) => ({ id: row, variant_name: row, prices: { B: 200 + k, C: 210 + k }, currency: "EUR", is_active: true, sort_order: k })) }))),
  accessory_pricing: JSON.stringify(savedGroups.map(({ rules, ...saved }, sort_order) => ({ ...saved, is_active: true, sort_order, ...(rules.length ? { conditional_configuration: { role: "accessory", selection: saved.group_is_required ? "at_least_one" : "unrestricted", applicability: rules } } : {}) }))),
};

export const workspace = () => productTemplateFormSmartWorkspace(snapshot);

/** The new JSON: only the front stirrups differ. Every other group repeats the saved rules the way an AI JSON writes them. */
export function incomingDraft(): ProductTemplateDraft {
  const base = workspace().draft;
  const savedFrontItem = base.optionGroups[0]!.items[0]!;
  const frontItems = FELT.map((code) => code === "880"
    // Same item as saved: only the display name and reference code differ.
    ? { ...savedFrontItem, label: "Front Stirrup 880", displayName: "Front Stirrup 880", referenceCodes: ["103"], price: 999 }
    : { ...savedFrontItem, id: itemId(code), label: `Front Stirrup ${code}`, displayName: `Front Stirrup ${code}`, supplierCodes: [code], referenceCodes: [], price: 12 + Number(code) % 7 });
  const selection = (required: boolean) => ({ mode: required ? "required_choose_at_least_one" as const : "optional" as const, minSelections: required ? 1 : 0, maxSelections: null, defaultItemIds: [] });
  const conditional = (required: boolean, applicability: Rule[]) => ({ conditionalConfiguration: { role: "accessory" as const, selection: required ? "at_least_one" as const : "unrestricted" as const, applicability } });
  return {
    ...base,
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] },
    optionGroups: [
      { id: "us-og-front-stirrups", label: "Front Stirrups (choose by desk type)", items: frontItems, selection: selection(true), ...conditional(true, Object.keys(ALL_GROUPS).flatMap((groupId) => targetsOf(groupId).map((t) => rule(t, allowedFor(groupId))))) },
      // Same rules, written in another order.
      ...otherGroups.map((saved, index) => ({
        id: saved.id, label: saved.group_name, items: base.optionGroups[index + 1]!.items, selection: selection(saved.group_is_required),
        ...(saved.rules.length ? conditional(saved.group_is_required, [...saved.rules].reverse().map((entry) => ({ ...entry, allowed_item_ids: [...entry.allowed_item_ids].reverse() }))) : {}),
      })),
    ],
  };
}
