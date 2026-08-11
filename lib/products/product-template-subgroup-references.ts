import { baseModelPricingGroups } from "./base-model-pricing-groups";
import { baseModelSubgroupReferenceKey } from "./base-model-pricing-subgroups";
import type { ProductTemplateGroupReferenceType } from "./product-template-group-references";

export type ProductTemplateSubgroupReferenceRow = { id: string; template_id: string; pricing_type: ProductTemplateGroupReferenceType; group_id: string; subgroup_id: string; storage_path: string; caption: string | null; created_at: string; updated_at: string };
export type ProductTemplateSubgroupReferencePreview = { id: string; pricingType: ProductTemplateGroupReferenceType; groupId: string; subgroupId: string; previewUrl: string | null; caption: string | null };

export function productTemplateSubgroupReferencePath(templateId: string, pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string, referenceId: string, mimeType = "image/webp") {
  [templateId, pricingType, groupId, subgroupId, referenceId].forEach((value) => { if (!value || /[\\/\0]/.test(value)) throw new Error("Reference image identity is invalid."); });
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
  return `product-template-subgroup-references/${templateId}/${pricingType}/${groupId}/${subgroupId}/${referenceId}.${extension}`;
}

export function resolveProductTemplateSubgroupIdentity(variantPricing: unknown, pricingType: ProductTemplateGroupReferenceType, subgroupId: string) {
  if (pricingType !== "base_model") return null;
  const matches = baseModelPricingGroups(variantPricing).flatMap((group) => (group.subgroups ?? []).some((subgroup) => subgroup.id === subgroupId) ? [{ groupId: group.id, subgroupId }] : []);
  return matches.length === 1 ? matches[0] : null;
}

export function assertProductTemplateSubgroupExists(variantPricing: unknown, pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string) {
  const identity = resolveProductTemplateSubgroupIdentity(variantPricing, pricingType, subgroupId);
  if (!identity || identity.groupId !== groupId) throw new Error("Pricing subgroup no longer exists.");
}

export function persistedProductTemplateSubgroupKeys(variantPricing: unknown) {
  return new Set(baseModelPricingGroups(variantPricing).flatMap((group) => (group.subgroups ?? []).map((subgroup) => baseModelSubgroupReferenceKey("base_model", group.id, subgroup.id))));
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
