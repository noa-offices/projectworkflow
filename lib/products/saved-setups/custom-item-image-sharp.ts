/**
 * Server-side picture conversion with sharp (already a dependency). Used ONLY where the bytes come from storage or as a
 * fallback for an upload that is still too big in pixels: quote row picture -> My Collection (always converted to WebP),
 * and an uploaded WebP whose long side is over 1600 px. Uploads from the form arrive already compressed by the browser.
 * No database, no storage, no auth here: pure bytes in, bytes out. Never throws.
 */
import sharp from "sharp";
import { MAX_STORED_BYTES, compressionLadder, firstFittingStep, type ImageReason } from "./custom-item-image";

export type WebpConversion = { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; reason: ImageReason };

/** Pixel size of a picture after EXIF auto-rotate, or null when it cannot be decoded. */
export async function pictureDimensions(input: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(input, { failOn: "error" }).metadata();
    if (!meta.width || !meta.height) return null;
    const swapped = (meta.orientation ?? 1) >= 5; // EXIF orientations 5-8 turn the picture 90 degrees
    return swapped ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/**
 * Any decodable png/jpeg/webp -> WebP <= 2 MB: auto-rotate, long side <= 1600 (never enlarged), keep transparency,
 * strip metadata (sharp writes none unless asked), quality 85 then the shared ladder.
 */
export async function toStoredWebp(input: Uint8Array): Promise<WebpConversion> {
  const size = await pictureDimensions(input);
  if (!size) return { ok: false, reason: "unreadable" };
  try {
    const found = await firstFittingStep(compressionLadder(size.width, size.height), async (step) => {
      const bytes = await sharp(input, { failOn: "error" })
        .rotate()
        .resize({ width: step.width, height: step.height, fit: "inside", withoutEnlargement: true })
        .webp({ quality: step.quality })
        .toBuffer();
      return { size: bytes.byteLength, value: new Uint8Array(bytes) };
    }, MAX_STORED_BYTES);
    if (!found) return { ok: false, reason: "too_detailed" };
    return { ok: true, bytes: found.value, width: found.step.width, height: found.step.height };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
