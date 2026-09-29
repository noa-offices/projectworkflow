"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { VendorControlsPanel } from "./vendor-controls-panel";
import { generatePoAction } from "@/lib/procurement/generate-po-action";
import type { VendorDocRecord } from "@/lib/procurement/vendor-docs-action";
import { vendorStepLabel, vendorReceivingStatusLabel, type VendorReceivingStatus } from "@/lib/procurement/vendor-steps";

const DOC_SLOT_KEYS = ["pi", "oc", "bl"] as const;

function formatShortDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(value));
}

export type VendorCardItem = {
  id: string;
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  brand_name_snapshot: string | null;
  size_snapshot: string | null;
  finish_snapshot: string | null;
  qty: number;
  net_total: number | null;
};

export type VendorCardProps = {
  vendorKey: string;
  displayLabel: string;
  displayType: string;
  items: VendorCardItem[];
  totalValue: number;
  currency: string;
  quotationId: string;
  orderNo: string;
  canGenerateDocs: boolean;
  initialPoNumber?: string;
  initialDocs?: VendorDocRecord[];
  initialStep?: number;
  initialEtd?: string;
  initialEta?: string;
  initialSupplierConfirmedAt?: string | null;
  initialReceivingStatus?: VendorReceivingStatus;
  initialReceivedAt?: string | null;
};

export function VendorCard({
  vendorKey,
  displayLabel,
  displayType,
  items,
  totalValue,
  currency,
  quotationId,
  orderNo,
  canGenerateDocs,
  initialPoNumber,
  initialDocs,
  initialStep,
  initialEtd,
  initialEta,
  initialSupplierConfirmedAt,
  initialReceivingStatus,
  initialReceivedAt,
}: VendorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [poNumber, setPoNumber] = useState<string | null>(initialPoNumber ?? null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  async function handleGeneratePo() {
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const result = await generatePoAction(orderNo, quotationId, vendorKey, displayLabel, items);
      if (result.ok) {
        setPoNumber(result.poNumber);
      } else {
        setGenerateError(result.error);
      }
    } catch {
      setGenerateError("An unexpected error occurred. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  const totalQty = items.reduce((sum, row) => sum + row.qty, 0);
  const formattedTotal = new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: currency || "AED",
    minimumFractionDigits: 2,
  }).format(totalValue);

  // Presence-only summary for the scan header — never a required/optional judgement.
  const uploadedSlotKeys = new Set((initialDocs ?? []).map((doc) => doc.slot_key));
  const docsPresentCount = DOC_SLOT_KEYS.filter((key) => uploadedSlotKeys.has(key)).length;
  const stageLabel = vendorStepLabel(initialStep ?? 0);
  const receivingStatus: VendorReceivingStatus = initialReceivingStatus ?? "pending";
  const etdLabel = initialEtd ? formatShortDate(initialEtd) : "—";
  const etaLabel = initialEta ? formatShortDate(initialEta) : "—";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-stretch justify-between gap-3 border-b border-zinc-100 px-3 py-3 xl:flex-row xl:flex-wrap xl:items-center xl:px-5 xl:py-4">

        {/* Avatar + name + badges */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-base font-bold text-violet-700">
            {displayLabel.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-zinc-950">{displayLabel}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-zinc-400">{displayType}</span>
              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                {items.length} item{items.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Scan row — key procurement state visible without expanding anything */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                {stageLabel}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  initialSupplierConfirmedAt
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {initialSupplierConfirmedAt ? "Confirmed" : "Not confirmed"}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  receivingStatus === "received"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                Receiving: {vendorReceivingStatusLabel(receivingStatus)}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  etdLabel === "—" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-zinc-200 bg-zinc-50 text-zinc-600"
                }`}
              >
                ETD {etdLabel}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  etaLabel === "—" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-zinc-200 bg-zinc-50 text-zinc-600"
                }`}
              >
                ETA {etaLabel}
              </span>
              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                Docs {docsPresentCount}/{DOC_SLOT_KEYS.length}
              </span>
            </div>
          </div>
        </div>

        {/* Total value pill + action buttons + toggle */}
        <div className="grid min-w-0 grid-cols-2 items-center gap-2 xl:flex xl:flex-wrap">
          <span className="col-span-2 inline-flex min-w-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900 xl:col-span-1">
            {formattedTotal}
          </span>

          {canGenerateDocs ? (
            <>
              <Link
                href={`/quotations/${quotationId}/procurement-rfq`}
                className="inline-flex h-10 min-w-0 items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 xl:h-8 xl:px-3"
              >
                RFQ →
              </Link>
              <Link
                href={`/quotations/${quotationId}/delivery-note`}
                className="inline-flex h-10 min-w-0 items-center justify-center rounded-md border border-zinc-200 px-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 xl:h-8 xl:px-3"
              >
                Delivery Note →
              </Link>
              {poNumber ? (
                <Link
                  href={`/quotations/${quotationId}/purchase-order`}
                  className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 xl:h-8 xl:rounded-full xl:px-3"
                >
                  📄 {poNumber}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={handleGeneratePo}
                  className="inline-flex h-10 min-w-0 items-center justify-center rounded-md bg-emerald-900 px-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 xl:h-8 xl:px-3"
                >
                  {isGenerating ? "Generating…" : "Generate PO →"}
                </button>
              )}
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="col-span-2 inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 xl:col-span-1 xl:h-8"
          >
            {expanded ? (
              <>Hide Items <ChevronUp className="h-3.5 w-3.5" /></>
            ) : (
              <>📦 View Items ({items.length}) <ChevronDown className="h-3.5 w-3.5" /></>
            )}
          </button>
        </div>
      </div>

      {generateError ? (
        <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs font-medium text-red-700">
          {generateError}
        </p>
      ) : null}

      {/* ── Body ───────────────────────────────────────────────── */}
      {expanded ? (
        /* EXPANDED: two-column grid — table left, controls right on xl;
           table then controls stacked on mobile */
        <div className="grid xl:grid-cols-[1fr_280px]">

          {/* Table — left col on xl, full-width on mobile */}
          <div className="min-w-0 xl:border-r xl:border-zinc-100">
            <div className="min-w-0 xl:hidden">
              {items.map((row, index) => (
                <div key={row.id} className="grid min-h-14 min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] gap-2 border-b border-zinc-100 px-3 py-2 last:border-0">
                  <span className="pt-0.5 text-xs font-semibold text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-sm font-medium text-zinc-800">{row.item_name_snapshot ?? row.brand_name_snapshot ?? "Item"}</span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500" title={row.item_code_snapshot ?? undefined}>{row.item_code_snapshot ?? "No code"}</span>
                  </span>
                  <span className="whitespace-nowrap text-right text-xs font-semibold text-zinc-700">Qty {row.qty}</span>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2 text-left">#</th>
                  <th className="px-4 py-2 text-left">Item</th>
                  <th className="px-4 py-2 text-left">Code</th>
                  <th className="px-4 py-2 text-left">Size / Finish</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Net Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((row, index) => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-2 text-zinc-400">{String(index + 1).padStart(2, "0")}</td>
                    <td className="px-4 py-2 font-medium text-zinc-800">
                      {row.item_name_snapshot ?? row.brand_name_snapshot ?? "Item"}
                    </td>
                    <td className="px-4 py-2 text-zinc-500">{row.item_code_snapshot ?? "-"}</td>
                    <td className="px-4 py-2 text-zinc-500">
                      {[row.size_snapshot, row.finish_snapshot].filter(Boolean).join(" / ") || "-"}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-800">{row.qty}</td>
                    <td className="px-4 py-2 text-right font-semibold text-zinc-950">
                      {typeof row.net_total === "number"
                        ? new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2 }).format(row.net_total)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-zinc-200 bg-zinc-50">
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-zinc-500">
                    Subtotal
                  </td>
                  <td className="px-4 py-2 text-right text-xs font-semibold text-zinc-800">
                    {totalQty}
                  </td>
                  <td className="px-4 py-2 text-right text-xs font-semibold text-zinc-950">
                    {new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2 }).format(totalValue)}
                  </td>
                </tr>
              </tfoot>
              </table>
            </div>
          </div>

          {/* Controls — right col on xl, stacked below table on mobile */}
          <div className="border-t border-zinc-100 p-3 xl:border-t-0 xl:p-4">
            <VendorControlsPanel
              vendorKey={vendorKey}
              orderNo={orderNo}
              quotationId={quotationId}
              vendorLabel={displayLabel}
              initialDocs={initialDocs}
              initialStep={initialStep}
              initialEtd={initialEtd}
              initialEta={initialEta}
              initialSupplierConfirmedAt={initialSupplierConfirmedAt}
              initialReceivingStatus={initialReceivingStatus}
              initialReceivedAt={initialReceivedAt}
            />
          </div>

        </div>
      ) : (
        /* COLLAPSED: controls in compact full-width strip — no grid, no ghost columns */
        <div className="px-3 py-3 xl:px-4 xl:py-4">
          <VendorControlsPanel
              vendorKey={vendorKey}
              orderNo={orderNo}
              quotationId={quotationId}
              vendorLabel={displayLabel}
              initialDocs={initialDocs}
              initialStep={initialStep}
              initialEtd={initialEtd}
              initialEta={initialEta}
              initialSupplierConfirmedAt={initialSupplierConfirmedAt}
              initialReceivingStatus={initialReceivingStatus}
              initialReceivedAt={initialReceivedAt}
            />
        </div>
      )}
    </div>
  );
}
