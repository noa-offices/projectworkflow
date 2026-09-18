"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cropForZoom, existingSourceCropTargets, exportRenderScale, fitWidthZoom, mergeSourceCropTargetIds, nextSourceCropTarget, normalizeSourceCrop, removeSourceCropTargetIds, selectedSourceCropTargets, sourceCropSearchPages, sourceQaTextGeometry, sourceQaTextGeometryMatch, sourceQaTextGeometryViewport, type SourceCropRect, type SourceCropTarget, type SourceQaTextGeometry, uniqueSourceCropTarget, validSourceCrop } from "@/lib/products/source-qa-crop";
import type { SourceQaPage } from "@/lib/products/source-qa";
import type { PDFPageProxy } from "pdfjs-dist";

type Props = { storagePath: string; pageCount: number; initialPage?: number; pages: SourceQaPage[]; initialSearch?: string; targets: SourceCropTarget[]; initialFixedTargetId?: string; existingTargetIds: ReadonlySet<string>; onAssign: (targets: SourceCropTarget[], file: File) => void; onClose: () => void };
const button = "cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 disabled:opacity-60";
const primaryButton = button + " border-emerald-700 bg-emerald-800 text-white hover:bg-emerald-900 hover:border-emerald-800";
const TARGET_KINDS = ["Base / Model", "Category / Matrix", "Modular", "Accessory", "Visual subgroup"] as const;

/** Splits a target's "CODE — Name" label (see rowLabel() in source-qa-crop.ts) back into its two display parts. */
function targetCodeAndName(target: SourceCropTarget) {
  const separator = target.label.indexOf(" — ");
  return separator < 0 ? { code: target.codes[0] ?? "", name: target.label } : { code: target.label.slice(0, separator), name: target.label.slice(separator + 3) };
}

function TargetPickerDrawer({ targets, selectedIds, manualIds, filter, onFilterChange, onToggle, onGroupAction, onClear, onClose }: {
  targets: SourceCropTarget[]; selectedIds: string[]; manualIds: Set<string>; filter: string; onFilterChange: (value: string) => void;
  onToggle: (id: string) => void; onGroupAction: (ids: string[], clear: boolean) => void; onClear: () => void; onClose: () => void;
}) {
  const normalizedFilter = filter.trim().toLowerCase();
  const selectedCount = selectedIds.length;
  return <div className="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-zinc-200 bg-white shadow-xl">
    <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5">
      <div><p className="text-sm font-semibold text-zinc-900">Add more targets</p><p className="mt-0.5 text-[11px] text-zinc-500">{selectedCount} selected</p></div>
      <div className="flex items-center gap-2">{selectedCount ? <button type="button" onClick={onClear} className="text-xs font-semibold text-zinc-600 hover:text-red-700">Clear selection</button> : null}<button type="button" onClick={onClose} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">Done</button></div>
    </div>
    <div className="border-b border-zinc-200 p-3"><input autoFocus placeholder="Search by code or name" value={filter} onChange={(event) => onFilterChange(event.target.value)} className="h-9 w-full rounded-md border border-zinc-300 px-2.5 text-xs outline-none focus:border-emerald-600" /></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{TARGET_KINDS.map((kind) => {
      const group = targets.filter((target) => target.kind === kind && (targetCodeAndName(target).code + " " + targetCodeAndName(target).name).toLowerCase().includes(normalizedFilter));
      if (!group.length) return null;
      const groupSelectedCount = group.filter((target) => selectedIds.includes(target.id)).length;
      return <div key={kind} className="mb-4"><div className="mb-1.5 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{kind}<span className="ml-1.5 font-normal normal-case text-zinc-400">{groupSelectedCount}/{group.length}</span></p><div className="flex gap-2"><button type="button" onClick={() => onGroupAction(group.map((target) => target.id), false)} className="text-[11px] font-semibold text-emerald-800 hover:underline">Select all</button><button type="button" onClick={() => onGroupAction(group.map((target) => target.id), true)} className="text-[11px] font-semibold text-zinc-500 hover:underline">Clear</button></div></div>
        <div className="space-y-1">{group.map((target) => { const selected = selectedIds.includes(target.id); const { code, name } = targetCodeAndName(target); return <label key={target.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition ${selected ? "border-emerald-400 bg-emerald-50" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}>
          <input type="checkbox" checked={selected} onChange={() => onToggle(target.id)} className="shrink-0" />
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${selected ? "bg-emerald-100 text-emerald-900" : "bg-zinc-100 text-zinc-600"}`}>{code || "No code"}</span>
          <span className="truncate text-zinc-800">{name}</span>
          {selected && !manualIds.has(target.id) ? <span className="ml-auto shrink-0 text-[10px] font-medium text-emerald-700">auto</span> : null}
        </label>; })}</div>
      </div>;
    })}{!TARGET_KINDS.some((kind) => targets.some((target) => target.kind === kind && (targetCodeAndName(target).code + " " + targetCodeAndName(target).name).toLowerCase().includes(normalizedFilter))) ? <p className="text-xs text-zinc-500">No targets match &quot;{filter}&quot;.</p> : null}</div>
  </div>;
}

export function SourceQaCropViewer({ storagePath, pageCount, initialPage = 1, pages, initialSearch = "", targets, initialFixedTargetId, existingTargetIds, onAssign, onClose }: Props) {
  const initialFixed = initialFixedTargetId ?? (targets.length === 1 ? targets[0]?.id : undefined); const initialMatches = sourceCropSearchPages(pages, initialSearch); const initialAuto = initialFixed ? targets.find((target) => target.id === initialFixed) : uniqueSourceCropTarget(targets, initialSearch);
  const canvas = useRef<HTMLCanvasElement>(null); const drag = useRef<{ x: number; y: number } | null>(null); const pdfPageRef = useRef<PDFPageProxy | null>(null); const scrollRef = useRef<HTMLDivElement>(null);
  const [guidedTargetId, setGuidedTargetId] = useState(initialFixed ?? null); const [page, setPage] = useState(initialMatches[0] ?? initialPage); const [zoom, setZoom] = useState(1); const [crop, setCrop] = useState<SourceCropRect | null>(null); const [preview, setPreview] = useState<string | null>(null); const [search, setSearch] = useState(initialSearch); const [matches, setMatches] = useState(initialMatches); const [matchIndex, setMatchIndex] = useState(0); const [selectedIds, setSelectedIds] = useState<string[]>(initialAuto ? [initialAuto.id] : []); const [manualIds, setManualIds] = useState<Set<string>>(new Set()); const [targetFilter, setTargetFilter] = useState(""); const [showTargets, setShowTargets] = useState(false); const [pendingAction, setPendingAction] = useState<"close" | "next" | null>(null); const [complete, setComplete] = useState(false); const [message, setMessage] = useState(""); const [highlight, setHighlight] = useState<SourceQaTextGeometry | null>(null); const [pageHeight, setPageHeight] = useState(0); const [pageWidth, setPageWidth] = useState(0);
  const fixedTarget = guidedTargetId ? targets.find((target) => target.id === guidedTargetId) ?? null : null;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { let cancelled = false; void (async () => { try { const { data, error } = await createClient().storage.from("product-source-files").download(storagePath); if (error || !data) throw error ?? new Error("Source PDF could not be reloaded."); const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString(); const pdf = await pdfjs.getDocument({ data: await data.arrayBuffer() }).promise; const current = await pdf.getPage(page); const viewport = current.getViewport({ scale: zoom }); const element = canvas.current; const context = element?.getContext("2d"); if (!element || !context || cancelled) return; element.width = viewport.width; element.height = viewport.height; await current.render({ canvas: element, canvasContext: context, viewport }).promise; const content = await current.getTextContent(); if (!cancelled) { pdfPageRef.current = current; setPageHeight(current.view[3] - current.view[1]); setPageWidth(current.view[2] - current.view[0]); const items = content.items.flatMap((item) => "str" in item ? [{ str: item.str, transform: Array.from(item.transform), width: item.width, height: item.height }] : []); setHighlight(sourceQaTextGeometryMatch(sourceQaTextGeometry(items), search)); } } catch (error) { if (!cancelled) { setHighlight(null); setMessage(error instanceof Error ? error.message : "PDF page could not be rendered."); } } })(); return () => { cancelled = true; pdfPageRef.current = null; }; }, [page, search, storagePath, zoom]);
  const resetForTarget = (target: SourceCropTarget) => { const code = target.codes[0] ?? ""; const found = sourceCropSearchPages(pages, code); if (preview) URL.revokeObjectURL(preview); setCrop(null); setPreview(null); setSearch(code); setMatches(found); setMatchIndex(0); if (found.length) setPage(found[0]); return { code, found: found.length > 0 }; };
  const navigate = (next: number) => { setCrop(null); setPreview(null); setPage(next); };
  const searchPages = () => { const found = sourceCropSearchPages(pages, search); setMatches(found); setMatchIndex(0); if (!fixedTarget) { const auto = uniqueSourceCropTarget(targets, search); setSelectedIds((current) => [...new Set([...current.filter((id) => manualIds.has(id)), ...(auto ? [auto.id] : [])])]); } if (!found.length) { setMessage("No matches found."); return; } setMessage(found.length + " matches"); navigate(found[0]); };
  const point = (event: React.PointerEvent<HTMLDivElement>) => { const box = canvas.current!.getBoundingClientRect(); return { x: (event.clientX - box.left) / zoom, y: (event.clientY - box.top) / zoom }; };
  /** Exports the crop from a fresh higher-resolution render of the current page when available (sharper output than the low-res preview canvas), falling back to the on-screen canvas otherwise. Crop coordinates are recorded at zoom=1 and rescaled per-target via the shared cropForZoom() helper, so this never changes crop-to-target semantics. */
  const makeFile = (done: (file: File) => void) => {
    if (!validSourceCrop(crop)) return;
    const pageProxy = pdfPageRef.current;
    if (!pageProxy) {
      if (!canvas.current) return;
      const rect = cropForZoom(crop!, zoom);
      const output = document.createElement("canvas"); output.width = rect.width; output.height = rect.height;
      output.getContext("2d")?.drawImage(canvas.current, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      output.toBlob((blob) => { if (blob) done(new File([blob], "source-p" + page + ".webp", { type: "image/webp" })); }, "image/webp", .9);
      return;
    }
    void (async () => {
      const exportScale = exportRenderScale(zoom);
      const viewport = pageProxy.getViewport({ scale: exportScale });
      const highRes = document.createElement("canvas"); highRes.width = viewport.width; highRes.height = viewport.height;
      const context = highRes.getContext("2d");
      if (!context) return;
      await pageProxy.render({ canvas: highRes, canvasContext: context, viewport }).promise;
      const rect = cropForZoom(crop!, exportScale);
      const output = document.createElement("canvas"); output.width = rect.width; output.height = rect.height;
      output.getContext("2d")?.drawImage(highRes, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      output.toBlob((blob) => { if (blob) done(new File([blob], "source-p" + page + ".webp", { type: "image/webp" })); }, "image/webp", .9);
    })();
  };
  const selectedTargets = useMemo(() => selectedSourceCropTargets(targets, selectedIds), [selectedIds, targets]); const existingTargets = useMemo(() => existingSourceCropTargets(targets, selectedIds, existingTargetIds), [existingTargetIds, selectedIds, targets]); const displayCrop = crop ? cropForZoom(crop, zoom) : null; const displayHighlight = useMemo(() => highlight && pageHeight ? sourceQaTextGeometryViewport(highlight, pageHeight, zoom) : null, [highlight, pageHeight, zoom]);
  const extraSelectedCount = selectedTargets.length - (fixedTarget && selectedIds.includes(fixedTarget.id) ? 1 : 0);
  useEffect(() => { const host = canvas.current?.parentElement; if (!host) return; const overlay = document.createElement("div"); overlay.setAttribute("data-source-qa-highlight", "true"); overlay.style.cssText = "position:absolute;pointer-events:none;border:2px solid #0284c7;background:rgb(14 165 233 / .2);border-radius:3px;z-index:2;"; if (displayHighlight) { overlay.style.left = Math.max(0, displayHighlight.x - 3) + "px"; overlay.style.top = Math.max(0, displayHighlight.y - 3) + "px"; overlay.style.width = displayHighlight.width + 6 + "px"; overlay.style.height = displayHighlight.height + 6 + "px"; host.appendChild(overlay); const scroll = host.parentElement; if (scroll) scroll.scrollTo({ left: Math.max(0, displayHighlight.x - scroll.clientWidth / 2), top: Math.max(0, displayHighlight.y - scroll.clientHeight / 2), behavior: "smooth" }); } return () => overlay.remove(); }, [displayHighlight]);
  const toggleTarget = (id: string) => { setManualIds((current) => new Set([...current, id])); setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); };
  const groupAction = (ids: string[], clear: boolean) => { setSelectedIds((current) => clear ? removeSourceCropTargetIds(current, ids) : mergeSourceCropTargetIds(current, ids)); setManualIds((current) => { const next = new Set(current); ids.forEach((id) => clear ? next.delete(id) : next.add(id)); return next; }); };
  const clearSelection = () => { const keep = fixedTarget ? [fixedTarget.id] : []; setSelectedIds(keep); setManualIds(new Set()); };
  const assign = (mode: "replace" | "skip", action: "close" | "next") => { const currentTarget = fixedTarget; makeFile((file) => { const assigned = mode === "skip" ? selectedTargets.filter((target) => !existingTargetIds.has(target.id)) : selectedTargets; if (!assigned.length) { setMessage("No new targets selected."); setPendingAction(null); return; } onAssign(assigned, file); if (action === "close") { onClose(); return; } const next = currentTarget ? nextSourceCropTarget(targets, currentTarget.id, existingTargetIds, selectedIds) : null; if (!next) { setComplete(true); setMessage("All eligible images completed."); setPendingAction(null); return; } setGuidedTargetId(next.id); setSelectedIds([next.id]); setManualIds(new Set()); setShowTargets(false); setPendingAction(null); setComplete(false); const searchResult = resetForTarget(next); setMessage(searchResult.found ? "Image added to " + (currentTarget?.codes[0] ?? currentTarget?.label) + ". Next: " + (next.codes[0] ?? next.label) : "No source match found for " + (searchResult.code || next.label)); }); };
  const requestAssign = (action: "close" | "next") => existingTargets.length ? setPendingAction(action) : assign("replace", action);
  const fitWidth = () => setZoom(fitWidthZoom(scrollRef.current?.clientWidth ?? 0, pageWidth));

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 p-2 sm:p-4">
    <div className="flex h-[96vh] w-[97vw] max-w-[1600px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Source PDF image crop">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3"><b className="text-sm">Source PDF - Image Crop</b><button type="button" className={button} onClick={onClose}>Close</button></div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2">
        <input placeholder="Search code" value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-emerald-600" />
        <button type="button" className={button} onClick={searchPages}>Search</button>
        <button type="button" className={button} disabled={matchIndex <= 0} onClick={() => { const index = matchIndex - 1; setMatchIndex(index); navigate(matches[index]); }}>Previous match</button>
        <button type="button" className={button} disabled={matchIndex >= matches.length - 1} onClick={() => { const index = matchIndex + 1; setMatchIndex(index); navigate(matches[index]); }}>Next match</button>
        <span className="mx-1 h-5 w-px bg-zinc-200" />
        <button type="button" className={button} disabled={page <= 1} onClick={() => navigate(page - 1)}>Previous</button>
        <span className="text-xs text-zinc-600">Page {page} of {pageCount}</span>
        <button type="button" className={button} disabled={page >= pageCount} onClick={() => navigate(page + 1)}>Next</button>
        <span className="mx-1 h-5 w-px bg-zinc-200" />
        <button type="button" className={button} onClick={() => setZoom(Math.max(.5, zoom - .25))}>Zoom -</button>
        <span className="w-10 text-center text-xs text-zinc-600">{Math.round(zoom * 100)}%</span>
        <button type="button" className={button} onClick={() => setZoom(Math.min(4, zoom + .25))}>Zoom +</button>
        <button type="button" className={button} onClick={fitWidth}>Fit width</button>
        <button type="button" className={button} disabled={!crop} onClick={() => { setCrop(null); setPreview(null); }}>Clear crop</button>
      </div>
      {message ? <p className="shrink-0 px-4 pt-2 text-xs text-zinc-600">{message}</p> : null}

      <div className="relative flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-zinc-100 p-4">
          <div className="relative inline-block bg-white shadow" onPointerDown={(event) => { drag.current = point(event); setCrop({ ...drag.current, width: 0, height: 0 }); }} onPointerMove={(event) => { if (drag.current) { const value = point(event); setCrop(normalizeSourceCrop({ ...drag.current, width: value.x - drag.current.x, height: value.y - drag.current.y })); } }} onPointerUp={() => { drag.current = null; }}>
            <canvas ref={canvas} />
            {displayCrop ? <div className="pointer-events-none absolute border-2 border-sky-500" style={{ left: displayCrop.x, top: displayCrop.y, width: displayCrop.width, height: displayCrop.height }} /> : null}
          </div>
        </div>
        {showTargets ? <TargetPickerDrawer targets={targets} selectedIds={selectedIds} manualIds={manualIds} filter={targetFilter} onFilterChange={setTargetFilter} onToggle={toggleTarget} onGroupAction={groupAction} onClear={clearSelection} onClose={() => setShowTargets(false)} /> : null}
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={button} disabled={!validSourceCrop(crop)} onClick={() => makeFile((file) => { if (preview) URL.revokeObjectURL(preview); setPreview(URL.createObjectURL(file)); })}>Preview crop</button>
          {preview ? <img src={preview} alt="Crop preview" className="h-16 w-auto rounded border border-zinc-200" /> : null}
          <div className="min-w-0 flex-1 text-xs">
            {fixedTarget ? <p className="truncate"><span className="text-zinc-500">Primary target:</span> <b>{fixedTarget.label}</b></p> : <p className="text-zinc-500">No primary target selected.</p>}
            <p className="mt-0.5 text-zinc-500">{selectedTargets.length} target{selectedTargets.length === 1 ? "" : "s"} selected{extraSelectedCount > 0 ? ` (+${extraSelectedCount} extra)` : ""}</p>
          </div>
          <button type="button" className={button} onClick={() => setShowTargets((current) => !current)}>{showTargets ? "Hide targets" : extraSelectedCount > 0 ? "Review targets" : "+ Add more targets"}</button>
        </div>
        {complete && !preview ? <div className="mt-3"><button type="button" className={button} onClick={onClose}>Close</button></div>
          : pendingAction ? <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs"><b>Existing images found on:</b> {existingTargets.map((target) => target.label.split(" — ")[0]).join(", ")}<div className="mt-2 flex gap-2"><button type="button" className={button} onClick={() => assign("replace", pendingAction)}>Replace on all selected</button><button type="button" className={button} onClick={() => assign("skip", pendingAction)}>Skip existing</button><button type="button" className={button} onClick={() => setPendingAction(null)}>Cancel</button></div></div>
            : <div className="mt-3 flex gap-2"><button type="button" className={primaryButton} disabled={!preview || !selectedTargets.length} onClick={() => requestAssign("close")}>{fixedTarget ? "Use Crop" : "Assign Image"}</button>{fixedTarget ? <button type="button" className={primaryButton} disabled={!preview || !selectedTargets.length} onClick={() => requestAssign("next")}>Use Crop &amp; Next</button> : null}</div>}
      </div>
    </div>
  </div>;
}
