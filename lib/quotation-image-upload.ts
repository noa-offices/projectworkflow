"use client";

import { createClient } from "@/lib/supabase/client";

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxImageSizeBytes = 5 * 1024 * 1024;

export type QuotationImageUploadResult = {
  bucket: "quote-images" | "product-images";
  path: string;
};

function safeFilename(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const basename = filename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${basename || "image"}.${extension}`;
}

function validateImageFile(file: File) {
  if (!allowedImageTypes.has(file.type)) {
    throw new Error("Only PNG, JPG, JPEG, and WebP images can be uploaded.");
  }

  if (file.size > maxImageSizeBytes) {
    throw new Error("Image must be 5MB or smaller.");
  }
}

async function uploadImage(bucket: QuotationImageUploadResult["bucket"], path: string, file: File) {
  validateImageFile(file);

  const supabase = createClient();
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || "Image upload failed.");
  }

  return {
    bucket,
    path: data.path,
  };
}

export async function uploadQuotationItemImage({
  file,
  itemId,
  quotationId,
}: {
  file: File;
  itemId: string;
  quotationId: string;
}): Promise<QuotationImageUploadResult> {
  const path = `quotation-items/${quotationId}/${itemId}/${Date.now()}-${safeFilename(file.name)}`;

  return uploadImage("quote-images", path, file);
}

export async function uploadQuotationFinishImage({
  file,
  itemId,
  quotationId,
}: {
  file: File;
  itemId?: string | null;
  quotationId: string;
}): Promise<QuotationImageUploadResult> {
  const path = `quotation-finishes/${quotationId}/${itemId || "pending"}/${Date.now()}-${safeFilename(file.name)}`;

  return uploadImage("quote-images", path, file);
}

export async function uploadProductTemplateImage({
  file,
  templateId,
}: {
  file: File;
  templateId: string;
}): Promise<QuotationImageUploadResult> {
  const path = `product-templates/${templateId}/${Date.now()}-${safeFilename(file.name)}`;

  return uploadImage("product-images", path, file);
}

export async function uploadBrandMaterialImage({
  brandId,
  file,
  groupId,
}: {
  brandId: string;
  file: File;
  groupId: string;
}): Promise<QuotationImageUploadResult> {
  const path = `brand-materials/${brandId}/${groupId}/${Date.now()}-${safeFilename(file.name)}`;

  return uploadImage("product-images", path, file);
}
