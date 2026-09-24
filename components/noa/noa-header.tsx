"use client";

import { X } from "lucide-react";
import { NoaAvatar } from "@/components/noa/noa-avatar";
import type { NoaVisualState } from "@/lib/noa/noa-types";

export function NoaHeader({
  onClose,
  state,
}: {
  onClose: () => void;
  state: NoaVisualState;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-gradient-to-b from-zinc-50/80 to-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <NoaAvatar size="header" state={state} />
          {/* Small "ready" status dot - a subtle, premium-assistant touch. Decorative only
              (aria-hidden); NoaStatus already announces the same idea in text for screen
              readers, so this never becomes a second, conflicting source of truth. */}
          <span
            aria-hidden="true"
            className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white transition-colors duration-300 ${
              state === "error" ? "bg-red-500" : state === "thinking" || state === "responding" ? "bg-amber-500" : "bg-emerald-500"
            }`}
          />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight text-zinc-950">NOA</p>
          <p className="text-xs leading-tight text-zinc-500">ProjectWorkflow Assistant</p>
        </div>
      </div>
      <button
        aria-label="Close NOA"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
        onClick={onClose}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
