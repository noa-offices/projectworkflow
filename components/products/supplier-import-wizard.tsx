"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseSupplierFile } from "@/lib/products/supplier-price-file";
import { supplierImportChunks } from "@/lib/products/supplier-price-import";
import { assertSupplierProfile, type RawSupplierRow, type SupplierProfile } from "@/lib/products/supplier-price-contracts";
import {
  compatibleProfile, initialPriceSelection, mappingFromProfile, previewImport, profileFromMapping, profileRequiredColumns, suggestDefinition, suggestMapping,
  type WizardDefinition, type WizardMapping, type WizardPriceMode, type WizardProfileOption,
} from "@/lib/products/supplier-import-wizard";
import {
  attachSupplierWorkingFile, cancelSupplierImport, compactSupplierSourceChunks, confirmSupplierCoverage, continueSupplierImportCleanup, createSupplierReviewBatch, createSupplierSource, createSupplierSourceDefinition,
  archiveBlockingSupplierSource, finalizeSupplierSource, linkSupplierSourceDefinition, listIncompleteSupplierImports, saveSupplierProfile, supplierProfileForImport, supplierSourceUploadStatus, uploadSupplierChunk, validateSupplierReplacement, verifySupplierReplacement,
} from "@/app/products/price-updates/supplier-sources/actions";
import { blockingSourceFromError, previewReplacement, replacementMismatchWarning, type ReplaceContext, type ReplacementVerdict } from "@/lib/products/supplier-replacement";
import { finalizeSupplierImport, resolveImportDefinition, runSupplierImportUpload, type SupplierUploadDeps } from "@/lib/products/supplier-import-resume";
import type { IncompleteSupplierImport } from "@/lib/products/supplier-import-cancel";

// Normal import flow: Upload → Match columns → Details → Families → Review. Technical setup stays under Advanced import settings.
const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const input = "h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const button = "inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-50";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50";
export const wizardSteps = ["Upload", "Match columns", "Details", "Families", "Review"] as const;
type Step = 1 | 2 | 3 | 4 | 5;
type Preview = ReturnType<typeof previewImport>;

export function SupplierImportWizard({ brandId, brandName, profiles, definitions, families, suggestedTitle, advancedHref, approver, replace = null }: {
  /** "Replace Price List": the supplier price list being replaced. Same importer; Families are not asked again. */ replace?: ReplaceContext | null;
  brandId: string; brandName: string; profiles: WizardProfileOption[]; definitions: WizardDefinition[]; families: Array<{ id: string; name: string }>;
  suggestedTitle: string; advancedHref: string; approver: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null), [rows, setRows] = useState<RawSupplierRow[]>([]);
  const [saved, setSaved] = useState<WizardProfileOption | null>(null), [useSaved, setUseSaved] = useState(false);
  const [mapping, setMapping] = useState<WizardMapping | null>(null);
  const [priceMode, setPriceMode] = useState<WizardPriceMode>("single"), [multiplePriceColumnsDetected, setMultiplePriceColumnsDetected] = useState(false);
  const [title, setTitle] = useState(suggestedTitle), [effective, setEffective] = useState("");
  const [unfinished, setUnfinished] = useState<string | null>(null), [phase, setPhase] = useState<"" | "Uploading" | "Processing" | "Finalizing" | "Complete">(""), [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [conflict, setConflict] = useState<{ sourceId: string; hash: string } | null>(null), [replaced, setReplaced] = useState<(ReplacementVerdict & { existing: boolean }) | null>(null);
  const [confirmedFor, setConfirmedFor] = useState("");
  const [definitionId, setDefinitionId] = useState(replace?.definitionId ?? ""), [newName, setNewName] = useState(`${brandName} price list`), [selected, setSelected] = useState<string[]>([]);
  const headers = rows.length ? Object.keys(rows[0].values) : [];
  const fileKey = file ? `${file.name}:${file.size}` : "";
  const destinationConfirmed = Boolean(fileKey) && confirmedFor === fileKey;
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(""); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong."); } finally { setBusy(false); void refreshIncomplete(); } }
  const [incomplete, setIncomplete] = useState<IncompleteSupplierImport[]>([]);
  const createdDefinition = useRef<{ name: string; id: string } | null>(null);
  const refreshIncomplete = useCallback(() => listIncompleteSupplierImports(brandId).then(setIncomplete).catch(() => setIncomplete([])), [brandId]);
  useEffect(() => { if (approver) void refreshIncomplete(); }, [approver, refreshIncomplete]);
  const sha256 = async (chosen: File) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await chosen.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const uploadDeps = (chosen: File | null): SupplierUploadDeps => ({
    storeFile: async (path) => { if (!chosen) throw Error("Select the original file to upload it again."); const { error } = await createClient().storage.from("supplier-price-sources").upload(path, chosen, { upsert: false }); if (error && !("statusCode" in error && ["409", "400"].includes(String(error.statusCode)))) throw Error(error.message); },
    attachFile: attachSupplierWorkingFile, status: supplierSourceUploadStatus, uploadChunk: uploadSupplierChunk, finalize: finalizeSupplierSource, compact: compactSupplierSourceChunks,
    onPhase: (next, nextProgress) => { setPhase(next); if (nextProgress) setProgress(nextProgress); }, onMessage: setMessage,
  });
  /** Persisted recovery: the same upload path as a new import, after the user selects the original file again. */
  async function resumeIncomplete(item: IncompleteSupplierImport, chosen: File) {
    await run(async () => {
      setMessage("Checking the file against the unfinished import.");
      if ((await sha256(chosen)) !== item.fileHash) throw Error("This is not the original file of the unfinished import. Choose the same file again.");
      assertSupplierProfile(item.profile); const stored = item.profile;
      const importRows = await parseSupplierFile(chosen, stored.sheet_names);
      if (!importRows.length) throw Error("The price list has no data rows.");
      const present = Object.keys(importRows[0].values);
      if (profileRequiredColumns(stored).some((column) => !present.includes(column))) throw Error("This file does not match the unfinished import's columns.");
      setUnfinished(item.id);
      await runSupplierImportUpload(uploadDeps(chosen), { sourceId: item.id, brandId, hash: item.fileHash, sourceType: chosen.name.split(".").pop()!.toLowerCase(), rowCount: importRows.length, chunks: supplierImportChunks(importRows, 500, 600_000, stored) });
      setUnfinished(null); await refreshIncomplete();
      router.push(`/products/price-updates/supplier-sources?brand=${brandId}&source=${item.id}&view=summary`); router.refresh();
    });
  }
  /** All parts are stored; only finalization is left. No file is needed. The import is reported complete only when the database says imported. */
  async function resumeFinalization(item: IncompleteSupplierImport) {
    await run(async () => {
      setUnfinished(item.id); setProgress({ done: item.expectedChunks, total: item.expectedChunks });
      await finalizeSupplierImport(uploadDeps(null), item.id);
      if ((await supplierSourceUploadStatus(item.id)).status !== "imported") throw Error("The database does not show this import as finished yet. Resume Finalization again.");
      setUnfinished(null); await refreshIncomplete();
      router.push(`/products/price-updates/supplier-sources?brand=${brandId}&source=${item.id}&view=summary`); router.refresh();
    });
  }
  async function cancelIncomplete(item: IncompleteSupplierImport) {
    if (!window.confirm(`Cancel the unfinished import "${item.title}" and remove its partial data? A completed import is never removed.`)) return;
    await run(async () => { const result = await finishCancel(await cancelSupplierImport(item.id), item.id); setMessage(result.message); if (unfinished === item.id) { setUnfinished(null); setPhase(""); setProgress(null); } await refreshIncomplete(); });
  }
  /** Cleanup of a large cancelled import runs in bounded steps; keep going until the server reports it is finished. */
  async function finishCancel(first: Awaited<ReturnType<typeof cancelSupplierImport>>, sourceId: string) {
    let result = first;
    while (result.more) { setMessage(result.message); result = await continueSupplierImportCleanup(sourceId); }
    return result;
  }
  async function importWithNewSettings() {
    if (!conflict || !window.confirm("Archive the earlier import of this file and import it again with the new settings?\nThe earlier import stays in history and its reviews are kept. If it is the current price list, it may stop being current until the new import finishes.")) return;
    let archived = false;
    await run(async () => { const result = await archiveBlockingSupplierSource(brandId, conflict.sourceId, conflict.hash); archived = true; setConflict(null); setMessage(result.wasCurrent ? `${result.title} was archived; it was the current price list until now.` : `${result.title} was archived.`); });
    if (archived) void startReview();
  }
  async function cancelImport() {
    if (!unfinished || !window.confirm("Cancel this unfinished import and remove its partial data? A completed import is never removed.")) return;
    await run(async () => { const result = await finishCancel(await cancelSupplierImport(unfinished), unfinished); setUnfinished(null); setPhase(""); setProgress(null); setMessage(result.message); });
  }
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
      const initial = initialPriceSelection(names, match ? mappingFromProfile(match.config) : suggestMapping(names), Boolean(match));
      setFile(chosen); setRows(parsed); setSaved(match); setUseSaved(false); setMapping(initial.mapping); setPriceMode(initial.mode); setMultiplePriceColumnsDetected(initial.multipleDetected);
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
      // A retry reuses the definition made for the same unfinished file (or earlier in this session) instead of creating another.
      if (replace) await validateSupplierReplacement(brandId, replace.definitionId, effective, hash);
      const resolved = replace ? { id: replace.definitionId, created: createdDefinition.current } : await resolveImportDefinition({ definitionId, newName: newName.trim(), fileHash: hash, incomplete: await listIncompleteSupplierImports(brandId), created: createdDefinition.current, create: async () => (await createSupplierSourceDefinition(brandId, newName.trim(), profileId)).id });
      createdDefinition.current = resolved.created; const coverageId = resolved.id;
      const created = await createSupplierSource({ profile_id: profileId, expected_profile: stored, title: title.trim(), filename: file.name, file_hash: hash, source_type: sourceType, expected_rows: importRows.length, expected_cells: importRows.length * stored.price_columns.length, expected_chunks: chunks.length, original_reference: "", effective_from: effective, received_at: "" }).catch((error: unknown) => { const blocking = blockingSourceFromError(error instanceof Error ? error.message : ""); if (!blocking) throw error; setConflict({ sourceId: blocking, hash }); return null; });
      if (!created) return;
      const result = created;
      if (result.status !== "imported") {
        setUnfinished(result.id);
        if (coverageId) await linkSupplierSourceDefinition(result.id, coverageId);
        await runSupplierImportUpload(uploadDeps(file), { sourceId: result.id, brandId, hash, sourceType, rowCount: importRows.length, chunks });
        setUnfinished(null); setPhase("Complete");
      }
      if (replace) {
        // Success is reported only after the new source is fully imported, and says honestly whether it is current.
        const verdict = await verifySupplierReplacement(brandId, replace.definitionId, result.id);
        setReplaced({ ...verdict, existing: result.existing }); setFile(null); setRows([]); setStep(1); router.refresh(); return;
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
  const selectSinglePrice = (column: string) => setMapping((current) => current ? { ...current, priceColumns: column ? [{ column, label: "" }] : [] } : current);
  const changePriceMode = (mode: WizardPriceMode) => {
    setPriceMode(mode);
    setMapping((current) => {
      if (!current || mode === "multiple" || current.priceColumns.length <= 1) return current;
      return { ...current, priceColumns: current.priceColumns.slice(0, 1).map((item) => ({ ...item, label: "" })) };
    });
  };
  const mappingReady = Boolean(mapping?.fullCode && mapping.priceColumns.length && !profileError);
  const familiesReady = selected.length > 0 && (definitionId !== "new" || newName.trim() !== "") && definitionId !== "";

  return <section className={`${card} space-y-4 p-4`} aria-label="Import new price list">
    {replaced ? <div role="status" className={`space-y-2 rounded-md border p-3 text-sm ${replaced.status === "current" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}><p className="font-semibold">{replaced.existing ? "No new version was created: this file was already imported with the same settings." : replaced.status === "current" ? "Price list replaced." : "Price list imported."}</p><p>{replaced.message}</p>
      <p className="flex flex-wrap gap-3 text-xs"><Link className="font-semibold underline" href={`/products/price-updates/supplier-sources?brand=${brandId}&tab=current`}>Return to Current Price List</Link><Link className="font-semibold underline" href={`/products/price-updates/supplier-sources?brand=${brandId}&tab=history`}>Manage Previous Versions</Link></p></div> : null}
    {incomplete.length ? <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" aria-label="Incomplete import">{incomplete.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><div><p className="font-semibold text-amber-950">Incomplete import</p><p className="text-xs text-amber-900">{item.title} · {item.filename}{item.definitionName ? ` · ${item.definitionName}` : ""} · {item.storedChunks} / {item.expectedChunks} parts</p></div><div className="flex gap-2">{item.status === "importing" && item.expectedChunks > 0 && item.storedChunks === item.expectedChunks ? <button type="button" className={button} disabled={busy} onClick={() => void resumeFinalization(item)}>Resume Finalization</button> : item.status !== "failed" ? <label className={`${button} cursor-pointer`}>Resume Import<input type="file" accept=".xlsx,.csv,.json" className="sr-only" disabled={busy} onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ""; if (chosen) void resumeIncomplete(item, chosen); }} /></label> : null}<button type="button" className={button} disabled={busy} onClick={() => void cancelIncomplete(item)}>Cancel Import</button></div></div>)}{progress && busy ? <p role="status" className="text-xs text-amber-900">{phase}: {progress.done} / {progress.total} parts</p> : null}<p className="text-xs text-amber-900">To resume, choose the original file again. Its contents are checked against the unfinished import.</p></div> : null}
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
      <fieldset className="space-y-2"><legend className="text-sm font-medium text-zinc-800">Price column{priceMode === "multiple" ? "s" : ""}</legend>
        {priceMode === "single" ? <><label className="grid max-w-md gap-1 text-xs"><span className="sr-only">Price column</span><select aria-label="Price column" value={mapping.priceColumns[0]?.column ?? ""} onChange={(event) => selectSinglePrice(event.target.value)} className={input}><option value="">Choose heading</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>
          {multiplePriceColumnsDetected ? <p className="text-xs text-amber-800">Multiple price columns detected. Choose one, or select the option below.</p> : null}
          <button type="button" className="text-xs text-zinc-500 underline underline-offset-2" onClick={() => changePriceMode("multiple")}>This file has multiple price columns</button></>
          : <>{multiplePriceColumnsDetected ? <p className="text-xs text-amber-800">Multiple price columns detected. Select the columns that apply.</p> : null}<button type="button" className="text-xs text-zinc-500 underline underline-offset-2" onClick={() => changePriceMode("single")}>Use one price column</button>
        <p className="text-xs text-zinc-500">Tick every column that holds a price. For several price columns (Cat A, Cat B or sizes such as 120 × 145) give each its label.</p>
        <ul className="grid gap-1 sm:grid-cols-2">{headers.map((header) => { const chosen = mapping.priceColumns.find((item) => item.column === header);
          return <li key={header} className="flex items-center gap-2 rounded border border-zinc-100 px-2 py-1 text-sm"><label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" className="accent-emerald-900" checked={Boolean(chosen)} onChange={(event) => togglePrice(header, event.target.checked)} /><span className="truncate" title={header}>{header}</span></label>
            {chosen ? <input aria-label={`Label for ${header}`} placeholder="Label (optional)" value={chosen.label} onChange={(event) => labelPrice(header, event.target.value)} className={`${input} h-8 w-36`} /> : null}</li>; })}</ul></>}</fieldset>
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
      <label className="grid gap-1 text-xs"><span className="font-medium">{replace ? "Effective from (required)" : "Effective from (optional)"}</span><input type="date" value={effective} onChange={(event) => setEffective(event.target.value)} className={input} /></label>
      {known && saved ? <><div className="grid gap-1 text-xs"><span className="font-medium">Currency</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{saved.config.currency}</span></div>
        <div className="grid gap-1 text-xs"><span className="font-medium">Price basis</span><span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm">{saved.config.basis === "net" ? "Net" : "List"}</span></div></>
        : <><label className="grid gap-1 text-xs"><span className="font-medium">Currency</span><select value={mapping.currency} onChange={(event) => set("currency", event.target.value as WizardMapping["currency"])} className={input}>{["AED", "EUR", "USD"].map((code) => <option key={code}>{code}</option>)}</select></label>
          <label className="grid gap-1 text-xs"><span className="font-medium">Price basis</span><select value={mapping.basis} onChange={(event) => set("basis", event.target.value as WizardMapping["basis"])} className={input}><option value="list">List</option><option value="net">Net</option></select></label></>}
      </div><div className="flex gap-2"><button type="button" className={button} onClick={() => setStep(useSaved ? 1 : 2)}>Back</button><button type="button" className={primary} disabled={!title.trim() || (Boolean(replace) && !effective)} onClick={() => setStep(replace ? 5 : 4)}>{replace ? "Next: review" : "Next: Families"}</button></div></div> : null}

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
      {replace && file ? (() => { const proposedCurrency = known && saved ? saved.config.currency : mapping.currency, proposedBasis = known && saved ? saved.config.basis : mapping.basis; const preview = previewReplacement({ versions: replace.versions, current: replace.current, proposed: { effectiveFrom: effective, currency: proposedCurrency, basis: proposedBasis } });
        const profileColumns = (() => { const profileId = definitions.find((item) => item.id === replace.definitionId)?.profileId; const config = profiles.find((item) => item.id === profileId)?.config; return config ? profileRequiredColumns(config) : null; })();
        const mismatch = replacementMismatchWarning({ definitionName: replace.definitionName, requiredColumns: profileColumns, fileHeaders: headers });
        return <div className="space-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm" aria-label="Replacement preview"><p className="font-semibold">Replacing: {replace.definitionName}</p><p>Selected file: {file.name}</p>
          {mismatch ? <p role="alert" className="font-semibold text-amber-900">{mismatch}</p> : null}
          <label className="flex items-start gap-2 text-xs font-medium"><input type="checkbox" checked={destinationConfirmed} onChange={(event) => setConfirmedFor(event.target.checked ? fileKey : "")} className="mt-0.5" />I confirm this file is the new version of {replace.definitionName}.</label><p><span className="text-xs text-zinc-500">Current: </span>{replace.current ? `${replace.current.title} · ${replace.current.filename} · effective ${replace.current.effectiveFrom ?? "immediately"} · ${replace.current.currency} · ${replace.current.basis} price` : "none"}</p>
          <p><span className="text-xs text-zinc-500">Replacement: </span>{title} · {file.name} · effective {effective || "—"} · {proposedCurrency} · {proposedBasis} price</p>
          <p className={preview.becomesCurrent ? "font-semibold text-emerald-900" : "font-semibold text-amber-900"}>{preview.headline}</p>{preview.warnings.map((warning) => <p key={warning} className="text-amber-900">{warning}</p>)}
          <p className="text-xs text-zinc-500">The earlier price list stays in History. This replacement changes no prices.</p></div>; })() : null}
      {conflict ? <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><p className="font-semibold text-amber-950">This exact file was already imported with different settings.</p><p className="text-xs text-amber-900">You can import it again with the settings you chose. The earlier import is archived, not deleted.</p><button type="button" className={button} disabled={busy} onClick={() => void importWithNewSettings()}>Import with New Settings</button></div> : null}
      <div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => setStep(replace ? 3 : 4)}>Back</button><button type="button" className={primary} disabled={busy || !profile || (Boolean(replace) && !destinationConfirmed)} onClick={() => void startReview()}>{busy ? "Working…" : unfinished ? (phase === "Finalizing" ? "Resume Finalization" : "Resume Import") : replace ? "Confirm Replacement" : "Start review"}</button>{unfinished && !busy ? <button type="button" className={button} onClick={() => void cancelImport()}>Cancel Import</button> : null}</div>{progress && (busy || unfinished) ? <p role="status" className="text-xs text-zinc-700">{phase}: {progress.done} / {progress.total} parts{unfinished && !busy ? " — the import is not finished. Resume it or cancel it." : ""}</p> : null}</div> : null}

    <p className="text-xs text-zinc-500">Technical import profiles, vocabulary and coverage tools are under <Link href={advancedHref} className="underline">Advanced import settings</Link>.</p>
  </section>;
}
