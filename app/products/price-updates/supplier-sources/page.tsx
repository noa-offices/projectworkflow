import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { SupplierReviewControls, SupplierSourceControls } from "@/components/products/supplier-price-workspace-controls";
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
  return <ErpAppShell title="Supplier Price Sources / Review" description="Reusable Supplier Master Sources and resumable Template review. No Product price application in Phase 1b." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
    <div className="space-y-4 text-sm"><Link href="/products/price-updates" className="underline">Price-check monitoring</Link>
      {errorMessage ? <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3">{errorMessage}. The Phase 1b migration must be deployed before using this workspace.</p> : null}
      <form className="flex gap-2"><label>Brand <select name="brand" defaultValue={brand?.id} className="rounded border p-2">{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="rounded border px-3">Open Brand</button></form>
      {brand ? <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]"><aside className="space-y-3">
        <h2 className="font-semibold">{brand.name} — Supplier Sources</h2>
        <table className="w-full text-left text-xs"><tbody>{sources.map((item) => <tr key={item.id} className="border-b"><td className="py-2"><Link href={href({ source: item.id, batch: "", offset: "0", batchOffset: "0" })} className="font-medium underline">{item.title}</Link><div>{item.source_type.toUpperCase()} · {item.currency} · {item.basis}</div><div>{item.stored_rows}/{item.expected_rows} rows · {item.identity_count} commercial identities · {item.status}</div></td></tr>)}</tbody></table>
        <div className="flex justify-between text-xs"><Link href={href({ sourceOffset: String(Math.max(0, sourceOffset - 20)) })}>Previous sources</Link><Link href={href({ sourceOffset: String(sourceOffset + 20) })}>Next sources</Link></div>
        <SupplierSourceControls key={brand.id} brandId={brand.id} brandName={brand.name} basis={brand.stored_price_basis} profiles={profileList} approver={approver} sourceId={source?.status === "imported" ? source.id : undefined} templates={templates} dimensions={vocabularyResult.data ?? []} />
        <div className="flex justify-between text-xs"><Link href={href({ vocabularyOffset: String(Math.max(0, offset(params.vocabularyOffset) - 50)) })}>Previous vocabulary</Link><Link href={href({ vocabularyOffset: String(offset(params.vocabularyOffset) + 50) })}>Next vocabulary</Link></div>
      </aside><section className="min-w-0 space-y-3">
        {source ? <><h2 className="font-semibold">{source.title}</h2><p>{source.filename} · {source.stored_rows} raw rows · {source.stored_cells} price cells · {source.identity_count} identities · {source.currency} · {source.basis} · {source.status}</p><p className="text-xs text-zinc-500">SHA-256 {source.file_hash}. Raw codes, dimensions, context, extras and physical row references are retained. Effective: {source.effective_from ?? "not set"}; received: {source.received_at ?? "not set"}. {source.original_reference ? `Original reference: ${source.original_reference}` : ""}</p>
          {workingFile?.data?.signedUrl ? <a className="text-xs underline" href={workingFile.data.signedUrl} target="_blank" rel="noopener noreferrer">Download retained working source</a> : null}
          <div className="flex flex-wrap gap-2">{batchResult.data?.map((item) => <Link key={item.id} className="rounded border px-2 py-1" href={href({ batch: item.id, offset: "0", template: "", status: "" })}>{item.title} · {item.scope} · {item.status}</Link>)}</div>
          <div className="flex justify-between text-xs"><Link href={href({ batchOffset: String(Math.max(0, batchOffset - 20)) })}>Previous batches</Link><Link href={href({ batchOffset: String(batchOffset + 20) })}>Next batches</Link></div>
        </> : <p>Select a stored source version or import a structured source.</p>}
        {batch ? <><p className="rounded border border-amber-300 bg-amber-50 p-2 font-medium">{batch.basis_warning} No Apply / Confirm Unchanged / activation exists in this phase.</p>
          <table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">Template review unit</th><th>Matched</th><th>Changed</th><th>Unchanged</th><th>Unresolved</th><th>State</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.template_id} className="border-b"><td className="p-2"><Link className="underline" href={href({ template: unit.template_id, offset: "0", status: "" })}>{unit.template_name}</Link></td><td>{unit.matched}</td><td>{unit.changed}</td><td>{unit.unchanged}</td><td>{unit.unresolved}</td><td>{unit.state}</td></tr>)}</tbody></table>
          <div className="flex justify-between text-xs"><Link href={href({ unitOffset: String(Math.max(0, offset(params.unitOffset) - 50)) })}>Previous Templates</Link><Link href={href({ unitOffset: String(offset(params.unitOffset) + 50) })}>Next Templates</Link></div>
          <form className="flex flex-wrap gap-2"><input type="hidden" name="brand" value={brand.id} /><input type="hidden" name="source" value={source?.id ?? ""} /><input type="hidden" name="batch" value={batch.id} /><label>Template <select name="template" defaultValue={templateFilter} className="rounded border p-1"><option value="">Review scope</option>{templates.filter((template) => batch.scope !== "selected_templates" || batch.selected_template_ids.includes(template.id)).map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select></label><label>Status <select name="status" defaultValue={classification} className="rounded border p-1"><option value="">All</option>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label><label>Code <input name="code" defaultValue={code} className="rounded border p-1" /></label><button className="rounded border px-2">Filter</button></form>
          <p className="text-xs text-zinc-600">Unmatched / referenced companion / ambiguous / missing dimension / invalid source queues are available through Status. Companion notes require an explicit profile column; no ownership is inferred. Not represented ≠ discontinued.</p>
          <SupplierReviewControls key={`${batch.id}:${from}:${templateFilter}:${classification}:${code}`} batchId={batch.id} brandId={brand.id} matches={matches} approver={approver} sourceProfile={source?.profile} />
          <div className="flex justify-between"><Link href={href({ offset: String(Math.max(0, from - 50)) })}>Previous comparisons</Link><span>{from + 1}–{from + matches.length}</span><Link href={href({ offset: String(from + 50) })}>Next comparisons</Link></div>
        </> : null}
      </section></div> : <p>No active Brands available.</p>}
    </div>
  </ErpAppShell>;
}
