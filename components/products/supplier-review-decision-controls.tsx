"use client";

import { useState } from "react";
import { decisionLabels, usableSupplierPrice, type DecisionDraft, type ReviewDecision } from "@/lib/products/supplier-review-decisions";
import type { ReviewRow } from "@/lib/products/smart-setup-supplier-review";

export function ReviewSaveButton({ count, disabled, saving, onSave }: { count: number; disabled: boolean; saving: boolean; onSave: () => void }) {
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={onSave} disabled={disabled || !count} className="min-h-10 rounded-md bg-emerald-800 px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save decisions"}</button>
    {count > 0 ? <span role="status" className="text-sm font-medium text-amber-900">{count} unsaved change{count === 1 ? "" : "s"}</span> : null}
  </div>;
}
export function PriceChangedTag() { return <span className="block rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">Price changed, check again</span>; }
export function ReviewDecisionControls({ row, draft, disabled, changed, conflict, onChange }: { row: ReviewRow; draft: DecisionDraft; disabled: boolean; changed: boolean; conflict: boolean; onChange: (draft: DecisionDraft) => void }) {
  const [noteOpen, setNoteOpen] = useState(Boolean(draft.note));
  return <div className="min-w-48 space-y-2 py-2 normal-case tracking-normal">
    {changed ? <PriceChangedTag /> : null}
    {conflict ? <p className="max-w-64 text-xs text-amber-900">This code and price field have different category or price rows. They cannot share one saved decision.</p> : null}
    <select aria-label={`Action for ${row.result.code} ${row.category}`} value={draft.decision} disabled={disabled || conflict}
      onChange={(e) => onChange({ ...draft, decision: e.target.value as ReviewDecision | "", customPrice: e.target.value === "set_custom" ? draft.customPrice : "", confirmed: true })}
      className="min-h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm disabled:opacity-50">
      <option value="">Not decided</option>
      {(Object.keys(decisionLabels) as ReviewDecision[]).map((value) => <option key={value} value={value} disabled={value === "use_supplier" && usableSupplierPrice(row) === null}>{decisionLabels[value]}</option>)}
    </select>
    {draft.decision === "set_custom" ? <label className="flex items-center gap-2 text-xs font-medium">My price
      <input aria-label={`My price for ${row.result.code} ${row.category}`} type="number" min="0" max="1000000000000000" step="any" value={draft.customPrice} disabled={disabled || conflict} onChange={(e) => onChange({ ...draft, customPrice: e.target.value, confirmed: true })} className="h-10 min-w-0 w-28 rounded-md border border-zinc-300 px-2 text-sm" />
      <span>{row.result.importedCurrency}</span>
    </label> : null}
    {changed && draft.decision ? <button type="button" disabled={disabled || conflict} onClick={() => onChange({ ...draft, confirmed: true })} className="block min-h-9 text-sm font-semibold text-amber-900 underline">Confirm this decision</button> : null}
    <button type="button" disabled={disabled || conflict || !draft.decision} onClick={() => setNoteOpen((open) => !open)} aria-expanded={noteOpen} className="min-h-9 text-sm text-emerald-900 underline disabled:opacity-50">{noteOpen ? "Hide note" : "Add note"}</button>
    {noteOpen ? <label className="block text-xs text-zinc-600">Note (optional, up to 500 characters)
      <textarea aria-label={`Note for ${row.result.code} ${row.category}`} maxLength={500} rows={2} value={draft.note} disabled={disabled || conflict || !draft.decision} onChange={(e) => onChange({ ...draft, note: e.target.value })} className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white p-2 text-sm" />
    </label> : null}
  </div>;
}
