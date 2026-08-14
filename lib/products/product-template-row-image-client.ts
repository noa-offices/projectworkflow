import { compressedImageDimensions } from "./product-template-row-references";

export const MAX_STAGED_PRODUCT_IMAGE_BYTES = 1 * 1024 * 1024;

export function formatProductImageSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MAX_STAGED_PRODUCT_IMAGE_BYTES) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MAX_STAGED_PRODUCT_IMAGE_BYTES).toFixed(1)} MB`;
}

export function assertCompressedProductImageSize(bytes: number) {
  if (bytes > MAX_STAGED_PRODUCT_IMAGE_BYTES) throw new Error("Image is still larger than 1 MB after compression. Please use a smaller image.");
}

export function clipboardImageFile(files: Iterable<File>) { return Array.from(files).find((file) => file.type.startsWith("image/")) ?? null; }

export function clipboardImageFileFromClipboard(data: Pick<DataTransfer, "items" | "files">) {
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file?.type.startsWith("image/")) return file;
  }
  return clipboardImageFile(data.files);
}

export async function compressedClipboardImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Clipboard does not contain an image.");
  const bitmap = await createImageBitmap(file);
  const size = compressedImageDimensions(bitmap.width, bitmap.height, 500);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("Image could not be processed."); }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.6));
  const blob = webp ?? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Image could not be processed.");
  assertCompressedProductImageSize(blob.size);
  const isWebp = blob.type === "image/webp";
  return new File([blob], `row-reference.${isWebp ? "webp" : "png"}`, { type: blob.type || (isWebp ? "image/webp" : "image/png") });
}
