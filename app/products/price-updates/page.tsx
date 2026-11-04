import Link from "next/link";
import { Suspense } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ListPageSkeleton } from "@/components/layout/list-page-skeleton";
import { PriceUpdatesBrowser, type PriceUpdatesCardData } from "@/components/products/price-updates-browser";
import type { PriceUpdatesBrandSummary } from "@/components/products/price-updates-brands";
import { manualProgressText } from "@/lib/products/manual-brand-products";
import { parsePriceUpdatesFilters, type PriceUpdatesFilters } from "@/lib/products/price-updates-filter";
import { requireProductPricingManager } from "@/lib/auth";
import { canApproveBrandPrices, canReviewBrandPrices } from "@/lib/products/brand-price-permissions";
import { loadManualPriceState } from "@/lib/products/manual-price-check";
import { loadBrandPriceAnnouncements, type AnnouncementView } from "@/lib/products/price-announcements";
import { buildSupplierPriceUpdatesView, loadSupplierPriceUpdatesInputs, summarizePriceUpdates, supplierBrandStateLabels } from "@/lib/products/supplier-price-updates-view";
import { readProductPages, supplierBusinessDate, supplierPriceListLifecycleCounts } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type PriceUpdatesSearchParams = { q?: string | string[]; state?: string | string[]; status?: string | string[]; method?: string | string[] };
type PriceUpdatesPageProps = { searchParams?: Promise<PriceUpdatesSearchParams> };
type Brand = { id: string; name: string };
type FamilyRow = { id: string; brand_id: string; template_name: string; pricing_version: number | string };
type OpenBatch = { id: string; brand_id: string; source_id: string; status: string; completed_at: string | null };

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
  const supabase = await createClient();
  const canReview = canReviewBrandPrices(profile?.role, profile?.account_status);
  const canManageManual = canApproveBrandPrices(profile?.role, profile?.account_status);

  const [brandsResult, familiesResult, openBatchesResult] = await Promise.all([
    readProductPages((from, to) => supabase.from("brands").select("id,name").eq("is_active", true).order("name", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<Brand[]>()),
    readProductPages((from, to) => supabase.from("product_templates").select("id,brand_id,template_name,pricing_version").eq("is_active", true).order("id", { ascending: true }).range(from, to).returns<FamilyRow[]>()),
    readProductPages((from, to) => supabase.from("supplier_price_batches").select("id,brand_id,source_id,status,completed_at").in("status", ["matching", "review", "completed", "abandoned"]).order("id", { ascending: true }).range(from, to).returns<OpenBatch[]>()),
  ]);
  if (brandsResult.error) console.error("PRICE UPDATES BRANDS ERROR", brandsResult.error.message);
  if (familiesResult.error) console.error("PRICE UPDATES FAMILIES ERROR", familiesResult.error.message);
  if (openBatchesResult.error) console.error("PRICE UPDATES REVIEWS ERROR", openBatchesResult.error.message);
  const brandList = brandsResult.data ?? [], familyList = familiesResult.data ?? [];

  // Not awaited: the page frame, filters and brand names show at once; the supplier facts stream into the two parts below.
  const resultPromise: Promise<PriceUpdatesResult> = Promise.all([loadSupplierPriceUpdatesInputs(supabase, brandList.map((brand) => brand.id)), brandList.length ? loadManualPriceState(supabase, brandList.map((brand) => brand.id)) : Promise.resolve(new Map())]).then(([{ definitions, facts, failedBrandIds }, manualState]) => {
    // A Brand whose supplier facts could not be read gets a notice card instead of a status that would be wrong.
    const failedBrands = new Set(failedBrandIds);
    const views = buildSupplierPriceUpdatesView({
      businessDate: supplierBusinessDate(),
      brands: brandList,
      families: familyList.map((family) => ({ id: family.id, brandId: family.brand_id, name: family.template_name, pricingVersion: String(family.pricing_version) })),
      definitions, facts, manual: manualState, legacyDetail: () => "Manual price check",
    });
    const summaries: PriceUpdatesBrandSummary[] = views.filter((view) => !failedBrands.has(view.brandId)).map((view) => {
      const versions = definitions.filter((definition) => definition.brandId === view.brandId && definition.isActive).flatMap((definition) => definition.versions.map((version) => ({ ...version, definition_id: definition.id })));
      const counts = supplierPriceListLifecycleCounts(versions, (openBatchesResult.data ?? []).filter((batch) => batch.brand_id === view.brandId), supplierBusinessDate());
      const brandManual = manualState.get(view.brandId);
      const manual = { manual: Boolean(brandManual), releases: [...(brandManual?.releases ?? [])].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt)).map((release) => ({ id: release.id, effectiveFrom: release.effectiveFrom, note: release.note, ...(release.createdByName ? { createdByName: release.createdByName } : {}) })), canManage: canManageManual, today: supplierBusinessDate(), dueCount: view.families.filter((status) => status.status === "price_update_due" || status.status === "edited_since_check").length };
      return { view, href: workspaceHref(view.brandId), priceLists: counts.current, reviewsInProgress: counts.updates, upcomingLists: counts.upcoming, manual };
    });
    return { failedBrands, summaries, totals: summarizePriceUpdates(views.filter((view) => !failedBrands.has(view.brandId))) };
  });
  resultPromise.catch(() => undefined);
  const filters = parsePriceUpdatesFilters((key) => stringParam(params[key as keyof PriceUpdatesSearchParams]), Object.keys(supplierBrandStateLabels));
  const searchedBrands = brandList.filter((brand) => !filters.q || brand.name.toLowerCase().includes(filters.q.toLowerCase()));

  return (
    <div className="space-y-5 px-5 py-5 text-sm sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div><p className="text-xs text-zinc-500">Which Brand needs attention?</p><h2 className="mt-1 text-lg font-semibold text-zinc-950">Price status by Brand</h2></div>
        {canReview ? <Link href="/products/price-updates/supplier-sources?tab=import" className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">Import new price list</Link> : null}
      </div>

      <Suspense fallback={
        // Pending: every Brand matching the search, without a status; the chips and filters appear once the data arrives.
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Brands" aria-busy="true">
          {searchedBrands.map((brand) => (
            <li key={brand.id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
              <p className="font-semibold text-zinc-950">{brand.name}</p>
              <p className="mt-1 text-xs text-zinc-500">Checking price status…</p>
              <Link href={workspaceHref(brand.id)} className="mt-2 inline-flex text-xs font-semibold text-emerald-900 hover:text-emerald-800">Open Brand</Link>
            </li>
          ))}
        </ul>
      }>
        <PriceUpdatesBrowserLoader brandList={brandList} resultPromise={resultPromise} filters={filters} canEditBrand={canManageManual} announcementsPromise={loadBrandPriceAnnouncements(supabase, brandList.map((brand) => brand.id)).catch(() => new Map<string, AnnouncementView>())} />
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

async function PriceUpdatesBrowserLoader({ brandList, resultPromise, filters, canEditBrand, announcementsPromise }: { brandList: Brand[]; resultPromise: Promise<PriceUpdatesResult>; filters: PriceUpdatesFilters; canEditBrand: boolean; announcementsPromise: Promise<Map<string, AnnouncementView>> }) {
  const result = await settle(resultPromise);
  const announcements = await announcementsPromise;
  const failedBrands = result ? result.failedBrands : new Set(brandList.map((brand) => brand.id));
  const today = supplierBusinessDate();
  const byId = new Map((result?.summaries ?? []).map((summary) => [summary.view.brandId, summary]));
  const cards: PriceUpdatesCardData[] = brandList.map((brand) => {
    const summary = byId.get(brand.id);
    if (!summary || failedBrands.has(brand.id)) return { brandId: brand.id, name: brand.name, state: "", stateLabel: "", method: "codes", href: workspaceHref(brand.id), failed: true };
    const { view } = summary, p = view.progress;
    const base = { brandId: brand.id, name: view.brandName, state: view.state, stateLabel: view.stateLabel, href: summary.href, announcement: announcements.get(brand.id) ?? null, today };
    if (summary.manual?.manual) {
      const latest = summary.manual.releases.find((release) => release.effectiveFrom <= today) ?? null; // releases are newest first
      const count = (key: string) => view.families.filter((status) => status.status === key).length;
      const counts = { due: count("price_update_due"), checked: count("price_checked"), edited: count("edited_since_check"), neutral: count("legacy_manual") };
      return { ...base, method: "manual", manual: { latestRelease: latest?.effectiveFrom ?? null, countsText: manualProgressText(counts, Boolean(latest)), canManage: summary.manual.canManage, today: summary.manual.today } };
    }
    return { ...base, method: "codes", coded: { priceLists: summary.priceLists, inProgress: summary.reviewsInProgress, upcoming: summary.upcomingLists ?? 0, checked: p.checkedFamilies, applicable: p.applicableFamilies, needReview: p.updateAvailableFamilies + p.needsAttentionFamilies + p.inReviewFamilies + p.partiallyCheckedFamilies + p.readyToCompleteFamilies } };
  });
  if (!result) return <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Could not load price status. Reload to try again.</p>;
  return <PriceUpdatesBrowser cards={cards} initialFilters={filters} statusOptions={Object.entries(supplierBrandStateLabels).map(([value, label]) => ({ value, label }))} canEditBrand={canEditBrand} />;
}
