"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSupplierFile } from "@/lib/products/supplier-price-file";
import { supplierImportChunks } from "@/lib/products/supplier-price-import";
import type { RawSupplierRow, SupplierProfile } from "@/lib/products/supplier-price-contracts";
import {
  compatibleProfile, mappingFromProfile, previewImport, profileFromMapping, profileRequiredColumns, suggestDefinition, suggestMapping,
  type WizardDefinition, type WizardMapping, type WizardProfileOption,
} from "@/lib/products/supplier-import-wizard";
import {
  attachSupplierWorkingFile, confirmSupplierCoverage, createSupplierReviewBatch, createSupplierSource, createSupplierSourceDefinition,
  finalizeSupplierSource, linkSupplierSourceDefinition, saveSupplierProfile, supplierProfileForImport, uploadSupplierChunk,
} from "@/app/products/price-updates/supplier-sources/actions";

// Normal import flow: Upload → Match columns → Details → Families → Review. Technical setup stays under Advanced import settings.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const button = "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50";
export const wizardSteps = ["Upload", "Match columns", "Details", "Families", "Review"] as const;
type Step = 1 | 2 | 3 | 4 | 5;
type Preview = ReturnType<typeof previewImport>;

export function SupplierImportWizard({ brandId, brandName, profiles, definitions, families, suggestedTitle, advancedHref, approver }: {
  brandId: string; brandName: string; profiles: WizardProfileOption[]; definitions: WizardDefinition[]; families: Array<{ id: string; name: string }>;
  suggestedTitle: string; advancedHref: string; approver: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null), [rows, setRows] = useState<RawSupplierRow[]>([]);
  const [saved, setSaved] = useState<WizardProfileOption | null>(null), [useSaved, setUseSaved] = useState(false);
  const [mapping, setMapping] = useState<WizardMapping | null>(null);
  const [title, setTitle] = useState(suggestedTitle), [effective, setEffective] = useState("");
  const [definitionId, setDefinitionId] = useState(""), [newName, setNewName] = useState(`${brandName} price list`), [selected, setSelected] = useState<string[]>([]);
  const headers = rows.length ? Object.keys(rows[0].values) : [];
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong."); } finally { setBusy(false); } }
  if (!approver) return <section className={`${card} p-4 text-sm`}><h3 className="text-base font-semibold text-zinc-950">Import new price list</h3><p className="mt-1">An approver imports Supplier price lists.</p></section>;

  const definition = definitions.find((item) => item.id === definitionId) ?? null;
  function chooseDefinition(id: string, list = definitions) { setDefinitionId(id); setSelected(list.find((item) => item.id === id)?.familyIds ?? []); }
  let profile: SupplierProfile | null = null, profileError = "";
  if (mapping) { try { profile = profileFromMapping(mapping); } catch (error) { profileError = error instanceof Error ? error.message : "Check the columns."; } }
  const preview: Preview = profile && rows.length ? previewImport(rows, profile) : [];
  const set = <K extends keyof WizardMapping>(key: K, value: WizardMapping[K]) => setMapping((current) => current ? { ...current, [key]: value } : current);
  const known = useSaved && saved !== null;

  function readFile(chosen: File) {
    void run(async () => {
      const parsed = await parseSupplierFile(chosen); if (!parsed.length) throw Error("The price list has no data rows.");
      const names = Object.keys(parsed[0].values), match = compatibleProfile(profiles, names);
      setFile(chosen); setRows(parsed); setSaved(match); setUseSaved(false); setMapping(match ? mappingFromProfile(match.config) : suggestMapping(names));
      const suggestion = suggestDefinition(definitions, match?.id ?? null);
      if (suggestion) chooseDefinition(suggestion.id); else { setDefinitionId(definitions.length ? "" : "new"); setSelected([]); }
    });
  }

  async function startReview() {
    if (!file || !mapping || !profile) return;
    await run(async () => {
      setMessage("Reading the price list. Codes stay exactly as written.");
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
      // The confirmed mapping becomes (or reuses) the Brand's existing import profile.
      const profileId: string = known && saved ? saved.id : (await saveSupplierProfile(brandId, `${brandName} mapping ${hash.slice(0, 8)}`, profile)).id;
      const stored = await supplierProfileForImport(profileId);
      const importRows = known && stored.sheet_names ? await parseSupplierFile(file, stored.sheet_names) : rows;
      if (!importRows.length) throw Error("The price list has no data rows.");
      const present = Object.keys(importRows[0].values);
      if (profileRequiredColumns(stored).some((column) => !present.includes(column))) throw Error("This file does not match the chosen columns. Go back to Match columns.");
      const chunks = supplierImportChunks(importRows, 500, 600_000, stored), sourceType = file.name.split(".").pop()!.toLowerCase();
      const coverageId = definitionId === "new" ? (await createSupplierSourceDefinition(brandId, newName.trim(), profileId)).id : definitionId;
      const result = await createSupplierSource({ profile_id: profileId, expected_profile: stored, title: title.trim(), filename: file.name, file_hash: hash, source_type: sourceType, expected_rows: importRows.length, expected_cells: importRows.length * stored.price_columns.length, expected_chunks: chunks.length, original_reference: "", effective_from: effective, received_at: "" });
      if (result.status !== "imported") {
        if (coverageId) await linkSupplierSourceDefinition(result.id, coverageId);
        const path = `${brandId}/${result.id}/${hash}.${sourceType}`;
        const { error } = await createClient().storage.from("supplier-price-sources").upload(path, file, { upsert: false });
        if (error && !("statusCode" in error && ["409", "400"].includes(String(error.statusCode)))) throw Error(error.message);
        await attachSupplierWorkingFile(result.id, path);
        for (let index = 0; index < chunks.length; index++) { setMessage(`Uploading part ${index + 1} of ${chunks.length}. Do not close this page.`); await uploadSupplierChunk(result.id, index, chunks[index]); }
        for (let part = 1; ; part++) { const progress = await finalizeSupplierSource(result.id); if (progress.done) break; setMessage(`Preparing the price list (step ${part}, ${progress.remaining_codes} codes left). Do not close this page.`); }
      }
      const before = new Set(definition?.familyIds ?? []);
      if (coverageId && (definitionId === "new" || selected.length !== before.size || selected.some((id) => !before.has(id)))) await confirmSupplierCoverage(coverageId, selected);
      const workspace = `/products/price-updates/supplier-sources?brand=${brandId}&source=${result.id}`;
      if (result.existing) { router.push(`${workspace}&view=summary`); router.refresh(); return; }
      setMessage("Comparing with your Products. This can take a moment.");
      try { const batch = await createSupplierReviewBatch(result.id, "complete", []); router.push(`${workspace}&batch=${batch.id}&view=family`); }
      catch (error) { setMessage(error instanceof Error ? error.message : "The review could not start."); router.push(`${workspace}&view=summary`); }
      router.refresh();
    });
  }

  const select = (label: string, key: "fullCode" | "articleCode" | "description" | "category", required: boolean) =>
    <div key={key} className="grid items-center gap-2 py-2 sm:grid-cols-[14rem_1fr]"><label htmlFor={`wizard-${key}`} className="text-sm font-medium text-zinc-800">{label}{required ? "" : " (optional)"}</label>
      <select id={`wizard-${key}`} value={mapping?.[key] ?? ""} onChange={(event) => set(key, event.target.value)} className={input}><option value="">{required ? "Choose heading" : "Not used"}</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>;
  const togglePrice = (column: string, on: boolean) => setMapping((current) => current ? { ...current, priceColumns: on ? [...current.priceColumns, { column, label: "" }] : current.priceColumns.filter((item) => item.column !== column) } : current);
  const labelPrice = (column: string, label: string) => setMapping((current) => current ? { ...current, priceColumns: current.priceColumns.map((item) => item.column === column ? { ...item, label } : item) } : current);
  const mappingReady = Boolean(mapping?.fullCode && mapping.priceColumns.length && !profileError);
  const familiesReady = selected.length > 0 && (definitionId !== "new" || newName.trim() !== "") && definitionId !== "";

  return <section className={`${card} space-y-4 p-4`} aria-label="Import new price list">
    <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold" aria-label="Import steps">{wizardSteps.map((name, index) => { const number = index + 1; const state = number < step ? "done" : number === step ? "current" : "todo";
      return <li key={name} className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 ${state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : state === "current" ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-200 text-zinc-500"}`} aria-current={state === "current" ? "step" : undefined}><span aria-hidden="true">{state === "done" ? "✓" : number}</span>{name}</li>; })}</ol>
    <div><h3 className="text-base font-semibold text-zinc-950">Import new price list</h3><p className="text-xs text-zinc-500">{brandName} · step {step} of 5.</p></div>
    <p role="status" aria-live="polite" className="text-sm text-amber-800">{message}</p>

    {step === 1 ? <div className="space-y-3">
      <label className="grid gap-1 text-xs"><span className="font-medium">Price list file (Excel or CSV)</span><input type="file" accept=".xlsx,.csv,.json" className={input} disabled={busy} onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) readFile(chosen); }} /></label>
      {rows.length ? <p className="text-sm">{rows.length.toLocaleString("en-US")} rows and {headers.length} column headings found.</p> : null}
      {rows.length && saved ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><p className="font-semibold">Previous column mapping found</p><p className="text-xs">{saved.title} matches the headings in this file.</p>
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={primary} disabled={busy} onClick={() => { setUseSaved(true); setStep(3); }}>Use previous mapping</button><button type="button" className={button} disabled={busy} onClick={() => { setUseSaved(false); setStep(2); }}>Review mapping</button></div></div> : null}
      {rows.length && !saved ? <button type="button" className={primary} disabled={busy} onClick={() => setStep(2)}>Next: match columns</button> : null}
    </div> : null}

    {step === 2 && mapping ? <div className="space-y-3">
      <div className="divide-y divide-zinc-100 rounded-md border border-zinc-200 px-3"><div className="grid gap-2 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 sm:grid-cols-[14rem_1fr]"><span>ProjectWorkflow field</span><span>Excel heading</span></div>
        {select("Supplier code", "fullCode", true)}{select("Description", "description", false)}{select("Category / tier column", "category", false)}</div>
      <fieldset className="space-y-2"><legend className="text-sm font-medium text-zinc-800">Price columns</legend>
        <p className="text-xs text-zinc-500">Tick every column that holds a price. For several price columns (Cat A, Cat B or sizes such as 120 × 145) give each its label.</p>
        <ul className="grid gap-1 sm:grid-cols-2">{headers.map((header) => { const chosen = mapping.priceColumns.find((item) => item.column === header);
          return <li key={header} className="flex items-center gap-2 rounded border border-zinc-100 px-2 py-1 text-sm"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" className="accent-emerald-900" checked={Boolean(chosen)} onChange={(event) => togglePrice(header, event.target.checked)} /><span className="truncate" title={header}>{header}</span></label>
            {chosen ? <input aria-label={`Label for ${header}`} placeholder="Label (optional)" value={chosen.label} onChange={(event) => labelPrice(header, event.target.value)} className={`${input} h-8 w-36`} /> : null}</li>; })}</ul></fieldset>
      <details className="text-xs"><summary className="cursor-pointer">Code structure</summary><div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1"><span className="font-medium">Structure</span><select value={mapping.structure} onChange={(event) => set("structure", event.target.value as WizardMapping["structure"])} className={input}><option value="simple">Simple article code</option><option value="article_finish">Article + finish</option></select></label>
        {mapping.structure === "article_finish" ? <><div className="sm:col-span-3">{select("Article code", "articleCode", false)}</div>
          <label className="grid gap-1"><span className="font-medium">Article code length</span><input type="number" min={1} value={mapping.articleLength} onChange={(event) => set("articleLength", Number(event.target.value))} className={input} /></label>
          <label className="grid gap-1"><span className="font-medium">Finish code length</span><input type="number" min={1} value={mapping.finishLength} onChange={(event) => set("finishLength", Number(event.target.value))} className={input} /></label></> : null}</div></details>
      {profileError ? <p className="text-xs text-amber-800">{profileError}</p> : null}
      {preview.length ? <div className="overflow-x-auto"><p className="mb-1 text-xs font-semibold text-zinc-600">What ProjectWorkflow will read</p><table className="w-full text-left text-xs" aria-label="Normalised preview"><thead><tr className="text-zinc-500"><th className="py-1 pr-3">Code</th><th className="pr-3">Dimension</th><th className="pr-3">Tier</th><th>Price</th></tr></thead>
        <tbody>{preview.map((row, index) => <tr key={`${row.code}-${index}`} className="border-t border-zinc-100"><td className="py-1 pr-3 font-mono">{row.code}</td><td className="pr-3">{row.dimension}</td><td className="pr-3">{row.tier}</td><td className="tabular-nums">{row.price}</td></tr>)}</tbody></table></div>
        : mappingReady ? <p className="text-xs text-amber-800">No priced rows were found with these columns. Check the Supplier code and price columns.</p> : null}
      <div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(1)}>Back</button><button type="button" className={primary} disabled={!mappingReady || !preview.length} onClick={() => setStep(3)}>Next: details</button></div>
    </div> : null}

    {step === 3 && mapping ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs sm:col-span-2"><span className="font-medium">Price list name</span><input value={title} onChange={(event) => setTitle(event.target.value)} className={input} /></label>
      <label className="grid gap-1 text-xs"><span className="font-medium">Effective from (optional)</span><input type="date" value={effective} onChange={(event) => setEffective(event.target.value)} className={input} /></label>
      {known && saved ? <><div className="grid gap-1 text-xs"><span className="font-medium">Currency</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{saved.config.currency}</span></div>
        <div className="grid gap-1 text-xs"><span className="font-medium">Price basis</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{saved.config.basis === "net" ? "Net" : "List"}</span></div></>
        : <><label className="grid gap-1 text-xs"><span className="font-medium">Currency</span><select value={mapping.currency} onChange={(event) => set("currency", event.target.value as WizardMapping["currency"])} className={input}>{["AED", "EUR", "USD"].map((code) => <option key={code}>{code}</option>)}</select></label>
          <label className="grid gap-1 text-xs"><span className="font-medium">Price basis</span><select value={mapping.basis} onChange={(event) => set("basis", event.target.value as WizardMapping["basis"])} className={input}><option value="list">List</option><option value="net">Net</option></select></label></>}
      </div><div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(useSaved ? 1 : 2)}>Back</button><button type="button" className={primary} disabled={!title.trim()} onClick={() => setStep(4)}>Next: Families</button></div></div> : null}

    {step === 4 ? <div className="space-y-3">
      {definitions.length ? <label className="grid gap-1 text-xs"><span className="font-medium">Price-list type</span><select value={definitionId} onChange={(event) => { if (event.target.value === "new") { setDefinitionId("new"); setSelected([]); } else chooseDefinition(event.target.value); }} className={input}>
        <option value="">Choose…</option>{definitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="new">New price-list type</option></select></label> : null}
      {definitionId === "new" ? <label className="grid gap-1 text-xs"><span className="font-medium">Name for this type of price list</span><input value={newName} onChange={(event) => setNewName(event.target.value)} className={input} placeholder="Furniture" /></label> : null}
      {definition && definition.familyIds.length ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><span>Previous coverage found: {definition.familyIds.length} {definition.familyIds.length === 1 ? "Family" : "Families"}</span>
        <button type="button" className={button} onClick={() => setSelected(definition.familyIds)}>Use previous Families</button></div> : null}
      <fieldset className="space-y-1"><legend className="text-sm font-medium text-zinc-800">Families covered by this price list</legend>
        <ul className="grid gap-1 sm:grid-cols-2">{families.map((family) => <li key={family.id}><label className="flex items-center gap-2 rounded border border-zinc-100 px-2 py-1 text-sm"><input type="checkbox" className="accent-emerald-900" checked={selected.includes(family.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, family.id] : current.filter((id) => id !== family.id))} />{family.name}</label></li>)}</ul></fieldset>
      <div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(3)}>Back</button><button type="button" className={primary} disabled={!familiesReady} onClick={() => setStep(5)}>Next: review</button></div></div> : null}

    {step === 5 && mapping ? <div className="space-y-3"><dl className="grid gap-3 text-sm sm:grid-cols-2">
      {([["Brand", brandName], ["Price list", title], ["Effective from", effective || "Not set"], ["Currency", known && saved ? saved.config.currency : mapping.currency], ["Price basis", (known && saved ? saved.config.basis : mapping.basis) === "net" ? "Net" : "List"], ["Families", String(selected.length)], ["Rows detected", rows.length.toLocaleString("en-US")]] as const).map(([label, value]) =>
        <div key={label}><dt className="text-xs text-zinc-500">{label}</dt><dd className="font-semibold text-zinc-950">{value}</dd></div>)}</dl>
      <div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => setStep(4)}>Back</button><button type="button" className={primary} disabled={busy || !profile} onClick={() => void startReview()}>{busy ? "Working…" : "Start review"}</button></div></div> : null}

    <p className="text-xs text-zinc-500">Technical import profiles, vocabulary and coverage tools are under <Link href={advancedHref} className="underline">Advanced import settings</Link>.</p>
  </section>;
}
