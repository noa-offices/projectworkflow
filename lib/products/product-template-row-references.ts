import type { ProductTemplateGroupReferenceType } from "./product-template-group-references";

export type ProductTemplateRowReferenceRow = { id: string; template_id: string; pricing_type: ProductTemplateGroupReferenceType; group_id: string; row_id: string; storage_path: string; caption: string | null; created_at: string; updated_at: string };
export type ProductTemplateRowReferencePreview = { id: string; pricingType: ProductTemplateGroupReferenceType; groupId: string; rowId: string; previewUrl: string | null; caption: string | null };

export function productTemplateRowReferenceKey(pricingType: ProductTemplateGroupReferenceType, groupId: string, rowId: string) {
  return `${pricingType}\u0000${groupId}\u0000${rowId}`;
}

export function productTemplateRowReferencePath(templateId: string, pricingType: ProductTemplateGroupReferenceType, groupId: string, rowId: string, referenceId: string, mimeType = "image/webp") {
  [templateId, pricingType, groupId, rowId, referenceId].forEach((value) => { if (!value || /[\\/\0]/.test(value)) throw new Error("Reference image identity is invalid."); });
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
  return `product-template-row-references/${templateId}/${pricingType}/${groupId}/${rowId}/${referenceId}.${extension}`;
}

type PricingGroup = { id?: unknown; items?: unknown };
function groups(value: unknown): PricingGroup[] { return Array.isArray(value) ? value.filter((entry): entry is PricingGroup => typeof entry === "object" && entry !== null) : []; }
function contains(groupsValue: unknown, groupId: string, rowId: string) {
  return groups(groupsValue).some((group) => group.id === groupId && Array.isArray(group.items) && group.items.some((row) => typeof row === "object" && row !== null && "id" in row && row.id === rowId));
}

export function resolveProductTemplatePricingRowIdentity(pricing: { deskingSizePricing: unknown; variantPricing: unknown; categoryPricing: unknown; accessoryPricing: unknown }, pricingType: ProductTemplateGroupReferenceType, rowId: string) {
  const source = pricingType === "workstation" ? pricing.deskingSizePricing : pricingType === "base_model" ? pricing.variantPricing : pricingType === "accessory" ? pricing.accessoryPricing : pricing.categoryPricing;
  const matches = groups(source).filter((group) => {
    const modular = "pricing_type" in group && group.pricing_type === "modular_group";
    if (pricingType === "modular" ? !modular : pricingType === "finish_category" && modular) return false;
    return typeof group.id === "string" && Array.isArray(group.items) && group.items.some((row) => typeof row === "object" && row !== null && "id" in row && row.id === rowId);
  });
  return matches.length === 1 ? { groupId: matches[0].id as string, rowId } : null;
}

export function assertProductTemplatePricingRowExists(pricing: { deskingSizePricing: unknown; variantPricing: unknown; categoryPricing: unknown; accessoryPricing: unknown }, pricingType: ProductTemplateGroupReferenceType, groupId: string, rowId: string) {
  const source = pricingType === "workstation" ? pricing.deskingSizePricing : pricingType === "base_model" ? pricing.variantPricing : pricingType === "accessory" ? pricing.accessoryPricing : pricing.categoryPricing;
  if (!contains(source, groupId, rowId)) throw new Error("Pricing row no longer exists.");
}

export function persistedProductTemplatePricingRowKeys(pricing: { deskingSizePricing: unknown; variantPricing: unknown; categoryPricing: unknown; accessoryPricing: unknown }) {
  const keys = new Set<string>();
  const add = (type: ProductTemplateGroupReferenceType, value: unknown, predicate: (group: PricingGroup) => boolean = () => true) => groups(value).filter(predicate).forEach((group) => {
    if (typeof group.id !== "string" || !Array.isArray(group.items)) return;
    group.items.forEach((row) => { if (typeof row === "object" && row !== null && "id" in row && typeof row.id === "string") keys.add(productTemplateRowReferenceKey(type, group.id as string, row.id)); });
  });
  add("workstation", pricing.deskingSizePricing); add("base_model", pricing.variantPricing);
  add("finish_category", pricing.categoryPricing, (group) => !('pricing_type' in group) || group.pricing_type !== "modular_group");
  add("modular", pricing.categoryPricing, (group) => 'pricing_type' in group && group.pricing_type === "modular_group");
  add("accessory", pricing.accessoryPricing);
  return keys;
}

export function staleProductTemplateRowReferences(rows: ProductTemplateRowReferenceRow[], keys: ReadonlySet<string>) {
  return rows.filter((row) => !keys.has(productTemplateRowReferenceKey(row.pricing_type, row.group_id, row.row_id)));
}

export function compressedImageDimensions(width: number, height: number, maxEdge = 500) {
  if (!(width > 0 && height > 0 && maxEdge > 0)) throw new Error("Image dimensions are invalid.");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
