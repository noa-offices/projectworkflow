"use server";

import { revalidatePath } from "next/cache";
import { canManageProductLibrary, requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { galleryMessage, isGalleryId, type GalleryCurrencyEntry, type GalleryFilterEntry, type GalleryListItem, type GalleryMessageKind, type GalleryRemovedItem, type GalleryRestoreOutcome, type GallerySortMode, type GallerySubCategoryEntry, type GalleryTagEntry } from "./gallery";
import {
  getGalleryCapabilities,
  getGalleryItemDetail,
  applyGalleryUpdate,
  getGalleryItemForAdd,
  ignoreGalleryUpdate,
  listRemovedGalleryItems,
  restoreGalleryItem,
  listGalleryFilters,
  listGalleryItems,
  mergeGalleryItems,
  removeGalleryItem,
  setGalleryItemHidden,
  updateGalleryItemDetails,
  updateGalleryItemSpecification,
  type GalleryAddItem,
} from "./gallery-service";
import type { GalleryDetail } from "./gallery-detail";
import { loadGalleryPrices } from "./gallery-price-service";

// Server Actions are public POST endpoints: every action authenticates FIRST with requireActiveUser, takes the user from the SESSION,
// uses the CALLER's Supabase client (RLS stays on) and never an admin client. An action never throws to the browser: it returns
// { ok: true, ... } or { ok: false, message } with a message from GALLERY_MESSAGES. Recipes and rows are never logged. Extra input
// fields are ignored. Pricing uses a separate explicitly authorized action and never enters existing gallery payloads.
export type GalleryActionFailure = { ok: false; message: string };

/** Prices are returned only to callers who can open Product Library Management. */
export async function getGalleryPricesAction(ids: string[]): Promise<
  { ok: true; prices: Awaited<ReturnType<typeof loadGalleryPrices>> } | GalleryActionFailure
> {
  try {
    const { profile } = await requireActiveUser();
    if (!canManageProductLibrary(profile?.role)) return { ok: true, prices: {} };
    if (!Array.isArray(ids) || ids.length > 60 || !Array.from(ids).every(isGalleryId)) return failure("invalid_request");
    if (!ids.length) return { ok: true, prices: {} };
    const supabase = await createClient();
    return { ok: true, prices: await loadGalleryPrices(supabase, [...new Set(ids.map((id) => id.toLowerCase()))]) };
  } catch (problem) {
    // requireActiveUser also redirects accounts that cannot access this part of the app.
    const digest = (problem as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return { ok: true, prices: {} };
    return failure("load_failed", problem);
  }
}

function failure<Extra extends object = Record<never, never>>(kind: GalleryMessageKind, problem?: unknown, extra?: Extra): GalleryActionFailure & Extra {
  // A sign-in redirect thrown by requireActiveUser becomes the "not allowed" message instead of an exception.
  const digest = (problem as { digest?: unknown } | null)?.digest;
  const redirected = typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
  try {
    if (problem !== undefined && !redirected) console.error("product gallery action failed", problem instanceof Error ? problem.name : typeof problem);
  } catch {
    // logging must never fail an action
  }
  return { ok: false, message: galleryMessage(redirected ? "not_allowed" : kind), ...(extra ?? ({} as Extra)) };
}

/** Items per page: 30. Display fields only (no recipe, no price). includeHidden is no longer sent by the page (items are removed, not hidden). */
export async function listGalleryItemsAction(input?: {
  query?: string;
  brandId?: string | null;
  categoryId?: string | null;
  subCategoryId?: string | null;
  currency?: string | null;
  tag?: string | null;
  sort?: string;
  includeHidden?: boolean;
  updateAvailable?: boolean;
  page?: number;
}): Promise<
  { ok: true; items: GalleryListItem[]; total: number; page: number; pageSize: number; hasMore: boolean; sort: GallerySortMode } | GalleryActionFailure
> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await listGalleryItems(supabase, {
      query: input?.query,
      brandId: input?.brandId,
      categoryId: input?.categoryId,
      subCategoryId: input?.subCategoryId,
      currency: input?.currency,
      tag: input?.tag,
      sort: input?.sort,
      includeHidden: input?.includeHidden,
      updateAvailable: input?.updateAvailable,
      page: input?.page,
    });
    if (!result.ok) return failure(result.kind);
    return { ok: true, items: result.items, total: result.total, page: result.page, pageSize: result.pageSize, hasMore: result.hasMore, sort: result.sort };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

/** Brands, categories (id, name, count) and tags (tag, count) that have at least one visible item. */
export async function listGalleryFiltersAction(): Promise<
  { ok: true; brands: GalleryFilterEntry[]; categories: GalleryFilterEntry[]; tags: GalleryTagEntry[]; subCategories: GallerySubCategoryEntry[]; currencies: GalleryCurrencyEntry[] } | GalleryActionFailure
> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await listGalleryFilters(supabase);
    if (!result.ok) return failure(result.kind);
    return { ok: true, brands: result.brands, categories: result.categories, tags: result.tags, subCategories: result.subCategories, currencies: result.currencies };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

/**
 * One item for the builder: item.setup has the same shape as a My Collection setup (id, templateId, setupName, recipe, specOverrides),
 * with NEUTRAL spec overrides. Hand it to the existing openSetupFromCollection replay. The recipe goes to the browser only here.
 */
export async function getGalleryItemForAddAction(input: { id: string }): Promise<{ ok: true; item: GalleryAddItem } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await getGalleryItemForAdd(supabase, input?.id);
    if (!result.ok) return failure(result.kind);
    return { ok: true, item: result.item };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

/**
 * Everything the details popup shows for one item: names and text only (header, pictures, template description and specification,
 * readable saved configuration, available materials, options and accessories). NO price of any kind. `unavailable` is true when the
 * product or the item is gone (show "This product is no longer available." without a Retry).
 */
export async function getGalleryItemDetailAction(input: { id: string }): Promise<{ ok: true; detail: GalleryDetail } | (GalleryActionFailure & { unavailable: boolean })> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await getGalleryItemDetail(supabase, input?.id);
    if (!result.ok) return failure(result.kind, undefined, { unavailable: result.kind === "product_unavailable" || result.kind === "item_not_found" });
    return { ok: true, detail: result.detail };
  } catch (problem) {
    return failure("load_failed", problem, { unavailable: false });
  }
}

/** Editors only (checked here and by the database). */
export async function setGalleryItemHiddenAction(input: { id: string; hidden: boolean }): Promise<{ ok: true } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await setGalleryItemHidden(supabase, { id: input?.id, hidden: input?.hidden });
    if (!result.ok) return failure(result.kind);
    return { ok: true };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Editors only. displayName empty clears the name; tags are lower-cased and de-duplicated (max 20, each 1-30 characters). */
export async function updateGalleryItemDetailsAction(input: { id: string; displayName: string | null; tags: string[] }): Promise<{ ok: true } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await updateGalleryItemDetails(supabase, { id: input?.id, displayName: input?.displayName, tags: input?.tags });
    if (!result.ok) return failure(result.kind);
    return { ok: true };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Editors only. Removes the item from the gallery for good; the same configuration does not come back when it is quoted again. alreadyRemoved: it was gone. */
export async function removeGalleryItemAction(input: { id: string }): Promise<{ ok: true; alreadyRemoved: boolean } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await removeGalleryItem(supabase, { id: input?.id });
    if (!result.ok) return failure(result.kind);
    return { ok: true, alreadyRemoved: result.alreadyRemoved };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Editors only (checked here before the database function, which checks again). Empty clears the text; at most 2000 characters. */
export async function updateGalleryItemSpecificationAction(input: { id: string; specification: string | null }): Promise<{ ok: true } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await updateGalleryItemSpecification(supabase, { id: input?.id, specification: input?.specification });
    if (!result.ok) return failure(result.kind);
    return { ok: true };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Curators only (owner/admin). Merges a duplicate (fromId) into another item (toId). */
export async function mergeGalleryItemsAction(input: { fromId: string; toId: string }): Promise<{ ok: true } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await mergeGalleryItems(supabase, { fromId: input?.fromId, toId: input?.toId });
    if (!result.ok) return failure(result.kind);
    return { ok: true };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** canView false => the UI shows nothing. canEdit => the Edit toggle (rename, tag, specification, remove). canCurate => merge as well. The database decides both. */
export async function getGalleryCapabilitiesAction(): Promise<{ ok: true; canView: boolean; canEdit: boolean; canCurate: boolean } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const capabilities = await getGalleryCapabilities(supabase);
    return { ok: true, canView: capabilities.canView, canEdit: capabilities.canEdit, canCurate: capabilities.canCurate };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

// ── Removed items and update offers (editors only; the server checks canEdit before the database function, which checks again) ──
function refreshGallery() {
  try {
    revalidatePath("/products/gallery");
  } catch {
    // outside a request (or a cache problem) the change is still saved
  }
}

/** Editors only: removed configurations, newest first. */
export async function listRemovedGalleryItemsAction(): Promise<{ ok: true; items: GalleryRemovedItem[] } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await listRemovedGalleryItems(supabase);
    if (!result.ok) return failure(result.kind);
    return { ok: true, items: result.items };
  } catch (problem) {
    return failure("load_failed", problem);
  }
}

/** Editors only: restored (the item is back), allowed_again (an older removal: it returns when quoted next), or not_found. */
export async function restoreGalleryItemAction(input: { key: string }): Promise<{ ok: true; outcome: GalleryRestoreOutcome } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await restoreGalleryItem(supabase, { key: input?.key });
    if (!result.ok) return failure(result.kind);
    refreshGallery();
    return { ok: true, outcome: result.outcome };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Editors only: apply an open "specification" or "picture" offer. */
export async function applyGalleryUpdateAction(input: { id: string; kind: "specification" | "picture" }): Promise<{ ok: true } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await applyGalleryUpdate(supabase, { id: input?.id, kind: input?.kind });
    if (!result.ok) return failure(result.kind);
    refreshGallery();
    return { ok: true };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Editors only: ignore an offer ("specification" / "picture") or the "saved choices changed" notice ("configuration", with its short fingerprint). */
export async function ignoreGalleryUpdateAction(input: { id: string; kind: "specification" | "picture" | "configuration"; value?: string | null }): Promise<{ ok: true } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const result = await ignoreGalleryUpdate(supabase, { id: input?.id, kind: input?.kind, value: input?.value });
    if (!result.ok) return failure(result.kind);
    refreshGallery();
    return { ok: true };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}

/** Editors only: scan saved quotations for new offers. */
export async function checkGalleryUpdatesAction(): Promise<{ ok: true; message: string } | GalleryActionFailure> {
  try {
    await requireActiveUser();
    const supabase = await createClient();
    const capabilities = await getGalleryCapabilities(supabase);
    if (!capabilities.canEdit) return failure("not_allowed");
    const { data, error } = await supabase.rpc("product_gallery_check_updates");
    if (error || !Number.isInteger(data) || data < 0) return failure("save_failed");
    refreshGallery();
    return { ok: true, message: data ? `${data} update(s) found` : "No updates found" };
  } catch (problem) {
    return failure("save_failed", problem);
  }
}
