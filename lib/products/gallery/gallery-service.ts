/**
 * Product Gallery service. No "use server", no auth import: the server actions authenticate with requireActiveUser and pass the
 * CALLER's own Supabase client (so RLS stays on: sales roles see visible items, curators also see hidden ones). Never pass an
 * elevated client here. Gallery rows are written ONLY by a database trigger; this file reads them and calls the curation functions.
 * There is NO price anywhere: not stored, not selected, not returned. A recipe is never logged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSetupUsable } from "../saved-setups/usable";
import type { SavedSetupRecipeV1, SavedSetupSpecOverrides } from "../saved-setups/recipe";
import {
  GALLERY_FILTER_LIST_MAX,
  GALLERY_FILTER_SCAN_MAX,
  GALLERY_FILTER_TAGS_MAX,
  GALLERY_PAGE_SIZE,
  clampGalleryPage,
  cleanGalleryCurrency,
  cleanGalleryTag,
  completeGalleryRecipe,
  galleryDisplayName,
  galleryQueryWords,
  gallerySortMode,
  galleryWordPattern,
  isGalleryId,
  neutralSpecOverrides,
  validateGalleryDisplayName,
  validateGalleryTags,
  type GalleryCurrencyEntry,
  type GalleryFilterEntry,
  type GalleryListItem,
  type GalleryMessageKind,
  type GalleryPicture,
  type GallerySortMode,
  type GallerySubCategoryEntry,
  type GalleryTagEntry,
} from "./gallery";

// The list NEVER selects the recipe. Display fields only.
const LIST_COLUMNS = [
  "id", "template_id", "brand_id", "main_category_id", "sub_category_id", "item_name", "display_name", "item_code", "currency",
  "tags", "quoted_count", "last_quoted_at", "is_hidden",
].join(",");

type GalleryRow = {
  id: string;
  template_id: string;
  brand_id: string | null;
  main_category_id: string | null;
  sub_category_id: string | null;
  item_name: string;
  display_name: string | null;
  item_code: string | null;
  currency: string | null;
  tags: string[] | null;
  quoted_count: number | string;
  last_quoted_at: string;
  is_hidden: boolean;
};

function logProblem(where: string, problem: unknown) {
  // Only a short name. Never a recipe, a payload or a row.
  try {
    console.error(`product gallery (${where}):`, problem instanceof Error ? problem.name : typeof problem);
  } catch {
    // logging must never fail an action
  }
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

const PROPOSED_IMAGE_FIELDS = Array.from({ length: 20 }, (_, index) => `proposed_image_url_${index + 1}`);
// Template pictures AND availability in ONE batched query for the page.
const TEMPLATE_SELECT = ["id", "is_active", "lifecycle_status", "default_image_url", ...PROPOSED_IMAGE_FIELDS].join(",");

/** The template's first picture, chosen exactly like client history does for configured rows without a chosen picture. */
function firstTemplatePicture(template: Record<string, unknown>): GalleryPicture {
  for (const field of PROPOSED_IMAGE_FIELDS) {
    const value = field === "proposed_image_url_1" ? template[field] ?? template.default_image_url : template[field];
    if (typeof value === "string" && value.trim()) return { kind: "template", path: value };
  }
  return null;
}

async function rpcBoolean(supabase: SupabaseClient, name: "product_gallery_can_view" | "product_gallery_is_curator"): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(name);
    return !error && data === true;
  } catch (problem) {
    logProblem(name, problem);
    return false;
  }
}

async function namesFor(supabase: SupabaseClient, table: "brands" | "product_categories", ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  try {
    const { data } = await supabase.from(table).select("id,name").in("id", ids);
    for (const row of (data ?? []) as unknown as Array<{ id: string; name: string | null }>) if (row.name) names.set(row.id, row.name);
  } catch (problem) {
    logProblem(table, problem);
  }
  return names;
}

export type GalleryCapabilities = { canView: boolean; canCurate: boolean };

/** What the UI may show. canView false => the UI shows nothing. */
export async function getGalleryCapabilities(supabase: SupabaseClient): Promise<GalleryCapabilities> {
  const [canView, canCurate] = await Promise.all([rpcBoolean(supabase, "product_gallery_can_view"), rpcBoolean(supabase, "product_gallery_is_curator")]);
  return { canView, canCurate: canView && canCurate };
}

export type ListGalleryInput = {
  query?: unknown;
  brandId?: unknown;
  categoryId?: unknown;
  subCategoryId?: unknown;
  currency?: unknown;
  tag?: unknown;
  sort?: unknown;
  includeHidden?: unknown;
  page?: unknown;
};
export type ListGalleryResult =
  | { ok: true; items: GalleryListItem[]; total: number; page: number; pageSize: number; hasMore: boolean; sort: GallerySortMode }
  | { ok: false; kind: GalleryMessageKind };

/** The gallery, 30 per page. Display fields only: no recipe and no price ever leave the server in a list. */
export async function listGalleryItems(supabase: SupabaseClient, input: ListGalleryInput): Promise<ListGalleryResult> {
  const brandId = input?.brandId;
  const categoryId = input?.categoryId;
  if (brandId !== undefined && brandId !== null && brandId !== "" && !isGalleryId(brandId)) return { ok: false, kind: "invalid_request" };
  if (categoryId !== undefined && categoryId !== null && categoryId !== "" && !isGalleryId(categoryId)) return { ok: false, kind: "invalid_request" };
  const subCategoryId = input?.subCategoryId;
  if (subCategoryId !== undefined && subCategoryId !== null && subCategoryId !== "" && !isGalleryId(subCategoryId)) return { ok: false, kind: "invalid_request" };
  const hasCurrency = input?.currency !== undefined && input?.currency !== null && input?.currency !== "";
  const currency = hasCurrency ? cleanGalleryCurrency(input.currency) : null;
  if (hasCurrency && currency === null) return { ok: false, kind: "invalid_request" };
  const tag = input?.tag === undefined || input?.tag === null || input?.tag === "" ? null : cleanGalleryTag(input.tag);
  if (input?.tag !== undefined && input?.tag !== null && input?.tag !== "" && tag === null) return { ok: false, kind: "invalid_request" };
  const sort = gallerySortMode(input?.sort);
  const page = clampGalleryPage(input?.page);
  const from = (page - 1) * GALLERY_PAGE_SIZE;
  try {
    // Hidden items: only a curator asking for them. (The database also hides them from everyone else; this is not the only guard.)
    const showHidden = input?.includeHidden === true && (await rpcBoolean(supabase, "product_gallery_is_curator"));
    let query = supabase.from("product_gallery_items").select(LIST_COLUMNS, { count: "exact" });
    if (!showHidden) query = query.eq("is_hidden", false);
    if (isGalleryId(brandId)) query = query.eq("brand_id", brandId);
    if (isGalleryId(categoryId)) query = query.or(`main_category_id.eq.${categoryId},sub_category_id.eq.${categoryId}`);
    if (isGalleryId(subCategoryId)) query = query.eq("sub_category_id", subCategoryId);
    if (currency) query = query.eq("currency", currency);
    if (tag) query = query.contains("tags", [tag]);
    // Every word must be found (one filter per word = AND), each in the search text, the curated name or the tags.
    for (const word of galleryQueryWords(input?.query)) {
      const pattern = galleryWordPattern(word);
      query = query.or(`search_text.ilike."${pattern}",display_name.ilike."${pattern}",tags.cs.{"${word}"}`);
    }
    if (sort === "popular") query = query.order("quoted_count", { ascending: false }).order("last_quoted_at", { ascending: false });
    else if (sort === "newest") query = query.order("last_quoted_at", { ascending: false });
    else query = query.order("display_name", { ascending: true, nullsFirst: false }).order("item_name", { ascending: true });
    query = query.order("id", { ascending: true }).range(from, from + GALLERY_PAGE_SIZE - 1);
    const { data, error, count } = await query;
    if (error || !data) return { ok: false, kind: "load_failed" };
    const rows = data as unknown as GalleryRow[];

    const templateIds = Array.from(new Set(rows.map((row) => row.template_id)));
    const brandIds = Array.from(new Set(rows.flatMap((row) => (row.brand_id ? [row.brand_id] : []))));
    const categoryIds = Array.from(new Set(rows.flatMap((row) => [row.main_category_id, row.sub_category_id].filter((id): id is string => Boolean(id)))));
    const templates = new Map<string, Record<string, unknown>>();
    if (templateIds.length) {
      try {
        const { data: templateRows } = await supabase.from("product_templates").select(TEMPLATE_SELECT).in("id", templateIds);
        for (const row of (templateRows ?? []) as unknown as Array<Record<string, unknown>>) templates.set(String(row.id), row);
      } catch (problem) {
        logProblem("templates", problem);
      }
    }
    const [brandNames, categoryNames] = await Promise.all([namesFor(supabase, "brands", brandIds), namesFor(supabase, "product_categories", categoryIds)]);

    const items: GalleryListItem[] = rows.map((row) => {
      const template = templates.get(row.template_id);
      const activity = template ? { is_active: template.is_active as boolean | null, lifecycle_status: template.lifecycle_status as string | null } : null;
      return {
        id: row.id,
        templateId: row.template_id,
        displayName: galleryDisplayName({ displayName: row.display_name, itemName: row.item_name }),
        itemName: row.item_name,
        itemCode: row.item_code ?? "",
        brandId: row.brand_id,
        brandName: row.brand_id ? brandNames.get(row.brand_id) ?? "" : "",
        categoryId: row.main_category_id,
        categoryName: row.main_category_id ? categoryNames.get(row.main_category_id) ?? "" : "",
        subCategoryName: row.sub_category_id ? categoryNames.get(row.sub_category_id) ?? "" : "",
        currency: row.currency ?? "",
        tags: Array.isArray(row.tags) ? row.tags : [],
        quotedCount: numberOr(row.quoted_count, 1),
        lastQuotedAt: row.last_quoted_at,
        isHidden: row.is_hidden === true,
        available: isSetupUsable({ template_id: row.template_id }, activity),
        picture: template ? firstTemplatePicture(template) : null,
      };
    });
    const total = typeof count === "number" ? count : from + rows.length;
    return { ok: true, items, total, page, pageSize: GALLERY_PAGE_SIZE, hasMore: from + rows.length < total, sort };
  } catch (problem) {
    logProblem("list", problem);
    return { ok: false, kind: "load_failed" };
  }
}

export type GalleryFilters = {
  brands: GalleryFilterEntry[];
  categories: GalleryFilterEntry[];
  tags: GalleryTagEntry[];
  subCategories: GallerySubCategoryEntry[];
  currencies: GalleryCurrencyEntry[];
};
export type GalleryFiltersResult = ({ ok: true } & GalleryFilters) | { ok: false; kind: GalleryMessageKind };

function countBy(ids: Iterable<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Brands, categories and tags that have at least one VISIBLE item, with counts. One small scan (capped), no recipe, no price. */
export async function listGalleryFilters(supabase: SupabaseClient): Promise<GalleryFiltersResult> {
  try {
    const { data, error } = await supabase
      .from("product_gallery_items")
      .select("brand_id,main_category_id,sub_category_id,currency,tags")
      .eq("is_hidden", false)
      .limit(GALLERY_FILTER_SCAN_MAX);
    if (error || !data) return { ok: false, kind: "load_failed" };
    const rows = data as unknown as Array<{ brand_id: string | null; main_category_id: string | null; sub_category_id: string | null; currency: string | null; tags: string[] | null }>;
    const brandCounts = countBy(rows.map((row) => row.brand_id));
    // A category counts once per item even when the main and the sub category are the same id.
    const categoryCounts = countBy(rows.flatMap((row) => Array.from(new Set([row.main_category_id, row.sub_category_id].filter((id): id is string => Boolean(id))))));
    const tagCounts = countBy(rows.flatMap((row) => (Array.isArray(row.tags) ? Array.from(new Set(row.tags)) : [])));

    // Sub-categories with a visible item; the parent is the item's main category (the most common one if it ever differs).
    const subCounts = new Map<string, { count: number; parents: Map<string, number> }>();
    for (const row of rows) {
      if (!row.sub_category_id) continue;
      const entry = subCounts.get(row.sub_category_id) ?? { count: 0, parents: new Map<string, number>() };
      entry.count += 1;
      if (row.main_category_id) entry.parents.set(row.main_category_id, (entry.parents.get(row.main_category_id) ?? 0) + 1);
      subCounts.set(row.sub_category_id, entry);
    }
    const currencyCounts = countBy(rows.map((row) => cleanGalleryCurrency(row.currency)));

    const topIds = (counts: Map<string, number>) => Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, GALLERY_FILTER_LIST_MAX);
    const brandTop = topIds(brandCounts);
    const categoryTop = topIds(categoryCounts);
    const subTop = Array.from(subCounts.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, GALLERY_FILTER_LIST_MAX);
    const [brandNames, categoryNames] = await Promise.all([
      namesFor(supabase, "brands", brandTop.map(([id]) => id)),
      namesFor(supabase, "product_categories", [...categoryTop.map(([id]) => id), ...subTop.map(([id]) => id)]),
    ]);
    const entries = (top: Array<[string, number]>, names: Map<string, string>): GalleryFilterEntry[] =>
      top.flatMap(([id, count]) => (names.has(id) ? [{ id, name: names.get(id) as string, count }] : [])).sort((a, b) => a.name.localeCompare(b.name));
    const tags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, GALLERY_FILTER_TAGS_MAX)
      .map(([tag, count]) => ({ tag, count }));
    const subCategories: GallerySubCategoryEntry[] = subTop
      .flatMap(([id, entry]) => {
        const name = categoryNames.get(id);
        if (!name) return [];
        const parent = Array.from(entry.parents.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        return [{ id, name, parentCategoryId: parent, count: entry.count }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const currencies: GalleryCurrencyEntry[] = Array.from(currencyCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, GALLERY_FILTER_LIST_MAX)
      .map(([currency, count]) => ({ currency, count }));
    return { ok: true, brands: entries(brandTop, brandNames), categories: entries(categoryTop, categoryNames), tags, subCategories, currencies };
  } catch (problem) {
    logProblem("filters", problem);
    return { ok: false, kind: "load_failed" };
  }
}

// ── One item, for the builder replay ───────────────────────────────────────
/** Same shape as the My Collection SetupForUse, so the EXISTING replay (openSetupFromCollection) takes it as is. */
export type GallerySetupForUse = { id: string; templateId: string; setupName: string; recipe: SavedSetupRecipeV1; specOverrides: SavedSetupSpecOverrides };
export type GalleryAddItem = { id: string; templateId: string; itemName: string; setup: GallerySetupForUse };
export type GalleryAddResult = { ok: true; item: GalleryAddItem } | { ok: false; kind: GalleryMessageKind };

/** The ONLY place a recipe goes to the browser: one item, on Add. The product must still exist and be active. */
export async function getGalleryItemForAdd(supabase: SupabaseClient, id: unknown): Promise<GalleryAddResult> {
  if (!isGalleryId(id)) return { ok: false, kind: "invalid_request" };
  try {
    const { data, error } = await supabase.from("product_gallery_items").select("id,template_id,item_name,display_name,recipe").eq("id", id).maybeSingle();
    if (error) return { ok: false, kind: "load_failed" };
    const row = data as unknown as { id: string; template_id: string; item_name: string; display_name: string | null; recipe: unknown } | null;
    if (!row) return { ok: false, kind: "item_not_found" };
    // The product must still exist and be active (the same rule as My Collection replay).
    const { data: template } = await supabase.from("product_templates").select("id,is_active,lifecycle_status").eq("id", row.template_id).maybeSingle();
    const activity = template as { is_active: boolean | null; lifecycle_status: string | null } | null;
    if (!isSetupUsable({ template_id: row.template_id }, activity)) return { ok: false, kind: "product_unavailable" };
    const recipe = completeGalleryRecipe(row.recipe, row.template_id);
    if (!recipe) return { ok: false, kind: "recipe_unreadable" };
    const name = galleryDisplayName({ displayName: row.display_name, itemName: row.item_name });
    return { ok: true, item: { id: row.id, templateId: row.template_id, itemName: name, setup: { id: row.id, templateId: row.template_id, setupName: name, recipe, specOverrides: neutralSpecOverrides() } } };
  } catch (problem) {
    logProblem("load for add", problem);
    return { ok: false, kind: "load_failed" };
  }
}

// ── Curation (system_owner / admin_manager only; the database function decides) ─
export type GalleryChangeResult = { ok: true } | { ok: false; kind: GalleryMessageKind };

async function callCuration(supabase: SupabaseClient, name: string, args: Record<string, unknown>): Promise<GalleryChangeResult> {
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) {
      const code = (error as { code?: string }).code;
      const text = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
      return { ok: false, kind: code === "42501" || /not allowed/i.test(text) ? "not_allowed" : "save_failed" };
    }
    return data === true ? { ok: true } : { ok: false, kind: "item_not_found" };
  } catch (problem) {
    logProblem(name, problem);
    return { ok: false, kind: "save_failed" };
  }
}

export async function setGalleryItemHidden(supabase: SupabaseClient, input: { id: unknown; hidden: unknown }): Promise<GalleryChangeResult> {
  if (!isGalleryId(input?.id) || typeof input?.hidden !== "boolean") return { ok: false, kind: "invalid_request" };
  return callCuration(supabase, "product_gallery_set_hidden", { p_id: input.id, p_hidden: input.hidden });
}

export async function updateGalleryItemDetails(supabase: SupabaseClient, input: { id: unknown; displayName: unknown; tags: unknown }): Promise<GalleryChangeResult> {
  const name = validateGalleryDisplayName(input?.displayName);
  const tags = validateGalleryTags(input?.tags);
  if (!isGalleryId(input?.id) || !name.ok || !tags.ok) return { ok: false, kind: "invalid_request" };
  return callCuration(supabase, "product_gallery_update_details", { p_id: input.id, p_display_name: name.value, p_tags: tags.value });
}

export async function mergeGalleryItems(supabase: SupabaseClient, input: { fromId: unknown; toId: unknown }): Promise<GalleryChangeResult> {
  if (!isGalleryId(input?.fromId) || !isGalleryId(input?.toId) || input.fromId === input.toId) return { ok: false, kind: "invalid_request" };
  return callCuration(supabase, "product_gallery_merge", { p_from: input.fromId, p_to: input.toId });
}
