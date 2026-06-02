type MaterialClassificationFields = {
  material_category?: string | null;
  material_collection?: string | null;
};

export const UNCATEGORIZED_MATERIAL_LABEL = "Uncategorized";

function cleanValue(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || "";
}

export function materialPriceCategoryLabel(material: MaterialClassificationFields) {
  return cleanValue(material.material_category);
}

export function materialCollectionLabel(material: MaterialClassificationFields) {
  return cleanValue(material.material_collection);
}

export function materialDisplayCategory(material: MaterialClassificationFields) {
  return materialPriceCategoryLabel(material) || materialCollectionLabel(material);
}

export function materialDisplayCategoryLabel(material: MaterialClassificationFields) {
  return materialDisplayCategory(material) || UNCATEGORIZED_MATERIAL_LABEL;
}

export function materialIsUncategorized(material: MaterialClassificationFields) {
  return !materialDisplayCategory(material);
}
