"use client";

import { SaveToMyCollectionButton } from "@/components/quotations/save-to-my-collection-button";
import { recipeFromLine, type LineLike } from "@/lib/products/saved-setups/line-recipe";

// Line action for a quote line. Custom, note and blank rows show nothing. A template line added before
// My Collection (no stored recipe) shows a disabled button with a short hint. Otherwise it reuses the selector's
// save button (same name box, same saveSetup action, same success message and "Open My Collection" link).
export function SaveLineToMyCollectionButton({ line }: { line: LineLike }) {
  const result = recipeFromLine(line);
  if (!result.ok) {
    if (result.reason === "not_a_template_line") return null;
    return (
      <div className="mt-1">
        <button
          type="button"
          disabled
          className="h-7 w-full cursor-not-allowed border border-zinc-200 bg-zinc-50 px-2 text-left text-xs font-semibold text-zinc-400"
        >
          Save to My Collection
        </button>
        <p className="mt-1 text-[11px] text-zinc-500">{result.message}</p>
      </div>
    );
  }
  return <SaveToMyCollectionButton defaultName={result.defaultName} state={result.state} templateId={result.templateId} />;
}
