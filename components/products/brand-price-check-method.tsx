"use client";

import { useState } from "react";
import type { PriceCheckMode } from "@/lib/products/manual-price-check";

export const PRICE_CHECK_MODE_FIELD = "price_check_mode";
export const priceCheckModeLabel = (mode: PriceCheckMode) => mode === "manual" ? "Manual" : "Codes";
export const SUPPLIER_LISTS_WARNING = "This brand already has supplier price lists. Manual checks will replace them for status badges.";
const options: Array<{ mode: PriceCheckMode; title: string; text: string }> = [
  { mode: "supplier_codes", title: "Supplier price list with codes", text: "Prices are checked against uploaded supplier price lists, using product codes." },
  { mode: "manual", title: "Manual, for brands without codes", text: "A person checks each product's prices when a new price list is released." },
];

/** The warning shows only when switching to Manual on a brand that already has supplier price lists. It never blocks saving. */
export const showSupplierListsWarning = (selected: PriceCheckMode, current: PriceCheckMode, hasSupplierLists: boolean) => selected === "manual" && current !== "manual" && hasSupplierLists;

/** Small label on a Brand card. */
export function PriceCheckModeLabel({ mode }: { mode: PriceCheckMode }) {
  return <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-500" title="Price check method">{priceCheckModeLabel(mode)}</span>;
}

/**
 * "Price check method" choice inside the Edit brand form. People who cannot approve brand prices see it read only
 * (nothing is submitted). The database function checks the permission again on save.
 */
export function BrandPriceCheckMethodField({ currentMode, canChange, hasSupplierLists }: { currentMode: PriceCheckMode; canChange: boolean; hasSupplierLists: boolean }) {
  const [selected, setSelected] = useState<PriceCheckMode>(currentMode);
  if (!canChange) {
    const current = options.find((option) => option.mode === currentMode)!;
    return <fieldset className="grid gap-1 md:col-span-2"><legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Price check method</legend>
      <p className="text-sm font-semibold text-zinc-900">{current.title}</p><p className="text-xs text-zinc-600">{current.text}</p>
      <p className="text-xs text-zinc-500">Only people who approve brand prices can change this.</p></fieldset>;
  }
  return <fieldset className="grid gap-2 md:col-span-2"><legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Price check method</legend>
    {options.map((option) => <label key={option.mode} className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white p-2 text-sm">
      <input type="radio" name={PRICE_CHECK_MODE_FIELD} value={option.mode} checked={selected === option.mode} onChange={() => setSelected(option.mode)} className="mt-1" />
      <span><span className="block font-semibold text-zinc-900">{option.title}</span><span className="block text-xs text-zinc-600">{option.text}</span></span></label>)}
    {showSupplierListsWarning(selected, currentMode, hasSupplierLists) ? <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{SUPPLIER_LISTS_WARNING}</p> : null}
  </fieldset>;
}
