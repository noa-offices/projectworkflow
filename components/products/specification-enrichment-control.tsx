"use client";

import { useMemo, useState } from "react";
import { runSpecificationEnrichment } from "@/app/products/templates/specification-enrichment-actions";
import type { OriginalImportedJsonSource } from "@/lib/products/original-imported-json-sources";
import type {
  SpecificationEnrichmentContext,
  SpecificationEnrichmentResult,
  SpecificationEnrichmentRow,
} from "@/lib/products/specification-enrichment-contract";
import { specificationEnrichmentFieldPatch, specificationEnrichmentFingerprint } from "@/lib/products/specification-enrichment-selection";

export function SpecificationEnrichmentControl({
  row,
  context,
  originalImportedJsonSources,
  onUse,
}: {
  row: SpecificationEnrichmentRow;
  context: SpecificationEnrichmentContext;
  originalImportedJsonSources: OriginalImportedJsonSource[];
  onUse: (patch: Pick<SpecificationEnrichmentRow, "displayName"> | Pick<SpecificationEnrichmentRow, "specification">) => void;
}) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ fingerprint: string; result: SpecificationEnrichmentResult | null; message: string } | null>(null);
  const enrichmentRow = useMemo<SpecificationEnrichmentRow>(() => ({
    id: row.id,
    displayName: row.displayName,
    specification: row.specification,
    supplierCodes: row.supplierCodes,
    referenceCodes: row.referenceCodes,
    dimensions: row.dimensions,
  }), [row.id, row.displayName, row.specification, row.supplierCodes, row.referenceCodes, row.dimensions]);
  const fingerprint = useMemo(() => specificationEnrichmentFingerprint(enrichmentRow, context), [enrichmentRow, context]);
  const result = feedback?.fingerprint === fingerprint ? feedback.result : null;
  const message = feedback?.fingerprint === fingerprint ? feedback.message : "";

  const improve = async () => {
    setPending(true);
    const requestFingerprint = fingerprint;
    setFeedback({ fingerprint: requestFingerprint, result: null, message: "" });
    try {
      const response = await runSpecificationEnrichment({ row: enrichmentRow, context, originalImportedJsonSources });
      if (!response.ok) setFeedback({ fingerprint: requestFingerprint, result: null, message: response.message });
      else if (!response.result.displayNameSuggestion && !response.result.specificationSuggestion) {
        setFeedback({ fingerprint: requestFingerprint, result: null, message: "AI could not improve this field without adding unsupported information." });
      } else setFeedback({ fingerprint: requestFingerprint, result: response.result, message: "" });
    } catch {
      setFeedback({ fingerprint: requestFingerprint, result: null, message: "Specification enrichment could not be completed." });
    } finally {
      setPending(false);
    }
  };

  const keep = (field: keyof SpecificationEnrichmentResult) => setFeedback((current) => {
    if (!current?.result) return current;
    const next = { ...current.result, [field]: null };
    return next.displayNameSuggestion || next.specificationSuggestion ? { ...current, result: next } : null;
  });

  const suggestions = [
    ["displayNameSuggestion", "displayName", "Display Name"],
    ["specificationSuggestion", "specification", "Product Specification"],
  ] as const;

  return <div className="md:col-span-2">
    <button type="button" disabled={pending} onClick={() => void improve()} className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-900 disabled:opacity-50">
      {pending ? "Improving..." : "Improve with AI"}
    </button>
    {message ? <p className="mt-2 text-xs text-zinc-600">{message}</p> : null}
    {result ? <div className="mt-2 space-y-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs">
      {suggestions.map(([suggestionField, rowField, label]) => {
        const proposed = result[suggestionField];
        return proposed ? <div key={suggestionField}>
        <b>{label}</b>
        <p>Current: {row[rowField] ?? "--"}</p>
        <p>Suggested: {proposed}</p>
        <div className="mt-1 flex gap-2">
          <button type="button" className="font-semibold text-emerald-900" onClick={() => {
            onUse(specificationEnrichmentFieldPatch(rowField, proposed));
            keep(suggestionField);
          }}>Use Suggestion</button>
          <button type="button" className="text-zinc-600" onClick={() => keep(suggestionField)}>Keep Current</button>
        </div>
      </div> : null;
      })}
    </div> : null}
  </div>;
}
