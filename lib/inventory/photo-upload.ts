import { compressInventoryPhoto } from "./photo-compress";
import { inventoryPhotoError, type InventoryPhotoType } from "./photo-limits";
import { createClient } from "@/lib/supabase/client";

export interface UploadedInventoryPhoto {
  path: string;
  contentType: InventoryPhotoType;
  sizeBytes: number;
}

export interface InventoryPhotoUploadResult {
  files: UploadedInventoryPhoto[];
  failedCount: number;
  errors: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Uploads directly with the signed-in browser client. Successful files remain
 * uploaded after a partial failure. Register their metadata separately; callers
 * assign sortOrder/isMain using the owner's existing images.
 */
export async function uploadInventoryPhotos({ ownerType, ownerId, files }: {
  ownerType: "product" | "request";
  ownerId: string;
  files: File[];
}): Promise<InventoryPhotoUploadResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Inventory photos can only be uploaded in a browser.");
  }
  const result: InventoryPhotoUploadResult = { files: [], failedCount: 0, errors: [] };
  const failBatch = (message: string): InventoryPhotoUploadResult => ({ files: [], failedCount: files.length, errors: [message] });
  if ((ownerType !== "product" && ownerType !== "request") || !UUID.test(ownerId)) {
    return failBatch("Choose a valid product or request before uploading photos.");
  }
  if (files.length > 3) return failBatch("Choose no more than three photos at a time.");
  if (files.length === 0) return result;

  let client: ReturnType<typeof createClient>;
  try {
    client = createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return failBatch("Please sign in before uploading photos.");
  } catch {
    return failBatch("Unable to start the upload. Please sign in and try again.");
  }
  for (const [index, file] of files.entries()) {
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      result.failedCount++;
      result.errors.push(`Photo ${index + 1}: Please choose an image file.`);
      continue;
    }
    let blob: Blob;
    try {
      blob = (await compressInventoryPhoto(file)).file;
      const problem=inventoryPhotoError(blob.size,blob.type); if(problem) throw new Error(problem);
    } catch (error) {
      result.failedCount++;
      result.errors.push(`Photo ${index + 1}: ${error instanceof Error ? error.message : "Could not process this photo. Choose another photo."}`);
      continue;
    }
    try {
      const prefix = ownerType === "product" ? "products" : "requests";
      const extension = blob.type === "image/webp" ? "webp" : "jpg";
      const contentType = blob.type as InventoryPhotoType;
      const path = `${prefix}/${ownerId.toLowerCase()}/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from("inventory-images").upload(path, blob, { contentType, upsert: false });
      if (error) throw error;
      result.files.push({ path, contentType, sizeBytes: blob.size });
    } catch {
      result.failedCount++;
      result.errors.push(`Photo ${index + 1}: Upload failed. Please try this photo again.`);
    }
  }
  return result;
}
