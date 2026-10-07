import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PriceUpdatesBrandSummaryCard, PriceUpdatesSummaryCards, type PriceUpdatesBrandSummary } from "@/components/products/price-updates-brands";
import { requireProductPricingManager } from "@/lib/auth";
import { canReviewBrandPrices } from "@/lib/products/brand-price-permissions";
import { buildSupplierPriceUpdatesView, loadSupplierPriceUpdatesInputs, summarizePriceUpdates, supplierBrandStateLabels } from "@/lib/products/supplier-price-updates-view";
import { readProductPages, supplierBusinessDate, supplierPriceListLifecycleCounts } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type PriceUpdatesSearchParams = { q?: string | string[]; state?: string | string[] };
type PriceUpdatesPageProps = { searchParams?: Promise<PriceUpdatesSearchParams> };
type Brand = { id: string; name: string };
type FamilyRow = { id: string; brand_id: string; template_name: string };
type OpenBatch = { id: string; brand_id: string; source_id: string; status: string; completed_at: string | null };

const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const stringParam = (value?: string | string[]) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const workspaceHref = (brandId: string) => `/products/price-updates/supplier-sources?brand=${brandId}`;

/**
 * Landing: Brands only. One batched read per dataset (Brands, Family ids, open review batches, shared Supplier inputs); no Family rows,
 * categories, price-list history or review rows are loaded here. Brand status comes from the shared Family and Brand resolvers.
 */
export default async function PriceUpdatesPage({ searchParams }: PriceUpdatesPageProps) {
  const { user, profile, displayName } = await requireProductPricingManager();
  const params = (await searchParams) ?? {};
  const searchQuery = stringParam(params.q).trim().toLowerCase();
  const selectedState = stringParam(params.state);
  const supabase = await createClient();
  const canReview = canReviewBrandPrices(profile?.role, profile?.account_status);

  const [brandsResult, familiesResult, openBatchesResult] = await Promise.all([
    readProductPages((from, to) => supabase.from("brands").select("id,name").eq("is_active", true).order("name", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<Brand[]>()),
    readProductPages((from, to) => supabase.from("product_templates").select("id,brand_id,template_name").eq("is_active", true).order("id", { ascending: true }).range(from, to).returns<FamilyRow[]>()),
    readProductPages((from, to) => supabase.from("supplier_price_batches").select("id,brand_id,source_id,status,completed_at").in("status", ["matching", "review", "completed", "abandoned"]).order("id", { ascending: true }).range(from, to).returns<OpenBatch[]>()),
  ]);
  if (brandsResult.error) console.error("PRICE UPDATES BRANDS ERROR", brandsResult.error.message);
  if (familiesResult.error) console.error("PRICE UPDATES FAMILIES ERROR", familiesResult.error.message);
  if (openBatchesResult.error) console.error("PRICE UPDATES REVIEWS ERROR", openBatchesResult.error.message);
  const brandList = brandsResult.data ?? [], familyList = familiesResult.data ?? [];

  const { definitions, facts } = await loadSupplierPriceUpdatesInputs(supabase, brandList.map((brand) => brand.id));
  const views = buildSupplierPriceUpdatesView({
    businessDate: supplierBusinessDate(),
    brands: brandList,
    families: familyList.map((family) => ({ id: family.id, brandId: family.brand_id, name: family.template_name })),
    definitions, facts, legacyDetail: () => "Manual price check",
  });
  const summaries: PriceUpdatesBrandSummary[] = views.map((view) => {
    const versions = definitions.filter((definition) => definition.brandId === view.brandId && definition.isActive).flatMap((definition) => definition.versions.map((version) => ({ ...version, definition_id: definition.id })));
    const counts = supplierPriceListLifecycleCounts(versions, (openBatchesResult.data ?? []).filter((batch) => batch.brand_id === view.brandId), supplierBusinessDate());
    return { view, href: workspaceHref(view.brandId), priceLists: counts.current, reviewsInProgress: counts.updates, upcomingLists: counts.upcoming };
  });
  const visible = summaries.filter(({ view }) => (!searchQuery || view.brandName.toLowerCase().includes(searchQuery)) && (!selectedState || view.state === selectedState));
  const totals = summarizePriceUpdates(views);

  return (
    <ErpAppShell title="Price Updates" description="Choose a Brand to review its Supplier price lists." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs text-zinc-500">Which Brand needs attention?</p><h2 className="text-base font-semibold text-zinc-950">Price status by Brand</h2></div>
          {canReview ? <Link href="/products/price-updates/supplier-sources?tab=import" className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">Import new price list</Link> : null}
        </div>

        <PriceUpdatesSummaryCards summary={totals} />

        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" method="get">
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Search<input name="q" defaultValue={stringParam(params.q)} placeholder="Brand name" className={`${input} min-w-64`} /></label>
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Status<select name="state" defaultValue={selectedState} className={`${input} min-w-48`}><option value="">All statuses</option>{Object.entries(supplierBrandStateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Apply</button>
        </form>

        {visible.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600">No Brands match these filters.</p> : null}
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Brands">{visible.map((summary) => <PriceUpdatesBrandSummaryCard key={summary.view.brandId} summary={summary} />)}</ul>
      </div>
    </ErpAppShell>
  );
}
