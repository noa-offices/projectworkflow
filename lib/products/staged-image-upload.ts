// Browser-to-Storage staging for Smart Setup images. The template save request carries only these small paths,
// never image bytes (Vercel rejects big server-action bodies with 413 before our code runs).
export const STAGED_IMAGE_BUCKET = "product-images";
export const STAGED_IMAGE_PREFIX = "product-template-row-references/staging";
export const STAGED_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // same cap the server enforces for reference images
export const STAGED_IMAGE_PARALLEL = 3;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STAGED_PATH = new RegExp(`^${STAGED_IMAGE_PREFIX}/${UUID}/${UUID}\.(webp|png|jpg)$`);

export const isStagedImagePath = (path: unknown): path is string => typeof path === "string" && STAGED_PATH.test(path);
const extension = (type: string) => type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";

export type StagedImageInput = { key: string; file: { size: number; type: string } };
/** key -> where the file went. The same file object under the same key is never uploaded twice (repeat Save). */
export type StagedUploadCache<F> = Map<string, { file: F; path: string }>;
export type StagedUploadResult = { ok: true; paths: Map<string, string> } | { ok: false; message: string };

export const stagedUploadFailureMessage = (index: number, total: number, reason: string) => `Image ${index + 1} of ${total} failed to upload (${reason}). Nothing was lost. Press Save again.`;

/** Uploads in order with at most `limit` at the same time; stops starting new uploads after the first failure. */
export async function uploadStagedImages<F extends StagedImageInput["file"]>({ entries, cache, upload, limit = STAGED_IMAGE_PARALLEL, newId = () => crypto.randomUUID(), onProgress }: {
  entries: readonly { key: string; file: F }[]; cache: StagedUploadCache<F>; upload: (file: F, path: string) => Promise<void>; limit?: number; newId?: () => string; onProgress?: (done: number, total: number) => void;
}): Promise<StagedUploadResult> {
  const total = entries.length, batchId = newId();
  let done = 0, next = 0, failure: string | null = null;
  const finish = () => { done += 1; onProgress?.(done, total); };
  onProgress?.(0, total);
  await Promise.all(Array.from({ length: Math.min(limit, total) }, async () => {
    while (next < total && failure === null) {
      const index = next++, entry = entries[index], cached = cache.get(entry.key);
      if (cached && cached.file === entry.file) { finish(); continue; }
      try {
        if (!(entry.file.size > 0)) throw new Error("empty image");
        if (entry.file.size > STAGED_IMAGE_MAX_BYTES) throw new Error("larger than 5 MB");
        const path = cached?.path ?? `${STAGED_IMAGE_PREFIX}/${batchId}/${newId()}.${extension(entry.file.type)}`; // a changed file overwrites its own staged object
        await upload(entry.file, path);
        cache.set(entry.key, { file: entry.file, path }); finish();
      } catch (error) {
        failure ??= stagedUploadFailureMessage(index, total, error instanceof Error && error.message ? error.message.slice(0, 80) : "upload error");
      }
    }
  }));
  return failure !== null ? { ok: false, message: failure } : { ok: true, paths: new Map(entries.map((entry) => [entry.key, cache.get(entry.key)!.path])) };
}

/** True for the error a rejected-too-large or dropped server-action request produces; Next redirects must pass through. */
export const isFrameworkRedirect = (error: unknown) => typeof (error as { digest?: unknown } | null)?.digest === "string" && String((error as { digest: string }).digest).startsWith("NEXT_");
export const SAVE_REQUEST_FAILED_MESSAGE = "The save request could not be completed (it may have been too large or the connection dropped). Your work is still here and nothing was lost. Press Save again.";
