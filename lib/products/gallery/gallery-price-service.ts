import type { SupabaseClient } from "@supabase/supabase-js";
import { brandPriceBaselineDate, friendlyPriceHealth, latestBrandPriceListUpdate, productTemplatePriceCheckState, scheduledBrandPriceListUpdate, type BrandPriceListUpdateForCheck } from "@/lib/product-price-check";
import { completeGalleryRecipe, isGalleryId } from "./gallery";
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
  intervalDays: number | null;
  note: string | null;
  state: ReturnType<typeof friendlyPriceHealth>;
};
type PriceResult = { status: "needs_configure" } | (Extract<RecipePrice, { status: "priced" }> & { priceCheck: PriceCheck });

const unique = (ids: string[]) => [...new Set(ids)];
async function batch<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  // Supabase's usual response cap is 1,000. Never price a partially fetched dependency set.
  if (error || !Array.isArray(data) || data.length >= 1000) throw new Error("Gallery data incomplete");
  return data as T[];
}

/** Caller must authorize price access before passing the user-session client. */
export async function loadGalleryPrices(supabase: SupabaseClient, ids: string[]): Promise<Record<string, PriceResult>> {
  const items = await batch<{ id: string; template_id: string; recipe: unknown }>(
    supabase.from("product_gallery_items").select("id,template_id,recipe").in("id", ids).eq("is_hidden", false),
  );
  if (!items.length) return {};
  const templateIds = unique(items.map((item) => item.template_id));
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
  const [children, brands, updates] = await Promise.all([
    childIds.length && childIds.length < 500 ? batch<GalleryPriceTemplate>(supabase.from("product_templates").select(TEMPLATE_COLUMNS).in("id", childIds)) : [],
    brandIds.length ? batch<{ id: string; last_price_list_checked_at: string | null; price_list_check_interval_days: number | null }>(
      supabase.from("brands").select("id,last_price_list_checked_at,price_list_check_interval_days").in("id", brandIds),
    ) : [],
    brandIds.length ? batch<BrandPriceListUpdateForCheck & { brand_id: string }>(
      supabase.from("brand_price_list_updates").select("brand_id,title,effective_from,received_at,status,created_at,coverage_mode").in("brand_id", brandIds),
    ) : [],
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
    priceChecks.set(template.id, {
      checkedAt: template.last_price_checked_at ?? null,
      checkedBy: template.last_price_checked_by ?? null,
      intervalDays: template.price_check_interval_days ?? null,
      note: template.price_check_note ?? null,
      state: friendlyPriceHealth(state, latest, "quotation"),
    });
  }
  return Object.fromEntries(items.map(({ id, template_id, recipe }): [string, PriceResult] => {
    const template = templateMap.get(template_id);
    const priceCheck = priceChecks.get(template_id);
    if (!template || !priceCheck) return [id, { status: "needs_configure" }];
    const price = priceRecipe(template, recipe, { components, links, linkedTemplates });
    return [id, price.status === "priced" ? { ...price, priceCheck } : { status: "needs_configure" }];
  }));
}
