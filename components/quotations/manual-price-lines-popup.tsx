"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { markManualPriceCheckedAction } from "@/components/products/manual-price-check-actions";
import { loadManualPriceLinesAction, saveManualPriceLinesAction, type ManualPriceLinesResult } from "@/components/products/manual-price-lines-actions";
import { collectPriceChanges, isEditableLine, NO_PRICES_MESSAGE, sharedLineCurrency, priceDifference, priceInputText, pricesWillChangeText, type ManualPriceLine } from "@/lib/products/manual-price-lines";
import type { SupplierFamilyStatusPresentation } from "@/lib/products/supplier-family-status";
import { supplierTemplateStatusPresentation } from "./supplier-template-status-actions";

const money = (value: number | null) => value === null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const buttonClass = "rounded-md bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const quietButton = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700 disabled:opacity-50";

/** The table. With canEdit false there are no inputs at all. Changed rows are highlighted. */
export function ManualPriceLinesTable({ lines, canEdit, inputs, errors, onInput }: { lines: ManualPriceLine[]; canEdit: boolean; inputs: Record<string, string>; errors: Record<string, string>; onInput: (key: string, value: string) => void }) {
  // One shared currency goes in the headers; mixed currencies show in each cell. Never the template currency.
  const currency = sharedLineCurrency(lines), unit = currency ? ` (${currency})` : "", cell = (line: ManualPriceLine) => `${money(line.price)}${!currency && line.price !== null ? ` ${line.currency}` : ""}`;
  if (lines.length === 0) return <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">{NO_PRICES_MESSAGE}</p>;
  return <div className="mt-3 max-h-[52vh] overflow-auto rounded-lg border border-zinc-200">
    <table className="w-full min-w-[640px] text-left text-sm">
      <thead className="sticky top-0 z-10 bg-zinc-100 text-xs font-semibold text-zinc-700">
        <tr><th className="px-3 py-2">Model code</th><th className="px-3 py-2">Price name</th><th className="px-3 py-2 text-right">Current price{unit}</th>{canEdit ? <th className="px-3 py-2 text-right">New price{unit}</th> : null}{canEdit ? <th className="px-3 py-2 text-right">Difference</th> : null}</tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const text = inputs[line.key] ?? priceInputText(line.price), diff = priceDifference(line, text), changed = diff !== null && diff !== 0, error = errors[line.key];
          return <tr key={line.key} className={`border-t border-zinc-100 align-top ${changed ? "bg-amber-50" : ""}`} data-changed={changed ? "true" : "false"}>
            <td className="px-3 py-2 font-semibold text-zinc-900">{line.code}</td>
            <td className="px-3 py-2 text-zinc-600">{line.label || "—"}</td>
            <td className="px-3 py-2 text-right tabular-nums">{cell(line)}</td>
            {canEdit ? <td className="px-3 py-2 text-right">{isEditableLine(line)
              ? <><input type="text" inputMode="decimal" aria-label={`New price for ${line.code} ${line.label}`} value={text} onChange={(event) => onInput(line.key, event.target.value)} className={`h-8 w-28 rounded-md border px-2 text-right text-sm tabular-nums ${error ? "border-red-400" : "border-zinc-300"}`} />{error ? <span role="alert" className="block text-xs text-red-800">{error}</span> : null}</>
              : <span className="block max-w-48 text-xs text-zinc-600">This price is empty. Set it by hand in Edit Template.</span>}</td> : null}
            {canEdit ? <td className={`px-3 py-2 text-right tabular-nums ${changed ? "font-semibold text-amber-950" : "text-zinc-500"}`}>{signed(diff)}</td> : null}
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

/**
 * "Update prices" for a product of a manual price check Brand: type the new price of every line, save the changed ones in one batch,
 * then mark the prices as checked. People who cannot edit see the same table read only. Nothing is saved until the confirm button.
 */
export function ManualPriceLinesAction({ templateId, templateName, canEdit, onSupplierStatus }: { templateId: string; templateName: string; canEdit: boolean; onSupplierStatus?: (templateId: string, presentation: SupplierFamilyStatusPresentation | null) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ManualPriceLinesResult | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);

  // Every load reads the product again, so the version in `data` is always the fresh one (also right after a save).
  const load = async (message = "") => {
    setLoading(true); setError(""); setNotice(message);
    try {
      const next = await loadManualPriceLinesAction(templateId);
      setData(next); setInputs({}); setShowErrors(false); setConfirmCount(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the price lines."); }
    finally { setLoading(false); }
  };
  const refreshBadge = async () => {
    try { onSupplierStatus?.(templateId, await supplierTemplateStatusPresentation(templateId)); return ""; } catch { return " Reload the page to update the badge."; }
  };
  const pending = data ? collectPriceChanges(data.lines, inputs) : { changes: [], errors: {} };
  const askToSave = () => {
    setError(""); setShowErrors(true);
    if (Object.keys(pending.errors).length) { setError("Fix the prices marked in red."); return; }
    if (!pending.changes.length) { setError("No prices were changed."); return; }
    setConfirmCount(pending.changes.length);
  };
  const save = async () => {
    if (!data || busy) return;
    setBusy(true); setError("");
    try {
      const saved = await saveManualPriceLinesAction(templateId, data.pricingVersion, pending.changes);
      const note = await refreshBadge();
      await load(`${saved.savedCount} ${saved.savedCount === 1 ? "price" : "prices"} saved.${note}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save. Nothing was changed."); setConfirmCount(null); }
    finally { setBusy(false); }
  };
  const mark = async () => {
    if (!data || busy) return;
    setBusy(true); setError("");
    try {
      await markManualPriceCheckedAction(templateId, data.pricingVersion);
      const note = await refreshBadge();
      await load(`Prices marked as checked.${note}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not mark as checked."); }
    finally { setBusy(false); }
  };
  const editable = canEdit && Boolean(data?.canEdit);

  return <>
    <button type="button" onClick={(event) => { event.stopPropagation(); setOpen(true); void load(); }} className="mt-2 inline-flex max-w-full items-center justify-center justify-self-start whitespace-normal break-words rounded-md border border-emerald-700 bg-white px-3 py-1.5 text-center text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">{canEdit ? "Update prices" : "View prices"}</button>
    {open && typeof document !== "undefined" ? createPortal(
      <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-zinc-950/45 sm:items-center sm:px-4 sm:py-6" onClick={(event) => event.stopPropagation()}>
        <div role="dialog" aria-modal="true" aria-label="Supplier price lines" className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:w-[min(1180px,96vw)] sm:rounded-2xl sm:border sm:border-zinc-300">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4">
            <div><h3 className="text-base font-semibold text-zinc-950">Supplier price lines</h3><p className="text-sm text-zinc-600">{data?.brandName ? `${data.brandName} — ` : ""}{templateName}</p></div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-800 hover:border-zinc-500">Close</button>
          </div>
          <p className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-600 sm:px-6">{canEdit ? "Type the new prices from the supplier's price list. Nothing is saved until you click Save prices." : "Read only. Nothing is saved here."}</p>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {loading ? <p className="text-sm text-zinc-500">Loading price lines…</p> : null}
            {notice ? <p role="status" className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">{notice}</p> : null}
            {error ? <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
            {data ? <>
              <p className="text-sm font-semibold text-zinc-900">{data.release ? `Price list released ${dateText(data.release.effectiveFrom)}${data.release.note ? ` - ${data.release.note}` : ""}` : "No price list has been released yet."}</p>
              <ManualPriceLinesTable lines={data.lines} canEdit={editable} inputs={inputs} errors={showErrors ? pending.errors : {}} onInput={(key, value) => { setInputs((current) => ({ ...current, [key]: value })); setNotice(""); setError(""); setShowErrors(false); }} />
              {data.checked ? <p className="mt-3 text-sm font-semibold text-emerald-900">Checked on {dateText(data.checked.checkedAt)}{data.checked.checkedByName ? ` by ${data.checked.checkedByName}` : ""}</p> : null}
              {editable ? <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy || loading} onClick={askToSave} className={buttonClass}>Save prices</button>
                <button type="button" disabled={busy || loading || pending.changes.length > 0 || !data.release} onClick={() => void mark()} className={quietButton}>Mark prices as checked</button>
                {pending.changes.length ? <span className="text-xs text-zinc-600">{pricesWillChangeText(pending.changes.length)} Save them before marking as checked.</span> : null}
              </div> : null}
            </> : null}
          </div>
          {confirmCount !== null ? <div className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/50 p-4" onClick={(event) => event.stopPropagation()}>
            <div role="dialog" aria-modal="true" aria-label="Save prices" className="w-[min(520px,96vw)] rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl">
              <h4 className="text-base font-semibold text-zinc-950">Save prices</h4>
              <p className="mt-2 text-sm text-zinc-700">{pricesWillChangeText(confirmCount)} Saved quotations do not change. The old prices stay in the price history.</p>
              {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={() => setConfirmCount(null)} className={quietButton}>Cancel</button>
                <button type="button" disabled={busy} onClick={() => void save()} className={buttonClass}>{busy ? "Saving…" : "Save prices"}</button>
              </div>
            </div>
          </div> : null}
        </div>
      </div>, document.body) : null}
  </>;
}
