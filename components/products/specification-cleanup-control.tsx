"use client";

import { useMemo, useRef, useState } from "react";
import { runSpecificationCleanup } from "@/app/products/templates/specification-cleanup-actions";
import { isWordSubset } from "@/lib/products/ai-clean-text-checks";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";
import { acceptableSpecificationPatches, applySpecificationPatches, buildSpecificationAccessoryNames, buildSpecificationTargets, chunkSpecificationTargets, runInBatches, SPECIFICATION_CLEANUP_PARALLEL, specificationFingerprint, undoSpecificationPatches, type SpecificationReviewEntry, type SpecificationSuggestion, type SpecificationUndoEntry } from "@/lib/products/specification-cleanup";

type Review = { fingerprint: string; entries: SpecificationReviewEntry[]; accessoryNames: string[]; message: string };

export function SpecificationCleanupControl({ draft, onApply }: { draft: ProductTemplateDraft; onApply: (draft: ProductTemplateDraft) => void }) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const runRef = useRef(0);
  const [review, setReview] = useState<Review | null>(null);
  const [undo, setUndo] = useState<SpecificationUndoEntry[]>([]);
  const [undoMessage, setUndoMessage] = useState("");
  const targets = useMemo(() => buildSpecificationTargets(draft), [draft]);
  const fingerprint = useMemo(() => specificationFingerprint(draft), [draft]);
  const labels = useMemo(() => new Map(targets.map((target) => [target.targetId, target.label])), [targets]);
  const modes = useMemo(() => new Map(targets.map((target) => [target.targetId, target.mode])), [targets]);
  const stale = Boolean(review && review.fingerprint !== fingerprint);

  const generate = async () => {
    const runId = ++runRef.current;
    setPending(true); setReview(null); setUndoMessage(""); setProgress({ done: 0, total: targets.length });
    const requestFingerprint = fingerprint, accessoryNames = buildSpecificationAccessoryNames(draft), texts = new Map(targets.map((target) => [target.targetId, target.text]));
    type Outcome = { ok: true; suggestions: SpecificationSuggestion[] } | { ok: false; message: string };
    const outcomes = await runInBatches(chunkSpecificationTargets(targets), SPECIFICATION_CLEANUP_PARALLEL, async (chunk): Promise<Outcome> => {
      let outcome: Outcome;
      try {
        const response = await runSpecificationCleanup({ items: chunk.map((target) => ({ targetId: target.targetId, text: target.text, mode: target.mode })), accessoryNames });
        outcome = response.ok ? { ok: true, suggestions: response.suggestions } : { ok: false, message: response.message };
      } catch { outcome = { ok: false, message: "The request to the server failed. Try again." }; }
      if (runRef.current === runId) setProgress((current) => current && { ...current, done: Math.min(current.total, current.done + chunk.length) });
      return outcome;
    }, () => runRef.current !== runId);
    if (runRef.current !== runId) return; // cancelled or replaced by a newer run
    const entries: SpecificationReviewEntry[] = outcomes.flatMap((outcome) => outcome?.ok ? outcome.suggestions.map((item) => ({ targetId: item.targetId, original: texts.get(item.targetId) ?? "", value: item.specification, selected: true })) : []);
    const failed = outcomes.filter((outcome) => outcome && !outcome.ok);
    let message = failed.length ? `${(failed[0] as { message: string }).message} ${failed.length} of ${outcomes.length} batches did not finish; the others are shown.` : "";
    if (!message && !entries.length) message = "No specification could be cleaned safely.";
    setReview({ fingerprint: requestFingerprint, entries, accessoryNames, message });
    setPending(false); setProgress(null);
  };
  const cancel = () => { runRef.current += 1; setPending(false); setProgress(null); };
  const edit = (targetId: string, patch: Partial<SpecificationReviewEntry>) => setReview((current) => current && { ...current, entries: current.entries.map((entry) => entry.targetId === targetId ? { ...entry, ...patch } : entry) });
  const accept = (all: boolean) => {
    if (!review || stale) return;
    const patches = acceptableSpecificationPatches(all ? review.entries.map((entry) => ({ ...entry, selected: true })) : review.entries);
    if (!patches.length) return;
    const result = applySpecificationPatches(draft, patches);
    onApply(result.draft); setUndo((current) => [...current, ...result.undo]); setUndoMessage(""); setReview(null);
  };
  const undoAll = () => {
    const result = undoSpecificationPatches(draft, undo);
    onApply(result.draft); setUndo([]);
    setUndoMessage(`Restored ${result.restored} specification${result.restored === 1 ? "" : "s"}${result.kept ? `; ${result.kept} changed since and were left as they are` : ""}.`);
  };

  if (!review) return <div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={pending || !targets.length} onClick={() => void generate()} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">{pending ? (progress ? `Checking ${progress.done} of ${progress.total} rows...` : "Cleaning specifications...") : "Clean specification with AI"}</button>
    {pending ? <button type="button" onClick={cancel} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700">Cancel</button> : null}
    {!targets.length && !pending ? <span className="text-xs text-zinc-500">No specifications to clean.</span> : null}
    {undo.length ? <button type="button" onClick={undoAll} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700">Undo cleaning ({undo.length})</button> : null}
    {undoMessage ? <p className="text-xs text-zinc-600">{undoMessage}</p> : null}
  </div>;
  return <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
    <h3 className="font-semibold text-emerald-950">AI Specification Cleanup</h3>
    <p className="mt-1 text-xs text-emerald-900">Suggestions: {review.entries.length}. Nothing changes until you accept.</p>
    <details className="mt-1 text-xs text-emerald-900"><summary>Checked against {review.accessoryNames.length} accessories</summary><p className="mt-1">{review.accessoryNames.join(", ") || "None"}</p></details>
    {review.message ? <p className="mt-2 text-xs text-amber-800">{review.message}</p> : null}
    {stale ? <p className="mt-2 text-xs font-semibold text-red-700">The specifications or accessories changed after this run. Regenerate before accepting.</p> : null}
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
      {review.entries.map((entry) => <article key={entry.targetId} className="rounded bg-white p-3 text-xs">
        <label className="flex items-center gap-2 font-semibold text-zinc-900"><input type="checkbox" checked={entry.selected} onChange={(event) => edit(entry.targetId, { selected: event.target.checked })} />{labels.get(entry.targetId) ?? entry.targetId}<span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">{modes.get(entry.targetId) === "seating" ? "Seating" : "Accessory-only"}</span></label>
        <p className="mt-1 text-zinc-600">Before: {entry.original}</p>
        <label className="mt-1 block font-medium text-zinc-600">After
          <textarea value={entry.value} onChange={(event) => edit(entry.targetId, { value: event.target.value })} className="mt-1 min-h-16 w-full rounded border border-zinc-300 p-1 font-normal text-zinc-900" />
        </label>
        {!isWordSubset(entry.original, entry.value) ? <p className="mt-1 text-red-700">This text uses a word that is not in the original, or is not shorter, so it will not be applied.</p> : null}
      </article>)}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={stale || !acceptableSpecificationPatches(review.entries).length} onClick={() => accept(false)} className="rounded bg-emerald-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Accept selected</button>
      <button type="button" disabled={stale || !review.entries.length} onClick={() => accept(true)} className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50">Accept all</button>
      <button type="button" onClick={() => setReview(null)} className="rounded border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700">Cancel</button>
      {stale ? <button type="button" onClick={() => void generate()} className="rounded border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700">Regenerate</button> : null}
    </div>
  </section>;
}
