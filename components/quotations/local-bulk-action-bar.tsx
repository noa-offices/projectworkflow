"use client";

// Bulk row actions bar for the local quotation builder (screen only). Pure UI: the builder owns the selection and runs every action
// through its existing row helpers as one undo step. Nothing here is saved.
const button = "inline-flex h-8 items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50";

export function LocalBulkActionBar({
  count,
  percentText,
  onPercentText,
  onApplyPercent,
  onDuplicate,
  sections,
  moveTarget,
  onMoveTarget,
  onMove,
  deleteQuestion,
  confirmingDelete,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  onClear,
  message,
}: {
  count: number;
  percentText: string;
  onPercentText: (value: string) => void;
  onApplyPercent: () => void;
  onDuplicate: () => void;
  sections: ReadonlyArray<{ id: string; label: string }>;
  moveTarget: string;
  onMoveTarget: (sectionId: string) => void;
  onMove: () => void;
  deleteQuestion: string;
  confirmingDelete: boolean;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClear: () => void;
  message: string;
}) {
  if (!count && !message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-3 print:hidden" data-bulk-action-bar>
      <div role="region" aria-label="Bulk row actions" className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700 shadow-lg">
        {count ? (
          <>
            <span className="font-semibold text-zinc-950">{count} selected</span>
            <label className="flex items-center gap-1">
              <span>Set discount %</span>
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                value={percentText}
                onChange={(event) => onPercentText(event.target.value)}
                aria-label="Discount percent for the selected rows"
                className="h-8 w-16 border border-zinc-300 px-2 text-right outline-none focus:border-emerald-800"
              />
            </label>
            <button type="button" className={button} onClick={onApplyPercent} disabled={!percentText.trim()}>Apply</button>
            <button type="button" className={button} onClick={onDuplicate}>Duplicate</button>
            <select value={moveTarget} onChange={(event) => onMoveTarget(event.target.value)} aria-label="Move to section" className="h-8 max-w-[14rem] border border-zinc-300 bg-white px-2">
              <option value="">Move to section...</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
            </select>
            <button type="button" className={button} onClick={onMove} disabled={!moveTarget}>Move</button>
            {confirmingDelete ? (
              <span className="flex items-center gap-2 border border-red-200 bg-red-50 px-2 py-1 text-red-800" role="alert">
                {deleteQuestion}
                <button type="button" className={`${button} border-red-300 text-red-700`} onClick={onConfirmDelete}>Delete</button>
                <button type="button" className={button} onClick={onCancelDelete}>Cancel</button>
              </span>
            ) : (
              <button type="button" className={`${button} text-red-700`} onClick={onAskDelete}>Delete</button>
            )}
            <button type="button" className={button} onClick={onClear}>Clear</button>
          </>
        ) : null}
        {message ? <span role="status" className="text-emerald-900">{message}</span> : null}
      </div>
    </div>
  );
}
