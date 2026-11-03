"use client";

import { useState } from "react";
import { markManualPriceCheckedAction } from "@/components/products/manual-price-check-actions";
import type { SupplierFamilyStatusPresentation } from "@/lib/products/supplier-family-status";
import { useCoverageAccess } from "./supplier-coverage-popup";
import { supplierTemplateStatusPresentation } from "./supplier-template-status-actions";

/**
 * "Mark as price checked" for one product of a manual price check Brand. The server picks the latest released price list and
 * refuses if the product changed meanwhile. Shown only to roles that may approve Brand prices; the badge is refreshed in place.
 */
export function ManualPriceCheckAction({ templateId, onSupplierStatus }: { templateId: string; onSupplierStatus?: (templateId: string, presentation: SupplierFamilyStatusPresentation | null) => void }) {
  const allowed = useCoverageAccess();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (allowed !== true) return null;
  const mark = async () => {
    setBusy(true); setMessage("");
    try {
      await markManualPriceCheckedAction(templateId);
      try { onSupplierStatus?.(templateId, await supplierTemplateStatusPresentation(templateId)); } catch { setMessage("Marked as checked. Reload the page to update the badge."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not mark as checked."); }
    finally { setBusy(false); }
  };
  return <span className="mt-1 grid gap-1">
    <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); void mark(); }} className="inline-flex max-w-full items-center justify-center justify-self-start rounded-md border border-emerald-700 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:opacity-50">{busy ? "Saving…" : "Mark as price checked"}</button>
    {message ? <span role="status" className="text-[11px] font-medium text-zinc-600">{message}</span> : null}
  </span>;
}
