"use client";

import { createClient } from "@/lib/supabase/client";

const resolvedImageUrlCache = new Map<string, string>();
const failedImagePathCache = new Set<string>();
// Same bucket + path being signed right now: callers share one request.
const inFlightImageUrlRequests = new Map<string, Promise<string>>();

// Signed links last 3600 s; reuse them across page loads for the first 3000 s only.
const SIGNED_URL_REUSE_MS = 3000 * 1000;
const SIGNED_URL_STORAGE_PREFIX = "pw-signed-image:";

function readStoredSignedUrl(key: string) {
  try {
    const raw = window.sessionStorage.getItem(SIGNED_URL_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: unknown; expiresAt?: unknown };
    if (typeof parsed.url === "string" && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now()) {
      return parsed.url;
    }
    window.sessionStorage.removeItem(SIGNED_URL_STORAGE_PREFIX + key);
  } catch {
    // Storage blocked or unreadable: sign as before.
  }
  return null;
}

function writeStoredSignedUrl(key: string, url: string) {
  try {
    window.sessionStorage.setItem(SIGNED_URL_STORAGE_PREFIX + key, JSON.stringify({ url, expiresAt: Date.now() + SIGNED_URL_REUSE_MS }));
  } catch {
    // Storage blocked or full: work as before.
  }
}

function removeStoredSignedUrl(key: string) {
  try {
    window.sessionStorage.removeItem(SIGNED_URL_STORAGE_PREFIX + key);
  } catch {
    // Ignore.
  }
}

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
  // A link that failed to load must not be reused by the next page load.
  if (!isDirectImageUrl(path)) {
    const { key } = signingTarget(path);
    removeStoredSignedUrl(key);
  }
}

export function clearQuotationImagePathFailure(path: string) {
  failedImagePathCache.delete(path);
}

function signingTarget(path: string) {
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
  return { bucket, storagePath, key: `${bucket}:${storagePath}` } as const;
}

export async function resolveQuotationImageUrl(path: string) {
  if (failedImagePathCache.has(path)) {
    throw new Error("Image could not be loaded.");
  }

  const cached = resolvedImageUrlCache.get(path);
  if (cached) return cached;

  if (isDirectImageUrl(path)) return path;

  const { bucket, storagePath, key } = signingTarget(path);

  const stored = readStoredSignedUrl(key);
  if (stored) {
    resolvedImageUrlCache.set(path, stored);
    return stored;
  }

  const pending = inFlightImageUrlRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
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
    writeStoredSignedUrl(key, data.signedUrl);
    return data.signedUrl;
  })().finally(() => {
    inFlightImageUrlRequests.delete(key);
  });

  inFlightImageUrlRequests.set(key, request);
  return request;
}
