"use server";

import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { galleryMessage, type GalleryCurrencyEntry, type GalleryFilterEntry, type GalleryListItem, type GalleryMessageKind, type GallerySortMode, type GallerySubCategoryEntry, type GalleryTagEntry } from "./gallery";
import {
  getGalleryCapabilities,
  getGalleryItemDetail,
  getGalleryItemForAdd,
  listGalleryFilters,
  listGalleryItems,
  mergeGalleryItems,
  setGalleryItemHidden,
  updateGalleryItemDetails,
  updateGalleryItemSpecification,
  type GalleryAddItem,
} from "./gallery-service";
import type { GalleryDetail } from "./gallery-detail";

// Server Actions are public POST endpoints: every action authenticates FIRST with requireActiveUser, takes the user from the SESSION,
// uses the CALLER's Supabase client (RLS stays on) and never an admin client. An action never throws to the browser: it returns
// { ok: true, ... } or { ok: false, message } with a message from GALLERY_MESSAGES. Recipes and rows are never logged. Extra input
// fields are ignored. The gallery has NO price: no action here returns or accepts one.
export type GalleryActionFailure = { ok: false; message: string };

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

/** Items per page: 30. Display fields only (no recipe, no price). includeHidden only has an effect for editors. */
export async function listGalleryItemsAction(input?: {
  query?: string;
  brandId?: string | null;
  categoryId?: string | null;
  subCategoryId?: string | null;
  currency?: string | null;
  tag?: string | null;
  sort?: string;
  includeHidden?: boolean;
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

/** canView false => the UI shows nothing. canEdit => the Edit toggle (rename, tag, hide). canCurate => merge as well. */
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
