"use client";

export function PrintActions() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="max-w-md text-xs text-zinc-500">
        In Chrome print settings, turn off Headers and footers for a clean PDF.
      </p>
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
