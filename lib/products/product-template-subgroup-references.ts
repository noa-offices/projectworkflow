import { baseModelPricingGroups } from "./base-model-pricing-groups";
import { baseModelSubgroupReferenceKey } from "./base-model-pricing-subgroups";
import type { ProductTemplateGroupReferenceType } from "./product-template-group-references";

export type ProductTemplateSubgroupReferenceRow = { id: string; template_id: string; pricing_type: ProductTemplateGroupReferenceType; group_id: string; subgroup_id: string; storage_path: string; caption: string | null; created_at: string; updated_at: string };
export type ProductTemplateSubgroupReferencePreview = { id: string; pricingType: ProductTemplateGroupReferenceType; groupId: string; subgroupId: string; previewUrl: string | null; caption: string | null };
export type ProductTemplateSubgroupPricing = { accessoryPricing?: unknown; categoryPricing?: unknown; deskingSizePricing?: unknown; variantPricing?: unknown };

export function productTemplateSubgroupReferencePath(templateId: string, pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string, referenceId: string, mimeType = "image/webp") {
  [templateId, pricingType, groupId, subgroupId, referenceId].forEach((value) => { if (!value || /[\\/\0]/.test(value)) throw new Error("Reference image identity is invalid."); });
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
  return `product-template-subgroup-references/${templateId}/${pricingType}/${groupId}/${subgroupId}/${referenceId}.${extension}`;
}

function rawGroups(value: unknown) { return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : []; }
function pricingGroups(pricing: ProductTemplateSubgroupPricing, pricingType: ProductTemplateGroupReferenceType) {
  if (pricingType === "base_model") return Array.isArray(pricing.variantPricing) ? baseModelPricingGroups(pricing.variantPricing) as unknown as Record<string, unknown>[] : [];
  if (pricingType === "workstation") return rawGroups(pricing.deskingSizePricing);
  if (pricingType === "finish_category") return rawGroups(pricing.categoryPricing).filter((group) => group.pricing_type !== "modular_group");
  if (pricingType === "modular") return rawGroups(pricing.categoryPricing).filter((group) => group.pricing_type === "modular_group");
  return rawGroups(pricing.accessoryPricing);
}
function asPricing(value: unknown | ProductTemplateSubgroupPricing): ProductTemplateSubgroupPricing {
  return value && typeof value === "object" && !Array.isArray(value) && ("variantPricing" in value || "accessoryPricing" in value || "categoryPricing" in value || "deskingSizePricing" in value) ? value as ProductTemplateSubgroupPricing : { variantPricing: value };
}

export function resolveProductTemplateSubgroupIdentity(pricingValue: unknown | ProductTemplateSubgroupPricing, pricingType: ProductTemplateGroupReferenceType, subgroupId: string, groupId?: string) {
  const matches = pricingGroups(asPricing(pricingValue), pricingType).flatMap((group) => {
    if (typeof group.id !== "string" || groupId && group.id !== groupId || !Array.isArray(group.subgroups)) return [];
    return group.subgroups.some((subgroup) => subgroup && typeof subgroup === "object" && "id" in subgroup && subgroup.id === subgroupId) ? [{ groupId: group.id, subgroupId }] : [];
  });
  return matches.length === 1 ? matches[0] : null;
}

export function assertProductTemplateSubgroupExists(pricingValue: unknown | ProductTemplateSubgroupPricing, pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string) {
  const identity = resolveProductTemplateSubgroupIdentity(pricingValue, pricingType, subgroupId, groupId);
  if (!identity || identity.groupId !== groupId) throw new Error("Pricing subgroup no longer exists.");
}

export function persistedProductTemplateSubgroupKeys(pricingValue: unknown | ProductTemplateSubgroupPricing) {
  const pricing = asPricing(pricingValue);
  const types: ProductTemplateGroupReferenceType[] = ["base_model", "workstation", "finish_category", "modular", "accessory"];
  const keys = new Set<string>();
  types.forEach((pricingType) => pricingGroups(pricing, pricingType).forEach((group) => {
    const groupId = typeof group.id === "string" ? group.id : null;
    if (!groupId || !Array.isArray(group.subgroups)) return;
    group.subgroups.forEach((subgroup) => { if (subgroup && typeof subgroup === "object" && "id" in subgroup && typeof subgroup.id === "string") keys.add(baseModelSubgroupReferenceKey(pricingType, groupId, subgroup.id)); });
  }));
  return keys;
}

export function staleProductTemplateSubgroupReferences(rows: ProductTemplateSubgroupReferenceRow[], keys: ReadonlySet<string>) {
  return rows.filter((row) => !keys.has(baseModelSubgroupReferenceKey(row.pricing_type, row.group_id, row.subgroup_id)));
}

export async function reconcileStaleProductTemplateSubgroupReferences({ references, persistedKeys, deleteReference, deleteStorageObject, onReferenceDeleteError, onStorageDeleteError }: {
  references: ProductTemplateSubgroupReferenceRow[];
  persistedKeys: ReadonlySet<string>;
  deleteReference: (reference: ProductTemplateSubgroupReferenceRow) => Promise<void>;
  deleteStorageObject: (reference: ProductTemplateSubgroupReferenceRow) => Promise<void>;
  onReferenceDeleteError: (reference: ProductTemplateSubgroupReferenceRow, error: unknown) => void;
  onStorageDeleteError: (reference: ProductTemplateSubgroupReferenceRow, error: unknown) => void;
}) {
  let removedCount = 0;
  for (const reference of staleProductTemplateSubgroupReferences(references, persistedKeys)) {
    try { await deleteReference(reference); }
    catch (error) { onReferenceDeleteError(reference, error); continue; }
    removedCount += 1;
    try { await deleteStorageObject(reference); }
    catch (error) { onStorageDeleteError(reference, error); }
  }
  return removedCount;
}
