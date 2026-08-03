"use client";

import { useState, type ReactNode } from "react";

type ProjectTab = "overview" | "vendors" | "payments" | "schedule" | "activity" | "documents" | "items";

export function ProjectFileResponsiveLayout({
  actions,
  activity,
  clientName,
  createdAt,
  documents,
  executionStatus,
  itemCount,
  items,
  notice,
  overviewHighlights,
  orderNo,
  quotationNo,
  reference,
  sourceFolder,
  status,
  schedule,
  total,
  vendors,
  payments,
}: {
  actions?: ReactNode;
  activity: ReactNode;
  clientName: string;
  createdAt: string;
  documents: ReactNode;
  executionStatus: ReactNode;
  itemCount: number;
  items: ReactNode;
  notice?: ReactNode;
  overviewHighlights: ReactNode;
  orderNo: string;
  quotationNo: string | null;
  reference: string;
  sourceFolder: string | null;
  status: string;
  schedule: ReactNode;
  total: string;
  vendors: ReactNode;
  payments: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<ProjectTab>("overview");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);

  const visibility = (tab: ProjectTab) => activeTab === tab ? "block" : "hidden";
  const statusClasses = status === "Completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status === "Cancelled"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className="min-w-0">
      {notice ? <div className="mb-3">{notice}</div> : null}

      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:p-5">
        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="break-words text-lg font-bold text-zinc-950 xl:text-xl">{orderNo}</p>
            <p className="mt-1 break-words text-sm font-medium text-zinc-700">{reference}</p>
            <p className="mt-1 break-words text-xs text-zinc-500">{clientName}</p>
          </div>
          <span className={`w-fit shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClasses}`}>{status}</span>
        </div>
      </section>

      {actions ? (
        <div className="mt-2 xl:mt-3">
          <button type="button" onClick={() => setActionsOpen((current) => !current)} aria-expanded={actionsOpen} className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 xl:hidden">Actions</button>
          <div onClickCapture={(event) => { if ((event.target as HTMLElement).closest("a")) setActionsOpen(false); }} className={`${actionsOpen ? "grid" : "hidden"} mt-2 min-w-0 gap-2 rounded-md border border-zinc-200 bg-white p-2 shadow-lg [&_a]:w-full [&_a]:justify-center [&_button]:min-h-10 [&_button]:w-full xl:mt-0 xl:flex xl:flex-wrap xl:gap-2 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none xl:[&_a]:w-auto xl:[&_button]:w-auto`}>
            {actions}
          </div>
        </div>
      ) : null}

      <nav aria-label="Project sections" className="mt-3 grid grid-cols-4 gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 sm:grid-cols-7">
        {(["overview", "vendors", "payments", "schedule", "activity", "documents", "items"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? "page" : undefined} className={`h-10 min-w-0 rounded-md px-1 text-[11px] font-semibold capitalize sm:text-xs ${activeTab === tab ? "bg-emerald-900 text-white" : "bg-white text-zinc-600"}`}>
            {tab}
          </button>
        ))}
      </nav>

      <section className={`${visibility("overview")} mt-3 min-w-0`}>
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:p-5">
            <h2 className="text-sm font-semibold text-zinc-950">Project Overview</h2>
            <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
              {[
                ["Project file", orderNo],
                ["Quotation", quotationNo ?? "-"],
                ["Client", clientName],
                ["Reference", reference],
                ["Total", total],
                ["Created", createdAt],
                ["Status", status],
                ["Source folder", sourceFolder ?? "-"],
              ].map(([label, value]) => (
                <div key={label} className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-2 border-b border-zinc-100 pb-2">
                  <dt className="font-semibold text-zinc-500">{label}</dt>
                  <dd className="break-words text-zinc-800">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="min-w-0">{executionStatus}</div>
        </div>
        {overviewHighlights}
      </section>

      <div className={`${visibility("vendors")} mt-3 min-w-0`}>{vendors}</div>
      <div className={`${visibility("payments")} mt-3 min-w-0`}>{payments}</div>
      <div className={`${visibility("schedule")} mt-3 min-w-0`}>{schedule}</div>
      <div className={`${visibility("activity")} mt-3 min-w-0`}>{activity}</div>
      <div className={`${visibility("documents")} mt-3 min-w-0`}>{documents}</div>

      <section className={`${visibility("items")} mt-3 min-w-0`}>
        <button type="button" onClick={() => setItemsExpanded((current) => !current)} aria-expanded={itemsExpanded} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 text-left text-sm font-semibold text-zinc-800 shadow-sm">
          <span>{itemsExpanded ? "Hide locked items" : `View locked items (${itemCount})`}</span>
          <span aria-hidden="true" className={`text-zinc-400 transition ${itemsExpanded ? "rotate-90" : ""}`}>&gt;</span>
        </button>
        {itemsExpanded ? <div className="mt-3 min-w-0">{items}</div> : null}
      </section>
    </div>
  );
}
