import { createHash } from "node:crypto";

export const SHARED_IMAGE_LIMIT = 3;
export const SHARED_IMAGE_CONCURRENCY = 3;
export const SHARED_IMAGE_TIMEOUT_MS = 5000;
export const snapshotImageFields = ["specified_image_url_snapshot", "proposed_image_url_snapshot"] as const;

export function sharedImageSource(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("product-images:product-templates/")) return null;
  const path = value.slice("product-images:".length);
  const parts = path.split("/");
  return parts.length >= 3 && parts.every((part) => part && part !== "." && part !== "..") && !/[\\%?#\u0000-\u001f]/.test(path) ? path : null;
}

export function sharedImageTarget(bytes: Uint8Array) {
  return `shared/${createHash("sha256").update(bytes).digest("hex")}.webp`;
}

export function isDuplicateImage(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const details = error as { statusCode?: string | number; error?: string };
  return String(details.statusCode) === "409" || details.error === "Duplicate";
}

export async function copySharedImage(value: string, copy: (source: string, expired: () => boolean) => Promise<string>, log: () => void): Promise<string> {
  const source = sharedImageSource(value);
  if (!source) return value;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      copy(source, () => expired),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("timeout")); }, SHARED_IMAGE_TIMEOUT_MS); }),
    ]);
  } catch {
    log();
    return value;
  } finally { if (timer) clearTimeout(timer); }
}

export async function sharedImageReplacements(values: unknown[], copy: (value: string) => Promise<string>, capped: () => void) {
  const unique = [...new Set(values.filter((value): value is string => sharedImageSource(value) !== null))];
  if (unique.length > SHARED_IMAGE_LIMIT) capped();
  const selected = unique.slice(0, SHARED_IMAGE_LIMIT);
  const result: Record<string, string> = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(SHARED_IMAGE_CONCURRENCY, selected.length) }, async () => {
    while (next < selected.length) {
      const value = selected[next++];
      result[value] = await copy(value);
    }
  }));
  return result;
}
