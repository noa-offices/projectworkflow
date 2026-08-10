"use server";

import { logServerActionError } from "@/lib/action-errors";
import { requireActiveUser, requireProductLibraryManager } from "@/lib/auth";
import {
  assertProductTemplatePricingGroupExists,
  compareProductTemplateGroupReferences,
  nextProductTemplateGroupReferenceDisplayOrder,
  normalizeProductTemplateGroupReferenceCaption,
  productTemplateGroupReferencePath,
  productTemplateGroupReferencePreview,
  removeReferenceWithCleanup,
  replaceReferenceWithCompensation,
  requireProductTemplateGroupReferenceType,
  type ProductTemplateGroupReferenceRow,
  type ProductTemplateGroupReferencePreview,
  uploadReferenceWithCompensation,
  validateProductTemplateGroupReferenceFile,
} from "@/lib/products/product-template-group-references";
import { createClient } from "@/lib/supabase/server";

const PRODUCT_IMAGES_BUCKET = "product-images";
const SIGNED_PREVIEW_TTL_SECONDS = 60 * 60;

type TemplatePricingRow = {
  id: string;
  desking_size_pricing: unknown;
  variant_pricing: unknown;
  category_pricing: unknown;
  accessory_pricing: unknown;
};

export type ProductTemplateGroupReference = ProductTemplateGroupReferencePreview;

function cleanRequiredInput(value: string, message: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(message);
  return cleaned;
}

async function loadManageableTemplatePricing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  templateId: string,
) {
  const { data, error } = await supabase
    .from("product_templates")
    .select("id,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing")
    .eq("id", templateId)
    .maybeSingle<TemplatePricingRow>();

  if (error) {
    logServerActionError("GROUP REFERENCE TEMPLATE LOAD ERROR", error, {
      recordId: templateId,
      table: "product_templates",
    });
    throw new Error("Product Template could not be checked.");
  }
  if (!data) throw new Error("Save the Product Template before adding reference images.");
  return data;
}

async function removeStorageObject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
) {
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([storagePath]);
  if (error) {
    logServerActionError("GROUP REFERENCE STORAGE REMOVE ERROR", error, { storagePath });
    throw error;
  }
}

async function signedPreviewUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: ProductTemplateGroupReferenceRow,
) {
  const { data, error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_PREVIEW_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    logServerActionError("GROUP REFERENCE SIGNED URL ERROR", error, {
      recordId: row.id,
      storagePath: row.storage_path,
    });
    return null;
  }
  return data.signedUrl;
}

export async function listProductTemplateGroupReferences({
  groupId,
  pricingType,
  templateId,
}: {
  groupId: string;
  pricingType: string;
  templateId: string;
}): Promise<ProductTemplateGroupReference[]> {
  await requireActiveUser();
  const cleanTemplateId = cleanRequiredInput(templateId, "Product Template id is required.");
  const cleanGroupId = cleanRequiredInput(groupId, "Pricing group id is required.");
  const cleanPricingType = requireProductTemplateGroupReferenceType(pricingType);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_template_group_references")
    .select("id,template_id,pricing_type,group_id,storage_path,display_order,caption,created_at,updated_at")
    .eq("template_id", cleanTemplateId)
    .eq("pricing_type", cleanPricingType)
    .eq("group_id", cleanGroupId)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<ProductTemplateGroupReferenceRow[]>();

  if (error) {
    logServerActionError("GROUP REFERENCES LIST ERROR", error, {
      groupId: cleanGroupId,
      pricingType: cleanPricingType,
      recordId: cleanTemplateId,
    });
    throw new Error("Reference images could not be loaded.");
  }

  const rows = [...(data ?? [])].sort(compareProductTemplateGroupReferences);
  return Promise.all(rows.map(async (row) =>
    productTemplateGroupReferencePreview(row, await signedPreviewUrl(supabase, row))));
}

export async function uploadProductTemplateGroupReference({
  caption,
  displayOrder: requestedDisplayOrder,
  file,
  groupId,
  pricingType,
  templateId,
}: {
  caption?: string | null;
  displayOrder?: number | null;
  file: File;
  groupId: string;
  pricingType: string;
  templateId: string;
}): Promise<ProductTemplateGroupReference> {
  const { user } = await requireProductLibraryManager();
  const cleanTemplateId = cleanRequiredInput(templateId, "Save the Product Template before adding reference images.");
  const cleanGroupId = cleanRequiredInput(groupId, "Pricing group id is required.");
  const cleanPricingType = requireProductTemplateGroupReferenceType(pricingType);
  const supabase = await createClient();
  const template = await loadManageableTemplatePricing(supabase, cleanTemplateId);
  assertProductTemplatePricingGroupExists({
    accessoryPricing: template.accessory_pricing,
    categoryPricing: template.category_pricing,
    deskingSizePricing: template.desking_size_pricing,
    variantPricing: template.variant_pricing,
    groupId: cleanGroupId,
    pricingType: cleanPricingType,
  });
  validateProductTemplateGroupReferenceFile(file);

  const referenceId = crypto.randomUUID();
  const storagePath = productTemplateGroupReferencePath({
    filename: file.name,
    groupId: cleanGroupId,
    mimeType: file.type,
    pricingType: cleanPricingType,
    referenceId,
    templateId: cleanTemplateId,
  });
  const { data: orderRows, error: orderError } = await supabase
    .from("product_template_group_references")
    .select("display_order")
    .eq("template_id", cleanTemplateId)
    .eq("pricing_type", cleanPricingType)
    .eq("group_id", cleanGroupId)
    .returns<Array<{ display_order: number }>>();
  if (orderError) {
    logServerActionError("GROUP REFERENCE ORDER LOAD ERROR", orderError, {
      groupId: cleanGroupId,
      pricingType: cleanPricingType,
      recordId: cleanTemplateId,
    });
    throw new Error("Reference image order could not be determined.");
  }
  const displayOrder = nextProductTemplateGroupReferenceDisplayOrder(
    (orderRows ?? []).map((row) => row.display_order),
  );
  const resolvedDisplayOrder = requestedDisplayOrder === null || requestedDisplayOrder === undefined
    ? displayOrder
    : requestedDisplayOrder;
  if (!Number.isInteger(resolvedDisplayOrder)) {
    throw new Error("Reference image display order must be a whole number.");
  }

  const row = await uploadReferenceWithCompensation({
    uploadObject: async () => {
      const { data, error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (error || !data?.path) {
        logServerActionError("GROUP REFERENCE UPLOAD ERROR", error, { storagePath });
        throw new Error("Reference image upload failed.");
      }
    },
    persistReference: async () => {
      const { data, error } = await supabase
        .from("product_template_group_references")
        .insert({
          id: referenceId,
          template_id: cleanTemplateId,
          pricing_type: cleanPricingType,
          group_id: cleanGroupId,
          storage_path: storagePath,
          display_order: resolvedDisplayOrder,
          caption: normalizeProductTemplateGroupReferenceCaption(caption),
          created_by: user.id,
        })
        .select("id,template_id,pricing_type,group_id,storage_path,display_order,caption,created_at,updated_at")
        .single<ProductTemplateGroupReferenceRow>();
      if (error || !data) {
        logServerActionError("GROUP REFERENCE INSERT ERROR", error, { storagePath });
        throw error ?? new Error("Reference row was not returned.");
      }
      return data;
    },
    cleanupUploadedObject: () => removeStorageObject(supabase, storagePath),
  });

  return productTemplateGroupReferencePreview(row, await signedPreviewUrl(supabase, row));
}

export async function replaceProductTemplateGroupReference({
  caption,
  file,
  referenceId,
}: {
  caption?: string | null;
  file: File;
  referenceId: string;
}): Promise<{ reference: ProductTemplateGroupReference; cleanupWarning: string | null }> {
  await requireProductLibraryManager();
  const cleanReferenceId = cleanRequiredInput(referenceId, "Reference id is required.");
  const supabase = await createClient();
  const { data: existing, error: referenceError } = await supabase
    .from("product_template_group_references")
    .select("id,template_id,pricing_type,group_id,storage_path,display_order,caption,created_at,updated_at")
    .eq("id", cleanReferenceId)
    .maybeSingle<ProductTemplateGroupReferenceRow>();
  if (referenceError) {
    logServerActionError("GROUP REFERENCE LOAD ERROR", referenceError, { recordId: cleanReferenceId });
    throw new Error("Reference image could not be checked.");
  }
  if (!existing) throw new Error("Reference image no longer exists.");

  const template = await loadManageableTemplatePricing(supabase, existing.template_id);
  assertProductTemplatePricingGroupExists({
    accessoryPricing: template.accessory_pricing,
    categoryPricing: template.category_pricing,
    deskingSizePricing: template.desking_size_pricing,
    variantPricing: template.variant_pricing,
    groupId: existing.group_id,
    pricingType: existing.pricing_type,
  });
  validateProductTemplateGroupReferenceFile(file);

  const storagePath = productTemplateGroupReferencePath({
    filename: file.name,
    groupId: existing.group_id,
    mimeType: file.type,
    pricingType: existing.pricing_type,
    referenceId: crypto.randomUUID(),
    templateId: existing.template_id,
  });
  const result = await replaceReferenceWithCompensation({
    uploadNewObject: async () => {
      const { data, error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
      if (error || !data?.path) {
        logServerActionError("GROUP REFERENCE REPLACEMENT UPLOAD ERROR", error, { storagePath });
        throw new Error("Reference image upload failed.");
      }
    },
    updateReference: async () => {
      const { data, error } = await supabase
        .from("product_template_group_references")
        .update({
          storage_path: storagePath,
          caption: caption === undefined
            ? existing.caption
            : normalizeProductTemplateGroupReferenceCaption(caption),
        })
        .eq("id", existing.id)
        .select("id,template_id,pricing_type,group_id,storage_path,display_order,caption,created_at,updated_at")
        .single<ProductTemplateGroupReferenceRow>();
      if (error || !data) {
        logServerActionError("GROUP REFERENCE UPDATE ERROR", error, { recordId: existing.id });
        throw error ?? new Error("Updated reference row was not returned.");
      }
      return data;
    },
    cleanupNewObject: () => removeStorageObject(supabase, storagePath),
    deleteOldObject: () => removeStorageObject(supabase, existing.storage_path),
  });

  if (result.cleanupWarning) {
    console.warn("GROUP REFERENCE OLD STORAGE CLEANUP WARNING", {
      recordId: existing.id,
      storagePath: existing.storage_path,
    });
  }
  return {
    reference: productTemplateGroupReferencePreview(result.value, await signedPreviewUrl(supabase, result.value)),
    cleanupWarning: result.cleanupWarning,
  };
}

export async function removeProductTemplateGroupReference(
  referenceId: string,
): Promise<{ ok: true; cleanupWarning: string | null }> {
  await requireProductLibraryManager();
  const cleanReferenceId = cleanRequiredInput(referenceId, "Reference id is required.");
  const supabase = await createClient();
  const { data: existing, error: referenceError } = await supabase
    .from("product_template_group_references")
    .select("id,template_id,pricing_type,group_id,storage_path,display_order,caption,created_at,updated_at")
    .eq("id", cleanReferenceId)
    .maybeSingle<ProductTemplateGroupReferenceRow>();
  if (referenceError) {
    logServerActionError("GROUP REFERENCE LOAD ERROR", referenceError, { recordId: cleanReferenceId });
    throw new Error("Reference image could not be checked.");
  }
  if (!existing) throw new Error("Reference image no longer exists.");

  await loadManageableTemplatePricing(supabase, existing.template_id);
  const result = await removeReferenceWithCleanup({
    deleteReference: async () => {
      const { error } = await supabase
        .from("product_template_group_references")
        .delete()
        .eq("id", existing.id);
      if (error) {
        logServerActionError("GROUP REFERENCE DELETE ERROR", error, { recordId: existing.id });
        throw new Error("Reference image could not be removed.");
      }
      return true as const;
    },
    deleteStorageObject: () => removeStorageObject(supabase, existing.storage_path),
  });

  if (result.cleanupWarning) {
    console.warn("GROUP REFERENCE STORAGE CLEANUP WARNING", {
      recordId: existing.id,
      storagePath: existing.storage_path,
    });
  }
  return { ok: true, cleanupWarning: result.cleanupWarning };
}
