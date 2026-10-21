"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Dexie, { type Table } from "dexie";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Maximize2, Minus, PanelRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { createMaterial, createMaterialsFromImport } from "@/app/products/materials/actions";
import { buildReviewRows, chunkImportRows, evaluateRows, importCodeKey, importName, subgroupText, type ExistingMaterial, type ReviewRow, type ImportSubgroup } from "@/lib/products/pdf-import-rows";
import { detectSwatchPage, defaultLabelOptions, labelStyles, imageRectsFromOps, normalizeTextItems, type DetectInput, type LabelOptions, type LabelStyleId, type DetectedSwatch, type ImageRect } from "@/lib/products/pdf-swatch-detect";
import { uploadBrandMaterialImage } from "@/lib/quotation-image-upload";
import { createClient } from "@/lib/supabase/client";

type Box = { h: number; w: number; x: number; y: number };
type Zoom = number | "fit";
type DragMode = "create" | "move" | "nw" | "ne" | "sw" | "se";
type PanelMode = "side" | "full" | "min";
type NameLanguage = "auto" | "italian" | "english" | "french" | "both";
type Recent = { blob: Blob; id?: number; name: string; openedAt: number; page: number; size: number; zoom: Zoom };
type ParseSettings = LabelOptions & { styleId: LabelStyleId | "auto" };
const defaultSettings: ParseSettings = { ...defaultLabelOptions, styleId: "auto" };
const parseSettingsKey = (name: string) => `material-pdf-label-settings:${name}`;

const MAX_SIDE = 1200;
const MAX_CANVAS = 4096;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_STORED_BYTES = 150 * 1024 * 1024;
const MIN_PIXELS = 12;
const WIDTH_KEY = "material-pdf-import-panel-width";
const SIDE_MIN_SCREEN = 1024;
const SIDE_MIN_WIDTH = 380;
const LANGUAGE_KEY = "material-pdf-import-name-language";
const languages: Array<[Exclude<NameLanguage, "auto">, string]> = [["italian", "Italian"], ["english", "English"], ["french", "French"], ["both", "English + Italian"]];

function formatName(item: DetectedSwatch, language: Exclude<NameLanguage, "auto">) {
  if (language === "english") return item.nameEnglish || item.namePrimary;
  if (language === "french") return item.nameOther || item.nameEnglish || item.namePrimary;
  if (language === "both") return item.nameEnglish ? `${item.nameEnglish} / ${item.namePrimary}` : item.namePrimary;
  return item.namePrimary;
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Separate local database, so it can never touch the quotation builder's data. Every call is wrapped: failures only disable "recent PDFs".
class MaterialPdfDb extends Dexie {
  recents!: Table<Recent, number>;
  constructor() {
    super("material-pdf-import");
    this.version(1).stores({ recents: "++id, openedAt" });
  }
}
let database: MaterialPdfDb | null = null;
const db = () => (database ??= new MaterialPdfDb());

// Same loading approach as components/products/source-qa-crop-viewer.tsx: dynamic import of the legacy build and a module worker URL.
async function startPdf(data: ArrayBuffer): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  return pdfjs.getDocument({ data });
}

type ListStatus = "ready" | "duplicate" | "created" | "error";

// Re-checks every open row against the known materials: same code + same sub-group is blocked, other sub-groups are only a note.
function refreshRows<R extends ReviewRow & { status: ListStatus }>(rows: R[], known: ExistingMaterial[]): R[] {
  const states = evaluateRows(rows, known, (row) => row.status === "created");
  return rows.map((row, index) => {
    if (row.status === "created") return row;
    const state = states[index];
    const wasBlocked = row.status === "duplicate" && !state.duplicate;
    return {
      ...row,
      alsoIn: state.alsoIn,
      checked: state.duplicate ? false : wasBlocked ? Boolean(row.name.trim()) && state.alsoIn.length === 0 : row.checked,
      duplicate: state.duplicate,
      status: state.duplicate ? "duplicate" : wasBlocked ? "ready" : row.status,
    };
  });
}

export function PdfMaterialImport({
  brandId,
  currentSubgroupId,
  groupId,
  groupName,
  brandName,
  onClose,
  minimizeToken = 0,
  onLayout,
  returnTo,
  subgroupOptions,
  existingMaterials,
}: {
  brandId: string;
  currentSubgroupId: string;
  groupId: string;
  groupName: string;
  brandName: string;
  onClose: () => void;
  // Bumped by the page when another side panel (the swatch viewer) opens: a side-docked panel then minimizes (it stays mounted).
  minimizeToken?: number;
  // Right padding (px) the page needs while the side panel is open; 0 otherwise.
  onLayout: (paddingRight: number) => void;
  returnTo: string;
  subgroupOptions: Array<{ id: string; label: string }>;
  // Active materials of the group (code, sub-group id, readable sub-group label): used for the duplicate rule.
  existingMaterials: ExistingMaterial[];
}) {
  const router = useRouter();
  type Row = ReviewRow & { id: string; page: number; preview: string; status: "ready" | "duplicate" | "created" | "error"; message?: string; codeEdited?: boolean; sectionKey?: string; sectionEdited?: boolean; targetEdited?: boolean };
  const [tab, setTab] = useState<"page" | "review">("page");
  const [rows, setRows] = useState<Row[]>([]);
  const [parseSettings, setParseSettings] = useState<ParseSettings>(defaultSettings);
  const [chosenStyle, setChosenStyle] = useState<LabelStyleId>("code-then-name");
  const textCache = useRef(new Map<number, DetectInput>());
  const [bulkSaving, setBulkSaving] = useState(false);
  const bulkBusy = useRef(false);
  const cancelBulk = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState("");
  // "Next page and detect": inline confirm when ticked rows are not saved, and the banner button after a clean bulk save.
  const [confirmNext, setConfirmNext] = useState(false);
  const [summaryOffersNext, setSummaryOffersNext] = useState(false);
  const [groupMaterials, setGroupMaterials] = useState(existingMaterials);
  // Swatches saved in this session (single or bulk): known right away, before the page props refresh.
  const [savedMaterials, setSavedMaterials] = useState<ExistingMaterial[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [addedSubgroups, setAddedSubgroups] = useState<ImportSubgroup[]>([]);
  const reviewSubgroups: ImportSubgroup[] = subgroupOptions.map((option) => {
    const parts = option.label.split(" · ");
    return { id: option.id, name: parts.length > 1 ? parts.slice(1).join(" · ") : parts[0], grade: parts.length > 1 ? parts[0] : null };
  }).concat(addedSubgroups.filter((sub) => !subgroupOptions.some((option) => option.id === sub.id)));
  const searchParams = useSearchParams();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState("");
  const [recents, setRecents] = useState<Recent[]>([]);
  const [rememberFailed, setRememberFailed] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState<Box | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [subgroupId, setSubgroupId] = useState(currentSubgroupId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [renderTick, setRenderTick] = useState(0);
  const [loadError, setLoadError] = useState("");
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const recentIdRef = useRef<number | null>(null);
  const drag = useRef<{ anchorX: number; anchorY: number; box: Box | null; mode: DragMode; x: number; y: number } | null>(null);
  const pending = useRef<{ advance: boolean; code: string; key: string | null; label: string; subgroupId: string | null; token: string } | null>(null);
  // Auto detect (current page only): boxes in reading order, the selected one, and boxes saved in this session.
  const [detected, setDetected] = useState<DetectedSwatch[]>([]);
  const [detectedPage, setDetectedPage] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(() => new Set());
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [language, setLanguage] = useState<NameLanguage>(() => {
    try {
      const stored = window.localStorage.getItem(LANGUAGE_KEY);
      return languages.some(([value]) => value === stored) ? (stored as NameLanguage) : "auto";
    } catch {
      return "auto";
    }
  });
  const imageCache = useRef(new Map<number, ImageRect[]>());
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [fitTick, setFitTick] = useState(0);
  const [narrow, setNarrow] = useState(() => window.innerWidth < SIDE_MIN_SCREEN);
  const [mode, setMode] = useState<PanelMode>(() => (window.innerWidth < SIDE_MIN_SCREEN ? "full" : "side"));
  const lastVisibleMode = useRef<Exclude<PanelMode, "min">>("side");
  const [width, setWidth] = useState(() => {
    let stored = 0;
    try {
      stored = Number(window.localStorage.getItem(WIDTH_KEY)) || 0;
    } catch {
      stored = 0;
    }
    return clamp(stored || window.innerWidth * 0.55, SIDE_MIN_WIDTH, window.innerWidth * 0.8);
  });
  const widthDrag = useRef(false);
  // Under 1024 px the panel is always full screen (the Side button is hidden); minimize still works.
  const shown: PanelMode = narrow && mode === "side" ? "full" : mode;
  const [seenMinimizeToken, setSeenMinimizeToken] = useState(minimizeToken);
  if (minimizeToken !== seenMinimizeToken) {
    setSeenMinimizeToken(minimizeToken);
    if (shown === "side") setMode("min");
  }
  const sideOpen = shown === "side";

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${SIDE_MIN_SCREEN - 1}px)`);
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (shown !== "min") lastVisibleMode.current = shown;
  }, [shown]);

  useEffect(() => {
    onLayout(sideOpen ? width : 0);
    return () => onLayout(0);
  }, [onLayout, sideOpen, width]);

  const onDividerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    widthDrag.current = true;
  };
  const onDividerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (widthDrag.current) setWidth(clamp(window.innerWidth - event.clientX, SIDE_MIN_WIDTH, window.innerWidth * 0.8));
  };
  const onDividerUp = () => {
    if (!widthDrag.current) return;
    widthDrag.current = false;
    try {
      window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      // Storage blocked: the width simply is not remembered.
    }
  };

  const refreshRecents = useCallback(async () => {
    try {
      setRecents(await db().recents.orderBy("openedAt").reverse().toArray());
    } catch {
      setRecents([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    db().recents.orderBy("openedAt").reverse().toArray()
      .then((list) => { if (!cancelled) setRecents(list); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const openFile = useCallback(async (file: Blob, label: string, restore?: Recent) => {
    setLoadError("");
    try {
      void taskRef.current?.destroy();
      const task = await startPdf(await file.arrayBuffer());
      taskRef.current = task;
      const next = await task.promise;
      setDoc(next);
      setFileName(label);
      let settings = defaultSettings;
      try {
        const saved = JSON.parse(window.localStorage.getItem(parseSettingsKey(label)) || "null");
        if (saved) settings = {
          styleId: labelStyles.some((style) => style.id === saved.styleId) ? saved.styleId : "auto",
          altCodeMode: ["append", "ignore", "use-as-code"].includes(saved.altCodeMode) ? saved.altCodeMode : "ignore",
          tidyNames: ["capitalise-first", "title-case", "as-written"].includes(saved.tidyNames) ? saved.tidyNames : "capitalise-first",
          roundInset: saved.roundInset === true,
        };
      } catch { /* Settings are optional on browsers with blocked storage. */ }
      setParseSettings(settings); textCache.current = new Map();
      setPageNumber(restore ? clamp(restore.page, 1, next.numPages) : 1);
      setPageInput(String(restore ? clamp(restore.page, 1, next.numPages) : 1));
      setZoom(restore?.zoom ?? "fit");
      setBox(null);
      imageCache.current = new Map();
      setDetected([]);
      setRows([]);
      setTab("page");
      setSummary("");
      setSelectedIdx(-1);
      setDetectMessage("");
      recentIdRef.current = null;
      setRememberFailed(false);
      if (file.size > MAX_STORED_BYTES) {
        setRememberFailed(true);
        return;
      }
      try {
        const existing = restore?.id ? await db().recents.get(restore.id) : (await db().recents.toArray()).find((item) => item.name === label && item.size === file.size);
        const record: Recent = { blob: file, id: existing?.id, name: label, openedAt: Date.now(), page: restore?.page ?? 1, size: file.size, zoom: restore?.zoom ?? "fit" };
        const id = await db().recents.put(record);
        recentIdRef.current = id;
        const all = await db().recents.orderBy("openedAt").reverse().toArray();
        await Promise.all(all.slice(3).map((item) => (item.id ? db().recents.delete(item.id) : Promise.resolve())));
      } catch {
        setRememberFailed(true);
      }
    } catch {
      setLoadError("This PDF could not be opened.");
    }
  }, [setDoc, setPageInput, setZoom, setBox, setDetected, setSelectedIdx, setDetectMessage]);

  useEffect(() => () => { void taskRef.current?.destroy(); }, []);

  // Remember the last page and zoom (at most once every 3 seconds).
  useEffect(() => {
    if (!doc || recentIdRef.current === null) return;
    const timer = window.setTimeout(() => {
      const id = recentIdRef.current;
      if (id !== null) void db().recents.update(id, { page: pageNumber, zoom }).catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [doc, pageNumber, zoom]);

  // Render ONLY the visible page; the previous one is cancelled and cleaned up.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let pageProxy: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | null = null;
    void (async () => {
      try {
        pageProxy = await doc.getPage(pageNumber);
        const base = pageProxy.getViewport({ scale: 1 });
        if (!holderRef.current || holderRef.current.clientWidth === 0) return; // hidden (minimized): nothing to draw
        const holderWidth = holderRef.current.clientWidth - 16;
        const nextScale = zoom === "fit" ? Math.max(0.2, holderWidth / base.width) : zoom;
        const viewport = pageProxy.getViewport({ scale: nextScale * (window.devicePixelRatio || 1) });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
        canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
        task = pageProxy.render({ canvas, canvasContext: context, viewport });
        await task.promise;
        if (!cancelled) {
          setScale(nextScale);
          setRenderTick((tick) => tick + 1);
        }
      } catch {
        // A cancelled render (page changed) is expected.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      pageProxy?.cleanup();
    };
  }, [doc, pageNumber, zoom, fitTick]);

  // Re-fit when the panel or window changes size (also when the panel comes back from minimized).
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || typeof ResizeObserver === "undefined") return;
    let first = true;
    const observer = new ResizeObserver(() => { if (!holder.clientWidth) return; if (first) first = false; else if (zoom === "fit") setFitTick((tick) => tick + 1); });
    observer.observe(holder);
    return () => observer.disconnect();
  }, [zoom, doc]);

  // Live preview of the crop (drawn from the visible canvas).
  useEffect(() => {
    const source = canvasRef.current;
    const target = previewRef.current;
    if (!source || !target) return;
    const context = target.getContext("2d");
    if (!context) return;
    if (!box) {
      context.clearRect(0, 0, target.width, target.height);
      return;
    }
    const sw = box.w * source.width;
    const sh = box.h * source.height;
    const ratio = Math.min(1, 220 / Math.max(sw, sh));
    target.width = Math.max(1, Math.round(sw * ratio));
    target.height = Math.max(1, Math.round(sh * ratio));
    context.drawImage(source, box.x * source.width, box.y * source.height, sw, sh, 0, 0, target.width, target.height);
  }, [box, renderTick]);

  const goTo = (next: number) => {
    if (!doc) return;
    const target = clamp(Math.round(next) || 1, 1, doc.numPages);
    setPageNumber(target);
    setPageInput(String(target));
    setBox(null);
    setSelectedIdx(-1);
    setDetectMessage("");
  };

  const languageFor = (list: DetectedSwatch[]): Exclude<NameLanguage, "auto"> =>
    language === "auto" ? (list.some((item) => item.nameEnglish) ? "english" : "italian") : language;
  const swatchKey = (page: number, item: DetectedSwatch) => `${fileName}:${page}:${Math.round((item.sourceBox || item.box).x * 1000)}:${Math.round((item.sourceBox || item.box).y * 1000)}`;
  const onThisPage = detectedPage === pageNumber ? detected : [];
  const selected = onThisPage[selectedIdx];

  // Sub-group labels look like "CAT B · Crepe" (grade · name) or just "Crepe".
  const matchSubgroup = (item: DetectedSwatch) => {
    if (!item.grade && !item.collection) return null;
    const wantGrade = item.grade.toLowerCase();
    const wantName = item.collection.toLowerCase();
    const found = subgroupOptions.find((option) => {
      const parts = option.label.split(" · ");
      const grade = (parts.length > 1 ? parts[0] : "").trim().toLowerCase();
      const optionName = (parts.length > 1 ? parts.slice(1).join(" · ") : parts[0]).trim().toLowerCase();
      return grade === wantGrade && (!wantName || optionName === wantName);
    });
    return found?.id ?? null;
  };

  const selectDetected = (index: number, list: DetectedSwatch[] = onThisPage) => {
    const item = list[index];
    if (!item) return;
    setSelectedIdx(index);
    // About 1% inset on every side, so the picture edge does not bleed in.
    setBox(item.roundInset ? item.box : { h: item.box.h * 0.98, w: item.box.w * 0.98, x: item.box.x + item.box.w * 0.01, y: item.box.y + item.box.h * 0.01 });
    setCode(item.code);
    setName(formatName(item, languageFor(list)));
    setNameTouched(false);
    setError("");
    const subgroupMatch = matchSubgroup(item);
    if (subgroupMatch) setSubgroupId(subgroupMatch);
  };

  // One place for "a swatch was saved" (single save and bulk save): marks the rows, remembers the code, counts it.
  const recordSaved = (items: ExistingMaterial[], rowIds: string[]) => {
    setSavedMaterials((previous) => [...previous, ...items]);
    setSavedCount((count) => count + items.length);
    setRows((current) => refreshRows(
      current.map((row) => (rowIds.includes(row.id) ? { ...row, checked: false, message: undefined, status: "created" as const } : row)),
      [...groupMaterials, ...savedMaterials, ...items],
    ));
  };
  const subgroupLabelOf = (id: string | null) => {
    const sub = reviewSubgroups.find((candidate) => candidate.id === id);
    return sub ? subgroupText(sub) : "";
  };

  const nextUnsaved = (from: number, list: DetectedSwatch[], saved: Set<string>) => {
    for (let index = from + 1; index < list.length; index += 1) if (!saved.has(swatchKey(pageNumber, list[index]))) return index;
    return -1;
  };

  const changeParseSettings = (next: ParseSettings) => {
    if (busy || bulkSaving || detecting) return;
    try {
      const pages = [...textCache.current].map(([page, data]) => ({ page, result: detectSwatchPage(data, next.styleId, next) }));
      setRows((current) => refreshRows(current.map((row) => {
        if (row.status === "created") return row;
        const swatch = pages.find((entry) => entry.page === row.page)?.result.swatches.find((item) => swatchKey(row.page, item) === row.id);
        if (!swatch) return row;
        const updated = row.sectionEdited ? { ...swatch, collection: row.swatch.collection, grade: row.swatch.grade } : swatch;
        const target = buildReviewRows([updated], languageFor([updated]), reviewSubgroups, [])[0];
        const code = row.codeEdited ? row.code : updated.code;
        return { ...row, swatch: updated, code, name: row.nameEdited ? row.name : target.name, checked: Boolean(code.trim()) && row.checked,
          ...(row.targetEdited ? {} : { subgroupId: target.subgroupId, newSubgroup: target.newSubgroup }) };
      }), [...groupMaterials, ...savedMaterials]));
      const page = pages.find((entry) => entry.page === pageNumber);
      if (page) {
        const swatches = page.result.swatches.map((item) => {
          const row = rows.find((row) => row.id === swatchKey(pageNumber, item));
          return row?.sectionEdited ? { ...item, collection: row.swatch.collection, grade: row.swatch.grade } : item;
        });
        setDetected(swatches); setDetectedPage(pageNumber); setChosenStyle(page.result.styleId);
        const item = swatches[selectedIdx];
        if (item) {
          const previousCrop = selected?.roundInset ? selected.box : selected ? { h: selected.box.h * 0.98, w: selected.box.w * 0.98, x: selected.box.x + selected.box.w * 0.01, y: selected.box.y + selected.box.h * 0.01 } : null;
          if (next.roundInset !== parseSettings.roundInset && box && previousCrop && (["x", "y", "w", "h"] as const).every((key) => Math.abs(box[key] - previousCrop[key]) < 1e-8)) {
            setBox(item.roundInset ? item.box : { h: item.box.h * 0.98, w: item.box.w * 0.98, x: item.box.x + item.box.w * 0.01, y: item.box.y + item.box.h * 0.01 });
          }
          if (code === selected?.code) setCode(item.code);
          if (!nameTouched) setName(formatName(item, languageFor(swatches)));
        }
      }
      setParseSettings(next);
      try { window.localStorage.setItem(parseSettingsKey(fileName), JSON.stringify(next)); } catch { /* Keep the current settings in memory. */ }
    } catch { setDetectMessage("Could not apply these label settings. Your current rows were kept."); }
  };

  const runDetect = async (page?: number) => {
    if (!doc || detecting) return;
    const pageAtStart = page ?? pageNumber;
    setDetecting(true);
    setDetectMessage("");
    try {
      // The parent view may show only one sub-group; check the whole group before flagging duplicates.
      const client = createClient();
      // Labels for every sub-group of the group, inactive ones too ("CAT B - Crepe (inactive)").
      const subgroupRead = await client.from("brand_material_subgroups").select("id,name,grade,is_active").eq("material_group_id", groupId);
      const labelById = new Map((subgroupRead.data || []).map((sub) => [sub.id as string, `${subgroupText({ grade: sub.grade, name: sub.name })}${sub.is_active ? "" : " (inactive)"}`]));
      const allMaterials: ExistingMaterial[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await client.from("brand_materials").select("material_code,subgroup_id").eq("material_group_id", groupId).eq("is_active", true).order("id").range(offset, offset + 999);
        if (result.error) throw new Error("Could not check existing codes.");
        for (const item of result.data || []) {
          const sub = reviewSubgroups.find((candidate) => candidate.id === item.subgroup_id);
          allMaterials.push({ code: item.material_code || "", label: item.subgroup_id ? labelById.get(item.subgroup_id) ?? (sub ? subgroupText(sub) : "another sub-group") : "", subgroupId: item.subgroup_id ?? null });
        }
        if ((result.data?.length || 0) < 1000) break;
      }
      const pageProxy = await doc.getPage(pageAtStart);
      const viewport = pageProxy.getViewport({ scale: 1 });
      let images = imageCache.current.get(pageAtStart);
      if (!images) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const list = await pageProxy.getOperatorList();
        images = imageRectsFromOps(list, pdfjs.OPS as unknown as Record<string, number>, viewport.transform);
        imageCache.current.set(pageAtStart, images);
      }
      let data = textCache.current.get(pageAtStart);
      if (!data) {
        const content = await pageProxy.getTextContent();
        const text = normalizeTextItems(content.items as Array<{ height?: number; str?: string; transform?: number[]; width?: number; fontName?: string }>, viewport.transform);
        data = { images, pageHeight: viewport.height, pageWidth: viewport.width, text };
        textCache.current.set(pageAtStart, data);
      }
      const parsed = detectSwatchPage(data, parseSettings.styleId, parseSettings);
      const found = parsed.swatches;
      setChosenStyle(parsed.styleId);
      const previews: string[] = [];
      const thumbnailPage = document.createElement("canvas");
      try {
        const smallView = pageProxy.getViewport({ scale: Math.min(1.5, MAX_CANVAS / Math.max(viewport.width, viewport.height)) });
        thumbnailPage.width = Math.ceil(smallView.width); thumbnailPage.height = Math.ceil(smallView.height);
        const context = thumbnailPage.getContext("2d");
        if (!context) throw new Error("Could not prepare previews.");
        await pageProxy.render({ canvas: thumbnailPage, canvasContext: context, viewport: smallView }).promise;
        for (const item of found) {
          const previewBox = item.sourceBox || item.box;
          const preview = document.createElement("canvas");
          try {
            const sw = previewBox.w * thumbnailPage.width, sh = previewBox.h * thumbnailPage.height;
            const ratio = 160 / Math.max(sw, sh, 1);
            preview.width = Math.max(1, Math.round(sw * ratio)); preview.height = Math.max(1, Math.round(sh * ratio));
            preview.getContext("2d")?.drawImage(thumbnailPage, previewBox.x * thumbnailPage.width, previewBox.y * thumbnailPage.height, sw, sh, 0, 0, preview.width, preview.height);
            previews.push(preview.toDataURL("image/jpeg", 0.8));
          } finally { preview.width = 0; preview.height = 0; }
        }
      } finally { thumbnailPage.width = 0; thumbnailPage.height = 0; }
      const known = [...allMaterials, ...savedMaterials];
      const review = buildReviewRows(found, languageFor(found), reviewSubgroups, known);
      setGroupMaterials(allMaterials);
      setRows((previous) => {
        const kept = previous.filter((row) => row.page !== pageAtStart);
        const next = review.map((row, index): Row => {
          const id = swatchKey(pageAtStart, row.swatch);
          return previous.find((old) => old.id === id) ?? { ...row, checked: row.checked && Boolean(row.code.trim()), sectionKey: `${pageAtStart}:${row.swatch.bandId?.split(":")[1] || ""}:${row.swatch.collection}|${row.swatch.grade}`, id, page: pageAtStart, preview: previews[index], status: row.duplicate ? "duplicate" : "ready" };
        });
        // Re-detecting never ticks rows that are saved or already exist here.
        return refreshRows([...kept, ...next], known);
      });
      setDetected(found);
      setDetectedPage(pageAtStart);
      setSelectedIdx(-1);
      if (!found.length) {
        setDetectMessage("No swatches found on this page. Draw boxes by hand.");
      } else {
        const first = found.findIndex((item) => !savedKeys.has(swatchKey(pageAtStart, item)));
        selectDetected(first >= 0 ? first : 0, found);
      }
    } catch {
      setDetected([]);
      setDetectMessage("Could not read this page automatically. Draw boxes by hand.");
    } finally {
      setDetecting(false);
    }
  };

  const changeLanguage = (next: Exclude<NameLanguage, "auto">) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // Not remembered on this browser.
    }
    if (selected && !nameTouched) setName(formatName(selected, next));
    setRows((current) => current.map((row) => row.nameEdited || row.status === "created" ? row : { ...row, name: importName(row.swatch, next) }));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const target = event.target as HTMLElement;
    if (target.dataset.role === "detected") {
      selectDetected(Number(target.dataset.index));
      return;
    }
    const role = target.dataset.role as DragMode | undefined;
    const px = clamp(event.clientX - rect.left, 0, rect.width);
    const py = clamp(event.clientY - rect.top, 0, rect.height);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (role && box) {
      const ax = (role.includes("w") ? box.x + box.w : box.x) * rect.width;
      const ay = (role.includes("n") ? box.y + box.h : box.y) * rect.height;
      drag.current = { anchorX: ax, anchorY: ay, box, mode: role, x: event.clientX, y: event.clientY };
    } else {
      drag.current = { anchorX: px, anchorY: py, box: null, mode: "create", x: event.clientX, y: event.clientY };
      setBox(null);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (state.mode === "move" && state.box) {
      setBox({
        ...state.box,
        x: clamp(state.box.x + (event.clientX - state.x) / rect.width, 0, 1 - state.box.w),
        y: clamp(state.box.y + (event.clientY - state.y) / rect.height, 0, 1 - state.box.h),
      });
      return;
    }
    const px = clamp(event.clientX - rect.left, 0, rect.width);
    const py = clamp(event.clientY - rect.top, 0, rect.height);
    const w = Math.abs(px - state.anchorX);
    const h = Math.abs(py - state.anchorY);
    if (state.mode === "create" && (w < MIN_PIXELS || h < MIN_PIXELS) && !box) return;
    setBox({ h: Math.max(h, MIN_PIXELS) / rect.height, w: Math.max(w, MIN_PIXELS) / rect.width, x: Math.min(px, state.anchorX) / rect.width, y: Math.min(py, state.anchorY) / rect.height });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  // The server action redirects back to this page with a message; the result is read from the URL (imp = our token).
  useEffect(() => {
    const waiting = pending.current;
    if (!waiting || searchParams.get("imp") !== waiting.token) return;
    const message = searchParams.get("message") ?? "";
    pending.current = null;
    setBusy(false);
    if (message === "Material created.") {
      setNotice(`Saved ${waiting.label}`);
      recordSaved([{ code: waiting.code, label: subgroupLabelOf(waiting.subgroupId), subgroupId: waiting.subgroupId }], waiting.key ? [waiting.key] : []);
      setBox(null);
      setCode("");
      setName("");
      if (waiting.key) {
        const saved = new Set(savedKeys).add(waiting.key);
        setSavedKeys(saved);
        const index = onThisPage.findIndex((item) => swatchKey(pageNumber, item) === waiting.key);
        if (waiting.advance && index >= 0) {
          // Save and next: the next unsaved box in reading order.
          const next = nextUnsaved(index, onThisPage, saved);
          if (next >= 0) selectDetected(next);
          else setSelectedIdx(-1);
        }
      }
    } else {
      setError(message || "The swatch could not be saved.");
    }
    // Only a new redirect result (searchParams) should run this; the other values are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const renderCrop = async (box: Box, pageNumber: number, code: string, name: string) => {
      if (!doc) throw new Error("Open a PDF first.");
      // Render ONLY the selected area straight from the PDF page at a high scale (not the screen canvas, and not the whole page).
      const pageProxy = await doc.getPage(pageNumber);
      const base = pageProxy.getViewport({ scale: 1 });
      // The box is a fraction of the page, so this is the crop in PDF page units (the same as dividing screen pixels by the screen scale).
      const cropX = box.x * base.width;
      const cropY = box.y * base.height;
      const cropW = Math.max(1, box.w * base.width);
      const cropH = Math.max(1, box.h * base.height);
      const longest = Math.max(cropW, cropH);
      // scale = min(8, max(3, 1200 / longest)), lowered if the offscreen canvas would pass 4096 px.
      let renderScale = Math.min(8, Math.max(3, MAX_SIDE / longest));
      renderScale = Math.min(renderScale, MAX_CANVAS / longest);
      const full = document.createElement("canvas");
      full.width = Math.max(1, Math.ceil(cropW * renderScale));
      full.height = Math.max(1, Math.ceil(cropH * renderScale));
      try {
      const fullContext = full.getContext("2d");
      if (!fullContext) throw new Error("Could not prepare the image.");
      // pdf.js switches smoothing OFF when it draws an embedded picture larger than its native size (it sets ctx.imageSmoothingEnabled
      // itself), which makes small pictures blocky. This offscreen context ignores that: the setter does nothing, so smoothing stays on.
      // Only this offscreen render context is changed, never the on-screen page canvas; if it cannot be done, pdf.js behaves as before.
      try {
        fullContext.imageSmoothingQuality = "high";
        Object.defineProperty(fullContext, "imageSmoothingEnabled", { configurable: true, get: () => true, set: () => undefined });
      } catch {
        // Keep pdf.js' own smoothing choice.
      }
      await pageProxy.render({
        canvas: full,
        canvasContext: fullContext,
        // Shift the page by minus the crop origin, so only the crop area lands on the small canvas.
        transform: [1, 0, 0, 1, -cropX * renderScale, -cropY * renderScale],
        viewport: pageProxy.getViewport({ scale: renderScale }),
      }).promise;
      pageProxy.cleanup();
      let ratio = Math.min(1, MAX_SIDE / Math.max(full.width, full.height));
      let file: File | null = null;
      for (let attempt = 0; attempt < 4 && !file; attempt += 1) {
        const out = document.createElement("canvas");
        out.width = Math.max(1, Math.round(full.width * ratio));
        out.height = Math.max(1, Math.round(full.height * ratio));
        const outContext = out.getContext("2d");
        if (outContext) {
          outContext.imageSmoothingEnabled = true;
          outContext.imageSmoothingQuality = "high";
          outContext.drawImage(full, 0, 0, out.width, out.height);
        }
        for (let quality = 0.9; quality >= 0.4 && !file; quality -= 0.1) {
          const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/webp", quality));
          if (blob && blob.size <= MAX_BYTES) file = new File([blob], `${(code || name).trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "swatch"}.${blob.type === "image/webp" ? "webp" : "png"}`, { type: blob.type });
        }
        out.width = 0;
        out.height = 0;
        ratio *= 0.8;
      }
      // Free the big offscreen canvas.
      full.width = 0;
      full.height = 0;
      if (!file) throw new Error("The cropped image is too large. Draw a smaller box.");
      return file;
      } finally { full.width = 0; full.height = 0; }
  };

  const saveSwatch = async (advance = false) => {
    const canvasSource = canvasRef.current;
    if (!doc || !box || busy || !canvasSource) return;
    if (!name.trim()) {
      setError("Enter a name for the swatch.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const file = await renderCrop(box, pageNumber, code, name);
      const upload = await uploadBrandMaterialImage({ brandId, file, groupId });
      const token = `${Date.now()}`;
      const label = [code.trim(), name.trim()].filter(Boolean).join(" | ");
      pending.current = { advance, code: code.trim(), key: selected ? swatchKey(pageNumber, selected) : null, label, subgroupId: subgroupId || null, token };
      const form = new FormData();
      form.set("brand_id", brandId);
      form.set("material_group_id", groupId);
      form.set("subgroup_id", subgroupId);
      form.set("material_code", code.trim());
      form.set("material_name", name.trim());
      form.set("image_url", `product-images:${upload.path}`);
      // Saved as confirmed (the default). Phase 4C may use needs_review for bulk import.
      form.set("review_status", "confirmed");
      form.set("sort_order", "0");
      form.set("is_active", "on");
      form.set("return_to", `${returnTo}${returnTo.includes("?") ? "&" : "?"}imp=${token}`);
      try {
        await createMaterial(form);
      } catch {
        // The action ends with a redirect; the outcome arrives through the URL (see the effect above).
      }
      window.setTimeout(() => {
        if (pending.current?.token === token) {
          pending.current = null;
          setBusy(false);
          setError("Could not confirm the save. Check the group page before saving again.");
        }
      }, 25000);
    } catch (caught) {
      pending.current = null;
      setBusy(false);
      setError(caught instanceof Error ? caught.message : "The swatch could not be saved.");
    }
  };

  const lastPage = !doc || pageNumber >= doc.numPages;
  const unsavedTicked = rows.filter((row) => row.checked && row.status !== "created").length;
  const goNext = () => {
    setConfirmNext(false);
    setSummaryOffersNext(false);
    goTo(pageNumber + 1);
    // The detect settings (label style, second code, tidy names, round) are kept: they are not touched here.
    void runDetect(pageNumber + 1);
  };
  const nextAndDetect = () => {
    if (lastPage || detecting || bulkSaving) return;
    if (unsavedTicked > 0) setConfirmNext(true);
    else goNext();
  };
  const nextButton = (
    <button type="button" disabled={lastPage || detecting || bulkSaving} onClick={nextAndDetect} className="h-8 rounded-lg border border-emerald-900 bg-white px-2.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-40">Next page and detect</button>
  );
  const confirmNextBlock = confirmNext ? (
    <div role="alertdialog" className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
      <span className="flex-1">{unsavedTicked} rows are not saved. Go to the next page anyway?</span>
      <button type="button" onClick={() => setConfirmNext(false)} className="h-7 rounded-lg border border-zinc-300 bg-white px-2.5 font-semibold">Stay</button>
      <button type="button" onClick={goNext} className="h-7 rounded-lg bg-amber-700 px-2.5 font-semibold text-white">Go</button>
    </div>
  ) : null;

  const saveSelected = async (failedOnly = false) => {
    if (bulkBusy.current || busy || detecting) return;
    const selectedRows = rows.filter((row) => row.checked && row.status !== "created" && (!failedOnly || row.status === "error"));
    if (!selectedRows.length) return;
    bulkBusy.current = true; cancelBulk.current = false; setBulkSaving(true); setSummary(""); setSummaryOffersNext(false); setConfirmNext(false);
    setProgress({ done: 0, total: selectedRows.length });
    let done = 0, created = 0, duplicates = 0, errors = 0;
    const update = (id: string, patch: Partial<Row>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    try {
      for (const chunk of chunkImportRows(selectedRows)) {
        if (cancelBulk.current) break;
        const prepared: Array<{ row: Row; item: Parameters<typeof createMaterialsFromImport>[0]["items"][number] }> = [];
        for (const row of chunk) {
          try {
            if (!row.name.trim()) throw new Error("Name is required.");
            const box = row.swatch.box;
            const crop = row.swatch.roundInset ? box : { h: box.h * 0.98, w: box.w * 0.98, x: box.x + box.w * 0.01, y: box.y + box.h * 0.01 };
            const file = await renderCrop(crop, row.page, row.code, row.name);
            const upload = await uploadBrandMaterialImage({ brandId, file, groupId });
            prepared.push({ row, item: { code: row.code, name: row.name, imagePath: `product-images:${upload.path}`, subgroupId: row.subgroupId, newSubgroup: row.newSubgroup } });
          } catch (caught) {
            errors += 1; update(row.id, { status: "error", message: caught instanceof Error ? caught.message : "Picture could not be uploaded. Try again.", checked: true });
          }
          done += 1; setProgress({ done, total: selectedRows.length });
        }
        if (prepared.length) {
          try {
            const response = await createMaterialsFromImport({ groupId, items: prepared.map(({ item }) => item) });
            setAddedSubgroups((current) => [...current, ...response.createdSubgroups.filter((sub) => !current.some((old) => old.id === sub.id))]);
            setRows((current) => current.map((row) => {
              const sub = response.createdSubgroups.find((sub) => row.newSubgroup && importCodeKey(sub.name) === importCodeKey(row.newSubgroup.name) && importCodeKey(sub.grade || "") === importCodeKey(row.newSubgroup.grade || ""));
              return sub ? { ...row, subgroupId: sub.id, newSubgroup: null } : row;
            }));
            const savedItems: ExistingMaterial[] = [];
            const savedIds: string[] = [];
            for (const [index, { row }] of prepared.entries()) {
              const result = response.results.find((result) => result.index === index);
              if (result?.status === "created") {
                created += 1;
                const target = row.newSubgroup
                  ? response.createdSubgroups.find((sub) => importCodeKey(sub.name) === importCodeKey(row.newSubgroup!.name) && importCodeKey(sub.grade || "") === importCodeKey(row.newSubgroup!.grade || ""))
                    ?? reviewSubgroups.find((sub) => importCodeKey(sub.name) === importCodeKey(row.newSubgroup!.name) && importCodeKey(sub.grade || "") === importCodeKey(row.newSubgroup!.grade || ""))
                  : undefined;
                const subId = row.subgroupId ?? target?.id ?? null;
                savedItems.push({ code: row.code, label: target ? subgroupText(target) : subgroupLabelOf(subId), subgroupId: subId });
                savedIds.push(row.id);
                setSavedKeys((current) => new Set(current).add(row.id));
              }
              else if (result?.status === "duplicate") { duplicates += 1; update(row.id, { status: "duplicate", duplicate: true, checked: false, message: undefined }); }
              else { errors += 1; update(row.id, { status: "error", checked: true, message: result?.message || "Could not confirm the save. Check the group before retrying." }); }
            }
            if (savedIds.length) recordSaved(savedItems, savedIds);
          } catch {
            errors += prepared.length;
            for (const { row } of prepared) update(row.id, { status: "error", checked: true, message: "Could not confirm the save. Check the group before retrying." });
          }
        }
      }
    } finally {
      bulkBusy.current = false; setBulkSaving(false);
      setSummary(`${cancelBulk.current ? "Stopped. " : ""}Saved ${created}, skipped ${duplicates}, ${errors} errors`);
      setSummaryOffersNext(errors === 0 && !cancelBulk.current && rows.some((row) => row.page === pageNumber));
      router.refresh();
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void openFile(file, file.name).then(refreshRecents);
  };

  const field = "h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
  const toolButton = "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40";
  const modeButton = (active: boolean) => `inline-flex h-9 items-center gap-1 px-3 text-sm font-semibold ${active ? "bg-emerald-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`;

  const previewBox = (
    <div className={`flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-300 bg-zinc-50 ${sideOpen ? "h-24" : "h-40"}`}>
      <canvas ref={previewRef} className={`max-h-full max-w-full ${box ? "" : "hidden"}`} />
      {box ? null : <span className="text-xs text-zinc-400">Crop preview</span>}
    </div>
  );
  const codeField = (
    <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Code
      <input value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && box && name.trim()) void saveSwatch(Boolean(selected)); }} className={`${field} normal-case`} />
    </label>
  );
  const nameField = (
    <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Name
      <input value={name} onChange={(event) => { setName(event.target.value); setNameTouched(true); }} onKeyDown={(event) => { if (event.key === "Enter" && box && name.trim()) void saveSwatch(Boolean(selected)); }} className={`${field} normal-case`} />
    </label>
  );
  const subgroupField = (
    <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Sub-group
      <select value={subgroupId} onChange={(event) => setSubgroupId(event.target.value)} className={`${field} normal-case`}>
        <option value="">No sub-group</option>
        {subgroupOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  );
  const saveButton = (
    <button type="button" disabled={!box || busy} onClick={() => void saveSwatch()} className="h-10 rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Saving..." : "Save swatch"}</button>
  );
  const messages = (
    <>
      {notice ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">{notice}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {rememberFailed ? <p className="text-xs text-zinc-400">Could not remember this PDF on this browser.</p> : null}
    </>
  );

  const restore = () => setMode(narrow ? "full" : lastVisibleMode.current);

  const activeLanguage = languageFor(onThisPage);
  const sectionTag = selected ? [selected.grade, selected.collection].filter(Boolean).join(" - ") : "";
  const subgroupMissing = Boolean(selected && sectionTag && !matchSubgroup(selected));
  const smallButton = "h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40";
  const detectControls = onThisPage.length || detectMessage ? (
    <div className="grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
      {detectMessage ? <p className="text-xs text-zinc-600">{detectMessage}</p> : null}
      {onThisPage.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-zinc-700">{selectedIdx >= 0 ? `${selectedIdx + 1} of ${onThisPage.length} on this page` : `${onThisPage.length} found on this page`}</span>
            {sectionTag ? <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 font-semibold text-zinc-700">{sectionTag}</span> : null}
          </div>
          {onThisPage.some((item) => item.nameEnglish || item.nameOther) ? (
            <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-zinc-200" role="group" aria-label="Name language">
              {languages.map(([value, text]) => (
                <button key={value} type="button" aria-pressed={activeLanguage === value} onClick={() => changeLanguage(value)} className={`h-8 px-2.5 text-xs font-semibold ${activeLanguage === value ? "bg-emerald-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}>{text}</button>
              ))}
            </div>
          ) : null}
          {subgroupMissing ? <p className="text-xs font-medium text-amber-800">Sub-group {sectionTag} not found in this group. Create it on the group page first.</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={selectedIdx <= 0} onClick={() => selectDetected(selectedIdx - 1)} className={smallButton}>Previous</button>
            <button type="button" disabled={selectedIdx >= onThisPage.length - 1} onClick={() => { const next = nextUnsaved(selectedIdx, onThisPage, savedKeys); selectDetected(next >= 0 ? next : selectedIdx + 1); }} className={smallButton}>Skip / Next</button>
            <button type="button" disabled={!box || busy || !name.trim()} onClick={() => void saveSwatch(true)} className="h-8 rounded-lg bg-emerald-900 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy ? "Saving..." : "Save and next"}</button>
          </div>
        </>
      ) : null}
    </div>
  ) : null;

  const openRows = rows.filter((row) => row.status !== "created");
  const selectedCount = openRows.filter((row) => row.checked).length;
  const newLabels = [...new Set(openRows.filter((row) => row.checked && row.newSubgroup).map((row) => subgroupText(row.newSubgroup!)))];
  const editRow = (id: string, patch: Partial<Row>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  // Rows grouped by detected section (grade + collection).
  const sections = (() => {
    const map = new Map<string, { key: string; rows: Row[]; title: string }>();
    for (const row of rows) {
      const grade = row.swatch.grade.trim();
      const collection = row.swatch.collection.trim();
      const key = row.sectionKey || `${row.page}:${collection}|${grade}`;
      const entry = map.get(key) ?? { key, rows: [], title: [collection, grade].filter(Boolean).join(" - ") || "No heading" };
      entry.rows.push(row);
      map.set(key, entry);
    }
    return [...map.values()];
  })();
  const setSectionTarget = (section: { rows: Row[] }, value: string) => {
    const ids = new Set(section.rows.map((row) => row.id));
    setRows((current) => refreshRows(current.map((row) => ids.has(row.id) && row.status !== "created" ? {
      ...row,
      newSubgroup: value === "new" && row.swatch.collection.trim() ? { grade: row.swatch.grade.trim() || null, name: row.swatch.collection.trim() } : null,
      subgroupId: value && value !== "new" ? value : null,
      targetEdited: true,
    } : row), [...groupMaterials, ...savedMaterials]));
  };
  const editSection = (section: { rows: Row[] }, patch: { collection?: string; grade?: string }) => {
    const ids = new Set(section.rows.map((row) => row.id));
    setRows((current) => refreshRows(current.map((row) => {
      if (!ids.has(row.id) || row.status === "created") return row;
      const swatch = { ...row.swatch, ...patch };
      const target = buildReviewRows([swatch], languageFor([swatch]), reviewSubgroups, [])[0];
      return { ...row, swatch, sectionEdited: true, targetEdited: false, subgroupId: target.subgroupId, newSubgroup: target.newSubgroup };
    }), [...groupMaterials, ...savedMaterials]));
    setDetected((current) => current.map((item) => ids.has(swatchKey(detectedPage, item)) && !savedKeys.has(swatchKey(detectedPage, item)) ? { ...item, ...patch } : item));
  };
  const toggleSection = (section: { rows: Row[] }, on: boolean) => {
    const ids = new Set(section.rows.map((row) => row.id));
    setRows((current) => current.map((row) => ids.has(row.id) && row.status !== "created" ? { ...row, checked: on && row.status !== "duplicate" && row.alsoIn.length === 0 && Boolean(row.name.trim()) && Boolean(row.code.trim()) } : row));
  };
  const selectNewOnly = () => setRows((current) => current.map((row) => row.status === "created" ? row : { ...row, checked: row.status === "ready" && row.alsoIn.length === 0 && Boolean(row.name.trim()) && Boolean(row.code.trim()) }));
  const chip = (row: Row) => {
    if (row.status === "created") return <span className="inline-flex rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-600">Saved</span>;
    if (row.status === "error") return <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">{row.message || "Error"}</span>;
    if (row.status === "duplicate") return <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Already exists here</span>;
    if (row.alsoIn.length) return <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Also in {row.alsoIn.join(", ")}</span>;
    return <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900">Ready</span>;
  };
  const rowInput = "h-9 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 disabled:bg-transparent disabled:text-zinc-400";
  const previewRow = rows.find((row) => row.id === previewId);
  const settingsStrip = <fieldset disabled={busy || bulkSaving || detecting} className="grid shrink-0 gap-1 border-b border-zinc-200 bg-zinc-50 p-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <label>Label style <select aria-label="Label style" value={parseSettings.styleId} onChange={(event) => changeParseSettings({ ...parseSettings, styleId: event.target.value as ParseSettings["styleId"] })} className="max-w-full rounded border bg-white p-1"><option value="auto">Auto (currently: {labelStyles.find((style) => style.id === chosenStyle)?.name})</option>{labelStyles.map((style) => <option key={style.id} value={style.id}>{style.name}: {style.example}</option>)}</select></label>
      <label>Second code <select value={parseSettings.altCodeMode} onChange={(event) => changeParseSettings({ ...parseSettings, altCodeMode: event.target.value as LabelOptions["altCodeMode"] })} className="rounded border bg-white p-1"><option value="append">Add to name</option><option value="ignore">Ignore</option><option value="use-as-code">Use as code</option></select></label>
      <label>Tidy names <select value={parseSettings.tidyNames} onChange={(event) => changeParseSettings({ ...parseSettings, tidyNames: event.target.value as LabelOptions["tidyNames"] })} className="rounded border bg-white p-1"><option value="capitalise-first">Capitalise first</option><option value="title-case">Title case</option><option value="as-written">As written</option></select></label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={parseSettings.roundInset} onChange={(event) => changeParseSettings({ ...parseSettings, roundInset: event.target.checked })} />Round swatches: crop inside the circle</label>
    </div>
    <div aria-live="polite" className="text-zinc-600">{onThisPage.slice(0, 3).map((item, index) => <p key={index} className="truncate">{item.code || "No code"} | {formatName(item, languageFor(onThisPage)) || "No name"}</p>)}</div>
  </fieldset>;
  const reviewList = (
    <div className={tab === "review" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      {summary ? (
        <div role="status" className="flex items-start gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
          <span className="flex-1">{summary}</span>
          {summaryOffersNext ? <span className="[&>button]:h-7">{nextButton}</span> : null}
          <button type="button" aria-label="Close summary" onClick={() => { setSummary(""); setSummaryOffersNext(false); }} className="text-emerald-900 hover:text-emerald-700"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      ) : null}
      <fieldset disabled={bulkSaving || busy || detecting} className="flex min-h-0 flex-1 flex-col disabled:opacity-70">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 text-xs">
          {rows.some((row) => row.swatch.nameEnglish || row.swatch.nameOther) ? (
            <label className="flex items-center gap-1 font-semibold text-zinc-600">Name language
              <select aria-label="Review name language" value={languageFor(detected)} onChange={(event) => changeLanguage(event.target.value as Exclude<NameLanguage, "auto">)} className="h-8 rounded-lg border border-zinc-200 bg-white px-1.5 text-xs">{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </label>
          ) : null}
          <button type="button" onClick={selectNewOnly} className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 font-semibold text-zinc-700 hover:bg-zinc-50">Select new only</button>
          <button type="button" onClick={() => setRows((current) => current.map((row) => row.status === "created" ? row : { ...row, checked: false }))} className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 font-semibold text-zinc-700 hover:bg-zinc-50">Select none</button>
          {nextButton}
          <span className="font-semibold text-zinc-700">Selected {selectedCount} of {openRows.length}</span>
          <button type="button" disabled={!selectedCount} onClick={() => void saveSelected()} className="ml-auto h-8 rounded-lg bg-emerald-900 px-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">Save selected ({selectedCount})</button>
          {rows.some((row) => row.checked && row.status === "error") ? <button type="button" onClick={() => void saveSelected(true)} className="font-semibold underline">Retry failed</button> : null}
          {confirmNextBlock}
          {newLabels.length ? <p className="w-full text-amber-800">Will create sub-group(s): {newLabels.join(", ")}</p> : null}
        </div>
        {settingsStrip}
        <div className="@container min-h-0 flex-1 overflow-auto">
          {sections.map((section) => {
            const open = section.rows.filter((row) => row.status !== "created");
            const first = open[0] || section.rows[0];
            const value = first.subgroupId ?? (first.newSubgroup ? "new" : "");
            const canCreate = Boolean(first.swatch.collection.trim());
            return (
              <section key={section.key}>
                <div className="sticky top-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 bg-zinc-100 px-3 py-2">
                  <label className="flex min-w-0 items-center gap-2 text-sm font-bold text-zinc-900">
                    <input type="checkbox" aria-label={`Select all in ${section.title}`} checked={open.length > 0 && open.every((row) => row.checked)} disabled={!open.length} onChange={(event) => toggleSection(section, event.target.checked)} />
                    <span className="text-xs font-semibold text-zinc-500">{section.rows.length}</span>
                  </label>
                  <label className="flex items-center gap-1 text-xs">Title<input aria-label="Section title" value={first.swatch.collection} disabled={!open.length} onChange={(event) => editSection(section, { collection: event.target.value })} className="h-8 w-32 rounded border bg-white px-1.5" /></label>
                  <label className="flex items-center gap-1 text-xs">Grade<input aria-label="Section grade" value={first.swatch.grade} disabled={!open.length} onChange={(event) => editSection(section, { grade: event.target.value })} className="h-8 w-24 rounded border bg-white px-1.5" /></label>
                  <label className="ml-auto flex items-center gap-1 text-xs font-semibold text-zinc-600">Save into
                    <select aria-label={`Save ${section.title} into`} value={value} disabled={!open.length} onChange={(event) => setSectionTarget(section, event.target.value)} className="h-8 max-w-[11rem] rounded-lg border border-zinc-200 bg-white px-1.5 text-xs font-normal">
                      <option value="">No sub-group</option>
                      {reviewSubgroups.map((sub) => <option key={sub.id} value={sub.id}>{subgroupText(sub)}</option>)}
                      {canCreate && (first.newSubgroup || !first.subgroupId) ? <option value="new">Create {subgroupText({ grade: first.swatch.grade.trim() || null, name: first.swatch.collection.trim() })}</option> : null}
                    </select>
                  </label>
                </div>
                {section.rows.map((row, index) => {
                  const done = row.status === "created";
                  return (
                    <div key={row.id} className={`grid grid-cols-[auto_64px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-zinc-100 px-3 py-2 @lg:grid-cols-[auto_64px_8rem_minmax(0,1fr)_11rem] ${done ? "bg-zinc-100 text-zinc-400" : index % 2 ? "bg-zinc-50/70" : "bg-white"}`}>
                      <input type="checkbox" aria-label={`Select ${row.name || row.code || "swatch"}`} checked={row.checked} disabled={done} onChange={(event) => editRow(row.id, { checked: event.target.checked })} />
                      <button type="button" aria-label="Show larger picture" onClick={() => setPreviewId(row.id)} className={`block h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 ${done ? "opacity-50" : ""}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={row.preview} alt="" className="h-full w-full object-cover" style={row.swatch.roundInset ? { transform: "scale(1.41243)" } : undefined} />
                      </button>
                      <input aria-label="Swatch code" placeholder="Code" className={rowInput} value={row.code} disabled={done} onChange={(event) => {
                        const code = event.target.value;
                        setRows((current) => refreshRows(current.map((other) => other.id === row.id ? { ...other, code, codeEdited: true, message: undefined, status: other.status === "error" ? "ready" : other.status } : other), [...groupMaterials, ...savedMaterials]));
                      }} />
                      <input aria-label="Swatch name" placeholder="Name" className={`${rowInput} col-span-2 col-start-2 @lg:col-span-1 @lg:col-start-auto`} value={row.name} disabled={done} onChange={(event) => editRow(row.id, { name: event.target.value, nameEdited: true })} />
                      <div className="col-span-2 col-start-2 min-w-0 @lg:col-span-1 @lg:col-start-auto">{chip(row)}</div>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {!rows.length ? <p className="p-3 text-sm text-zinc-500">Use Auto detect on the Page tab to fill this list.</p> : null}
        </div>
      </fieldset>
      {bulkSaving ? <div className="flex items-center gap-2 border-t border-zinc-200 p-3 text-sm" role="status"><progress value={progress.done} max={progress.total} className="min-w-0 flex-1" /><span>Saving {progress.done} of {progress.total}</span><button type="button" onClick={() => { cancelBulk.current = true; setSummary("Stopping after the current chunk..."); }} className="h-8 rounded-lg border border-zinc-200 px-3 text-xs font-semibold">Cancel</button></div> : null}
      {previewRow ? (
        <div role="dialog" aria-label="Picture preview" onClick={() => setPreviewId("")} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewRow.preview} alt="" className="max-h-[80vh] max-w-[90vw] rounded-xl bg-white object-contain shadow-2xl" style={{ minWidth: "min(70vw, 360px)" }} />
        </div>
      ) : null}
    </div>
  );

  return createPortal(
    <>
      <div
        className={shown === "full" ? "fixed inset-0 z-[70] flex flex-col bg-white" : sideOpen ? "fixed bottom-0 right-0 top-0 z-[60] flex flex-col border-l border-zinc-200 bg-white shadow-2xl" : "hidden"}
        style={sideOpen ? { width } : undefined}
        role="dialog"
        aria-modal={shown === "full"}
        aria-label="Import swatches from PDF"
      >
        {sideOpen ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-emerald-600/30"
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2">
          <h2 className="text-base font-semibold text-zinc-950">Import from PDF - {brandName} / {groupName}</h2>
          {fileName ? <span className="max-w-[14rem] truncate text-sm text-zinc-500">{fileName}</span> : null}
          <span className="text-sm text-zinc-500">Saved: {savedCount}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200" role="group" aria-label="Panel size">
              {narrow ? null : <button type="button" aria-pressed={sideOpen} onClick={() => setMode("side")} className={modeButton(sideOpen)}><PanelRight aria-hidden="true" className="h-4 w-4" />Side</button>}
              <button type="button" aria-pressed={shown === "full"} onClick={() => setMode("full")} className={modeButton(shown === "full")}><Maximize2 aria-hidden="true" className="h-4 w-4" />Full screen</button>
              <button type="button" onClick={() => setMode("min")} className={modeButton(false)}><Minus aria-hidden="true" className="h-4 w-4" />Minimize</button>
            </div>
            {doc ? <button type="button" disabled={bulkSaving || detecting} onClick={() => { setDoc(null); setBox(null); setDetected([]); setSelectedIdx(-1); setDetectMessage(""); imageCache.current = new Map(); void refreshRecents(); }} className="text-xs font-semibold text-zinc-500 underline hover:text-zinc-800">Change PDF</button> : null}
            <button type="button" disabled={bulkSaving || detecting} onClick={onClose} aria-label="Close" className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"><X aria-hidden="true" className="h-4 w-4" />Close</button>
          </div>
        </div>

        {doc ? <div className="flex gap-2 border-b p-2" role="tablist" aria-label="PDF import views"><button type="button" role="tab" aria-selected={tab === "page"} disabled={bulkSaving} onClick={() => setTab("page")} className={modeButton(tab === "page")}>Page</button><button type="button" role="tab" aria-selected={tab === "review"} onClick={() => setTab("review")} className={modeButton(tab === "review")}>Review list ({rows.length})</button></div> : null}
        {doc ? reviewList : null}
        {!doc ? (
          <div className="mx-auto grid w-full max-w-xl gap-5 overflow-auto p-5">
            <div className="grid gap-2">
              <p className="text-sm text-zinc-600">Choose a catalogue PDF. It is read in this browser only and is never uploaded.</p>
              <input type="file" accept=".pdf,application/pdf" onChange={chooseFile} className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-700" />
              {loadError ? <p className="text-sm text-red-700">{loadError}</p> : null}
            </div>
            {recents.length ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-950">Recent PDFs</h3>
                  <button type="button" onClick={() => void db().recents.clear().then(refreshRecents).catch(() => undefined)} className="text-xs font-semibold text-zinc-500 underline hover:text-zinc-800">Clear all</button>
                </div>
                {recents.map((recent) => (
                  <div key={recent.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-zinc-900">{recent.name}</p>
                      <p className="text-xs text-zinc-500">{formatSize(recent.size)} · opened {new Date(recent.openedAt).toLocaleString()} · page {recent.page}</p>
                    </div>
                    <button type="button" onClick={() => void openFile(recent.blob, recent.name, recent).then(refreshRecents)} className="h-9 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white hover:bg-emerald-800">Open</button>
                    <button type="button" onClick={() => { if (recent.id) void db().recents.delete(recent.id).then(refreshRecents).catch(() => undefined); }} className="text-xs font-semibold text-zinc-500 hover:text-red-700">Remove</button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={`${tab === "review" ? "hidden" : "flex"} min-h-0 flex-1 ${sideOpen ? "flex-col" : "flex-col lg:flex-row"}`}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2">
                <button type="button" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => goTo(pageNumber - 1)} className={toolButton}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
                <input aria-label="Page number" inputMode="numeric" value={pageInput} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} onBlur={() => goTo(Number(pageInput))} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-9 w-14 rounded-lg border border-zinc-200 text-center text-sm font-semibold" />
                <span className="text-sm text-zinc-500">/ {doc.numPages}</span>
                <button type="button" aria-label="Next page" disabled={pageNumber >= doc.numPages} onClick={() => goTo(pageNumber + 1)} className={toolButton}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
                <span className="mx-1 h-6 w-px bg-zinc-200" />
                <button type="button" aria-label="Zoom out" onClick={() => setZoom(clamp(scale / 1.25, 0.25, 4))} className={toolButton}><ZoomOut aria-hidden="true" className="h-4 w-4" /></button>
                <span className="min-w-12 text-center text-sm text-zinc-600">{zoom === "fit" ? "Fit" : `${Math.round(scale * 100)}%`}</span>
                <button type="button" aria-label="Zoom in" onClick={() => setZoom(clamp(scale * 1.25, 0.25, 4))} className={toolButton}><ZoomIn aria-hidden="true" className="h-4 w-4" /></button>
                <button type="button" onClick={() => setZoom("fit")} className="h-9 rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Fit width</button>
                <button type="button" disabled={detecting} onClick={() => void runDetect()} className="h-9 rounded-lg border border-emerald-900 bg-white px-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60">{detecting ? "Detecting..." : "Auto detect"}</button>
                <span className="[&>button]:h-9 [&>button]:text-sm">{nextButton}</span>
                {confirmNextBlock}
              </div>
              {settingsStrip}
              <div ref={holderRef} className="min-h-0 flex-1 overflow-auto bg-zinc-100 p-2">
                <div className="relative mx-auto inline-block touch-none select-none">
                  <canvas ref={canvasRef} className="block bg-white shadow" />
                  <div ref={overlayRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} className="absolute inset-0 cursor-crosshair overflow-hidden">
                    {onThisPage.map((item, index) => {
                      const saved = savedKeys.has(swatchKey(pageNumber, item));
                      const tone = index === selectedIdx ? "border-orange-500 bg-orange-400/10" : saved ? "border-zinc-400 bg-zinc-400/25" : "border-emerald-500 bg-emerald-400/10";
                      const badge = index === selectedIdx ? "bg-orange-500" : saved ? "bg-zinc-500" : "bg-emerald-600";
                      return (
                        <div key={`${index}-${item.box.x}`} data-role="detected" data-index={index} className={`absolute cursor-pointer border-2 ${tone}`} style={{ height: `${item.box.h * 100}%`, left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.w * 100}%` }}>
                          <span className={`pointer-events-none absolute left-0 top-0 rounded-br px-1 text-[10px] font-bold text-white ${badge}`}>{index + 1}</span>
                        </div>
                      );
                    })}
                    {box ? (
                      <div data-role="move" className="absolute cursor-move border-2 border-emerald-600 bg-emerald-500/10" style={{ height: `${box.h * 100}%`, left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%` }}>
                        {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                          <span key={corner} data-role={corner} className={`absolute h-5 w-5 rounded-full border-2 border-white bg-emerald-700 ${corner === "nw" ? "-left-2.5 -top-2.5 cursor-nwse-resize" : corner === "ne" ? "-right-2.5 -top-2.5 cursor-nesw-resize" : corner === "sw" ? "-bottom-2.5 -left-2.5 cursor-nesw-resize" : "-bottom-2.5 -right-2.5 cursor-nwse-resize"}`} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {sideOpen ? (
              // Compact form, always visible at the bottom of the panel.
              <div className="grid shrink-0 gap-2 border-t border-zinc-200 bg-white p-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                {previewBox}
                <div className="grid content-start gap-2">
                  {detectControls}
                  <div className="grid grid-cols-2 gap-2">{codeField}{nameField}</div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">{subgroupField}{saveButton}</div>
                  {messages}
                </div>
              </div>
            ) : (
              <aside className="grid max-h-[50vh] w-full content-start gap-3 overflow-auto border-t border-zinc-200 p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
                <p className="text-sm text-zinc-600">Drag a box around a swatch on the page, or use Auto detect. Move it or use the corners to adjust.</p>
                {detectControls}
                {previewBox}
                {codeField}
                {nameField}
                {subgroupField}
                {saveButton}
                {messages}
              </aside>
            )}
          </div>
        )}
      </div>

      {shown === "min" ? (
        <div className="fixed bottom-3 right-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
          <span className="truncate text-zinc-700">PDF: {fileName || "none"}{doc ? ` - page ${pageNumber}/${doc.numPages}` : ""}</span>
          <button type="button" onClick={restore} className="font-semibold text-emerald-900 hover:underline">Open</button>
          <button type="button" disabled={bulkSaving || detecting} onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-900"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
