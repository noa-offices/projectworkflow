import type { ProductTemplateDraft } from "./product-template-draft";

export type SmartSetupPricingSection = "workstation" | "baseModel" | "category" | "modular" | "accessory";
export type SmartSetupSectionPresence = Record<SmartSetupPricingSection, boolean>;

const sectionLabels: Record<SmartSetupPricingSection, string> = {
  workstation: "Workstation Pricing",
  baseModel: "Base / Model Pricing",
  category: "Category / Matrix Pricing",
  modular: "Modular Item Pricing",
  accessory: "Accessory Pricing",
};

export function getSmartSetupConflictLabels(conflicts: SmartSetupPricingSection[]) {
  return conflicts.map((section) => sectionLabels[section]);
}

export function getDraftPricingSectionPresence(draft: ProductTemplateDraft): SmartSetupSectionPresence {
  return {
    workstation: draft.pricing.workstationRows.length > 0,
    baseModel: draft.pricing.baseModelRows.length > 0,
    category: draft.pricing.priceMatrices.length > 0,
    modular: draft.pricing.modularGroups.length > 0,
    accessory: draft.optionGroups.length > 0,
  };
}

export function getSmartSetupOverwriteConflicts(draft: SmartSetupSectionPresence, current: SmartSetupSectionPresence) {
  return (Object.keys(draft) as SmartSetupPricingSection[]).filter((section) => draft[section] && current[section]);
}
