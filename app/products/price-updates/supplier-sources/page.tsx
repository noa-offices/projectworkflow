import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { SupplierCompletionControls, SupplierReviewControls, SupplierSourceControls } from "@/components/products/supplier-price-workspace-controls";
import { requireBrandPriceReviewer } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { createClient } from "@/lib/supabase/server";
import { supplierRows } from "@/lib/products/supplier-price-repository";
import type { DimensionRule, PriceMatch, ReviewBatch, SourceVersion, SupplierProfile } from "@/lib/products/supplier-price-contracts";

export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
const text = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const offset = (value: string | string[] | undefined) => Math.min(1_000_000, Math.max(0, Math.floor(Number(text(value)) || 0)));
const statusOptions = ["increased", "decreased", "unchanged", "changed", "unmatched", "referenced_companion", "ambiguous", "shared", "needs_dimension_mapping", "baseline_drift", "invalid_source", "target_not_represented"];
const readable = (value: string) => { const label = value.replaceAll("_", " "); return label.charAt(0).toUpperCase() + label.slice(1); };
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const sourceTone = (status: string) => status === "imported" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status === "failed" ? "border-red-200 bg-red-50 text-red-800" : "border-zinc-200 bg-zinc-100 text-zinc-600";

export default async function SupplierSourcesPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const { profile, user, displayName } = await requireBrandPriceReviewer();
  const client = await createClient(); const params = await searchParams ?? {};
  const brands = await supplierRows<{ id: string; name: string; stored_price_basis: string }>(client, "brands", "id,name,stored_price_basis", { is_active: true });
  const brand = brands.find((item) => item.id === text(params.brand)) ?? brands[0];
  const base = "/products/price-updates/supplier-sources";
  const href = (changes: Record<string, string>) => { const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, text(value)]))); if (brand) query.set("brand", brand.id); for (const [key, value] of Object.entries(changes)) query.set(key, value); return `${base}?${query}`; };
  const sourceOffset = offset(params.sourceOffset), batchOffset = offset(params.batchOffset), from = offset(params.offset);
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
  if (batch?.status === "review") {
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
  const workingFile = source?.working_reference ? await client.storage.from("supplier-price-sources").createSignedUrl(source.working_reference, 300) : null;
  const visibleTotals = units.reduce((totals, unit) => ({ matched: totals.matched + unit.matched, changed: totals.changed + unit.changed, unchanged: totals.unchanged + unit.unchanged, unresolved: totals.unresolved + unit.unresolved }), { matched: 0, changed: 0, unchanged: 0, unresolved: 0 });
  const clearFiltersHref = href({ source: source?.id ?? "", batch: batch?.id ?? "", template: "", status: "", code: "", offset: "0" });
  return <ErpAppShell title="Supplier Price Sources / Review" description="Reusable Supplier Master Sources, resumable Template review and individual reviewed price application." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
    <div className="space-y-4 text-sm"><Link href="/products/price-updates" className="underline">Price-check monitoring</Link>
      {errorMessage ? <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3">{errorMessage}. The Phase 1b migration must be deployed before using this workspace.</p> : null}
      <form className="flex gap-2"><label>Brand <select name="brand" defaultValue={brand?.id} className="rounded border p-2">{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="rounded border px-3">Open Brand</button></form>
      {brand ? <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]"><aside className="space-y-3">
        <h2 className="font-semibold">{brand.name} — Supplier Sources</h2>
        <table className="w-full text-left text-xs"><tbody>{sources.map((item) => <tr key={item.id} className={`border-b ${source?.id === item.id ? "bg-zinc-100 ring-1 ring-inset ring-zinc-300" : ""}`}><td className="space-y-1 p-2"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={href({ source: item.id, batch: "", offset: "0", batchOffset: "0" })} aria-current={source?.id === item.id ? "true" : undefined} className="font-semibold underline">{item.title}</Link><span className={`${badge} ${sourceTone(item.status)}`}>{readable(item.status)}</span></div><div>{item.source_type.toUpperCase()} · {item.currency} · {item.basis}</div><div className="text-zinc-600">{item.stored_rows.toLocaleString("en-US")}/{item.expected_rows.toLocaleString("en-US")} rows · {item.identity_count.toLocaleString("en-US")} commercial identities</div>{source?.id === item.id ? <div className="font-medium">Selected source</div> : null}</td></tr>)}</tbody></table>
        <div className="flex justify-between text-xs"><Link href={href({ sourceOffset: String(Math.max(0, sourceOffset - 20)) })}>Previous sources</Link><Link href={href({ sourceOffset: String(sourceOffset + 20) })}>Next sources</Link></div>
        <SupplierSourceControls key={brand.id} brandId={brand.id} brandName={brand.name} basis={brand.stored_price_basis} profiles={profileList} approver={approver} sourceId={source?.status === "imported" ? source.id : undefined} templates={templates} dimensions={vocabularyResult.data ?? []} />
        <div className="flex justify-between text-xs"><Link href={href({ vocabularyOffset: String(Math.max(0, offset(params.vocabularyOffset) - 50)) })}>Previous vocabulary</Link><Link href={href({ vocabularyOffset: String(offset(params.vocabularyOffset) + 50) })}>Next vocabulary</Link></div>
      </aside><section className="min-w-0 space-y-3">
        {source ? <><div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="text-lg font-semibold">{source.title}</h2><p className="break-words text-xs text-zinc-600">{source.filename}</p></div><span className={`${badge} ${sourceTone(source.status)}`}>{readable(source.status)}</span></div>
          <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">{[["Currency", source.currency], ["Basis", source.basis], ["Raw rows", source.stored_rows.toLocaleString("en-US")], ["Price cells", source.stored_cells.toLocaleString("en-US")], ["Commercial identities", source.identity_count.toLocaleString("en-US")], ...(source.effective_from ? [["Effective date", source.effective_from]] : []), ...(source.received_at ? [["Received date", source.received_at]] : [])].map(([label, value]) => <div key={label}><dt className="text-zinc-500">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
          {workingFile?.data?.signedUrl ? <a className="inline-block text-xs font-medium underline" href={workingFile.data.signedUrl} target="_blank" rel="noopener noreferrer">Download retained working source</a> : null}
          <p className="break-words text-xs text-zinc-500">SHA-256 {source.file_hash}. Raw codes, dimensions, context, extras and physical row references are retained. {source.original_reference ? `Original reference: ${source.original_reference}` : ""}</p>
          </div>
          <h3 className="font-semibold">Review batches</h3>
          <div className="flex flex-wrap gap-2">{batchResult.data?.map((item) => <Link key={item.id} aria-current={batch?.id === item.id ? "true" : undefined} className={`space-y-1 rounded border p-2 ${batch?.id === item.id ? "border-zinc-400 bg-zinc-100 ring-1 ring-zinc-300" : "border-zinc-200 bg-white"}`} href={href({ batch: item.id, offset: "0", template: "", status: "" })}><div className="font-semibold">{item.title}</div><div className="flex flex-wrap items-center gap-2 text-xs"><span>Scope: {readable(item.scope)}</span><span className={`${badge} border-zinc-200 bg-zinc-50`}>{readable(item.status)}</span>{batch?.id === item.id ? <span className="font-medium">Selected batch</span> : null}</div></Link>)}</div>
          <div className="flex justify-between text-xs"><Link href={href({ batchOffset: String(Math.max(0, batchOffset - 20)) })}>Previous batches</Link><Link href={href({ batchOffset: String(batchOffset + 20) })}>Next batches</Link></div>
        </> : <p>Select a stored source version or import a structured source.</p>}
        {batch ? <><p className="rounded border border-amber-300 bg-amber-50 p-2 font-medium">{batch.basis_warning} Apply one reviewed changed price at a time after confirming source and Brand price basis. Build a fresh comparison after applying.</p>
          <SupplierCompletionControls key={batch.id} batchId={batch.id} scope={batch.scope} status={batch.status} approver={approver} />
          <div className="space-y-2"><h3 className="font-semibold">Visible Template totals</h3><p className="text-xs text-zinc-500">From the {units.length} Template review units loaded on this page.</p><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(visibleTotals).map(([label, total]) => <div key={label} className={`rounded border p-3 ${total > 0 && (label === "changed" || label === "unresolved") ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-zinc-50"}`}><dt className="text-xs text-zinc-600">{readable(label)}</dt><dd className="text-xl font-semibold tabular-nums">{total.toLocaleString("en-US")}</dd></div>)}</dl></div>
          <h3 className="font-semibold">Template review units</h3>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-zinc-50"><th className="p-2">Template</th>{["Matched", "Changed", "Unchanged", "Unresolved"].map((label) => <th key={label} className="p-2 text-right">{label}</th>)}<th className="p-2">State</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.template_id} className={`border-b ${templateFilter === unit.template_id ? "bg-zinc-100" : ""}`}><td className="p-2"><Link aria-current={templateFilter === unit.template_id ? "true" : undefined} className="font-semibold underline" href={href({ template: unit.template_id, offset: "0", status: "" })}>{unit.template_name}</Link>{templateFilter === unit.template_id ? <div className="mt-1 text-zinc-600">Current Template filter</div> : null}</td><td className="p-2 text-right tabular-nums">{unit.matched}</td><td className={`p-2 text-right tabular-nums ${unit.changed > 0 ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{unit.changed}</td><td className="p-2 text-right tabular-nums">{unit.unchanged}</td><td className={`p-2 text-right tabular-nums ${unit.unresolved > 0 ? "bg-amber-50 font-semibold text-amber-800" : ""}`}>{unit.unresolved}</td><td className="p-2"><span className={`${badge} border-zinc-200 bg-zinc-50`}>{readable(unit.state)}</span></td></tr>)}</tbody></table></div>
          <div className="flex justify-between text-xs"><Link href={href({ unitOffset: String(Math.max(0, offset(params.unitOffset) - 50)) })}>Previous Templates</Link><Link href={href({ unitOffset: String(offset(params.unitOffset) + 50) })}>Next Templates</Link></div>
          <form className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 bg-zinc-50 p-3"><input type="hidden" name="brand" value={brand.id} /><input type="hidden" name="source" value={source?.id ?? ""} /><input type="hidden" name="batch" value={batch.id} /><label className="grid gap-1 text-xs font-medium">Template<select name="template" defaultValue={templateFilter} className="rounded border bg-white p-2"><option value="">Review scope</option>{templates.filter((template) => batch.scope !== "selected_templates" || batch.selected_template_ids.includes(template.id)).map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select></label><label className="grid gap-1 text-xs font-medium">Status<select name="status" defaultValue={classification} className="rounded border bg-white p-2"><option value="">All</option>{statusOptions.map((status) => <option key={status} value={status}>{readable(status)}</option>)}</select></label><label className="grid gap-1 text-xs font-medium">Code<input name="code" defaultValue={code} className="rounded border bg-white p-2" /></label><button className="rounded border border-zinc-300 bg-white px-3 py-2 font-medium">Filter</button><Link className="px-1 py-2 text-xs underline" href={clearFiltersHref}>Clear filters</Link></form>
          <p className="text-xs text-zinc-600">Unmatched / referenced companion / ambiguous / missing dimension / invalid source queues are available through Status. Companion notes require an explicit profile column; no ownership is inferred. Not represented ≠ discontinued.</p>
          <SupplierReviewControls key={`${batch.id}:${from}:${templateFilter}:${classification}:${code}`} batchId={batch.id} brandId={brand.id} matches={matches} approver={approver} sourceProfile={source?.profile} sourceBasis={source?.basis ?? "unknown"} brandBasis={brand.stored_price_basis} sourceStatus={source?.status ?? ""} batchStatus={batch.status} />
          <div className="flex justify-between"><Link href={href({ offset: String(Math.max(0, from - 50)) })}>Previous comparisons</Link><span>{matches.length ? `${from + 1}–${from + matches.length}` : "0 comparisons"}</span><Link href={href({ offset: String(from + 50) })}>Next comparisons</Link></div>
        </> : null}
      </section></div> : <p>No active Brands available.</p>}
    </div>
  </ErpAppShell>;
}
