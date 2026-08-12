"use client";

import type { ManufacturerFinishGuidance } from "@/lib/products/manufacturer-finish-guidance";

export function ManufacturerFinishGuidancePanel({ guidance, onChange }: { guidance: ManufacturerFinishGuidance[]; onChange?: (guidance: ManufacturerFinishGuidance[]) => void }) {
  if (!guidance.length) return null;
  const editable = Boolean(onChange);
  const update = (index: number, patch: Partial<ManufacturerFinishGuidance>) => onChange?.(guidance.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <details className="rounded-lg border border-zinc-200 bg-white p-3">
    <summary className="cursor-pointer text-sm font-semibold">Manufacturer Finish Guidance <span className="ml-1 text-xs font-normal text-zinc-500">{guidance.length} {guidance.length === 1 ? "group" : "groups"}</span></summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-zinc-500">Manufacturer guidance only. Actual selectable finishes are controlled by the Materials &amp; Finishes setup below.</p>
      {guidance.map((item, index) => <div key={item.id} className="rounded border border-zinc-200 bg-zinc-50 p-3">
        {editable ? <><label className="block text-xs font-semibold text-zinc-600">Label<input value={item.label ?? ""} onChange={(event) => update(index, { label: event.target.value || null })} className="mt-1 block w-full rounded border bg-white p-2 text-sm" /></label><label className="mt-2 block text-xs font-semibold text-zinc-600">Notes<textarea value={item.notes ?? ""} onChange={(event) => update(index, { notes: event.target.value || null })} rows={3} className="mt-1 block w-full rounded border bg-white p-2 text-sm" /></label><button type="button" onClick={() => onChange?.(guidance.filter((_, itemIndex) => itemIndex !== index))} className="mt-2 text-xs font-semibold text-red-700">Remove guidance group</button></> : <><p className="font-semibold text-zinc-900">{item.label ?? "Manufacturer finish guidance"}</p>{item.notes ? <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-zinc-600">{item.notes}</p> : null}</>}
      </div>)}
      {editable ? <button type="button" onClick={() => onChange?.([...guidance, { id: crypto.randomUUID(), label: "New finish guidance", notes: null, supplierCodes: [], referenceCodes: [] }])} className="text-xs font-semibold text-emerald-900">+ Add guidance group</button> : null}
    </div>
  </details>;
}
