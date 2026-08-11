import { compressedImageDimensions } from "./product-template-row-references";

export function clipboardImageFile(files: Iterable<File>) { return Array.from(files).find((file) => file.type.startsWith("image/")) ?? null; }

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
  const isWebp = blob.type === "image/webp";
  return new File([blob], `row-reference.${isWebp ? "webp" : "png"}`, { type: blob.type || (isWebp ? "image/webp" : "image/png") });
}
