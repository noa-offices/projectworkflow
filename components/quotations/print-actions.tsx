"use client";

import type { ReactNode } from "react";

export function PrintActions({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="max-w-md text-xs text-zinc-500">
        <p>In Chrome print settings, turn off Headers and footers for a clean PDF.</p>
        <p className="mt-1">Use Landscape orientation.</p>
      </div>
      {children}
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
      >
        Print / Save PDF
      </button>
    </div>
  );
}
