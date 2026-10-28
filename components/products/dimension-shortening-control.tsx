"use client";

import { useMemo, useState } from "react";
import { runDimensionShortening } from "@/app/products/templates/dimension-shortening-actions";
import { acceptableDimensionPatches, applyDimensionPatches, buildDimensionTargets, chunkDimensionTargets, dimensionFingerprint, undoDimensionPatches, type DimensionReviewEntry, type DimensionUndoEntry } from "@/lib/products/dimension-shortening";
import { isValidShortDimension } from "@/lib/products/ai-clean-text-checks";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";

type Review = { fingerprint: string; entries: DimensionReviewEntry[]; message: string };

export function DimensionShorteningControl({ draft, onApply }: { draft: ProductTemplateDraft; onApply: (draft: ProductTemplateDraft) => void }) {
  const [pending, setPending] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [undo, setUndo] = useState<DimensionUndoEntry[]>([]);
  const [undoMessage, setUndoMessage] = useState("");
  const targets = useMemo(() => buildDimensionTargets(draft), [draft]);
  const fingerprint = useMemo(() => dimensionFingerprint(draft), [draft]);
  const labels = useMemo(() => new Map(targets.map((target) => [target.targetId, target.label])), [targets]);
  const stale = Boolean(review && review.fingerprint !== fingerprint);

  const generate = async () => {
    setPending(true); setReview(null); setUndoMessage("");
    const requestFingerprint = fingerprint, texts = new Map(targets.map((target) => [target.targetId, target.text])), entries: DimensionReviewEntry[] = [];
    let message = "";
    try {
      for (const chunk of chunkDimensionTargets(targets)) {
        const response = await runDimensionShortening({ items: chunk.map((target) => ({ targetId: target.targetId, text: target.text })) });
        if (!response.ok) { message = response.message; break; }
        entries.push(...response.suggestions.map((item) => ({ targetId: item.targetId, original: texts.get(item.targetId) ?? "", value: item.dimension, selected: true })));
      }
    } catch { message = "The request to the server failed. Try again."; }
    if (!message && !entries.length) message = "No dimension could be shortened safely.";
    setReview({ fingerprint: requestFingerprint, entries, message });
    setPending(false);
  };
  const edit = (targetId: string, patch: Partial<DimensionReviewEntry>) => setReview((current) => current && { ...current, entries: current.entries.map((entry) => entry.targetId === targetId ? { ...entry, ...patch } : entry) });
  const accept = (all: boolean) => {
    if (!review || stale) return;
    const entries = all ? review.entries.map((entry) => ({ ...entry, selected: true })) : review.entries;
    const patches = acceptableDimensionPatches(entries);
    if (!patches.length) return;
    const result = applyDimensionPatches(draft, patches);
    onApply(result.draft); setUndo((current) => [...current, ...result.undo]); setUndoMessage(""); setReview(null);
  };
  const undoAll = () => {
    const result = undoDimensionPatches(draft, undo);
    onApply(result.draft); setUndo([]);
    setUndoMessage(`Restored ${result.restored} dimension${result.restored === 1 ? "" : "s"}${result.kept ? `; ${result.kept} changed since and were left as they are` : ""}.`);
  };

  const undoControls = <>
    {undo.length ? <button type="button" onClick={undoAll} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700">Undo shortening ({undo.length})</button> : null}
    {undoMessage ? <p className="text-xs text-zinc-600">{undoMessage}</p> : null}
  </>;
  if (!review) return <div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={pending || !targets.length} onClick={() => void generate()} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">{pending ? "Shortening dimensions..." : "Shorten dimensions with AI"}</button>
    {!targets.length && !pending ? <span className="text-xs text-zinc-500">No long dimensions to shorten.</span> : null}
    {undoControls}
  </div>;
  const selected = acceptableDimensionPatches(review.entries).length;
  return <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
    <h3 className="font-semibold text-emerald-950">AI Dimension Review</h3>
    <p className="mt-1 text-xs text-emerald-900">Suggestions: {review.entries.length}. Nothing changes until you accept.</p>
    {review.message ? <p className="mt-2 text-xs text-amber-800">{review.message}</p> : null}
    {stale ? <p className="mt-2 text-xs font-semibold text-red-700">The dimensions changed after this run. Regenerate before accepting.</p> : null}
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
      {review.entries.map((entry) => <article key={entry.targetId} className="rounded bg-white p-3 text-xs">
        <label className="flex items-center gap-2 font-semibold text-zinc-900"><input type="checkbox" checked={entry.selected} onChange={(event) => edit(entry.targetId, { selected: event.target.checked })} />{labels.get(entry.targetId) ?? entry.targetId}</label>
        <p className="mt-1 text-zinc-600">Before: {entry.original}</p>
        <label className="mt-1 block font-medium text-zinc-600">After
          <input value={entry.value} onChange={(event) => edit(entry.targetId, { value: event.target.value })} className="mt-1 w-full rounded border border-zinc-300 p-1 font-normal text-zinc-900" />
        </label>
        {!isValidShortDimension(entry.original, entry.value) ? <p className="mt-1 text-red-700">This text is not a valid short size, so it will not be applied.</p> : null}
      </article>)}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={stale || !selected} onClick={() => accept(false)} className="rounded bg-emerald-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Accept selected</button>
      <button type="button" disabled={stale || !review.entries.length} onClick={() => accept(true)} className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50">Accept all</button>
      <button type="button" onClick={() => setReview(null)} className="rounded border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700">Cancel</button>
      {stale ? <button type="button" onClick={() => void generate()} className="rounded border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700">Regenerate</button> : null}
    </div>
  </section>;
}
