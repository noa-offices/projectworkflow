"use client";

import { useMemo, useState } from "react";
import { runFinalSpecificationImprovement } from "@/app/quotations/final-specification-ai-actions";
import type { FinalSpecificationRequest } from "@/lib/quotations/final-specification-ai-contract";
import {
  acceptedFinalSpecificationSuggestion,
  finalSpecificationRequestFingerprint,
} from "@/lib/quotations/final-specification-ai-selection";

type Preview = { fingerprint: string; suggestedValue: string };

export function FinalSpecificationAiControl({
  request,
  onUseSuggestion,
}: {
  request: FinalSpecificationRequest;
  onUseSuggestion: (specification: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ fingerprint: string; value: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const fingerprint = useMemo(() => finalSpecificationRequestFingerprint(request), [request]);
  const visiblePreview = preview?.fingerprint === fingerprint ? preview : null;
  const visibleMessage = message?.fingerprint === fingerprint ? message.value : "";

  async function improve() {
    const requestFingerprint = fingerprint;
    setPending(true);
    setMessage(null);
    setPreview(null);
    try {
      const response = await runFinalSpecificationImprovement(request);
      if (!response.ok) {
        setMessage({ fingerprint: requestFingerprint, value: response.message });
      } else if (!response.result.specificationSuggestion) {
        setMessage({ fingerprint: requestFingerprint, value: "AI could not improve the specification from the current selections." });
      } else {
        setPreview({ fingerprint: requestFingerprint, suggestedValue: response.result.specificationSuggestion });
      }
    } catch {
      setMessage({ fingerprint: requestFingerprint, value: "AI could not improve the specification from the current selections." });
    } finally {
      setPending(false);
    }
  }

  function useSuggestion() {
    if (!visiblePreview) return;
    const accepted = acceptedFinalSpecificationSuggestion(visiblePreview.suggestedValue);
    if (!accepted) {
      setMessage({ fingerprint, value: "Enter a specification of 1500 characters or fewer before using it." });
      return;
    }
    onUseSuggestion(accepted);
    setPreview(null);
    setMessage(null);
  }

  return <div className="mt-3 border-t border-zinc-200 pt-3">
    <button
      type="button"
      disabled={pending}
      onClick={() => void improve()}
      className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700 disabled:opacity-50"
    >
      {pending ? "Improving..." : "Improve Final Specification"}
    </button>
    {visibleMessage ? <p className="mt-2 text-xs text-zinc-600" role="status">{visibleMessage}</p> : null}
    {visiblePreview ? <div className="mt-3 space-y-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs">
      <div>
        <p className="font-semibold text-zinc-900">Current</p>
        <p className="mt-1 whitespace-pre-wrap text-zinc-600">{request.currentSpecification || "--"}</p>
      </div>
      <label className="block font-semibold text-zinc-900">
        Suggested
        <textarea
          value={visiblePreview.suggestedValue}
          maxLength={1500}
          rows={6}
          onChange={(event) => setPreview({ ...visiblePreview, suggestedValue: event.target.value })}
          className="mt-1 w-full rounded border border-emerald-200 bg-white px-2 py-1.5 font-normal leading-5 text-zinc-700 outline-none focus:border-emerald-700"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={useSuggestion} className="font-semibold text-emerald-900">Use Suggestion</button>
        <button type="button" onClick={() => { setPreview(null); setMessage(null); }} className="text-zinc-600">Keep Current</button>
      </div>
    </div> : null}
  </div>;
}
