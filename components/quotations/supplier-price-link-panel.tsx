"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { confirmSupplierBindings } from "@/app/products/price-updates/supplier-sources/actions";
import { confirmLineText, confirmLinksInOrder, linkRowIdentity } from "@/lib/products/supplier-link-confirm";
import { linkReasonLabels, notInProductLines, priceLineStateLabels, type LinkRow, type PriceLine } from "@/lib/products/supplier-price-lines";

const money = (value: number | null, currency: string | null) => value === null ? "—" : `${currency ?? ""} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const lineLabel = (line: PriceLine) => `${line.code} · ${line.link?.tierLabel ?? ""}`;
const suggestedRow = (line: PriceLine) => line.link?.rows.find((row) => row.targetKey === line.link?.suggestion?.targetKey && !row.taken);

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/50 p-4" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
        <h4 className="text-base font-semibold text-zinc-950">{title}</h4>
        {children}
      </div>
    </div>,
    document.body,
  );
}
const Warning = () => <p role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">This is saved for the whole brand and for future price lists. Product prices do not change. You can remove a link later.</p>;

/** One supplier line: "Link" for the suggested row, or "Link to a row" to choose one of this product's rows of the code. Saves only on the confirm button. */
export function SupplierLinkButton({ line, brandId, onDone }: { line: PriceLine; brandId: string; onDone: (message: string) => void }) {
  const link = line.link;
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!link) return null;
  const suggestion = suggestedRow(line);
  const row: LinkRow | undefined = link.rows.find((item) => item.targetKey === chosen);
  const start = () => { setError(""); setChosen(suggestion?.targetKey ?? ""); setOpen(true); };
  const save = async () => {
    if (!row || row.taken || busy) return;
    setBusy(true); setError("");
    const outcome = await confirmLinksInOrder(brandId, [{ label: lineLabel(line), mapping: row.mapping }], confirmSupplierBindings);
    setBusy(false);
    if (outcome.failed) { setError(outcome.failed.message); return; }
    setOpen(false); onDone(`Link saved for code ${line.code}, tier ${link.tierLabel}.`);
  };
  if (!link.rows.length) return <span className="block max-w-48 text-xs text-zinc-600">No row of your product has this currency.</span>;
  return (
    <>
      <button type="button" onClick={start} className="whitespace-nowrap text-xs font-semibold text-emerald-800 underline">{suggestion ? "Link" : "Link to a row"}</button>
      {suggestion && link.suggestion ? <span className="block text-[11px] text-zinc-500">Suggested: {linkRowIdentity(suggestion).join(" · ")} ({linkReasonLabels[link.suggestion.reason]})</span> : null}
      {open ? <Dialog title="Link this supplier line to a row" onClose={() => { if (!busy) setOpen(false); }}>
        <p className="mt-2 text-sm text-zinc-700">Supplier tier <span className="font-semibold">{link.tierLabel || "—"}</span> for code <span className="font-semibold">{line.code}</span>, supplier price <span className="font-semibold">{money(line.supplierPrice, line.supplierCurrency)}</span>.</p>
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm font-medium text-zinc-800">Your row for this tier</legend>
          {link.rows.map((item) => (
            <label key={item.targetKey} className={`flex items-start gap-2 rounded-md border p-2 text-sm ${item.taken ? "border-zinc-200 bg-zinc-50 text-zinc-500" : "border-zinc-300"}`}>
              <input type="radio" name="link-row" disabled={item.taken} checked={chosen === item.targetKey} onChange={() => setChosen(item.targetKey)} className="mt-1" />
              <span><span className="font-semibold text-zinc-900">{item.code ? `${item.code} · ` : ""}{item.name}</span>{item.note ? <span className="block text-xs text-zinc-600">{item.note}</span> : null}
                <span className="block text-xs">Your price {money(item.price, item.currency)}{item.linkedTiers?.length ? ` · Linked to ${item.linkedTiers.join(", ")}` : ""}{item.taken ? ` · ${item.takenReason ?? "Already linked to another supplier line."}` : ""}{link.suggestion?.targetKey === item.targetKey ? ` · suggested (${linkReasonLabels[link.suggestion.reason]})` : ""}</span></span>
            </label>
          ))}
        </fieldset>
        {row ? <p className="mt-3 text-sm text-zinc-700">Result after saving: <span className="font-bold">{priceLineStateLabels[row.mapping.preview]}</span></p> : null}
        <Warning />
        {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700">Cancel</button>
          <button type="button" disabled={busy || !row || row.taken} onClick={() => void save()} className="rounded-md bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save link"}</button>
        </div>
      </Dialog> : null}
    </>
  );
}

/** Saves every suggested link, one existing save per line, stopping at the first failure. Nothing is saved before the confirm button. */
export function ConfirmAllSuggested({ lines, brandId, onDone }: { lines: PriceLine[]; brandId: string; onDone: (message: string) => void }) {
  const items = lines.flatMap((line) => { const row = suggestedRow(line); return line.link && !line.link.notInProduct && row ? [{ line, row }] : []; });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  if (!items.length) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true); setError("");
    const outcome = await confirmLinksInOrder(brandId, items.map(({ line, row }) => ({ label: lineLabel(line), mapping: row.mapping })), confirmSupplierBindings);
    setBusy(false); setSaved(outcome.saved);
    if (outcome.failed) { setError(`Stopped at ${outcome.failed.label}: ${outcome.failed.message} ${outcome.saved} link${outcome.saved === 1 ? "" : "s"} saved before it.`); return; }
    setOpen(false); onDone(`${outcome.saved} link${outcome.saved === 1 ? "" : "s"} saved.`);
  };
  const close = () => { if (busy) return; setOpen(false); if (saved > 0) onDone(`${saved} link${saved === 1 ? "" : "s"} saved. ${error}`); };
  return (
    <>
      <button type="button" onClick={() => { setError(""); setSaved(0); setOpen(true); }} className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white">Confirm all suggested ({items.length})</button>
      {open ? <Dialog title={`Confirm ${items.length} suggested links`} onClose={close}>
        <p className="mt-2 text-sm text-zinc-700">Each supplier tier below will be linked to the row shown. Check them first.</p>
        <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm">
          {items.map(({ line, row }) => <li key={line.key} className="break-words rounded border border-zinc-100 px-2 py-1">{confirmLineText(line, row)}</li>)}
        </ul>
        <Warning />
        {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={close} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700">{error ? "Close" : "Cancel"}</button>
          {error ? null : <button type="button" disabled={busy} onClick={() => void run()} className="rounded-md bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : `Save ${items.length} links`}</button>}
        </div>
      </Dialog> : null}
    </>
  );
}

/** Collapsed group of supplier lines no row of this product looks like. Display only; each can still be linked by hand. */
export function NotInProductGroup({ lines, brandId, onDone }: { lines: PriceLine[]; brandId: string; onDone: (message: string) => void }) {
  const hidden = notInProductLines(lines);
  if (!hidden.length) return null;
  return (
    <details className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-700">Not in this product ({hidden.length})</summary>
      <table className="w-full text-left text-sm">
        <tbody>
          {hidden.map((line) => (
            <tr key={line.key} className="border-t border-zinc-200 align-top">
              <td className="px-3 py-2 font-semibold text-zinc-900">{line.code}</td>
              <td className="px-3 py-2 text-zinc-600">{line.field}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(line.supplierPrice, line.supplierCurrency)}</td>
              <td className="px-3 py-2"><SupplierLinkButton line={line} brandId={brandId} onDone={onDone} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
