"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { VendorCard, type VendorCardProps } from "@/components/procurement/vendor-card";

const mobileQuery = "(max-width: 1279px)";

function subscribeToMobile(callback: () => void) {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function mobileSnapshot() {
  return window.matchMedia(mobileQuery).matches;
}

function desktopServerSnapshot() {
  return false;
}

export function ProcurementOrderResponsiveLayout({
  actions,
  clientName,
  desktopSummary,
  orderNo,
  reference,
  status,
  total,
  vendorCards,
}: {
  actions: ReactNode;
  clientName: string;
  desktopSummary: ReactNode;
  orderNo: string;
  reference: string;
  status: string;
  total: string;
  vendorCards: VendorCardProps[];
}) {
  const isMobile = useSyncExternalStore(subscribeToMobile, mobileSnapshot, desktopServerSnapshot);
  const [activeTab, setActiveTab] = useState<"overview" | "vendors">("vendors");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedVendorKey, setSelectedVendorKey] = useState(vendorCards[0]?.vendorKey ?? "");
  const selectedVendor = vendorCards.find((vendor) => vendor.vendorKey === selectedVendorKey) ?? vendorCards[0] ?? null;

  if (!isMobile) {
    return (
      <div className="hidden xl:block">
        <div className="mb-5 flex flex-wrap gap-2">{actions}</div>
        {desktopSummary}
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-zinc-950">Vendor Procurement Folders</h2>
          {vendorCards.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">No supplier-assigned items found for this project.</p>
          ) : (
            <div className="space-y-4">{vendorCards.map((vendor) => <VendorCard key={vendor.vendorKey} {...vendor} />)}</div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="min-w-0 xl:hidden">
      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-base font-bold text-zinc-950">{orderNo}</p>
            <p className="mt-1 line-clamp-2 break-words text-sm text-zinc-700">{reference}</p>
            <p className="mt-1 truncate text-xs text-zinc-500" title={clientName}>{clientName}</p>
          </div>
          <span className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-800">{status}</span>
        </div>
      </section>

      <div className="mt-2">
        <button type="button" onClick={() => setActionsOpen((current) => !current)} aria-expanded={actionsOpen} className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700">Actions</button>
        <div onClickCapture={(event) => { if ((event.target as HTMLElement).closest("a")) setActionsOpen(false); }} className={`${actionsOpen ? "grid" : "hidden"} mt-2 min-w-0 gap-2 rounded-md border border-zinc-200 bg-white p-2 shadow-lg [&_a]:w-full [&_a]:justify-center [&_button]:min-h-10 [&_button]:w-full`}>
          {actions}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
        {(["overview", "vendors"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`h-10 rounded-md text-xs font-semibold capitalize ${activeTab === tab ? "bg-violet-800 text-white" : "bg-white text-zinc-600"}`}>{tab}</button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <section className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-950">Procurement Overview</h2>
          <dl className="mt-3 grid gap-2 text-xs">
            {[["Project file", orderNo], ["Total value", total], ["Vendor groups", String(vendorCards.length)], ["Status", status]].map(([label, value]) => (
              <div key={label} className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-2 border-b border-zinc-100 pb-2 last:border-0 last:pb-0">
                <dt className="font-semibold text-zinc-500">{label}</dt>
                <dd className="break-words text-zinc-800">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="mt-3 min-w-0">
          {selectedVendor ? (
            <>
              <label className="block rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Adjust vendor</span>
                <select
                  value={selectedVendor.vendorKey}
                  onChange={(event) => {
                    if (!window.confirm("Switch vendor? Unsaved status notes or date edits for the current vendor will be discarded.")) return;
                    setSelectedVendorKey(event.target.value);
                  }}
                  className="mt-1 h-11 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none focus:border-violet-700"
                >
                  {vendorCards.map((vendor) => (
                    <option key={vendor.vendorKey} value={vendor.vendorKey}>
                      {vendor.displayLabel} - {vendor.items.length} items - {new Intl.NumberFormat("en-AE", { style: "currency", currency: vendor.currency || "AED" }).format(vendor.totalValue)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3"><VendorCard key={selectedVendor.vendorKey} {...selectedVendor} /></div>
            </>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">No supplier-assigned items found for this project.</p>
          )}
        </section>
      )}
    </div>
  );
}
