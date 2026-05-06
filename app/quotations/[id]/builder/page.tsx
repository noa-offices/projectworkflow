import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ContextBackLink } from "@/components/navigation/context-back-link";
import { InlineRowAutosave } from "@/components/quotations/inline-row-autosave";
import { CellFormattingToolbar } from "@/components/quotations/cell-formatting-toolbar";
import {
  type ProductLibraryLinkedFamily,
  ProductLibrarySelector,
  type ProductLibraryBrand,
  type ProductLibraryCategory,
  type ProductLibraryComponent,
  type ProductLibraryTemplate,
} from "@/components/quotations/product-library-selector";
import { QuotationSheetTable } from "@/components/quotations/quotation-sheet-table";
import { QuotationImageCell } from "@/components/quotations/quotation-image-cell";
import {
  CopyQuotationRowButton,
  PasteQuotationRowControls,
} from "@/components/quotations/quotation-row-clipboard";
import { RowHeightTextarea } from "@/components/quotations/row-height-textarea";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, formatMoney, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  createQuotationItem,
  createQuotationSection,
  deactivateQuotationItem,
  duplicateQuotationItemBelow,
  deactivateQuotationSection,
  moveQuotationItemDown,
  moveQuotationItemUp,
  updateQuotationExtraDiscount,
  updateQuotationLayoutSettings,
  updateQuotationItemInline,
  updateQuotationItem,
  updateQuotationSection,
} from "../../actions";

export const dynamic = "force-dynamic";

type BuilderPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string; view?: string }>;
};

type Client = { id: string; company_name: string };

type Project = {
  id: string;
  project_name: string;
  project_year: number | null;
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
  title: string;
  quotation_date: string;
  status: string;
  layout_mode: string;
  currency: string;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  grand_total: number;
  layout_settings: LayoutSettings | null;
};

type QuotationSection = {
  id: string;
  quotation_id: string;
  section_title: string;
  section_notes: string | null;
  section_type: string;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  title_align: string;
  title_bold: boolean;
  title_bg: string;
  title_size: string;
  row_height: number | null;
  sort_order: number;
  is_active: boolean;
};

type DisplaySection = QuotationSection & {
  renderAsMainOnly?: boolean;
};

type QuotationItem = {
  id: string;
  quotation_id: string;
  section_id: string | null;
  item_type: string;
  source_template_id: string | null;
  source_component_data: unknown;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  category_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  selected_options_snapshot: unknown;
  internal_components_snapshot: unknown;
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
  is_optional: boolean;
  internal_cost: number;
  margin_type: string;
  margin_value: number;
  is_rate_only: boolean;
  line_style: string;
  row_height: number | null;
  cell_layout: CellLayout | null;
  is_active: boolean;
  notes: string | null;
  created_at?: string;
};

type MergeMode = "none" | "merge_specification" | "merge_full_row";

type CellLayout = {
  mergeMode?: string;
  cells?: Record<string, CellStyle | undefined>;
  images?: Record<string, ImageDisplaySettings | undefined>;
};

type ImageDisplaySettings = {
  fit?: "contain" | "cover";
  zoom?: number;
  positionX?: number;
  positionY?: number;
};

type CellStyle = {
  fontSize?: number;
  fontWeight?: CSSProperties["fontWeight"];
  fontStyle?: CSSProperties["fontStyle"];
  textDecoration?: CSSProperties["textDecoration"];
  textAlign?: CSSProperties["textAlign"];
  wrapText?: boolean;
};

type Column = {
  key: string;
  label: string;
  className?: string;
  defaultWidth: number;
  defaultVisible?: boolean;
  render: (item: QuotationItem, serial: number, formId: string, canEdit: boolean) => ReactNode;
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

const layoutLabels = new Map([
  ["simple_proposal", "Simple Proposal"],
  ["standard_proposal", "Standard Proposal"],
  ["comparison", "Comparison"],
  ["boq_schedule", "BOQ / Schedule"],
  ["internal_costing", "Internal Costing"],
]);

const sectionTypes = [
  ["section", "Section"],
  ["option", "Option"],
  ["floor", "Floor"],
  ["room", "Room"],
  ["category", "Category"],
] as const;

const lineStyles = [
  ["normal", "Normal"],
  ["optional", "Optional"],
  ["rate_only", "Rate Only"],
  ["no_quote", "No Quote"],
  ["note", "Note"],
  ["heading", "Heading"],
] as const;

const mergeModes = [
  ["none", "No merge"],
  ["merge_specification", "Merge spec"],
  ["merge_full_row", "Merge full row"],
] as const;

const commercialColumnKeys = new Set([
  "qty",
  "unit_price",
  "discount",
  "discount_percentage",
  "discount_amount",
  "net_price",
  "net_total",
]);

const specificationMetadataFields = [
  ["title", "Show item/model title in specification"],
  ["size", "Show dimension in specification"],
  ["finish", "Show finish in specification"],
  ["warranty", "Show warranty in specification"],
] as const;

const titleAlignments = [
  ["left", "Left"],
  ["center", "Center"],
  ["right", "Right"],
] as const;

const titleBackgrounds = [
  ["light_grey", "Light grey"],
  ["white", "White"],
  ["dark_grey", "Dark grey"],
] as const;

const titleSizes = [
  ["normal", "Normal"],
  ["large", "Large"],
] as const;

function money(currency: string, value: number) {
  return formatMoney(currency, value);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function moneyCell(value: number) {
  return value.toFixed(2);
}

function totalCell(item: QuotationItem) {
  if (item.is_rate_only || item.line_style === "rate_only") return "Rate Only";
  if (item.line_style === "no_quote") return "N/A";
  if (item.line_style === "note" || item.line_style === "heading") return "-";

  return moneyCell(item.net_total);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function discountAmount(item: QuotationItem) {
  if (item.discount_type === "percent") {
    return (item.unit_price * item.discount_value) / 100;
  }

  return item.discount_value;
}

function overallDiscountAmount(quotation: Quotation) {
  const itemNetTotal = Math.max(quotation.subtotal - quotation.discount_total, 0);

  if (quotation.overall_discount_type === "percent") {
    return (itemNetTotal * quotation.overall_discount_value) / 100;
  }

  return quotation.overall_discount_value;
}

function mergeModeForItem(item: QuotationItem): MergeMode {
  const mergeMode = item.cell_layout?.mergeMode;
  if (mergeMode === "none") {
    return "none";
  }

  if (mergeMode === "merge_specification" || mergeMode === "merge_full_row") {
    return mergeMode;
  }

  if (item.line_style === "heading" || item.line_style === "note" || item.item_type === "blank") {
    return "merge_full_row";
  }

  return "none";
}

function mergedRowText(item: QuotationItem) {
  return [item.item_name_snapshot, item.specification_snapshot, item.notes]
    .filter(Boolean)
    .join("\n");
}

function cellStyleForItem(item: QuotationItem, cellKey: string): CellStyle {
  return item.cell_layout?.cells?.[cellKey] ?? {};
}

function cellStyleCss(style: CellStyle, fallbackAlign: "left" | "center" | "right" = "left"): CSSProperties {
  const wrapText = style.wrapText !== false;

  return {
    fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textDecoration: style.textDecoration,
    textAlign: style.textAlign ?? fallbackAlign,
    whiteSpace: wrapText ? "pre-wrap" : "nowrap",
    overflow: wrapText ? undefined : "hidden",
    textOverflow: wrapText ? undefined : "ellipsis",
  };
}

function visibleWrapCss(style: CSSProperties): CSSProperties {
  return {
    ...style,
    overflow: undefined,
    textOverflow: undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  };
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

function specificationTitle(item: QuotationItem) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Custom item";
}

function SpecificationDetailBlock({
  item,
  settings,
  visibleColumnKeys,
}: {
  item: QuotationItem;
  settings: ReturnType<typeof specificationMetadataSettings>;
  visibleColumnKeys: Set<string>;
}) {
  const title = specificationTitle(item).trim().toLowerCase();
  const rows = [
    settings.model &&
    item.model_snapshot &&
    item.model_snapshot.trim().toLowerCase() !== title
      ? ["Model", item.model_snapshot]
      : null,
    item.size_snapshot
      ? ["Dimension", item.size_snapshot]
      : null,
    settings.finish && !visibleColumnKeys.has("finish") && item.finish_snapshot
      ? ["Finish", item.finish_snapshot]
      : null,
    settings.warranty && !visibleColumnKeys.has("warranty") && item.warranty_snapshot
      ? ["Warranty", item.warranty_snapshot]
      : null,
  ].filter((row): row is [string, string] => Boolean(row));

  if (!rows.length) return null;

  return (
    <dl className="mt-2 grid gap-0.5 border-t border-zinc-200 pt-1.5 text-[11px] leading-4 text-zinc-500">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[88px_1fr] gap-1">
          <dt className="font-semibold text-zinc-500">{label}:</dt>
          <dd className="text-zinc-600">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CellStyleInputs({
  formId,
  item,
  cellKey,
  fallbackAlign = "left",
}: {
  formId?: string;
  item: QuotationItem;
  cellKey: string;
  fallbackAlign?: "left" | "center" | "right";
}) {
  const style = cellStyleForItem(item, cellKey);

  return (
    <>
      <input form={formId} type="hidden" name="cell_style_key" value={cellKey} />
      <input form={formId} type="hidden" name={`cell_style_${cellKey}_font_size`} defaultValue={style.fontSize ?? 12} />
      <input form={formId} type="hidden" name={`cell_style_${cellKey}_font_weight`} defaultValue={style.fontWeight ?? "400"} />
      <input form={formId} type="hidden" name={`cell_style_${cellKey}_font_style`} defaultValue={style.fontStyle ?? "normal"} />
      <input form={formId} type="hidden" name={`cell_style_${cellKey}_text_decoration`} defaultValue={style.textDecoration ?? "none"} />
      <input form={formId} type="hidden" name={`cell_style_${cellKey}_text_align`} defaultValue={style.textAlign ?? fallbackAlign} />
      <input form={formId} type="hidden" name={`cell_style_${cellKey}_wrap_text`} defaultValue={style.wrapText === false ? "false" : "true"} />
    </>
  );
}

function MergeModeSelect({ item }: { item?: QuotationItem }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Merge cells</span>
      <select
        name="merge_mode"
        defaultValue={item ? mergeModeForItem(item) : "none"}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      >
        {mergeModes.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function isPriceHiddenLine(item: QuotationItem) {
  return ["note", "heading", "blank"].includes(item.item_type) || ["note", "heading", "no_quote"].includes(item.line_style);
}

function isSectionTotalLine(item: QuotationItem) {
  return (
    !item.is_rate_only &&
    !["rate_only", "no_quote", "note", "heading"].includes(item.line_style) &&
    !["note", "blank", "subtotal"].includes(item.item_type)
  );
}

function sectionTotal(items: QuotationItem[]) {
  return items
    .filter(isSectionTotalLine)
    .reduce((total, item) => total + item.net_total, 0);
}

function isSerialCountedLine(item: QuotationItem) {
  return !["heading", "note", "no_quote"].includes(item.line_style) && item.item_type !== "blank";
}

function sectionTitleClass(section: QuotationSection) {
  if (section.section_kind === "main") {
    return "bg-zinc-900 text-center text-white font-bold text-base";
  }

  const align = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  }[section.title_align] ?? "text-center";
  const bg = {
    light_grey: "bg-zinc-200 text-zinc-950",
    white: "bg-white text-zinc-950",
    dark_grey: "bg-zinc-700 text-white",
  }[section.title_bg] ?? "bg-zinc-200 text-zinc-950";
  const weight = section.title_bold ? "font-bold" : "font-semibold";
  const size = section.title_size === "large" ? "text-base" : "text-sm";

  return `${align} ${bg} ${weight} ${size}`;
}

function Field({
  name,
  label,
  defaultValue,
  required,
  type = "text",
  step,
  className = "",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
  step?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={type === "number" ? (step ?? "0.01") : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
  className = "",
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={2}
        className="w-full resize-none border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      />
    </label>
  );
}

function CurrencySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Currency</span>
      <select
        name="currency"
        defaultValue={normalizeCurrency(defaultValue ?? defaultCurrency)}
        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
      >
        {supportedCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="h-8 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold capitalize text-zinc-700">
      {statusLabel(status)}
    </span>
  );
}

function SheetInfo({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="grid grid-cols-[92px_1fr] border-b border-zinc-200 text-xs">
      <span className="bg-zinc-50 px-2 py-1.5 font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <span className="px-2 py-1.5 text-zinc-800">{value || "-"}</span>
    </div>
  );
}

function CellInput({
  formId,
  name,
  defaultValue,
  align = "left",
  type = "text",
  step,
  cellStyle,
  formatCellKey,
}: {
  formId: string;
  name: string;
  defaultValue?: string | number | null;
  align?: "left" | "right" | "center";
  type?: string;
  step?: string;
  cellStyle?: CSSProperties;
  formatCellKey?: string;
}) {
  return (
    <input
      form={formId}
      name={name}
      type={type}
      step={type === "number" ? step : undefined}
      data-form-id={formatCellKey ? formId : undefined}
      data-format-cell={formatCellKey}
      defaultValue={defaultValue ?? ""}
      className={`w-full border-0 bg-transparent px-1 py-0.5 text-xs text-zinc-800 outline-none focus:bg-emerald-50 focus:ring-1 focus:ring-emerald-800 ${
        align === "right" ? "text-right" : align === "center" ? "text-center" : ""
      }`}
      style={cellStyle}
    />
  );
}

function SectionForm({
  quotationId,
  returnTo,
  section,
  sectionKind = section?.section_kind ?? "sub",
  parentSectionId = section?.parent_section_id ?? "",
  insertAfterSectionId,
  showSort = Boolean(section),
}: {
  quotationId: string;
  returnTo: string;
  section?: QuotationSection;
  sectionKind?: "main" | "sub";
  parentSectionId?: string | null;
  insertAfterSectionId?: string | null;
  showSort?: boolean;
}) {
  return (
    <form
      action={section ? updateQuotationSection : createQuotationSection}
      className="grid gap-2 sm:grid-cols-[1fr_130px_120px_120px_120px_auto]"
    >
      {section ? <input type="hidden" name="id" value={section.id} /> : null}
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="is_active" value="on" />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="section_kind" value={sectionKind} />
      <input type="hidden" name="parent_section_id" value={sectionKind === "sub" ? parentSectionId ?? "" : ""} />
      {insertAfterSectionId ? (
        <input type="hidden" name="insert_after_section_id" value={insertAfterSectionId} />
      ) : null}
      <Field
        name="section_title"
        label={sectionKind === "main" ? "Main section" : "Section"}
        defaultValue={section?.section_title}
      />
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
          Type
        </span>
        <select
          name="section_type"
          defaultValue={section?.section_type ?? "section"}
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        >
          {sectionTypes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {showSort ? (
        <Field
          name="sort_order"
          label="Sort"
          type="number"
          defaultValue={section?.sort_order ?? 0}
        />
      ) : null}
      <Field
        name="row_height"
        label="Row height"
        type="number"
        defaultValue={section?.row_height}
      />
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
          Align
        </span>
        <select
          name="title_align"
          defaultValue={section?.title_align ?? "center"}
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        >
          {titleAlignments.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
          Background
        </span>
        <select
          name="title_bg"
          defaultValue={section?.title_bg ?? "light_grey"}
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        >
          {titleBackgrounds.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
          Size
        </span>
        <select
          name="title_size"
          defaultValue={section?.title_size ?? "normal"}
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        >
          {titleSizes.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="flex items-end gap-2 text-xs font-semibold text-zinc-600">
        <input
          type="checkbox"
          name="title_bold"
          defaultChecked={section?.title_bold ?? true}
          className="mb-2 h-4 w-4 rounded border-zinc-300"
        />
        <span className="pb-2">Bold</span>
      </label>
      <div className="self-end">
        <SubmitButton label={section ? "Save" : "Add"} />
      </div>
      <TextArea
        name="section_notes"
        label="Notes"
        defaultValue={section?.section_notes}
        className="sm:col-span-6"
      />
    </form>
  );
}

function QuickSectionForm({
  quotationId,
  returnTo,
  label,
  sectionKind,
  parentSectionId,
  insertAfterSectionId,
  placeholder,
}: {
  quotationId: string;
  returnTo: string;
  label: string;
  sectionKind: "main" | "sub";
  parentSectionId?: string | null;
  insertAfterSectionId?: string | null;
  placeholder?: string;
}) {
  return (
    <form action={createQuotationSection} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="is_active" value="on" />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="section_kind" value={sectionKind} />
      <input type="hidden" name="parent_section_id" value={sectionKind === "sub" ? parentSectionId ?? "" : ""} />
      {insertAfterSectionId ? (
        <input type="hidden" name="insert_after_section_id" value={insertAfterSectionId} />
      ) : null}
      <input type="hidden" name="section_type" value={sectionKind === "main" ? "floor" : "section"} />
      <input type="hidden" name="title_align" value="center" />
      <input type="hidden" name="title_bg" value={sectionKind === "main" ? "dark_grey" : "light_grey"} />
      <input type="hidden" name="title_size" value={sectionKind === "main" ? "large" : "normal"} />
      <input type="hidden" name="title_bold" value="on" />
      <label className="min-w-52 flex-1">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
          {label}
        </span>
        <input
          name="section_title"
          placeholder={placeholder}
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        />
      </label>
      <SubmitButton label="Add" />
    </form>
  );
}

function InsertSectionControl({
  quotationId,
  returnTo,
  insertAfterSectionId,
  mainInsertAfterSectionId,
  parentSectionId,
  totalColumns,
  insideMain = false,
}: {
  quotationId: string;
  returnTo: string;
  insertAfterSectionId: string;
  mainInsertAfterSectionId?: string;
  parentSectionId?: string | null;
  totalColumns: number;
  insideMain?: boolean;
}) {
  return (
    <tr>
      <td colSpan={totalColumns} className="border-0 bg-white px-3 py-2">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 text-[11px] font-semibold text-zinc-500 transition hover:text-emerald-900">
            <span className="h-px flex-1 bg-zinc-200" />
            <span className="border border-dashed border-zinc-300 bg-white px-3 py-1 group-open:border-emerald-700 group-open:text-emerald-900">
              + Add section here
            </span>
            <span className="h-px flex-1 bg-zinc-200" />
          </summary>
          <div className="mx-auto mt-2 grid max-w-3xl gap-2 border border-zinc-300 bg-zinc-50 p-3 shadow-sm">
            <QuickSectionForm
              quotationId={quotationId}
              returnTo={returnTo}
              label={insideMain ? "Add Sub Section here" : "Add Section here"}
              sectionKind="sub"
              parentSectionId={insideMain ? parentSectionId : null}
              insertAfterSectionId={insertAfterSectionId}
              placeholder="Section name (optional)"
            />
            <QuickSectionForm
              quotationId={quotationId}
              returnTo={returnTo}
              label={insideMain ? "Add Main Section after this group" : "Add Main Section here"}
              sectionKind="main"
              insertAfterSectionId={mainInsertAfterSectionId ?? insertAfterSectionId}
              placeholder="GROUND FLOOR"
            />
          </div>
        </details>
      </td>
    </tr>
  );
}

function SectionTotalRow({
  currency,
  total,
  totalColumns,
}: {
  currency: string;
  total: number;
  totalColumns: number;
}) {
  return (
    <tr>
      <td
        colSpan={totalColumns}
        className="border border-zinc-300 bg-zinc-50 px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-zinc-700"
      >
        <span className="mr-4 text-zinc-500">Section Total</span>
        <span className="text-zinc-950">{money(currency, total)}</span>
      </td>
    </tr>
  );
}

function MainSectionTotalRow({
  currency,
  label,
  total,
  totalColumns,
}: {
  currency: string;
  label: string;
  total: number;
  totalColumns: number;
}) {
  return (
    <tr>
      <td
        colSpan={totalColumns}
        className="border border-zinc-950 bg-zinc-950 px-3 py-2 text-right text-sm font-bold uppercase tracking-wide text-white"
      >
        <span className="mr-4">{label || "Main Section"} Total</span>
        <span>{money(currency, total)}</span>
      </td>
    </tr>
  );
}

function LineForm({
  quotation,
  returnTo,
  sectionId,
  item,
  showInternal,
}: {
  quotation: Quotation;
  returnTo: string;
  sectionId?: string | null;
  item?: QuotationItem;
  showInternal: boolean;
}) {
  return (
    <form
      action={item ? updateQuotationItem : createQuotationItem}
      className="space-y-3"
    >
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <input type="hidden" name="quotation_id" value={quotation.id} />
      <input type="hidden" name="section_id" value={sectionId ?? item?.section_id ?? ""} />
      <input type="hidden" name="item_type" value={item?.item_type ?? "custom"} />
      <input type="hidden" name="is_active" value="on" />
      <input type="hidden" name="return_to" value={returnTo} />
      {item ? (
        <>
          <CellStyleInputs item={item} cellKey="specification" />
          <CellStyleInputs item={item} cellKey="full_row" fallbackAlign={item.line_style === "heading" ? "center" : "left"} />
        </>
      ) : null}
      {item?.is_optional ? <input type="hidden" name="is_optional" value="on" /> : null}
      {!showInternal && item ? (
        <>
          <input type="hidden" name="supplier_notes_snapshot" value={item.supplier_notes_snapshot ?? ""} />
          <input type="hidden" name="internal_cost" value={item.internal_cost} />
          <input type="hidden" name="margin_type" value={item.margin_type} />
          <input type="hidden" name="margin_value" value={item.margin_value} />
          <input type="hidden" name="notes" value={item.notes ?? ""} />
        </>
      ) : null}

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Basic</legend>
        <div className="grid gap-2 md:grid-cols-6">
          <Field name="manual_serial" label="Manual S.No." defaultValue={item?.manual_serial} />
          <Field name="item_code_snapshot" label="Code" defaultValue={item?.item_code_snapshot} />
          <Field name="item_name_snapshot" label="Item / Model Name" defaultValue={item?.item_name_snapshot} className="md:col-span-2" />
          <Field name="qty" label="Qty" type="number" step="1" defaultValue={item?.qty ?? 1} />
          <Field name="unit_label" label="Unit" defaultValue={item?.unit_label ?? "Pc"} />
          <Field name="unit_price" label="U.Price" type="number" defaultValue={item?.unit_price ?? 0} />
          <CurrencySelect defaultValue={item?.currency ?? quotation.currency} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Discount type</span>
            <select name="discount_type" defaultValue={item?.discount_type ?? "amount"} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20">
              <option value="amount">Amount</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <Field name="discount_value" label="Discount" type="number" defaultValue={item?.discount_value ?? 0} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Line style</span>
            <select name="line_style" defaultValue={item?.line_style ?? "normal"} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20">
              {lineStyles.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <Field name="sort_order" label="Sort" type="number" defaultValue={item?.sort_order ?? 0} />
          <Field name="row_height" label="Row height" type="number" defaultValue={item?.row_height} />
          <MergeModeSelect item={item} />
          <p className="self-end pb-2 text-[11px] text-zinc-500 md:col-span-3">
            Item / Model Name is the main visible title at the top of the Specification cell.
          </p>
          <label className="flex items-end gap-2 text-xs font-semibold text-zinc-600">
            <input type="checkbox" name="is_rate_only" defaultChecked={item?.is_rate_only ?? false} className="mb-2 h-4 w-4 rounded border-zinc-300" />
            <span className="pb-2">Rate only</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Specification</legend>
        <div className="grid gap-2 md:grid-cols-6">
          <TextArea name="specification_snapshot" label="Specification" defaultValue={item?.specification_snapshot} className="md:col-span-6" />
          <p className="text-[11px] text-zinc-500 md:col-span-6">
            Description appears below the main title and keeps text wrapping in the row.
          </p>
        </div>
      </fieldset>

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Product details</legend>
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Field name="room_name_snapshot" label="Room" defaultValue={item?.room_name_snapshot} />
          <Field name="model_snapshot" label="Model code / alternate model" defaultValue={item?.model_snapshot} />
          <Field name="size_snapshot" label="Dimension" defaultValue={item?.size_snapshot} />
          <Field name="finish_snapshot" label="Finish" defaultValue={item?.finish_snapshot} />
          <Field name="origin_snapshot" label="Origin" defaultValue={item?.origin_snapshot} />
          <Field name="warranty_snapshot" label="Warranty" defaultValue={item?.warranty_snapshot} />
          <Field name="supplier_name_snapshot" label="Supplier" defaultValue={item?.supplier_name_snapshot} />
        </div>
      </fieldset>

      <fieldset className="border border-zinc-300 bg-white p-3">
        <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Images</legend>
        <div className="grid gap-2 md:grid-cols-2">
          <Field name="specified_image_url_snapshot" label="Specified Image URL" defaultValue={item?.specified_image_url_snapshot} />
          <Field name="proposed_image_url_snapshot" label="Proposed / Reference Image URL" defaultValue={item?.proposed_image_url_snapshot} />
        </div>
      </fieldset>

      {showInternal ? (
        <fieldset className="border border-zinc-300 bg-white p-3">
          <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Internal</legend>
          <div className="grid gap-2 md:grid-cols-4">
            <Field name="internal_cost" label="Internal Cost" type="number" defaultValue={item?.internal_cost ?? 0} />
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Margin type</span>
              <select name="margin_type" defaultValue={item?.margin_type ?? "amount"} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20">
                <option value="amount">Amount</option>
                <option value="percent">Percent</option>
              </select>
            </label>
            <Field name="margin_value" label="Margin" type="number" defaultValue={item?.margin_value ?? 0} />
            <TextArea name="supplier_notes_snapshot" label="Supplier Notes" defaultValue={item?.supplier_notes_snapshot} className="md:col-span-2" />
            <TextArea name="notes" label="Internal Notes" defaultValue={item?.notes} className="md:col-span-2" />
          </div>
        </fieldset>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton label={item ? "Save line" : "Add line"} />
      </div>
    </form>
  );
}

function QuickLineForm({
  quotation,
  returnTo,
  sectionId,
  lineStyle,
  label,
}: {
  quotation: Quotation;
  returnTo: string;
  sectionId: string;
  lineStyle: "heading" | "note" | "no_quote";
  label: string;
}) {
  const itemType = lineStyle === "no_quote" ? "blank" : "note";

  return (
    <form action={createQuotationItem} className="grid gap-2 md:grid-cols-[1fr_120px_auto]">
      <input type="hidden" name="quotation_id" value={quotation.id} />
      <input type="hidden" name="section_id" value={sectionId} />
      <input type="hidden" name="item_type" value={itemType} />
      <input type="hidden" name="manual_serial" value="" />
      <input type="hidden" name="line_style" value={lineStyle} />
      <input type="hidden" name="merge_mode" value="merge_full_row" />
      <input type="hidden" name="currency" value={quotation.currency} />
      <input type="hidden" name="is_active" value="on" />
      <input type="hidden" name="qty" value="0" />
      <input type="hidden" name="unit_label" value="Pc" />
      <input type="hidden" name="unit_price" value="0" />
      <input type="hidden" name="discount_type" value="amount" />
      <input type="hidden" name="discount_value" value="0" />
      <input type="hidden" name="margin_type" value="amount" />
      <input type="hidden" name="margin_value" value="0" />
      <input type="hidden" name="internal_cost" value="0" />
      <input type="hidden" name="return_to" value={returnTo} />
      <Field name="item_name_snapshot" label={label} required />
      <Field name="sort_order" label="Sort" type="number" defaultValue={0} />
      <div className="self-end">
        <SubmitButton label="Add row" />
      </div>
      <TextArea name="specification_snapshot" label="Text" className="md:col-span-3" />
    </form>
  );
}

function RowActionPanel({
  brands,
  categories,
  components,
  linkedFamilies,
  productTemplates,
  quotation,
  returnTo,
  sectionId,
  showInternal,
}: {
  brands: ProductLibraryBrand[];
  categories: ProductLibraryCategory[];
  components: ProductLibraryComponent[];
  productTemplates: ProductLibraryTemplate[];
  linkedFamilies: ProductLibraryLinkedFamily[];
  quotation: Quotation;
  returnTo: string;
  sectionId: string;
  showInternal: boolean;
}) {
  const summaryClass =
    "cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50";

  return (
    <div className="border border-zinc-300 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProductLibrarySelector
          brands={brands}
          categories={categories}
          components={components}
          linkedFamilies={linkedFamilies}
          quotationId={quotation.id}
          returnTo={returnTo}
          sectionId={sectionId}
          templates={productTemplates}
        />
        <details>
          <summary className={summaryClass}>+ Item Row</summary>
          <div className="mt-3 w-[min(1080px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3">
            <LineForm
              quotation={quotation}
              returnTo={returnTo}
              sectionId={sectionId}
              showInternal={showInternal}
            />
          </div>
        </details>
        <details>
          <summary className={summaryClass}>+ Heading Row</summary>
          <div className="mt-3 w-[min(720px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3">
            <QuickLineForm
              quotation={quotation}
              returnTo={returnTo}
              sectionId={sectionId}
              lineStyle="heading"
              label="Heading"
            />
          </div>
        </details>
        <details>
          <summary className={summaryClass}>+ Note Row</summary>
          <div className="mt-3 w-[min(720px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3">
            <QuickLineForm
              quotation={quotation}
              returnTo={returnTo}
              sectionId={sectionId}
              lineStyle="note"
              label="Note title"
            />
          </div>
        </details>
        <form action={createQuotationItem}>
          <input type="hidden" name="quotation_id" value={quotation.id} />
          <input type="hidden" name="section_id" value={sectionId} />
          <input type="hidden" name="item_type" value="blank" />
          <input type="hidden" name="manual_serial" value="" />
          <input type="hidden" name="line_style" value="no_quote" />
          <input type="hidden" name="merge_mode" value="merge_full_row" />
          <input type="hidden" name="currency" value={quotation.currency} />
          <input type="hidden" name="is_active" value="on" />
          <input type="hidden" name="qty" value="0" />
          <input type="hidden" name="unit_label" value="Pc" />
          <input type="hidden" name="unit_price" value="0" />
          <input type="hidden" name="discount_type" value="amount" />
          <input type="hidden" name="discount_value" value="0" />
          <input type="hidden" name="margin_type" value="amount" />
          <input type="hidden" name="margin_value" value="0" />
          <input type="hidden" name="internal_cost" value="0" />
          <input type="hidden" name="return_to" value={returnTo} />
          <button
            type="submit"
            className="border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50"
          >
            + Blank Row
          </button>
        </form>
      </div>
    </div>
  );
}

function getColumns(layoutMode: string, showInternal: boolean, settings?: LayoutSettings | null): Column[] {
  const settingsMap = columnSettingsMap(settings);
  const metadataSettings = specificationMetadataSettings(settings);

  function settingVisible(key: string, defaultVisible = true) {
    return settingsMap.get(key)?.visible ?? defaultVisible;
  }

  const serial: Column = {
    key: "s_no",
    label: "S. No.",
    className: "w-14 text-center",
    defaultWidth: 54,
    render: (item, serial, formId, canEdit) =>
      canEdit ? (
        <CellInput
          formId={formId}
          name="manual_serial"
          defaultValue={item.manual_serial ?? serial}
          align="center"
        />
      ) : (
        item.manual_serial || serial
      ),
  };
  const manualSerial: Column = {
    key: "manual_serial",
    label: "Manual S.No.",
    className: "w-24 text-center",
    defaultWidth: 90,
    defaultVisible: false,
    render: (item, _serial, formId, canEdit) =>
      canEdit ? (
        <CellInput formId={formId} name="manual_serial" defaultValue={item.manual_serial} align="center" />
      ) : (
        item.manual_serial ?? "-"
      ),
  };
  const code: Column = {
    key: "code",
    label: "Code",
    className: "w-28",
    defaultWidth: 90,
    render: (item, _serial, formId, canEdit) =>
      canEdit ? (
        <CellInput formId={formId} name="item_code_snapshot" defaultValue={item.item_code_snapshot} />
      ) : (
        item.item_code_snapshot ?? "-"
      ),
  };
  const referenceImage: Column = {
    key: "reference_image",
    label: "Reference Image",
    className: "w-32",
    defaultWidth: 180,
    render: (item, _serial, _formId, canEdit) => (
      <QuotationImageCell
        canEdit={canEdit}
        field="proposed_image_url_snapshot"
        imageSettings={item.cell_layout?.images?.proposed_image_url_snapshot}
        itemId={item.id}
        quotationId={item.quotation_id}
        value={item.proposed_image_url_snapshot}
      />
    ),
  };
  const specifiedImage: Column = {
    key: "specified_image",
    label: "Specified Item Reference Image",
    className: "w-32",
    defaultWidth: 180,
    render: (item, _serial, _formId, canEdit) => (
      <QuotationImageCell
        canEdit={canEdit}
        field="specified_image_url_snapshot"
        imageSettings={item.cell_layout?.images?.specified_image_url_snapshot}
        itemId={item.id}
        quotationId={item.quotation_id}
        value={item.specified_image_url_snapshot}
      />
    ),
  };
  const proposedImage: Column = {
    key: "proposed_image",
    label: "Proposed Item Reference Image",
    className: "w-32",
    defaultWidth: 180,
    render: (item, _serial, _formId, canEdit) => (
      <QuotationImageCell
        canEdit={canEdit}
        field="proposed_image_url_snapshot"
        imageSettings={item.cell_layout?.images?.proposed_image_url_snapshot}
        itemId={item.id}
        quotationId={item.quotation_id}
        value={item.proposed_image_url_snapshot}
      />
    ),
  };
  const description: Column = {
    key: layoutMode === "boq_schedule" ? "description" : "specification",
    label: layoutMode === "boq_schedule" ? "Description" : "Specifications",
    className: "min-w-[320px]",
    defaultWidth: 420,
    render: (item, _serial, formId, canEdit) => {
      const style = cellStyleForItem(item, "specification");
      const css = cellStyleCss(style);
      const displayCss = visibleWrapCss(css);

      return (
      <div className="flex min-h-full flex-col justify-center text-left" style={canEdit ? css : displayCss}>
        {canEdit ? <CellStyleInputs formId={formId} item={item} cellKey="specification" /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <CellInput
              formId={formId}
              name="item_name_snapshot"
              defaultValue={item.item_name_snapshot}
              cellStyle={css}
              formatCellKey="specification"
            />
          ) : (
            <span className="font-semibold text-zinc-950">
              {specificationTitle(item)}
            </span>
          )}
          {(item.line_style === "optional" || item.is_optional) ? (
            <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
              Optional
            </span>
          ) : null}
        </div>
        <div className="mt-1">
          {canEdit ? (
            <RowHeightTextarea
              formId={formId}
              name="specification_snapshot"
              defaultValue={item.specification_snapshot}
              rowHeight={item.row_height}
              cellStyle={css}
              formatCellKey="specification"
            />
          ) : (
            <p className="text-zinc-700" style={displayCss}>
              {item.specification_snapshot ?? "-"}
            </p>
          )}
        </div>
        {item.size_snapshot ? (
          <p className="mt-1 text-xs leading-4 text-zinc-500" style={displayCss}>
            <span className="font-semibold">Dimension:</span> {item.size_snapshot}
          </p>
        ) : null}
      </div>
      );
    },
  };
  const room: Column = { key: "room", label: "Room", className: "w-28", defaultWidth: 110, render: (item, _serial, formId, canEdit) => canEdit ? <CellInput formId={formId} name="room_name_snapshot" defaultValue={item.room_name_snapshot} /> : item.room_name_snapshot ?? "-" };
  const model: Column = { key: "model", label: "Model", className: "w-28", defaultWidth: 110, render: (item, _serial, formId, canEdit) => canEdit ? <CellInput formId={formId} name="model_snapshot" defaultValue={item.model_snapshot} /> : item.model_snapshot ?? "-" };
  const finish: Column = { key: "finish", label: "Finish", className: "w-28", defaultWidth: 110, render: (item, _serial, formId, canEdit) => canEdit ? <CellInput formId={formId} name="finish_snapshot" defaultValue={item.finish_snapshot} /> : item.finish_snapshot ?? "-" };
  const size: Column = { key: "size", label: "Size", className: "w-28", defaultWidth: 110, render: (item, _serial, formId, canEdit) => canEdit ? <CellInput formId={formId} name="size_snapshot" defaultValue={item.size_snapshot} /> : item.size_snapshot ?? "-" };
  const origin: Column = {
    key: "origin",
    label: "ORIGIN / SUPPLIER",
    className: "w-32",
    defaultWidth: 136,
    render: (item, _serial, formId, canEdit) =>
      canEdit ? (
        <div className="grid h-full content-center gap-1">
          <CellInput formId={formId} name="origin_snapshot" defaultValue={item.origin_snapshot} />
          <CellInput formId={formId} name="supplier_name_snapshot" defaultValue={item.supplier_name_snapshot} />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center whitespace-pre-wrap text-center leading-5">
          {[
            item.origin_snapshot,
            item.supplier_name_snapshot,
          ].filter(Boolean).join("\n") || "-"}
        </div>
      ),
  };
  const warranty: Column = { key: "warranty", label: "Warranty", className: "w-24", defaultWidth: 100, render: (item, _serial, formId, canEdit) => canEdit ? <CellInput formId={formId} name="warranty_snapshot" defaultValue={item.warranty_snapshot} /> : item.warranty_snapshot ?? "-" };
  const qty: Column = {
    key: "qty",
    label: "Qty",
    className: "w-20 text-center",
    defaultWidth: 70,
    render: (item, _serial, formId, canEdit) =>
      isPriceHiddenLine(item) ? (
        "-"
      ) : canEdit ? (
        <div className="grid h-full grid-cols-[1fr_44px] items-center gap-1">
          <CellInput formId={formId} name="qty" type="number" step="1" defaultValue={formatNumber(item.qty)} align="center" />
          <CellInput formId={formId} name="unit_label" defaultValue={item.unit_label} align="center" />
        </div>
      ) : (
        `${formatNumber(item.qty)} ${item.unit_label}`
      ),
  };
  const unitPrice: Column = {
    key: "unit_price",
    label: "U.Price",
    className: "w-24 text-center",
    defaultWidth: 90,
    render: (item, _serial, formId, canEdit) =>
      isPriceHiddenLine(item) ? "-" : canEdit ? <CellInput formId={formId} name="unit_price" type="number" step="0.01" defaultValue={item.unit_price} align="center" /> : moneyCell(item.unit_price),
  };
  const discount: Column = {
    key: "discount",
    label: "Discount",
    className: "w-24 text-center",
    defaultWidth: 90,
    render: (item, _serial, formId, canEdit) =>
      isPriceHiddenLine(item)
        ? "-"
        : canEdit
          ? <CellInput formId={formId} name="discount_value" type="number" step="0.01" defaultValue={item.discount_value} align="center" />
          : item.discount_type === "percent"
            ? `${formatNumber(item.discount_value)}%`
            : moneyCell(item.discount_value),
  };
  const discountPercentage: Column = {
    key: "discount_percentage",
    label: "Discount %",
    className: "w-24 text-center",
    defaultWidth: 90,
    defaultVisible: false,
    render: (item) =>
      isPriceHiddenLine(item)
        ? "-"
        : item.discount_type === "percent"
          ? `${formatNumber(item.discount_value)}%`
          : "-",
  };
  const discountAmountColumn: Column = {
    key: "discount_amount",
    label: "Disc. Amount",
    className: "w-28 text-center",
    defaultWidth: 96,
    defaultVisible: false,
    render: (item) => (isPriceHiddenLine(item) ? "-" : moneyCell(discountAmount(item))),
  };
  const netPrice: Column = {
    key: "net_price",
    label: "Net Price",
    className: "w-24 text-center",
    defaultWidth: 96,
    render: (item) => (isPriceHiddenLine(item) ? "-" : moneyCell(item.net_price)),
  };
  const netTotal: Column = {
    key: "net_total",
    label: "Net Total",
    className: "w-28 text-center font-bold",
    defaultWidth: 106,
    render: totalCell,
  };
  const supplier: Column = {
    key: "supplier_name",
    label: "Supplier",
    className: "w-32",
    defaultWidth: 128,
    defaultVisible: layoutMode === "internal_costing",
    render: (item, _serial, formId, canEdit) =>
      canEdit ? (
        <CellInput formId={formId} name="supplier_name_snapshot" defaultValue={item.supplier_name_snapshot} />
      ) : (
        item.supplier_name_snapshot ?? "-"
      ),
  };
  const internalCost: Column = {
    key: "internal_cost",
    label: "Internal Cost",
    className: "w-28 text-right",
    defaultWidth: 112,
    render: (item) => moneyCell(item.internal_cost),
  };
  const margin: Column = {
    key: "margin",
    label: "Margin",
    className: "w-24 text-right",
    defaultWidth: 96,
    render: (item) =>
      item.margin_type === "percent" ? `${item.margin_value}%` : moneyCell(item.margin_value),
  };
  const notes: Column = {
    key: "supplier_notes",
    label: "Internal / Supplier Notes",
    className: "min-w-[220px]",
    defaultWidth: 240,
    render: (item) => [item.notes, item.supplier_notes_snapshot].filter(Boolean).join("\n") || "-",
  };

  const byLayout: Record<string, Column[]> = {
    simple_proposal: [serial, referenceImage, description, qty, unitPrice, netTotal],
    standard_proposal: [
      serial,
      { ...code, defaultVisible: false },
      { ...specifiedImage, defaultVisible: false },
      proposedImage,
      { ...description, defaultWidth: 500 },
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

  const columns = byLayout[layoutMode] ?? byLayout.standard_proposal;
  const columnsWithManualSerial = [manualSerial, ...columns];
  const allColumns =
    showInternal && layoutMode !== "internal_costing"
      ? [...columnsWithManualSerial, supplier, internalCost, margin, notes]
      : layoutMode !== "internal_costing"
        ? [...columnsWithManualSerial, supplier]
        : columnsWithManualSerial;
  const visibleColumnKeys = new Set(
    allColumns
      .filter((column) => settingVisible(column.key, column.defaultVisible ?? true))
      .map((column) => column.key),
  );

  description.render = (item, _serial, formId, canEdit) => {
    const style = cellStyleForItem(item, "specification");
    const css = cellStyleCss(style);
    const titleStyle: CSSProperties = {
      ...css,
      fontWeight: css.fontWeight ?? 600,
    };
    const descriptionStyle: CSSProperties = {
      ...css,
      fontWeight: css.fontWeight,
    };
    const displayTitleStyle = visibleWrapCss(titleStyle);
    const displayDescriptionStyle = visibleWrapCss(descriptionStyle);

    return (
      <div className="flex min-h-full flex-col justify-center text-left">
        {canEdit ? <CellStyleInputs formId={formId} item={item} cellKey="specification" /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <CellInput
              formId={formId}
              name="item_name_snapshot"
              defaultValue={item.item_name_snapshot}
              cellStyle={titleStyle}
              formatCellKey="specification"
            />
          ) : metadataSettings.title ? (
            <span className="text-zinc-950" style={displayTitleStyle}>
              {specificationTitle(item)}
            </span>
          ) : null}
          {metadataSettings.title ? null : canEdit ? (
            <span className="text-[10px] font-semibold uppercase text-zinc-400">Title hidden in client display</span>
          ) : null}
          {(item.line_style === "optional" || item.is_optional) ? (
            <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
              Optional
            </span>
          ) : null}
        </div>
        <div className="mt-1.5">
          {canEdit ? (
            <RowHeightTextarea
              formId={formId}
              name="specification_snapshot"
              defaultValue={item.specification_snapshot}
              rowHeight={item.row_height}
              cellStyle={descriptionStyle}
              formatCellKey="specification"
            />
          ) : (
            <p className="text-zinc-700" style={displayDescriptionStyle}>
              {item.specification_snapshot ?? "-"}
            </p>
          )}
        </div>
        <SpecificationDetailBlock
          item={item}
          settings={metadataSettings}
          visibleColumnKeys={visibleColumnKeys}
        />
      </div>
    );
  };

  if (showInternal && layoutMode !== "internal_costing") {
    return [...columnsWithManualSerial, supplier, internalCost, margin, notes];
  }

  if (layoutMode !== "internal_costing") {
    return [...columnsWithManualSerial, supplier];
  }

  return columnsWithManualSerial;
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

function configuredColumns(columns: Column[], settings?: LayoutSettings | null) {
  const settingsMap = columnSettingsMap(settings);

  return columns
    .filter((column) => settingsMap.get(column.key)?.visible ?? column.defaultVisible ?? true)
    .map((column) => ({
      ...column,
      width: settingsMap.get(column.key)?.width ?? column.defaultWidth,
    }));
}

function ColumnSettingsForm({
  quotation,
  returnTo,
  columns,
  canManageRecords,
}: {
  quotation: Quotation;
  returnTo: string;
  columns: Column[];
  canManageRecords: boolean;
}) {
  const settingsMap = columnSettingsMap(quotation.layout_settings);
  const metadataSettings = specificationMetadataSettings(quotation.layout_settings);
  const editableColumns = canManageRecords
    ? [...columns, { key: "edit", label: "Edit / Actions", defaultWidth: 132, defaultVisible: true }]
    : columns;

  return (
    <form action={updateQuotationLayoutSettings} className="space-y-3">
      <input type="hidden" name="quotation_id" value={quotation.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <p className="text-xs text-zinc-500">
        Column changes apply only to this quotation. Adjust width here or drag a header edge in the sheet.
      </p>
      <fieldset className="border border-zinc-200 bg-zinc-50 p-2">
        <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
          Specification details
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {specificationMetadataFields.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
              <input
                type="checkbox"
                name={`show_spec_${key}`}
                defaultChecked={metadataSettings[key]}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {editableColumns.map((column) => {
          const setting = settingsMap.get(column.key);

          return (
            <div
              key={column.key}
              className="grid grid-cols-[1fr_86px] gap-2 border border-zinc-200 bg-zinc-50 p-2"
            >
              <input type="hidden" name="column_key" value={column.key} />
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                <input
                  type="checkbox"
                  name={`visible_${column.key}`}
                  defaultChecked={setting?.visible ?? column.defaultVisible ?? true}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span>Show column: {column.label}</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">
                  Width px
                </span>
                <input
                  name={`width_${column.key}`}
                  type="number"
                  min={40}
                  max={800}
                  defaultValue={setting?.width ?? column.defaultWidth}
                  className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <SubmitButton label="Save columns" />
      </div>
    </form>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RowMoveDeactivateActions({
  item,
  quotationId,
  returnTo,
}: {
  item: QuotationItem;
  quotationId: string;
  returnTo: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <form action={moveQuotationItemUp}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button
          type="submit"
          title="Move up"
          className="h-7 border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
        >
          ↑
        </button>
      </form>
      <form action={moveQuotationItemDown}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button
          type="submit"
          title="Move down"
          className="h-7 border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
        >
          ↓
        </button>
      </form>
      <form action={deactivateQuotationItem}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button
          type="submit"
          className="h-7 border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 transition hover:border-red-700"
        >
          Deactivate
        </button>
      </form>
    </div>
  );
}

function RowMoveActions({
  item,
  quotationId,
  returnTo,
}: {
  item: QuotationItem;
  quotationId: string;
  returnTo: string;
}) {
  const buttonClass =
    "h-6 min-w-6 border border-zinc-300 bg-white px-1.5 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900";

  return (
    <div className="flex items-center gap-1">
      <form action={moveQuotationItemUp}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button type="submit" title="Move up" className={buttonClass}>
          ^
        </button>
      </form>
      <form action={moveQuotationItemDown}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotationId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <button type="submit" title="Move down" className={buttonClass}>
          v
        </button>
      </form>
    </div>
  );
}

function DeactivateRowAction({
  item,
  quotationId,
  returnTo,
}: {
  item: QuotationItem;
  quotationId: string;
  returnTo: string;
}) {
  return (
    <form action={deactivateQuotationItem}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <button
        type="submit"
        className="h-7 border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 transition hover:border-red-700"
      >
        Deactivate
      </button>
    </form>
  );
}

function rowClipboardPayload({
  item,
  quotation,
}: {
  item: QuotationItem;
  quotation: Quotation;
}) {
  return {
    copied_at: new Date().toISOString(),
    source_item_id: item.id,
    source_quotation_id: quotation.id,
    source_quotation_label: quotation.quotation_no ?? quotation.title,
    source_section_id: item.section_id,
    row_snapshot: {
      item_type: item.item_type,
      source_template_id: item.source_template_id,
      source_component_data: item.source_component_data,
      item_code_snapshot: item.item_code_snapshot,
      item_name_snapshot: item.item_name_snapshot,
      brand_name_snapshot: item.brand_name_snapshot,
      category_name_snapshot: item.category_name_snapshot,
      specified_image_url_snapshot: item.specified_image_url_snapshot,
      proposed_image_url_snapshot: item.proposed_image_url_snapshot,
      specification_snapshot: item.specification_snapshot,
      selected_options_snapshot: item.selected_options_snapshot,
      internal_components_snapshot: item.internal_components_snapshot,
      room_name_snapshot: item.room_name_snapshot,
      model_snapshot: item.model_snapshot,
      finish_snapshot: item.finish_snapshot,
      size_snapshot: item.size_snapshot,
      origin_snapshot: item.origin_snapshot,
      warranty_snapshot: item.warranty_snapshot,
      supplier_name_snapshot: item.supplier_name_snapshot,
      supplier_notes_snapshot: item.supplier_notes_snapshot,
      qty: item.qty,
      unit_label: item.unit_label,
      unit_price: item.unit_price,
      discount_type: item.discount_type,
      discount_value: item.discount_value,
      net_price: item.net_price,
      net_total: item.net_total,
      currency: item.currency,
      is_optional: item.is_optional,
      internal_cost: item.internal_cost,
      margin_type: item.margin_type,
      margin_value: item.margin_value,
      is_rate_only: item.is_rate_only,
      line_style: item.line_style,
      row_height: item.row_height,
      cell_layout: item.cell_layout,
      notes: item.notes,
    },
  };
}

function InlineRowActions({
  item,
  quotation,
  returnTo,
  inlineFormId,
  showInternal,
}: {
  item: QuotationItem;
  quotation: Quotation;
  returnTo: string;
  inlineFormId: string;
  showInternal: boolean;
}) {
  return (
    <div className="grid h-full content-center justify-items-center gap-1">
      <form id={inlineFormId} action={updateQuotationItemInline}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotation.id} />
        <input type="hidden" name="return_to" value={returnTo} />
      </form>
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          form={inlineFormId}
          className="h-6 border border-emerald-900 bg-emerald-900 px-2 text-[11px] font-semibold text-white transition hover:bg-emerald-800"
        >
          Save
        </button>
        <InlineRowAutosave formId={inlineFormId} />
      </div>
      <div className="flex items-center gap-1">
        <RowMoveActions item={item} quotationId={quotation.id} returnTo={returnTo} />
        <details className="relative">
          <summary className="h-6 cursor-pointer border border-zinc-300 bg-white px-2 py-1 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
            More
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-56 border border-zinc-300 bg-white p-2 text-left shadow-lg">
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase text-zinc-500">Merge</span>
              <select
                form={inlineFormId}
                name="merge_mode"
                defaultValue={mergeModeForItem(item)}
                className="h-7 w-full border border-zinc-300 bg-white px-1.5 text-xs text-zinc-800 outline-none focus:border-emerald-800"
              >
                {mergeModes.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <div className="mt-2 grid gap-2">
              <form action={duplicateQuotationItemBelow}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="quotation_id" value={quotation.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <button
                  type="submit"
                  className="h-7 w-full border border-zinc-300 bg-white px-2 text-left text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                >
                  Duplicate below
                </button>
              </form>
              <CopyQuotationRowButton
                payload={rowClipboardPayload({ item, quotation })}
              />
              <DeactivateRowAction item={item} quotationId={quotation.id} returnTo={returnTo} />
              <details className="relative">
                <summary className="h-7 cursor-pointer border border-zinc-300 bg-white px-2 py-1.5 text-xs font-semibold text-emerald-900">
                  Details
                </summary>
                <div className="absolute right-0 top-full z-40 mt-2 w-[1080px] max-w-[calc(100vw-3rem)] border border-zinc-300 bg-zinc-50 p-3 shadow-lg">
                  <LineForm quotation={quotation} returnTo={returnTo} item={item} showInternal={showInternal} />
                </div>
              </details>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function InlineRowEditCell({
  item,
  quotation,
  returnTo,
  inlineFormId,
  showInternal,
}: {
  item: QuotationItem;
  quotation: Quotation;
  returnTo: string;
  inlineFormId: string;
  showInternal: boolean;
}) {
  return (
    <td className="border border-zinc-300 px-1.5 py-1 text-center align-middle">
      <InlineRowActions
        item={item}
        quotation={quotation}
        returnTo={returnTo}
        inlineFormId={inlineFormId}
        showInternal={showInternal}
      />
    </td>
  );
}

function ItemRowResizeHandle({
  item,
  totalColumns,
}: {
  item: QuotationItem;
  totalColumns: number;
}) {
  return (
    <tr aria-hidden="true" className="h-0">
      <td colSpan={totalColumns} className="border-0 p-0">
        <span
          title="Drag to resize row"
          data-resize-row-id={item.id}
          data-resize-row-type="item"
          data-resize-row-target="previous"
          className="block h-1.5 cursor-row-resize border-t border-transparent transition hover:border-emerald-700"
        />
      </td>
    </tr>
  );
}

function ExtraDiscountForm({
  quotation,
  returnTo,
}: {
  quotation: Quotation;
  returnTo: string;
}) {
  return (
    <form action={updateQuotationExtraDiscount} className="grid gap-2 sm:grid-cols-[120px_1fr_auto] sm:items-end">
      <input type="hidden" name="id" value={quotation.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Extra Discount Type</span>
        <select
          name="overall_discount_type"
          defaultValue={quotation.overall_discount_type}
          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
        >
          <option value="amount">Amount</option>
          <option value="percent">Percent</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Extra Discount Value</span>
        <div className="flex h-8 border border-zinc-300 bg-white focus-within:border-emerald-800">
          <input
            name="overall_discount_value"
            type="number"
            step="0.01"
            min="0"
            defaultValue={quotation.overall_discount_value}
            className="min-w-0 flex-1 px-2 text-xs outline-none"
          />
          <span className="flex items-center border-l border-zinc-300 bg-zinc-50 px-2 text-[10px] font-semibold text-zinc-500">
            {quotation.overall_discount_type === "percent" ? "%" : quotation.currency}
          </span>
        </div>
      </label>
      <SubmitButton label="Save" />
    </form>
  );
}

export default async function QuotationBuilderPage({
  params,
  searchParams,
}: BuilderPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const view = query?.view === "internal" ? "internal" : "client";
  const showInternal = view === "internal" || query?.view === "internal";
  const builderPath = `/quotations/${id}/builder?view=${view}`;
  const { profile } = await requireActiveUser();
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) notFound();

  const { data: client } = await supabase
    .from("clients")
    .select("id,company_name")
    .eq("id", quotation.client_id)
    .single<Client>();

  const { data: project } = await supabase
    .from("projects")
    .select("id,project_name,project_year,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
    .eq("id", quotation.project_id)
    .single<Project>();

  const { data: productBrands, error: productBrandsError } = await supabase
    .from("brands")
    .select("id,name")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<ProductLibraryBrand[]>();

  const { data: productCategories, error: productCategoriesError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<ProductLibraryCategory[]>();

  const { data: productTemplates, error: productTemplatesError } = await supabase
    .from("product_templates")
    .select(
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,currency,default_unit_price",
    )
    .eq("is_active", true)
    .order("template_name", { ascending: true })
    .returns<ProductLibraryTemplate[]>();

  const { data: productComponents, error: productComponentsError } = await supabase
    .from("product_components")
    .select("id,template_id,option_type,component_group,component_code,component_name,description,qty,unit_label,unit_price,currency,is_optional,is_default_selected,sort_order,calculation_data")
    .eq("is_active", true)
    .order("template_id", { ascending: true })
    .order("option_type", { ascending: true })
    .order("component_group", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("component_name", { ascending: true })
    .returns<ProductLibraryComponent[]>();

  const { data: linkedFamilies, error: linkedFamiliesError } = await supabase
    .from("product_template_linked_families")
    .select("id,parent_template_id,linked_template_id,label,is_required,allow_multiple,add_to_parent_price,append_to_specification,default_qty,sort_order,is_active")
    .eq("is_active", true)
    .order("parent_template_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductLibraryLinkedFamily[]>();

  const { data: sections, error: sectionsError } = await supabase
    .from("quotation_sections")
    .select("id,quotation_id,section_title,section_notes,section_type,parent_section_id,section_kind,title_align,title_bold,title_bg,title_size,row_height,sort_order,is_active")
    .eq("quotation_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("section_title", { ascending: true })
    .returns<QuotationSection[]>();

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select(
      "id,quotation_id,section_id,item_type,source_template_id,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,selected_options_snapshot,internal_components_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,is_active,notes,created_at",
    )
    .eq("quotation_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<QuotationItem[]>();

  if (sectionsError) console.error("QUOTATION BUILDER SECTIONS ERROR", sectionsError.message);
  if (itemsError) console.error("QUOTATION BUILDER ITEMS ERROR", itemsError.message);
  if (productBrandsError) console.error("PRODUCT SELECTOR BRANDS ERROR", productBrandsError.message);
  if (productCategoriesError) console.error("PRODUCT SELECTOR CATEGORIES ERROR", productCategoriesError.message);
  if (productTemplatesError) console.error("PRODUCT SELECTOR TEMPLATES ERROR", productTemplatesError.message);
  if (productComponentsError) console.error("PRODUCT SELECTOR OPTIONS ERROR", productComponentsError.message);
  if (linkedFamiliesError) console.error("PRODUCT SELECTOR LINKED FAMILIES ERROR", linkedFamiliesError.message);

  const itemsBySection = new Map<string, QuotationItem[]>();

  for (const item of items ?? []) {
    const key = item.section_id ?? "unsectioned";
    const sectionItems = itemsBySection.get(key) ?? [];
    sectionItems.push(item);
    itemsBySection.set(key, sectionItems);
  }
  const sectionTotals = new Map<string, number>();

  for (const [sectionId, sectionItems] of itemsBySection.entries()) {
    sectionTotals.set(sectionId, sectionTotal(sectionItems));
  }

  const itemCurrencies = new Set(
    (items ?? [])
      .filter((item) => item.is_active)
      .map((item) => normalizeCurrency(item.currency)),
  );
  const hasMixedCurrencies =
    itemCurrencies.size > 1 ||
    (itemCurrencies.size === 1 && !itemCurrencies.has(normalizeCurrency(quotation.currency)));

  const defaultColumns = getColumns(quotation.layout_mode, showInternal, quotation.layout_settings);
  const columns = configuredColumns(defaultColumns, quotation.layout_settings);
  const settingsMap = columnSettingsMap(quotation.layout_settings);
  const showEditColumn = canManageRecords;
  const editColumnWidth = settingsMap.get("edit")?.width ?? 132;
  const totalColumns = columns.length + (showEditColumn ? 1 : 0);
  const sheetColumns = [
    ...columns.map((column) => ({ key: column.key, width: column.width })),
    ...(showEditColumn ? [{ key: "edit", width: editColumnWidth }] : []),
  ];
  const activeSections = sections ?? [];
  const sectionById = new Map(activeSections.map((section) => [section.id, section]));
  const mainSectionIds = new Set(
    activeSections
      .filter((section) => section.section_kind === "main")
      .map((section) => section.id),
  );
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

  const displaySections: DisplaySection[] = [];

  for (const section of activeSections) {
    if (section.section_kind === "main") {
      displaySections.push({ ...section, renderAsMainOnly: true });

      for (const child of childrenByParent.get(section.id) ?? []) {
        displaySections.push(child);
      }

      continue;
    }

    if (section.parent_section_id && mainSectionIds.has(section.parent_section_id)) {
      continue;
    }

    displaySections.push(section);
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      {canManageRecords ? <CellFormattingToolbar /> : null}
      <header className="sticky top-0 z-20 border-b border-zinc-300 bg-white">
        <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <ContextBackLink
              fallbackHref={`/clients/projects/${quotation.project_id}`}
              className="border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            >
              Back
            </ContextBackLink>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950">
                {quotation.quotation_no ?? "Draft quotation"} - {quotation.title}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {client?.company_name ?? "Unknown client"} / {project?.project_name ?? "Unknown project"}
              </p>
            </div>
            <StatusBadge status={quotation.status} />
            <span className="border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
              {layoutLabels.get(quotation.layout_mode) ?? quotation.layout_mode}
            </span>
            <span className="text-xs text-zinc-500">All changes saved automatically</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canManageRecords ? (
              <details className="relative">
                <summary className="cursor-pointer bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800">
                  Add Section
                </summary>
                <div className="absolute right-0 mt-2 grid w-[min(620px,calc(100vw-2rem))] gap-3 border border-zinc-300 bg-white p-3 shadow-lg">
                  <QuickSectionForm
                    quotationId={quotation.id}
                    returnTo={builderPath}
                    label="Add Main Section"
                    sectionKind="main"
                    placeholder="GROUND FLOOR"
                  />
                  <QuickSectionForm
                    quotationId={quotation.id}
                    returnTo={builderPath}
                    label="Add Section"
                    sectionKind="sub"
                    placeholder="Section name (optional)"
                  />
                </div>
              </details>
            ) : null}
            <details className="relative">
              <summary className="cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                Column settings
              </summary>
              <div className="absolute right-0 mt-2 w-[min(520px,calc(100vw-2rem))] border border-zinc-300 bg-white p-3 shadow-lg">
                <ColumnSettingsForm
                  quotation={quotation}
                  returnTo={builderPath}
                  columns={defaultColumns}
                  canManageRecords={canManageRecords}
                />
              </div>
            </details>
            <Link
              href={`/quotations/${quotation.id}/pdf`}
              target="_blank"
              className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            >
              Preview PDF
            </Link>
            <Link
              href={`/quotations/${quotation.id}/download-pdf`}
              className="bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
            >
              Download PDF
            </Link>
            <div className="flex border border-zinc-300 text-xs font-semibold">
              <Link
                href={`/quotations/${quotation.id}/builder?view=client`}
                className={`px-3 py-2 ${view === "client" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}
              >
                Client View
              </Link>
              <Link
                href={`/quotations/${quotation.id}/builder?view=internal`}
                className={`border-l border-zinc-300 px-3 py-2 ${view === "internal" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}
              >
                Internal View
              </Link>
            </div>
            <div className="border border-emerald-900 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950">
              Final Total: {money(quotation.currency, quotation.grand_total)}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1900px] px-4 py-5">
        {query?.message ? (
          <p className="mb-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {query.message}
          </p>
        ) : null}

        <section className="border border-zinc-300 bg-white">
          <div className="grid border-b border-zinc-300 lg:grid-cols-2">
            <div className="border-b border-zinc-300 lg:border-b-0 lg:border-r">
              <div className="border-b border-zinc-300 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide">
                Quotation
              </div>
              <SheetInfo label="Client" value={client?.company_name ?? "Unknown client"} />
              <SheetInfo label="Attn" value={project?.attention_to} />
              <SheetInfo
                label="Project"
                value={[project?.project_name, project?.project_year, project?.location].filter(Boolean).join(" - ")}
              />
              <SheetInfo label="PO Box" value={project?.po_box} />
              <SheetInfo label="Mob" value={project?.attention_mobile} />
              <SheetInfo label="Tel" value={project?.attention_landline} />
              <SheetInfo label="Email" value={project?.attention_email} />
            </div>
            <div>
              <div className="border-b border-zinc-300 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide">
                Reference
              </div>
              <SheetInfo label="Quote No" value={quotation.quotation_no ?? "Draft"} />
              <SheetInfo label="Date" value={quotation.quotation_date} />
              <SheetInfo label="Status" value={statusLabel(quotation.status)} />
              <SheetInfo label="Layout" value={layoutLabels.get(quotation.layout_mode) ?? quotation.layout_mode} />
              <SheetInfo label="Location" value={project?.location} />
              <SheetInfo label="Address" value={project?.project_address} />
              <SheetInfo label="View" value={showInternal ? "Internal" : "Client"} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <QuotationSheetTable quotationId={quotation.id} columns={sheetColumns}>
              <tbody>
                {displaySections.map((section, sectionIndex) => {
                  const previousSection = displaySections[sectionIndex - 1];
                  const nextSection = displaySections[sectionIndex + 1];
                  const insertAfterSectionId = previousSection?.id ?? "__start";
                  const insertInsideMain =
                    section.section_kind === "sub" &&
                    section.parent_section_id &&
                    mainSectionIds.has(section.parent_section_id);
                  const parentChildren = section.parent_section_id
                    ? childrenByParent.get(section.parent_section_id) ?? []
                    : [];
                  const mainInsertAfterSectionId = insertInsideMain
                    ? parentChildren.at(-1)?.id ?? section.parent_section_id ?? insertAfterSectionId
                    : insertAfterSectionId;

                  if (section.renderAsMainOnly) {
                    const childSections = childrenByParent.get(section.id) ?? [];
                    const lastChild = childSections.at(-1);
                    const addBelowId = lastChild?.id ?? section.id;
                    const mainSectionTotal = mainSectionTotals.get(section.id) ?? 0;

                    return (
                      <Fragment key={section.id}>
                        {canManageRecords ? (
                          <InsertSectionControl
                            quotationId={quotation.id}
                            returnTo={builderPath}
                            insertAfterSectionId={insertAfterSectionId}
                            totalColumns={totalColumns}
                          />
                        ) : null}
                        <tr>
                          <td
                            colSpan={totalColumns}
                            className={`relative border border-zinc-300 px-3 py-3 uppercase tracking-wide ${sectionTitleClass(section)}`}
                            style={section.row_height ? { height: `${section.row_height}px` } : undefined}
                          >
                            {section.section_title}
                            {canManageRecords ? (
                              <span
                                aria-hidden="true"
                                title="Drag to resize row"
                                data-resize-row-id={section.id}
                                data-resize-row-type="section"
                                className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize border-b-2 border-transparent transition hover:border-emerald-700"
                              />
                            ) : null}
                          </td>
                        </tr>
                        {canManageRecords ? (
                          <tr>
                            <td colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-center gap-2">
                                <details>
                                  <summary className="cursor-pointer border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50">
                                    + Sub Section
                                  </summary>
                                  <div className="mt-2 w-[min(560px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3">
                                    <QuickSectionForm
                                      quotationId={quotation.id}
                                      returnTo={builderPath}
                                      label="Sub Section"
                                      sectionKind="sub"
                                      parentSectionId={section.id}
                                      insertAfterSectionId={addBelowId}
                                      placeholder="Section name (optional)"
                                    />
                                  </div>
                                </details>
                                <details>
                                  <summary className="cursor-pointer border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                    Edit main section
                                  </summary>
                                  <div className="mt-2 w-[min(820px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3 text-left">
                                    <SectionForm quotationId={quotation.id} returnTo={builderPath} section={section} />
                                    <form action={deactivateQuotationSection} className="mt-2">
                                      <input type="hidden" name="id" value={section.id} />
                                      <input type="hidden" name="quotation_id" value={quotation.id} />
                                      <input type="hidden" name="return_to" value={builderPath} />
                                      <button type="submit" className="h-8 px-2 text-xs font-semibold text-zinc-500 transition hover:text-red-700">
                                        Deactivate main section
                                      </button>
                                    </form>
                                  </div>
                                </details>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {!childSections.length ? (
                          <MainSectionTotalRow
                            currency={quotation.currency}
                            label={section.section_title}
                            total={mainSectionTotal}
                            totalColumns={totalColumns}
                          />
                        ) : null}
                        {canManageRecords && nextSection?.parent_section_id !== section.id ? (
                          <InsertSectionControl
                            quotationId={quotation.id}
                            returnTo={builderPath}
                            insertAfterSectionId={addBelowId}
                            parentSectionId={section.id}
                            totalColumns={totalColumns}
                            insideMain
                          />
                        ) : null}
                      </Fragment>
                    );
                  }

                  const sectionItems = itemsBySection.get(section.id) ?? [];
                  let serialNumber = 0;

                  return (
                    <Fragment key={section.id}>
                      {canManageRecords ? (
                        <InsertSectionControl
                          quotationId={quotation.id}
                          returnTo={builderPath}
                          insertAfterSectionId={insertAfterSectionId}
                          parentSectionId={section.parent_section_id}
                          mainInsertAfterSectionId={mainInsertAfterSectionId}
                          totalColumns={totalColumns}
                          insideMain={Boolean(insertInsideMain)}
                        />
                      ) : null}
                      <tr>
                        <td
                          colSpan={totalColumns}
                          className={`relative border border-zinc-300 px-3 py-2 uppercase tracking-wide ${sectionTitleClass(section)}`}
                          style={section.row_height ? { height: `${section.row_height}px` } : undefined}
                        >
                          {section.section_title}
                          {canManageRecords ? (
                            <span
                              aria-hidden="true"
                              title="Drag to resize row"
                              data-resize-row-id={section.id}
                              data-resize-row-type="section"
                              className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize border-b-2 border-transparent transition hover:border-emerald-700"
                            />
                          ) : null}
                        </td>
                      </tr>

                      <tr className="bg-zinc-100 text-[11px] font-bold uppercase text-zinc-700">
                        {columns.map((column) => (
                          <th
                            key={`${section.id}-${column.key}`}
                            className={`relative border border-zinc-300 px-2 py-2 pr-4 ${column.className ?? ""}`}
                          >
                            {column.label}
                            <span
                              aria-hidden="true"
                              data-resize-column={column.key}
                              className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r-2 border-transparent transition hover:border-emerald-700"
                            />
                          </th>
                        ))}
                        {showEditColumn ? (
                          <th
                            className="relative border border-zinc-300 px-2 py-2 pr-4"
                          >
                            Edit
                            <span
                              aria-hidden="true"
                              data-resize-column="edit"
                              className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r-2 border-transparent transition hover:border-emerald-700"
                            />
                          </th>
                        ) : null}
                      </tr>

                      {section.section_notes ? (
                        <tr>
                          <td colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                            {section.section_notes}
                          </td>
                        </tr>
                      ) : null}

                      {!sectionItems.length ? (
                        <tr>
                          <td
                            colSpan={totalColumns}
                            className="border border-zinc-300 bg-white px-3 py-5 text-center text-sm text-zinc-500"
                          >
                            Add your first item row.
                          </td>
                        </tr>
                      ) : null}

                      {sectionItems.map((item) => {
                        const mergedText = item.item_name_snapshot ?? item.specification_snapshot ?? "";
                        const rowSerial = isSerialCountedLine(item) ? ++serialNumber : 0;
                        const inlineFormId = `inline-row-${item.id}`;
                        const mergeMode = mergeModeForItem(item);

                        if (mergeMode === "merge_full_row") {
                          const fullRowStyle = cellStyleForItem(item, "full_row");
                          const fullRowCss = cellStyleCss(
                            fullRowStyle,
                            item.line_style === "heading" ? "center" : "left",
                          );

                          return (
                            <Fragment key={item.id}>
                              <tr
                                className="align-middle"
                                style={item.row_height ? { height: `${item.row_height}px` } : undefined}
                              >
                                <td
                                  colSpan={showEditColumn ? totalColumns - 1 : totalColumns}
                                  className={`border border-zinc-300 px-3 py-2 text-zinc-800 ${
                                    item.line_style === "heading"
                                      ? "bg-zinc-100 text-center text-sm font-bold uppercase text-zinc-900"
                                      : "bg-white text-xs"
                                  }`}
                                  style={fullRowCss}
                                >
                                  {canManageRecords ? (
                                    <div className="grid gap-1">
                                      <CellStyleInputs
                                        formId={inlineFormId}
                                        item={item}
                                        cellKey="full_row"
                                        fallbackAlign={item.line_style === "heading" ? "center" : "left"}
                                      />
                                      <CellInput
                                        formId={inlineFormId}
                                        name="item_name_snapshot"
                                        defaultValue={item.item_name_snapshot}
                                        align={item.line_style === "heading" ? "center" : "left"}
                                        cellStyle={fullRowCss}
                                        formatCellKey="full_row"
                                      />
                                      {item.line_style === "heading" ? null : (
                                        <RowHeightTextarea
                                          formId={inlineFormId}
                                          name="specification_snapshot"
                                          defaultValue={item.specification_snapshot ?? item.notes}
                                          rowHeight={item.row_height}
                                          cellStyle={fullRowCss}
                                          formatCellKey="full_row"
                                        />
                                      )}
                                    </div>
                                  ) : (
                                    <p style={fullRowCss}>{mergedRowText(item) || (item.line_style === "heading" ? "Heading" : "-")}</p>
                                  )}
                                </td>
                                {showEditColumn ? (
                                  <InlineRowEditCell
                                    item={item}
                                    quotation={quotation}
                                    returnTo={builderPath}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </Fragment>
                          );
                        }

                        if (item.line_style === "heading") {
                          const fullRowStyle = cellStyleForItem(item, "full_row");
                          const fullRowCss = cellStyleCss(fullRowStyle, "center");

                          return (
                            <Fragment key={item.id}>
                              <tr className="align-middle" style={item.row_height ? { height: `${item.row_height}px` } : undefined}>
                                <td
                                  colSpan={showEditColumn ? totalColumns - 1 : totalColumns}
                                  className="border border-zinc-300 bg-zinc-100 px-3 py-2 text-center text-sm font-bold uppercase text-zinc-900"
                                  style={fullRowCss}
                                >
                                  {canManageRecords ? (
                                    <>
                                      <CellStyleInputs formId={inlineFormId} item={item} cellKey="full_row" fallbackAlign="center" />
                                      <CellInput
                                        formId={inlineFormId}
                                        name="item_name_snapshot"
                                        defaultValue={mergedText || "Heading"}
                                        align="center"
                                        cellStyle={fullRowCss}
                                        formatCellKey="full_row"
                                      />
                                    </>
                                  ) : (
                                    mergedText || "Heading"
                                  )}
                                </td>
                                {showEditColumn ? (
                                  <InlineRowEditCell
                                    item={item}
                                    quotation={quotation}
                                    returnTo={builderPath}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </Fragment>
                          );
                        }

                        if (item.line_style === "note") {
                          const fullRowStyle = cellStyleForItem(item, "full_row");
                          const fullRowCss = cellStyleCss(fullRowStyle);

                          return (
                            <Fragment key={item.id}>
                              <tr className="align-middle" style={item.row_height ? { height: `${item.row_height}px` } : undefined}>
                                <td
                                  colSpan={showEditColumn ? totalColumns - 1 : totalColumns}
                                  className="border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700"
                                  style={fullRowCss}
                                >
                                  {canManageRecords ? (
                                    <div className="grid gap-1">
                                      <CellStyleInputs formId={inlineFormId} item={item} cellKey="full_row" />
                                      <CellInput
                                        formId={inlineFormId}
                                        name="item_name_snapshot"
                                        defaultValue={item.item_name_snapshot ?? "Note"}
                                        cellStyle={fullRowCss}
                                        formatCellKey="full_row"
                                      />
                                      <RowHeightTextarea
                                        formId={inlineFormId}
                                        name="specification_snapshot"
                                        defaultValue={item.specification_snapshot}
                                        rowHeight={item.row_height}
                                        cellStyle={fullRowCss}
                                        formatCellKey="full_row"
                                      />
                                    </div>
                                  ) : (
                                    <>
                                      <span className="font-semibold">{item.item_name_snapshot ?? "Note"}</span>
                                      {item.specification_snapshot ? (
                                        <span className="ml-2">{item.specification_snapshot}</span>
                                      ) : null}
                                    </>
                                  )}
                                </td>
                                {showEditColumn ? (
                                  <InlineRowEditCell
                                    item={item}
                                    quotation={quotation}
                                    returnTo={builderPath}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </Fragment>
                          );
                        }

                        if (item.line_style === "no_quote" && !mergedText) {
                          return (
                            <Fragment key={item.id}>
                              <tr className="align-middle" style={item.row_height ? { height: `${item.row_height}px` } : undefined}>
                                <td colSpan={showEditColumn ? totalColumns - 1 : totalColumns} className="h-8 border border-zinc-300 bg-white align-middle" />
                                {showEditColumn ? (
                                  <InlineRowEditCell
                                    item={item}
                                    quotation={quotation}
                                    returnTo={builderPath}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </Fragment>
                          );
                        }

                        return (
                          <Fragment key={item.id}>
                            <tr
                              className="align-middle"
                              style={item.row_height ? { height: `${item.row_height}px` } : undefined}
                            >
                              {columns.map((column, columnIndex) => {
                                const descriptionIndex = columns.findIndex(
                                  (candidate) => candidate.key === "specification" || candidate.key === "description",
                                );
                                const mergeSpecification =
                                  mergeMode === "merge_specification" && descriptionIndex >= 0;
                                const nextCommercialIndex = mergeSpecification
                                  ? columns.findIndex(
                                      (candidate, candidateIndex) =>
                                        candidateIndex > descriptionIndex && commercialColumnKeys.has(candidate.key),
                                    )
                                  : -1;
                                const spanEnd = nextCommercialIndex > descriptionIndex ? nextCommercialIndex : columns.length;

                                if (
                                  mergeSpecification &&
                                  columnIndex > descriptionIndex &&
                                  columnIndex < spanEnd
                                ) {
                                  return null;
                                }

                                return (
                                  <td
                                    key={column.key}
                                    colSpan={
                                      mergeSpecification && columnIndex === descriptionIndex
                                        ? spanEnd - descriptionIndex
                                        : undefined
                                    }
                                    className={`break-words whitespace-pre-wrap border border-zinc-300 px-2 py-2 align-middle text-zinc-700 ${column.className ?? ""}`}
                                  >
                                    {column.render(item, rowSerial, inlineFormId, canManageRecords)}
                                  </td>
                                );
                              })}
                              {showEditColumn ? (
                                <InlineRowEditCell
                                  item={item}
                                  quotation={quotation}
                                  returnTo={builderPath}
                                  inlineFormId={inlineFormId}
                                  showInternal={showInternal}
                                />
                              ) : null}
                            </tr>
                            <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                          </Fragment>
                        );
                      })}

                      <SectionTotalRow
                        currency={quotation.currency}
                        total={sectionTotals.get(section.id) ?? 0}
                        totalColumns={totalColumns}
                      />

                      {canManageRecords ? (
                        <tr>
                          <td colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-2 py-2">
                            <RowActionPanel
                              brands={productBrands ?? []}
                              categories={productCategories ?? []}
                              components={productComponents ?? []}
                              linkedFamilies={linkedFamilies ?? []}
                              productTemplates={productTemplates ?? []}
                              quotation={quotation}
                              returnTo={builderPath}
                              sectionId={section.id}
                              showInternal={showInternal}
                            />
                            <PasteQuotationRowControls
                              quotationId={quotation.id}
                              returnTo={builderPath}
                              sectionId={section.id}
                            />
                            <details>
                              <summary className="mt-2 cursor-pointer text-xs font-semibold text-zinc-600">
                                Edit section
                              </summary>
                              <div className="mt-2 grid gap-3 xl:grid-cols-[1fr_auto]">
                                <SectionForm quotationId={quotation.id} returnTo={builderPath} section={section} />
                                <form action={deactivateQuotationSection}>
                                  <input type="hidden" name="id" value={section.id} />
                                  <input type="hidden" name="quotation_id" value={quotation.id} />
                                  <input type="hidden" name="return_to" value={builderPath} />
                                  <button type="submit" className="h-8 px-2 text-xs font-semibold text-zinc-500 transition hover:text-red-700">
                                    Deactivate section
                                  </button>
                                </form>
                              </div>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                      {section.parent_section_id &&
                      mainSectionIds.has(section.parent_section_id) &&
                      nextSection?.parent_section_id !== section.parent_section_id ? (
                        <MainSectionTotalRow
                          currency={quotation.currency}
                          label={sectionById.get(section.parent_section_id)?.section_title ?? ""}
                          total={mainSectionTotals.get(section.parent_section_id) ?? 0}
                          totalColumns={totalColumns}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
                {canManageRecords && displaySections.length ? (
                  <InsertSectionControl
                    quotationId={quotation.id}
                    returnTo={builderPath}
                    insertAfterSectionId={displaySections.at(-1)?.id ?? "__start"}
                    parentSectionId={displaySections.at(-1)?.parent_section_id}
                    totalColumns={totalColumns}
                    insideMain={Boolean(
                      displaySections.at(-1)?.parent_section_id &&
                      mainSectionIds.has(displaySections.at(-1)?.parent_section_id ?? ""),
                    )}
                  />
                ) : null}
              </tbody>
            </QuotationSheetTable>

            {!sections?.length ? (
              <div className="border-t border-zinc-300 bg-white p-8">
                <div className="mx-auto max-w-xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center">
                  {canManageRecords ? (
                    <div className="grid gap-3 text-left">
                      <QuickSectionForm
                        quotationId={quotation.id}
                        returnTo={builderPath}
                        label="Add Main Section"
                        sectionKind="main"
                        placeholder="GROUND FLOOR"
                      />
                      <QuickSectionForm
                        quotationId={quotation.id}
                        returnTo={builderPath}
                        label="Add Section"
                        sectionKind="sub"
                        placeholder="Section name (optional)"
                      />
                    </div>
                  ) : null}
                  <p className="mt-4 text-sm text-zinc-500">
                    Start with a main section like GROUND FLOOR, or add a normal section directly.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-4 flex justify-end">
          <div className="w-full max-w-md border border-zinc-300 bg-white text-sm">
            {hasMixedCurrencies ? (
              <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                Currency conversion is not enabled yet. Mixed-currency totals should be reviewed manually.
              </p>
            ) : null}
            <div className="flex justify-between border-b border-zinc-300 px-3 py-2">
              <span className="font-semibold text-zinc-600">Total Price</span>
              <span>{money(quotation.currency, quotation.subtotal)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-300 px-3 py-2">
              <span className="font-semibold text-zinc-600">Total Discount</span>
              <span>{money(quotation.currency, quotation.discount_total + overallDiscountAmount(quotation))}</span>
            </div>
            {canManageRecords ? (
              <div className="border-b border-zinc-300 bg-zinc-50 px-3 py-3">
                <ExtraDiscountForm quotation={quotation} returnTo={builderPath} />
              </div>
            ) : null}
            <div className="flex justify-between border-b border-zinc-300 px-3 py-2">
              <span className="font-semibold text-zinc-600">VAT {quotation.vat_percent}%</span>
              <span>{money(quotation.currency, quotation.vat_amount)}</span>
            </div>
            <div className="flex justify-between bg-emerald-950 px-3 py-3 text-base font-bold text-white">
              <span>Final Total</span>
              <span>{money(quotation.currency, quotation.grand_total)}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
