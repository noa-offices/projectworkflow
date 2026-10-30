"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { assignFamilyToSupplierSource } from "@/app/products/price-updates/supplier-sources/actions";
import { canConfirmCoverage, coverageChoices, type CoverageChoice } from "@/lib/products/supplier-coverage-popup";
import { supplierCoverageDefinitions, supplierCoveragePopupAccess } from "./supplier-coverage-popup-actions";

// One role check per page load, shared by every badge. A failed check reads as "not allowed".
let accessPromise: Promise<boolean> | null = null;
export function useCoverageAccess() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    accessPromise ??= supplierCoveragePopupAccess().catch(() => false);
    void accessPromise.then((value) => { if (!cancelled) setAllowed(value); });
    return () => { cancelled = true; };
  }, []);
  return allowed;
}

/**
 * "Not covered" action for one Product. Allowed roles get a popup that adds this Product to a Supplier price list;
 * everyone else gets a read-only note. It never navigates, so unsaved quotation edits stay untouched.
 */
export function SupplierCoverageAction({ brandId, templateId, templateName, detail }: { brandId: string; templateId: string; templateName: string; detail: string }) {
  const allowed = useCoverageAccess();
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<CoverageChoice[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addedTo, setAddedTo] = useState("");

  useEffect(() => {
    if (!open || choices) return;
    let cancelled = false;
    void supplierCoverageDefinitions(brandId)
      .then((definitions) => { if (!cancelled) setChoices(coverageChoices(definitions)); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the Supplier price lists."); });
    return () => { cancelled = true; };
  }, [open, choices, brandId]);

  if (addedTo) {
    return <span className="block text-[11px] font-medium text-emerald-800">Added to {addedTo}. Reload the page to see its updated price status.</span>;
  }
  if (allowed !== true) {
    return <span className="block text-[11px] font-medium text-zinc-500">{allowed === false ? "Ask a Supplier price manager to add this product to a Supplier price list." : detail}</span>;
  }

  const confirm = async () => {
    const choice = choices?.find((item) => item.id === selectedId);
    if (!choice || busy) return;
    setBusy(true); setError("");
    try {
      await assignFamilyToSupplierSource(choice.id, templateId);
      setAddedTo(choice.name); setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this product.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={(event) => { event.stopPropagation(); setOpen(true); }} className="block text-left text-[11px] font-medium text-emerald-800 underline">{detail}</button>
      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/45 px-4" onClick={(event) => event.stopPropagation()}>
          <div role="dialog" aria-modal="true" aria-label="Add to Supplier price list" className="w-[min(440px,96vw)] rounded-2xl border border-zinc-300 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-950">Add to a Supplier price list</h3>
            <p className="mt-1 text-xs text-zinc-600">{templateName} is not covered by any Supplier price list. Choose the list that prices it.</p>
            <div className="mt-3 grid gap-2">
              {choices === null && !error ? <p className="text-xs text-zinc-500">Loading Supplier price lists…</p> : null}
              {choices?.length === 0 ? <p className="text-xs text-zinc-600">This brand has no active Supplier price list. Create one in Price Updates first.</p> : null}
              {choices?.map((choice) => (
                <label key={choice.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs ${selectedId === choice.id ? "border-emerald-700 bg-emerald-50" : "border-zinc-200"}`}>
                  <input type="radio" name={`coverage-${templateId}`} checked={selectedId === choice.id} onChange={() => setSelectedId(choice.id)} className="mt-0.5" />
                  <span><span className="block font-semibold text-zinc-900">{choice.name}</span><span className="block text-zinc-500">{choice.detail}</span></span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-zinc-500">This only adds the product to the list. Its prices are not marked checked until the list is reviewed.</p>
            {error ? <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-900">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700">Cancel</button>
              <button type="button" disabled={!canConfirmCoverage(choices ?? [], selectedId, busy)} onClick={() => void confirm()} className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Adding…" : "Add to price list"}</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
