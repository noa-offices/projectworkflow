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
    <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <NoaAvatar size="header" state={state} />
        <div>
          <p className="text-sm font-semibold leading-tight text-zinc-950">NOA</p>
          <p className="text-xs leading-tight text-zinc-500">ProjectWorkflow Assistant</p>
        </div>
      </div>
      <button
        aria-label="Close NOA"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
        onClick={onClose}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
