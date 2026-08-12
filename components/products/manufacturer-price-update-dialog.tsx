"use client";

import { useMemo, useState } from "react";
import { compareManufacturerUpdate, type ManufacturerPriceDifference, type ManufacturerUpdateDiff, type ManufacturerUpdateWorkspace } from "@/lib/products/manufacturer-update-diff";
import { manufacturerPricePatchKey } from "@/lib/products/manufacturer-price-patches";
import { defaultManufacturerPriceSelection, formatManufacturerPrice, manufacturerReviewContext, manufacturerReviewTitle, manufacturerSelectablePriceFields, selectedManufacturerPricePatches } from "@/lib/products/manufacturer-price-review";
import { parseSmartProductJsonImport, type SmartProductJsonImportResult } from "@/lib/products/smart-product-json-import";

type ApplyResult = { ok: true } | { ok: false; message: string };

const sectionClass = "rounded-lg border border-zinc-200 bg-white p-4";
const priceFieldLabel = (field: ManufacturerPriceDifference["field"]) => field === "default_price" ? "Default Price" : field === "additional_price" ? "Additional Price" : "Price";

function validationMessage(result: SmartProductJsonImportResult | null) {
  if (!result || result.kind === "valid") return null;
  if (result.kind === "validation") return result.validation.errors.map((issue) => `${issue.path}: ${issue.message}`).join(" ");
  return result.message;
}

function countFields(diff: ManufacturerUpdateDiff) {
  const counts = new Map<string, number>();
  Object.values(diff.sections).flatMap((section) => section.matchedItems).flatMap((item) => item.nonPriceDifferences).forEach((item) => counts.set(item.field, (counts.get(item.field) ?? 0) + 1));
  return [...counts.entries()];
}

export function ManufacturerPriceUpdateDialog({ current, onApply, onClose }: { current: ManufacturerUpdateWorkspace; onApply: (patches: ManufacturerPriceDifference[]) => ApplyResult; onClose: () => void }) {
  const [rawJson, setRawJson] = useState("");
  const [result, setResult] = useState<SmartProductJsonImportResult | null>(null);
  const [diff, setDiff] = useState<ManufacturerUpdateDiff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState("");
  const selectable = useMemo(() => diff ? manufacturerSelectablePriceFields(diff) : [], [diff]);
  const changedRows = useMemo(() => diff ? Object.values(diff.sections).flatMap((section) => section.matchedItems).flatMap((item) => item.priceFields.filter((field) => field.priceChanged).map((field) => ({ item, field }))) : [], [diff]);
  const validate = () => {
    const next = parseSmartProductJsonImport(rawJson); setResult(next); setApplyError("");
    if (next.kind !== "valid" || !next.validation.draft) { setDiff(null); setSelected(new Set()); return; }
    const comparison = compareManufacturerUpdate(current, next.validation.draft);
    setDiff(comparison);
    setSelected(defaultManufacturerPriceSelection(comparison));
  };
  const apply = () => {
    const patches = diff ? selectedManufacturerPricePatches(diff, selected) : [];
    const response = onApply(patches);
    if (!response.ok) { setApplyError(response.message); return; }
    onClose();
  };
  return <div role="dialog" aria-modal="true" aria-label="Manufacturer Prices Only update" className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/50 p-3 sm:p-4">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-zinc-50 shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 bg-white p-5"><div><h2 className="text-lg font-semibold">Manufacturer Price Update</h2><p className="mt-1 text-xs text-zinc-500">Scope: Prices Only · Nothing is saved automatically.</p></div><button type="button" onClick={onClose} className="text-sm font-semibold text-zinc-700">Cancel</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!diff ? <><textarea value={rawJson} onChange={(event) => { setRawJson(event.target.value); setResult(null); setApplyError(""); }} aria-label="Manufacturer price update JSON" className="min-h-72 w-full rounded-md border border-zinc-300 bg-white p-3 font-mono text-xs" />{validationMessage(result) ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{validationMessage(result)}</p> : null}<button type="button" onClick={validate} className="mt-3 rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white">Validate and Compare</button></> : <div className="space-y-3">
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><p className="font-semibold">Prices Only comparison</p><p className="mt-1 text-xs">{diff.summary.changedPriceFields} price changes · {diff.summary.unchangedPriceFields} unchanged · {diff.summary.newCandidates} new items · {diff.summary.notFoundInImportedSource} not found in imported source · {diff.summary.ambiguousMatches} ambiguous · {diff.summary.nonPriceDifferences} non-price differences ignored</p></section>
          <details className={sectionClass}><summary className="cursor-pointer text-sm font-semibold">Price Changes — {changedRows.length}</summary><div className="mt-3 flex gap-2"><button type="button" onClick={() => setSelected(new Set(selectable.map(manufacturerPricePatchKey)))} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold">Select all price changes</button><button type="button" onClick={() => setSelected(new Set())} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold">Clear all</button></div><div className="mt-3 space-y-2">{changedRows.map(({ item, field }) => { const key = manufacturerPricePatchKey(field); const supported = !field.currencyChanged; return <label key={key} className={`flex items-start gap-3 rounded-md border p-3 ${supported ? "border-zinc-200" : "border-amber-200 bg-amber-50"}`}><input type="checkbox" checked={supported && selected.has(key)} disabled={!supported} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} /><span className="min-w-0"><span className="block text-xs font-semibold">{manufacturerReviewTitle(item.existing.supplierCode ?? item.incoming.referenceCode, item.existing.displayName)}</span><span className="block text-xs text-zinc-500">{manufacturerReviewContext(item.existing.groupName, item.existing.subgroupName, field.columnLabel ?? priceFieldLabel(field.field))}</span><span className="mt-1 block text-sm">{formatManufacturerPrice(field.currentValue, field.currentCurrency)} → {formatManufacturerPrice(field.incomingValue, field.incomingCurrency)}</span>{field.currencyChanged ? <span className="mt-1 block text-xs font-semibold text-amber-800">Currency differs; cannot apply automatically in Prices Only.</span> : null}</span></label>; })}{!changedRows.length ? <p className="text-sm text-zinc-500">No numeric price changes detected.</p> : null}</div></details>
          <details className={sectionClass}><summary className="cursor-pointer text-sm font-semibold">New Items — {diff.summary.newCandidates}</summary><div className="mt-3 space-y-2">{Object.values(diff.sections).flatMap((section) => section.newCandidates).map((item) => <p key={`${item.pricingType}-${item.incoming.routeKey}-${item.incoming.rowId}`} className="text-xs"><span className="font-semibold">{manufacturerReviewTitle(item.incoming.supplierCode ?? item.incoming.referenceCode, item.incoming.displayName)}</span><br />New item detected — use the Import / Add Data workflow to add this item.</p>)}</div></details>
          <details className={sectionClass}><summary className="cursor-pointer text-sm font-semibold">Not Found in Imported Source — {diff.summary.notFoundInImportedSource}</summary><div className="mt-3 space-y-1">{Object.values(diff.sections).flatMap((section) => section.notFoundInImportedSource).map((item) => <p key={`${item.existing.pricingType}-${item.existing.groupId}-${item.existing.rowId}`} className="text-xs">{manufacturerReviewTitle(item.supplierCode, item.displayName)} — no change</p>)}</div></details>
          <details className={sectionClass}><summary className="cursor-pointer text-sm font-semibold">Ambiguous Matches — {diff.summary.ambiguousMatches}</summary><div className="mt-3 space-y-2">{Object.values(diff.sections).flatMap((section) => section.ambiguousMatches).map((item) => <p key={`${item.pricingType}-${item.incoming.routeKey}-${item.incoming.rowId}`} className="text-xs"><span className="font-semibold">{manufacturerReviewTitle(item.incoming.supplierCode ?? item.matchingValue, item.incoming.displayName)}</span><br />Cannot update automatically. Possible matches: {item.candidates.map((candidate) => manufacturerReviewTitle(candidate.supplierCode, candidate.displayName)).join(", ")}.</p>)}</div></details>
          <details className={sectionClass}><summary className="cursor-pointer text-sm font-semibold">Other Differences Ignored — {diff.summary.nonPriceDifferences + diff.summary.structuralDifferences}</summary><div className="mt-3 space-y-1 text-xs">{countFields(diff).map(([field, count]) => <p key={field}>{count} {field} difference{count === 1 ? "" : "s"}</p>)}{Object.values(diff.sections).flatMap((section) => section.structuralDifferences).map((item, index) => <p key={`${item.pricingType}-${item.incomingGroupId}-${index}`} className="text-amber-800">Structural difference: {item.detail} Manual review required.</p>)}{diff.deferredSections.map((item) => <p key={item.section}>{item.count} material suggestion{item.count === 1 ? "" : "s"} deferred.</p>)}</div></details>
        </div>}
      </div>
      {diff ? <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-white p-4"><div><p className="text-xs text-zinc-600">{selected.size} selected · normal Save Template/Add Template is still required.</p>{applyError ? <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{applyError}</p> : null}</div><div className="flex gap-2"><button type="button" onClick={() => { setDiff(null); setResult(null); setSelected(new Set()); setApplyError(""); }} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold">Back</button><button type="button" disabled={!selected.size} onClick={apply} className="rounded-md bg-emerald-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Apply Selected Prices ({selected.size})</button></div></div> : null}
    </div>
  </div>;
}
