import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { copySharedImage, isDuplicateImage, sharedImageReplacements, sharedImageTarget, snapshotImageFields } from "./quotation-shared-image-core";

// Call ONLY after the caller's existing quotation permission check.
export async function prepareSharedImagePaths(client: SupabaseClient, values: unknown[]) {
  return sharedImageReplacements(values, (value) => copySharedImage(value, async (source, expired) => {
    const { data, error } = await client.storage.from("product-images").download(source);
    if (error || !data || data.size > 5 * 1024 * 1024 || expired()) throw new Error("source unavailable");
    const bytes = new Uint8Array(await data.arrayBuffer());
    const path = sharedImageTarget(bytes);
    const { default: sharp } = await import("sharp");
    const body = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    if (expired()) throw new Error("expired");
    const admin = createAdminClient();
    if (!admin.client) throw new Error("admin unavailable");
    // The admin client is used only for this non-overwriting, server-named upload.
    const uploaded = await admin.client.storage.from("quote-images").upload(path, body, { contentType: "image/webp", upsert: false, cacheControl: "31536000" });
    if (uploaded.error && !isDuplicateImage(uploaded.error)) throw new Error("upload failed");
    return `quote-images:${path}`;
  }, () => console.warn("SHARED QUOTATION IMAGE: copy failed; original kept.")),
  () => console.warn("SHARED QUOTATION IMAGE: batch limit reached; remaining originals kept."));
}

// Mutates only submitted image fields, leaving all other snapshot/commercial data intact.
export async function prepareSharedSnapshotImages(client: SupabaseClient, rows: object[]) {
  const records = rows as Record<string, unknown>[];
  const replacements = await prepareSharedImagePaths(client, records.flatMap((row) => snapshotImageFields.map((field) => row[field])));
  for (const row of records) for (const field of snapshotImageFields) {
    const value = row[field];
    if (typeof value === "string" && replacements[value]) row[field] = replacements[value];
  }
}
