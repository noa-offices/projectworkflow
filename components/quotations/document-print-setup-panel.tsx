"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { DocumentPrintSettings } from "@/lib/quotations/document-print-settings";

export type PrintPlannerItem = {
  isClosing?: boolean;
  itemId: string;
  itemName: string;
  pageNumber: number;
  sectionTitle: string;
  serial?: string | null;
};

function ToggleRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900/20" />
      <span>{label}</span>
    </label>
  );
}

export function DocumentPrintPagePlanner({
  onAssignPage,
  onToggleManualPageBreak,
  plannerItems,
  settings,
}: {
  onAssignPage: (itemId: string, pageNumber: number | null) => void;
  onToggleManualPageBreak: (itemId: string, enabled: boolean) => void;
  plannerItems: PrintPlannerItem[];
  settings: DocumentPrintSettings;
}) {
  const pageFlowMode = settings.pageFlowMode;
  const maxPageNumber = Math.max(1, ...plannerItems.map((item) => item.pageNumber), ...Object.values(settings.pageAssignments));
  const pageOptions = Array.from({ length: maxPageNumber }, (_, index) => index + 1);

  return (
    <div className="flex min-h-[360px] flex-col rounded-lg border border-zinc-200 bg-zinc-50 p-3 print:hidden xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:self-start">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Page Planner</p>
        <span className="text-xs text-zinc-500">{plannerItems.length} item{plannerItems.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-3 min-h-[320px] flex-1 overflow-y-auto rounded-md border border-zinc-200 bg-white">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="border-b border-zinc-200 px-3 py-2 text-left font-semibold">Item</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left font-semibold">Section</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left font-semibold">Page</th>
              <th className="border-b border-zinc-200 px-3 py-2 text-left font-semibold">Break</th>
            </tr>
          </thead>
          <tbody>
            {plannerItems.map((item) => {
              const assignmentValue = settings.pageAssignments[item.itemId];

              return (
              <tr key={item.itemId}>
                <td className="border-b border-zinc-200 px-3 py-2 text-zinc-900">
                  <div className="font-medium">{item.serial ? `${item.serial}. ` : ""}{item.itemName}</div>
                </td>
                <td className="border-b border-zinc-200 px-3 py-2 text-zinc-600">{item.sectionTitle}</td>
                <td className="border-b border-zinc-200 px-3 py-2">
                  <label className="grid gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Current: Page {item.pageNumber}</span>
                    <select
                      value={assignmentValue ?? ""}
                      disabled={pageFlowMode !== "manual"}
                      onChange={(event) => {
                        const value = event.target.value;
                        onAssignPage(item.itemId, value ? Number(value) : null);
                      }}
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                    >
                      <option value="">Auto</option>
                      {item.isClosing ? <option value="0">Same page if space</option> : null}
                      {pageOptions.map((pageNumber) => (
                        <option key={pageNumber} value={pageNumber}>Page {pageNumber}</option>
                      ))}
                      <option value={maxPageNumber + 1}>New page</option>
                    </select>
                  </label>
                </td>
                <td className="border-b border-zinc-200 px-3 py-2">
                  <label className="flex items-center gap-2 text-zinc-700">
                    <input type="checkbox" checked={settings.manualPageBreaks.includes(item.itemId)} disabled={pageFlowMode !== "manual" || item.isClosing} onChange={(event) => onToggleManualPageBreak(item.itemId, event.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900/20 disabled:cursor-not-allowed" />
                    <span>Break before</span>
                  </label>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DocumentPrintSetupPanel({
  actionLabel,
  backHref,
  children,
  dirtyMessage,
  downloadLabel = "Download PDF",
  feedback,
  isDirty,
  isPending,
  onDownload,
  onReset,
  onResetManualPageBreaks,
  onSave,
  onSettingsChange,
  onAssignPage,
  onToggleManualPageBreak,
  plannerItems,
  resetLabel,
  savedMessage,
  settings,
  showSettings,
  showPlanner = true,
  title,
  toggleSettings,
}: {
  actionLabel: string;
  backHref: string;
  children?: ReactNode;
  dirtyMessage: string;
  downloadLabel?: string;
  feedback: string | null;
  isDirty: boolean;
  isPending: boolean;
  onDownload: () => void;
  onReset: () => void;
  onResetManualPageBreaks: () => void;
  onSave: () => void;
  onSettingsChange: (patch: Partial<DocumentPrintSettings>) => void;
  onAssignPage: (itemId: string, pageNumber: number | null) => void;
  onToggleManualPageBreak: (itemId: string, enabled: boolean) => void;
  plannerItems: PrintPlannerItem[];
  resetLabel: string;
  savedMessage: string;
  settings: DocumentPrintSettings;
  showSettings: boolean;
  showPlanner?: boolean;
  title: string;
  toggleSettings: () => void;
}) {
  const pageFlowMode = settings.pageFlowMode;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</p>
          <p className="mt-2 text-sm text-zinc-600">{isDirty ? dirtyMessage : savedMessage}</p>
          {feedback ? <p className="mt-2 text-sm font-medium text-zinc-900">{feedback}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={backHref} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
            Back to Quotation
          </Link>
          <button type="button" onClick={onSave} disabled={isPending} className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700">
            {isPending ? "Saving..." : actionLabel}
          </button>
          <button type="button" onClick={onReset} disabled={isPending} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed">
            {resetLabel}
          </button>
          <button type="button" onClick={onDownload} className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800">
            {downloadLabel}
          </button>
          <button type="button" onClick={toggleSettings} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
            {showSettings ? "Hide Settings" : "Show Settings"}
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(390px,0.9fr)]">
          <div className="grid gap-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Basic Layout</p>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Orientation</span>
                  <select value={settings.orientation} onChange={(event) => onSettingsChange({ orientation: event.target.value as DocumentPrintSettings["orientation"] })} className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Density</span>
                  <select value={settings.density} onChange={(event) => onSettingsChange({ density: event.target.value as DocumentPrintSettings["density"] })} className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                    <option value="maxFit">Ultra compact</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Image Size</span>
                  <select value={settings.imageSize} onChange={(event) => onSettingsChange({ imageSize: event.target.value as DocumentPrintSettings["imageSize"] })} className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Table Options</p>
                <ToggleRow checked={settings.repeatTableHeader} label="Repeat table header on continuation pages" onChange={(checked) => onSettingsChange({ repeatTableHeader: checked })} />
                <ToggleRow checked={settings.showFullHeaderOnlyFirstPage} label="Full header only on first page" onChange={(checked) => onSettingsChange({ showFullHeaderOnlyFirstPage: checked })} />
                <ToggleRow checked={settings.keepSectionTogether} label="Keep section together" onChange={(checked) => onSettingsChange({ keepSectionTogether: checked })} />
                <ToggleRow checked={settings.startEachSectionOnNewPage} label="Start each section on a new page" onChange={(checked) => onSettingsChange({ startEachSectionOnNewPage: checked })} />
              </div>
              <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Page Flow</p>
                <div className="flex flex-wrap gap-4 text-sm text-zinc-700">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`${title}-page-flow`} checked={pageFlowMode === "auto"} onChange={() => onSettingsChange({ pageFlowMode: "auto" })} className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20" />
                    <span>Auto page flow</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`${title}-page-flow`} checked={pageFlowMode === "manual"} onChange={() => onSettingsChange({ pageFlowMode: "manual" })} className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20" />
                    <span>Manual page breaks</span>
                  </label>
                </div>
                <button type="button" onClick={onResetManualPageBreaks} className="w-fit rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                  Reset manual page breaks
                </button>
              </div>
            </div>

            {children}
          </div>

          {showPlanner ? (
            <DocumentPrintPagePlanner
              onAssignPage={onAssignPage}
              onToggleManualPageBreak={onToggleManualPageBreak}
              plannerItems={plannerItems}
              settings={settings}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

