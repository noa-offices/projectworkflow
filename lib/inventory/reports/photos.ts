/** Photos for the Excel reports: limited downloads, 4:3 JPEG thumbnails, failures skipped quietly. */
export const CURRENT_PHOTO_LIMIT = 500;
export const MOVEMENT_PHOTO_LIMIT = 2000;
export const PHOTO_CONCURRENCY = 8;
export const PHOTO_TIMEOUT_MS = 8000;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const THUMB = { width: 240, height: 180, quality: 80 } as const;
export const PHOTOS_TOO_MANY_MESSAGE = "Narrow the filters to include photos.";

/** Same image, same key: the signed link changes per product, the storage path does not. */
export function photoKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url; }
}
export type PhotoSet = { buffers: Map<string, Buffer>; skipped: number };
type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;
export type PhotoDeps = { fetcher?: Fetcher; resize?: (input: Buffer) => Promise<Buffer>; concurrency?: number; timeoutMs?: number };

export async function resizeToThumbnail(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(input, { failOn: "none" }).rotate().resize(THUMB.width, THUMB.height, { fit: "cover", position: "centre" }).jpeg({ quality: THUMB.quality }).toBuffer();
}

/**
 * Downloads each distinct photo once (8 at a time, 8 seconds each) and shrinks it. A photo that fails is skipped:
 * it never stops the report. `skipped` counts items whose photo could not be loaded.
 */
export async function loadReportPhotos(items: readonly { url: string | null | undefined }[], deps: PhotoDeps = {}): Promise<PhotoSet> {
  const fetcher: Fetcher = deps.fetcher ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));
  const resize = deps.resize ?? resizeToThumbnail, timeoutMs = deps.timeoutMs ?? PHOTO_TIMEOUT_MS, concurrency = Math.max(1, deps.concurrency ?? PHOTO_CONCURRENCY);
  const urls = new Map<string, string>();
  for (const item of items) { const key = photoKey(item.url); if (key && item.url && !urls.has(key)) urls.set(key, item.url); }
  const buffers = new Map<string, Buffer>(), failed = new Set<string>(), queue = [...urls];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [key, url] = next;
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error("photo request failed");
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > PHOTO_MAX_BYTES) throw new Error("photo too large");
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length || bytes.length > PHOTO_MAX_BYTES) throw new Error("photo empty or too large");
        buffers.set(key, await resize(bytes));
      } catch { failed.add(key); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  const skipped = items.filter(item => { const key = photoKey(item.url); return key !== null && failed.has(key); }).length;
  return { buffers, skipped };
}
