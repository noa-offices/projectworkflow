"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { VendorControlsPanel } from "./vendor-controls-panel";
import { generatePoAction } from "@/lib/procurement/generate-po-action";
import type { VendorDocRecord } from "@/lib/procurement/vendor-docs-action";

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

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">

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
          </div>
        </div>

        {/* Total value pill + action buttons + toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900">
            {formattedTotal}
          </span>

          {canGenerateDocs ? (
            <>
              <Link
                href={`/quotations/${quotationId}/procurement-rfq`}
                className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900"
              >
                RFQ →
              </Link>
              <Link
                href={`/quotations/${quotationId}/delivery-note`}
                className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900"
              >
                Delivery Note →
              </Link>
              {poNumber ? (
                <Link
                  href={`/quotations/${quotationId}/purchase-order`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100"
                >
                  📄 {poNumber}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={handleGeneratePo}
                  className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {isGenerating ? "Generating…" : "Generate PO →"}
                </button>
              )}
            </>
          ) : null}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
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
          <div className="overflow-x-auto xl:border-r xl:border-zinc-100">
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

          {/* Controls — right col on xl, stacked below table on mobile */}
          <div className="border-t border-zinc-100 p-4 xl:border-t-0">
            <VendorControlsPanel
              vendorKey={vendorKey}
              orderNo={orderNo}
              quotationId={quotationId}
              vendorLabel={displayLabel}
              initialDocs={initialDocs}
              initialStep={initialStep}
              initialEtd={initialEtd}
              initialEta={initialEta}
            />
          </div>

        </div>
      ) : (
        /* COLLAPSED: controls in compact full-width strip — no grid, no ghost columns */
        <div className="px-4 py-4">
          <VendorControlsPanel
              vendorKey={vendorKey}
              orderNo={orderNo}
              quotationId={quotationId}
              vendorLabel={displayLabel}
              initialDocs={initialDocs}
              initialStep={initialStep}
              initialEtd={initialEtd}
              initialEta={initialEta}
            />
        </div>
      )}
    </div>
  );
}
