/**
 * My Collection custom item pictures (PR 2b-3). PURE: no React, no database, no storage calls.
 * Private bucket "my-collection-images", 5 MB, png/jpeg/webp. Path: {owner_id}/{item_id}/{timestamp}-{safe-name}.
 * The first folder MUST be the owner's user id (storage policies and saved_custom_items.image_check require it).
 * Paths are always built on the server from the SESSION user id; a path sent by a client is only ever CHECKED, never trusted.
 */
import type { CustomItemListItem } from "./custom-item";

export const CUSTOM_IMAGE_BUCKET = "my-collection-images";
export const QUOTE_IMAGE_BUCKET = "quote-images";
export const CUSTOM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOM_IMAGE_PATH_MAX = 300;
export const CUSTOM_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** A custom item as listed, plus its optional picture path (only present when the item has a picture). */
export type CustomItemWithImage = CustomItemListItem & { imagePath?: string | null };

const EXTENSION_FOR_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeSegment(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && SEGMENT.test(value) && value !== "." && value !== ".." && !value.includes("..");
}

export type ImageValidation = { ok: true; extension: string; fileName: string } | { ok: false; error: string };

/** Type, size and file-name checks. Plain-English errors; nothing here touches storage. */
export function validateImageFile(type: unknown, size: unknown, name: unknown): ImageValidation {
  if (typeof type !== "string" || !(CUSTOM_IMAGE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: "Only PNG, JPG and WebP pictures can be added." };
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return { ok: false, error: "The picture file is empty." };
  if (size > CUSTOM_IMAGE_MAX_BYTES) return { ok: false, error: "The picture must be 5 MB or smaller." };
  if (typeof name !== "string" || !name.trim()) return { ok: false, error: "The picture needs a file name." };
  if (name.length > 200 || /[/\\\u0000-\u001f]/.test(name) || name.includes("..")) {
    return { ok: false, error: "The picture file name is not valid. Rename the file and try again." };
  }
  const dot = name.lastIndexOf(".");
  const given = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (given && !ALLOWED_EXTENSIONS.has(given)) return { ok: false, error: "The file name must end in .png, .jpg, .jpeg or .webp." };
  return { ok: true, extension: EXTENSION_FOR_TYPE[type], fileName: safeFileName(name, type) };
}

/** Lower-case letters, digits and dashes only (max 60), plus an extension taken from the TYPE (never from the name). */
export function safeFileName(name: unknown, type?: unknown): string {
  const text = typeof name === "string" ? name : "";
  const dot = text.lastIndexOf(".");
  const base = (dot > 0 ? text.slice(0, dot) : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const given = dot >= 0 ? text.slice(dot + 1).toLowerCase() : "";
  const extension = (typeof type === "string" && EXTENSION_FOR_TYPE[type]) || (given === "jpeg" ? "jpg" : ALLOWED_EXTENSIONS.has(given) ? given : "jpg");
  return `${base || "image"}.${extension}`;
}

/** {owner_id}/{item_id}/{timestamp}-{safe-name}. Throws on an unsafe owner or item id (a programming error, never user input). */
export function buildImagePath(ownerId: string, itemId: string, name: string, now: Date | number, type?: string): string {
  if (!UUID.test(ownerId)) throw new Error("Invalid owner id.");
  if (!safeSegment(itemId)) throw new Error("Invalid item id.");
  const stamp = now instanceof Date ? now.getTime() : now;
  return `${ownerId}/${itemId}/${stamp}-${safeFileName(name, type)}`;
}

/** True only for a well-formed path inside THIS owner's folder: {owner}/{item}/{file}, no traversal, <= 300 characters. */
export function isOwnImagePath(ownerId: unknown, path: unknown): path is string {
  if (typeof ownerId !== "string" || !UUID.test(ownerId)) return false;
  if (typeof path !== "string" || path.length === 0 || path.length > CUSTOM_IMAGE_PATH_MAX) return false;
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== ownerId) return false;
  return parts.every(safeSegment);
}

/**
 * A quote row picture reference ("quote-images:quotation-items/{quotation}/{row}/{file}") -> its storage path, or null.
 * Only quote-images paths made by the row picture upload are accepted.
 */
export function quoteImageStoragePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(`${QUOTE_IMAGE_BUCKET}:`)) return null;
  const path = value.slice(QUOTE_IMAGE_BUCKET.length + 1);
  if (path.length > CUSTOM_IMAGE_PATH_MAX * 2) return null;
  const parts = path.split("/");
  if (parts.length !== 4 || !["quotation-items", "quotation-specifications"].includes(parts[0])) return null;
  return parts.every(safeSegment) ? path : null;
}

/** Where a copied picture lives in quote-images: the existing row-picture convention, under the NEW row's own id. */
export function buildQuoteRowImagePath(quotationId: string, rowId: string, name: string, now: Date | number, type?: string): string {
  if (!UUID.test(quotationId)) throw new Error("Invalid quotation id.");
  if (!safeSegment(rowId)) throw new Error("Invalid row id.");
  const stamp = now instanceof Date ? now.getTime() : now;
  return `quotation-items/${quotationId}/${rowId}/${stamp}-${safeFileName(name, type)}`;
}

/** The row's own picture reference as saved in its image field ("bucket:path"). */
export function quoteRowImageRef(storagePath: string): string {
  return `${QUOTE_IMAGE_BUCKET}:${storagePath}`;
}

/** Content type for a stored file name (png/jpg/jpeg/webp), or null. */
export function imageTypeFromPath(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return null;
}

/** The last path segment without its "{timestamp}-" prefix, used as the name of a copied picture. */
export function imageNameFromPath(path: string): string {
  const last = path.split("/").pop() ?? "image";
  return last.replace(/^\d{10,}-/, "") || "image";
}

/** Keep only the paths that belong to this owner (for signing). Duplicates are dropped; order is kept. */
export function ownImagePaths(ownerId: unknown, paths: unknown, limit = 60): string[] {
  if (!Array.isArray(paths)) return [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (isOwnImagePath(ownerId, path)) seen.add(path);
    if (seen.size >= limit) break;
  }
  return Array.from(seen);
}
