"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSupplierFile } from "@/lib/products/supplier-price-file";
import { SupplierSourceField, type SourceChoice, type SourceOption } from "@/components/products/supplier-coverage";
import { supplierImportChunks } from "@/lib/products/supplier-price-import";
import type { DimensionRule, PriceMatch, SourceScope, SupplierProfile } from "@/lib/products/supplier-price-contracts";
import type { SupplierCompletionCount, SupplierCompletionReadiness } from "@/lib/products/supplier-price-repository";
import { applySupplierReviewedPrice, completeSupplierPriceReview, confirmSupplierUnchangedPrice, excludeSupplierTargetFromSource, supplierCompletionStatus, archiveSupplierDimension, archiveSupplierSource, attachSupplierWorkingFile, confirmSupplierBindings, createSupplierReviewBatch, createSupplierSource, createSupplierSourceDefinition, linkSupplierSourceDefinition, finalizeSupplierSource, saveSupplierDecision, saveSupplierDimension, saveSupplierProfile, supplierMappingTargets, supplierProfileForImport, updateSupplierBrandBasis, updateSupplierSourceBasis, uploadSupplierChunk } from "@/app/products/price-updates/supplier-sources/actions";

// ProjectWorkflow patterns: white card, light border and shadow, emerald primary, zinc secondary.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const button = "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const readable = (value: string) => { const label = value.replaceAll("_", " "); return label.charAt(0).toUpperCase() + label.slice(1); };
const badge = "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium";
const classificationTone = (value: string) => ["increased", "ambiguous", "needs_dimension_mapping", "baseline_drift", "invalid_source"].includes(value) ? "border-amber-200 bg-amber-50 text-amber-800" : value === "decreased" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-700";

function CodeSet({ label, codes }: { label: string; codes: string[] }) {
  if (codes.length <= 8) return <div className="break-words">{label}: {codes.join(", ")}</div>;
  return <details className="break-words"><summary className="cursor-pointer">{label}: {codes.slice(0, 8).join(", ")} … ({codes.length} total)</summary><div className="mt-1">{codes.join(", ")}</div></details>;
}
const basisLabel = (basis: string) => basis === "list" ? "List" : basis === "net" ? "Net" : "Unknown";
const basisDefinition = <p className="text-xs text-zinc-600"><span className="font-medium text-zinc-800">List price</span> — Supplier catalogue/list price before normal commercial discount logic. <span className="font-medium text-zinc-800">Net price</span> — Supplier price already reflects the Supplier&apos;s net/discounted basis.</p>;
function BasisChoices({ value, onChange, disabled }: { value: string; onChange: (basis: "list" | "net") => void; disabled: boolean }) {
  return <div className="flex gap-2"><button type="button" disabled={disabled} onClick={() => onChange("list")} className={value === "list" ? primary : button}>List price</button><button type="button" disabled={disabled} onClick={() => onChange("net")} className={value === "net" ? primary : button}>Net price</button></div>;
}
export function SupplierPriceBasisPanel({ brandId, sourceId, sourceName, sourceTitle, sourceBasis, brandBasis, approver }: { brandId: string; sourceId: string; sourceName: string; sourceTitle: string; sourceBasis: string; brandBasis: string; approver: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const sourceUnknown = !["list", "net"].includes(sourceBasis); const brandUnknown = !["list", "net"].includes(brandBasis); const mismatch = !sourceUnknown && !brandUnknown && sourceBasis !== brandBasis;
  const [sourceChoice, setSourceChoice] = useState<"list" | "net">(sourceBasis === "net" ? "net" : "list");
  const [brandChoice, setBrandChoice] = useState<"list" | "net">(brandBasis === "net" ? "net" : sourceBasis === "net" ? "net" : "list");
  const [editing, setEditing] = useState<"" | "source" | "brand">("");
  if (!sourceUnknown && !brandUnknown && !mismatch) return null;
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not confirm price basis."); } finally { setBusy(false); } }
  const confirmSource = () => void run(async () => { await updateSupplierSourceBasis(brandId, sourceId, sourceChoice); setMessage("Supplier price-list basis confirmed."); });
  const confirmBrand = () => void run(async () => { await updateSupplierBrandBasis(brandId, brandChoice); setMessage("Brand pricing basis confirmed."); });
  return <section id="supplier-price-basis" className={`${card} scroll-mt-4 space-y-3 border-amber-300 bg-amber-50 p-4`} aria-label="Price basis confirmation">
    <div><h3 className="text-base font-semibold text-zinc-950">{mismatch ? "Price basis mismatch" : brandUnknown && !sourceUnknown ? "Brand pricing basis needs confirmation" : "Price basis needs confirmation"}</h3><p className="text-sm text-zinc-700">{mismatch ? "Prices cannot be applied until they match." : "Price basis needs confirmation before prices can be applied."}</p></div>
    <div className="grid gap-2 rounded border border-amber-200 bg-white/70 p-3 text-sm sm:grid-cols-2"><div><span className="block text-xs font-medium text-zinc-600">Source</span><span className="font-semibold">{sourceName}</span></div><div><span className="block text-xs font-medium text-zinc-600">Price list</span><span className="font-semibold">{sourceTitle}</span></div></div>
    <div className="grid gap-2 text-sm sm:grid-cols-2"><div><span className="block text-xs font-medium text-zinc-600">Supplier price list</span><span className="font-semibold">{basisLabel(sourceBasis)}</span></div><div><span className="block text-xs font-medium text-zinc-600">Brand pricing basis</span><span className="font-semibold">{basisLabel(brandBasis)}</span></div></div>
    {sourceUnknown ? <div className="space-y-2"><p className="text-sm font-medium">{brandUnknown ? "Step 1 — Supplier price-list basis" : "How should prices in this Supplier file be interpreted?"}</p>{approver ? <><BasisChoices value={sourceChoice} onChange={setSourceChoice} disabled={busy} /><button type="button" disabled={busy} className={primary} onClick={confirmSource}>Confirm Supplier basis</button></> : <p className="text-xs text-zinc-600">An approver must confirm the Supplier basis.</p>}</div> : null}
    {brandUnknown ? <div className="space-y-2"><p className="text-sm font-medium">{sourceUnknown ? "Step 2 — Brand pricing basis" : "Brand pricing basis"}</p>{approver ? <><BasisChoices value={brandChoice} onChange={setBrandChoice} disabled={busy || sourceUnknown} /><button type="button" disabled={busy || sourceUnknown} className={primary} onClick={confirmBrand}>{sourceUnknown ? "Confirm Brand basis after Supplier basis" : "Confirm Brand basis"}</button></> : <p className="text-xs text-zinc-600">An approver must confirm the Brand basis.</p>}</div> : null}
    {mismatch ? <div className="flex flex-wrap gap-2">{approver ? <><button type="button" disabled={busy} className={button} onClick={() => setEditing("source")}>Change Supplier basis</button><button type="button" disabled={busy} className={button} onClick={() => setEditing("brand")}>Change Brand basis</button>{editing === "source" ? <div className="basis-full space-y-2"><BasisChoices value={sourceChoice} onChange={setSourceChoice} disabled={busy} /><button type="button" disabled={busy} className={button} onClick={confirmSource}>Confirm Supplier basis</button></div> : null}{editing === "brand" ? <div className="basis-full space-y-2"><BasisChoices value={brandChoice} onChange={setBrandChoice} disabled={busy} /><button type="button" disabled={busy} className={button} onClick={confirmBrand}>Confirm Brand basis</button></div> : null}</> : <p className="text-xs text-zinc-600">An approver must choose the correct basis.</p>}</div> : null}
    {basisDefinition}<p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
  </section>;
}
type ProfileOption = { id: string; title: string; config: SupplierProfile };

/** Step 1: one simple card. The approved import profile is chosen automatically; currency and basis come from that format. */
export function SupplierImportCard({ brandId, brandName, profiles, suggestedTitle, advancedHref, setupHref, sources = [] }: { brandId: string; brandName: string; profiles: ProfileOption[]; suggestedTitle: string; advancedHref: string; setupHref: string; sources?: SourceOption[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [fileType, setFileType] = useState("");
  const [profileId, setProfileId] = useState(profiles.length === 1 ? profiles[0].id : "");
  const chosen = profiles.find((profile) => profile.id === profileId);
  const [choice, setChoice] = useState<SourceChoice>({ value: sources.length === 1 ? sources[0].id : "", newName: "" });
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); } finally { setBusy(false); } }
  if (!profiles.length) return <section className={`${card} space-y-2 p-4`}><h3 className="text-base font-semibold text-zinc-950">Import Supplier Price List</h3>
    <p className="text-sm">This Brand needs an import profile before price lists can be imported.</p><Link href={setupHref} className={button + " inline-block"}>Set up import profile</Link></section>;
  return <form className={`${card} space-y-4 p-4`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("file"); void run(async () => {
    if (!(file instanceof File) || !file.size) throw Error("Choose the price list file.");
    if (!profileId) throw Error("Choose an import profile.");
    const profile = await supplierProfileForImport(profileId);
    setMessage("Reading the price list. Codes stay exactly as written.");
    const rows = await parseSupplierFile(file, profile.sheet_names);
    if (!rows.length) throw Error("The price list has no data rows.");
    const headers = rows[0].values;
    const required = [profile.full_code_column, ...profile.price_columns.map((column) => column.column), ...(profile.article_code_column ? [profile.article_code_column] : []), ...(profile.category_column ? [profile.category_column] : []), ...(profile.companion_note_column ? [profile.companion_note_column] : [])];
    if (required.some((header) => !Object.hasOwn(headers, header))) throw Error("This file does not match the import profile. Check the file, or change the import profile in Advanced import settings.");
    if (choice.value === "new" && !choice.newName.trim()) throw Error("Enter a Supplier source name.");
    const chunks = supplierImportChunks(rows, 500, 600_000, profile);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const sourceType = file.name.split(".").pop()!.toLowerCase();
    const definitionId = choice.value === "new" ? (await createSupplierSourceDefinition(brandId, choice.newName, profileId)).id : choice.value;
    const result = await createSupplierSource({ profile_id: profileId, expected_profile: profile, title: String(form.get("title")), filename: file.name, file_hash: hash, source_type: sourceType, expected_rows: rows.length, expected_cells: rows.length * profile.price_columns.length, expected_chunks: chunks.length, original_reference: String(form.get("original") ?? ""), effective_from: String(form.get("effective")), received_at: String(form.get("received")) });
    if (result.status !== "imported") {
      if (definitionId) await linkSupplierSourceDefinition(result.id, definitionId);
      const path = `${brandId}/${result.id}/${hash}.${sourceType}`;
      const { error } = await createClient().storage.from("supplier-price-sources").upload(path, file, { upsert: false });
      if (error && !("statusCode" in error && ["409", "400"].includes(String(error.statusCode)))) throw Error(error.message);
      await attachSupplierWorkingFile(result.id, path);
      for (let index = 0; index < chunks.length; index++) { setMessage(`Uploading part ${index + 1} of ${chunks.length}. Do not close this page.`); await uploadSupplierChunk(result.id, index, chunks[index]); }
      // Finalizing runs in bounded steps so very large price lists stay within the database time limit; it resumes where it stopped.
      for (let step = 1; ; step++) { const progress = await finalizeSupplierSource(result.id); if (progress.done) break; setMessage(`Building Supplier price identities (step ${step}, ${progress.remaining_codes} codes left). Do not close this page.`); }
    }
    if (result.existing) setMessage("Supplier source already exists. Opening the existing price list instead of importing the same file again.");
    router.push(`/products/price-updates/supplier-sources?brand=${brandId}&source=${result.id}&view=summary`); router.refresh();
  }); }}>
    <div><h3 className="text-base font-semibold text-zinc-950">Import Supplier Price List</h3><p className="text-xs text-zinc-500">Choose the file and name. Currency and price basis come from the import profile.</p></div>
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    <SupplierSourceField options={sources} choice={choice} onChangeAction={setChoice} profileTitle={chosen?.title ?? ""} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div className="grid gap-1 text-xs"><span className="font-medium">Brand</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{brandName}</span></div>
      <label className="grid gap-1 text-xs"><span className="font-medium">Price list file</span><input name="file" type="file" accept=".xlsx,.csv,.json" required className={input} onChange={(event) => setFileType((event.target.files?.[0]?.name.split(".").pop() ?? "").toLowerCase())} /></label>
      <div className="grid gap-1 text-xs"><span className="font-medium">File type</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{["xlsx", "csv", "json"].includes(fileType) ? fileType.toUpperCase() : fileType ? "Not supported — use XLSX, CSV or JSON" : "XLSX, CSV or JSON (taken from the file)"}</span></div>
      <label className="grid gap-1 text-xs"><span className="font-medium">Price list name</span><input name="title" required defaultValue={suggestedTitle} className={input} /></label>
      {profiles.length === 1 ? <div className="grid gap-1 text-xs"><span className="font-medium">Import profile</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{profiles[0].title} <span className="text-emerald-800">· Ready</span></span></div>
        : <label className="grid gap-1 text-xs"><span className="font-medium">Import profile</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} required className={input}><option value="">Choose import profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.title}</option>)}</select></label>}
      <div className="grid gap-1 text-xs"><span className="font-medium">Currency</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{chosen ? chosen.config.currency : "Set by the import profile"}</span></div>
      <div className="grid gap-1 text-xs"><span className="font-medium">Price basis</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{chosen ? (chosen.config.basis === "list" ? "List" : chosen.config.basis === "net" ? "Net" : "Not set") : "Set by the import profile"}</span></div>
      <label className="grid gap-1 text-xs"><span className="font-medium">Received date (optional)</span><input name="received" type="date" className={input} /></label>
      <label className="grid gap-1 text-xs"><span className="font-medium">Effective date (optional)</span><input name="effective" type="date" className={input} /></label>
    </div>
    <details className="text-xs"><summary className="cursor-pointer">More options</summary><label className="mt-2 grid gap-1"><span className="font-medium">Original file reference (optional)</span><input name="original" className={input} /></label></details>
    <p className="text-xs text-zinc-600">Currency and price basis come from the selected import profile. To change the profile, use <Link href={advancedHref} className="underline">Advanced import settings</Link>. Importing the same file again resumes an unfinished import.</p>
    <button disabled={busy || !profileId} className={primary}>Import price list</button>
  </form>;
}

/** Technical import tools, collapsed by default and approver-only as before. */
export function SupplierAdvancedImportSettings({ brandId, brandName, basis, approver, templates, dimensions = [], open = false, profiles = [] }: { brandId: string; brandName: string; basis: string; approver: boolean; templates: Array<{ id: string; template_name: string }>; dimensions?: DimensionRule[]; open?: boolean; profiles?: ProfileOption[] }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); } finally { setBusy(false); } }
  const las = brandName === "LAS MOBILI";
  const example = { strategy: las ? "article_plus_finish" : "exact", full_code_column: las ? "CODICE_ARTICOLO" : "SET_EXACT_CODE_HEADER", ...(las ? { article_code_column: "NOME_FILE", article_length: 6, finish_length: 3, validated_article_fallback: true, category_column: "CATEGORIA_TESSUTO" } : {}), price_columns: [{ column: las ? "PREZZO_UNITARIO" : "PRICE", price_field: "unit_price" }], currency: "EUR", basis };
  if (!approver) return null;
  return <details id="advanced" open={open} className="group rounded-lg border border-zinc-200 bg-zinc-50 p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-2"><span><span className="block text-sm font-semibold text-zinc-950">Advanced import settings</span><span className="block text-xs text-zinc-500">Import profile, vocabulary and technical mapping tools.</span></span><span aria-hidden="true" className="text-zinc-500 transition group-open:rotate-90">▸</span></summary>
    <p role="status" aria-live="polite" className="mt-2 text-sm text-amber-800">{message}</p>
    <p className="mt-1 text-xs text-zinc-600">Import profiles, canonical size / option codes, finish-code rules and group IDs. Most price lists never need these.</p>
    {profiles.length ? <div className="mt-2 space-y-1 text-xs"><h4 className="font-semibold text-zinc-800">Change import profile</h4><p className="text-zinc-600">Imports use the Brand&apos;s saved profile automatically. To change it, save an updated profile under the same name below, or add a new one.</p>{profiles.map((profile) => <details key={profile.id} className="rounded border border-zinc-200 p-2"><summary className="cursor-pointer">View generated JSON — {profile.title}</summary><pre aria-label={`Generated JSON for ${profile.title} (read-only)`} className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 font-mono">{JSON.stringify(profile.config, null, 2)}</pre></details>)}</div> : null}
    {approver ? <details open className="mt-2 rounded border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Import profiles & canonical dimensions</summary>
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
  </details>;
}

/** Step 2 entry: choose what to review. Complete Brand is the recommended default. */
export function SupplierStartReview({ brandId, sourceId, templates }: { brandId: string; sourceId: string; templates: Array<{ id: string; template_name: string }> }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [scope, setScope] = useState<SourceScope>("complete");
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start the review."); } finally { setBusy(false); } }
  const options: Array<[SourceScope, string, string]> = [["complete", "Complete Brand (recommended)", "Review the full active Product range for this Brand."], ["selected_templates", "Selected Families", "Review only the Product families you choose."], ["partial", "Partial / Other", "Advanced use. This review cannot activate a Brand-wide baseline."]];
  return <form className={`${card} space-y-4 p-4`} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (form.get("scope") === "selected_templates" && !form.getAll("templates").length) { setMessage("Choose at least one Family for Selected Families."); return; } void run(async () => { const result = await createSupplierReviewBatch(sourceId, String(form.get("scope")) as SourceScope, form.getAll("templates").map(String), String(form.get("brand_list") ?? "") || undefined); router.push(`/products/price-updates/supplier-sources?brand=${brandId}&source=${sourceId}&batch=${result.id}&view=family`); router.refresh(); }); }}>
    <h3 className="text-base font-semibold text-zinc-950">Start Review</h3>
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>
    <fieldset className="space-y-2"><legend className="text-xs font-medium">Coverage</legend>{options.map(([value, label, help]) => <label key={value} className={`flex items-start gap-2 rounded-md border p-3 text-sm transition ${scope === value ? "border-emerald-800 bg-emerald-50" : "border-zinc-200 hover:bg-zinc-50"}`}><input type="radio" name="scope" value={value} checked={scope === value} onChange={() => setScope(value)} className="mt-1 accent-emerald-900" /><span><span className="font-semibold text-zinc-950">{label}</span><br /><span className="text-xs text-zinc-600">{help}</span></span></label>)}</fieldset>
    {scope === "selected_templates" ? <label className="grid gap-1 text-xs"><span className="font-medium">Families to review</span><select name="templates" multiple size={6} required aria-describedby="selected-families-help" className={input}>{templates.map((template) => <option key={template.id} value={template.id}>{template.template_name}</option>)}</select><span id="selected-families-help" className="text-zinc-600">Hold Ctrl or Cmd to choose several. Matching always covers the whole Brand; this limits what you review.</span></label> : null}
    <details className="text-xs"><summary className="cursor-pointer">Link to an existing price-list record (optional)</summary><label className="mt-2 grid gap-1"><span className="font-medium">Record ID</span><input name="brand_list" className={input} /></label></details>
    <div className="flex flex-wrap gap-2"><button disabled={busy} className={primary}>Start review</button><button type="button" disabled={busy} className={button} onClick={() => void run(async () => { await archiveSupplierSource(sourceId); router.push(`/products/price-updates/supplier-sources?brand=${brandId}`); router.refresh(); })}>Archive this price list</button></div>
  </form>;
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
        {approver && batchStatus === "review" && match.classification === "target_not_represented" && match.decision !== "excluded_from_source" ? <form className="grid max-w-56 gap-1" onSubmit={(event) => { event.preventDefault(); const note = String(new FormData(event.currentTarget).get("reason") ?? "").trim(); if (!note) { setMessage("Enter a reason before excluding this target."); return; } void run(async () => { const result = await excludeSupplierTargetFromSource(batchId, match.key, note); setMessage(result.message); }); }}><input name="reason" required maxLength={4000} placeholder="Reason (required)" aria-label="Exclusion reason" className={input} /><button disabled={busy} className={button}>Exclude from this source</button></form> : null}
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

const completionLabels: Array<[SupplierCompletionCount, string]> = [
  ["unresolved_changed", "Unresolved changed"], ["unchanged_not_confirmed", "Unchanged not confirmed"], ["unresolved_shared", "Unresolved shared"],
  ["changed_after_review", "Product changed after review"], ["skipped", "Skipped"], ["rejected", "Rejected"], ["mapping_proposed", "Mapping proposed"],
  ["ambiguous", "Ambiguous"], ["needs_dimension_mapping", "Needs dimension mapping"], ["baseline_drift", "Baseline drift"], ["invalid_source", "Invalid source"],
  ["target_not_represented", "Target not represented"], ["targets_added_after_comparison", "Targets added after comparison"],
  ["excluded_from_source", "Excluded from source"], ["unmatched", "Unmatched source items (not blocking)"], ["referenced_companion", "Referenced companions (not blocking)"], ["resolved", "Resolved"],
];

export function SupplierCompletionControls({ batchId, scope, status, approver, reviewHref, partialSource }: { batchId: string; scope: string; status: string; approver: boolean; reviewHref?: string; partialSource?: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [readiness, setReadiness] = useState<SupplierCompletionReadiness | null>(null); const [checked, setChecked] = useState(false);
  const live = approver && scope === "complete" && status === "review";
  // The server answers the same readiness question as the final click; the button only enables when it says ready.
  useEffect(() => { if (!live) return; let current = true; supplierCompletionStatus(batchId).then((result) => { if (current) { setReadiness(result); setChecked(true); } }, () => { if (current) setChecked(true); }); return () => { current = false; }; }, [batchId, live]);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Completion failed."); } finally { setBusy(false); } }
  const statusLine = <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>;
  if (status === "completed") return <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">{statusLine}<p>This price-list review is completed. Its results are kept as history; no further changes are possible.</p></div>;
  if (scope !== "complete") return <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">This review cannot activate a Brand-wide baseline because coverage is not Complete.</p>;
  if (!approver || status !== "review") return null;
  return <section className={`${card} space-y-3 p-4`} aria-label="Complete review">
    <h3 className="text-base font-semibold text-zinc-950">Complete Review</h3>
    <p className="text-xs text-zinc-600">{partialSource ? `Only the Families covered by ${partialSource} are checked. Other Families remain covered by other Supplier sources or need separate coverage. Excluded targets will remain Needs price check. Unmatched Supplier items do not block completion and create no Products.` : "Excluded targets will remain Needs price check after this Brand baseline is activated. Unmatched Supplier items do not block completion and create no Products."}</p>
    {statusLine}
    {!checked ? <p className="text-xs text-zinc-600">Checking whether this review can be completed…</p> : readiness?.issue ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{readiness.issue}</p> : readiness && !readiness.ready ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{readiness.blocking} {readiness.blocking === 1 ? "item needs" : "items need"} attention before you can complete.{reviewHref ? <> <Link href={reviewHref} className="underline">Review items</Link></> : null}</p>
      : readiness ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">Ready: {readiness.checkedTemplates} {readiness.checkedTemplates === 1 ? "family" : "families"} will be marked checked; {readiness.excludedTemplates} stay unchecked because of source exclusions.</p> : <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">Readiness could not be checked. Try again.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !readiness?.ready} className={primary} onClick={() => void run(async () => { const result = await completeSupplierPriceReview(batchId); setReadiness(null); setMessage(partialSource ? `${partialSource} review completed. ${result.checked_templates} covered ${result.checked_templates === 1 ? "Family was" : "Families were"} checked. Other Families remain covered by other Supplier sources or need separate coverage.` : `${result.message} ${result.title} · baseline ${result.baseline_date ?? "not dated"} · ${result.checked_templates} Templates marked checked · ${result.excluded_templates} left unchecked because of source exclusions.`); router.refresh(); })}>{partialSource ? `Complete ${partialSource} review` : "Complete Brand Review"}</button>
      <button type="button" disabled={busy} className={button} onClick={() => void run(async () => { setReadiness(await supplierCompletionStatus(batchId)); setChecked(true); })}>Check again</button>
    </div>
    {readiness ? <details><summary className="cursor-pointer text-xs">View technical readiness details</summary><dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{completionLabels.map(([key, label]) => <div key={key} className={`rounded border p-2 ${readiness.counts[key] > 0 && !["resolved", "excluded_from_source", "unmatched", "referenced_companion"].includes(key) ? "border-amber-300 bg-amber-50" : "border-zinc-200"}`}><dt>{label}</dt><dd className="font-semibold tabular-nums">{readiness.counts[key]}</dd></div>)}</dl></details> : null}
  </section>;
}

/** Archive keeps all history and provenance; it only hides the price list from the default list. */
export function SupplierArchiveButton({ sourceId, title }: { sourceId: string; title: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <span className="inline-flex flex-col"><button type="button" disabled={busy} className="block w-full rounded px-2 py-1 text-left text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50" aria-label={`Archive price list ${title}`} onClick={() => {
    if (!window.confirm(`Archive "${title}"? It stays in history and can no longer be used for new reviews.`)) return;
    setBusy(true); setMessage("");
    archiveSupplierSource(sourceId).then(() => router.refresh(), (error: unknown) => setMessage(error instanceof Error ? error.message : "Could not archive.")).finally(() => setBusy(false));
  }}>Archive</button>{message ? <span role="alert" className="text-amber-800">{message}</span> : null}</span>;
}
