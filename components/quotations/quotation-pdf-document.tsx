import Link from "next/link";
import type { ReactNode } from "react";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import type { CompanyProfile } from "@/lib/company-profile";
import {
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";
import { formatProjectReferenceWithYearDisplay } from "@/lib/project-reference";
import { formatQuotationMoney, quotationMoneyCell } from "@/lib/quotation-pricing";
import {
  formatBrandOriginSupplier,
  specificationWithoutDuplicateCode,
} from "@/lib/quotations/format-quotation-row";
import {
  DEFAULT_QUOTATION_NOTES,
  DEFAULT_QUOTATION_PDF_SETTINGS,
  type QuotationPdfSettings,
} from "@/lib/quotations/quotation-pdf-settings";

export type Client = {
  id: string;
  company_name: string;
};

export type Project = {
  id: string;
  project_name: string;
  project_number: string | null;
  project_year: number | null;
  project_code: string | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

export type Quotation = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  status: string;
  layout_mode: string;
  layout_settings: LayoutSettings | null;
  currency: string;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  grand_total: number;
  payment_terms: string | null;
  validity: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  notes: string | null;
};

export type QuotationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

export type QuotationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  finish_selections_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  discount_type: string;
  discount_value: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  line_style: string;
  is_rate_only: boolean;
  is_active: boolean;
  cell_layout: CellLayout | null;
  notes: string | null;
};

export type CellLayout = {
  images?: Record<string, Partial<ImageDisplaySettings> | undefined>;
  customPrintableColumnValues?: Record<string, unknown>;
  customPrintableColumnImageSettings?: Record<string, Partial<ImageDisplaySettings> | undefined>;
};

export type LayoutSettings = {
  columns?: Array<{
    key?: string;
    visible?: boolean;
    width?: number;
  }>;
  columnOrder?: string[];
  customPrintableColumns?: Array<{
    id?: string;
    label?: string;
    type?: string;
    width?: number;
    showInClient?: boolean;
    showInInternal?: boolean;
  }>;
  specificationMetadata?: {
    title?: boolean;
    model?: boolean;
    size?: boolean;
    finish?: boolean;
    warranty?: boolean;
    origin?: boolean;
    supplier?: boolean;
  };
};

type PdfColumn = {
  key: string;
  label: string;
  defaultWidth: number;
  defaultVisible?: boolean;
  align?: "left" | "center" | "right";
  width?: number;
  customPrintableColumnId?: string;
  customPrintableColumnType?: string;
};

type DisplaySection = QuotationSection & {
  renderAsMainOnly?: boolean;
};

export type QuotationPdfDocumentData = {
  client: Client | null;
  companyProfile: CompanyProfile;
  defaultQuotationNotes: string;
  customPrintableImageUrlByItemAndColumnId: Map<string, string | null>;
  finishImageUrlByItemAndFinishId: Map<string, string | null>;
  hasLogo: boolean;
  itemsBySection: Map<string, QuotationItem[]>;
  pdfColumnWidths: string[];
  pdfColumns: PdfColumn[];
  printableSections: DisplaySection[];
  project: Project | null;
  proposedImageUrlByItemId: Map<string, string | null>;
  quotation: Quotation;
  sectionById: Map<string, QuotationSection>;
  sectionTotals: Map<string, number>;
  mainSectionIds: Set<string>;
  mainSectionTotals: Map<string, number>;
  specifiedImageUrlByItemId: Map<string, string | null>;
  metadataSettings: ReturnType<typeof specificationMetadataSettings>;
  visibleColumnKeys: Set<string>;
};

export type SerializedQuotationPdfDocumentData = Omit<
  QuotationPdfDocumentData,
  | "customPrintableImageUrlByItemAndColumnId"
  | "finishImageUrlByItemAndFinishId"
  | "itemsBySection"
  | "mainSectionIds"
  | "mainSectionTotals"
  | "proposedImageUrlByItemId"
  | "sectionById"
  | "sectionTotals"
  | "specifiedImageUrlByItemId"
  | "visibleColumnKeys"
> & {
  customPrintableImageUrlByItemAndColumnId: Array<[string, string | null]>;
  finishImageUrlByItemAndFinishId: Array<[string, string | null]>;
  itemsBySection: Array<[string, QuotationItem[]]>;
  mainSectionIds: string[];
  mainSectionTotals: Array<[string, number]>;
  proposedImageUrlByItemId: Array<[string, string | null]>;
  sectionById: Array<[string, QuotationSection]>;
  sectionTotals: Array<[string, number]>;
  specifiedImageUrlByItemId: Array<[string, string | null]>;
  visibleColumnKeys: string[];
};

type ItemPageRow =
  | { type: "main_section_heading"; section: DisplaySection }
  | { type: "section_heading"; section: DisplaySection; continued?: boolean }
  | { type: "column_header" }
  | { type: "item"; item: QuotationItem; serial: number }
  | { type: "full_width_item"; item: QuotationItem }
  | { type: "section_subtotal"; subtotal: number }
  | { type: "main_section_total"; label: string; total: number };

type QuotationPdfPageModel =
  | { type: "items"; pageNumber: number; showFullHeader: boolean; rows: ItemPageRow[] }
  | { type: "notes_terms_summary"; pageNumber: number };

type QuotationPdfLayoutMetrics = {
  pageClassName: string;
  pageWidthMm: number;
  pageHeightMm: number;
  toolbarWidthMm: number;
  firstItemsPageCapacity: number;
  continuationItemsPageCapacity: number;
  imageHeightPx: number;
  imageWidthPx: number;
  tableTextClassName: string;
  headerSectionMarginClassName: string;
  footerTextClassName: string;
};

function quotationPdfLayoutMetrics(settings: QuotationPdfSettings): QuotationPdfLayoutMetrics {
  const orientation = settings.orientation;
  const density = settings.density;
  const imageSize = settings.imageSize;
  const isLandscape = orientation === "landscape";

  const imageSizeByMode = {
    small: isLandscape ? { width: 98, height: 66 } : { width: 78, height: 54 },
    medium: isLandscape ? { width: 122, height: 82 } : { width: 92, height: 68 },
    large: isLandscape ? { width: 138, height: 92 } : { width: 108, height: 80 },
  } as const;

  const capacityByOrientation = isLandscape
    ? {
        comfortable: { first: 20, continuation: 27 },
        compact: { first: 23, continuation: 31 },
        maxFit: { first: 26, continuation: 35 },
      }
    : {
        comfortable: { first: 14, continuation: 20 },
        compact: { first: 17, continuation: 24 },
        maxFit: { first: 20, continuation: 27 },
      };

  return {
    pageClassName: isLandscape ? "quotation-pdf-page-landscape" : "quotation-pdf-page-portrait",
    pageWidthMm: isLandscape ? 297 : 210,
    pageHeightMm: isLandscape ? 210 : 297,
    toolbarWidthMm: isLandscape ? 297 : 210,
    firstItemsPageCapacity: capacityByOrientation[density].first,
    continuationItemsPageCapacity: capacityByOrientation[density].continuation,
    imageHeightPx: imageSizeByMode[imageSize].height,
    imageWidthPx: imageSizeByMode[imageSize].width,
    tableTextClassName: density === "comfortable"
      ? "text-[8.9px]"
      : density === "maxFit"
        ? "text-[7.6px]"
        : "text-[8.5px]",
    headerSectionMarginClassName: density === "comfortable" ? "mt-4" : density === "maxFit" ? "mt-2" : "mt-3",
    footerTextClassName: density === "maxFit" ? "text-[8px]" : "text-[9px]",
  };
}

export function quotationDocumentTitle(quotation?: Pick<Quotation, "quotation_no" | "title"> | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Quotation";

  return `${quotationNo} - ${title}`.replace(/[\\/:*?"<>|]/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function booleanFromRecord(record: Record<string, unknown>, key: string, fallback: boolean) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function finishSelections(value: unknown) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function quotationVisibleFinishes(item: QuotationItem) {
  return finishSelections(item.finish_selections_snapshot)
    .filter((finish) => booleanFromRecord(finish, "show_in_quotation", false));
}

function projectContactLine(project?: Project | null) {
  return [
    project?.attention_to ? `Attn: ${project.attention_to}` : null,
    project?.attention_mobile ? `Mob: ${project.attention_mobile}` : null,
    project?.attention_landline ? `Tel: ${project.attention_landline}` : null,
    project?.attention_email ? `Email: ${project.attention_email}` : null,
    project?.po_box ? `PO Box: ${project.po_box}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

function revisionLabel(quotation: Quotation) {
  return quotation.revision_no > 0 ? `R${quotation.revision_no}` : "R0";
}

function discountAmount(item: QuotationItem) {
  if (item.discount_type === "percent") {
    return item.unit_price * item.qty - item.net_total;
  }

  return item.discount_value;
}

function tableNumber(value: number) {
  return quotationMoneyCell(value);
}

function money(currency: string, value: number) {
  return formatQuotationMoney(currency, value);
}

function overallDiscountAmount(quotation: Quotation) {
  const itemNetTotal = Math.max(quotation.subtotal - quotation.discount_total, 0);

  if (quotation.overall_discount_type === "percent") {
    return (itemNetTotal * quotation.overall_discount_value) / 100;
  }

  return quotation.overall_discount_value;
}

function InfoLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-xs text-zinc-900">{value || "-"}</dd>
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <>
      <dt className="text-right text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-zinc-900 [overflow-wrap:anywhere]">{value || "-"}</dd>
    </>
  );
}

function ImageBox({
  imageSettings,
  src,
  pdfSettings,
}: {
  imageSettings?: Partial<ImageDisplaySettings> | null;
  src: string | null;
  pdfSettings: QuotationPdfSettings;
}) {
  const normalizedSettings = normalizeImageDisplaySettings(imageSettings);
  const layout = quotationPdfLayoutMetrics(pdfSettings);

  return (
    <div
      className="mx-auto flex items-center justify-center overflow-hidden bg-white"
      style={{ height: `${layout.imageHeightPx}px`, width: `${layout.imageWidthPx}px` }}
    >
      <QuotationImageFrame
        alt="Proposed item"
        className="h-full w-full overflow-hidden"
        imageUrl={src}
        settings={normalizedSettings}
      />
    </div>
  );
}

function FinishPdfBlock({
  finishImageUrlById,
  item,
}: {
  finishImageUrlById: Map<string, string | null>;
  item: QuotationItem;
}) {
  const finishes = quotationVisibleFinishes(item);

  if (!finishes.length) return "-";

  return (
    <div className="grid gap-1 text-left">
      {finishes.map((finish, index) => {
        const id = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
        const label = stringFromRecord(finish, ["group_label"]) || "Finish";
        const codeName = [
          stringFromRecord(finish, ["finish_code"]),
          stringFromRecord(finish, ["finish_name"]),
        ].filter(Boolean).join(" - ");
        const imageUrl = finishImageUrlById.get(id) ?? null;

        return (
          <div key={`${id}-${index}`} className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center overflow-hidden border border-zinc-200 bg-white">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
              ) : null}
            </span>
            <span className="leading-4">
              <span className="block font-semibold text-zinc-800">{label}</span>
              {codeName ? <span className="block text-[9px] text-zinc-600">{codeName}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function specificationMetadataSettings(settings?: LayoutSettings | null) {
  const metadata = settings?.specificationMetadata;

  return {
    title: metadata?.title !== false,
    model: metadata?.model === true,
    size: metadata?.size !== false,
    finish: metadata?.finish === true,
    warranty: metadata?.warranty === true,
  };
}

function columnSettingsMap(settings?: LayoutSettings | null) {
  const entries = settings?.columns ?? [];

  return new Map(
    entries
      .filter((column) => typeof column.key === "string")
      .map((column) => [
        column.key as string,
        {
          visible: column.visible !== false,
          width:
            typeof column.width === "number"
              ? Math.min(Math.max(column.width, 40), 800)
              : undefined,
        },
      ]),
  );
}

function columnOrder(settings?: LayoutSettings | null) {
  if (!Array.isArray(settings?.columnOrder)) return [];
  return settings.columnOrder.filter((entry): entry is string => typeof entry === "string" && Boolean(entry));
}

function orderPdfColumns(columns: PdfColumn[], settings?: LayoutSettings | null) {
  const savedOrder = columnOrder(settings);
  if (!savedOrder.length) return columns;

  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const ordered = savedOrder
    .map((key) => columnsByKey.get(key))
    .filter((column): column is PdfColumn => Boolean(column));
  const orderedKeys = new Set(ordered.map((column) => column.key));

  return [
    ...ordered,
    ...columns.filter((column) => !orderedKeys.has(column.key)),
  ];
}

export function customPrintablePdfColumns(settings?: LayoutSettings | null): PdfColumn[] {
  const entries = settings?.customPrintableColumns;
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry): entry is NonNullable<NonNullable<LayoutSettings["customPrintableColumns"]>[number]> => Boolean(entry))
    .filter((entry) => typeof entry.id === "string" && entry.id.trim() && typeof entry.label === "string" && entry.label.trim())
    .filter((entry) => entry.showInClient !== false)
    .map((entry) => ({
      key: `custom_printable:${entry.id!.trim()}`,
      label: entry.label!.trim(),
      defaultWidth: typeof entry.width === "number" ? Math.min(Math.max(entry.width, 40), 800) : 160,
      align: entry.type === "number" || entry.type === "percentage" ? "center" as const : "left" as const,
      defaultVisible: true,
      customPrintableColumnId: entry.id!.trim(),
      customPrintableColumnType: typeof entry.type === "string" ? entry.type : "text",
    }));
}

export function customPrintableColumnValue(item: QuotationItem, columnId: string) {
  const values = isRecord(item.cell_layout?.customPrintableColumnValues)
    ? item.cell_layout?.customPrintableColumnValues
    : {};
  const value = values?.[columnId];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function customPrintableColumnImageSettings(item: QuotationItem, columnId: string) {
  return item.cell_layout?.customPrintableColumnImageSettings?.[columnId] ?? null;
}

export function getPdfColumns(layoutMode: string, settings?: LayoutSettings | null) {
  const settingsMap = columnSettingsMap(settings);
  const printableCustomColumns = customPrintablePdfColumns(settings);
  const serial: PdfColumn = { key: "s_no", label: "S. No.", defaultWidth: 54, align: "center" };
  const manualSerial: PdfColumn = { key: "manual_serial", label: "Manual S.No.", defaultWidth: 90, defaultVisible: false, align: "center" };
  const code: PdfColumn = { key: "code", label: "Code", defaultWidth: 78 };
  const referenceImage: PdfColumn = { key: "reference_image", label: "Reference Image", defaultWidth: 180, align: "center" };
  const specifiedImage: PdfColumn = { key: "specified_image", label: "Specified Item Reference Image", defaultWidth: 180, align: "center" };
  const proposedImage: PdfColumn = { key: "proposed_image", label: "Proposed Item Reference Image", defaultWidth: 170, align: "center" };
  const description: PdfColumn = {
    key: layoutMode === "boq_schedule" ? "description" : "specification",
    label: layoutMode === "boq_schedule" ? "Description" : "Specifications",
    defaultWidth: layoutMode === "standard_proposal" ? 520 : 420,
  };
  const room: PdfColumn = { key: "room", label: "Room", defaultWidth: 110 };
  const model: PdfColumn = { key: "model", label: "Model", defaultWidth: 110 };
  const finish: PdfColumn = { key: "finish", label: "Finish", defaultWidth: 110 };
  const size: PdfColumn = { key: "size", label: "Size", defaultWidth: 110 };
  const origin: PdfColumn = { key: "origin", label: "ORIGIN / SUPPLIER", defaultWidth: 136, align: "center" };
  const warranty: PdfColumn = { key: "warranty", label: "Warranty", defaultWidth: 100 };
  const qty: PdfColumn = { key: "qty", label: "Qty", defaultWidth: 70, align: "center" };
  const unitPrice: PdfColumn = { key: "unit_price", label: "U.Price", defaultWidth: 90, align: "center" };
  const discount: PdfColumn = { key: "discount", label: "Discount", defaultWidth: 90, align: "center" };
  const discountPercentage: PdfColumn = { key: "discount_percentage", label: "Discount %", defaultWidth: 90, defaultVisible: false, align: "center" };
  const discountAmountColumn: PdfColumn = { key: "discount_amount", label: "Disc. Amount", defaultWidth: 96, defaultVisible: false, align: "center" };
  const netPrice: PdfColumn = { key: "net_price", label: "Net Price", defaultWidth: 96, align: "center" };
  const netTotal: PdfColumn = { key: "net_total", label: "Net Total", defaultWidth: 106, align: "center" };
  const supplier: PdfColumn = { key: "supplier_name", label: "Supplier", defaultWidth: 128, defaultVisible: layoutMode === "internal_costing" };
  const internalCost: PdfColumn = { key: "internal_cost", label: "Internal Cost", defaultWidth: 112, align: "right" };
  const margin: PdfColumn = { key: "margin", label: "Margin", defaultWidth: 96, align: "right" };
  const notes: PdfColumn = { key: "supplier_notes", label: "Internal / Supplier Notes", defaultWidth: 240 };

  const byLayout: Record<string, PdfColumn[]> = {
    simple_proposal: [serial, code, referenceImage, description, qty, unitPrice, netTotal],
    standard_proposal: [
      serial,
      code,
      { ...specifiedImage, defaultVisible: false },
      proposedImage,
      description,
      origin,
      { ...model, defaultVisible: false },
      { ...finish, defaultVisible: false },
      { ...size, defaultVisible: false },
      { ...warranty, defaultVisible: false },
      qty,
      unitPrice,
      { ...discount, defaultVisible: false },
      discountPercentage,
      { ...discountAmountColumn, defaultVisible: true },
      netPrice,
      netTotal,
    ],
    comparison: [serial, specifiedImage, proposedImage, description, code, qty, unitPrice, discount, discountPercentage, discountAmountColumn, netPrice, netTotal],
    boq_schedule: [code, room, description, model, finish, size, origin, warranty, qty, unitPrice, discount, discountPercentage, discountAmountColumn, netPrice, netTotal],
    internal_costing: [
      serial,
      code,
      specifiedImage,
      proposedImage,
      description,
      room,
      model,
      finish,
      size,
      origin,
      warranty,
      qty,
      unitPrice,
      discount,
      discountPercentage,
      discountAmountColumn,
      netPrice,
      netTotal,
      supplier,
      internalCost,
      margin,
      notes,
    ],
  };

  const columns = orderPdfColumns([
    manualSerial,
    ...(byLayout[layoutMode] ?? byLayout.standard_proposal),
    ...printableCustomColumns,
    ...(layoutMode !== "internal_costing" ? [supplier] : []),
  ], settings);

  return columns
    .filter((column) => column.key !== "edit")
    .filter((column) => settingsMap.get(column.key)?.visible ?? column.defaultVisible ?? true)
    .map((column) => ({
      ...column,
      width: settingsMap.get(column.key)?.width ?? column.defaultWidth,
    }));
}

export function columnWidthPercentages(columns: PdfColumn[]) {
  const total = columns.reduce((sum, column) => sum + (column.width ?? column.defaultWidth), 0) || 1;

  return columns.map((column) => `${(((column.width ?? column.defaultWidth) / total) * 100).toFixed(4)}%`);
}

function SpecificationBlock({
  item,
  settings,
  visibleColumnKeys,
}: {
  item: QuotationItem;
  settings: ReturnType<typeof specificationMetadataSettings>;
  visibleColumnKeys: Set<string>;
}) {
  const title = item.item_name_snapshot ?? item.model_snapshot ?? "Custom item";
  const cleanedSpecification = specificationWithoutDuplicateCode({
    code: item.item_code_snapshot,
    specification: item.specification_snapshot,
  });
  const detailRows = [
    settings.model && item.model_snapshot && item.model_snapshot.trim().toLowerCase() !== title.trim().toLowerCase()
      ? ["Model", item.model_snapshot]
      : null,
    item.size_snapshot ? ["Dimension", item.size_snapshot] : null,
    settings.finish && !visibleColumnKeys.has("finish") && item.finish_snapshot ? ["Finish", item.finish_snapshot] : null,
    settings.warranty && !visibleColumnKeys.has("warranty") && item.warranty_snapshot ? ["Warranty", item.warranty_snapshot] : null,
  ].filter((row): row is [string, string] => Boolean(row));

  return (
    <div className="space-y-0.5">
      {settings.title ? <p className="font-semibold text-zinc-950">{title}</p> : null}
      {cleanedSpecification ? (
        <p className="whitespace-pre-wrap text-zinc-700">{cleanedSpecification}</p>
      ) : null}
      {detailRows.map(([label, value]) => (
        <p key={label} className="text-zinc-600">{label}: {value}</p>
      ))}
      {item.room_name_snapshot ? <p className="text-zinc-500">Room: {item.room_name_snapshot}</p> : null}
    </div>
  );
}

function fullWidthRowText(item: QuotationItem) {
  return [item.item_name_snapshot, item.specification_snapshot]
    .filter(Boolean)
    .join(" - ");
}

function isHeadingRow(item: QuotationItem) {
  return item.line_style === "heading";
}

function isFullWidthPdfRow(item: QuotationItem) {
  return item.line_style === "heading" || item.line_style === "note" || item.item_type === "blank";
}

function isSerialCountedLine(item: QuotationItem) {
  return !["heading", "note", "no_quote"].includes(item.line_style) && !["heading", "note", "blank", "subtotal"].includes(item.item_type);
}

function isPriceHiddenLine(item: QuotationItem) {
  return ["note", "heading", "blank"].includes(item.item_type) || ["note", "heading", "no_quote"].includes(item.line_style);
}

function tableCellClass(column: PdfColumn) {
  const align = column.align === "right"
    ? "text-right"
    : column.align === "center"
      ? "text-center"
      : "text-left";

  return `border border-zinc-300 px-1 py-1 align-middle ${align}`;
}

function renderPdfCell({
  column,
  item,
  serial,
  proposedImageUrlByItemId,
  specifiedImageUrlByItemId,
  finishImageUrlByItemAndFinishId,
  customPrintableImageUrlByItemAndColumnId,
  settings,
  visibleColumnKeys,
  pdfSettings,
}: {
  column: PdfColumn;
  item: QuotationItem;
  serial: number;
  proposedImageUrlByItemId: Map<string, string | null>;
  specifiedImageUrlByItemId: Map<string, string | null>;
  finishImageUrlByItemAndFinishId: Map<string, string | null>;
  customPrintableImageUrlByItemAndColumnId: Map<string, string | null>;
  settings: ReturnType<typeof specificationMetadataSettings>;
  visibleColumnKeys: Set<string>;
  pdfSettings: QuotationPdfSettings;
}) {
  if ((isPriceHiddenLine(item) || item.is_rate_only) && ["qty", "unit_price", "discount", "discount_percentage", "discount_amount", "net_price", "net_total"].includes(column.key)) {
    return "-";
  }

  switch (column.key) {
    case "s_no":
      return serial ? `${serial}` : "-";
    case "manual_serial":
      return item.manual_serial ?? "-";
    case "code":
      return item.item_code_snapshot ?? "-";
    case "reference_image":
    case "proposed_image":
      return (
        <ImageBox
          imageSettings={item.cell_layout?.images?.proposed_image_url_snapshot}
          src={proposedImageUrlByItemId.get(item.id) ?? null}
          pdfSettings={pdfSettings}
        />
      );
    case "specified_image":
      return (
        <ImageBox
          imageSettings={item.cell_layout?.images?.specified_image_url_snapshot}
          src={specifiedImageUrlByItemId.get(item.id) ?? null}
          pdfSettings={pdfSettings}
        />
      );
    case "specification":
    case "description":
      return <SpecificationBlock item={item} settings={settings} visibleColumnKeys={visibleColumnKeys} />;
    case "room":
      return item.room_name_snapshot ?? "-";
    case "model":
      return item.model_snapshot ?? "-";
    case "finish":
      return (
        <FinishPdfBlock
          finishImageUrlById={new Map(
            quotationVisibleFinishes(item).map((finish, index) => {
              const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
              return [finishId, finishImageUrlByItemAndFinishId.get(`${item.id}:${finishId}`) ?? null] as const;
            }),
          )}
          item={item}
        />
      );
    case "size":
      return item.size_snapshot ?? "-";
    case "origin": {
      const originDisplay = formatBrandOriginSupplier({
        brandName: item.brand_name_snapshot,
        origin: item.origin_snapshot,
        supplier: item.supplier_name_snapshot,
      });
      return (
        <div className="flex flex-col items-center justify-center gap-1 text-center">
          {originDisplay.primaryLine ? <span className="font-medium text-zinc-800">{originDisplay.primaryLine}</span> : null}
          {originDisplay.supplier ? <span className="text-[9px] text-zinc-600">Supplier: {originDisplay.supplier}</span> : null}
          {!originDisplay.primaryLine && !originDisplay.supplier ? "-" : null}
        </div>
      );
    }
    case "warranty":
      return item.warranty_snapshot ?? "-";
    case "qty":
      return `${item.qty}`;
    case "unit_price":
      return tableNumber(item.unit_price);
    case "discount":
      return item.discount_type === "percent" ? `${item.discount_value}%` : tableNumber(item.discount_value);
    case "discount_percentage":
      return item.discount_type === "percent" ? `${item.discount_value}%` : "-";
    case "discount_amount":
      return tableNumber(discountAmount(item));
    case "net_price":
      return tableNumber(item.net_price);
    case "net_total":
      return <span className="font-semibold">{tableNumber(item.net_total)}</span>;
    case "supplier_name":
      return item.supplier_name_snapshot ?? "-";
    case "supplier_notes":
      return [item.notes, item.supplier_notes_snapshot].filter(Boolean).join("\n") || "-";
    default:
      if (column.customPrintableColumnId) {
        const value = customPrintableColumnValue(item, column.customPrintableColumnId);
        if (!value) return "-";

        if (column.customPrintableColumnType === "image") {
          return (
            <ImageBox
              imageSettings={customPrintableColumnImageSettings(item, column.customPrintableColumnId)}
              src={customPrintableImageUrlByItemAndColumnId.get(`${item.id}:${column.customPrintableColumnId}`) ?? null}
              pdfSettings={pdfSettings}
            />
          );
        }

        if (column.customPrintableColumnType === "percentage") {
          return `${value}%`;
        }

        return value;
      }

      return "-";
  }
}

function estimateItemRowUnits(item: QuotationItem, visibleColumnKeys: Set<string>, settings: QuotationPdfSettings) {
  const layout = quotationPdfLayoutMetrics(settings);
  if (isFullWidthPdfRow(item)) {
    if (item.item_type === "blank" || item.line_style === "blank") return settings.density === "comfortable" ? 0.6 : settings.density === "maxFit" ? 0.35 : 0.45;
    if (isHeadingRow(item)) return settings.density === "comfortable" ? 1 : settings.density === "maxFit" ? 0.72 : 0.85;
    return settings.density === "comfortable" ? 1.08 : settings.density === "maxFit" ? 0.82 : 0.95;
  }

  let units = settings.density === "comfortable" ? 1.45 : settings.density === "maxFit" ? 0.98 : 1.18;
  const specLength = [item.item_name_snapshot, item.specification_snapshot, item.notes].filter(Boolean).join(" ").length;
  if (specLength > 120) units += settings.density === "maxFit" ? 0.18 : 0.22;
  if (specLength > 240) units += settings.density === "maxFit" ? 0.2 : 0.24;
  if (specLength > 420) units += settings.density === "maxFit" ? 0.22 : 0.26;
  if (visibleColumnKeys.has("proposed_image") || visibleColumnKeys.has("specified_image") || visibleColumnKeys.has("reference_image")) {
    units += layout.imageHeightPx >= 90 ? 1.2 : layout.imageHeightPx <= 60 ? 0.6 : 0.95;
  }
  if (visibleColumnKeys.has("finish") && quotationVisibleFinishes(item).length > 0) {
    units += Math.min(quotationVisibleFinishes(item).length * 0.22, 0.66);
  }

  return units;
}

function rowUnits(row: ItemPageRow, visibleColumnKeys: Set<string>, settings: QuotationPdfSettings) {
  switch (row.type) {
    case "main_section_heading":
      return settings.density === "comfortable" ? 1 : settings.density === "maxFit" ? 0.7 : 0.85;
    case "section_heading":
      return row.section.section_notes
        ? settings.density === "comfortable" ? 1.25 : settings.density === "maxFit" ? 0.82 : 1.05
        : settings.density === "comfortable" ? 0.95 : settings.density === "maxFit" ? 0.62 : 0.8;
    case "column_header":
      return settings.density === "comfortable" ? 0.7 : settings.density === "maxFit" ? 0.45 : 0.55;
    case "item":
      return estimateItemRowUnits(row.item, visibleColumnKeys, settings);
    case "full_width_item":
      return estimateItemRowUnits(row.item, visibleColumnKeys, settings);
    case "section_subtotal":
      return settings.density === "comfortable" ? 0.8 : settings.density === "maxFit" ? 0.5 : 0.65;
    case "main_section_total":
      return settings.density === "comfortable" ? 0.8 : settings.density === "maxFit" ? 0.5 : 0.65;
  }
}

function pageCapacity(page: Extract<QuotationPdfPageModel, { type: "items" }>, settings: QuotationPdfSettings) {
  const layout = quotationPdfLayoutMetrics(settings);
  return page.showFullHeader ? layout.firstItemsPageCapacity : layout.continuationItemsPageCapacity;
}

export function buildQuotationPdfPages(
  data: QuotationPdfDocumentData,
  settings: QuotationPdfSettings = DEFAULT_QUOTATION_PDF_SETTINGS,
) {
  const pages: QuotationPdfPageModel[] = [{
    type: "items",
    pageNumber: 1,
    showFullHeader: true,
    rows: [],
  }];
  const manualBreaks = new Set(settings.manualPageBreaks);
  const mainSectionIds = new Set(data.mainSectionIds);
  let serial = 0;
  let lastMainSectionIdOnPage: string | null = null;

  const startItemsPage = () => {
    const page = {
      type: "items" as const,
      pageNumber: pages.length + 1,
      showFullHeader: !settings.showFullHeaderOnlyFirstPage,
      rows: [],
    };
    pages.push(page);
    lastMainSectionIdOnPage = null;
    return page;
  };

  let currentPage = pages[0];

  const ensureItemPage = () => {
    if (currentPage.type !== "items") {
      currentPage = startItemsPage();
    }
    return currentPage;
  };

  const ensureSpace = (unitsNeeded: number, continuationRows: ItemPageRow[] = []) => {
    const page = ensureItemPage();
    if (page.rows.length > 0 && page.rows.reduce((total, row) => total + rowUnits(row, data.visibleColumnKeys, settings), 0) + unitsNeeded > pageCapacity(page, settings)) {
      currentPage = startItemsPage();
      continuationRows.forEach((row) => currentPage.type === "items" && currentPage.rows.push(row));
    }
    if (page.rows.length === 0 && continuationRows.length) {
      continuationRows.forEach((row) => page.rows.push(row));
      return;
    }
  };

  const pushRow = (row: ItemPageRow, continuationRows: ItemPageRow[] = []) => {
    ensureSpace(rowUnits(row, data.visibleColumnKeys, settings), continuationRows);
    const page = ensureItemPage();
    if (continuationRows.length > 0 && page.rows.length === 0) {
      continuationRows.forEach((continuationRow) => page.rows.push(continuationRow));
    }
    page.rows.push(row);
    if (row.type === "main_section_heading") {
      lastMainSectionIdOnPage = row.section.id;
    }
  };

  for (let sectionIndex = 0; sectionIndex < data.printableSections.length; sectionIndex += 1) {
    const section = data.printableSections[sectionIndex];
    const nextSection = data.printableSections[sectionIndex + 1];

    if (section.renderAsMainOnly) {
      continue;
    }

    const sectionItems = data.itemsBySection.get(section.id) ?? [];
    const parentMainSection = section.parent_section_id && mainSectionIds.has(section.parent_section_id)
      ? data.sectionById.get(section.parent_section_id) ?? null
      : null;
    const baseSectionIntroRows: ItemPageRow[] = [
      ...(parentMainSection ? [{ type: "main_section_heading", section: parentMainSection } satisfies ItemPageRow] : []),
      { type: "section_heading", section },
      { type: "column_header" },
    ];
    const sectionContinuationRows: ItemPageRow[] = [
      { type: "section_heading", section, continued: true },
      { type: "column_header" },
    ];
    const firstItemRow = sectionItems[0]
      ? (isFullWidthPdfRow(sectionItems[0])
          ? { type: "full_width_item", item: sectionItems[0] } satisfies ItemPageRow
          : { type: "item", item: sectionItems[0], serial: 0 } satisfies ItemPageRow)
      : null;
    const activePage = ensureItemPage();
    const usedUnits = activePage.rows.reduce((total, row) => total + rowUnits(row, data.visibleColumnKeys, settings), 0);
    const availableUnits = pageCapacity(activePage, settings) - usedUnits;
    const visibleIntroRowsForCurrentPage = (Boolean(parentMainSection) && lastMainSectionIdOnPage !== parentMainSection?.id)
      ? baseSectionIntroRows
      : baseSectionIntroRows.filter((row) => row.type !== "main_section_heading");
    const sectionUnitTotal = [
      ...visibleIntroRowsForCurrentPage,
      ...sectionItems.map((item) => (
        isFullWidthPdfRow(item)
          ? { type: "full_width_item", item } satisfies ItemPageRow
          : { type: "item", item, serial: 0 } satisfies ItemPageRow
      )),
      { type: "section_subtotal", subtotal: data.sectionTotals.get(section.id) ?? 0 } satisfies ItemPageRow,
    ].reduce((total, row) => total + rowUnits(row, data.visibleColumnKeys, settings), 0);
    const introUnitTotal = visibleIntroRowsForCurrentPage.reduce((total, row) => total + rowUnits(row, data.visibleColumnKeys, settings), 0)
      + (firstItemRow ? rowUnits(firstItemRow, data.visibleColumnKeys, settings) : 0);

    if (settings.keepSectionTogether && sectionUnitTotal <= pageCapacity(activePage, settings) && sectionUnitTotal > availableUnits && activePage.rows.length > 0) {
      currentPage = startItemsPage();
    }
    if (sectionItems[0] && manualBreaks.has(sectionItems[0].id) && ensureItemPage().rows.length > 0) {
      currentPage = startItemsPage();
    }
    if (introUnitTotal > availableUnits && activePage.rows.length > 0) {
      currentPage = startItemsPage();
    }

    const visibleIntroRows = (Boolean(parentMainSection) && lastMainSectionIdOnPage !== parentMainSection?.id)
      ? baseSectionIntroRows
      : baseSectionIntroRows.filter((row) => row.type !== "main_section_heading");
    visibleIntroRows.forEach((row) => pushRow(row));

    for (let itemIndex = 0; itemIndex < sectionItems.length; itemIndex += 1) {
      const item = sectionItems[itemIndex];
      if (manualBreaks.has(item.id) && itemIndex > 0 && ensureItemPage().rows.length > 0) {
        currentPage = startItemsPage();
      }
      const row = isFullWidthPdfRow(item)
        ? { type: "full_width_item", item } satisfies ItemPageRow
        : { type: "item", item, serial: isSerialCountedLine(item) ? ++serial : 0 } satisfies ItemPageRow;
      pushRow(row, sectionContinuationRows);
    }

    const subtotalRow: ItemPageRow = {
      type: "section_subtotal",
      subtotal: data.sectionTotals.get(section.id) ?? 0,
    };
    pushRow(subtotalRow, [
      { type: "section_heading", section, continued: true },
      { type: "column_header" },
    ]);

    if (
      section.parent_section_id &&
      mainSectionIds.has(section.parent_section_id) &&
      nextSection?.parent_section_id !== section.parent_section_id
    ) {
      pushRow({
        type: "main_section_total",
        label: `${data.sectionById.get(section.parent_section_id)?.section_title || "Main Section"} Total`,
        total: data.mainSectionTotals.get(section.parent_section_id) ?? 0,
      });
    }
  }

  pages.push({ type: "notes_terms_summary", pageNumber: pages.length + 1 });

  return pages.map((page, index) => ({
    ...page,
    pageNumber: index + 1,
  }));
}

export function quotationPdfItemPageAssignments(
  data: QuotationPdfDocumentData,
  settings: QuotationPdfSettings = DEFAULT_QUOTATION_PDF_SETTINGS,
) {
  const sectionById = new Map(data.sectionById);

  return buildQuotationPdfPages(data, settings)
    .flatMap((page) => page.type === "items"
      ? page.rows
          .filter((row): row is Extract<ItemPageRow, { type: "item" | "full_width_item" }> => row.type === "item" || row.type === "full_width_item")
          .map((row) => {
            const item = row.item;
            const section = item.section_id ? sectionById.get(item.section_id) ?? null : null;
            return {
              itemId: item.id,
              itemName: item.item_name_snapshot ?? item.model_snapshot ?? item.item_code_snapshot ?? "Quotation item",
              pageNumber: page.pageNumber,
              sectionTitle: section?.section_title ?? "General Items",
              serial: row.type === "item" ? row.serial : 0,
            };
          })
      : []);
}

export function serializeQuotationPdfDocumentData(data: QuotationPdfDocumentData): SerializedQuotationPdfDocumentData {
  return {
    ...data,
    customPrintableImageUrlByItemAndColumnId: Array.from(data.customPrintableImageUrlByItemAndColumnId.entries()),
    finishImageUrlByItemAndFinishId: Array.from(data.finishImageUrlByItemAndFinishId.entries()),
    itemsBySection: Array.from(data.itemsBySection.entries()),
    mainSectionIds: Array.from(data.mainSectionIds.values()),
    mainSectionTotals: Array.from(data.mainSectionTotals.entries()),
    proposedImageUrlByItemId: Array.from(data.proposedImageUrlByItemId.entries()),
    sectionById: Array.from(data.sectionById.entries()),
    sectionTotals: Array.from(data.sectionTotals.entries()),
    specifiedImageUrlByItemId: Array.from(data.specifiedImageUrlByItemId.entries()),
    visibleColumnKeys: Array.from(data.visibleColumnKeys.values()),
  };
}

export function deserializeQuotationPdfDocumentData(data: SerializedQuotationPdfDocumentData): QuotationPdfDocumentData {
  return {
    ...data,
    customPrintableImageUrlByItemAndColumnId: new Map(data.customPrintableImageUrlByItemAndColumnId),
    finishImageUrlByItemAndFinishId: new Map(data.finishImageUrlByItemAndFinishId),
    itemsBySection: new Map(data.itemsBySection),
    mainSectionIds: new Set(data.mainSectionIds),
    mainSectionTotals: new Map(data.mainSectionTotals),
    proposedImageUrlByItemId: new Map(data.proposedImageUrlByItemId),
    sectionById: new Map(data.sectionById),
    sectionTotals: new Map(data.sectionTotals),
    specifiedImageUrlByItemId: new Map(data.specifiedImageUrlByItemId),
    visibleColumnKeys: new Set(data.visibleColumnKeys),
  };
}

function PageFooter({
  pageNumber,
  totalPages,
  settings,
}: {
  pageNumber: number;
  totalPages: number;
  settings: QuotationPdfSettings;
}) {
  const layout = quotationPdfLayoutMetrics(settings);
  return (
    <footer className={`mt-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-t border-zinc-200 pt-2 text-zinc-500 ${layout.footerTextClassName}`}>
      <span className="whitespace-nowrap">Noa Office Solutions LLC</span>
      <span className="min-w-0 text-center">
        Dubai | info@noaoffices.com | +971 4 3809234 | Abu Dhabi | sales@noaoffices.com | +971 2 5754022
      </span>
      <span className="whitespace-nowrap text-right">www.noaoffices.com | Page {pageNumber} of {totalPages}</span>
    </footer>
  );
}

function QuotationFirstPageHeader({
  client,
  companyProfile,
  hasLogo,
  project,
  quotation,
}: {
  client: Client | null;
  companyProfile: CompanyProfile;
  hasLogo: boolean;
  project: Project | null;
  quotation: Quotation;
}) {
  return (
    <>
      <header className="border-b border-zinc-300 pb-3">
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-5">
          <div className="min-w-0 justify-self-start">
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={companyProfile.logoPath ?? ""} alt={companyProfile.name} className="h-[48px] w-[160px] object-contain" />
            ) : (
              <div className="flex h-[48px] w-[160px] items-center justify-center border-2 border-zinc-900 px-4 text-center text-sm font-black leading-tight tracking-tight">
                {companyProfile.displayName}
              </div>
            )}
            <div className="mt-1.5">
              <p className="text-sm font-bold leading-tight text-zinc-950">{companyProfile.name}</p>
              <p className="mt-0.5 text-[10px] text-zinc-600">
                {companyProfile.offices.map((office) => office.location).join(" / ")}
              </p>
              <p className="text-[10px] text-zinc-600">TRN: {companyProfile.trn}</p>
            </div>
          </div>
          <div className="min-w-0 pt-1 text-center">
            <p className="text-[22px] font-bold tracking-[0.08em] text-zinc-950">QUOTATION</p>
          </div>
          <div className="min-w-0 justify-self-end text-right">
            <dl className="grid w-full max-w-[230px] justify-self-end grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
              <MetaLine label="Date" value={quotation.quotation_date} />
              {quotation.revision_no ? <MetaLine label="Revision" value={revisionLabel(quotation)} /> : null}
            </dl>
          </div>
        </div>
      </header>

      <section className="mt-2.5">
        <div className="border-b border-zinc-300 pb-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Client & Project</h2>
          <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1.5">
            <InfoLine label="Client" value={client?.company_name ?? "Unknown client"} />
            <InfoLine label="Project" value={project?.project_name ?? "Unknown project"} />
            <InfoLine label="Location" value={project?.location} />
            <InfoLine label="Project No. / Year" value={formatProjectReferenceWithYearDisplay(project)} />
            <InfoLine label="Attention / Contact" value={projectContactLine(project)} />
            <InfoLine label="Project Address" value={project?.project_address} />
          </dl>
        </div>
      </section>
    </>
  );
}

function QuotationContinuationHeader({
  companyProfile,
  project,
  quotation,
}: {
  companyProfile: CompanyProfile;
  project: Project | null;
  quotation: Quotation;
}) {
  return (
    <header className="mb-2 border-b border-zinc-300 pb-1.5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-zinc-950">Quotation</p>
          <p className="mt-1 text-[10px] text-zinc-600">
            {companyProfile.displayName} / {project?.project_name ?? quotation.title}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-right">
          <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
          <MetaLine label="Date" value={quotation.quotation_date} />
        </dl>
      </div>
    </header>
  );
}

function ItemRowsTable({
  data,
  page,
  settings,
}: {
  data: QuotationPdfDocumentData;
  page: Extract<QuotationPdfPageModel, { type: "items" }>;
  settings: QuotationPdfSettings;
}) {
  const columnCount = data.pdfColumns.length;
  const layout = quotationPdfLayoutMetrics(settings);

  return (
    <table className={`w-full table-fixed border-collapse leading-tight ${layout.tableTextClassName}`}>
      <colgroup>
        {data.pdfColumnWidths.map((width, index) => (
          <col key={`${width}-${index}`} style={{ width }} />
        ))}
      </colgroup>
      {page.rows.map((row, index) => {
        if (row.type === "main_section_heading") {
          return (
            <tbody key={`main-${row.section.id}-${index}`}>
              <tr className="bg-zinc-900">
                <td colSpan={columnCount} className="border border-zinc-900 px-3 py-1.5 text-center text-sm font-bold uppercase tracking-wide text-white">
                  {row.section.section_title}
                </td>
              </tr>
            </tbody>
          );
        }

        if (row.type === "section_heading") {
          return (
            <tbody key={`section-${row.section.id}-${index}`}>
              <tr className="bg-zinc-200">
                <td colSpan={columnCount} className="border border-zinc-300 px-3 py-1 text-center">
                  <span className="block text-sm font-bold text-zinc-950">
                    {row.section.section_title}
                    {row.continued ? " (Continued)" : ""}
                  </span>
                  {row.section.section_notes ? (
                    <span className="mt-0.5 block text-[9px] font-medium normal-case tracking-normal text-zinc-600">
                      {row.section.section_notes}
                    </span>
                  ) : null}
                </td>
              </tr>
            </tbody>
          );
        }

        if (row.type === "column_header") {
          return (
            <tbody key={`columns-${index}`}>
              <tr className="bg-zinc-100 text-left text-[8px] uppercase tracking-wide text-zinc-600">
                {data.pdfColumns.map((column) => (
                  <th key={`${column.key}-${index}`} className={tableCellClass(column)}>
                    <span className="block">{column.label}</span>
                  </th>
                ))}
              </tr>
            </tbody>
          );
        }

        if (row.type === "full_width_item") {
          return (
            <tbody key={`full-${row.item.id}-${index}`}>
              <tr>
                <td
                  colSpan={columnCount}
                  className={`border border-zinc-300 px-3 py-1 ${
                    isHeadingRow(row.item)
                      ? "bg-zinc-50 text-center text-sm font-bold text-zinc-900"
                      : "bg-white text-left text-xs text-zinc-700"
                  }`}
                >
                  {fullWidthRowText(row.item) || (isHeadingRow(row.item) ? "Heading" : "-")}
                </td>
              </tr>
            </tbody>
          );
        }

        if (row.type === "item") {
          return (
            <tbody key={`item-${row.item.id}-${index}`}>
              <tr>
                {data.pdfColumns.map((column) => (
                  <td key={`${row.item.id}-${column.key}`} className={tableCellClass(column)}>
                    {renderPdfCell({
                      column,
                      customPrintableImageUrlByItemAndColumnId: data.customPrintableImageUrlByItemAndColumnId,
                      item: row.item,
                      finishImageUrlByItemAndFinishId: data.finishImageUrlByItemAndFinishId,
                      proposedImageUrlByItemId: data.proposedImageUrlByItemId,
                      serial: row.serial,
                      pdfSettings: settings,
                      settings: data.metadataSettings,
                      specifiedImageUrlByItemId: data.specifiedImageUrlByItemId,
                      visibleColumnKeys: data.visibleColumnKeys,
                    })}
                  </td>
                ))}
              </tr>
            </tbody>
          );
        }

        if (row.type === "section_subtotal") {
          return (
            <tbody key={`subtotal-${index}`}>
              <tr className="bg-zinc-50">
                <td colSpan={Math.max(columnCount - 1, 1)} className="border border-zinc-300 px-3 py-1 text-right font-bold uppercase tracking-wide text-zinc-600">
                  Section Subtotal
                </td>
                <td className="border border-zinc-300 px-1 py-1 text-right font-bold text-zinc-950">
                  {money(data.quotation.currency, row.subtotal)}
                </td>
              </tr>
            </tbody>
          );
        }

        return (
          <tbody key={`main-total-${index}`}>
            <tr className="bg-zinc-950">
              <td colSpan={columnCount} className="border border-zinc-950 px-3 py-1.5 text-right font-bold uppercase tracking-wide text-white">
                {row.label}: {money(data.quotation.currency, row.total)}
              </td>
            </tr>
          </tbody>
        );
      })}
    </table>
  );
}

function NotesTermsSummaryPage({
  data,
  settings,
}: {
  data: QuotationPdfDocumentData;
  settings: QuotationPdfSettings;
}) {
  const resolvedNotes = settings.notesOverride?.trim() || data.defaultQuotationNotes || DEFAULT_QUOTATION_NOTES;

  return (
    <div className="grid h-full grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)] gap-5">
      <div className="grid min-h-0 gap-4">
        <section className="rounded-sm border border-zinc-300 bg-white p-4">
          <h2 className="border-b border-zinc-200 pb-2 text-sm font-bold uppercase tracking-wide text-zinc-800">
            Commercial Terms
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <InfoLine label="Payment Terms" value={data.quotation.payment_terms} />
            <InfoLine label="Validity" value={data.quotation.validity} />
            <InfoLine label="Warranty" value={data.quotation.warranty_terms} />
            <InfoLine label="Delivery Terms" value={data.quotation.delivery_terms} />
            <InfoLine label="Currency" value={data.quotation.currency} />
            <InfoLine label="VAT" value={`${data.quotation.vat_percent}%`} />
          </dl>
        </section>

        {resolvedNotes ? (
          <section className="rounded-sm border border-zinc-300 bg-white p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-800">Notes</h2>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-700">{resolvedNotes}</p>
          </section>
        ) : null}
      </div>

      <section className="rounded-sm border border-zinc-300 bg-white p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-800">Summary / Totals</h2>
        <div className="mt-3 overflow-hidden border border-zinc-900 bg-white">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
            <span>Total Price</span>
            <span className="whitespace-nowrap font-semibold">{money(data.quotation.currency, data.quotation.subtotal)}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
            <span>Item Discount</span>
            <span className="whitespace-nowrap font-semibold">{money(data.quotation.currency, data.quotation.discount_total)}</span>
          </div>
          {Number(overallDiscountAmount(data.quotation) || 0) > 0 ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
              <span>Extra Discount</span>
              <span className="whitespace-nowrap font-semibold">{money(data.quotation.currency, overallDiscountAmount(data.quotation))}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
            <span>VAT {data.quotation.vat_percent}%</span>
            <span className="whitespace-nowrap font-semibold">{money(data.quotation.currency, data.quotation.vat_amount)}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 bg-zinc-50 px-4 py-4 text-lg font-black text-zinc-950">
            <span>Final Total</span>
            <span className="whitespace-nowrap">{money(data.quotation.currency, data.quotation.grand_total)}</span>
          </div>
        </div>

        <div className="mt-5 rounded-sm border border-zinc-300 bg-white p-4">
          <div className="text-sm leading-6 text-zinc-700">
            <p>Assuring you of our best cooperation we remain,</p>
            <p className="font-semibold text-zinc-950">Yours faithfully,</p>
          </div>
          <div className="mt-6 grid gap-6 grid-cols-2">
            <div className="min-h-[96px]">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{settings.closingPreparedName?.trim() || "NOA OFFICES"}</p>
              <div className="mt-14 border-t border-zinc-400 pt-2 text-xs text-zinc-600">
                Prepared by
              </div>
            </div>
            <div className="min-h-[96px]">
              <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">For Approval</p>
              <div className="mt-14 border-t border-zinc-400 pt-2 text-xs text-zinc-600">
                Authorized signature / stamp
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function PageFrame({
  children,
  pageNumber,
  totalPages,
  settings,
}: {
  children: ReactNode;
  pageNumber: number;
  totalPages: number;
  settings: QuotationPdfSettings;
}) {
  const layout = quotationPdfLayoutMetrics(settings);
  return (
    <article
      className={`quotation-pdf-page ${layout.pageClassName} mx-auto flex max-w-full flex-col bg-white px-[10mm] pb-[8mm] pt-[8mm] shadow-sm ring-1 ring-zinc-200`}
      style={{ height: `${layout.pageHeightMm}mm`, minHeight: `${layout.pageHeightMm}mm`, width: `${layout.pageWidthMm}mm` }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
        <PageFooter pageNumber={pageNumber} totalPages={totalPages} settings={settings} />
      </div>
    </article>
  );
}

export function QuotationPdfDocument({
  data,
  printMode = false,
  settings = DEFAULT_QUOTATION_PDF_SETTINGS,
  showToolbar = false,
}: {
  data: QuotationPdfDocumentData;
  printMode?: boolean;
  settings?: QuotationPdfSettings;
  showToolbar?: boolean;
}) {
  const layout = quotationPdfLayoutMetrics(settings);
  const pages = buildQuotationPdfPages(data, settings);
  const totalPages = pages.length;

  return (
    <main className={`min-h-screen font-sans text-zinc-950 ${printMode ? "bg-white p-0" : "bg-zinc-100 px-4 py-5"}`}>
      <style>{`
        @page { size: ${settings.orientation === "landscape" ? "A4 landscape" : "A4 portrait"}; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .quotation-pdf-page {
            box-shadow: none !important;
            margin: 0 !important;
            max-width: none !important;
            page-break-after: always;
            break-after: page;
          }
          .quotation-pdf-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
      `}</style>

      {showToolbar ? (
      <div
        className="no-print mx-auto mb-4 flex max-w-full flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200"
        style={{ width: `${layout.toolbarWidthMm}mm` }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/quotations/${data.quotation.id}`}
            className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Back to Quotation
          </Link>
          <Link
            href={`/quotations/${data.quotation.id}/download-pdf`}
            className="inline-flex h-9 items-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Download PDF
          </Link>
        </div>
      </div>
      ) : null}

      <div className="space-y-5">
        {pages.map((page) => (
          <PageFrame
            key={`${page.type}-${page.pageNumber}`}
            pageNumber={page.pageNumber}
            settings={settings}
            totalPages={totalPages}
          >
            {page.type === "items" ? (
              <>
                {page.showFullHeader ? (
                  <QuotationFirstPageHeader
                    client={data.client}
                    companyProfile={data.companyProfile}
                    hasLogo={data.hasLogo}
                    project={data.project}
                    quotation={data.quotation}
                  />
                ) : (
                  <QuotationContinuationHeader
                    companyProfile={data.companyProfile}
                    project={data.project}
                    quotation={data.quotation}
                  />
                )}
                <section className={`${layout.headerSectionMarginClassName} flex-1`}>
                  <ItemRowsTable data={data} page={page} settings={settings} />
                </section>
              </>
            ) : null}
            {page.type === "notes_terms_summary" ? (
              <>
                <QuotationContinuationHeader
                  companyProfile={data.companyProfile}
                  project={data.project}
                  quotation={data.quotation}
                />
                <section className="mt-2 flex-1">
                  <NotesTermsSummaryPage data={data} settings={settings} />
                </section>
              </>
            ) : null}
          </PageFrame>
        ))}
      </div>
    </main>
  );
}
