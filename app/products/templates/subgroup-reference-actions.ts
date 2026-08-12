"use server";

import { requireActiveUser, requireProductLibraryManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requireProductTemplateGroupReferenceType, replaceReferenceWithCompensation, removeReferenceWithCleanup, uploadReferenceWithCompensation, validateProductTemplateGroupReferenceFile } from "@/lib/products/product-template-group-references";
import { assertProductTemplateSubgroupExists, productTemplateSubgroupReferencePath, type ProductTemplateSubgroupReferencePreview, type ProductTemplateSubgroupReferenceRow } from "@/lib/products/product-template-subgroup-references";

const bucket = "product-images";
const columns = "id,template_id,pricing_type,group_id,subgroup_id,storage_path,caption,created_at,updated_at";
function required(value: string) { const clean = value.trim(); if (!clean) throw new Error("Reference image identity is required."); return clean; }
async function preview(supabase: Awaited<ReturnType<typeof createClient>>, row: ProductTemplateSubgroupReferenceRow): Promise<ProductTemplateSubgroupReferencePreview> { const { data } = await supabase.storage.from(bucket).createSignedUrl(row.storage_path, 3600); return { id: row.id, pricingType: row.pricing_type, groupId: row.group_id, subgroupId: row.subgroup_id, previewUrl: data?.signedUrl ?? null, caption: row.caption }; }
async function removeObject(supabase: Awaited<ReturnType<typeof createClient>>, path: string) { const { error } = await supabase.storage.from(bucket).remove([path]); if (error) throw error; }

export async function listProductTemplateSubgroupReferences(templateId: string, scope?: { pricingType: string; groupId: string; subgroupId: string }): Promise<ProductTemplateSubgroupReferencePreview[]> {
  await requireActiveUser(); const supabase = await createClient(); let query = supabase.from("product_template_subgroup_references").select(columns).eq("template_id", required(templateId)); if (scope) query = query.eq("pricing_type", requireProductTemplateGroupReferenceType(scope.pricingType)).eq("group_id", required(scope.groupId)).eq("subgroup_id", required(scope.subgroupId)); const { data, error } = await query.returns<ProductTemplateSubgroupReferenceRow[]>();
  if (error) throw new Error("Subgroup reference images could not be loaded."); return Promise.all((data ?? []).map((row) => preview(supabase, row)));
}

export async function saveProductTemplateSubgroupReference(input: { templateId: string; pricingType: string; groupId: string; subgroupId: string; file: File }) {
  const { user } = await requireProductLibraryManager(); const supabase = await createClient(); const templateId = required(input.templateId); const groupId = required(input.groupId); const subgroupId = required(input.subgroupId); const pricingType = requireProductTemplateGroupReferenceType(input.pricingType);
  validateProductTemplateGroupReferenceFile(input.file);
  const { data: template, error: templateError } = await supabase.from("product_templates").select("variant_pricing,desking_size_pricing,category_pricing,accessory_pricing").eq("id", templateId).maybeSingle<{ variant_pricing: unknown; desking_size_pricing: unknown; category_pricing: unknown; accessory_pricing: unknown }>();
  if (templateError || !template) throw new Error("Save the Product Template before adding subgroup images.");
  assertProductTemplateSubgroupExists({ variantPricing: template.variant_pricing, deskingSizePricing: template.desking_size_pricing, categoryPricing: template.category_pricing, accessoryPricing: template.accessory_pricing }, pricingType, groupId, subgroupId);
  const { data: existing } = await supabase.from("product_template_subgroup_references").select(columns).eq("template_id", templateId).eq("pricing_type", pricingType).eq("group_id", groupId).eq("subgroup_id", subgroupId).maybeSingle<ProductTemplateSubgroupReferenceRow>();
  const referenceId = crypto.randomUUID(); const storagePath = productTemplateSubgroupReferencePath(templateId, pricingType, groupId, subgroupId, referenceId, input.file.type);
  const upload = async () => { const { error } = await supabase.storage.from(bucket).upload(storagePath, input.file, { contentType: input.file.type, cacheControl: "3600", upsert: false }); if (error) throw new Error("Reference image could not be saved."); };
  let row: ProductTemplateSubgroupReferenceRow;
  if (existing) { const result = await replaceReferenceWithCompensation({ uploadNewObject: upload, updateReference: async () => { const { data, error } = await supabase.from("product_template_subgroup_references").update({ storage_path: storagePath }).eq("id", existing.id).select(columns).single<ProductTemplateSubgroupReferenceRow>(); if (error || !data) throw error; return data; }, cleanupNewObject: () => removeObject(supabase, storagePath), deleteOldObject: () => removeObject(supabase, existing.storage_path) }); row = result.value; }
  else row = await uploadReferenceWithCompensation({ uploadObject: upload, persistReference: async () => { const { data, error } = await supabase.from("product_template_subgroup_references").insert({ id: referenceId, template_id: templateId, pricing_type: pricingType, group_id: groupId, subgroup_id: subgroupId, storage_path: storagePath, created_by: user.id }).select(columns).single<ProductTemplateSubgroupReferenceRow>(); if (error || !data) throw error; return data; }, cleanupUploadedObject: () => removeObject(supabase, storagePath) });
  return preview(supabase, row);
}

export async function removeProductTemplateSubgroupReference(referenceId: string) {
  await requireProductLibraryManager(); const supabase = await createClient(); const cleanId = required(referenceId); const { data: existing, error } = await supabase.from("product_template_subgroup_references").select(columns).eq("id", cleanId).maybeSingle<ProductTemplateSubgroupReferenceRow>();
  if (error || !existing) throw new Error("Reference image no longer exists.");
  await removeReferenceWithCleanup({ deleteReference: async () => { const { error: deleteError } = await supabase.from("product_template_subgroup_references").delete().eq("id", cleanId); if (deleteError) throw deleteError; }, deleteStorageObject: () => removeObject(supabase, existing.storage_path) }); return { ok: true as const };
}
