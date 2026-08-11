"use server";

import { requireActiveUser, requireProductLibraryManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requireProductTemplateGroupReferenceType, replaceReferenceWithCompensation, removeReferenceWithCleanup, uploadReferenceWithCompensation, validateProductTemplateGroupReferenceFile } from "@/lib/products/product-template-group-references";
import { assertProductTemplatePricingRowExists, productTemplateRowReferencePath, type ProductTemplateRowReferencePreview, type ProductTemplateRowReferenceRow } from "@/lib/products/product-template-row-references";

const bucket = "product-images";
const columns = "id,template_id,pricing_type,group_id,row_id,storage_path,caption,created_at,updated_at";
type TemplatePricing = { id: string; desking_size_pricing: unknown; variant_pricing: unknown; category_pricing: unknown; accessory_pricing: unknown };
function required(value: string) { const clean = value.trim(); if (!clean) throw new Error("Reference image identity is required."); return clean; }
async function preview(supabase: Awaited<ReturnType<typeof createClient>>, row: ProductTemplateRowReferenceRow): Promise<ProductTemplateRowReferencePreview> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(row.storage_path, 3600);
  return { id: row.id, pricingType: row.pricing_type, groupId: row.group_id, rowId: row.row_id, previewUrl: data?.signedUrl ?? null, caption: row.caption };
}
async function template(supabase: Awaited<ReturnType<typeof createClient>>, templateId: string) {
  const { data, error } = await supabase.from("product_templates").select("id,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing").eq("id", templateId).maybeSingle<TemplatePricing>();
  if (error || !data) throw new Error("Save the Product Template before adding row images.");
  return data;
}
async function removeObject(supabase: Awaited<ReturnType<typeof createClient>>, path: string) { const { error } = await supabase.storage.from(bucket).remove([path]); if (error) throw error; }

export async function listProductTemplateRowReferences(templateId: string, scope?: { pricingType: string; groupId: string; rowId: string }): Promise<ProductTemplateRowReferencePreview[]> {
  await requireActiveUser(); const supabase = await createClient(); const cleanId = required(templateId);
  let query = supabase.from("product_template_row_references").select(columns).eq("template_id", cleanId);
  if (scope) query = query.eq("pricing_type", requireProductTemplateGroupReferenceType(scope.pricingType)).eq("group_id", required(scope.groupId)).eq("row_id", required(scope.rowId));
  const { data, error } = await query.returns<ProductTemplateRowReferenceRow[]>();
  if (error) throw new Error("Row reference images could not be loaded.");
  return Promise.all((data ?? []).map((row) => preview(supabase, row)));
}

export async function saveProductTemplateRowReference(input: { templateId: string; pricingType: string; groupId: string; rowId: string; file: File }) {
  const { user } = await requireProductLibraryManager(); const supabase = await createClient();
  const templateId = required(input.templateId); const groupId = required(input.groupId); const rowId = required(input.rowId); const pricingType = requireProductTemplateGroupReferenceType(input.pricingType);
  validateProductTemplateGroupReferenceFile(input.file); const savedTemplate = await template(supabase, templateId);
  assertProductTemplatePricingRowExists({ deskingSizePricing: savedTemplate.desking_size_pricing, variantPricing: savedTemplate.variant_pricing, categoryPricing: savedTemplate.category_pricing, accessoryPricing: savedTemplate.accessory_pricing }, pricingType, groupId, rowId);
  const { data: existing } = await supabase.from("product_template_row_references").select(columns).eq("template_id", templateId).eq("pricing_type", pricingType).eq("group_id", groupId).eq("row_id", rowId).maybeSingle<ProductTemplateRowReferenceRow>();
  const referenceId = crypto.randomUUID(); const storagePath = productTemplateRowReferencePath(templateId, pricingType, groupId, rowId, referenceId, input.file.type);
  const upload = async () => { const { error } = await supabase.storage.from(bucket).upload(storagePath, input.file, { contentType: input.file.type, cacheControl: "3600", upsert: false }); if (error) throw new Error("Reference image could not be saved."); };
  let row: ProductTemplateRowReferenceRow;
  if (existing) {
    const result = await replaceReferenceWithCompensation({ uploadNewObject: upload, updateReference: async () => { const { data, error } = await supabase.from("product_template_row_references").update({ storage_path: storagePath }).eq("id", existing.id).select(columns).single<ProductTemplateRowReferenceRow>(); if (error || !data) throw error; return data; }, cleanupNewObject: () => removeObject(supabase, storagePath), deleteOldObject: () => removeObject(supabase, existing.storage_path) });
    row = result.value;
  } else {
    row = await uploadReferenceWithCompensation({ uploadObject: upload, persistReference: async () => { const { data, error } = await supabase.from("product_template_row_references").insert({ id: referenceId, template_id: templateId, pricing_type: pricingType, group_id: groupId, row_id: rowId, storage_path: storagePath, created_by: user.id }).select(columns).single<ProductTemplateRowReferenceRow>(); if (error || !data) throw error; return data; }, cleanupUploadedObject: () => removeObject(supabase, storagePath) });
  }
  return preview(supabase, row);
}

export async function removeProductTemplateRowReference(referenceId: string) {
  await requireProductLibraryManager(); const supabase = await createClient(); const cleanId = required(referenceId);
  const { data: existing, error } = await supabase.from("product_template_row_references").select(columns).eq("id", cleanId).maybeSingle<ProductTemplateRowReferenceRow>();
  if (error || !existing) throw new Error("Reference image no longer exists.");
  await removeReferenceWithCleanup({ deleteReference: async () => { const { error: deleteError } = await supabase.from("product_template_row_references").delete().eq("id", cleanId); if (deleteError) throw deleteError; }, deleteStorageObject: () => removeObject(supabase, existing.storage_path) });
  return { ok: true as const };
}
