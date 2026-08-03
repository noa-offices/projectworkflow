"use client";

import Link from "next/link";
import { useState } from "react";

export type ProjectVendorOperationsSummary = {
  vendorKey: string;
  vendorLabel: string;
  itemCount: number;
  formattedTotal: string;
  currentStage: string;
  activeStep: number;
  etd: string | null;
  eta: string | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value.includes("T") ? value : `${value}T00:00:00`));
}

export function ProjectVendorOperations({
  mode,
  orderNo,
  vendors,
}: {
  mode: "vendors" | "schedule";
  orderNo: string;
  vendors: ProjectVendorOperationsSummary[];
}) {
  const [selectedVendorKey, setSelectedVendorKey] = useState(vendors[0]?.vendorKey ?? "");
  const selectedVendor = vendors.find((vendor) => vendor.vendorKey === selectedVendorKey) ?? vendors[0] ?? null;

  if (!selectedVendor) {
    return <p className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500">No procurement vendors are available for this project.</p>;
  }

  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="block min-w-0 flex-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Vendor</span>
          <select value={selectedVendor.vendorKey} onChange={(event) => setSelectedVendorKey(event.target.value)} className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none focus:border-emerald-800">
            {vendors.map((vendor) => <option key={vendor.vendorKey} value={vendor.vendorKey}>{vendor.vendorLabel}</option>)}
          </select>
        </label>
        <Link href={`/procurement/orders/${encodeURIComponent(orderNo)}`} className="inline-flex h-10 items-center justify-center rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-100">Open Procurement Workspace</Link>
      </div>

      {mode === "vendors" ? (
        <div className="mt-4 min-w-0">
          <div className="flex min-w-0 flex-col gap-2 border-b border-zinc-100 pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold text-zinc-950">{selectedVendor.vendorLabel}</h2>
              <p className="mt-1 text-xs text-zinc-500">Source: Not classified as UAE-local or international</p>
            </div>
            <span className="w-fit shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">{selectedVendor.currentStage}</span>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {[
              ["Items", String(selectedVendor.itemCount)],
              ["Vendor value", selectedVendor.formattedTotal],
              ["Progress", `Stage ${selectedVendor.activeStep + 1} of 8`],
              ["Planned ETD", selectedVendor.etd ? formatDate(selectedVendor.etd) : "Not recorded"],
              ["Planned ETA", selectedVendor.eta ? formatDate(selectedVendor.eta) : "Not recorded"],
              ["Delay / risk", "Not recorded in current procurement data"],
            ].map(([label, value]) => (
              <div key={label} className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-2 border-b border-zinc-100 pb-2">
                <dt className="font-semibold text-zinc-500">{label}</dt>
                <dd className="break-words text-zinc-800">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="mt-4 min-w-0">
          <h2 className="text-base font-semibold text-zinc-950">Vendor Schedule</h2>
          <p className="mt-1 text-xs text-zinc-500">Read-only dates from Procurement. ETA is not treated as customs clearance, warehouse receipt, or site arrival.</p>
          {selectedVendor.etd || selectedVendor.eta ? (
            <ol className="mt-4 space-y-3 border-l border-zinc-200 pl-4">
              {selectedVendor.etd ? (
                <li className="relative rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 before:absolute before:-left-[21px] before:top-4 before:h-2.5 before:w-2.5 before:rounded-full before:bg-sky-600">
                  <p className="text-xs font-semibold text-zinc-900">Planned dispatch / departure (ETD)</p>
                  <p className="mt-0.5 text-sm text-zinc-700">{formatDate(selectedVendor.etd)}</p>
                  <span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Planned</span>
                </li>
              ) : null}
              {selectedVendor.eta ? (
                <li className="relative rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 before:absolute before:-left-[21px] before:top-4 before:h-2.5 before:w-2.5 before:rounded-full before:bg-sky-600">
                  <p className="text-xs font-semibold text-zinc-900">Planned supplier / carrier arrival (ETA)</p>
                  <p className="mt-0.5 text-sm text-zinc-700">{formatDate(selectedVendor.eta)}</p>
                  <span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Planned</span>
                </li>
              ) : null}
            </ol>
          ) : (
            <p className="mt-4 rounded-md border border-dashed border-zinc-200 px-3 py-5 text-center text-sm text-zinc-500">No ETD or ETA has been recorded for this vendor.</p>
          )}
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Revised dates, actual dates, customs clearance, warehouse/site arrival, shipment identifiers, and tracking links are not stored in the current model.</p>
        </div>
      )}
    </section>
  );
}
