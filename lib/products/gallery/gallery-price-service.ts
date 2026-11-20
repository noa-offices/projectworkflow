import type { SupabaseClient } from "@supabase/supabase-js";
import { brandPriceBaselineDate, friendlyPriceHealth, latestBrandPriceListUpdate, productTemplatePriceCheckState, scheduledBrandPriceListUpdate, type BrandPriceListUpdateForCheck } from "@/lib/product-price-check";
import { completeGalleryRecipe, isGalleryId } from "./gallery";
import { describeRecipe } from "./gallery-detail";
import { priceRecipe, type GalleryPriceComponent, type GalleryPriceLink, type GalleryPriceTemplate, type RecipePrice } from "./gallery-price";

const TEMPLATE_COLUMNS = "id,template_name,brand_id,is_active,lifecycle_status,currency,default_unit_price,variant_pricing,category_pricing,accessory_pricing,desking_size_pricing";
type TemplateRow = GalleryPriceTemplate & {
  brand_id: string | null;
  created_at: string | null;
  creation_legacy?: boolean;
  last_price_checked_at: string | null;
  last_price_checked_by: string | null;
  price_check_interval_days: number | null;
  price_check_note: string | null;
};
type PriceCheck = {
  checkedAt: string | null;
  checkedBy: string | null;
  checkedByName?: string;
  intervalDays: number | null;
  note: string | null;
  state: ReturnType<typeof friendlyPriceHealth>;
};
type PriceResult = { status: "needs_configure"; reason?: string } | (Extract<RecipePrice, { status: "priced" }> & { priceCheck: PriceCheck });

const unique = (ids: string[]) => [...new Set(ids)];
async function batch<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  // Supabase's usual response cap is 1,000. Never price a partially fetched dependency set.
  if (error || !Array.isArray(data) || data.length >= 1000) throw new Error("Gallery data incomplete");
  return data as T[];
}

/**
 * The size text of each item, from the template rows that are already loaded for the batch. It is the SAME text the Details popup shows
 * (describeRecipe), never a price; an item whose size cannot be worked out is simply left out.
 */
function dimensionsOf(items: ReadonlyArray<{ id: string; template_id: string; recipe: unknown }>, templates: ReadonlyArray<GalleryPriceTemplate>): Record<string, string> {
  const byId = new Map(templates.map((template) => [template.id, template]));
  const out: Record<string, string> = {};
  for (const item of items) {
    const template = byId.get(item.template_id);
    if (!template) continue;
    try {
      const { dimension } = describeRecipe({ recipe: item.recipe, template, components: [], linkedFamilies: [] });
      if (dimension) out[item.id] = dimension;
    } catch {
      // a size that cannot be read is omitted, never an error for the list
    }
  }
  return out;
}

/**
 * Prices and sizes for one batch of list items. Prices are only computed when includePrices is true: the CALLER must authorize price
 * access first (the size does not depend on it). Uses the user-session client only.
 */
export async function loadGalleryListFacts(supabase: SupabaseClient, ids: string[], includePrices: boolean): Promise<{ prices: Record<string, PriceResult>; dimensions: Record<string, string> }> {
  const items = await batch<{ id: string; template_id: string; recipe: unknown }>(
    supabase.from("product_gallery_items").select("id,template_id,recipe").in("id", ids).eq("is_hidden", false),
  );
  if (!items.length) return { prices: {}, dimensions: {} };
  const templateIds = unique(items.map((item) => item.template_id));
  if (!includePrices) {
    const only = await batch<GalleryPriceTemplate>(supabase.from("product_templates").select(TEMPLATE_COLUMNS).in("id", templateIds));
    return { prices: {}, dimensions: dimensionsOf(items, only) };
  }
  const recipes = items.map((item) => completeGalleryRecipe(item.recipe, item.template_id));
  const componentIds = unique(recipes.flatMap((recipe) => recipe ? [
    ...Object.values(recipe.selections.component_option_selections).flat(),
    ...Object.keys(recipe.selections.component_accessory_quantities),
  ].filter(isGalleryId) : []));
  const selectedLinks = new Set(recipes.flatMap((recipe) =>
    Object.keys(recipe?.linked.selections ?? {}).map((key) => key.split(":")[0])));
  if (componentIds.length >= 500) throw new Error("Gallery component batch too large");
  const componentFilter = componentIds.length ? `is_default_selected.eq.true,id.in.(${componentIds.join(",")})` : "is_default_selected.eq.true";
  const [templates, links, components] = await Promise.all([
    batch<TemplateRow>(supabase.from("product_templates").select(`${TEMPLATE_COLUMNS},created_at,creation_legacy,last_price_checked_at,last_price_checked_by,price_check_interval_days,price_check_note`).in("id", templateIds)),
    batch<GalleryPriceLink>(supabase.from("product_template_linked_families").select("id,parent_template_id,linked_template_id,is_required,allow_multiple,add_to_parent_price,default_qty").in("parent_template_id", templateIds).eq("is_active", true)),
    batch<GalleryPriceComponent>(
      supabase.from("product_components").select("id,template_id,option_type,component_group,qty,unit_price,currency,calculation_data,is_default_selected,sort_order")
        .in("template_id", templateIds).eq("is_active", true).or(componentFilter),
    ),
  ]);
  const templateMap = new Map(templates.map((template) => [template.id, template]));
  const childIds = unique(links.filter((link) => selectedLinks.has(link.id) && !templateMap.has(link.linked_template_id)).map((link) => link.linked_template_id));
  const brandIds = unique(templates.flatMap((template) => template.brand_id ? [template.brand_id] : []));
  const checkerIds = unique(templates.map((template) => template.last_price_checked_by).filter(isGalleryId));
  const [children, brands, updates, checkers] = await Promise.all([
    childIds.length && childIds.length < 500 ? batch<GalleryPriceTemplate>(supabase.from("product_templates").select(TEMPLATE_COLUMNS).in("id", childIds)) : [],
    brandIds.length ? batch<{ id: string; last_price_list_checked_at: string | null; price_list_check_interval_days: number | null }>(
      supabase.from("brands").select("id,last_price_list_checked_at,price_list_check_interval_days").in("id", brandIds),
    ) : [],
    brandIds.length ? batch<BrandPriceListUpdateForCheck & { brand_id: string }>(
      supabase.from("brand_price_list_updates").select("brand_id,title,effective_from,received_at,status,created_at,coverage_mode").in("brand_id", brandIds),
    ) : [],
    // Profile visibility is independent of the price. Keep prices if names are unavailable.
    checkerIds.length ? batch<{ id: string; full_name: string | null }>(
      supabase.from("profiles").select("id,full_name").in("id", checkerIds),
    ).catch(() => []) : [],
  ]);
  const linkedTemplates = new Map([...templates, ...children].map((template) => [template.id, template]));
  const priceChecks = new Map<string, PriceCheck>();
  const now = Date.now();
  const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const formatDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : "-";
  for (const template of templates) {
    const brand = brands.find((brand) => brand.id === template.brand_id);
    const brandUpdates = updates.filter((update) => update.brand_id === template.brand_id);
    const latest = latestBrandPriceListUpdate(brandUpdates, now);
    const state = productTemplatePriceCheckState({
      template, formatDate, now, latestBrandPriceListUpdate: latest,
      brandPriceCheckIntervalDays: brand?.price_list_check_interval_days,
      scheduledBrandPriceListUpdate: scheduledBrandPriceListUpdate(brandUpdates, now),
      brandPriceBaselineAt: brandPriceBaselineDate({
        fallbackCheckedAt: brand?.last_price_list_checked_at,
        latestBrandPriceListUpdate: latest,
        now,
      }),
    });
    const checkedByName = checkers.find((profile) => profile.id === template.last_price_checked_by)?.full_name?.trim();
    priceChecks.set(template.id, {
      checkedAt: template.last_price_checked_at ?? null,
      checkedBy: template.last_price_checked_by ?? null,
      ...(checkedByName ? { checkedByName } : {}),
      intervalDays: template.price_check_interval_days ?? null,
      note: template.price_check_note ?? null,
      state: friendlyPriceHealth(state, latest, "quotation"),
    });
  }
  const prices = Object.fromEntries(items.map(({ id, template_id, recipe }): [string, PriceResult] => {
    const template = templateMap.get(template_id);
    const priceCheck = priceChecks.get(template_id);
    if (!template || !priceCheck) return [id, { status: "needs_configure" }];
    const price = priceRecipe(template, recipe, { components, links, linkedTemplates });
    return [id, price.status === "priced" ? { ...price, priceCheck } : { status: "needs_configure", reason: price.reason }];
  }));
  return { prices, dimensions: dimensionsOf(items, templates) };
}

/** Caller must authorize price access before passing the user-session client. */
export async function loadGalleryPrices(supabase: SupabaseClient, ids: string[]): Promise<Record<string, PriceResult>> {
  return (await loadGalleryListFacts(supabase, ids, true)).prices;
}
