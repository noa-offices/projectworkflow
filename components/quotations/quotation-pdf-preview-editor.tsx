"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  QuotationPdfDocument,
  deserializeQuotationPdfDocumentData,
  quotationPdfItemPageAssignments,
  type SerializedQuotationPdfDocumentData,
} from "@/components/quotations/quotation-pdf-document";
import {
  normalizeQuotationPdfSettings,
  type QuotationPdfSettings,
} from "@/lib/quotations/quotation-pdf-settings";

type QuotationPdfPreviewEditorProps = {
  defaultSettings: QuotationPdfSettings;
  initialSettings: QuotationPdfSettings;
  initialWarning?: string | null;
  serializedData: SerializedQuotationPdfDocumentData;
};

function settingsSignature(settings: QuotationPdfSettings) {
  return JSON.stringify(normalizeQuotationPdfSettings(settings));
}

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

export function QuotationPdfPreviewEditor({
  defaultSettings,
  initialSettings,
  initialWarning = null,
  serializedData,
}: QuotationPdfPreviewEditorProps) {
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState<string | null>(initialWarning);
  const [showSettings, setShowSettings] = useState(true);
  const [pageFlowMode, setPageFlowMode] = useState<"auto" | "manual">(initialSettings.manualPageBreaks.length > 0 ? "manual" : "auto");
  const [isPending, startTransition] = useTransition();
  const data = useMemo(() => deserializeQuotationPdfDocumentData(serializedData), [serializedData]);
  const isDirty = settingsSignature(settings) !== settingsSignature(savedSettings);
  const pageAssignments = useMemo(
    () => quotationPdfItemPageAssignments(data, settings),
    [data, settings],
  );
  const companyDefaultNotes = data.defaultQuotationNotes;
  const notesValue = settings.notesOverride ?? companyDefaultNotes;

  function updateSettings(patch: Partial<QuotationPdfSettings>) {
    setSettings((current) => ({
      ...current,
      ...patch,
    }));
  }

  function toggleManualPageBreak(itemId: string, enabled: boolean) {
    const nextBreaks = new Set(settings.manualPageBreaks);
    if (enabled) {
      nextBreaks.add(itemId);
    } else {
      nextBreaks.delete(itemId);
    }

    updateSettings({
      manualPageBreaks: Array.from(nextBreaks),
    });
  }

  function resetSettings() {
    setSettings(defaultSettings);
    setPageFlowMode("auto");
    setFeedback("Quotation PDF settings reset locally. Save to persist the defaults.");
  }

  function resetManualPageBreaks() {
    updateSettings({ manualPageBreaks: [] });
    setPageFlowMode("auto");
    setFeedback("Manual page breaks cleared locally.");
  }

  function resetNotesToCompanyDefault() {
    updateSettings({ notesOverride: null });
    setFeedback("Quotation notes reset locally to the company default. Save to persist the change.");
  }

  function saveSettings() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const trimmedDefaultNotes = companyDefaultNotes.trim();
        const trimmedNotesOverride = settings.notesOverride?.trim() ?? "";
        const settingsToSave = {
          ...settings,
          notesOverride:
            trimmedNotesOverride.length === 0 || trimmedNotesOverride === trimmedDefaultNotes
              ? null
              : settings.notesOverride,
        };
        const response = await fetch(`/api/quotations/${data.quotation.id}/pdf-settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: settingsToSave }),
        });
        const payload = await response.json() as {
          success?: boolean;
          error?: string;
          details?: string;
          settings?: QuotationPdfSettings;
        };

        if (!response.ok || !payload.success || !payload.settings) {
          throw new Error(payload.details || payload.error || "Failed to save quotation PDF settings.");
        }

        const normalized = normalizeQuotationPdfSettings(payload.settings);
        setSavedSettings(normalized);
        setSettings(normalized);
        setFeedback("Quotation PDF settings saved.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to save quotation PDF settings.");
      }
    });
  }

  function downloadPdf() {
    if (isDirty) {
      setFeedback("Save PDF settings before downloading to include your changes.");
      return;
    }

    window.location.href = `/quotations/${data.quotation.id}/download-pdf`;
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-5">
      <div className="mx-auto mb-5 w-[297mm] max-w-full">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Quotation PDF Preview Setup</p>
              <p className="mt-2 text-sm text-zinc-600">
                {isDirty ? "You have unsaved PDF setting changes." : "PDF settings match latest saved version."}
              </p>
              {feedback ? <p className="mt-2 text-sm font-medium text-zinc-900">{feedback}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/quotations/${data.quotation.id}`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                Back to Quotation
              </Link>
              <button type="button" onClick={saveSettings} disabled={isPending} className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700">
                {isPending ? "Saving..." : "Save PDF Settings"}
              </button>
              <button type="button" onClick={resetSettings} disabled={isPending} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed">
                Reset PDF Settings
              </button>
              <button type="button" onClick={downloadPdf} className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800">
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((current) => !current)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
              >
                {showSettings ? "Hide Settings" : "Show Settings"}
              </button>
            </div>
          </div>

          {showSettings ? (
            <div className="mt-5 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(400px,0.92fr)]">
              <div className="grid content-start gap-4">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Basic Layout</p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="grid gap-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Orientation</span>
                      <select
                        value={settings.orientation}
                        onChange={(event) => updateSettings({ orientation: event.target.value as QuotationPdfSettings["orientation"] })}
                        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                      >
                        <option value="landscape">Landscape</option>
                        <option value="portrait">Portrait</option>
                      </select>
                    </label>

                    <label className="grid gap-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Density</span>
                      <select
                        value={settings.density}
                        onChange={(event) => updateSettings({ density: event.target.value as QuotationPdfSettings["density"] })}
                        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                      >
                        <option value="comfortable">Comfortable</option>
                        <option value="compact">Compact</option>
                        <option value="maxFit">More items per page</option>
                      </select>
                    </label>

                    <label className="grid gap-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Image Size</span>
                      <select
                        value={settings.imageSize}
                        onChange={(event) => updateSettings({ imageSize: event.target.value as QuotationPdfSettings["imageSize"] })}
                        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                      >
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
                    <ToggleRow checked={settings.repeatTableHeader} label="Repeat table header on continuation pages" onChange={(checked) => updateSettings({ repeatTableHeader: checked })} />
                    <ToggleRow checked={settings.showFullHeaderOnlyFirstPage} label="Full header only on first page" onChange={(checked) => updateSettings({ showFullHeaderOnlyFirstPage: checked })} />
                    <ToggleRow checked={settings.keepSectionTogether} label="Keep section together" onChange={(checked) => updateSettings({ keepSectionTogether: checked })} />
                  </div>

                  <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Page Flow</p>
                    <div className="flex flex-wrap gap-4 text-sm text-zinc-700">
                      <label className="flex items-center gap-2">
                        <input type="radio" name="page-flow" checked={pageFlowMode === "auto"} onChange={() => setPageFlowMode("auto")} className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20" />
                        <span>Auto page flow</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="radio" name="page-flow" checked={pageFlowMode === "manual"} onChange={() => setPageFlowMode("manual")} className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900/20" />
                        <span>Manual page breaks</span>
                      </label>
                    </div>
                    {pageFlowMode === "manual" ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={resetManualPageBreaks} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                          Reset manual page breaks
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Closing / Signature</p>
                  <label className="mt-3 grid gap-1">
                    <span className="text-sm font-medium text-zinc-800">Prepared by name</span>
                    <input
                      type="text"
                      value={settings.closingPreparedName}
                      placeholder="NOA OFFICES"
                      onChange={(event) => updateSettings({ closingPreparedName: event.target.value })}
                      className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                    <span className="text-xs text-zinc-500">
                      Shown in the closing/signature block above the prepared-by line.
                    </span>
                  </label>
                </div>

                <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Notes</p>
                      <p className="mt-1 text-xs text-zinc-500">These notes appear in the quotation PDF. Leave them on the company default or save a quotation-specific override.</p>
                    </div>
                    <button
                      type="button"
                      onClick={resetNotesToCompanyDefault}
                      className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
                    >
                      Reset to company default
                    </button>
                  </div>
                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-zinc-800">Quotation notes</span>
                    <textarea
                      value={notesValue}
                      rows={10}
                      onChange={(event) => updateSettings({ notesOverride: event.target.value })}
                      className="rounded-md border border-zinc-200 bg-white px-3 py-3 text-sm leading-6 text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    />
                  </label>
                </div>
              </div>

              <div className="flex min-h-[360px] flex-col rounded-lg border border-zinc-200 bg-zinc-50 p-3 xl:min-h-[520px] xl:max-h-[calc(100vh-12rem)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Page Planner</p>
                  <span className="text-xs text-zinc-500">{pageAssignments.length} item{pageAssignments.length === 1 ? "" : "s"}</span>
                </div>
                <div className="mt-3 min-h-[320px] flex-1 overflow-y-auto rounded-md border border-zinc-200 bg-white xl:min-h-[480px]">
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
                      {pageAssignments.map((assignment) => (
                        <tr key={assignment.itemId}>
                          <td className="border-b border-zinc-200 px-3 py-2 text-zinc-900">
                            <div className="font-medium">{assignment.serial ? `${assignment.serial}. ` : ""}{assignment.itemName}</div>
                          </td>
                          <td className="border-b border-zinc-200 px-3 py-2 text-zinc-600">{assignment.sectionTitle}</td>
                          <td className="border-b border-zinc-200 px-3 py-2 text-zinc-600">Page {assignment.pageNumber}</td>
                          <td className="border-b border-zinc-200 px-3 py-2">
                            <label className="flex items-center gap-2 text-zinc-700">
                              <input
                                type="checkbox"
                                checked={settings.manualPageBreaks.includes(assignment.itemId)}
                                disabled={pageFlowMode !== "manual"}
                                onChange={(event) => toggleManualPageBreak(assignment.itemId, event.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900/20 disabled:cursor-not-allowed"
                              />
                              <span>Break before</span>
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <QuotationPdfDocument data={data} settings={settings} printMode={false} showToolbar={false} />
    </main>
  );
}
