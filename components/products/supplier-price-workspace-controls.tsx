"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSupplierFile } from "@/lib/products/supplier-price-file";
import { supplierImportChunks } from "@/lib/products/supplier-price-import";
import type { DimensionRule, PriceMatch, SourceScope, SupplierProfile } from "@/lib/products/supplier-price-contracts";
import { applySupplierReviewedPrice, confirmSupplierUnchangedPrice, archiveSupplierDimension, archiveSupplierSource, attachSupplierWorkingFile, confirmSupplierBindings, createSupplierReviewBatch, createSupplierSource, finalizeSupplierSource, saveSupplierDecision, saveSupplierDimension, saveSupplierProfile, supplierMappingTargets, supplierProfileForImport, uploadSupplierChunk } from "@/app/products/price-updates/supplier-sources/actions";

const input = "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm";
const button = "rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const readable = (value: string) => { const label = value.replaceAll("_", " "); return label.charAt(0).toUpperCase() + label.slice(1); };
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const classificationTone = (value: string) => ["increased", "ambiguous", "needs_dimension_mapping", "baseline_drift", "invalid_source"].includes(value) ? "border-amber-200 bg-amber-50 text-amber-800" : value === "decreased" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-700";

function CodeSet({ label, codes }: { label: string; codes: string[] }) {
  if (codes.length <= 8) return <div className="break-words">{label}: {codes.join(", ")}</div>;
  return <details className="break-words"><summary className="cursor-pointer">{label}: {codes.slice(0, 8).join(", ")} … ({codes.length} total)</summary><div className="mt-1">{codes.join(", ")}</div></details>;
}
type ProfileOption = { id: string; title: string; config: SupplierProfile };

export function SupplierSourceControls({ brandId, brandName, basis, profiles, approver, sourceId, templates, dimensions = [] }: { brandId: string; brandName: string; basis: string; profiles: ProfileOption[]; approver: boolean; sourceId?: string; templates: Array<{ id: string; template_name: string }>; dimensions?: DimensionRule[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [scope, setScope] = useState<SourceScope>("partial");
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(false); } }
  const las = brandName === "LAS MOBILI";
  const example = { strategy: las ? "article_plus_finish" : "exact", full_code_column: las ? "CODICE_ARTICOLO" : "SET_EXACT_CODE_HEADER", ...(las ? { article_code_column: "NOME_FILE", article_length: 6, finish_length: 3, validated_article_fallback: true, category_column: "CATEGORIA_TESSUTO" } : {}), price_columns: [{ column: las ? "PREZZO_UNITARIO" : "PRICE", price_field: "unit_price" }], currency: "EUR", basis };
  return <div className="space-y-3">
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    {approver ? <details className="rounded border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Import profiles & canonical dimensions (approver)</summary>
      <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await saveSupplierProfile(brandId, String(form.get("title")), JSON.parse(String(form.get("config")))); setMessage("Authoritative profile saved. Existing source snapshots are unchanged."); }); }}>
        <label className="grid gap-1 text-xs">Profile title<input name="title" required defaultValue={las ? "LAS article + finish" : "Structured source"} className={input} /></label>
        <p className="text-xs text-zinc-600">Profiles are reusable import definitions. Saving a profile does not alter previously imported source versions.</p>
        <p className="text-xs text-zinc-600">Example only: set exact file headers and explicitly confirm currency/basis. Optional sheet_names selects XLSX sheets; companion_note_column enables the referenced-companion queue. No global LAS splitting rule. To update a profile, use its existing title.</p>
        <label className="grid gap-1 text-xs">Profile JSON<textarea name="config" rows={9} required className={`${input} font-mono`} defaultValue={JSON.stringify(example, null, 2)} /></label>
        <button disabled={busy} className={button}>Save profile</button>
      </form>
      <form className="mt-4 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await saveSupplierDimension({ brand_id: brandId, template_id: String(form.get("template_id")) || undefined, group_id: String(form.get("group_id")) || undefined, raw_labels: String(form.get("labels")).split("\n").map((value) => value.trim()).filter(Boolean), finish_codes: String(form.get("finishes")).split(/[\n,]/).map((value) => value.trim()).filter(Boolean), dimension_code: String(form.get("dimension")) }); setMessage("Dimension mapping saved. Create a new comparison batch to use it."); }); }}>
        <h3 className="text-sm font-semibold">Brand dimension vocabulary</h3>
        <label className="grid text-xs">Canonical dimension code<input name="dimension" required className={input} placeholder="Exact existing column dimension_code" /></label>
        <label className="grid text-xs">Source labels (one per line)<textarea name="labels" rows={2} className={input} /></label>
        <label className="grid text-xs">Explicit finish-code set (comma/newline separated)<textarea name="finishes" rows={2} className={input} /></label>
        <label className="grid text-xs">Narrow Template override<select name="template_id" className={input}><option value="">Whole Brand</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select></label>
        <label className="grid text-xs">Stored group ID (optional narrower column set)<input name="group_id" className={input} /></label>
        <button disabled={busy} className={button}>Confirm vocabulary mapping</button>
      </form>
      <div className="mt-3 space-y-2 text-xs">{dimensions.map((rule) => <div key={rule.id} className="space-y-2 rounded border border-zinc-200 p-2">
        <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><div className="text-zinc-500">Source evidence</div>{rule.raw_labels.length ? <div className="break-words">Labels: {rule.raw_labels.join(" / ")}</div> : null}{rule.finish_codes.length ? <CodeSet label="Finish codes" codes={rule.finish_codes} /> : null}</div><span aria-label="maps to">→</span><div className="break-words font-semibold">{rule.dimension_code}</div></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className={`${badge} border-zinc-200 bg-zinc-50`}>{rule.template_id ? `Template override: ${templates.find((template) => template.id === rule.template_id)?.template_name ?? rule.template_id}` : "Brand"}{rule.group_id ? ` · Group ${rule.group_id}` : ""}</span><button type="button" disabled={busy} className={button} onClick={() => void run(async () => { await archiveSupplierDimension(rule.id); setMessage("Vocabulary rule archived; historical review snapshots retained."); })}>Archive rule</button></div>
      </div>)}</div>
    </details> : null}
    <details className="rounded border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Import / resume Supplier Master Source</summary>
      <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("file"); void run(async () => {
        if (!(file instanceof File) || !file.size) throw Error("Choose a structured source file.");
        const profileId = String(form.get("profile")); const profile = await supplierProfileForImport(profileId);
        setMessage("Reading structured file; code cells remain typed text.");
        const rows = await parseSupplierFile(file, profile.sheet_names);
        if (!rows.length) throw Error("Source has no data rows.");
        const headers = rows[0].values;
        const required = [profile.full_code_column, ...profile.price_columns.map((column) => column.column), ...(profile.article_code_column ? [profile.article_code_column] : []), ...(profile.category_column ? [profile.category_column] : []), ...(profile.companion_note_column ? [profile.companion_note_column] : [])];
        if (required.some((header) => !Object.hasOwn(headers, header))) throw Error("Profile column missing. Confirm the exact supplier headers before importing.");
        const chunks = supplierImportChunks(rows, 500, 600_000, profile);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const sourceType = file.name.split(".").pop()!.toLowerCase();
        const result = await createSupplierSource({ profile_id: profileId, expected_profile: profile, title: String(form.get("title")), filename: file.name, file_hash: hash, source_type: sourceType, expected_rows: rows.length, expected_cells: rows.length * profile.price_columns.length, expected_chunks: chunks.length, original_reference: String(form.get("original")), effective_from: String(form.get("effective")), received_at: String(form.get("received")) });
        if (result.status !== "imported") {
          const path = `${brandId}/${result.id}/${hash}.${sourceType}`;
          const { error } = await createClient().storage.from("supplier-price-sources").upload(path, file, { upsert: false });
          if (error && !("statusCode" in error && ["409", "400"].includes(String(error.statusCode)))) throw Error(error.message);
          await attachSupplierWorkingFile(result.id, path);
          for (let index = 0; index < chunks.length; index++) { setMessage(`Uploading/resuming chunk ${index + 1}/${chunks.length}. Partial imports cannot be matched.`); await uploadSupplierChunk(result.id, index, chunks[index]); }
          await finalizeSupplierSource(result.id);
        }
        router.push(`/products/price-updates/supplier-sources?brand=${brandId}&source=${result.id}`); setMessage("Source finalized/reused. No Product prices or check dates changed.");
      }); }}>
        <label className="grid text-xs">Approved import profile<select name="profile" required className={input}><option value="">Choose profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title}</option>)}</select></label>
        <label className="grid text-xs">Source version title<input name="title" required className={input} placeholder="Feb 2026 Rev 02" /></label>
        <label className="grid text-xs">Structured file<input name="file" type="file" accept=".xlsx,.csv,.json" required className={input} /></label>
        <label className="grid text-xs">Original PDF/file reference (optional; no PDF extraction)<input name="original" className={input} placeholder="Existing original file URL/reference" /></label>
        <label className="grid text-xs">Received date<input name="received" type="date" className={input} /></label>
        <label className="grid text-xs">Intended effective date<input name="effective" type="date" className={input} /></label>
        <p className="text-xs text-zinc-600">Retry with the same file/profile to resume chunks. Codes are never numerically repaired. Unknown/mismatched basis remains NOT APPLY-READY.</p>
        <button disabled={busy || !profiles.length} className={button}>Import / resume source</button>
      </form>
    </details>
    {sourceId ? <form className="grid gap-2 rounded border border-zinc-200 p-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (form.get("scope") === "selected_templates" && !form.getAll("templates").length) { setMessage("Choose at least one Template for Selected Templates scope."); return; } void run(async () => { const result = await createSupplierReviewBatch(sourceId, String(form.get("scope")) as SourceScope, form.getAll("templates").map(String), String(form.get("brand_list")) || undefined); router.push(`/products/price-updates/supplier-sources?brand=${brandId}&source=${sourceId}&batch=${result.id}`); }); }}>
      <h3 className="text-sm font-semibold">Review against this imported source</h3>
      <label className="grid text-xs">Explicit coverage scope<select name="scope" value={scope} onChange={(event) => setScope(event.target.value as SourceScope)} className={input}><option value="partial">Partial / unspecified</option><option value="complete">Complete Brand (declaration only; no activation)</option><option value="selected_templates">Selected Templates</option></select></label>
      <label className={`grid text-xs ${scope !== "selected_templates" ? "text-zinc-500" : ""}`}>Selected Templates<select name="templates" multiple size={5} disabled={scope !== "selected_templates"} required={scope === "selected_templates"} aria-describedby="selected-templates-help" className={`${input} disabled:bg-zinc-100 disabled:opacity-60`}>{templates.map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select></label>
      <p id="selected-templates-help" className="text-xs text-zinc-600">Only used when scope is Selected Templates. Matching always remains Brand-wide.</p>
      <label className="grid text-xs">Existing Brand-list record ID (optional metadata link)<input name="brand_list" className={input} /></label>
      <p className="text-xs text-zinc-600">Duplicate/shared-code detection always covers the whole Brand. Selected Templates limit review only. A fresh batch preserves earlier decisions/snapshots.</p>
      <div className="flex gap-2"><button disabled={busy} className={button}>Build Brand-wide comparison</button><button type="button" disabled={busy} className={button} onClick={() => void run(async () => { await archiveSupplierSource(sourceId); setMessage("Source archived; historical data retained."); })}>Archive source</button></div>
    </form> : null}
  </div>;
}

export function SupplierReviewControls({ batchId, brandId, matches, approver, sourceProfile, sourceBasis, brandBasis, sourceStatus, batchStatus }: { batchId: string; brandId: string; matches: PriceMatch[]; approver: boolean; sourceProfile?: SupplierProfile; sourceBasis: string; brandBasis: string; sourceStatus: string; batchStatus: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [mapping, setMapping] = useState<PriceMatch | null>(null);
  type MappingOption = { key: string; label: string; price: number | null; currency: string; pricing_version: string };
  const [targets, setTargets] = useState<MappingOption[]>([]); const [chosenTargets, setChosenTargets] = useState<MappingOption[]>([]);
  const [targetQuery, setTargetQuery] = useState(""); const [targetFrom, setTargetFrom] = useState(0); const [moreTargets, setMoreTargets] = useState(false);
  const applyBlocked = !["list", "net"].includes(sourceBasis) ? "Apply blocked: source price basis is unknown."
    : !["list", "net"].includes(brandBasis) ? "Apply blocked: Brand stored price basis is unknown."
    : sourceBasis !== brandBasis ? "Apply blocked: source price basis does not match the Brand stored price basis."
    : sourceStatus !== "imported" ? "Apply blocked: source must be imported."
    : batchStatus !== "review" ? "Apply blocked: batch must be in review." : "";
  const rowApplyBlocked = (match: PriceMatch) => applyBlocked || (match.source?.price === null || match.source?.issues.length ? "Apply blocked: Supplier source price is invalid."
    : match.targets.some((target) => target.currency !== match.source?.currency) ? "Apply blocked: Supplier and Product currencies must match." : "");
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Review failed."); } finally { setBusy(false); } }
  return <div className="space-y-2">
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    {applyBlocked ? <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm">{applyBlocked}</p> : null}
    {approver ? <div className="flex flex-wrap items-center gap-2"><span className="text-xs">Shared candidates on this page:</span>{matches.filter((match) => match.candidate_shared && match.source).map((match) => <label key={match.key} className="text-xs"><input type="checkbox" checked={selected.includes(match.key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, match.key] : current.filter((key) => key !== match.key))} /> {match.source!.code}</label>)}<button disabled={busy || !selected.length} className={button} onClick={() => void run(async () => { await confirmSupplierBindings(brandId, matches.filter((match) => selected.includes(match.key) && match.source).map((match) => ({ code: match.source!.code, price_field: match.source!.price_field, source_dimension: match.source!.dimension, kind: "shared", target_keys: match.targets.map((target) => target.key), expected_targets: match.targets }))); setSelected([]); setMessage("Shared bindings confirmed. Build a new comparison batch to use durable mappings."); })}>Confirm selected as shared</button></div> : null}
    <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr className="border-b bg-zinc-50">{["Status", "Code / dimension", "Target baseline", "Source / new", "Change", "Decision"].map((title) => <th key={title} className="p-2">{title}</th>)}</tr></thead><tbody>{matches.map((match) => <tr key={match.key} className="border-b align-top">
      <td className="p-2"><span className={`${badge} ${classificationTone(match.classification)}`}>{readable(match.classification)}</span><div className="mt-1 text-zinc-500">Decision: {match.decision ? readable(match.decision) : "Not reviewed"}</div></td>
      <td className="max-w-48 space-y-1 p-2 break-words"><div className="font-mono text-sm font-semibold">{match.source?.code ?? match.targets[0]?.code}</div><div className="text-zinc-500">{match.source?.raw_dimension || match.source?.dimension || "Scalar"}</div>{match.source?.finishes.length ? <CodeSet label="Finishes" codes={match.source.finishes} /> : null}</td>
      <td className="space-y-3 p-2">{match.targets.map((target) => <div key={target.key}><div className="font-semibold">{target.template_name}</div><div className="text-zinc-600">{target.label} · {target.dimension || "scalar"}</div><div className="mt-1 border-t border-zinc-100 pt-1 font-medium tabular-nums">{target.currency} {target.price ?? "Missing"}</div></div>)}</td>
      <td className="space-y-1 p-2">{match.source ? <><div className="text-sm font-semibold tabular-nums">{match.source.currency} {match.source.price ?? "Invalid"}</div><div className="text-zinc-500">{match.source.row_keys.length} source rows; provenance retained</div>{match.source.issues.length ? <p className="text-amber-800">Validation: {match.source.issues.join(", ")}</p> : null}<details><summary className="cursor-pointer text-zinc-600">Source context (up to 3 rows)</summary>{match.provenance?.map((row) => <div key={`${row.sheet}:${row.row_number}`} className="my-1 max-w-72 break-words">{row.sheet}, row {row.row_number}<div>Raw code: {sourceProfile ? String(row.raw_extras[sourceProfile.full_code_column] ?? "") : ""}</div>{sourceProfile?.description_column ? <div>{String(row.raw_extras[sourceProfile.description_column] ?? "")}</div> : null}<details><summary className="cursor-pointer text-zinc-500">Raw dimensions / metadata</summary><pre className="whitespace-pre-wrap">{JSON.stringify(row.raw_extras, null, 2)}</pre></details></div>)}</details></> : "Not represented in source; not discontinued"}</td>
      <td className="space-y-2 p-2 tabular-nums">{match.source && match.targets.length ? match.targets.map((target) => <div key={target.key} className={target.price !== null && match.source!.price !== null && target.currency === match.source!.currency ? match.source!.price > target.price ? "font-medium text-amber-800" : match.source!.price < target.price ? "font-medium text-emerald-800" : "text-zinc-500" : "text-amber-800"}>{target.price !== null && match.source!.price !== null && target.currency === match.source!.currency ? <><div className="text-xs">{match.source!.price > target.price ? "Increased" : match.source!.price < target.price ? "Decreased" : "Unchanged"}</div>{`${(match.source!.price - target.price).toFixed(2)}${target.price ? ` (${((match.source!.price / target.price - 1) * 100).toFixed(2)}%)` : ""}`}</> : "Currency/baseline needs review"}</div>) : "—"}</td>
      <td className="p-2"><div className="flex flex-wrap gap-2">{["reviewed", "skip", "reject"].map((decision) => <button key={decision} disabled={busy || (decision === "reviewed" && !["increased", "decreased", "changed", "unchanged", "shared"].includes(match.classification))} className={button} onClick={() => void run(async () => { await saveSupplierDecision(batchId, match.key, decision, ""); })}>{decision}</button>)}{match.source ? <button disabled={busy} className={button} onClick={() => void run(async () => { const result = await supplierMappingTargets(brandId); setTargets(result.targets); setMoreTargets(result.hasMore); setTargetQuery(""); setTargetFrom(0); setChosenTargets([]); setMapping(match); })}>Explicit mapping</button> : null}
        {approver && ["increased", "decreased", "changed"].includes(match.classification) && match.decision === "reviewed" && match.source && match.targets.length === 1 ? <div className="space-y-1"><button type="button" disabled={busy || Boolean(rowApplyBlocked(match))} className={button} onClick={() => void run(async () => { const result = await applySupplierReviewedPrice(batchId, match.key); setMessage(result.message); })}>Apply price</button>{rowApplyBlocked(match) ? <p className="max-w-56 text-amber-800">{rowApplyBlocked(match)}</p> : null}</div> : null}
        {approver && match.classification === "unchanged" && match.source && match.targets.length === 1 && match.decision !== "confirmed_unchanged" ? <div className="space-y-1"><button type="button" disabled={busy || Boolean(rowApplyBlocked(match))} className={button} onClick={() => void run(async () => { const result = await confirmSupplierUnchangedPrice(batchId, match.key); setMessage(result.message); })}>Confirm unchanged</button>{rowApplyBlocked(match) ? <p className="max-w-56 text-amber-800">{rowApplyBlocked(match).replace("Apply blocked", "Confirm blocked")}</p> : null}</div> : null}
        {approver && match.classification === "shared" && match.comparison !== "unchanged" && match.decision === "reviewed" && match.source && match.targets.length >= 2 ? <div className="space-y-1"><button type="button" disabled={busy || Boolean(rowApplyBlocked(match))} className={button} onClick={() => void run(async () => { const result = await applySupplierReviewedPrice(batchId, match.key); setMessage(result.message); })}>Apply shared price</button>
          <p className="max-w-56 text-zinc-600">Applies this Supplier price to {match.targets.length} confirmed Product targets.</p>
          <details><summary className="cursor-pointer text-zinc-600">Confirmed targets</summary>{match.targets.map((target) => <div key={target.key} className="my-1 max-w-56 break-words"><div className="font-semibold">{target.template_name}</div><div>{target.label}</div><div className="tabular-nums">{target.currency} {target.price ?? "Missing"} → {match.source!.currency} {match.source!.price}</div></div>)}</details>
          {rowApplyBlocked(match) ? <p className="max-w-56 text-amber-800">{rowApplyBlocked(match)}</p> : null}</div> : null}
      </div></td>
    </tr>)}</tbody></table>{matches.length === 0 ? <p className="rounded-b border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-600">No comparison rows match these filters.</p> : null}</div>
    {mapping?.source ? <form className="grid gap-2 rounded border border-zinc-300 p-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const targetKeys = chosenTargets.map((target) => target.key); void run(async () => {
      if (!targetKeys.length) throw Error("Choose explicit targets.");
      if (approver) await confirmSupplierBindings(brandId, [{ code: mapping.source!.code, price_field: mapping.source!.price_field, source_dimension: mapping.source!.dimension, kind: String(form.get("kind")) as "alias" | "shared" | "disambiguation", target_keys: targetKeys, expected_targets: chosenTargets }]);
      else await saveSupplierDecision(batchId, mapping.key, "mapping_proposed", String(form.get("note")), targetKeys);
      setMapping(null); setMessage(approver ? "Durable mapping confirmed; create a fresh comparison batch." : "Mapping proposal saved for approver confirmation.");
    }); }}><h3 className="text-sm font-semibold">{approver ? "Confirm" : "Propose"} mapping: {mapping.source.code}</h3><p className="text-xs">Saved proposed keys: {mapping.proposed_target_keys?.join(", ") || "none"}</p><label className="grid text-xs">Binding kind<select name="kind" className={input}><option value="disambiguation">Disambiguation</option><option value="alias">Changed code / alias</option><option value="shared">Intentional shared code</option></select></label>
      <label className="grid text-xs">Search current target code / Template<input value={targetQuery} onChange={(event) => setTargetQuery(event.target.value)} className={input} /></label><button type="button" disabled={busy} className={button} onClick={() => void run(async () => { const result = await supplierMappingTargets(brandId, targetQuery); setTargets(result.targets); setMoreTargets(result.hasMore); setTargetFrom(0); })}>Search targets</button>
      <div className="max-h-64 overflow-auto text-xs">{targets.map((target) => <label key={target.key} className="block border-b py-1"><input type="checkbox" checked={chosenTargets.some((chosen) => chosen.key === target.key)} onChange={(event) => setChosenTargets((current) => event.target.checked ? [...current, target] : current.filter((chosen) => chosen.key !== target.key))} /> {target.label} — {target.currency} {target.price ?? "Missing"}</label>)}</div>
      <div className="flex gap-2">{[Math.max(0, targetFrom - 100), targetFrom + 100].map((next, index) => <button key={index} type="button" disabled={busy || (index === 1 && !moreTargets)} className={button} onClick={() => void run(async () => { const result = await supplierMappingTargets(brandId, targetQuery, next); setTargets(result.targets); setMoreTargets(result.hasMore); setTargetFrom(next); })}>{index ? "Next targets" : "Previous targets"}</button>)}</div>
      <div className="text-xs">Selected baselines:{chosenTargets.map((target) => <div key={target.key}>{target.label} — {target.currency} {target.price ?? "Missing"}</div>)}</div><label className="grid text-xs">Review note<input name="note" className={input} /></label><button disabled={busy || !chosenTargets.length} className={button}>{approver ? "Confirm durable binding" : "Save proposal"}</button><button type="button" className={button} onClick={() => setMapping(null)}>Cancel</button></form> : null}
  </div>;
}
