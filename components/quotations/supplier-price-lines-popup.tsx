"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { filterAndOrderPriceLines, priceLineStateLabels, summarizePriceLines, type PriceLineFilter, type PriceLineState } from "@/lib/products/supplier-price-lines";
import { useCoverageAccess } from "./supplier-coverage-popup";
import { supplierTemplatePriceLines, type PriceLinesResult } from "./supplier-price-lines-actions";

const money = (value: number | null, currency: string | null) => value === null ? "—" : `${currency ?? ""} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const badgeClass: Record<PriceLineState, string> = {
  same: "border-emerald-200 bg-emerald-50 text-emerald-900",
  changed: "border-amber-300 bg-amber-100 text-amber-950",
  needs_mapping: "border-red-300 bg-red-100 text-red-900",
  ambiguous: "border-red-200 bg-red-50 text-red-900",
  not_in_supplier_list: "border-zinc-300 bg-zinc-100 text-zinc-800",
  shared: "border-sky-200 bg-sky-50 text-sky-900",
};
const filters: Array<{ key: PriceLineFilter; label: string }> = [{ key: "all", label: "All" }, { key: "attention", label: "Needs attention" }, { key: "same", label: "Same" }];

function SourceLines({ source }: { source: PriceLinesResult["sources"][number] }) {
  const [filter, setFilter] = useState<PriceLineFilter>("all");
  const summary = summarizePriceLines(source.lines);
  const attention = summary.changed + summary.needsMapping + summary.other;
  const shown = filterAndOrderPriceLines(source.lines, filter);
  const counts: Record<PriceLineFilter, number> = { all: source.lines.length, attention, same: summary.same };
  const tiles = [
    { label: "Same", value: summary.same, tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
    { label: "Changed", value: summary.changed, tone: "border-amber-300 bg-amber-100 text-amber-950" },
    { label: "Needs mapping", value: summary.needsMapping, tone: "border-red-300 bg-red-100 text-red-900" },
    { label: "Other", value: summary.other, tone: "border-zinc-300 bg-zinc-100 text-zinc-800" },
  ];
  return (
    <section className="mb-8">
      <h4 className="text-sm font-semibold text-zinc-900">{source.definitionName} — {source.title}</h4>
      {source.effectiveFrom ? <p className="text-xs text-zinc-500">Price list valid from {source.effectiveFrom}</p> : null}
      {source.lines.length === 0 ? <p className="mt-3 text-sm text-zinc-600">This price list has no lines for this product.</p> : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => <div key={tile.label} className={`rounded-lg border px-3 py-2 ${tile.tone}`}><p className="text-xl font-bold leading-6">{tile.value}</p><p className="text-xs font-medium">{tile.label}</p></div>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show lines">
            {filters.map((item) => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === item.key ? "border-emerald-800 bg-emerald-800 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"}`}>{item.label} ({counts[item.key]})</button>)}
          </div>
          <div className="mt-3 max-h-[52vh] overflow-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-xs font-semibold text-zinc-700">
                <tr><th className="px-3 py-2">Model code</th><th className="px-3 py-2">Price name</th><th className="px-3 py-2 text-right">Your price</th><th className="px-3 py-2 text-right">Supplier price</th><th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 ? <tr><td colSpan={6} className="px-3 py-4 text-sm text-zinc-600">No lines in this view.</td></tr> : shown.map((line) => (
                  <tr key={line.key} className="border-t border-zinc-100 align-top">
                    <td className="px-3 py-2 font-semibold text-zinc-900">{line.code}</td>
                    <td className="px-3 py-2 text-zinc-600">{line.field || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(line.ourPrice, line.ourCurrency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(line.supplierPrice, line.supplierCurrency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${line.difference.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</td>
                    <td className="px-3 py-2"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${badgeClass[line.state]}`}>{priceLineStateLabels[line.state]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {source.truncated ? <p className="mt-2 text-xs text-amber-800">Only the first 500 lines are shown.</p> : null}
    </section>
  );
}

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
        <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-zinc-950/45 sm:items-center sm:px-4 sm:py-6" onClick={(event) => event.stopPropagation()}>
          <div role="dialog" aria-modal="true" aria-label="Supplier price lines" className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:w-[min(1180px,96vw)] sm:rounded-2xl sm:border sm:border-zinc-300">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4">
              <div><h3 className="text-base font-semibold text-zinc-950">Supplier price lines</h3><p className="text-sm text-zinc-600">{templateName}</p></div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-800 hover:border-zinc-500">Close</button>
            </div>
            <p className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-600 sm:px-6">Read only. Nothing is saved here.</p>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {loading ? <p className="text-sm text-zinc-500">Loading price lines… this can take a few seconds.</p> : null}
              {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
              {result && result.sources.length === 0 ? <p className="text-sm text-zinc-600">No current Supplier price list covers this product yet, so there is nothing to show.</p> : null}
              {result?.sources.map((source) => <SourceLines key={`${source.definitionName}|${source.title}`} source={source} />)}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
