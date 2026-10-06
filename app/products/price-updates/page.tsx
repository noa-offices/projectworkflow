import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PriceUpdatesReview, type PriceUpdatesReviewRow } from "@/components/products/price-updates-review";
import { PriceUpdatesBrandCard, PriceUpdatesStatusLegend, PriceUpdatesSummaryCards, type PriceUpdatesHrefs } from "@/components/products/price-updates-brands";
import { requireProductPricingManager } from "@/lib/auth";
import { formatMoney } from "@/lib/currencies";
import { canReviewBrandPrices } from "@/lib/products/brand-price-permissions";
import { supplierFamilyStatusLabels, type SupplierFamilyPriceStatus, type SupplierFamilyPriceStatusKey } from "@/lib/products/supplier-family-status";
import { buildSupplierPriceUpdatesView, filterPriceUpdatesView, loadSupplierPriceUpdatesInputs, summarizePriceUpdates } from "@/lib/products/supplier-price-updates-view";
import { supplierBusinessDate } from "@/lib/products/supplier-price-repository";
import { brandPriceBaselineDate, latestBrandPriceListUpdate, scheduledBrandPriceListUpdate, productTemplatePriceCheckState } from "@/lib/product-price-check";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type PriceUpdatesSearchParams = { brand?: string | string[]; currency?: string | string[]; q?: string | string[]; status?: string | string[] };
type PriceUpdatesPageProps = { searchParams?: Promise<PriceUpdatesSearchParams> };
type Brand = { id: string; default_currency: string | null; last_price_list_checked_at: string | null; name: string; price_list_check_interval_days: number | null; price_list_check_note: string | null };
type Category = { id: string; brand_id: string; name: string; parent_id: string | null };
type ProductTemplate = {
  creation_legacy: boolean; id: string; brand_id: string; created_at: string | null; currency: string; default_unit_price: number; description: string | null; item_code: string | null;
  last_price_checked_at: string | null; main_category_id: string | null; price_check_interval_days: number | null; price_check_note: string | null; sub_category_id: string | null; template_code: string | null; template_name: string;
};
type BrandPriceListUpdate = { coverage_mode: string; id: string; brand_id: string; created_at: string | null; effective_from: string | null; received_at: string | null; status: string; title: string | null };

const statusOptions: Array<[SupplierFamilyPriceStatusKey, string]> = [
  ["price_checked", supplierFamilyStatusLabels.price_checked], ["partially_checked", supplierFamilyStatusLabels.partially_checked], ["update_available", supplierFamilyStatusLabels.update_available],
  ["in_review", supplierFamilyStatusLabels.in_review], ["ready_to_complete", supplierFamilyStatusLabels.ready_to_complete], ["needs_attention", supplierFamilyStatusLabels.needs_attention],
  ["no_price_list", supplierFamilyStatusLabels.no_price_list], ["legacy_manual", supplierFamilyStatusLabels.legacy_manual],
];
const statusKeys = new Set<string>(statusOptions.map(([key]) => key));
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const primaryButton = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800";

function stringParam(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
function templateSearchText(template: ProductTemplate, brandName: string, categoryName: string) {
  return [template.template_name, template.template_code, template.item_code, template.description, brandName, categoryName, template.currency].filter(Boolean).join(" ").toLowerCase();
}

/** Where each Family's primary action goes. Existing routes only; no new review screen. */
function familyActionFor(status: SupplierFamilyPriceStatus, brandId: string): { label: string; href: string } {
  const base = "/products/price-updates/supplier-sources";
  const source = status.source ? `brand=${brandId}&source=${status.source.sourceId}` : `brand=${brandId}`;
  switch (status.status) {
    case "ready_to_complete": return { label: "Complete review", href: `${base}?${source}&tab=current&view=complete` };
    case "needs_attention":
    case "in_review": return { label: "Continue review", href: `${base}?${source}&tab=current&view=family` };
    case "update_available": return { label: "Open review", href: `${base}?${source}&tab=current&view=family` };
    case "price_checked":
    case "partially_checked": return { label: "View review", href: `${base}?${source}&tab=current&view=family` };
    case "no_price_list": return { label: "Import price list", href: `${base}?brand=${brandId}&tab=import` };
    default: return { label: "Manual price check", href: `/products?brand=${brandId}` };
  }
}

export default async function PriceUpdatesPage({ searchParams }: PriceUpdatesPageProps) {
  const { user, profile, displayName } = await requireProductPricingManager();
  const params = (await searchParams) ?? {};
  const searchQuery = stringParam(params.q).trim();
  const selectedBrand = stringParam(params.brand);
  const selectedStatus = stringParam(params.status);
  const selectedCurrency = stringParam(params.currency);
  const supabase = await createClient();
  const canReview = canReviewBrandPrices(profile?.role, profile?.account_status);

  const { data: brands, error: brandsError } = await supabase.from("brands").select("id,name,default_currency,last_price_list_checked_at,price_list_check_interval_days,price_list_check_note").eq("is_active", true).order("name", { ascending: true }).returns<Brand[]>();
  const { data: categories, error: categoriesError } = await supabase.from("product_categories").select("id,brand_id,parent_id,name").eq("is_active", true).order("brand_id", { ascending: true }).order("sort_order", { ascending: true }).order("name", { ascending: true }).returns<Category[]>();
  const { data: templates, error: templatesError } = await supabase.from("product_templates")
    .select("creation_legacy,id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,currency,default_unit_price,last_price_checked_at,price_check_interval_days,price_check_note,created_at")
    .eq("is_active", true).order("brand_id", { ascending: true }).order("template_name", { ascending: true }).returns<ProductTemplate[]>();
  const { data: priceListUpdates, error: priceListUpdatesError } = await supabase.from("brand_price_list_updates").select("coverage_mode,id,brand_id,title,effective_from,received_at,created_at,status")
    .in("status", ["draft", "active"]).order("effective_from", { ascending: false, nullsFirst: false }).order("received_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).returns<BrandPriceListUpdate[]>();
  if (brandsError) console.error("PRICE UPDATES BRANDS ERROR", brandsError.message);
  if (categoriesError) console.error("PRICE UPDATES CATEGORIES ERROR", categoriesError.message);
  if (templatesError) console.error("PRICE UPDATES TEMPLATES ERROR", templatesError.message);
  if (priceListUpdatesError) console.error("PRICE UPDATES PRICE LIST ERROR", priceListUpdatesError.message);

  const brandList = brands ?? [];
  const categoryList = categories ?? [];
  const templateList = templates ?? [];
  const priceListUpdateList = priceListUpdates ?? [];
  const brandById = new Map(brandList.map((brand) => [brand.id, brand]));
  const categoryById = new Map(categoryList.map((category) => [category.id, category]));
  const latestPriceListUpdateByBrand = new Map<string, BrandPriceListUpdate | null>();
  const brandPriceBaselineByBrand = new Map<string, string | null>();
  for (const brand of brandList) {
    const latestUpdate = latestBrandPriceListUpdate(priceListUpdateList.filter((update) => update.brand_id === brand.id));
    latestPriceListUpdateByBrand.set(brand.id, latestUpdate);
    brandPriceBaselineByBrand.set(brand.id, brandPriceBaselineDate({ fallbackCheckedAt: brand.last_price_list_checked_at, latestBrandPriceListUpdate: latestUpdate }));
  }

  // Manual / legacy interval status: used only for Families with no Supplier workflow coverage (the resolver decides which).
  const legacyRows = templateList.map<PriceUpdatesReviewRow>((template) => {
    const brand = brandById.get(template.brand_id);
    const mainCategory = template.main_category_id ? categoryById.get(template.main_category_id)?.name ?? "" : "";
    const subCategory = template.sub_category_id ? categoryById.get(template.sub_category_id)?.name ?? "" : "";
    const categoryName = [mainCategory, subCategory].filter(Boolean).join(" / ") || "No category";
    const status = productTemplatePriceCheckState({
      brandPriceCheckIntervalDays: brand?.price_list_check_interval_days,
      scheduledBrandPriceListUpdate: scheduledBrandPriceListUpdate(priceListUpdateList.filter((update) => update.brand_id === template.brand_id)),
      brandPriceBaselineAt: brandPriceBaselineByBrand.get(template.brand_id),
      formatDate,
      latestBrandPriceListUpdate: latestPriceListUpdateByBrand.get(template.brand_id),
      template,
    });
    return {
      brandName: brand?.name ?? "Unknown brand", categoryName, editHref: `/products/manage?template=${template.id}&editTemplate=${template.id}`, id: template.id,
      lastPriceListDateLabel: formatDate(brandPriceBaselineByBrand.get(template.brand_id)), priceStatusDetail: status.detail, priceStatusKey: status.key, priceStatusLabel: status.label, priceStatusTone: status.tone,
      searchText: templateSearchText(template, brand?.name ?? "", categoryName), sourceCurrency: template.currency, sourcePriceLabel: formatMoney(template.currency, template.default_unit_price),
      templateCodeLabel: [template.template_code, template.item_code].filter(Boolean).join(" / ") || "No template or item code", templateName: template.template_name, viewHref: `/products?template=${template.id}`,
    };
  });
  const legacyDetailById = new Map(legacyRows.map((row) => [row.id, row.priceStatusDetail]));

  // Shared resolvers: batched inputs, one Family pass, one Brand pass. No status logic lives in this page.
  const { definitions, facts } = await loadSupplierPriceUpdatesInputs(supabase, brandList.map((brand) => brand.id));
  const views = buildSupplierPriceUpdatesView({
    businessDate: supplierBusinessDate(),
    brands: brandList.map((brand) => ({ id: brand.id, name: brand.name })),
    families: templateList.map((template) => ({ id: template.id, brandId: template.brand_id, name: template.template_name })),
    definitions, facts,
    legacyDetail: (familyId) => legacyDetailById.get(familyId) ?? "Manual price check",
  });
  const summary = summarizePriceUpdates(views);
  const visible = filterPriceUpdatesView(views, { q: searchQuery, brandId: selectedBrand, status: statusKeys.has(selectedStatus) ? selectedStatus as SupplierFamilyPriceStatusKey : "" });
  const legacyIds = new Set(views.flatMap((view) => view.legacyFamilyIds));
  const legacyTableRows = legacyRows.filter((row) => legacyIds.has(row.id));

  const hrefs: PriceUpdatesHrefs = {
    familyAction: (status, brandId) => familyActionFor(status, brandId),
    sourceHref: (brandId, group) => `/products/price-updates/supplier-sources?brand=${brandId}&source=${group.current?.sourceId ?? ""}&tab=current&view=summary`,
  };

  return (
    <ErpAppShell title="Price Updates" description="Review current Supplier price lists and Family pricing status." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs text-zinc-500">Brand → Supplier price list → Product Family</p><h2 className="text-base font-semibold text-zinc-950">Price status by Brand</h2></div>
          {canReview ? <Link href="/products/price-updates/supplier-sources" className={primaryButton}>Supplier Sources / Price Review</Link> : null}
        </div>

        <PriceUpdatesSummaryCards summary={summary} />

        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" method="get">
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Search<input name="q" defaultValue={searchQuery} placeholder="Brand, Family, source or price list" className={`${input} min-w-64`} /></label>
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Brand<select name="brand" defaultValue={selectedBrand} className={`${input} min-w-44`}><option value="">All Brands</option>{brandList.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Status<select name="status" defaultValue={selectedStatus} className={`${input} min-w-48`}><option value="">All statuses</option>{statusOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Apply</button>
        </form>

        <div className="space-y-3" aria-label="Brands">
          {visible.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600">No Brands match these filters.</p> : null}
          {visible.map((view) => <PriceUpdatesBrandCard key={view.brandId} view={view} hrefs={hrefs} />)}
        </div>
        <PriceUpdatesStatusLegend />

        {legacyTableRows.length > 0 ? (
          <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-950">Manual / legacy price checks <span className="font-normal text-zinc-600">· {legacyTableRows.length} {legacyTableRows.length === 1 ? "Product" : "Products"} without Supplier coverage</span></summary>
            <div className="mt-3"><PriceUpdatesReview initialFilters={{ brand: selectedBrand, currency: selectedCurrency, query: searchQuery, status: selectedStatus }} rows={legacyTableRows} /></div>
          </details>
        ) : null}
      </div>
    </ErpAppShell>
  );
}
