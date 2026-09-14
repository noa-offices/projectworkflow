"use client";

import { useMemo, useState } from "react";
import { runBatchSpecificationEnrichment } from "@/app/products/templates/specification-enrichment-actions";
import type { OriginalImportedJsonSource } from "@/lib/products/original-imported-json-sources";
import type { ProductTemplateDraft } from "@/lib/products/product-template-draft";
import { SPEC_ENRICHMENT_SPECIFICATION_MAX } from "@/lib/products/specification-enrichment-contract";
import {
  applyBatchSpecificationSuggestions,
  batchSpecificationFingerprint,
  flattenBatchSpecificationTargets,
  summarizeBatchSpecificationSuggestions,
  type BatchSpecificationSuggestion,
} from "@/lib/products/specification-enrichment-batch";
import {
  initializeEditableBatchSpecificationSuggestions,
  selectedBatchSpecificationSuggestions,
  updateEditableBatchSpecificationSuggestion,
  type EditableBatchSpecificationSuggestion,
} from "@/lib/products/batch-specification-review-state";

type ReviewState = {
  fingerprint: string;
  results: BatchSpecificationSuggestion[];
  skippedTargetIds: string[];
  message: string;
  edits: EditableBatchSpecificationSuggestion[];
};

export function BatchSpecificationEnrichmentControl({ draft, originalImportedJsonSources, onApply }: {
  draft: ProductTemplateDraft;
  originalImportedJsonSources: OriginalImportedJsonSource[];
  onApply: (draft: ProductTemplateDraft) => void;
}) {
  const [pending, setPending] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const fingerprint = useMemo(() => batchSpecificationFingerprint(draft, originalImportedJsonSources), [draft, originalImportedJsonSources]);
  const targets = useMemo(() => flattenBatchSpecificationTargets(draft), [draft]);
  const summary = review ? summarizeBatchSpecificationSuggestions(targets, review.results, review.skippedTargetIds) : null;
  const applySuggestions = review ? selectedBatchSpecificationSuggestions(review.edits) : [];
  const stale = Boolean(review && review.fingerprint !== fingerprint);
  const targetLookup = useMemo(() => new Map(targets.map((target) => [target.targetId, target])), [targets]);

  const generate = async () => {
    setPending(true);
    setReview(null);
    setShowChanges(false);
    const requestFingerprint = fingerprint;
    try {
      const response = await runBatchSpecificationEnrichment({ draft, originalImportedJsonSources });
      setReview({
        fingerprint: requestFingerprint,
        results: response.results,
        skippedTargetIds: response.skippedTargetIds,
        message: response.ok ? "" : response.message,
        edits: initializeEditableBatchSpecificationSuggestions(response.results),
      });
    } catch {
      setReview({ fingerprint: requestFingerprint, results: [], skippedTargetIds: targets.map((target) => target.targetId), message: "Specification enrichment could not be completed.", edits: [] });
    } finally {
      setPending(false);
    }
  };

  const cancel = () => { setReview(null); setShowChanges(false); };
  const applyAll = () => {
    if (!review || stale || !applySuggestions.length) return;
    onApply(applyBatchSpecificationSuggestions(draft, applySuggestions));
    cancel();
  };
  const updateEdit = (targetId: string, patch: Partial<Pick<EditableBatchSpecificationSuggestion, "value" | "selected">>) => {
    setReview((current) => current ? { ...current, edits: updateEditableBatchSpecificationSuggestion(current.edits, targetId, patch) } : current);
  };

  if (!review) return <button type="button" disabled={pending || !targets.length} onClick={() => void generate()} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-50">
    {pending ? "Improving specifications..." : "Improve All Specifications with AI"}
  </button>;

  return <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
    <h3 className="font-semibold text-emerald-950">AI Specification Review</h3>
    <p className="mt-1 text-xs text-emerald-900">Changed: {summary?.changed ?? 0} · Unchanged: {summary?.unchanged ?? 0} · Skipped: {summary?.skipped ?? 0}</p>
    {review.message ? <p className="mt-2 text-xs text-amber-800">{review.message}</p> : null}
    {stale ? <p className="mt-2 text-xs font-semibold text-red-700">The reviewed draft or imported source changed. Regenerate suggestions before applying.</p> : null}
    {showChanges ? <div className="mt-3 max-h-64 space-y-3 overflow-y-auto border-t border-emerald-200 pt-3">
      {summary?.changedItems.map((item) => {
        const target = targetLookup.get(item.targetId);
        const edit = review.edits.find((candidate) => candidate.targetId === item.targetId);
        return <article key={item.targetId} className="rounded bg-white p-3 text-xs">
          <p className="font-semibold text-zinc-900">{target?.label ?? item.targetId}{target?.row.supplierCodes[0] ? ` · ${target.row.supplierCodes[0]}` : ""}</p>
          <p className="mt-2 font-medium text-zinc-600">Current:</p>
          <p>{target?.currentSpecification ?? "--"}</p>
          <label className="mt-2 block font-medium text-zinc-600">Suggested specification
            <textarea value={edit?.value ?? item.specificationSuggestion ?? ""} maxLength={SPEC_ENRICHMENT_SPECIFICATION_MAX} onChange={(event) => updateEdit(item.targetId, { value: event.target.value })} className="mt-1 min-h-20 w-full rounded border border-zinc-300 p-2 font-normal text-zinc-900" />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => updateEdit(item.targetId, { selected: true })} className="font-semibold text-emerald-900">Use</button>
            <button type="button" onClick={() => updateEdit(item.targetId, { selected: false })} className="text-zinc-600">Keep Current</button>
            {edit && !edit.selected ? <span className="text-zinc-500">Excluded</span> : null}
          </div>
        </article>;
      })}
    </div> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={stale || !applySuggestions.length} onClick={applyAll} className="rounded bg-emerald-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Apply All Safe Suggestions</button>
      <button type="button" disabled={!summary?.changed} onClick={() => setShowChanges((current) => !current)} className="rounded border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 disabled:opacity-50">Review Changes</button>
      <button type="button" onClick={cancel} className="rounded border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700">Cancel</button>
      {stale ? <button type="button" onClick={() => void generate()} className="rounded border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700">Regenerate</button> : null}
    </div>
  </section>;
}
