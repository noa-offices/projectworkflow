/**
 * My Collection custom item pictures. PURE: no React, no database, no storage calls, no canvas, no sharp.
 * Private bucket "my-collection-images". Path: {owner_id}/{item_id}/{timestamp}-{safe-name}.
 * The first folder MUST be the owner's user id (storage policies and saved_custom_items.image_check require it).
 * Paths are always built on the server from the SESSION user id; a path sent by a client is only ever CHECKED, never trusted.
 *
 * Stored pictures (PR 2b-3b): always image/webp, <= 2 MB, long side <= 1600 px. The user may pick png/jpeg/webp up to 10 MB;
 * the BROWSER compresses it first (see lib/images/compress-custom-item-image.ts) and posts only the small WebP.
 * The planning below (resize plan, quality ladder, messages) is shared by the browser code and the server (sharp) code.
 * Old stored png/jpeg pictures (up to 5 MB, from PR 2b-3) are never migrated and keep working.
 */
import type { CustomItemListItem } from "./custom-item";

export const CUSTOM_IMAGE_BUCKET = "my-collection-images";
export const QUOTE_IMAGE_BUCKET = "quote-images";
export const MAX_STORED_BYTES = 2 * 1024 * 1024;
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const LEGACY_MAX_BYTES = 5 * 1024 * 1024; // pictures stored before PR 2b-3b (png/jpeg/webp up to 5 MB)
export const MAX_LONG_SIDE = 1600;
export const WEBP_QUALITY_LADDER = [85, 80, 75, 70, 60] as const;
export const REDUCED_LONG_SIDES = [1400, 1200, 1000] as const;
export const CUSTOM_IMAGE_PATH_MAX = 300;
export const CUSTOM_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const STORED_IMAGE_TYPE = "image/webp";

/** A custom item as listed, plus its optional picture path (only present when the item has a picture). */
export type CustomItemWithImage = CustomItemListItem & { imagePath?: string | null };

// ── Messages: ONE map, error kind -> plain-English text. Never a path, an id, a stack trace or raw storage JSON. ──
export type ImageErrorKind =
  | "wrong_type"
  | "too_large"
  | "unreadable"
  | "too_detailed"
  | "upload_failed"
  | "not_allowed"
  | "server_rejected"
  | "copy_from_row_failed"
  | "copy_to_quote_failed"
  | "unknown";

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
// The detail is a SHORT reason from a closed list (see IMAGE_REASONS), never a raw error.
export const IMAGE_MESSAGES: Record<ImageErrorKind, (detail?: string | number) => string> = {
  wrong_type: () => "This file type is not supported. Please choose a PNG, JPG or WebP picture.",
  too_large: (bytes) => `This picture is too large (${megabytes(Number(bytes) || 0)}). Please choose one under 10 MB.`,
  unreadable: () => "This picture could not be opened. It may be damaged. Please try another one.",
  too_detailed: () => "This picture is too detailed to shrink under 2 MB. Please choose a smaller or simpler picture.",
  upload_failed: () => "The picture could not be uploaded. Check your connection and try again.",
  not_allowed: () => "You are not allowed to upload here. Please sign in again.",
  server_rejected: (reason) => `The picture was rejected by the server (reason: ${reasonText(reason)}). Please choose another one.`,
  copy_from_row_failed: (reason) => `The row's picture could not be copied (reason: ${reasonText(reason)}). You can save without it, or choose another picture.`,
  copy_to_quote_failed: (reason) => `The picture could not be copied, so the row was added without it.${reason ? ` (Reason: ${reasonText(reason)}.)` : ""}`,
  unknown: () => "Something went wrong with this picture. Please try again.",
};

/** The only short reasons that can appear inside a message. Anything else becomes "unexpected error". */
export const IMAGE_REASONS = {
  not_webp: "not a WebP picture",
  invalid_webp: "not a valid WebP file",
  over_limit: "over 2 MB",
  empty: "empty file",
  bad_name: "unusable file name",
  too_big_to_read: "picture too large to process",
  unreadable: "damaged or unreadable picture",
  too_detailed: "too detailed to shrink under 2 MB",
  not_found: "picture not found",
  storage: "storage error",
  not_allowed: "not allowed",
  not_copyable: "this picture cannot be copied",
} as const;
export type ImageReason = keyof typeof IMAGE_REASONS;

function reasonText(reason: unknown): string {
  return typeof reason === "string" && reason in IMAGE_REASONS ? IMAGE_REASONS[reason as ImageReason] : "unexpected error";
}

export function imageMessage(kind: ImageErrorKind, detail?: string | number): string {
  return IMAGE_MESSAGES[kind](detail);
}

/** A storage/auth error from Supabase -> a kind. Permission problems are told apart from connection problems. */
export function classifyStorageError(error: unknown): "not_allowed" | "upload_failed" {
  const e = (error ?? {}) as { status?: unknown; statusCode?: unknown; message?: unknown };
  const code = String(e.statusCode ?? e.status ?? "");
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "401" || code === "403" || /policy|not allowed|unauthori[sz]ed|jwt|permission|forbidden/i.test(message)) return "not_allowed";
  return "upload_failed";
}

const EXTENSION_FOR_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeSegment(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && SEGMENT.test(value) && value !== "." && value !== ".." && !value.includes("..");
}

export type ImageValidation =
  | { ok: true; extension: string; fileName: string }
  | { ok: false; kind: ImageErrorKind; reason?: ImageReason; error: string };

function nameProblem(name: unknown): boolean {
  return typeof name !== "string" || !name.trim() || name.length > 200 || /[/\\\u0000-\u001f]/.test(name) || name.includes("..");
}

function reject(kind: ImageErrorKind, detail?: string | number): ImageValidation {
  return { ok: false, kind, error: imageMessage(kind, detail), ...(kind === "server_rejected" && typeof detail === "string" ? { reason: detail as ImageReason } : {}) };
}

/**
 * INPUT rules (what the user may pick): png/jpeg/webp up to 10 MB, a usable file name. This is checked in the browser
 * BEFORE compressing. Plain-English errors; nothing here touches storage.
 */
export function validateImageFile(type: unknown, size: unknown, name: unknown): ImageValidation {
  if (typeof type !== "string" || !(CUSTOM_IMAGE_TYPES as readonly string[]).includes(type)) return reject("wrong_type");
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return reject("unreadable");
  if (size > MAX_INPUT_BYTES) return reject("too_large", size);
  if (nameProblem(name)) return reject("server_rejected", "bad_name");
  const given = String(name).slice(String(name).lastIndexOf(".") + 1).toLowerCase();
  if (String(name).includes(".") && !ALLOWED_EXTENSIONS.has(given)) return reject("wrong_type");
  return { ok: true, extension: EXTENSION_FOR_TYPE[type], fileName: safeFileName(name, type) };
}

/** "RIFF" + 4 size bytes + "WEBP": a renamed png or jpeg does not pass. */
export function isWebpBytes(bytes: ArrayLike<number> | null | undefined): boolean {
  if (!bytes || bytes.length < 12) return false;
  const ascii = (from: number, text: string) => [...text].every((char, index) => bytes[from + index] === char.charCodeAt(0));
  return ascii(0, "RIFF") && ascii(8, "WEBP");
}

/** STORED rules (what the server accepts from a request): image/webp, 1 byte to 2 MB, real WebP bytes, a usable name. */
export function validateStoredWebp(type: unknown, size: unknown, name: unknown, bytes?: ArrayLike<number>): ImageValidation {
  if (type !== STORED_IMAGE_TYPE) return reject("server_rejected", "not_webp");
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return reject("server_rejected", "empty");
  if (size > MAX_STORED_BYTES) return reject("server_rejected", "over_limit");
  if (nameProblem(name)) return reject("server_rejected", "bad_name");
  if (bytes && !isWebpBytes(bytes)) return reject("server_rejected", "invalid_webp");
  return { ok: true, extension: "webp", fileName: safeFileName(name, STORED_IMAGE_TYPE) };
}

/** A picture already in storage that may be copied into a quote row: WebP up to 2 MB, or an OLD png/jpeg/webp up to 5 MB. */
export function validateCopyableStored(type: unknown, size: unknown): boolean {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return false;
  if (type === STORED_IMAGE_TYPE) return size <= LEGACY_MAX_BYTES; // old webp pictures were allowed up to 5 MB
  return (type === "image/png" || type === "image/jpeg") && size <= LEGACY_MAX_BYTES;
}

// ── Resize plan and quality ladder (shared by the browser canvas code and the server sharp code) ────────────────
/** Keeps the aspect ratio, caps the long side, never enlarges. Always at least 1 px. */
export function planResize(width: number, height: number, maxLongSide: number = MAX_LONG_SIDE): { width: number; height: number } {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const long = Math.max(w, h);
  if (long <= maxLongSide) return { width: w, height: h };
  const scale = maxLongSide / long;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export type LadderStep = { quality: number; width: number; height: number };

/** 85, 80, 75, 70, 60 at the full planned size, then 1400, 1200, 1000 px (never larger than the picture) at quality 60. */
export function compressionLadder(width: number, height: number): LadderStep[] {
  const full = planResize(width, height, MAX_LONG_SIDE);
  const steps: LadderStep[] = WEBP_QUALITY_LADDER.map((quality) => ({ quality, ...full }));
  const lowest = WEBP_QUALITY_LADDER[WEBP_QUALITY_LADDER.length - 1];
  for (const side of REDUCED_LONG_SIDES) {
    const smaller = planResize(width, height, side);
    if (smaller.width < steps[steps.length - 1].width || smaller.height < steps[steps.length - 1].height) steps.push({ quality: lowest, ...smaller });
  }
  return steps;
}

/** Tries the steps in order; returns the FIRST one whose encoded size is <= the limit, or null when none fits. */
export async function firstFittingStep<T>(
  steps: readonly LadderStep[],
  encode: (step: LadderStep) => Promise<{ size: number; value: T }>,
  limit: number = MAX_STORED_BYTES,
): Promise<{ step: LadderStep; size: number; value: T } | null> {
  for (const step of steps) {
    const encoded = await encode(step);
    if (encoded.size > 0 && encoded.size <= limit) return { step, size: encoded.size, value: encoded.value };
  }
  return null;
}

/** "240 KB" / "1.2 MB" for the "Saved as ..." line. */
export function formatImageSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
