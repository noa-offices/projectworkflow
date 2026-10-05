import type React from "react";
import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { SupplierImportFormatWizard } from "@/components/products/supplier-import-format-wizard";
import { brandPriceListUpdateDate, latestBrandPriceListUpdate } from "@/lib/product-price-check";
import { SupplierBrandProgress, SupplierFamilyList, SupplierFamilyTable } from "@/components/products/supplier-family-review";
import { SupplierAdvancedImportSettings, SupplierCompletionControls, SupplierImportCard, SupplierReviewControls, SupplierStartReview } from "@/components/products/supplier-price-workspace-controls";
import { SupplierCompleteSummary, SupplierFinishScreen, SupplierImportDetails, SupplierCurrentPriceList, SupplierHistoryTable, SupplierImportSummary, SupplierTabs, SupplierWorkflowHeader, type CurrentPriceList, type HistoryRow, type PriceListTab, type WorkflowStep } from "@/components/products/supplier-price-workflow";
import { SupplierCoverageContext, SupplierCoverageSetup, SupplierFamilyCoverageSetup, SupplierSourceSummary, SupplierSourcesOverview, type OtherCoverage } from "@/components/products/supplier-coverage";
import { requireBrandPriceReviewer } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { createClient } from "@/lib/supabase/server";
import { SUPPLIER_BULK_LIMIT, familySections, supplierBrandMatches, supplierCoverageOverview, supplierFamilyCoverageSetup, supplierFamilyOverview, supplierFamilyRows, supplierRows, supplierSourceCoverageSuggestion, type FamilyOverview, type FamilyRow, type FamilySection, type SupplierCoverageOverview, type SupplierFamilyCoverageRow } from "@/lib/products/supplier-price-repository";
import type { DimensionRule, PriceMatch, ReviewBatch, SourceVersion, SupplierCoverageSuggestionRow, SupplierProfile } from "@/lib/products/supplier-price-contracts";

export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
const text = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const offset = (value: string | string[] | undefined) => Math.min(1_000_000, Math.max(0, Math.floor(Number(text(value)) || 0)));
const statusOptions = ["increased", "decreased", "unchanged", "changed", "unmatched", "referenced_companion", "ambiguous", "shared", "needs_dimension_mapping", "baseline_drift", "invalid_source", "target_not_represented"];
const readable = (value: string) => { const label = value.replaceAll("_", " "); return label.charAt(0).toUpperCase() + label.slice(1); };
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";

export default async function SupplierSourcesPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const { profile, user, displayName } = await requireBrandPriceReviewer();
  const client = await createClient(); const params = await searchParams ?? {};
  const brands = await supplierRows<{ id: string; name: string; stored_price_basis: string }>(client, "brands", "id,name,stored_price_basis", { is_active: true });
  const brand = brands.find((item) => item.id === text(params.brand)) ?? brands[0];
  const base = "/products/price-updates/supplier-sources";
  const href = (changes: Record<string, string>) => { const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, text(value)]))); if (brand) query.set("brand", brand.id); for (const [key, value] of Object.entries(changes)) query.set(key, value); return `${base}?${query}`; };
  const sourceOffset = offset(params.sourceOffset), batchOffset = offset(params.batchOffset), from = offset(params.offset);
  const tab: PriceListTab = text(params.tab) === "import" ? "import" : text(params.tab) === "history" ? "history" : "current";
  const requestedView = text(params.view);
  const technicalDeepLink = !requestedView && ["status", "code", "template", "offset", "unitOffset"].some((key) => text(params[key]) !== "");
  const view = technicalDeepLink ? "advanced" : (["advanced", "summary", "details", "complete", "start"].includes(requestedView) ? requestedView : "family");
  let profileReadError = "";
  const [sourceResult, profileList, templates] = brand ? await Promise.all([
    client.from("supplier_source_versions").select("*").eq("brand_id", brand.id).order("created_at", { ascending: false }).order("id").range(sourceOffset, sourceOffset + 19).returns<SourceVersion[]>(),
    supplierRows<{ id: string; title: string; config: SupplierProfile }>(client, "supplier_price_profiles", "id,title,config", { brand_id: brand.id }).catch((error: unknown) => { profileReadError = error instanceof Error ? error.message : "Import profiles unavailable"; return []; }),
    supplierRows<{ id: string; template_name: string }>(client, "product_templates", "id,template_name", { brand_id: brand.id, is_active: true }),
  ]) : [{ data: [] as SourceVersion[], error: null }, [] as Array<{ id: string; title: string; config: SupplierProfile }>, [] as Array<{ id: string; template_name: string }>] as const;
  const vocabularyResult = brand ? await client.from("supplier_dimension_vocabulary").select("*").eq("brand_id", brand.id).eq("is_active", true).order("id").range(offset(params.vocabularyOffset), offset(params.vocabularyOffset) + 49).returns<DimensionRule[]>() : { data: [], error: null };
  let errorMessage = sourceResult.error?.message || profileReadError || vocabularyResult.error?.message || "";
  const sources = sourceResult.data ?? [];
  let source = sources.find((item) => item.id === text(params.source));
  if (!source && brand && text(params.source)) { const result = await client.from("supplier_source_versions").select("*").eq("id", text(params.source)).eq("brand_id", brand.id).maybeSingle<SourceVersion>(); source = result.data ?? undefined; errorMessage ||= result.error?.message ?? ""; }
  const batchResult = source ? await client.from("supplier_price_batches").select("*").eq("source_id", source.id).order("created_at", { ascending: false }).order("id").range(batchOffset, batchOffset + 19).returns<ReviewBatch[]>() : { data: [], error: null };
  errorMessage ||= batchResult.error?.message ?? "";
  let batch = batchResult.data?.find((item) => item.id === text(params.batch));
  if (!batch && source && text(params.batch)) { const result = await client.from("supplier_price_batches").select("*").eq("source_id", source.id).eq("id", text(params.batch)).maybeSingle<ReviewBatch>(); batch = result.data ?? undefined; }
  let matches: PriceMatch[] = []; let units: Array<{ template_id: string; template_name: string; matched: number; changed: number; unchanged: number; unresolved: number; state: string }> = [];
  const templateFilter = text(params.template); const classification = text(params.status); const code = text(params.code).slice(0, 120);
  // A review opens in Family Review by default; the technical workspace is loaded only on request.
  if (!batch && source && !["start", "summary", "details"].includes(view)) batch = batchResult.data?.find((item) => item.status === "review") ?? batchResult.data?.[0];
  if (batch?.status === "review" && view === "advanced") {
    const unitResult = await client.from("supplier_template_review_units").select("*").eq("batch_id", batch.id).order("template_id").range(offset(params.unitOffset), offset(params.unitOffset) + 49).returns<typeof units>();
    units = unitResult.data ?? []; errorMessage ||= unitResult.error?.message ?? "";
    let query = client.from("supplier_price_matches").select("key,data,supplier_price_decisions(decision,note,proposed_target_keys)").eq("batch_id", batch.id).order("key").range(from, from + 49);
    if (templateFilter) query = query.contains("template_ids", [templateFilter]);
    if (batch.scope === "selected_templates" && !["unmatched", "referenced_companion", "invalid_source"].includes(classification)) query = query.overlaps("template_ids", batch.selected_template_ids);
    if (classification === "changed") query = query.in("comparison", ["increased", "decreased", "changed"]);
    else if (["increased", "decreased", "unchanged"].includes(classification)) query = query.eq("comparison", classification);
    else if (statusOptions.includes(classification)) query = query.eq("classification", classification);
    if (code) query = query.ilike("code", `%${code.replace(/[\\%_]/g, "\\$&")}%`);
    const result = await query.returns<Array<{ data: PriceMatch; supplier_price_decisions: { decision: PriceMatch["decision"]; proposed_target_keys: string[] } | null }>>();
    matches = (result.data ?? []).map((row) => ({ ...row.data, ...row.supplier_price_decisions })); errorMessage ||= result.error?.message ?? "";
    // One bounded provenance query for this page; never a query per source row.
    const rowKeys = [...new Set(matches.flatMap((match) => match.source?.row_keys.slice(0, 3) ?? []))];
    if (source && rowKeys.length) {
      const provenance = await client.from("supplier_source_rows").select("unit_key,row_number,sheet,raw_extras").eq("source_id", source.id).in("unit_key", rowKeys).order("unit_key").range(0, 149).returns<Array<{ unit_key: string; row_number: number; sheet: string; raw_extras: Record<string, unknown> }>>();
      const byKey = new Map((provenance.data ?? []).map((row) => [row.unit_key, row]));
      matches = matches.map((match) => ({ ...match, provenance: (match.source?.row_keys.slice(0, 3) ?? []).flatMap((key) => byKey.has(key) ? [byKey.get(key)!] : []) }));
      errorMessage ||= provenance.error?.message ?? "";
    }
  }
  const approver = canApproveBrandPrices(profile?.role, profile?.account_status);
  // Supplier sources and Family coverage. If the coverage tables are not deployed yet the page keeps working as a whole-Brand review.
  let coverage: SupplierCoverageOverview | null = null;
  if (brand) { try { coverage = await supplierCoverageOverview(client, brand.id); } catch { coverage = null; } }
  const sourceOptions = (coverage?.definitions ?? []).filter((item) => item.isActive).map((item) => ({ id: item.id, name: item.name, familyCount: item.families.length }));
  const referenceSource = sources.find((item) => item.status === "imported");
  let familyCoverageRows: SupplierFamilyCoverageRow[] = [];
  if (brand && coverage && tab === "current" && !source) { try { familyCoverageRows = await supplierFamilyCoverageSetup(client, brand.id, referenceSource?.id); } catch (error) { errorMessage ||= error instanceof Error ? error.message : "Family coverage unavailable"; } }
  const definition = source?.definition_id ? coverage?.definitions.find((item) => item.id === source.definition_id) : undefined;
  const editing = text(params.edit) === "1";
  let coverageRows: SupplierCoverageSuggestionRow[] = [];
  if (brand && source?.status === "imported" && definition && (view === "summary" || view === "start" || !batch)) {
    try { coverageRows = await supplierSourceCoverageSuggestion(client, { brandId: brand.id, sourceId: source.id, definitionId: definition.id }); } catch (error) { errorMessage ||= error instanceof Error ? error.message : "Family coverage unavailable"; }
  }
  const otherCoverage: OtherCoverage = {};
  for (const item of coverage?.definitions ?? []) if (item.isActive && item.id !== definition?.id) for (const family of item.families) (otherCoverage[family.id] ??= []).push(item.name);
  const definitionConflicts = definition ? (coverage?.conflicts ?? []).filter((conflict) => conflict.definitions.some((item) => item.definitionId === definition.id)) : [];
  const startBlocked = !definition ? "" : !definition.isActive ? "This Supplier source is no longer active." : !definition.families.length ? "Confirm Family coverage before starting this review." : definitionConflicts.length ? "Resolve Family coverage conflicts before starting this review." : "";
  const coveredIds = batch?.coverage_template_ids ?? null;
  const coverageContext = coveredIds && batch ? <SupplierCoverageContext sourceName={definition?.name ?? source?.title ?? "this price list"} covered={templates.filter((item) => coveredIds.includes(item.id)).map((item) => item.template_name)} notCovered={templates.filter((item) => !coveredIds.includes(item.id)).length} /> : null;
  // Partial coverage never reads as a Brand-wide baseline: it is complete for this source only.
  const partialSource = coveredIds && templates.some((item) => !coveredIds.includes(item.id)) ? (definition?.name ?? source?.title) : undefined;
  const coveragePanel = brand && source?.status === "imported" && (definition || !batchResult.data?.length) ? <SupplierCoverageSetup key={`${source.id}:${definition?.id ?? ""}:${editing}`} brandId={brand.id} source={{ id: source.id, title: source.title }}
    definition={definition ? { id: definition.id, name: definition.name, profileTitle: definition.profileTitle, coveredIds: definition.families.map((family) => family.id) } : null} rows={coverageRows} definitions={sourceOptions} others={otherCoverage} approver={approver} editing={editing}
    editHref={href({ view: "start", edit: "1" })} doneHref={href({ view: "summary", edit: "" })} laterHref={href({ view: "summary", edit: "" })} conflicts={definitionConflicts} /> : null;
  const sourceSummary = brand && source?.status === "imported" ? <SupplierSourceSummary sourceName={definition?.name ?? null} coveredCount={definition?.families.length ?? 0} profileTitle={definition?.profileTitle ?? null} priceList={source.title} approver={approver}
    editHref={href({ view: "start", edit: "1" })} detailsHref={href({ view: "details" })} advancedHref={href({ tab: "import", advanced: "1" })} /> : null;
  const familyId = text(params.family); const requested = text(params.section) as FamilySection; const section: FamilySection = familySections.includes(requested) ? requested : "changed";
  let overview: FamilyOverview | null = null; let familyRows: { rows: FamilyRow[]; truncated: boolean } = { rows: [], truncated: false };
  if (batch && (view === "family" || view === "complete")) {
    try {
      overview = await supplierFamilyOverview(client, batch.id);
      if (view === "family" && familyId && overview.families.some((item) => item.template_id === familyId)) familyRows = await supplierFamilyRows(client, batch.id, familyId, section);
    } catch (error) { errorMessage ||= error instanceof Error ? error.message : "Family Review unavailable"; }
  }
  const family = overview?.families.find((item) => item.template_id === familyId);
  // Current price list: the Brand's active complete baseline and any review still in progress.
  let currentList: CurrentPriceList | null = null; let inProgress: { title: string; href: string } | null = null;
  if (brand && tab === "current" && !source) {
    const updates = (await client.from("brand_price_list_updates").select("id,title,currency,effective_from,received_at,created_at,status,coverage_mode").eq("brand_id", brand.id).returns<Array<{ id: string; title: string; currency: string | null; effective_from: string | null; received_at: string | null; created_at: string | null; status: string; coverage_mode: string }>>()).data ?? [];
    const active = latestBrandPriceListUpdate(updates);
    if (active) {
      const done = (await client.from("supplier_price_batches").select("id,source_id").eq("brand_price_list_update_id", active.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).returns<Array<{ id: string; source_id: string }>>()).data?.[0];
      const linked = done ? (await client.from("supplier_source_versions").select("basis").eq("id", done.source_id).maybeSingle<{ basis: string }>()).data : null;
      const families = done ? (await supplierRows<{ template_id: string }>(client, "supplier_template_review_units", "template_id", { batch_id: done.id }, "template_id")).length : null;
      currentList = { title: active.title, currency: active.currency, basis: linked?.basis ?? null, baselineDate: brandPriceListUpdateDate(active), families, href: done ? href({ source: done.source_id, batch: done.id, view: "complete" }) : null };
    }
    const open = (await client.from("supplier_price_batches").select("id,source_id,title").eq("brand_id", brand.id).eq("status", "review").order("created_at", { ascending: false }).limit(1).returns<Array<{ id: string; source_id: string; title: string }>>()).data?.[0];
    if (open) inProgress = { title: open.title, href: href({ source: open.source_id, batch: open.id, view: "family" }) };
  }
  // History rows: coverage and baseline come from the reviews of each price list; download links are short-lived.
  let historyRows: HistoryRow[] = [];
  if (brand && tab === "history") {
    const reviewRows = sources.length ? (await client.from("supplier_price_batches").select("id,source_id,scope,status,brand_price_list_update_id,created_at").in("source_id", sources.map((item) => item.id)).order("created_at", { ascending: false }).returns<Array<{ id: string; source_id: string; scope: string; status: string; brand_price_list_update_id: string | null }>>()).data ?? [] : [];
    const activeUpdates = (await client.from("brand_price_list_updates").select("id,title,effective_from,received_at,created_at,status,coverage_mode").eq("brand_id", brand.id).returns<Array<{ id: string; title: string; effective_from: string | null; received_at: string | null; created_at: string | null; status: string; coverage_mode: string }>>()).data ?? [];
    const activeId = latestBrandPriceListUpdate(activeUpdates)?.id;
    const links = await Promise.all(sources.map(async (item) => item.working_reference ? [item.id, (await client.storage.from("supplier-price-sources").createSignedUrl(item.working_reference, 300)).data?.signedUrl] as const : [item.id, undefined] as const));
    const url = new Map(links);
    historyRows = sources.map((item) => {
      const latest = reviewRows.find((review) => review.source_id === item.id), finished = reviewRows.find((review) => review.source_id === item.id && review.status === "completed");
      return { id: item.id, title: item.title, sourceName: coverage?.definitions.find((entry) => entry.id === item.definition_id)?.name, date: ((item as SourceVersion & { created_at?: string }).created_at ?? item.received_at ?? "").slice(0, 10) || "—", status: item.status === "imported" ? "current" : item.status === "archived" ? "archived" : "unfinished",
        coverage: latest ? ({ complete: "Complete Brand", selected_templates: "Selected Families", partial: "Partial" } as Record<string, string>)[latest.scope] ?? "Review" : "Not reviewed",
        baseline: finished ? (finished.brand_price_list_update_id === activeId ? "Active baseline" : "Replaced") : "—", viewHref: href({ tab: "current", source: item.id, batch: "", view: "family", offset: "0", batchOffset: "0" }), downloadUrl: url.get(item.id) };
    });
  }
  const summary: { families: number | null; warnings: number | null } = { families: null, warnings: null };
  if (source?.status === "imported" && view === "summary") {
    try {
      const found = await supplierBrandMatches(client, source.id);
      summary.families = new Set(found.matches.flatMap((match) => match.targets.map((target) => target.template_id))).size;
      summary.warnings = found.matches.filter((match) => match.classification === "invalid_source").length;
    } catch { /* The summary still shows the stored import counts. */ }
  }
  let baselineDate: string | null = null; let completedMode: string | null = null;
  if (batch?.status === "completed") {
    const listId = (batch as ReviewBatch & { brand_price_list_update_id?: string | null }).brand_price_list_update_id;
    const list = listId ? await client.from("brand_price_list_updates").select("effective_from,received_at,created_at,coverage_mode").eq("id", listId).maybeSingle<{ effective_from: string | null; received_at: string | null; created_at: string | null; coverage_mode: string | null }>() : null;
    completedMode = list?.data?.coverage_mode ?? null;
    baselineDate = list?.data?.effective_from ?? list?.data?.received_at ?? list?.data?.created_at?.slice(0, 10) ?? source?.effective_from ?? source?.received_at ?? null;
  }
  const familyTabs = (["changed", "same", "missing", "attention"] as const).map((key) => ({ section: key, label: { changed: "Changed", same: "Same", missing: "Missing from Supplier source", attention: "Needs attention" }[key], count: family?.[key] ?? 0, href: href({ view: "family", family: familyId, section: key }) }));
  const workingFile = source?.working_reference ? await client.storage.from("supplier-price-sources").createSignedUrl(source.working_reference, 300) : null;
  const visibleTotals = units.reduce((totals, unit) => ({ matched: totals.matched + unit.matched, changed: totals.changed + unit.changed, unchanged: totals.unchanged + unit.unchanged, unresolved: totals.unresolved + unit.unresolved }), { matched: 0, changed: 0, unchanged: 0, unresolved: 0 });
  const clearFiltersHref = href({ source: source?.id ?? "", batch: batch?.id ?? "", template: "", status: "", code: "", offset: "0" });
  const completed = batch?.status === "completed";
  const importCard = brand ? <SupplierImportCard key={brand.id} brandId={brand.id} brandName={brand.name} profiles={profileList} sources={sourceOptions} suggestedTitle={`${brand.name} — ${new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}`} advancedHref={href({ tab: "import", advanced: "1" }) + "#advanced"} setupHref={href({ tab: "import", setup: "1" })} /> : null;
  const advancedReview = batch ? <><p className="text-xs"><Link href={href({ view: "family", status: "", code: "", template: "" })} className="underline">← Back to Family Review</Link></p><p className="rounded border border-amber-300 bg-amber-50 p-2 font-medium">{batch.basis_warning} Apply one reviewed changed price at a time after confirming source and Brand price basis. Build a fresh comparison after applying.</p>
          <SupplierCompletionControls key={batch.id} batchId={batch.id} scope={batch.scope} status={batch.status} approver={approver} partialSource={partialSource} />
          <div className="space-y-2"><h3 className="font-semibold">Visible Template totals</h3><p className="text-xs text-zinc-500">From the {units.length} Template review units loaded on this page.</p><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(visibleTotals).map(([label, total]) => <div key={label} className={`rounded border p-3 ${total > 0 && (label === "changed" || label === "unresolved") ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-zinc-50"}`}><dt className="text-xs text-zinc-600">{readable(label)}</dt><dd className="text-xl font-semibold tabular-nums">{total.toLocaleString("en-US")}</dd></div>)}</dl></div>
          <h3 className="font-semibold">Template review units</h3>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-zinc-50"><th className="p-2">Template</th>{["Matched", "Changed", "Unchanged", "Unresolved"].map((label) => <th key={label} className="p-2 text-right">{label}</th>)}<th className="p-2">State</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.template_id} className={`border-b ${templateFilter === unit.template_id ? "bg-zinc-100" : ""}`}><td className="p-2"><Link aria-current={templateFilter === unit.template_id ? "true" : undefined} className="font-semibold underline" href={href({ template: unit.template_id, offset: "0", status: "" })}>{unit.template_name}</Link>{templateFilter === unit.template_id ? <div className="mt-1 text-zinc-600">Current Template filter</div> : null}</td><td className="p-2 text-right tabular-nums">{unit.matched}</td><td className={`p-2 text-right tabular-nums ${unit.changed > 0 ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{unit.changed}</td><td className="p-2 text-right tabular-nums">{unit.unchanged}</td><td className={`p-2 text-right tabular-nums ${unit.unresolved > 0 ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{unit.unresolved}</td><td className="p-2"><span className={`${badge} border-zinc-200 bg-zinc-50`}>{readable(unit.state)}</span></td></tr>)}</tbody></table></div>
          <div className="flex justify-between text-xs"><Link href={href({ unitOffset: String(Math.max(0, offset(params.unitOffset) - 50)) })}>Previous Templates</Link><Link href={href({ unitOffset: String(offset(params.unitOffset) + 50) })}>Next Templates</Link></div>
          <form className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 bg-zinc-50 p-3"><input type="hidden" name="brand" value={brand.id} /><input type="hidden" name="source" value={source?.id ?? ""} /><input type="hidden" name="batch" value={batch.id} /><label className="grid gap-1 text-xs font-medium">Template<select name="template" defaultValue={templateFilter} className="rounded border bg-white p-2"><option value="">Review scope</option>{templates.filter((template) => batch.scope !== "selected_templates" || batch.selected_template_ids.includes(template.id)).map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select></label><label className="grid gap-1 text-xs font-medium">Status<select name="status" defaultValue={classification} className="rounded border bg-white p-2"><option value="">All</option>{statusOptions.map((status) => <option key={status} value={status}>{readable(status)}</option>)}</select></label><label className="grid gap-1 text-xs font-medium">Code<input name="code" defaultValue={code} className="rounded border bg-white p-2" /></label><button className="rounded border border-zinc-300 bg-white px-3 py-2 font-medium">Filter</button><Link className="px-1 py-2 text-xs underline" href={clearFiltersHref}>Clear filters</Link></form>
          <p className="text-xs text-zinc-600">Unmatched / referenced companion / ambiguous / missing dimension / invalid source queues are available through Status. Companion notes require an explicit profile column; no ownership is inferred. Not represented ≠ discontinued.</p>
          <SupplierReviewControls key={`${batch.id}:${from}:${templateFilter}:${classification}:${code}`} batchId={batch.id} brandId={brand.id} matches={matches} approver={approver} sourceProfile={source?.profile} sourceBasis={source?.basis ?? "unknown"} brandBasis={brand.stored_price_basis} sourceStatus={source?.status ?? ""} batchStatus={batch.status} />
          <div className="flex justify-between"><Link href={href({ offset: String(Math.max(0, from - 50)) })}>Previous comparisons</Link><span>{matches.length ? `${from + 1}–${from + matches.length}` : "0 comparisons"}</span><Link href={href({ offset: String(from + 50) })}>Next comparisons</Link></div>
        </> : null;
  const familyReview = batch ? <>
          {coverageContext}
          {overview ? family ? <SupplierFamilyTable key={`${batch.id}:${family.template_id}:${section}`} batchId={batch.id} familyName={family.template_name} section={section} tabs={familyTabs} rows={familyRows.rows} truncated={familyRows.truncated} approver={approver} batchOpen={batch.status === "review"} limit={SUPPLIER_BULK_LIMIT}
              backHref={href({ view: "family", family: "", section: "" })} detailsHref={href({ view: "advanced", family: "", section: "", template: family.template_id })} />
            : <><SupplierBrandProgress overview={overview} />
              <SupplierFamilyList overview={overview} links={overview.families.map((item) => ({ template_id: item.template_id, href: href({ view: "family", family: item.template_id, section: item.attention && !item.changed ? "attention" : "changed" }) }))}
                approverNote={approver ? undefined : "An approver applies, confirms or excludes items."} advancedHref={href({ view: "advanced", family: "", section: "" })} supplierOnlyHref={href({ view: "advanced", family: "", section: "", status: "unmatched" })} continueHref={href({ view: "complete" })} /></>
            : <p className="rounded border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-600">Family Review is unavailable for this comparison. Use Advanced / Technical Review.</p>}
        </> : null;
  const finishScreen = batch && source && brand ? <SupplierFinishScreen brandName={brand.name} title={source.title} baselineDate={baselineDate} overview={overview} priceUpdatesHref="/products/price-updates" summaryHref={href({ view: "complete" })} partialSource={completedMode === "selected_templates" && coveredIds ? (definition?.name ?? source.title) : undefined} /> : null;
  let main: React.ReactNode;
  if (!brand) main = null;
  else if (!source) main = <><SupplierCurrentPriceList brandName={brand.name} current={currentList} inProgress={inProgress} importHref={href({ tab: "import" })} />{coverage ? <><SupplierSourcesOverview definitions={coverage.definitions} brandId={brand.id} approver={approver} editCoverageHref={(id) => { const sourceId = coverage.definitions.find((definition) => definition.id === id)?.latest?.id ?? ""; return sourceId ? href({ source: sourceId, view: "start", edit: "1" }) : href({ tab: "import" }); }} /><SupplierFamilyCoverageSetup brandId={brand.id} rows={familyCoverageRows} sources={sourceOptions} profiles={profileList.map((item) => ({ id: item.id, title: item.title }))} approver={approver} referenceTitle={referenceSource?.title ?? null} /></> : null}</>;
  else if (source.status === "archived") main = <><p className="rounded border border-zinc-200 bg-zinc-50 p-3">This price list is archived. Import a new price list to continue.</p>{importCard}</>;
  else if (source.status !== "imported") main = <><SupplierImportSummary brandName={brand.name} source={source} families={null} warnings={null} continueHref="" detailsHref={href({ view: "details" })} uploading />{importCard}</>;
  else if (view === "summary" || view === "details") main = <><SupplierImportSummary brandName={brand.name} source={source} families={summary.families} warnings={summary.warnings} continueHref={href({ view: batchResult.data?.length ? "family" : "start", batch: "" })} detailsHref={href({ view: "details" })} />{view === "summary" ? coveragePanel : null}{view === "details" ? <SupplierImportDetails source={source} workingFileUrl={workingFile?.data?.signedUrl} /> : null}</>;
  else if (!batch || view === "start") main = <>{coveragePanel}{startBlocked ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{startBlocked}</p> : <SupplierStartReview key={source.id} brandId={brand.id} sourceId={source.id} templates={templates} />}</>;
  else if (view === "advanced") main = advancedReview;
  else if (view === "complete") main = completed ? finishScreen : overview ? <><SupplierCompleteSummary overview={overview} reviewHref={href({ view: "family", family: "", section: "" })} /><SupplierCompletionControls key={batch.id} batchId={batch.id} scope={batch.scope} status={batch.status} approver={approver} partialSource={partialSource} reviewHref={href({ view: "family", family: "", section: "" })} /></> : <p>Complete Review is unavailable for this comparison.</p>;
  else main = <>{completed ? finishScreen : null}{familyReview}</>;
  const importArea = brand ? <>{text(params.setup) === "1" ? <SupplierImportFormatWizard key={brand.id} brandId={brand.id} brandName={brand.name} approver={approver} doneHref={href({ tab: "import", setup: "" })} /> : importCard}</> : null;
  const step: WorkflowStep = !source || view === "summary" || view === "details" || source.status !== "imported" ? 1 : view === "complete" ? 3 : 2;
  return <ErpAppShell title="Supplier Price Sources / Review" description="Import a Supplier price list, review it by Product family, then complete the review." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div><Link href="/products/price-updates" className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">← Price Updates</Link>
          <p className="mt-2 max-w-xl text-xs text-zinc-500">Import a Supplier price list, check it Family by Family, then complete the review to set the Brand price baseline.</p></div>
        <form className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs font-semibold text-zinc-700">Brand <select name="brand" defaultValue={brand?.id} className="h-9 min-w-48 rounded-md border border-zinc-200 bg-white px-3 text-sm font-normal outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">Open Brand</button></form>
      </div>
      {errorMessage ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">{errorMessage}. The Phase 1b migration must be deployed before using this workspace.</p> : null}
      {brand ? <div className="space-y-4">
        <SupplierTabs tab={tab} hrefs={{ current: href({ tab: "current", source: "", batch: "", view: "", family: "", section: "", status: "", code: "", template: "", offset: "0" }), import: href({ tab: "import", setup: "" }), history: href({ tab: "history" }) }} />
        {tab === "import" ? <>{importArea}</>
          : tab === "history" ? <SupplierHistoryTable rows={historyRows} showArchived={text(params.showArchived) === "1"} archivedCount={historyRows.filter((row) => row.status === "archived").length} toggleHref={href({ showArchived: text(params.showArchived) === "1" ? "" : "1" })} canArchive
              pagerHrefs={{ previous: href({ sourceOffset: String(Math.max(0, sourceOffset - 20)) }), next: href({ sourceOffset: String(sourceOffset + 20) }) }} reviews={source ? batchResult.data ?? [] : []} currentBatchId={batch?.id} reviewHref={(id) => href({ tab: "current", source: source?.id ?? "", batch: id, view: "family", offset: "0", template: "", status: "" })} newReviewHref={source?.status === "imported" ? href({ tab: "current", view: "start" }) : undefined} />
          : <>
            {source ? <SupplierWorkflowHeader brandName={brand.name} source={source} batch={batch} step={step} links={{ steps: [href({ tab: "import", source: "", batch: "", view: "", family: "", section: "", status: "", code: "", template: "", offset: "0" }), href({ view: "family", family: "", section: "" }), href({ view: "complete" })], history: href({ tab: "history" }), advanced: href({ tab: "import", advanced: "1" }) + "#advanced" }} /> : null}
            {sourceSummary}
            {main}
          </>}
        <SupplierAdvancedImportSettings key={`${brand.id}:${text(params.advanced)}`} brandId={brand.id} brandName={brand.name} basis={brand.stored_price_basis} approver={approver} templates={templates} dimensions={vocabularyResult.data ?? []} profiles={profileList} open={text(params.advanced) === "1"} />
        {approver ? <div className="flex justify-between text-xs"><Link href={href({ vocabularyOffset: String(Math.max(0, offset(params.vocabularyOffset) - 50)) })}>Previous vocabulary</Link><Link href={href({ vocabularyOffset: String(offset(params.vocabularyOffset) + 50) })}>Next vocabulary</Link></div> : null}
      </div> : <p>No active Brands available.</p>}
    </div>
  </ErpAppShell>;
}
