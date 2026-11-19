/**
 * Product Gallery (server side, stage B). PURE: no React, no server-only, no database, never throws.
 * The gallery rows are written ONLY by a database trigger. The browser can read, search and (curators only) hide, rename, tag and merge.
 * Nothing here holds a price, a discount, a client name or a quote number: the gallery has none.
 */
import { isUuid, validateRecipeShape, type SavedSetupRecipeV1, type SavedSetupSpecOverrides } from "../saved-setups/recipe";

export const GALLERY_PAGE_SIZE = 30;
export const GALLERY_SEARCH_WORDS_MAX = 8;
export const GALLERY_WORD_MAX = 40;
export const GALLERY_DISPLAY_NAME_MAX = 120;
export const GALLERY_TAGS_MAX = 20;
export const GALLERY_TAG_MAX = 30;
export const GALLERY_FILTER_SCAN_MAX = 2000;
export const GALLERY_FILTER_LIST_MAX = 100;
export const GALLERY_FILTER_TAGS_MAX = 200;

export const GALLERY_SORT_MODES = ["popular", "newest", "name"] as const;
export type GallerySortMode = (typeof GALLERY_SORT_MODES)[number];

export function isGallerySortMode(value: unknown): value is GallerySortMode {
  return typeof value === "string" && (GALLERY_SORT_MODES as readonly string[]).includes(value);
}

/** popular = quoted_count desc then last_quoted_at desc (default); newest = last_quoted_at desc; name = the shown name asc. */
export function gallerySortMode(value: unknown): GallerySortMode {
  return isGallerySortMode(value) ? value : "popular";
}

// One place for friendly failure text. No ids, paths, database words or recipe content.
export const GALLERY_MESSAGES = {
  not_allowed: "You do not have permission to do that.",
  invalid_request: "That request was not valid. Please try again.",
  item_not_found: "That gallery item was not found. It may have been removed.",
  product_unavailable: "This product is no longer available.",
  recipe_unreadable: "This configuration could not be opened. Please configure the product from the Product Library instead.",
  load_failed: "The gallery could not be loaded. Please try again.",
  save_failed: "The change could not be saved. Please try again.",
  specification_too_long: "The specification can be at most 2000 characters.",
  update_not_found: "That update is no longer available.",
} as const;

export type GalleryMessageKind = keyof typeof GALLERY_MESSAGES;

export function galleryMessage(kind: GalleryMessageKind): string {
  return GALLERY_MESSAGES[kind];
}

export function isGalleryId(value: unknown): value is string {
  return isUuid(value);
}

/** Page numbers start at 1; anything unreadable is page 1; capped so a huge value cannot be requested. */
export function clampGalleryPage(value: unknown): number {
  const page = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.floor(page), 1), 10_000);
}

/**
 * The SAME rule as the database column search_text: lower-case, every run of characters that are not a-z or 0-9 becomes one
 * space, trimmed ("BD-1" -> "bd 1", "Buddy  Chair" -> "buddy chair").
 */
export function normaliseGalleryText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The words a search must ALL find: normalised, no duplicates, at most 8 words of at most 40 characters. */
export function galleryQueryWords(value: unknown): string[] {
  const words = normaliseGalleryText(value).split(" ").filter(Boolean).map((word) => word.slice(0, GALLERY_WORD_MAX));
  return Array.from(new Set(words)).slice(0, GALLERY_SEARCH_WORDS_MAX);
}

/**
 * The LIKE pattern for one word: "%" + the word + "%" with % _ and the escape character escaped so they only match themselves.
 * Written for a value inside double quotes in a PostgREST filter, where a backslash must be doubled. A normalised word has none of
 * these characters; the escape is kept so the rule never depends on the caller.
 */
export function galleryWordPattern(word: string): string {
  const escaped = word.replace(/\\/g, "").replace(/%/g, "\\\\%").replace(/_/g, "\\\\_");
  return `%${escaped}%`;
}

export function galleryDisplayName(item: { displayName: string | null | undefined; itemName: string }): string {
  const display = typeof item.displayName === "string" ? item.displayName.trim() : "";
  return display || item.itemName;
}

export type GalleryNameInput = { ok: true; value: string | null } | { ok: false };

/** 1-120 characters after trimming, or empty (= clear the name). */
export function validateGalleryDisplayName(value: unknown): GalleryNameInput {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  return text.length <= GALLERY_DISPLAY_NAME_MAX ? { ok: true, value: text } : { ok: false };
}

export const GALLERY_SPECIFICATION_MAX = 2000;
export type GallerySpecificationInput = { ok: true; value: string | null } | { ok: false; kind: "invalid_request" | "specification_too_long" };

/** Plain text, trimmed, line breaks kept. Empty (or missing) clears it. More than 2000 characters is refused (never cut silently). */
export function validateGallerySpecification(value: unknown): GallerySpecificationInput {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, kind: "invalid_request" };
  const text = value.split(String.fromCharCode(13)).join("").trim();
  if (!text) return { ok: true, value: null };
  return text.length <= GALLERY_SPECIFICATION_MAX ? { ok: true, value: text } : { ok: false, kind: "specification_too_long" };
}

export type GalleryTagsInput = { ok: true; value: string[] } | { ok: false };

/** At most 20 tags, each 1-30 characters after trimming, lower-cased, no duplicates (empty ones are dropped). */
export function validateGalleryTags(value: unknown): GalleryTagsInput {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false };
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return { ok: false };
    const tag = entry.trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > GALLERY_TAG_MAX) return { ok: false };
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.length <= GALLERY_TAGS_MAX ? { ok: true, value: tags } : { ok: false };
}

/** A tag typed in a filter or search box: trimmed, lower-cased, 1-30 characters, else null. */
export function cleanGalleryTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().toLowerCase();
  return tag && tag.length <= GALLERY_TAG_MAX ? tag : null;
}

// ── What the browser receives ──────────────────────────────────────────────
/** A product's own picture: the same path My Collection / client history give to SetupThumbnail. No price anywhere in this type. */
export type GalleryPicture = { kind: "template"; path: string } | null;

export type GalleryListItem = {
  id: string;
  templateId: string;
  displayName: string;
  itemName: string;
  itemCode: string;
  brandId: string | null;
  brandName: string;
  categoryId: string | null;
  categoryName: string;
  subCategoryName: string;
  /** The product's own currency (a label only; the gallery stores and shows no price). */
  currency: string;
  tags: string[];
  quotedCount: number;
  lastQuotedAt: string;
  isHidden: boolean;
  /** The product still exists and is active (the same rule as isSetupUsable). */
  available: boolean;
  /** Editors only (always false for everyone else): an open "specification" or "picture" update offer exists for this item. */
  updateAvailable: boolean;
  picture: GalleryPicture;
};

export const GALLERY_UPDATE_KINDS = ["specification", "picture", "configuration"] as const;
export type GalleryUpdateKind = (typeof GALLERY_UPDATE_KINDS)[number];
export function isGalleryUpdateKind(value: unknown): value is GalleryUpdateKind {
  return typeof value === "string" && (GALLERY_UPDATE_KINDS as readonly string[]).includes(value);
}
/** The two kinds an editor can Update or Ignore as an offer (a "configuration" notice can only be ignored). */
export function isGalleryOfferKind(value: unknown): value is "specification" | "picture" {
  return value === "specification" || value === "picture";
}
/** The key of a removed configuration: g:<template uuid>:<64 hex characters>. */
export function isGalleryIdentityKey(value: unknown): value is string {
  return typeof value === "string" && /^g:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}$/i.test(value);
}
export const GALLERY_FINGERPRINT_MAX = 200;
/** A short note (max 200 characters) the app writes when an editor ignores the "saved choices changed" notice. */
export function cleanGalleryFingerprint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= GALLERY_FINGERPRINT_MAX && /^[a-z0-9:_.-]+$/i.test(text) ? text : null;
}

/** One removed configuration (editors only). hasSnapshot false = an older removal: Restore only allows it again. */
export type GalleryRemovedItem = {
  identityKey: string;
  removedAt: string;
  templateId: string | null;
  name: string;
  quotedCount: number | null;
  hasSnapshot: boolean;
};
export type GalleryRestoreOutcome = "restored" | "allowed_again" | "not_found";

export type GalleryFilterEntry = { id: string; name: string; count: number };
export type GalleryTagEntry = { tag: string; count: number };
export type GallerySubCategoryEntry = { id: string; name: string; parentCategoryId: string | null; parentCategoryName: string; count: number };
export type GalleryCurrencyEntry = { currency: string; count: number };

/** A currency filter: trimmed and upper-cased, then 1-8 capital letters only. Anything else is null (invalid). */
export function cleanGalleryCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{1,8}$/.test(upper) ? upper : null;
}

/** Replay needs no edited text: a gallery configuration has none. The existing replay and its banner accept this as is. */
export function neutralSpecOverrides(): SavedSetupSpecOverrides {
  return { specification_edited: false, edited_specification: null, generated_specification_hash: null };
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The stored structural recipe -> a full SavedSetupRecipeV1 the existing replay can read. The stored value has no finishes,
 * picture choice, display hint or linked-product instances; they are filled with empty values. Returns null when the stored value is
 * not a valid recipe for this product (shape, forbidden price/quantity keys, size, template id).
 */
export function completeGalleryRecipe(raw: unknown, templateId: string): SavedSetupRecipeV1 | null {
  if (!isUuid(templateId)) return null;
  const shape = validateRecipeShape(raw);
  if (!shape.ok) return null;
  const stored = plainRecord(raw);
  if (stored.template_id !== templateId) return null;
  const selections = plainRecord(stored.selections);
  const linked = plainRecord(stored.linked);
  const skipped = Array.isArray(selections.skipped_accessory_group_ids) ? selections.skipped_accessory_group_ids.filter((id): id is string => typeof id === "string") : [];
  return {
    recipe_version: 1,
    template_id: templateId,
    selections: {
      ...(selections as Partial<SavedSetupRecipeV1["selections"]>),
      modular_quantities: plainRecord(selections.modular_quantities) as Record<string, number>,
      pricing_accessory_quantities: plainRecord(selections.pricing_accessory_quantities) as Record<string, number>,
      component_accessory_quantities: plainRecord(selections.component_accessory_quantities) as Record<string, number>,
      skipped_accessory_group_ids: skipped,
      required_overrides: {},
      component_option_selections: plainRecord(selections.component_option_selections) as Record<string, string | string[]>,
      accessory_category_choices: plainRecord(selections.accessory_category_choices) as Record<string, string>,
    },
    finishes: [],
    selected_image: null,
    linked: { instances: {}, selections: plainRecord(linked.selections) as SavedSetupRecipeV1["linked"]["selections"] },
  };
}
