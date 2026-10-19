"use client";

import Link from "next/link";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleCheck, Download, FileSpreadsheet, FileText, LayoutGrid, ListOrdered, Maximize2, Minimize2, Minus, PanelRightClose, PenLine, Plus, RotateCcw, StickyNote, Table } from "lucide-react";
import { exportQuotationToExcel } from "@/lib/quotations/export-to-excel";
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

function PageBreakItemList({
  pageAssignments,
  pageFlowMode,
  settings,
  toggleManualPageBreak,
}: {
  pageAssignments: ReturnType<typeof quotationPdfItemPageAssignments>;
  pageFlowMode: "auto" | "manual";
  settings: QuotationPdfSettings;
  toggleManualPageBreak: (itemId: string, enabled: boolean) => void;
}) {
  return (
    <div className="mt-3 grid min-w-0 gap-2">
            {pageAssignments.map((assignment, index) => {
              // "Break after" this item = the stored "new page before" flag on the NEXT item in printed order.
              const nextItemId = pageAssignments[index + 1]?.itemId;
              const breakAfter = nextItemId ? settings.manualPageBreaks.includes(nextItemId) : false;
              return (
              <div key={assignment.itemId} className="min-w-0">
              <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-3 text-xs">
                <p className="break-words font-medium text-zinc-900">{assignment.serial ? `${assignment.serial}. ` : ""}{assignment.itemName}</p>
                <dl className="mt-2 grid gap-1 text-zinc-600">
                  <div><dt className="inline font-semibold">Section: </dt><dd className="inline break-words">{assignment.sectionTitle}</dd></div>
                  <div><dt className="inline font-semibold">Page: </dt><dd className="inline">{assignment.pageNumber}</dd></div>
                </dl>
                  {nextItemId ? (
                  <label className="mt-3 flex min-h-9 items-center gap-2 text-zinc-700">
                    <input
                      type="checkbox"
                      checked={breakAfter}
                      disabled={pageFlowMode !== "manual"}
                      onChange={(event) => toggleManualPageBreak(nextItemId, event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900/20 disabled:cursor-not-allowed"
                    />
                    <span>Break after</span>
                  </label>
                  ) : (
                  <p className="mt-3 text-zinc-400">Last item</p>
                  )}
              </div>
              {breakAfter ? (
                <div className="mt-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
                  <span className="h-px flex-1 bg-emerald-300" />
                  New page
                  <span className="h-px flex-1 bg-emerald-300" />
                </div>
              ) : null}
              </div>
              );
            })}
    </div>
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
      <PageBreakItemList
        pageAssignments={pageAssignments}
        pageFlowMode={pageFlowMode}
        settings={settings}
        toggleManualPageBreak={toggleManualPageBreak}
      />
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
  // Viewer toolbar (preview only): page navigation, preview zoom steps, fullscreen.
  const PDF_ZOOM_STEPS = [75, 100, 125, 150] as const;
  const [pdfZoom, setPdfZoom] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [isViewerFullscreen, setIsViewerFullscreen] = useState(false);
  // Settings panel tab (UI only; switching tabs never changes any setting).
  const [activeTab, setActiveTab] = useState<"layout" | "table" | "pageFlow" | "closing" | "notes" | "planner">("layout");
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

  // Page tracking: the page with the most visible height is the current one. Pages are found by class, so the PDF document
  // component is not touched.
  useEffect(() => {
    const root = previewContentRef.current;
    if (!root) return;

    const pages = Array.from(root.querySelectorAll<HTMLElement>(".quotation-pdf-page"));
    setTotalPages(Math.max(pages.length, 1));
    setCurrentPage((current) => Math.min(current, Math.max(pages.length, 1)));
    if (!pages.length || typeof IntersectionObserver === "undefined") return;

    const visibleHeight = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visibleHeight.set(entry.target, entry.isIntersecting ? entry.intersectionRect.height : 0));
        let best = -1;
        let bestHeight = 0;
        pages.forEach((page, index) => {
          const height = visibleHeight.get(page) ?? 0;
          if (height > bestHeight) {
            bestHeight = height;
            best = index;
          }
        });
        if (best >= 0) setCurrentPage(best + 1);
      },
      { threshold: Array.from({ length: 21 }, (_, index) => index / 20) },
    );
    pages.forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [data, previewSettings, pdfZoom, isViewerFullscreen]);

  useEffect(() => {
    if (!isViewerFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsViewerFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isViewerFullscreen]);

  function goToPage(page: number) {
    const pages = previewContentRef.current?.querySelectorAll<HTMLElement>(".quotation-pdf-page");
    if (!pages?.length) return;
    const target = Math.min(Math.max(Math.round(page), 1), pages.length);
    pages[target - 1].scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(target);
  }

  function commitPageInput() {
    const value = Number.parseInt(pageInput ?? "", 10);
    setPageInput(null);
    if (Number.isFinite(value)) goToPage(value);
  }

  function stepPdfZoom(direction: -1 | 1) {
    const index = PDF_ZOOM_STEPS.indexOf(pdfZoom as (typeof PDF_ZOOM_STEPS)[number]);
    const next = PDF_ZOOM_STEPS[Math.min(Math.max(index + direction, 0), PDF_ZOOM_STEPS.length - 1)];
    setPdfZoom(next);
  }

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

  const [isExcelBusy, setIsExcelBusy] = useState(false);

  // Excel always exports the saved server quotation (same rule as the other downloads), so no unsaved-settings check.
  async function downloadExcel() {
    if (isExcelBusy) return;
    setIsExcelBusy(true);
    try {
      await exportQuotationToExcel(data.quotation.id);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Excel export failed.");
    } finally {
      setIsExcelBusy(false);
    }
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
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-[#F6F7F9] px-3 py-3 xl:overflow-x-visible xl:px-4 xl:py-5">
      <div className={`mx-auto grid max-w-[calc(297mm+2rem+440px+1.25rem)] gap-5 ${showSettings ? "xl:grid-cols-[minmax(0,calc(297mm+2rem))_minmax(400px,440px)]" : "xl:grid-cols-[minmax(0,calc(297mm+2rem))]"} xl:items-start xl:justify-center`}>
        <div className="min-w-0 xl:contents">
          <div className={`${showSettings ? "xl:block" : "xl:hidden"} mx-auto mb-5 w-full max-w-full rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm xl:sticky xl:top-5 xl:col-start-2 xl:row-start-1 xl:mb-0 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:p-4`}>
          <div className="grid gap-3 xl:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/quotations/${data.quotation.id}`} className="inline-flex h-10 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700">
                Back
              </Link>
              <button type="button" onClick={downloadExcel} disabled={isExcelBusy} className="inline-flex h-10 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60">
                {isExcelBusy ? "Downloading..." : "Download Excel"}
              </button>
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
          <div className="hidden gap-4 xl:grid">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold leading-tight text-[#151A24]">Quotation PDF Settings</h2>
                <p className="mt-1 text-sm text-[#6B7380]">Manage the layout, content and appearance of your quotation PDF.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings((current) => !current)}
                title={showSettings ? "Hide Settings" : "Show Settings"}
                aria-label={showSettings ? "Hide Settings" : "Show Settings"}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
              >
                <PanelRightClose aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/quotations/${data.quotation.id}`} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold border border-zinc-300 bg-white text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Back to Quotation
              </Link>
              <button type="button" onClick={saveSettings} disabled={isPending} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700">
                <Check aria-hidden="true" className="h-4 w-4" />
                {isPending ? "Saving..." : "Save PDF Settings"}
              </button>
              <button type="button" onClick={resetSettings} disabled={isPending} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold border border-zinc-300 bg-white text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed">
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Reset PDF Settings
              </button>
              <button type="button" onClick={downloadPdf} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800">
                <Download aria-hidden="true" className="h-4 w-4" />
                Download PDF
              </button>
              <button type="button" onClick={downloadExcel} disabled={isExcelBusy} className="col-span-2 inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold border border-zinc-300 bg-white text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">
                <FileSpreadsheet aria-hidden="true" className="h-4 w-4" />
                {isExcelBusy ? "Downloading..." : "Download Excel"}
              </button>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 ${isDirty ? "border-emerald-200 bg-emerald-50" : "border-zinc-200 bg-zinc-50"}`}>
              <div className="flex items-center gap-2">
                <CircleCheck aria-hidden="true" className={`h-4 w-4 shrink-0 ${isDirty ? "text-emerald-700" : "text-zinc-400"}`} />
                <p className={`text-sm font-medium ${isDirty ? "text-emerald-900" : "text-zinc-600"}`}>
                  {isDirty ? "You have unsaved PDF setting changes." : "PDF settings match latest saved version."}
                </p>
              </div>
              {feedback ? <p className="mt-2 text-sm font-medium text-zinc-900">{feedback}</p> : null}
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
                <div role="tablist" aria-label="PDF settings groups" className="flex flex-wrap gap-2">
                  {([
                    ["layout", "Layout", LayoutGrid],
                    ["table", "Table", Table],
                    ["pageFlow", "Page Flow", FileText],
                    ["closing", "Closing", PenLine],
                    ["notes", "Notes", StickyNote],
                    ["planner", "Planner", ListOrdered],
                  ] as const).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === id}
                      onClick={() => setActiveTab(id)}
                      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${activeTab === id ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"}`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
                {activeTab === "layout" ? (
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
                ) : null}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                  {activeTab === "table" ? (
                  <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Table Options</p>
                    <ToggleRow checked={settings.repeatTableHeader} label="Repeat table header on continuation pages" onChange={(checked) => updateSettings({ repeatTableHeader: checked })} />
                    <ToggleRow checked={settings.showFullHeaderOnlyFirstPage} label="Full header only on first page" onChange={(checked) => updateSettings({ showFullHeaderOnlyFirstPage: checked })} />
                    <ToggleRow checked={settings.keepSectionTogether} label="Keep section together" onChange={(checked) => updateSettings({ keepSectionTogether: checked })} />
                    <ToggleRow checked={settings.startEachSectionOnNewPage} label="Start each section on a new page" onChange={(checked) => updateSettings({ startEachSectionOnNewPage: checked })} />
                  </div>
                  ) : null}

                  {activeTab === "pageFlow" ? (
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
                    {pageFlowMode === "manual" ? (
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-500">Tick Break after to start the next item on a new page.</p>
                        <div className="xl:max-h-[60vh] xl:overflow-y-auto xl:overscroll-contain">
                          <PageBreakItemList
                            pageAssignments={pageAssignments}
                            pageFlowMode={pageFlowMode}
                            settings={settings}
                            toggleManualPageBreak={toggleManualPageBreak}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  ) : null}
                </div>

                {activeTab === "closing" ? (
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
                ) : null}

                {activeTab === "notes" ? (
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
                ) : null}
              </div>

              {activeTab === "planner" ? (
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
              ) : null}

            </div>
          ) : null}
        </div>

          <div className="min-w-0 xl:col-start-1 xl:row-start-1">
            <div className="mb-4">
              <Link href={`/quotations/${data.quotation.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#6B7380] transition hover:text-[#151A24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Back to Quotation
              </Link>
              <h1 className="mt-2 text-[28px] font-bold leading-tight text-[#151A24]">Edit Quotation PDF Settings</h1>
              <p className="mt-1 text-sm text-[#6B7380]">Customize how your quotation appears in the PDF output. Changes are saved to your account settings.</p>
            </div>

            <div className={isViewerFullscreen ? "fixed inset-0 z-50 flex flex-col bg-white" : "overflow-clip rounded-2xl border border-[#E3E7ED] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"}>
              <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-[#E3E7ED] bg-white px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <input
                    aria-label="Page number"
                    inputMode="numeric"
                    value={pageInput ?? String(currentPage)}
                    onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, ""))}
                    onBlur={commitPageInput}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    className="h-8 w-10 rounded-lg border border-[#D5DAE2] bg-white text-center text-sm font-semibold text-[#151A24] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800"
                  />
                  <span className="text-sm text-[#6B7380]">/ {totalPages}</span>
                  <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} aria-label="Next page" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>

                <div className="hidden items-center rounded-lg border border-[#D5DAE2] bg-white xl:inline-flex">
                  <button type="button" onClick={() => stepPdfZoom(-1)} disabled={pdfZoom <= PDF_ZOOM_STEPS[0]} aria-label="Zoom preview out" className="inline-flex h-8 w-8 items-center justify-center rounded-l-lg text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
                    <Minus aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <span className="min-w-14 text-center text-sm font-semibold text-[#151A24]">{pdfZoom}%</span>
                  <button type="button" onClick={() => stepPdfZoom(1)} disabled={pdfZoom >= PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1]} aria-label="Zoom preview in" className="inline-flex h-8 w-8 items-center justify-center rounded-r-lg text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40">
                    <Plus aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsViewerFullscreen((current) => !current)}
                  aria-label={isViewerFullscreen ? "Exit full screen" : "Full screen"}
                  aria-pressed={isViewerFullscreen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#D5DAE2] bg-white text-[#151A24] transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isViewerFullscreen ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
                </button>
              </div>

              <div className={isViewerFullscreen ? "min-h-0 flex-1 overflow-y-auto bg-zinc-100" : "bg-zinc-100"}>
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
              <div ref={previewViewportRef} className="min-w-0 overflow-x-auto overscroll-x-contain xl:overflow-x-auto">
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
                    <div style={{ zoom: pdfZoom / 100 }} className="[&_.quotation-pdf-page]:scroll-mt-16">
                      <QuotationPdfDocument data={data} settings={previewSettings} printMode={false} showToolbar={false} />
                    </div>
                  </div>
                </div>
              </div>
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
