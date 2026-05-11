"use client";

import { createClient } from "@/lib/supabase/client";

const resolvedImageUrlCache = new Map<string, string>();
const failedImagePathCache = new Set<string>();

function isQuoteStoragePath(value: string) {
  return value.startsWith("quotation-items/") || value.startsWith("quotation-finishes/");
}

function isProductStoragePath(value: string) {
  return value.startsWith("product-templates/") || value.startsWith("brand-materials/");
}

export function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

export function normalizeStoredImagePath(
  bucket: "product-images" | "quote-images",
  path: string,
) {
  return `${bucket}:${path}`;
}

export function normalizeProductImageSnapshotPath(value: string | null) {
  if (!value || isDirectImageUrl(value) || value.startsWith("product-images:")) {
    return value;
  }

  return normalizeStoredImagePath("product-images", value);
}

export function markQuotationImagePathFailed(path: string) {
  failedImagePathCache.add(path);
}

export function clearQuotationImagePathFailure(path: string) {
  failedImagePathCache.delete(path);
}

export async function resolveQuotationImageUrl(path: string) {
  if (failedImagePathCache.has(path)) {
    throw new Error("Image could not be loaded.");
  }

  const cached = resolvedImageUrlCache.get(path);
  if (cached) return cached;

  if (isDirectImageUrl(path)) return path;

  const bucket = path.startsWith("product-images:") || isProductStoragePath(path)
    ? "product-images"
    : "quote-images";
  const storagePath = path.startsWith("product-images:")
    ? path.slice("product-images:".length)
    : path.startsWith("quote-images:")
      ? path.slice("quote-images:".length)
      : isQuoteStoragePath(path) || isProductStoragePath(path)
        ? path
        : path;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    failedImagePathCache.add(path);
    throw new Error(error.message || "Image could not be loaded.");
  }

  clearQuotationImagePathFailure(path);
  resolvedImageUrlCache.set(path, data.signedUrl);
  return data.signedUrl;
}
