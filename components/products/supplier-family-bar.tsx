"use client";

import { useState } from "react";

export type SupplierFamilyBarProps = {
  families: Array<{ family: string; key: string }>;
  chosen: Array<{ family: string; key: string }>;
  missing?: Array<{ family: string; key: string }>;
  /** Called once with the chosen family names. Throwing keeps the panel open and shows the message. */
  onSave: (names: string[]) => Promise<void>;
  saveLabel?: string;
  /** Plain-words line shown above the choices, for example that nothing is saved. */
  note?: string;
};
const searchFrom = 15;

/**
 * Which Supplier family or families a product belongs to. Only for price lists that have families.
 * Nothing happens until the save button is pressed; then `onSave` is called once.
 */
export function SupplierFamilyBar({ families, chosen, missing = [], onSave, saveLabel = "Save family", note }: SupplierFamilyBarProps) {
  const [open, setOpen] = useState(false), [picked, setPicked] = useState<string[]>([]), [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!families.length) return null;
  const openPanel = () => {
    const inList = new Set(families.map((item) => item.key));
    const saved = chosen.filter((item) => inList.has(item.key)).map((item) => item.key);
    // One family is selected for the user only when the list has exactly one. Otherwise they choose; nothing is guessed.
    setPicked(saved.length ? saved : families.length === 1 ? [families[0].key] : []); setQuery(""); setError(""); setOpen(true);
  };
  const toggle = (key: string, on: boolean) => setPicked((current) => on ? [...current.filter((item) => item !== key), key] : current.filter((item) => item !== key));
  const visible = families.length > searchFrom && query.trim() ? families.filter((item) => item.family.toLowerCase().includes(query.trim().toLowerCase())) : families;
  const save = async () => {
    if (busy || !picked.length) return;
    setBusy(true); setError("");
    try {
      await onSave(families.filter((item) => picked.includes(item.key)).map((item) => item.family));
      setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the family. Nothing was changed."); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm" aria-label="Supplier family">
      {missing.map((item) => <p key={item.key} role="alert" className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-950">This family is not in the new price list: {item.family}. Choose again.</p>)}
      <div className="flex flex-wrap items-center gap-2">
        {chosen.length === 0
          ? <span className="text-zinc-800">No family chosen for this product. Choose a family to compare prices.</span>
          : <><span className="text-xs font-semibold text-zinc-600">Family:</span>{chosen.map((item) => <span key={item.key} className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-900">{item.family}</span>)}</>}
        {!open ? <button type="button" onClick={openPanel} className="rounded-md border border-emerald-700 bg-white px-3 py-1 text-xs font-semibold text-emerald-900">{chosen.length === 0 ? "Choose family" : "Change"}</button> : null}
      </div>
      {note ? <p className="mt-2 text-xs text-zinc-700">{note}</p> : null}
      {open ? <div className="mt-3 space-y-2">
        <p className="text-xs text-zinc-700">Choose one family. Choose more only if this product really mixes parts from more than one family.</p>
        {families.length > searchFrom ? <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search families" aria-label="Search families" className="h-8 w-full max-w-xs rounded-md border border-zinc-300 px-2 text-sm" /> : null}
        <ul className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">{visible.map((item) => <li key={item.key}><label className="flex items-center gap-2 rounded border border-zinc-100 bg-white px-2 py-1"><input type="checkbox" className="accent-emerald-900" checked={picked.includes(item.key)} onChange={(event) => toggle(item.key, event.target.checked)} />{item.family}</label></li>)}</ul>
        {visible.length === 0 ? <p className="text-xs text-zinc-600">No family matches your search.</p> : null}
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">{error}</p> : null}
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700">Cancel</button>
          <button type="button" disabled={busy || !picked.length} onClick={() => void save()} className="rounded-md bg-emerald-800 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : saveLabel}</button></div>
      </div> : null}
    </div>
  );
}
