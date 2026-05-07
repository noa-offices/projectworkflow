import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrintActions } from "@/components/quotations/print-actions";
import { requireActiveUser } from "@/lib/auth";
import { COMPANY_PROFILE } from "@/lib/company-profile";
import {
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";
import { formatQuotationMoney, quotationMoneyCell } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type QuotationPdfPageProps = {
  params: Promise<{ id: string }>;
};

type Client = {
  id: string;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string;
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

type Quotation = {
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

type QuotationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

type QuotationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
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

type CellLayout = {
  images?: Record<string, Partial<ImageDisplaySettings> | undefined>;
};

type LayoutSettings = {
  columns?: Array<{
    key?: string;
    visible?: boolean;
    width?: number;
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
};

type DisplaySection = QuotationSection & {
  renderAsMainOnly?: boolean;
};

function quotationDocumentTitle(quotation?: Pick<Quotation, "quotation_no" | "title"> | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Quotation";

  return `${quotationNo} - ${title}`.replace(/[\\/:*?"<>|]/g, "-");
}

export async function generateMetadata({ params }: QuotationPdfPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<Pick<Quotation, "quotation_no" | "title">>();

  return {
    title: quotationDocumentTitle(quotation),
  };
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
}

async function signedImageUrl(value: string | null, supabase: Awaited<ReturnType<typeof createSupabaseClient>>) {
  if (!value) return null;
  if (isDirectImageUrl(value)) return value;

  const bucket = value.startsWith("product-images:") ? "product-images" : "quote-images";
  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value.startsWith("quote-images:")
      ? value.slice("quote-images:".length)
      : value;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("QUOTATION PRINT IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
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

function quotationVisibleFinishes(item: QuotationItem) {
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
  if (!quotation.revision_no) return "-";
  return `Rev ${quotation.revision_no}`;
}

function discountAmount(item: QuotationItem) {
  if (item.discount_type === "percent") {
    return (item.unit_price * item.discount_value) / 100;
  }

  return item.discount_value || 0;
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
}: {
  imageSettings?: Partial<ImageDisplaySettings> | null;
  src: string | null;
}) {
  const settings = normalizeImageDisplaySettings(imageSettings);

  return (
    <div className="mx-auto flex h-[85px] w-[115px] items-center justify-center overflow-hidden bg-white">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Proposed item"
          className="block h-full w-full"
          style={imageDisplayStyle(settings)}
        />
      ) : null}
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
          <div key={`${id}-${index}`} className="grid grid-cols-[24px_minmax(0,1fr)] items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center overflow-hidden border border-zinc-200 bg-white">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
              ) : null}
            </span>
            <span className="leading-4">
              <span className="block font-semibold text-zinc-800">{label}</span>
              {codeName ? <span className="block text-[10px] text-zinc-600">{codeName}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function specificationMetadataSettings(settings?: LayoutSettings | null) {
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

function getPdfColumns(layoutMode: string, settings?: LayoutSettings | null) {
  const settingsMap = columnSettingsMap(settings);
  const serial: PdfColumn = { key: "s_no", label: "S. No.", defaultWidth: 54, align: "center" };
  const manualSerial: PdfColumn = { key: "manual_serial", label: "Manual S.No.", defaultWidth: 90, defaultVisible: false, align: "center" };
  const code: PdfColumn = { key: "code", label: "Code", defaultWidth: 90 };
  const referenceImage: PdfColumn = { key: "reference_image", label: "Reference Image", defaultWidth: 180, align: "center" };
  const specifiedImage: PdfColumn = { key: "specified_image", label: "Specified Item Reference Image", defaultWidth: 180, align: "center" };
  const proposedImage: PdfColumn = { key: "proposed_image", label: "Proposed Item Reference Image", defaultWidth: 180, align: "center" };
  const description: PdfColumn = {
    key: layoutMode === "boq_schedule" ? "description" : "specification",
    label: layoutMode === "boq_schedule" ? "Description" : "Specifications",
    defaultWidth: layoutMode === "standard_proposal" ? 500 : 420,
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
    simple_proposal: [serial, referenceImage, description, qty, unitPrice, netTotal],
    standard_proposal: [
      serial,
      { ...code, defaultVisible: false },
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

  const columns = [
    manualSerial,
    ...(byLayout[layoutMode] ?? byLayout.standard_proposal),
    ...(layoutMode !== "internal_costing" ? [supplier] : []),
  ];

  return columns
    .filter((column) => column.key !== "edit")
    .filter((column) => settingsMap.get(column.key)?.visible ?? column.defaultVisible ?? true)
    .map((column) => ({
      ...column,
      width: settingsMap.get(column.key)?.width ?? column.defaultWidth,
    }));
}

function columnWidthPercentages(columns: PdfColumn[]) {
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
      {item.item_code_snapshot ? (
        <p className="text-[10px] font-semibold uppercase text-zinc-500">{item.item_code_snapshot}</p>
      ) : null}
      {item.specification_snapshot ? (
        <p className="whitespace-pre-wrap text-zinc-700">{item.specification_snapshot}</p>
      ) : null}
      {detailRows.map(([label, value]) => (
        <p key={label} className="text-zinc-600">{label}: {value}</p>
      ))}
      {item.room_name_snapshot ? <p className="text-zinc-500">Room: {item.room_name_snapshot}</p> : null}
    </div>
  );
}

function sectionSubtotal(items: QuotationItem[]) {
  return items
    .filter((item) => (
      item.line_style !== "rate_only" &&
      !item.is_rate_only &&
      item.line_style !== "no_quote" &&
      item.line_style !== "note" &&
      item.line_style !== "heading" &&
      item.item_type !== "note" &&
      item.item_type !== "blank" &&
      item.item_type !== "subtotal"
    ))
    .reduce((total, item) => total + item.net_total, 0);
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

  return `border border-zinc-300 px-1.5 py-1.5 align-middle ${align}`;
}

function renderPdfCell({
  column,
  item,
  serial,
  proposedImageUrlByItemId,
  specifiedImageUrlByItemId,
  finishImageUrlByItemAndFinishId,
  settings,
  visibleColumnKeys,
}: {
  column: PdfColumn;
  item: QuotationItem;
  serial: number;
  proposedImageUrlByItemId: Map<string, string | null>;
  specifiedImageUrlByItemId: Map<string, string | null>;
  finishImageUrlByItemAndFinishId: Map<string, string | null>;
  settings: ReturnType<typeof specificationMetadataSettings>;
  visibleColumnKeys: Set<string>;
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
        />
      );
    case "specified_image":
      return (
        <ImageBox
          imageSettings={item.cell_layout?.images?.specified_image_url_snapshot}
          src={specifiedImageUrlByItemId.get(item.id) ?? null}
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
    case "origin":
      return (
        <div className="flex flex-col items-center justify-center gap-1 text-center">
          {item.supplier_name_snapshot ? <span className="font-medium text-zinc-800">{item.supplier_name_snapshot}</span> : null}
          {item.origin_snapshot ? <span className="text-[9px] text-zinc-600">{item.origin_snapshot}</span> : null}
          {!item.supplier_name_snapshot && !item.origin_snapshot ? "-" : null}
        </div>
      );
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
      return "-";
  }
}

export default async function QuotationPdfPage({ params }: QuotationPdfPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const [{ data: client }, { data: project }, { data: sections }, { data: items }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,company_name")
        .eq("id", quotation.client_id)
        .single<Client>(),
      supabase
        .from("projects")
        .select("id,project_name,project_year,project_code,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
        .eq("id", quotation.project_id)
        .single<Project>(),
      supabase
        .from("quotation_sections")
        .select("id,section_title,section_notes,parent_section_id,section_kind,sort_order,is_active")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("section_title", { ascending: true })
        .returns<QuotationSection[]>(),
      supabase
        .from("quotation_items")
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,line_style,is_rate_only,is_active,cell_layout,notes")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .returns<QuotationItem[]>(),
    ]);

  const activeItems = (items ?? []).filter((item) => item.is_active);
  const specifiedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const proposedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot, supabase),
    ] as const),
  );
  const finishImageEntries = await Promise.all(
    activeItems.flatMap((item) =>
      quotationVisibleFinishes(item).map(async (finish, index) => {
        const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
        const finishImageUrl = stringFromRecord(finish, ["finish_image_url"]);

        return [
          `${item.id}:${finishId}`,
          await signedImageUrl(finishImageUrl, supabase),
        ] as const;
      }),
    ),
  );
  const specifiedImageUrlByItemId = new Map(specifiedImageEntries);
  const proposedImageUrlByItemId = new Map(proposedImageEntries);
  const finishImageUrlByItemAndFinishId = new Map(finishImageEntries);
  const itemsBySection = new Map<string, QuotationItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    const sectionItems = itemsBySection.get(key) ?? [];
    sectionItems.push(item);
    itemsBySection.set(key, sectionItems);
  }

  const activeSections = [
    ...(sections ?? []),
    ...(itemsBySection.has("unsectioned")
      ? [{
          id: "unsectioned",
          section_title: "General Items",
          section_notes: null,
          parent_section_id: null,
          section_kind: "sub" as const,
          sort_order: 999999,
          is_active: true,
        }]
      : []),
  ];
  const pdfColumns = getPdfColumns(quotation.layout_mode, quotation.layout_settings);
  const pdfColumnWidths = columnWidthPercentages(pdfColumns);
  const visibleColumnKeys = new Set(pdfColumns.map((column) => column.key));
  const metadataSettings = specificationMetadataSettings(quotation.layout_settings);
  const sectionTotals = new Map<string, number>();

  for (const [sectionId, sectionItems] of itemsBySection.entries()) {
    sectionTotals.set(sectionId, sectionSubtotal(sectionItems));
  }

  const mainSectionIds = new Set(
    activeSections
      .filter((section) => section.section_kind === "main")
      .map((section) => section.id),
  );
  const sectionById = new Map(activeSections.map((section) => [section.id, section]));
  const childrenByParent = new Map<string, QuotationSection[]>();

  for (const section of activeSections) {
    if (section.section_kind !== "sub" || !section.parent_section_id) continue;

    const children = childrenByParent.get(section.parent_section_id) ?? [];
    children.push(section);
    childrenByParent.set(section.parent_section_id, children);
  }

  const mainSectionTotals = new Map<string, number>();

  for (const [mainSectionId, childSections] of childrenByParent.entries()) {
    mainSectionTotals.set(
      mainSectionId,
      childSections.reduce(
        (total, section) => total + (sectionTotals.get(section.id) ?? 0),
        0,
      ),
    );
  }

  const printableSections: DisplaySection[] = [];

  for (const section of activeSections) {
    if (section.section_kind === "main") {
      printableSections.push({ ...section, renderAsMainOnly: true });

      for (const child of childrenByParent.get(section.id) ?? []) {
        printableSections.push(child);
      }

      continue;
    }

    if (section.parent_section_id && mainSectionIds.has(section.parent_section_id)) {
      continue;
    }

    printableSections.push(section);
  }
  const hasLogo = existsSync(join(process.cwd(), "public", COMPANY_PROFILE.logoPath.replace(/^\//, "")));
  let runningSerialNumber = 0;

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-5 font-sans text-zinc-950 print:bg-white print:p-0">
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          .print-sheet { box-shadow: none !important; width: 100% !important; max-width: 100% !important; padding: 24px !important; box-sizing: border-box !important; }
          thead { display: table-header-group; }
          .avoid-break, .final-section, .totals-box, .terms-block, .signature-block, .print-section-heading { break-inside: avoid; page-break-inside: avoid; }
          .print-section-heading { break-after: avoid; page-break-after: avoid; }
          .print-section { break-before: auto; page-break-before: auto; break-inside: auto; page-break-inside: auto; }
          .main-section-heading { break-after: avoid; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid; }
          .final-section { break-before: page; page-break-before: always; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print mx-auto mb-4 flex w-[281mm] max-w-full flex-wrap items-center justify-between gap-3">
        <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-emerald-900">
          Back to quotation
        </Link>
        <PrintActions />
      </div>

      <article className="print-sheet mx-auto box-border w-[281mm] max-w-full bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <header className="border-b border-zinc-300 pb-4">
          <div className="grid w-full max-w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-6 box-border">
            <div className="min-w-0 justify-self-start">
              {hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={COMPANY_PROFILE.logoPath} alt={COMPANY_PROFILE.name} className="h-[60px] w-[180px] object-contain" />
              ) : (
                <div className="flex h-[60px] w-[180px] items-center justify-center border-2 border-zinc-900 px-4 text-center text-base font-black leading-tight tracking-tight">
                  NOA Office Solutions
                </div>
              )}
              <div className="mt-1.5">
                <p className="text-sm font-bold leading-tight text-zinc-950">{COMPANY_PROFILE.name}</p>
                <p className="hidden">
                  {COMPANY_PROFILE.offices.map((office) => office.location).join(" · ")}
                </p>
                <p className="mt-0.5 text-xs text-zinc-600">
                  {COMPANY_PROFILE.offices.map((office) => office.location).join(" / ")}
                </p>
                <p className="text-xs text-zinc-600">TRN: {COMPANY_PROFILE.trn}</p>
              </div>
            </div>
            <div className="min-w-0 justify-self-center pt-1 text-center">
              <p className="text-[22px] font-bold tracking-[0.08em] text-zinc-950">QUOTATION</p>
            </div>
            <div className="box-border flex w-full min-w-0 justify-end justify-self-end text-right">
              <dl className="grid w-full max-w-[240px] min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <MetaLine label="Ref No." value={quotation.quotation_no ?? "Draft"} />
                <MetaLine label="Date" value={quotation.quotation_date} />
                {quotation.revision_no ? <MetaLine label="Revision" value={revisionLabel(quotation)} /> : null}
              </dl>
            </div>
          </div>
        </header>

        <section className="mt-3">
          <div className="border-b border-zinc-300 pb-3">
            <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Client & Project</h2>
            <dl className="mt-2 grid gap-x-4 gap-y-2 md:grid-cols-3">
              <InfoLine label="Client" value={client?.company_name ?? "Unknown client"} />
              <InfoLine label="Project" value={project?.project_name ?? "Unknown project"} />
              <InfoLine label="Location" value={project?.location} />
              <InfoLine label="Project No. / Year" value={[project?.project_code, project?.project_year].filter(Boolean).join(" / ")} />
              <InfoLine label="Attention / Contact" value={projectContactLine(project)} />
              <InfoLine label="Project Address" value={project?.project_address} />
            </dl>
          </div>
        </section>

        <section className="mt-4 space-y-5">
          {printableSections.map((section, sectionIndex) => {
            const nextSection = printableSections[sectionIndex + 1];
            const columnCount = pdfColumns.length;

            if (section.renderAsMainOnly) {
              const childSections = childrenByParent.get(section.id) ?? [];

              return (
                <section key={section.id} className="print-section main-section-heading">
                  <table className="w-full table-fixed border-collapse text-[9.5px] leading-tight">
                    <tbody>
                      <tr className="print-section-heading bg-zinc-900">
                        <td className="border border-zinc-900 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide text-white">
                          {section.section_title}
                        </td>
                      </tr>
                      {!childSections.length ? (
                        <tr className="avoid-break bg-zinc-950">
                          <td className="border border-zinc-950 px-3 py-1.5 text-right font-bold uppercase tracking-wide text-white">
                            {section.section_title || "Main Section"} Total: {money(quotation.currency, mainSectionTotals.get(section.id) ?? 0)}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </section>
              );
            }

            const sectionItems = itemsBySection.get(section.id) ?? [];
            const subtotal = sectionTotals.get(section.id) ?? 0;

            return (
              <section key={section.id} className="print-section">
                <table className="w-full table-fixed border-collapse text-[9.5px] leading-tight">
                  <colgroup>
                    {pdfColumnWidths.map((width, index) => (
                      <col key={`${width}-${index}`} style={{ width }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="print-section-heading bg-zinc-200">
                      <th colSpan={columnCount} className="border border-zinc-300 px-3 py-1.5 text-center">
                        <span className="block text-sm font-bold text-zinc-950">{section.section_title}</span>
                        {section.section_notes ? (
                          <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-zinc-600">
                            {section.section_notes}
                          </span>
                        ) : null}
                      </th>
                    </tr>
                    <tr className="bg-zinc-100 text-left text-[9px] uppercase tracking-wide text-zinc-600">
                      {pdfColumns.map((column) => (
                        <th key={column.key} className={tableCellClass(column)}>
                          <span className="block">{column.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sectionItems.map((item) => {
                      const rowSerial = isSerialCountedLine(item)
                        ? ++runningSerialNumber
                        : 0;

                      return isFullWidthPdfRow(item) ? (
                        <tr key={item.id} className="avoid-break">
                          <td
                            colSpan={columnCount}
                            className={`border border-zinc-300 px-3 py-1.5 ${
                              isHeadingRow(item)
                                ? "bg-zinc-50 text-center text-sm font-bold text-zinc-900"
                                : "bg-white text-left text-xs text-zinc-700"
                            }`}
                          >
                            {fullWidthRowText(item) || (isHeadingRow(item) ? "Heading" : "-")}
                          </td>
                        </tr>
                      ) : (
                        <tr key={item.id}>
                          {pdfColumns.map((column) => (
                            <td key={`${item.id}-${column.key}`} className={tableCellClass(column)}>
                              {renderPdfCell({
                                column,
                                item,
                                finishImageUrlByItemAndFinishId,
                                proposedImageUrlByItemId,
                                serial: rowSerial,
                                settings: metadataSettings,
                                specifiedImageUrlByItemId,
                                visibleColumnKeys,
                              })}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    <tr className="avoid-break bg-zinc-50">
                      <td colSpan={Math.max(columnCount - 1, 1)} className="border border-zinc-300 px-3 py-1.5 text-right font-bold uppercase tracking-wide text-zinc-600">
                        Section Subtotal
                      </td>
                      <td className="border border-zinc-300 px-1.5 py-1.5 text-right font-bold text-zinc-950">
                        {money(quotation.currency, subtotal)}
                      </td>
                    </tr>
                    {section.parent_section_id &&
                    mainSectionIds.has(section.parent_section_id) &&
                    nextSection?.parent_section_id !== section.parent_section_id ? (
                      <tr className="avoid-break bg-zinc-950">
                        <td colSpan={columnCount} className="border border-zinc-950 px-3 py-1.5 text-right font-bold uppercase tracking-wide text-white">
                          {sectionById.get(section.parent_section_id)?.section_title || "Main Section"} Total: {money(quotation.currency, mainSectionTotals.get(section.parent_section_id) ?? 0)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            );
          })}
        </section>

        <section className="final-section mt-6 w-full max-w-full box-border">
          <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="terms-block min-w-0 rounded-sm border border-zinc-300 bg-white p-4">
              {quotation.notes ? (
                <div className="mb-4 border-l-4 border-emerald-900 bg-zinc-50 p-3">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-zinc-500">Notes</h2>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-700">{quotation.notes}</p>
                </div>
              ) : null}
              <div>
                <h2 className="border-b border-zinc-200 pb-2 text-sm font-bold uppercase tracking-wide text-zinc-800">
                  Commercial Terms
                </h2>
                <dl className="mt-3 grid gap-x-4 gap-y-3 md:grid-cols-3">
                  <InfoLine label="Payment Terms" value={quotation.payment_terms} />
                  <InfoLine label="Validity" value={quotation.validity} />
                  <InfoLine label="Warranty" value={quotation.warranty_terms} />
                  <InfoLine label="Delivery Terms" value={quotation.delivery_terms} />
                  <InfoLine label="Currency" value={quotation.currency} />
                  <InfoLine label="VAT" value={`${quotation.vat_percent}%`} />
                </dl>
              </div>
            </div>
            <div className="totals-box box-border w-full max-w-[420px] justify-self-end overflow-hidden border border-zinc-900 bg-white shadow-sm">
              <div className="bg-zinc-900 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white">
                Summary / Totals
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
                <span>Total Price</span>
                <span className="whitespace-nowrap font-semibold">{money(quotation.currency, quotation.subtotal)}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
                <span>Item Discount</span>
                <span className="whitespace-nowrap font-semibold">{money(quotation.currency, quotation.discount_total)}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
                <span>Extra Discount</span>
                <span className="whitespace-nowrap font-semibold">{money(quotation.currency, overallDiscountAmount(quotation))}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-zinc-200 px-4 py-2.5 text-xs">
                <span>VAT {quotation.vat_percent}%</span>
                <span className="whitespace-nowrap font-semibold">{money(quotation.currency, quotation.vat_amount)}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 bg-zinc-50 px-4 py-4 text-lg font-black text-zinc-950">
                <span>Final Total</span>
                <span className="whitespace-nowrap">{money(quotation.currency, quotation.grand_total)}</span>
              </div>
            </div>
          </div>

          <div className="signature-block mt-6 rounded-sm border border-zinc-300 bg-white p-5">
            <div className="text-sm leading-6 text-zinc-700">
              <p>Assuring you of our best cooperation we remain,</p>
              <p className="font-semibold text-zinc-950">Yours faithfully,</p>
            </div>
            <div className="mt-6 grid gap-8 md:grid-cols-2">
              <div className="min-h-[96px]">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">NOA Office Solutions</p>
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
      </article>
    </main>
  );
}
