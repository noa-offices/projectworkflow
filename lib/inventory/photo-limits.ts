/** Shared browser/server policy. Existing stored photos are not revalidated. */
export const MAX_INVENTORY_PHOTO_BYTES = 2 * 1024 * 1024;
export const INVENTORY_PHOTO_TYPES = ["image/webp", "image/jpeg", "image/png"] as const;
export type InventoryPhotoType = typeof INVENTORY_PHOTO_TYPES[number];
export function inventoryPhotoError(size: unknown, type: unknown): string | null {
 if (typeof type !== "string" || !(INVENTORY_PHOTO_TYPES as readonly string[]).includes(type)) return "Choose a JPEG, PNG or WebP photo.";
 if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) return "This photo is empty or has an invalid size.";
 if (size > MAX_INVENTORY_PHOTO_BYTES) return "Each photo must be 2 MB or smaller. Choose a smaller photo and try again.";
 return null;
}

/** Inspect stored bytes, since an upload's declared MIME type is not proof of its format. */
export function inventoryPhotoContentType(header: Uint8Array): InventoryPhotoType | null {
 if(header.length>=3 && header[0]===255 && header[1]===216 && header[2]===255) return "image/jpeg";
 if([137,80,78,71,13,10,26,10].every((byte,index)=>header[index]===byte)) return "image/png";
 if(header.length>=12 && [82,73,70,70].every((byte,index)=>header[index]===byte) && [87,69,66,80].every((byte,index)=>header[index+8]===byte)) return "image/webp";
 return null;
}
