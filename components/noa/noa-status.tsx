"use client";

import { noaThinkingStatusText } from "@/lib/noa/noa-intent-router";
import type { NoaDomain, NoaVisualState } from "@/lib/noa/noa-types";

export function NoaStatus({
  pendingDomain,
  state,
}: {
  pendingDomain: NoaDomain | null;
  state: NoaVisualState;
}) {
  if (state === "thinking") {
    // Domain-aware copy reuses the same deterministic classification already computed for
    // routing (lib/noa/noa-intent-router.ts) - never a second guess at what NOA is doing.
    const text = pendingDomain ? noaThinkingStatusText(pendingDomain) : "NOA is thinking...";
    return (
      <p aria-live="polite" className="px-4 pb-1 text-xs text-zinc-500">
        {text}
      </p>
    );
  }

  if (state === "responding") {
    return (
      <p aria-live="polite" className="px-4 pb-1 text-xs text-zinc-500">
        NOA is responding...
      </p>
    );
  }

  if (state === "error") {
    return (
      <p aria-live="polite" className="px-4 pb-1 text-xs font-medium text-amber-700">
        NOA couldn&apos;t complete that. Please try again.
      </p>
    );
  }

  return null;
}
