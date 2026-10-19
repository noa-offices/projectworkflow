"use client";

import { Printer } from "lucide-react";
import type { ReactNode } from "react";

export function PrintActions({ children, showHint = true }: { children?: ReactNode; showHint?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {showHint ? (
        <div className="max-w-md text-xs text-zinc-500">
          <p>In Chrome print settings, turn off Headers and footers for a clean PDF.</p>
          <p className="mt-1">Use Landscape orientation.</p>
        </div>
      ) : null}
      {children}
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        <Printer aria-hidden="true" className="h-4 w-4" />
        Print / Save PDF
      </button>
    </div>
  );
}
