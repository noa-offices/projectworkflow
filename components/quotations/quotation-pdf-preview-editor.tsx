"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  QuotationPdfDocument,
  deserializeQuotationPdfDocumentData,
  quotationPdfItemPageAssignments,
  quotationPdfOrderedSections,
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

function moveOrderedEntry(ids: string[], entryId: string, direction: "up" | "down") {
  const currentIndex = ids.indexOf(entryId);
  if (currentIndex < 0) return ids;

  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= ids.length) return ids;

  const nextIds = [...ids];
  const [entry] = nextIds.splice(currentIndex, 1);
  nextIds.splice(nextIndex, 0, entry);
  return nextIds;
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

function PagePlanner({
  mainSectionGroups,
  moveMainSection,
  moveSubsection,
  pageAssignments,
  pageFlowMode,
  settings,
  subsectionGroups,
  toggleManualPageBreak,
}: {
  mainSectionGroups: Array<{ id: string; title: string; canMoveUp: boolean; canMoveDown: boolean }>;
  moveMainSection: (sectionId: string, direction: "up" | "down") => void;
  moveSubsection: (mainSectionId: string, sectionId: string, direction: "up" | "down") => void;
  pageAssignments: ReturnType<typeof quotationPdfItemPageAssignments>;
  pageFlowMode: "auto" | "manual";
  settings: QuotationPdfSettings;
  subsectionGroups: Array<{ id: string; mainSectionId: string; title: string; parentTitle: string; canMoveUp: boolean; canMoveDown: boolean }>;
  toggleManualPageBreak: (itemId: string, enabled: boolean) => void;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Page Planner</p>
        <span className="text-xs text-zinc-500">{pageAssignments.length} item{pageAssignments.length === 1 ? "" : "s"}</span>
      </div>
      {mainSectionGroups.length > 1 || subsectionGroups.length > 1 ? (
        <div className="mt-3 grid gap-3 rounded-md border border-zinc-200 bg-white p-3">
          {mainSectionGroups.length > 1 ? (
            <div className="grid gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Main Sections</p>
              <div className="grid gap-1.5">
                {mainSectionGroups.map((section) => (
                  <div key={section.id} className="grid min-w-0 gap-2 rounded-md border border-zinc-100 p-2 text-xs">
                    <span className="min-w-0 break-words font-medium text-zinc-800">{section.title}</span>
                    <div className="flex gap-2">
                    <button type="button" disabled={!section.canMoveUp} onClick={() => moveMainSection(section.id, "up")} className="inline-flex h-9 items-center rounded border border-zinc-200 px-3 font-semibold text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300">
                      Up
                    </button>
                    <button type="button" disabled={!section.canMoveDown} onClick={() => moveMainSection(section.id, "down")} className="inline-flex h-9 items-center rounded border border-zinc-200 px-3 font-semibold text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300">
                      Down
                    </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {subsectionGroups.length > 1 ? (
            <div className="grid gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Subsections</p>
              <div className="grid gap-1.5">
                {subsectionGroups.map((section) => (
                  <div key={section.id} className="grid min-w-0 gap-2 rounded-md border border-zinc-100 p-2 text-xs">
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-zinc-800">{section.title}</span>
                      <span className="mt-1 block break-words text-[10px] text-zinc-500">{section.parentTitle}</span>
                    </span>
                    <div className="flex gap-2">
                    <button type="button" disabled={!section.canMoveUp} onClick={() => moveSubsection(section.mainSectionId, section.id, "up")} className="inline-flex h-9 items-center rounded border border-zinc-200 px-3 font-semibold text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300">
                      Up
                    </button>
                    <button type="button" disabled={!section.canMoveDown} onClick={() => moveSubsection(section.mainSectionId, section.id, "down")} className="inline-flex h-9 items-center rounded border border-zinc-200 px-3 font-semibold text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300">
                      Down
                    </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 grid min-w-0 gap-2">
            {pageAssignments.map((assignment) => (
              <div key={assignment.itemId} className="min-w-0 rounded-md border border-zinc-200 bg-white p-3 text-xs">
                <p className="break-words font-medium text-zinc-900">{assignment.serial ? `${assignment.serial}. ` : ""}{assignment.itemName}</p>
                <dl className="mt-2 grid gap-1 text-zinc-600">
                  <div><dt className="inline font-semibold">Section: </dt><dd className="inline break-words">{assignment.sectionTitle}</dd></div>
                  <div><dt className="inline font-semibold">Page: </dt><dd className="inline">{assignment.pageNumber}</dd></div>
                </dl>
                  <label className="mt-3 flex min-h-9 items-center gap-2 text-zinc-700">
                    <input
                      type="checkbox"
                      checked={settings.manualPageBreaks.includes(assignment.itemId)}
                      disabled={pageFlowMode !== "manual"}
                      onChange={(event) => toggleManualPageBreak(assignment.itemId, event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900/20 disabled:cursor-not-allowed"
                    />
                    <span>Break before</span>
                  </label>
              </div>
            ))}
      </div>
    </section>
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
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [isMobilePreview, setIsMobilePreview] = useState(false);
  const [zoomMode, setZoomMode] = useState<"fit-width" | "manual">("fit-width");
  const [fitScale, setFitScale] = useState(1);
  const [manualScale, setManualScale] = useState(1);
  const [previewContentSize, setPreviewContentSize] = useState({ height: 0, width: 0 });
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const [pageFlowMode, setPageFlowMode] = useState<"auto" | "manual">(initialSettings.manualPageBreaks.length > 0 ? "manual" : "auto");
  const [isPending, startTransition] = useTransition();
  const data = useMemo(() => deserializeQuotationPdfDocumentData(serializedData), [serializedData]);
  const previewSettings = useMemo(
    () => pageFlowMode === "auto" ? { ...settings, manualPageBreaks: [] } : settings,
    [pageFlowMode, settings],
  );
  const isDirty = settingsSignature(previewSettings) !== settingsSignature(savedSettings);
  const pageAssignments = useMemo(
    () => quotationPdfItemPageAssignments(data, previewSettings),
    [data, previewSettings],
  );
  const orderedSections = useMemo(
    () => quotationPdfOrderedSections(data, previewSettings),
    [data, previewSettings],
  );
  const mainSectionGroups = useMemo(() => {
    const sections = orderedSections.filter((section) => section.renderAsMainOnly);

    return sections.map((section, index) => ({
      id: section.id,
      title: section.section_title,
      canMoveUp: index > 0,
      canMoveDown: index < sections.length - 1,
    }));
  }, [orderedSections]);
  const subsectionGroups = useMemo(() => {
    const mainSectionTitleById = new Map(
      orderedSections
        .filter((section) => section.renderAsMainOnly)
        .map((section) => [section.id, section.section_title] as const),
    );

    return orderedSections
      .filter((section) => section.parent_section_id && mainSectionTitleById.has(section.parent_section_id))
      .map((section) => {
        const siblingSections = orderedSections.filter((entry) => entry.parent_section_id === section.parent_section_id);
        const index = siblingSections.findIndex((entry) => entry.id === section.id);

        return {
          id: section.id,
          mainSectionId: section.parent_section_id!,
          title: section.section_title,
          parentTitle: mainSectionTitleById.get(section.parent_section_id!) ?? "Main Section",
          canMoveUp: index > 0,
          canMoveDown: index >= 0 && index < siblingSections.length - 1,
        };
      });
  }, [orderedSections]);
  const companyDefaultNotes = data.defaultQuotationNotes;
  const notesValue = settings.notesOverride ?? companyDefaultNotes;
  const previewScale = zoomMode === "fit-width" ? fitScale : manualScale;
  const pageWidthMm = previewSettings.orientation === "landscape" ? 297 : 210;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1279px)");
    const updateMobileState = () => setIsMobilePreview(mediaQuery.matches);

    updateMobileState();
    mediaQuery.addEventListener("change", updateMobileState);
    return () => mediaQuery.removeEventListener("change", updateMobileState);
  }, []);

  useEffect(() => {
    if (!isMobilePreview) return;

    const viewport = previewViewportRef.current;
    const content = previewContentRef.current;
    if (!viewport || !content) return;

    const updatePreviewSize = () => {
      const width = content.scrollWidth;
      const height = content.scrollHeight;
      setPreviewContentSize({ height, width });

      if (zoomMode === "fit-width" && width > 0) {
        setFitScale(Math.min(Math.max((viewport.clientWidth - 8) / width, 0.2), 1));
      }
    };

    updatePreviewSize();
    const resizeObserver = new ResizeObserver(updatePreviewSize);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    return () => resizeObserver.disconnect();
  }, [isMobilePreview, previewSettings, zoomMode]);

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

  function moveMainSection(sectionId: string, direction: "up" | "down") {
    const orderedIds = orderedSections
      .filter((section) => section.renderAsMainOnly)
      .map((section) => section.id);
    const nextIds = moveOrderedEntry(orderedIds, sectionId, direction);
    if (nextIds.join("|") === orderedIds.join("|")) return;

    updateSettings({
      flowOrder: {
        ...settings.flowOrder,
        mainSectionIds: nextIds,
      },
    });
  }

  function moveSubsection(mainSectionId: string, sectionId: string, direction: "up" | "down") {
    const orderedIds = orderedSections
      .filter((section) => section.parent_section_id === mainSectionId)
      .map((section) => section.id);
    const nextIds = moveOrderedEntry(orderedIds, sectionId, direction);
    if (nextIds.join("|") === orderedIds.join("|")) return;

    updateSettings({
      flowOrder: {
        ...settings.flowOrder,
        sectionIdsByMain: {
          ...settings.flowOrder.sectionIdsByMain,
          [mainSectionId]: nextIds,
        },
      },
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
          manualPageBreaks: pageFlowMode === "auto" ? [] : settings.manualPageBreaks,
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

  function adjustZoom(change: number) {
    setManualScale(Math.min(Math.max(previewScale + change, 0.2), 1.5));
    setZoomMode("manual");
  }

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-zinc-100 px-3 py-3 xl:overflow-x-visible xl:px-4 xl:py-5">
      <div className={`mx-auto grid max-w-[calc(297mm+2rem+440px+1.25rem)] gap-5 ${showSettings ? "xl:grid-cols-[minmax(0,calc(297mm+2rem))_minmax(400px,440px)]" : "xl:grid-cols-[minmax(0,calc(297mm+2rem))]"} xl:items-start xl:justify-center`}>
        <div className="min-w-0 xl:contents">
          <div className={`${showSettings ? "xl:block" : "xl:hidden"} mx-auto mb-5 w-full max-w-full rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm xl:sticky xl:top-5 xl:col-start-2 xl:row-start-1 xl:mb-0 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:p-4`}>
          <div className="grid gap-3 xl:hidden">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/quotations/${data.quotation.id}`} className="inline-flex h-10 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700">
                Back
              </Link>
              <button type="button" onClick={downloadPdf} className="inline-flex h-10 items-center rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white">
                Download PDF
              </button>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Quotation PDF Settings</p>
              <p className="mt-1 text-sm capitalize text-zinc-700">
                {settings.orientation} · {settings.density === "maxFit" ? "More items per page" : settings.density} · {settings.imageSize} images
              </p>
              <button
                type="button"
                onClick={() => setShowMobileSettings((current) => !current)}
                className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700"
              >
                {showMobileSettings ? "Hide settings" : "Show settings"}
              </button>
            </div>
            {feedback ? <p className="text-sm font-medium text-zinc-900">{feedback}</p> : null}
          </div>
          <div className="hidden gap-3 xl:grid">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Quotation PDF Settings</p>
              <p className="mt-2 text-sm text-zinc-600">
                {isDirty ? "You have unsaved PDF setting changes." : "PDF settings match latest saved version."}
              </p>
              {feedback ? <p className="mt-2 text-sm font-medium text-zinc-900">{feedback}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/quotations/${data.quotation.id}`} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                Back to Quotation
              </Link>
              <button type="button" onClick={saveSettings} disabled={isPending} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700">
                {isPending ? "Saving..." : "Save PDF Settings"}
              </button>
              <button type="button" onClick={resetSettings} disabled={isPending} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed">
                Reset PDF Settings
              </button>
              <button type="button" onClick={downloadPdf} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800">
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((current) => !current)}
                className="col-span-2 inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
              >
                {showSettings ? "Hide Settings" : "Show Settings"}
              </button>
            </div>
          </div>

            {showSettings || showMobileSettings ? (
              <div className={`mt-5 content-start gap-4 ${showMobileSettings ? "grid" : "hidden"} ${showSettings ? "xl:grid" : "xl:hidden"}`}>
              <div className="grid content-start gap-4">
                <div className="grid gap-2 sm:grid-cols-2 xl:hidden">
                  <button type="button" onClick={saveSettings} disabled={isPending} className="h-10 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white disabled:bg-emerald-700">
                    {isPending ? "Saving..." : "Save PDF Settings"}
                  </button>
                  <button type="button" onClick={resetSettings} disabled={isPending} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed">
                    Reset PDF Settings
                  </button>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Basic Layout</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
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

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                  <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Table Options</p>
                    <ToggleRow checked={settings.repeatTableHeader} label="Repeat table header on continuation pages" onChange={(checked) => updateSettings({ repeatTableHeader: checked })} />
                    <ToggleRow checked={settings.showFullHeaderOnlyFirstPage} label="Full header only on first page" onChange={(checked) => updateSettings({ showFullHeaderOnlyFirstPage: checked })} />
                    <ToggleRow checked={settings.keepSectionTogether} label="Keep section together" onChange={(checked) => updateSettings({ keepSectionTogether: checked })} />
                    <ToggleRow checked={settings.startEachSectionOnNewPage} label="Start each section on a new page" onChange={(checked) => updateSettings({ startEachSectionOnNewPage: checked })} />
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
                  <div className="flex items-start justify-between gap-3 xl:grid">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Notes</p>
                      <p className="mt-1 text-xs text-zinc-500">These notes appear in the quotation PDF. Leave them on the company default or save a quotation-specific override.</p>
                    </div>
                    <button
                      type="button"
                      onClick={resetNotesToCompanyDefault}
                      className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 xl:w-full"
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

              <PagePlanner
                mainSectionGroups={mainSectionGroups}
                moveMainSection={moveMainSection}
                moveSubsection={moveSubsection}
                pageAssignments={pageAssignments}
                pageFlowMode={pageFlowMode}
                settings={settings}
                subsectionGroups={subsectionGroups}
                toggleManualPageBreak={toggleManualPageBreak}
              />

            </div>
          ) : null}
        </div>

          <div className="mb-3 flex items-center justify-center gap-2 xl:hidden">
            <button
              type="button"
              onClick={() => adjustZoom(-0.1)}
              disabled={previewScale <= 0.2}
              aria-label="Zoom out"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-lg font-semibold disabled:text-zinc-300"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoomMode("fit-width")}
              aria-label="Fit quotation preview to width"
              className={`inline-flex h-10 items-center justify-center rounded-md border px-3 text-xs font-semibold ${zoomMode === "fit-width" ? "border-emerald-800 bg-emerald-50 text-emerald-900" : "border-zinc-300 bg-white text-zinc-700"}`}
            >
              Fit width
            </button>
            <span className="inline-flex h-10 min-w-14 items-center justify-center rounded-md border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-700">
              {Math.round(previewScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => adjustZoom(0.1)}
              disabled={previewScale >= 1.5}
              aria-label="Zoom in"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 bg-white text-lg font-semibold disabled:text-zinc-300"
            >
              +
            </button>
          </div>
          <div ref={previewViewportRef} className="min-w-0 overflow-x-auto overscroll-x-contain xl:col-start-1 xl:row-start-1 xl:overflow-visible">
            <div
              className="mx-auto"
              style={isMobilePreview ? {
                height: previewContentSize.height * previewScale,
                width: previewContentSize.width * previewScale,
              } : undefined}
            >
              <div
                ref={previewContentRef}
                style={isMobilePreview ? {
                  transform: `scale(${previewScale})`,
                  transformOrigin: "top left",
                  width: `calc(${pageWidthMm}mm + 2rem)`,
                } : undefined}
              >
                <QuotationPdfDocument data={data} settings={previewSettings} printMode={false} showToolbar={false} />
              </div>
            </div>
          </div>
        </div>

        {!showSettings ? (
          <div className="pointer-events-none z-10 hidden justify-end xl:col-start-1 xl:row-start-1 xl:flex xl:self-start xl:p-3">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="pointer-events-auto inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-400 hover:bg-zinc-50"
            >
              Show Settings
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
