"use client";

import { type MouseEvent, type ReactNode, useState } from "react";

const actionClass = "rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-600 hover:text-emerald-900";

export function PricingGroupShell({
  active,
  children,
  notice,
  onActiveChange,
  onAddReferenceImage,
  onAddRow,
  onImportJson,
  onRemove,
  referenceActionLabel = "Add reference image",
  secondaryActions,
  title,
}: {
  active: boolean;
  children: ReactNode;
  notice?: string;
  onActiveChange: (active: boolean) => void;
  onAddReferenceImage: () => void;
  onAddRow: (event: MouseEvent<HTMLButtonElement>) => void;
  onImportJson: () => void;
  onRemove: () => void;
  referenceActionLabel?: string;
  secondaryActions?: ReactNode;
  title: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <header className="border-b border-zinc-200 bg-zinc-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse pricing group" : "Expand pricing group"}
            onClick={() => setExpanded((current) => !current)}
            className="h-8 w-8 rounded-md border border-zinc-200 bg-white text-sm font-semibold text-zinc-700"
          >
            {expanded ? "▼" : "▶"}
          </button>
          <div className="min-w-64 flex-1">{title}</div>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
            <input type="checkbox" checked={active} onChange={(event) => onActiveChange(event.target.checked)} />
            Active
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAddRow} className={actionClass}>+ Add row</button>
          {secondaryActions}
          <button type="button" onClick={onImportJson} className={actionClass}>Import JSON</button>
          <button type="button" onClick={onAddReferenceImage} className={actionClass}>{referenceActionLabel}</button>
          <button type="button" onClick={onRemove} className="ml-auto rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Remove group</button>
        </div>
        {notice ? <p role="status" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{notice}</p> : null}
      </header>
      <div hidden={!expanded} className="p-3">{children}</div>
    </section>
  );
}
