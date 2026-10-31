"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { applySupplierReviewedPrice, confirmSupplierBindings, removeSupplierBinding, saveSupplierDecision, setSupplierTemplateFamilies } from "@/app/products/price-updates/supplier-sources/actions";
import { filterAndOrderPriceLines, priceLineStateLabels, summarizePriceLines, type PriceLine, type PriceLineFilter, type PriceLineState } from "@/lib/products/supplier-price-lines";
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

type Pending = { kind: "map" | "remove" | "apply" | "share"; line: PriceLine };

/** Plain-words confirm step. Nothing is saved until the confirm button is clicked. */
function ConfirmStep({ pending, busy, error, onCancel, onConfirm }: { pending: Pending; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const { line } = pending;
  const mapping = line.mapping;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/50 p-4" onClick={(event) => event.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-label={pending.kind === "map" ? "Map this line" : pending.kind === "share" ? "Map as shared" : pending.kind === "apply" ? "Use supplier price" : "Remove mapping"} className="w-[min(520px,96vw)] rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl">
        <h4 className="text-base font-semibold text-zinc-950">{pending.kind === "map" ? "Map this line" : pending.kind === "share" ? "Map as shared" : pending.kind === "apply" ? "Use supplier price" : "Remove this mapping"}</h4>
        {pending.kind === "share" && line.shared ? (() => {
          const shared = line.shared, count = shared.targets.length, noun = new Set(shared.targets.map((item) => item.templateId)).size === count ? "products" : "price lines";
          return <>
            <p className="mt-2 text-sm text-zinc-700">These {count} {noun} will use this supplier line together. Product prices and saved quotations do not change. You can remove this mapping later.</p>
            <ul className="mt-2 space-y-1 text-sm">{shared.targets.map((item) => <li key={item.key} className="rounded border border-zinc-100 px-2 py-1"><span className="font-semibold text-zinc-900">{item.templateName}</span> — {item.label || "price"} · {money(item.price, item.currency)}</li>)}</ul>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-zinc-500">Model code</dt><dd className="font-semibold text-zinc-900">{shared.code}</dd>
              <dt className="text-zinc-500">Supplier price</dt><dd className="font-semibold text-zinc-900">{money(line.supplierPrice, line.supplierCurrency)}</dd>
              <dt className="text-zinc-500">Result after saving</dt><dd><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${badgeClass[shared.preview]}`}>{priceLineStateLabels[shared.preview]}</span></dd>
            </dl>
          </>;
        })() : pending.kind === "apply" ? (
          <>
            <p className="mt-2 text-sm text-zinc-700">The product price will become the supplier price.</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-zinc-500">Model code</dt><dd className="font-semibold text-zinc-900">{line.code}</dd>
              <dt className="text-zinc-500">Price name</dt><dd className="font-semibold text-zinc-900">{line.field || "—"}</dd>
              <dt className="text-zinc-500">Your price now</dt><dd className="font-semibold text-zinc-900">{money(line.ourPrice, line.ourCurrency)}</dd>
              <dt className="text-zinc-500">Supplier price</dt><dd className="font-semibold text-zinc-900">{money(line.supplierPrice, line.supplierCurrency)}</dd>
              <dt className="text-zinc-500">Difference</dt><dd className="font-semibold text-zinc-900">{line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${line.difference.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</dd>
            </dl>
          </>
        ) : pending.kind === "map" && mapping ? (
          <>
            <p className="mt-2 text-sm text-zinc-700">The supplier gives this price a tier name. Your product has one price only. Saving tells the system: this tier is your price.</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-zinc-500">Model code</dt><dd className="font-semibold text-zinc-900">{mapping.code}</dd>
              <dt className="text-zinc-500">Supplier tier name</dt><dd className="font-semibold text-zinc-900">{mapping.tierLabel || "—"}</dd>
              <dt className="text-zinc-500">Supplier price</dt><dd className="font-semibold text-zinc-900">{money(line.supplierPrice, line.supplierCurrency)}</dd>
              <dt className="text-zinc-500">Your price it will point to</dt><dd className="font-semibold text-zinc-900">{money(mapping.targetPrice, mapping.targetCurrency)}</dd>
              <dt className="text-zinc-500">Result after saving</dt><dd><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${badgeClass[mapping.preview]}`}>{priceLineStateLabels[mapping.preview]}</span></dd>
            </dl>
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-700">Code {line.code} will need mapping again. Prices are not changed.</p>
        )}
        <p role="note" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-950">{pending.kind === "map" || pending.kind === "share" ? "This is saved for the whole brand and for future price lists." : pending.kind === "apply" ? "This changes the product price. Saved quotations do not change. The old price stays in the price history. There is no undo button; a price can be set back by hand." : "This is removed for the whole brand and for future price lists."}</p>
        {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700">Cancel</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="rounded-md bg-emerald-800 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : pending.kind === "map" ? "Save mapping" : pending.kind === "share" ? "Save shared mapping" : pending.kind === "apply" ? "Use supplier price" : "Remove mapping"}</button>
        </div>
      </div>
    </div>
  );
}

type Source = PriceLinesResult["sources"][number];
const searchFrom = 15;

/**
 * Which Supplier family or families this product belongs to, inside the popup. Only for price lists that have families.
 * Nothing is saved until "Save family" is pressed; one save call, then the lines reload.
 */
function FamilyBar({ source, templateId, onDone }: { source: Source; templateId: string; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false), [picked, setPicked] = useState<string[]>([]), [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!source.families.length) return null;
  const openPanel = () => {
    const inList = new Set(source.families.map((item) => item.key));
    const saved = source.chosen.filter((item) => inList.has(item.key)).map((item) => item.key);
    // One family is selected for the user only when the list has exactly one. Otherwise they choose; nothing is guessed.
    setPicked(saved.length ? saved : source.families.length === 1 ? [source.families[0].key] : []); setQuery(""); setError(""); setOpen(true);
  };
  const toggle = (key: string, on: boolean) => setPicked((current) => on ? [...current.filter((item) => item !== key), key] : current.filter((item) => item !== key));
  const visible = source.families.length > searchFrom && query.trim() ? source.families.filter((item) => item.family.toLowerCase().includes(query.trim().toLowerCase())) : source.families;
  const save = async () => {
    if (busy || !picked.length) return;
    setBusy(true); setError("");
    try {
      const names = source.families.filter((item) => picked.includes(item.key)).map((item) => item.family);
      await setSupplierTemplateFamilies(source.definitionId, templateId, names);
      onDone(`Family saved: ${names.join(", ")}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the family. Nothing was changed."); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm" aria-label="Supplier family">
      {source.missing.map((item) => <p key={item.key} role="alert" className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-950">This family is not in the new price list: {item.family}. Choose again.</p>)}
      <div className="flex flex-wrap items-center gap-2">
        {source.chosen.length === 0
          ? <span className="text-zinc-800">No family chosen for this product. Choose a family to compare prices.</span>
          : <><span className="text-xs font-semibold text-zinc-600">Family:</span>{source.chosen.map((item) => <span key={item.key} className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-900">{item.family}</span>)}</>}
        {!open ? <button type="button" onClick={openPanel} className="rounded-md border border-emerald-700 bg-white px-3 py-1 text-xs font-semibold text-emerald-900">{source.chosen.length === 0 ? "Choose family" : "Change"}</button> : null}
      </div>
      {open ? <div className="mt-3 space-y-2">
        <p className="text-xs text-zinc-700">Choose one family. Choose more only if this product really mixes parts from more than one family.</p>
        {source.families.length > searchFrom ? <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search families" aria-label="Search families" className="h-8 w-full max-w-xs rounded-md border border-zinc-300 px-2 text-sm" /> : null}
        <ul className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">{visible.map((item) => <li key={item.key}><label className="flex items-center gap-2 rounded border border-zinc-100 bg-white px-2 py-1"><input type="checkbox" className="accent-emerald-900" checked={picked.includes(item.key)} onChange={(event) => toggle(item.key, event.target.checked)} />{item.family}</label></li>)}</ul>
        {visible.length === 0 ? <p className="text-xs text-zinc-600">No family matches your search.</p> : null}
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">{error}</p> : null}
        <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700">Cancel</button>
          <button type="button" disabled={busy || !picked.length} onClick={() => void save()} className="rounded-md bg-emerald-800 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save family"}</button></div>
      </div> : null}
    </div>
  );
}

function SourceLines({ source, brandId, templateId, onDone }: { source: Source; brandId: string; templateId: string; onDone: (message: string) => void }) {
  const [filter, setFilter] = useState<PriceLineFilter>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasActions = source.lines.some((line) => line.mapping || line.shared || line.binding || line.apply || line.applyHint || line.familyHint);
  // Writes happen only here, from the confirm button. Each uses the existing Price Updates action (role re-checked on the server).
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      if (pending.kind === "map" && pending.line.mapping) {
        const mapping = pending.line.mapping;
        await confirmSupplierBindings(brandId, [{ code: mapping.code, price_field: mapping.priceField, source_dimension: mapping.sourceDimension, kind: "alias", target_keys: [mapping.targetKey], expected_targets: [{ key: mapping.targetKey, pricing_version: mapping.pricingVersion, price: mapping.targetPrice, currency: mapping.targetCurrency }] }]);
        onDone(`Mapping saved for code ${mapping.code}.`);
      } else if (pending.kind === "share" && pending.line.shared) {
        const shared = pending.line.shared;
        await confirmSupplierBindings(brandId, [{ code: shared.code, price_field: shared.priceField, source_dimension: shared.sourceDimension, kind: "shared", target_keys: shared.targets.map((item) => item.key), expected_targets: shared.targets.map((item) => ({ key: item.key, pricing_version: item.pricingVersion, price: item.price, currency: item.currency })) }]);
        onDone(`Shared mapping saved for code ${shared.code}.`);
      } else if (pending.kind === "apply" && pending.line.apply?.batchId) {
        const { batchId, matchKey } = pending.line.apply;
        // The review mark first, then the price: the existing review code needs both, in this order.
        await saveSupplierDecision(batchId, matchKey, "reviewed", "");
        try { await applySupplierReviewedPrice(batchId, matchKey); }
        catch (reason) { throw Error(`${reason instanceof Error ? reason.message : "Something went wrong."} The product price was not changed.`); }
        onDone(`Product price changed for code ${pending.line.code}.`);
      } else if (pending.kind === "remove" && pending.line.binding) {
        await removeSupplierBinding(brandId, pending.line.binding.id);
        onDone(`Mapping removed for code ${pending.line.code}.`);
      }
      setPending(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save. Nothing was changed.");
    } finally { setBusy(false); }
  };
  const summary = summarizePriceLines(source.lines);
  const attention = summary.changed + summary.needsMapping + summary.other;
  const shown = filterAndOrderPriceLines(source.lines, filter);
  const counts: Record<PriceLineFilter, number> = { all: source.lines.length, attention, same: summary.same };
  const tiles = [
    { label: "Same", value: summary.same, tone: "border-emerald-200 bg-emerald-50 text-emerald-900", note: summary.shared ? `includes ${summary.shared} shared` : "" },
    { label: "Changed", value: summary.changed, tone: "border-amber-300 bg-amber-100 text-amber-950", note: "" },
    { label: "Needs mapping", value: summary.needsMapping, tone: "border-red-300 bg-red-100 text-red-900", note: "" },
    { label: "Other", value: summary.other, tone: "border-zinc-300 bg-zinc-100 text-zinc-800", note: "" },
  ];
  return (
    <section className="mb-8">
      <h4 className="text-sm font-semibold text-zinc-900">{source.definitionName} — {source.title}</h4>
      {source.effectiveFrom ? <p className="text-xs text-zinc-500">Price list valid from {source.effectiveFrom}</p> : null}
      <FamilyBar source={source} templateId={templateId} onDone={onDone} />
      {source.lines.length === 0 ? <p className="mt-3 text-sm text-zinc-600">This price list has no lines for this product.</p> : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => <div key={tile.label} className={`rounded-lg border px-3 py-2 ${tile.tone}`}><p className="text-xl font-bold leading-6">{tile.value}</p><p className="text-xs font-medium">{tile.label}</p>{tile.note ? <p className="text-[11px] text-zinc-500">{tile.note}</p> : null}</div>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show lines">
            {filters.map((item) => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === item.key ? "border-emerald-800 bg-emerald-800 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500"}`}>{item.label} ({counts[item.key]})</button>)}
          </div>
          <div className="mt-3 max-h-[52vh] overflow-auto rounded-lg border border-zinc-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-xs font-semibold text-zinc-700">
                <tr><th className="px-3 py-2">Model code</th><th className="px-3 py-2">Price name</th><th className="px-3 py-2 text-right">Your price</th><th className="px-3 py-2 text-right">Supplier price</th><th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2">Status</th>{hasActions ? <th className="px-3 py-2">Action</th> : null}</tr>
              </thead>
              <tbody>
                {shown.length === 0 ? <tr><td colSpan={hasActions ? 7 : 6} className="px-3 py-4 text-sm text-zinc-600">No lines in this view.</td></tr> : shown.map((line) => (
                  <tr key={line.key} className="border-t border-zinc-100 align-top">
                    <td className="px-3 py-2 font-semibold text-zinc-900">{line.code}</td>
                    <td className="px-3 py-2 text-zinc-600">{line.field || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(line.ourPrice, line.ourCurrency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(line.supplierPrice, line.supplierCurrency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${line.difference.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}</td>
                    <td className="px-3 py-2"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${badgeClass[line.state]}`}>{priceLineStateLabels[line.state]}</span></td>
                    {hasActions ? <td className="px-3 py-2">
                      {line.mapping ? <button type="button" onClick={() => { setError(""); setPending({ kind: "map", line }); }} className="whitespace-nowrap text-xs font-semibold text-emerald-800 underline">Map this line</button> : null}
                      {line.familyHint === "choose_family" ? <span className="block max-w-48 text-xs text-zinc-600">Choose a family first.</span> : null}
                      {line.shared ? <button type="button" onClick={() => { setError(""); setPending({ kind: "share", line }); }} className="whitespace-nowrap text-xs font-semibold text-emerald-800 underline">Map as shared</button> : null}
                      {line.apply?.batchId ? <button type="button" onClick={() => { setError(""); setPending({ kind: "apply", line }); }} className="whitespace-nowrap text-xs font-semibold text-emerald-800 underline">Use supplier price</button> : null}
                      {line.apply && !line.apply.batchId ? <span className="block max-w-48 text-xs text-zinc-600">Start the review for this price list first.</span> : null}
                      {line.applyHint === "set_by_hand" ? <span className="block max-w-48 text-xs text-zinc-600">This price is empty. Set it by hand in Edit Template.</span> : null}
                      {line.applyHint === "old_review" ? <span className="block max-w-48 text-xs text-zinc-600">The review is out of date. Start a new review for this price list.</span> : null}
                      {line.binding ? <button type="button" onClick={() => { setError(""); setPending({ kind: "remove", line }); }} className="whitespace-nowrap text-xs font-semibold text-red-800 underline">Remove mapping</button> : null}
                    </td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {pending ? <ConfirmStep pending={pending} busy={busy} error={error} onCancel={() => { setPending(null); setError(""); }} onConfirm={() => void confirm()} /> : null}
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
  const [notice, setNotice] = useState("");
  if (allowed !== true) return null;

  const load = (message = "") => {
    setOpen(true); setError(""); setResult(null); setLoading(true); setNotice(message);
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
              {notice ? <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">{notice}</p> : null}
              {result?.sources.map((source) => <SourceLines key={`${source.definitionName}|${source.title}`} source={source} brandId={result.brandId} templateId={templateId} onDone={load} />)}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
