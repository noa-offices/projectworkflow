"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { priceLineStateLabels } from "@/lib/products/supplier-price-lines";
import { useCoverageAccess } from "./supplier-coverage-popup";
import { supplierTemplatePriceLines, type PriceLinesResult } from "./supplier-price-lines-actions";

const money = (value: number | null, currency: string | null) => value === null ? "—" : `${currency ?? ""} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

/** Read-only view of this Product's Supplier price lines. Allowed roles only; it never navigates and writes nothing. */
export function SupplierPriceLinesAction({ templateId, templateName }: { templateId: string; templateName: string }) {
  const allowed = useCoverageAccess();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PriceLinesResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  if (allowed !== true) return null;

  const load = () => {
    setOpen(true); setError(""); setResult(null); setLoading(true);
    supplierTemplatePriceLines(templateId)
      .then(setResult)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the price lines."))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <button type="button" onClick={(event) => { event.stopPropagation(); load(); }} className="block text-left text-[11px] font-semibold text-emerald-800 underline">View price lines</button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/45 px-4 py-6" onClick={(event) => event.stopPropagation()}>
          <div role="dialog" aria-modal="true" aria-label="Supplier price lines" className="flex max-h-[90vh] w-[min(980px,96vw)] flex-col rounded-2xl border border-zinc-300 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
              <div><h3 className="text-sm font-semibold text-zinc-950">Supplier price lines</h3><p className="text-xs text-zinc-600">{templateName}</p></div>
              <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-zinc-500 hover:text-zinc-950">Close</button>
            </div>
            <p className="border-b border-zinc-100 bg-zinc-50 px-5 py-2 text-[11px] font-medium text-zinc-600">Read only. Nothing is saved here.</p>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {loading ? <p className="text-xs text-zinc-500">Loading price lines… this compares the whole Supplier price list, so it can take a few seconds.</p> : null}
              {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">{error}</p> : null}
              {result && result.sources.length === 0 ? <p className="text-xs text-zinc-600">No current Supplier price list covers this product yet, so there are no lines to show.</p> : null}
              {result?.sources.map((source) => (
                <section key={`${source.definitionName}|${source.title}`} className="mb-6">
                  <h4 className="text-xs font-semibold text-zinc-900">{source.definitionName} — {source.title}{source.effectiveFrom ? ` · effective ${source.effectiveFrom}` : ""}</h4>
                  {source.lines.length === 0 ? <p className="mt-2 text-xs text-zinc-600">No price lines for this product in this list.</p> : (
                    <table className="mt-2 w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wide text-zinc-500"><tr><th className="py-1 pr-3">Model code</th><th className="pr-3">Price field</th><th className="pr-3 text-right">Our price</th><th className="pr-3 text-right">Supplier price</th><th className="pr-3 text-right">Difference</th><th>Status</th></tr></thead>
                      <tbody>{source.lines.map((line) => (
                        <tr key={line.key} className="border-t border-zinc-100">
                          <td className="py-1 pr-3 font-medium text-zinc-900">{line.code}</td><td className="pr-3 text-zinc-600">{line.field}</td>
                          <td className="pr-3 text-right">{money(line.ourPrice, line.ourCurrency)}</td><td className="pr-3 text-right">{money(line.supplierPrice, line.supplierCurrency)}</td>
                          <td className="pr-3 text-right">{line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${line.difference.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</td>
                          <td className="font-semibold text-zinc-800">{priceLineStateLabels[line.state]}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                  {source.truncated ? <p className="mt-2 text-[11px] text-amber-800">Showing the first 500 lines.</p> : null}
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
