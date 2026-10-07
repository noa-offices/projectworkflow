import { resolveSupplierBrandPriceStatus, resolveSupplierFamilyPriceStatus, supplierFamilyStatusLabels, type SupplierBrandPriceState, type SupplierBrandPriceStatus, type SupplierFamilyPriceStatus, type SupplierFamilyPriceStatusKey, type SupplierResponsibilityInput, type SupplierVersionRef } from "./supplier-family-status";
import { mapSupplierReads, readProductPages, resolveApplicableSupplierSourceVersion, supplierFamilyReviewFacts, upcomingSupplierSourceVersions, type SupplierFamilyReviewFact } from "./supplier-price-repository";
import type { SupabaseClient } from "@supabase/supabase-js";

// Price Updates view model. Pure grouping and filtering over the shared resolvers; the page and components only render this.
// No status rule lives here: Family and Brand statuses come from resolveSupplierFamilyPriceStatus and resolveSupplierBrandPriceStatus.

export const supplierBrandStateLabels: Record<SupplierBrandPriceState, string> = {
  current: "Current", update_available: "Price update available", partially_checked: "Partially checked", needs_attention: "Needs attention",
  in_review: "In review", ready_to_complete: "Ready to complete", legacy_manual: "Manual price checks",
};
export type PriceUpdatesBrandInput = { id: string; name: string };
export type PriceUpdatesFamilyInput = { id: string; brandId: string; name: string };
export type PriceUpdatesDefinitionInput = { id: string; brandId: string; name: string; isActive: boolean; familyIds: string[]; versions: SupplierVersionRef[] };
export type PriceUpdatesFamilyStatus = SupplierFamilyPriceStatus & { familyName: string };
export type PriceUpdatesSourceGroup = {
  definitionId: string; definitionName: string;
  current: { sourceId: string; title: string; effectiveFrom: string | null } | null;
  upcoming: { title: string; effectiveFrom: string } | null;
  families: PriceUpdatesFamilyStatus[];
};
export type PriceUpdatesBrandView = {
  brandId: string; brandName: string;
  state: SupplierBrandPriceState; stateLabel: string; progress: SupplierBrandPriceStatus;
  sources: PriceUpdatesSourceGroup[];
  legacyFamilyIds: string[];
  families: PriceUpdatesFamilyStatus[];
};
export type PriceUpdatesSummary = { brandsCurrent: number; updatesAvailable: number; partiallyChecked: number; needsAttention: number; upcomingLists: number };
export type PriceUpdatesFilters = { q?: string; brandId?: string; status?: SupplierFamilyPriceStatusKey | "" };

/** Business-date aware, pure. Families with no Supplier responsibility come back as legacy_manual, using the caller's legacy detail. */
export function buildSupplierPriceUpdatesView(input: {
  businessDate: string;
  brands: PriceUpdatesBrandInput[];
  families: PriceUpdatesFamilyInput[];
  definitions: PriceUpdatesDefinitionInput[];
  facts: SupplierFamilyReviewFact[];
  legacyDetail: (familyId: string) => string;
}): PriceUpdatesBrandView[] {
  return input.brands.map((brand) => {
    const families = input.families.filter((family) => family.brandId === brand.id);
    const definitions = input.definitions.filter((definition) => definition.brandId === brand.id && definition.isActive);
    const responsibilities: SupplierResponsibilityInput[] = definitions.flatMap((definition) => definition.familyIds.map((familyId) => ({ templateId: familyId, definitionId: definition.id, definitionName: definition.name, versions: definition.versions })));
    const statuses = resolveSupplierFamilyPriceStatus({
      businessDate: input.businessDate,
      families: families.map((family) => ({ templateId: family.id, brandId: brand.id })),
      responsibilities,
      facts: input.facts.filter((fact) => fact.brandId === brand.id),
      legacyDetail: input.legacyDetail,
    });
    const upcomingCount = statuses.filter((status) => status.upcoming).length;
    const progress = resolveSupplierBrandPriceStatus(statuses, upcomingCount);
    const familyName = new Map(families.map((family) => [family.id, family.name]));
    const named: PriceUpdatesFamilyStatus[] = statuses.map((status) => ({ ...status, familyName: familyName.get(status.familyId) ?? "" }));
    const sources: PriceUpdatesSourceGroup[] = definitions.map((definition) => {
      const applicable = resolveApplicableSupplierSourceVersion(definition.versions, input.businessDate);
      const upcoming = upcomingSupplierSourceVersions(definition.versions, input.businessDate)[0];
      // A Family belongs under the definition of its resolved responsibility; multi-source Families show their worst status here.
      const placed = named.filter((status) => (status.source?.definitionId ?? responsibilities.find((item) => item.templateId === status.familyId)?.definitionId) === definition.id);
      return {
        definitionId: definition.id, definitionName: definition.name,
        current: applicable ? { sourceId: applicable.id, title: applicable.title, effectiveFrom: applicable.effective_from } : null,
        upcoming: upcoming ? { title: upcoming.title, effectiveFrom: upcoming.effective_from ?? "" } : null,
        families: [...placed].sort((a, b) => a.familyName.localeCompare(b.familyName)),
      };
    }).filter((group) => group.families.length > 0 || group.current !== null || group.upcoming !== null);
    const legacyFamilyIds = named.filter((status) => status.status === "legacy_manual").map((status) => status.familyId);
    return { brandId: brand.id, brandName: brand.name, state: progress.state, stateLabel: supplierBrandStateLabels[progress.state], progress, sources, legacyFamilyIds, families: named };
  });
}

/** Summary over Brand states only: never counts individual Product rows. */
export function summarizePriceUpdates(views: PriceUpdatesBrandView[]): PriceUpdatesSummary {
  const count = (state: SupplierBrandPriceState) => views.filter((view) => view.state === state).length;
  return {
    brandsCurrent: count("current"), updatesAvailable: count("update_available"), partiallyChecked: count("partially_checked"), needsAttention: count("needs_attention"),
    upcomingLists: views.reduce((total, view) => total + view.progress.upcomingCount, 0),
  };
}

/** Search and filter over Brand, Family, source and price-list text. Keeps a Brand when any of its visible Families match. */
export function filterPriceUpdatesView(views: PriceUpdatesBrandView[], filters: PriceUpdatesFilters): PriceUpdatesBrandView[] {
  const query = (filters.q ?? "").trim().toLowerCase();
  const matchesText = (...values: Array<string | null | undefined>) => !query || values.some((value) => (value ?? "").toLowerCase().includes(query));
  return views.filter((view) => !filters.brandId || view.brandId === filters.brandId).flatMap((view) => {
    const sources = view.sources.map((group) => ({
      ...group,
      families: group.families.filter((status) => (!filters.status || status.status === filters.status) && matchesText(view.brandName, group.definitionName, group.current?.title, status.familyName, status.detail)),
    })).filter((group) => group.families.length > 0 || (!query && !filters.status));
    const families = view.families.filter((status) => (!filters.status || status.status === filters.status) && matchesText(view.brandName, status.familyName, status.detail));
    // A Brand-name match only counts when no status filter is active; otherwise the Brand must have a visible matching Family.
    const brandMatches = !filters.status && matchesText(view.brandName);
    const hasVisibleFamily = families.length > 0 || sources.some((group) => group.families.length > 0);
    if (!hasVisibleFamily && !brandMatches && (query || filters.status)) return [];
    const legacyVisible = !filters.status || filters.status === "legacy_manual";
    return [{ ...view, sources, families, legacyFamilyIds: legacyVisible ? view.legacyFamilyIds : [] }];
  });
}

/** Shared inputs for every Brand, with bounded fact loading and complete, paged metadata reads. */
export async function loadSupplierPriceUpdatesInputs(client: SupabaseClient, brandIds: string[]) {
  if (!brandIds.length) return { definitions: [], facts: [] };
  const [definitionsResult, versionsResult, factsByBrand] = await Promise.all([
    readProductPages((from, to) => client.from("supplier_source_definitions").select("id,brand_id,name,is_active").in("brand_id", brandIds).order("id").range(from, to).returns<Array<{ id: string; brand_id: string; name: string; is_active: boolean }>>()),
    readProductPages((from, to) => client.from("supplier_source_versions").select("id,definition_id,title,status,effective_from,created_at").in("brand_id", brandIds).eq("status", "imported").order("id").range(from, to).returns<Array<SupplierVersionRef & { definition_id: string | null }>>()),
    mapSupplierReads(brandIds, (brandId) => supplierFamilyReviewFacts(client, brandId)),
  ]);
  if (definitionsResult.error) throw Error(`Supplier definitions: ${definitionsResult.error.message}`);
  if (versionsResult.error) throw Error(`Supplier versions: ${versionsResult.error.message}`);
  const definitionIds = (definitionsResult.data ?? []).map((row) => row.id);
  const familiesResult = definitionIds.length
    ? await readProductPages((from, to) => client.from("supplier_source_definition_families").select("definition_id,template_id").in("definition_id", definitionIds).order("definition_id").order("template_id").range(from, to).returns<Array<{ definition_id: string; template_id: string }>>())
    : { data: [], error: null };
  if (familiesResult.error) throw Error(`Supplier coverage: ${familiesResult.error.message}`);
  const definitions: PriceUpdatesDefinitionInput[] = (definitionsResult.data ?? []).map((row) => ({
    id: row.id, brandId: row.brand_id, name: row.name, isActive: row.is_active,
    familyIds: (familiesResult.data ?? []).filter((link) => link.definition_id === row.id).map((link) => link.template_id),
    versions: (versionsResult.data ?? []).filter((version) => version.definition_id === row.id).map((version) => ({ id: version.id, title: version.title, status: version.status, effective_from: version.effective_from, created_at: version.created_at })),
  }));
  return { definitions, facts: factsByBrand.flat() };
}

export { supplierFamilyStatusLabels };
