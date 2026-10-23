import { createClient } from "@/lib/supabase/client";

export interface UploadedInventoryPhoto {
  path: string;
  contentType: "image/jpeg";
  sizeBytes: number;
}

export interface InventoryPhotoUploadResult {
  files: UploadedInventoryPhoto[];
  failedCount: number;
  errors: string[];
}

const MAX_BYTES = 4.5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Some browsers support formats through Image but not createImageBitmap.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This photo could not be opened."));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function preparePhoto(file: File): Promise<Blob> {
  const decoded = await decodeImage(file);
  const canvas = document.createElement("canvas");
  try {
    if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) {
      throw new Error("This photo has invalid dimensions.");
    }
    const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable in this browser.");
    // JPEG has no alpha channel; transparent input is flattened onto white.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.type !== "image/jpeg" || blob.size === 0) {
        throw new Error("This photo could not be processed.");
      }
      if (blob.size < MAX_BYTES) return blob;
    }
    throw new Error("This photo is still too large. Please choose a smaller photo.");
  } finally {
    decoded.release();
    canvas.width = 0;
    canvas.height = 0;
  }
}

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
      blob = await preparePhoto(file);
    } catch {
      result.failedCount++;
      result.errors.push(`Photo ${index + 1}: Could not process this image. Choose a smaller supported photo and try again.`);
      continue;
    }
    try {
      const prefix = ownerType === "product" ? "products" : "requests";
      const path = `${prefix}/${ownerId.toLowerCase()}/${crypto.randomUUID()}.jpg`;
      const { error } = await client.storage.from("inventory-images").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      result.files.push({ path, contentType: "image/jpeg", sizeBytes: blob.size });
    } catch {
      result.failedCount++;
      result.errors.push(`Photo ${index + 1}: Upload failed. Please try this photo again.`);
    }
  }
  return result;
}
