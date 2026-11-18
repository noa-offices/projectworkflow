/**
 * My Collection sharing (PR 4-2): PURE helpers. No React, no database, no storage, no network.
 * Types, input validation (reusing the custom item validators and brand resolution), the paths of shared pictures,
 * and ONE map of short, plain-English failure messages. A database error is never shown to the user: it is mapped to
 * one of these messages (mapShareError) and the technical detail stays in the server log (without payloads or prices).
 */
import { resolveBrandInput, type BrandCount } from "./custom-brands";
import { firstCustomItemError, formatCustomItemPrice, validateCustomItem, type CleanCustomItem, type CustomItemFieldErrors, type CustomItemInput } from "./custom-item";
import { SAVED_SETUP_NAME_MAX, isUuid } from "./recipe";

export const SHARE_NOTE_MAX = 200;
export const SHARE_SETUP_NOTE_MAX = 500;
export const SHARE_TARGET_QUERY_MIN = 2;
export const SHARE_TARGET_QUERY_MAX = 60;
export const SHARE_LIST_LIMIT = 100;

export type ShareKind = "setup" | "custom_item";
export type ShareStatus = "pending" | "accepted" | "dismissed" | "unsent";
export const SHARE_KINDS: readonly ShareKind[] = ["setup", "custom_item"];
const SHARE_STATUSES: readonly ShareStatus[] = ["pending", "accepted", "dismissed", "unsent"];

// ── Messages: ONE map. Never a path, an id, a price, a stack trace or raw database text. ─────────────────────────
export type ShareMessageKind =
  | "not_allowed"
  | "invalid_request"
  | "self"
  | "cannot_receive"
  | "too_many"
  | "item_not_found"
  | "setup_has_prices"
  | "product_unavailable_recipient"
  | "product_unavailable_you"
  | "share_not_found"
  | "no_longer_available"
  | "already_pending"
  | "note_too_long"
  | "picture_invalid"
  | "picture_unavailable"
  | "picture_unreadable"
  | "picture_too_detailed"
  | "picture_upload_failed"
  | "picture_not_included"
  | "unknown";

export const SHARE_MESSAGES: Record<ShareMessageKind, string> = {
  not_allowed: "You are not allowed to do this. Please sign in again.",
  invalid_request: "Something is missing or not valid. Please check it and try again.",
  self: "You cannot share with yourself.",
  cannot_receive: "This user cannot receive shares.",
  too_many: "Too many shares are waiting. Try again later.",
  item_not_found: "This item was not found.",
  setup_has_prices: "A setup with prices cannot be shared.",
  product_unavailable_recipient: "This product is not available to the recipient.",
  product_unavailable_you: "This product is not available to you.",
  share_not_found: "This share was not found.",
  no_longer_available: "This share is no longer available.",
  already_pending: "You already sent this item to that person and it is still waiting.",
  note_too_long: `The note can have at most ${SHARE_NOTE_MAX} characters.`,
  picture_invalid: "The picture is not valid. Choose another one or remove it.",
  picture_unavailable: "The picture could not be read.",
  picture_unreadable: "The picture could not be opened. It may be damaged.",
  picture_too_detailed: "The picture is too detailed to shrink under 2 MB.",
  picture_upload_failed: "The picture could not be uploaded.",
  picture_not_included: "The sender's picture could not be included.",
  unknown: "Something went wrong. Please try again.",
};

export function shareMessage(kind: ShareMessageKind): string {
  return SHARE_MESSAGES[kind];
}

/**
 * A database / RPC error -> a message kind. The functions raise fixed sentences (see 20261119100000_my_collection_shares.sql);
 * constraint and permission errors are recognised by their SQLSTATE code. Anything else is "unknown".
 */
export function mapShareError(error: unknown): ShareMessageKind {
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  const code = typeof e.code === "string" ? e.code : "";
  if (message.includes("not available to the recipient")) return "product_unavailable_recipient";
  if (message.includes("not available to you")) return "product_unavailable_you";
  if (message.includes("too many shares are waiting")) return "too_many";
  if (message.includes("cannot receive shares")) return "cannot_receive";
  if (message.includes("cannot share with yourself")) return "self";
  if (message.includes("no longer available")) return "no_longer_available";
  if (message.includes("share not found")) return "share_not_found";
  if (message.includes("item not found")) return "item_not_found";
  if (message.includes("setup with prices")) return "setup_has_prices";
  if (message.includes("note is too long")) return "note_too_long";
  if (message.includes("invalid picture")) return "picture_invalid";
  if (message.includes("unknown item type")) return "invalid_request";
  if (message === "not allowed." || code === "42501") return "not_allowed";
  if (code === "23505") return "already_pending";
  if (code === "23514" || code === "22001" || code === "22P02" || code === "22003") return "invalid_request";
  return "unknown";
}

// ── Input validation ─────────────────────────────────────────────────────────────────────────────────────────────
export type NoteValidation = { ok: true; note: string | null } | { ok: false; kind: "note_too_long" | "invalid_request" };

/** The optional note of a share: trimmed, at most 200 characters; empty means no note. Shown as plain text only. */
export function validateShareNote(value: unknown): NoteValidation {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string") return { ok: false, kind: "invalid_request" };
  const note = value.trim();
  if (note.length > SHARE_NOTE_MAX) return { ok: false, kind: "note_too_long" };
  return { ok: true, note: note || null };
}

export type SendShareInput = { kind: ShareKind; itemId: string; recipientId: string; note: string | null };
export type SendValidation = { ok: true; value: SendShareInput } | { ok: false; kind: ShareMessageKind };

export function validateSendInput(input: { kind?: unknown; itemId?: unknown; recipientId?: unknown; note?: unknown } | null | undefined): SendValidation {
  if (!input || !SHARE_KINDS.includes(input.kind as ShareKind)) return { ok: false, kind: "invalid_request" };
  if (!isUuid(input.itemId)) return { ok: false, kind: "item_not_found" };
  if (!isUuid(input.recipientId)) return { ok: false, kind: "cannot_receive" };
  const note = validateShareNote(input.note);
  if (!note.ok) return { ok: false, kind: note.kind };
  return { ok: true, value: { kind: input.kind as ShareKind, itemId: input.itemId, recipientId: input.recipientId, note: note.note } };
}

export type AcceptCustomValidation =
  | { ok: true; value: CleanCustomItem }
  | { ok: false; error: string; fieldErrors: CustomItemFieldErrors };

/**
 * The recipient's edits of a shared custom item: the SAME validators and limits as the My Collection form
 * (brand <= 80, name <= 120, code <= 60, specification <= 4000, unit <= 20, price >= 0 with 2 decimals, AED/EUR/USD),
 * and a brand that matches one of the recipient's own brands (ignoring case and spaces) uses that spelling.
 */
export function validateAcceptCustomItem(input: CustomItemInput | null | undefined, existingBrands: ReadonlyArray<BrandCount | string>): AcceptCustomValidation {
  const checked = validateCustomItem(input);
  if (!checked.ok) return { ok: false, error: firstCustomItemError(checked.errors), fieldErrors: checked.errors };
  const brand = resolveBrandInput(checked.value.brand_name, existingBrands);
  if (!brand.ok) return { ok: false, error: brand.error, fieldErrors: { brandName: brand.error } };
  return { ok: true, value: { ...checked.value, brand_name: brand.name } };
}

export type AcceptSetupValidation = { ok: true; setupName: string; note: string | null } | { ok: false; error: string };

/** The recipient may only edit the setup name (1..120) and note (<= 500). Brand and product come from the product. */
export function validateAcceptSetup(input: { setupName?: unknown; note?: unknown } | null | undefined): AcceptSetupValidation {
  const name = typeof input?.setupName === "string" ? input.setupName.trim() : "";
  if (name.length < 1 || name.length > SAVED_SETUP_NAME_MAX) return { ok: false, error: `Give the setup a name (1 to ${SAVED_SETUP_NAME_MAX} characters).` };
  if (input?.note !== undefined && input.note !== null && typeof input.note !== "string") return { ok: false, error: SHARE_MESSAGES.invalid_request };
  const note = typeof input?.note === "string" ? input.note.trim() : "";
  if (note.length > SHARE_SETUP_NOTE_MAX) return { ok: false, error: `The note can have at most ${SHARE_SETUP_NOTE_MAX} characters.` };
  return { ok: true, setupName: name, note: note || null };
}

export type PictureMode = "keep" | "remove" | "replace";
/** Missing means "keep"; anything else that is not one of the three modes is refused. */
export function parsePictureMode(value: unknown): PictureMode | null {
  if (value === undefined || value === null || value === "") return "keep";
  return value === "keep" || value === "remove" || value === "replace" ? value : null;
}

// ── Picture paths (always built here from ids; a client path is only ever compared with these) ───────────────────
/** {recipient}/incoming/{share}/picture.webp: the ONE file the sender may write while the share is pending. */
export function buildIncomingPicturePath(recipientId: string, shareId: string): string {
  if (!isUuid(recipientId) || !isUuid(shareId)) throw new Error("Invalid share path.");
  return `${recipientId}/incoming/${shareId}/picture.webp`;
}

export function isIncomingPicturePath(path: unknown, recipientId?: string, shareId?: string): path is string {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  if (parts.length !== 4 || parts[1] !== "incoming" || parts[3] !== "picture.webp") return false;
  if (!isUuid(parts[0]) || !isUuid(parts[2])) return false;
  return (recipientId === undefined || parts[0] === recipientId.toLowerCase() || parts[0] === recipientId) && (shareId === undefined || parts[2] === shareId.toLowerCase() || parts[2] === shareId);
}

/** {recipient}/{share}/{timestamp}-picture.webp: the recipient's own copy (same 3-segment shape as every own picture). */
export function buildAcceptedPicturePath(recipientId: string, shareId: string, now: Date | number): string {
  if (!isUuid(recipientId) || !isUuid(shareId)) throw new Error("Invalid share path.");
  return `${recipientId}/${shareId}/${now instanceof Date ? now.getTime() : now}-picture.webp`;
}

// ── Rows and the shapes sent to the browser ──────────────────────────────────────────────────────────────────────
export const SHARE_SELECT_INCOMING = "id,kind,sender_id,recipient_id,sender_name,item_name,note,payload,picture_path,picture_note,status,created_at,responded_at,result_item_id";
export const SHARE_SELECT_SENT = "id,kind,recipient_id,recipient_name,item_name,note,picture_path,picture_note,status,created_at,responded_at,result_item_id";

export type ShareRow = {
  id: string;
  kind: string;
  sender_id?: string;
  recipient_id: string;
  sender_name?: string;
  recipient_name?: string | null;
  item_name: string;
  note: string | null;
  payload?: unknown;
  picture_path: string | null;
  picture_note: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
  result_item_id: string | null;
};

export type CustomShareItem = {
  kind: "custom_item";
  brandName: string;
  itemName: string;
  itemCode: string | null;
  specification: string | null;
  unitLabel: string;
  sellingPrice: number;
  currency: string;
};
export type SetupShareItem = { kind: "setup"; setupName: string; note: string | null; brandName: string; productName: string };

/** What the recipient sees. The recipe and spec overrides of a setup are NEVER sent to the browser. */
export type IncomingShare = {
  id: string;
  kind: ShareKind;
  senderName: string;
  itemName: string;
  note: string | null;
  status: ShareStatus;
  createdAt: string;
  respondedAt: string | null;
  resultItemId: string | null;
  picturePath: string | null;
  pictureNote: string | null;
  item: CustomShareItem | SetupShareItem;
};

export type SentShare = {
  id: string;
  kind: ShareKind;
  recipientId: string;
  /** The recipient's display name saved on the share. Older shares have none: shown as "Colleague" (recipientDisplayName). */
  recipientName: string | null;
  itemName: string;
  note: string | null;
  status: ShareStatus;
  createdAt: string;
  respondedAt: string | null;
  hasPicture: boolean;
  pictureNote: string | null;
};

export type ShareTarget = { id: string; displayName: string };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function optStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function statusOf(value: unknown): ShareStatus | null {
  return SHARE_STATUSES.includes(value as ShareStatus) ? (value as ShareStatus) : null;
}
function kindOf(value: unknown): ShareKind | null {
  return SHARE_KINDS.includes(value as ShareKind) ? (value as ShareKind) : null;
}

/** A row the recipient may see -> the safe shape, or null when the row is malformed. */
export function toIncomingShare(row: ShareRow | null | undefined): IncomingShare | null {
  const kind = kindOf(row?.kind);
  const status = statusOf(row?.status);
  if (!row || !kind || !status) return null;
  const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
  const item: CustomShareItem | SetupShareItem = kind === "custom_item"
    ? {
        kind,
        brandName: str(payload.brand_name),
        itemName: str(payload.item_name) || row.item_name,
        itemCode: optStr(payload.item_code),
        specification: optStr(payload.specification),
        unitLabel: str(payload.unit_label) || "Pc",
        sellingPrice: Number(payload.selling_price) || 0,
        currency: str(payload.currency),
      }
    : { kind, setupName: str(payload.setup_name) || row.item_name, note: optStr(payload.note), brandName: str(payload.brand_name), productName: str(payload.product_name) };
  return {
    id: row.id,
    kind,
    senderName: row.sender_name ?? "",
    itemName: row.item_name,
    note: row.note,
    status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    resultItemId: row.result_item_id,
    picturePath: row.picture_path,
    pictureNote: row.picture_note,
    item,
  };
}

export function toSentShare(row: ShareRow | null | undefined): SentShare | null {
  const kind = kindOf(row?.kind);
  const status = statusOf(row?.status);
  if (!row || !kind || !status) return null;
  return {
    id: row.id,
    kind,
    recipientId: row.recipient_id,
    recipientName: optStr(row.recipient_name),
    itemName: row.item_name,
    note: row.note,
    status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    hasPicture: Boolean(row.picture_path),
    pictureNote: row.picture_note,
  };
}

/**
 * What the browser gets for a received share: the same as IncomingShare, but the storage path is replaced by hasPicture and a
 * short-lived signed link (pictureUrl, at most 10 minutes). The path itself never leaves the server.
 */
export type IncomingShareView = Omit<IncomingShare, "picturePath"> & { hasPicture: boolean; pictureUrl: string | null };
export const SHARE_PICTURE_URL_SECONDS = 600;

// ── Small display helpers for the My Collection page (pure, so they are tested without a browser) ────────────────
export type CollectionTab = "configured" | "custom" | "shared" | "sent";
export const COLLECTION_TABS: readonly CollectionTab[] = ["configured", "custom", "shared", "sent"];

/** ?tab= from the address: one of the four tabs, anything else (or missing, or repeated) is "configured". */
export function parseCollectionTab(value: unknown): CollectionTab {
  const text = Array.isArray(value) ? value[0] : value;
  return COLLECTION_TABS.includes(text as CollectionTab) ? (text as CollectionTab) : "configured";
}

/** "Shared with you (3)"; the tab is hidden when nothing is waiting. */
export function sharedTabLabel(pending: number): string {
  return pending > 0 ? `Shared with you (${pending})` : "Shared with you";
}

export const RECIPIENT_FALLBACK_NAME = "Colleague";
export function recipientDisplayName(name: string | null | undefined): string {
  return typeof name === "string" && name.trim() ? name.trim() : RECIPIENT_FALLBACK_NAME;
}

/** Status chip text of the Sent list. */
export function sentStatusLabel(status: ShareStatus): string {
  return status === "pending" ? "Waiting" : status === "accepted" ? "Added" : status === "dismissed" ? "Dismissed" : "Withdrawn";
}

/** Only a share that is still waiting can be taken back. */
export function canUnsend(status: ShareStatus): boolean {
  return status === "pending";
}

/** The line shown in the send panel. Custom items share their price and picture; setups never carry a price. */
export function sharePriceNotice(kind: ShareKind, item?: { currency: string; sellingPrice: number } | null): string {
  if (kind === "setup") return "Prices are not shared \u2014 they will see current prices.";
  const price = item ? ` (${formatCustomItemPrice(item.currency, item.sellingPrice)})` : "";
  return `This will share the price${price} and the picture with them.`;
}

/**
 * Notification links: a link into My Collection shows "My Collection" instead of the raw path. Every other value is returned
 * unchanged, so the labels of inventory and other notifications stay exactly as they are.
 */
export function notificationLinkLabel(orderNo: string | null | undefined): string {
  const text = (orderNo ?? "").trim();
  return text === "/products/my-collection" || text.startsWith("/products/my-collection?") || text.startsWith("/products/my-collection/") ? "My Collection" : (orderNo ?? "");
}

/** The My Collection page and popup announce a new pending count so the sidebar badge updates without a reload. */
export const PENDING_SHARES_EVENT = "my-collection-pending-shares";
