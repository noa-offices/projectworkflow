import { MAX_INVENTORY_PHOTO_BYTES, INVENTORY_PHOTO_TYPES } from "./photo-limits";

type OutputType = "image/webp" | "image/jpeg";
type EncodePhoto = (width: number, height: number, type: OutputType, quality: number) => Promise<Blob | null>;
export type CompressedInventoryPhoto = { file: File; originalSize: number; sizeBytes: number };
const prepared = new WeakMap<File, CompressedInventoryPhoto>();
const qualities = [.82, .74, .66, .58, .50, .42];

/** Bounded quality/dimension search; encoder injection lets tests exercise the real loop. */
export async function fitInventoryPhoto(width: number, height: number, encode: EncodePhoto): Promise<Blob> {
 if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("This photo has invalid dimensions.");
 const initialScale = Math.min(1, 2000 / Math.max(width, height));
 let type: OutputType = "image/webp";
 for (let reduction = 0; reduction <= 5; reduction++) {
  const scale = initialScale * Math.pow(.8, reduction);
  const targetWidth = Math.max(1, Math.round(width * scale)), targetHeight = Math.max(1, Math.round(height * scale));
  for (const quality of qualities) {
   let blob: Blob | null;
   try {blob = await encode(targetWidth,targetHeight,type,quality);}
   catch(error) {if(type!=="image/webp") throw error;blob=null;}
   // Unsupported canvas encoders return PNG (or null). Never upload that fallback.
   if (type === "image/webp" && (!blob || blob.type !== type || !blob.size)) {
    type = "image/jpeg"; blob = await encode(targetWidth, targetHeight, type, quality);
   }
   if (!blob || blob.type !== type || !blob.size) throw new Error("This photo could not be processed in this browser. Choose another JPEG, PNG or WebP photo.");
   if (blob.size <= MAX_INVENTORY_PHOTO_BYTES) return blob;
  }
 }
 throw new Error("This photo cannot fit within 2 MB. Choose a smaller photo and try again.");
}

async function decodePhoto(file: File): Promise<{source: CanvasImageSource; width: number; height: number; release: () => void}> {
 if (typeof createImageBitmap === "function") {
  try {
   // Browser applies phone EXIF orientation before exposing the decoded dimensions.
   const bitmap = await createImageBitmap(file, {imageOrientation: "from-image"});
   return {source:bitmap,width:bitmap.width,height:bitmap.height,release:()=>bitmap.close()};
  } catch { /* Image supports some formats that createImageBitmap cannot decode. */ }
 }
 const url = URL.createObjectURL(file);
 try {
  const image = new Image();
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("This photo could not be opened. Choose another JPEG, PNG or WebP photo."));image.src=url;});
  // Modern HTMLImageElement decoding also applies EXIF orientation automatically.
  return {source:image,width:image.naturalWidth,height:image.naturalHeight,release:()=>URL.revokeObjectURL(url)};
 } catch(error) {URL.revokeObjectURL(url);throw error;}
}

/** Run when picked. The prepared File is reused by upload without a second lossy encode. */
export async function compressInventoryPhoto(file: File): Promise<CompressedInventoryPhoto> {
 if (typeof window === "undefined" || typeof document === "undefined") throw new Error("Photo compression needs a browser.");
 if (!(file instanceof File) || !(INVENTORY_PHOTO_TYPES as readonly string[]).includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
 if (!file.size) throw new Error("This photo is empty. Choose another photo.");
 const existing = prepared.get(file); if (existing) return existing;
 const decoded = await decodePhoto(file);
 let canvas: HTMLCanvasElement | undefined;
 try {
  canvas = document.createElement("canvas");
  const target = canvas, context = target.getContext("2d");
  if (!context) throw new Error("Photo processing is unavailable in this browser.");
  const blob = await fitInventoryPhoto(decoded.width, decoded.height, async(width,height,type,quality)=>{
   target.width=width; target.height=height;
   if(type==="image/jpeg") {context.fillStyle="#ffffff";context.fillRect(0,0,width,height);}
   context.drawImage(decoded.source,0,0,width,height);
   return new Promise<Blob|null>(resolve=>target.toBlob(resolve,type,quality));
  });
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  const output = new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "photo"}.${extension}`, {type:blob.type,lastModified:file.lastModified});
  const result = {file:output,originalSize:file.size,sizeBytes:output.size};
  prepared.set(output,result); return result;
 } finally {decoded.release();if(canvas) {canvas.width=0;canvas.height=0;}}
}

function sizeLabel(bytes: number): string { return bytes >= 1024*1024 ? `${(bytes/(1024*1024)).toFixed(1)} MB` : `${Math.max(1,Math.round(bytes/1024))} KB`; }
export function photoSizeLabel(original: number, compressed: number): string { return `Original ${sizeLabel(original)} -> ${sizeLabel(compressed)}`; }
