import Link from "next/link";
import { Suspense } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ListPageSkeleton } from "@/components/layout/list-page-skeleton";
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
  // Auth, role checks and redirects run here, before the Suspense boundary.
  const auth = await requireProductPricingManager();
  const { user, profile, displayName } = auth;

  return (
    <ErpAppShell title="Price Updates" description="Choose a Brand to review its Supplier price lists." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
      <Suspense fallback={<ListPageSkeleton />}>
        <PriceUpdatesContent searchParams={searchParams} auth={auth} />
      </Suspense>
    </ErpAppShell>
  );
}

async function PriceUpdatesContent({ searchParams, auth }: PriceUpdatesPageProps & { auth: Awaited<ReturnType<typeof requireProductPricingManager>> }) {
  const { profile } = auth;
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

  // Not awaited: the page frame, filters and brand names show at once; the supplier facts stream into the two parts below.
  const resultPromise: Promise<PriceUpdatesResult> = loadSupplierPriceUpdatesInputs(supabase, brandList.map((brand) => brand.id)).then(({ definitions, facts, failedBrandIds }) => {
    // A Brand whose supplier facts could not be read gets a notice card instead of a status that would be wrong.
    const failedBrands = new Set(failedBrandIds);
    const views = buildSupplierPriceUpdatesView({
      businessDate: supplierBusinessDate(),
      brands: brandList,
      families: familyList.map((family) => ({ id: family.id, brandId: family.brand_id, name: family.template_name })),
      definitions, facts, legacyDetail: () => "Manual price check",
    });
    const summaries: PriceUpdatesBrandSummary[] = views.filter((view) => !failedBrands.has(view.brandId)).map((view) => {
      const versions = definitions.filter((definition) => definition.brandId === view.brandId && definition.isActive).flatMap((definition) => definition.versions.map((version) => ({ ...version, definition_id: definition.id })));
      const counts = supplierPriceListLifecycleCounts(versions, (openBatchesResult.data ?? []).filter((batch) => batch.brand_id === view.brandId), supplierBusinessDate());
      return { view, href: workspaceHref(view.brandId), priceLists: counts.current, reviewsInProgress: counts.updates, upcomingLists: counts.upcoming };
    });
    return { failedBrands, summaries, totals: summarizePriceUpdates(views.filter((view) => !failedBrands.has(view.brandId))) };
  });
  resultPromise.catch(() => undefined);
  const searchedBrands = brandList.filter((brand) => !searchQuery || brand.name.toLowerCase().includes(searchQuery));

  return (
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs text-zinc-500">Which Brand needs attention?</p><h2 className="text-base font-semibold text-zinc-950">Price status by Brand</h2></div>
          {canReview ? <Link href="/products/price-updates/supplier-sources?tab=import" className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">Import new price list</Link> : null}
        </div>

        <Suspense fallback={<p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">Checking price status…</p>}>
          <PriceUpdatesTotals resultPromise={resultPromise} />
        </Suspense>

        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" method="get">
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Search<input name="q" defaultValue={stringParam(params.q)} placeholder="Brand name" className={`${input} min-w-64`} /></label>
          <label className="grid gap-1 text-xs font-semibold text-zinc-700">Status<select name="state" defaultValue={selectedState} className={`${input} min-w-48`}><option value="">All statuses</option>{Object.entries(supplierBrandStateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <button className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Apply</button>
        </form>

        <Suspense fallback={
          // Pending: every Brand matching the search, without a status; the status filter applies once the data arrives.
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Brands" aria-busy="true">
            {searchedBrands.map((brand) => (
              <li key={brand.id} className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
                <p className="font-semibold text-zinc-950">{brand.name}</p>
                <p className="mt-1 text-zinc-500">Checking price status…</p>
                <Link href={workspaceHref(brand.id)} className="mt-3 inline-flex text-xs font-semibold text-emerald-900 hover:text-emerald-800">Open Brand workspace</Link>
              </li>
            ))}
          </ul>
        }>
          <PriceUpdatesBrandCards brandList={brandList} resultPromise={resultPromise} searchQuery={searchQuery} selectedState={selectedState} />
        </Suspense>
      </div>
  );
}

type PriceUpdatesResult = { failedBrands: Set<string>; summaries: PriceUpdatesBrandSummary[]; totals: ReturnType<typeof summarizePriceUpdates> };

async function settle(resultPromise: Promise<PriceUpdatesResult>) {
  try {
    return await resultPromise;
  } catch (error) {
    console.error("PRICE UPDATES SUPPLIER INPUTS ERROR", error instanceof Error ? error.message : error);
    return null;
  }
}

async function PriceUpdatesTotals({ resultPromise }: { resultPromise: Promise<PriceUpdatesResult> }) {
  const result = await settle(resultPromise);
  if (!result) return <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Could not load price status. Reload to try again.</p>;
  return <PriceUpdatesSummaryCards summary={result.totals} />;
}

async function PriceUpdatesBrandCards({ brandList, resultPromise, searchQuery, selectedState }: { brandList: Brand[]; resultPromise: Promise<PriceUpdatesResult>; searchQuery: string; selectedState: string }) {
  const result = await settle(resultPromise);
  const failedBrands = result ? result.failedBrands : new Set(brandList.map((brand) => brand.id));
  const visible = (result?.summaries ?? []).filter(({ view }) => (!searchQuery || view.brandName.toLowerCase().includes(searchQuery)) && (!selectedState || view.state === selectedState));
  const failedVisible = brandList.filter((brand) => failedBrands.has(brand.id) && !selectedState && (!searchQuery || brand.name.toLowerCase().includes(searchQuery)));

  return (
    <>
      {visible.length === 0 && failedVisible.length === 0 ? <p className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600">No Brands match these filters.</p> : null}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Brands">
        {visible.map((summary) => <PriceUpdatesBrandSummaryCard key={summary.view.brandId} summary={summary} />)}
        {failedVisible.map((brand) => (
          <li key={brand.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-zinc-950">{brand.name}</p>
            <p className="mt-1 text-amber-900">Could not load price status. Reload to try again.</p>
            <Link href={workspaceHref(brand.id)} className="mt-3 inline-flex text-xs font-semibold text-emerald-900 hover:text-emerald-800">Open Brand workspace</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
