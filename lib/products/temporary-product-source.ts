export const PRODUCT_SOURCE_BUCKET = "product-source-files";
export const PRODUCT_SOURCE_TEMPORARY_PREFIX = "smart-source-qa";
export const PRODUCT_SOURCE_GRACE_DAYS = 7;
const SOURCE_PATH = /^smart-source-qa\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9][A-Za-z0-9._-]*$/i;

export type TemporaryProductSourceObject = { path: string; createdAt: string | null; bytes: number | null };
export type TemporaryProductSourceCandidate = TemporaryProductSourceObject & { ageDays: number };
export type ProductSourceCleanupClassification = {
  active: TemporaryProductSourceObject[];
  temporary: TemporaryProductSourceObject[];
  reclaimable: TemporaryProductSourceCandidate[];
  ignored: TemporaryProductSourceObject[];
};

export function temporaryProductSourcePath(storagePath: string | null | undefined) {
  const path = storagePath?.trim() ?? "";
  return SOURCE_PATH.test(path) ? path : null;
}

/** Classifies only the dedicated temporary namespace. Unknown timestamps remain protected. */
export function classifyTemporaryProductSources(objects: TemporaryProductSourceObject[], referencedPaths: ReadonlySet<string>, now = new Date()): ProductSourceCleanupClassification {
  const result: ProductSourceCleanupClassification = { active: [], temporary: [], reclaimable: [], ignored: [] };
  const cutoff = now.getTime() - PRODUCT_SOURCE_GRACE_DAYS * 86_400_000;
  for (const object of objects) {
    const path = temporaryProductSourcePath(object.path);
    if (!path) { result.ignored.push(object); continue; }
    if (referencedPaths.has(path)) { result.active.push(object); continue; }
    const created = object.createdAt ? Date.parse(object.createdAt) : Number.NaN;
    if (!Number.isFinite(created) || created > cutoff) { result.temporary.push(object); continue; }
    result.reclaimable.push({ ...object, path, ageDays: Math.max(PRODUCT_SOURCE_GRACE_DAYS, Math.floor((now.getTime() - created) / 86_400_000)) });
  }
  return result;
}

export async function deleteTemporaryProductSource(storagePath: string | null | undefined) {
  const path = temporaryProductSourcePath(storagePath);
  if (!path) return { ok: false as const, reason: "invalid_path" as const };
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const { error } = await createClient().storage.from(PRODUCT_SOURCE_BUCKET).remove([path]);
    return error ? { ok: false as const, reason: "delete_failed" as const } : { ok: true as const };
  } catch {
    return { ok: false as const, reason: "delete_failed" as const };
  }
}
