import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  PRODUCT_SOURCE_BUCKET,
  PRODUCT_SOURCE_GRACE_DAYS,
  PRODUCT_SOURCE_TEMPORARY_PREFIX,
  classifyTemporaryProductSources,
  temporaryProductSourcePath,
  type TemporaryProductSourceCandidate,
  type TemporaryProductSourceObject,
} from "./temporary-product-source";

export type StorageCleanupBucketStatus = { bucket: string; status: "available" | "managed_elsewhere" | "unavailable"; detail: string };
export type ProductSourceCleanupReviewItem = TemporaryProductSourceObject & {
  ageDays: number | null;
  state: "active" | "temporary" | "reclaimable";
  reason: string;
};
export type ProductSourceCleanupAnalysis = {
  status: "available" | "unavailable";
  message: string | null;
  graceDays: number;
  total: { objects: number; bytes: number | null };
  active: { objects: number; bytes: number | null };
  temporary: { objects: number; bytes: number | null };
  orphaned: { objects: number; bytes: number | null };
  reclaimable: { objects: number; bytes: number | null };
  candidates: TemporaryProductSourceCandidate[];
  review: ProductSourceCleanupReviewItem[];
  buckets: StorageCleanupBucketStatus[];
  quotationPdfNote: string;
};

const bucketStatuses: StorageCleanupBucketStatus[] = [
  { bucket: PRODUCT_SOURCE_BUCKET, status: "available", detail: `Temporary Source QA PDFs are reclaimable after ${PRODUCT_SOURCE_GRACE_DAYS} days without a durable reference.` },
  { bucket: "supplier-price-sources", status: "managed_elsewhere", detail: "Cleanup uses the existing Supplier source lifecycle, retained receipts, and retry controls." },
  { bucket: "product-images", status: "unavailable", detail: "Cleanup analysis not available yet. Every product image reference must be proven first." },
  { bucket: "quote-images", status: "unavailable", detail: "Cleanup analysis not available yet. Every quotation image reference must be proven first." },
];

function totalBytes(objects: TemporaryProductSourceObject[]): number | null {
  return objects.some((object) => object.bytes === null) ? null : objects.reduce((sum, object) => sum + (object.bytes ?? 0), 0);
}

function unavailable(message: string): ProductSourceCleanupAnalysis {
  const empty = { objects: 0, bytes: null };
  return { status: "unavailable", message, graceDays: PRODUCT_SOURCE_GRACE_DAYS, total: empty, active: empty, temporary: empty, orphaned: empty, reclaimable: empty, candidates: [], review: [], buckets: bucketStatuses.map((entry) => entry.bucket === PRODUCT_SOURCE_BUCKET ? { ...entry, status: "unavailable", detail: message } : entry), quotationPdfNote: "Generated quotation/document PDFs are created on demand and are not stored persistently." };
}

function reviewItem(object: TemporaryProductSourceObject, state: ProductSourceCleanupReviewItem["state"], reason: string, now: Date): ProductSourceCleanupReviewItem {
  const created = object.createdAt ? Date.parse(object.createdAt) : Number.NaN;
  return { ...object, ageDays: Number.isFinite(created) ? Math.max(0, Math.floor((now.getTime() - created) / 86_400_000)) : null, state, reason };
}

/** Bounded metadata-only listing. There are currently no durable Source QA PDF references. */
export async function analyzeProductSourceCleanup(now = new Date()): Promise<ProductSourceCleanupAnalysis> {
  const admin = createAdminClient();
  if (!admin.client) return unavailable(admin.error);
  const objects: TemporaryProductSourceObject[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const { data, error } = await admin.client.storage.from(PRODUCT_SOURCE_BUCKET).list(PRODUCT_SOURCE_TEMPORARY_PREFIX, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
    if (error) return unavailable(`Temporary Source QA files could not be analyzed: ${error.message}`);
    for (const file of data ?? []) {
      if (!file.id) continue;
      const rawSize = file.metadata?.size;
      const bytes = typeof rawSize === "number" && Number.isSafeInteger(rawSize) && rawSize >= 0 ? rawSize : null;
      objects.push({ path: `${PRODUCT_SOURCE_TEMPORARY_PREFIX}/${file.name}`, createdAt: file.created_at ?? null, bytes });
    }
    if ((data?.length ?? 0) < pageSize) break;
    if (offset + pageSize >= 10_000) return unavailable("Temporary Source QA cleanup is unavailable because the bounded 10,000-object scan was exceeded.");
  }
  const classified = classifyTemporaryProductSources(objects, new Set(), now);
  const metric = (items: TemporaryProductSourceObject[]) => ({ objects: items.length, bytes: totalBytes(items) });
  const review = [
    ...classified.active.map((object) => reviewItem(object, "active", "Referenced by an active or saved Product workflow.", now)),
    ...classified.temporary.map((object) => reviewItem(object, "temporary", `Protected by the ${PRODUCT_SOURCE_GRACE_DAYS}-day grace period.`, now)),
    ...classified.reclaimable.map((object) => reviewItem(object, "reclaimable", "Unreferenced temporary Source QA path outside the grace period.", now)),
  ].sort((left, right) => left.path.localeCompare(right.path));
  return {
    status: "available", message: null, graceDays: PRODUCT_SOURCE_GRACE_DAYS,
    total: metric(objects), active: metric(classified.active), temporary: metric(classified.temporary), orphaned: metric(classified.reclaimable), reclaimable: metric(classified.reclaimable),
    candidates: classified.reclaimable.sort((a, b) => b.ageDays - a.ageDays || a.path.localeCompare(b.path)), review, buckets: bucketStatuses,
    quotationPdfNote: "Generated quotation/document PDFs are created on demand and are not stored persistently.",
  };
}

/** Re-analyzes immediately and deletes only paths that are still eligible. */
export async function cleanProductSourceCandidates(requestedPaths: string[]) {
  const unique = [...new Set(requestedPaths.flatMap((path) => { const valid = temporaryProductSourcePath(path); return valid ? [valid] : []; }))];
  if (!unique.length || unique.length > 1000) return { ok: false as const, message: "No valid cleanup candidates were supplied.", analysis: await analyzeProductSourceCleanup() };
  const analysis = await analyzeProductSourceCleanup();
  if (analysis.status !== "available") return { ok: false as const, message: analysis.message ?? "Cleanup analysis is unavailable.", analysis };
  const eligible = new Set(analysis.candidates.map((candidate) => candidate.path));
  if (unique.some((path) => !eligible.has(path))) return { ok: false as const, message: "Cleanup stopped because one or more files are no longer eligible. Refresh the preview and try again.", analysis };
  const admin = createAdminClient();
  if (!admin.client) return { ok: false as const, message: admin.error, analysis };
  const { error } = await admin.client.storage.from(PRODUCT_SOURCE_BUCKET).remove(unique);
  if (error) return { ok: false as const, message: `Cleanup failed: ${error.message}. The candidates remain retryable.`, analysis };
  return { ok: true as const, message: `${unique.length} temporary Source QA PDF${unique.length === 1 ? "" : "s"} deleted.`, analysis: await analyzeProductSourceCleanup() };
}
