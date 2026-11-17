"use client";

import { useEffect, useRef, useState } from "react";
import { specificationDrift, type SetupProblem } from "@/lib/products/saved-setups/replay";
import type { SavedSetupSpecOverrides } from "@/lib/products/saved-setups/recipe";

/**
 * Shown at the top of the configurator after a setup was opened from My Collection.
 * - needs_review: lists exactly what could not be restored (nothing is dropped silently).
 * - specification: if the saved edited text was based on an older generated specification, the user chooses
 *   "Keep my edited text" or "Use the new generated text". If the generated text is unchanged, the saved
 *   edited text is simply re-applied.
 * Renders nothing when there is nothing to say. No price is ever shown here.
 */
export function SetupReplayBanner({
  generatedSpecification,
  onApplyEditedText,
  onDismiss,
  onUseGeneratedText,
  problems,
  setupName,
  specOverrides,
}: {
  generatedSpecification: string | null;
  onApplyEditedText: (text: string) => void;
  onDismiss: () => void;
  onUseGeneratedText: () => void;
  problems: SetupProblem[];
  setupName: string;
  specOverrides: SavedSetupSpecOverrides;
}) {
  const hasEditedText = specOverrides.specification_edited && typeof specOverrides.edited_specification === "string";
  // Decided ONCE, on the first render after the setup was opened (the selections are already restored then).
  const [initialDrift] = useState<"same" | "changed">(() => (hasEditedText ? specificationDrift(specOverrides, generatedSpecification) : "same"));
  const [specDecided, setSpecDecided] = useState(false);
  const appliedSilently = useRef(false);

  // Unchanged generated text: re-apply the saved edit once, silently.
  useEffect(() => {
    if (!hasEditedText || initialDrift !== "same" || appliedSilently.current) return;
    appliedSilently.current = true;
    onApplyEditedText(specOverrides.edited_specification as string);
  }, [hasEditedText, initialDrift, onApplyEditedText, specOverrides.edited_specification]);

  const askAboutSpecification = hasEditedText && initialDrift === "changed" && !specDecided;
  if (problems.length === 0 && !askAboutSpecification) return null;

  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 lg:px-6">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {problems.length ? `"${setupName}" needs review. Some choices could not be restored:` : `"${setupName}": the product specification has changed.`}
        </p>
        <button type="button" onClick={onDismiss} className="shrink-0 font-semibold underline">Dismiss</button>
      </div>
      {problems.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {problems.map((problem) => <li key={`${problem.kind}-${problem.label}`}>{problem.label}</li>)}
        </ul>
      ) : null}
      {problems.length ? <p className="mt-1">Everything else is filled in. Check the choices, then add as normal.</p> : null}
      {askAboutSpecification ? (
        <div className="mt-2 space-y-2">
          <p>
            The generated specification for this product has changed since you saved this setup. Your saved edited text is not applied yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { onApplyEditedText(specOverrides.edited_specification as string); setSpecDecided(true); }}
              className="border border-amber-700 bg-white px-3 py-1.5 font-semibold text-amber-900"
            >
              Keep my edited text
            </button>
            <button
              type="button"
              onClick={() => { onUseGeneratedText(); setSpecDecided(true); }}
              className="border border-amber-700 bg-white px-3 py-1.5 font-semibold text-amber-900"
            >
              Use the new generated text
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
