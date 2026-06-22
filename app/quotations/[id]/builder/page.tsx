import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ExportExcelButton } from "@/components/quotations/export-excel-button";
import { GlobalRefreshButton } from "@/components/global-refresh-button";
import { ContextBackLink } from "@/components/navigation/context-back-link";
import { PendingLinkButton } from "@/components/pending-link-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  OptimisticAddRowButton,
  OptimisticQuotationBuilderProvider,
  OptimisticSectionEmptyState,
  OptimisticSectionRows,
} from "@/components/quotations/optimistic-add-row-button";
import { CellFormattingToolbar } from "@/components/quotations/cell-formatting-toolbar";
import {
  QuotationRowComputedValue,
  QuotationRowEditorProvider,
  QuotationRowFieldInput,
  QuotationRowSaveControls,
} from "@/components/quotations/quotation-row-editor";
import {
  type ProductLibraryLinkedFamily,
  ProductLibrarySelector,
  type ProductLibraryBrand,
  type ProductLibraryCategory,
  type ProductLibraryComponent,
  type ProductLibraryTemplate,
} from "@/components/quotations/product-library-selector";
import {
  brandPriceBaselineDate,
  latestBrandPriceListUpdate,
  productTemplatePriceCheckState,
} from "@/lib/product-price-check";
import { QuotationSheetTable } from "@/components/quotations/quotation-sheet-table";
import {
  FinishImagePreview,
} from "@/components/quotations/finish-image-uploader";
import {
  FinishSelectionsEditor,
  type FinishMaterial,
  type FinishMaterialBrand,
  type FinishMaterialGroup,
  type ProductTemplateMaterialGroupItemLink,
  type ProductTemplateMaterialGroupLink,
} from "@/components/quotations/finish-selections-editor";
import { QuotationImageCell } from "@/components/quotations/quotation-image-cell";
import {
  CopyQuotationRowButton,
  PasteQuotationRowControls,
} from "@/components/quotations/quotation-row-clipboard";
import { LocalDraftLink } from "@/components/quotations/local-draft-link";
import { ManualCurrencyConversionPanel } from "@/components/quotations/manual-currency-conversion-panel";
import { SaveRowToProductLibraryPanel as SaveRowToProductLibraryPanelClient } from "@/components/quotations/save-row-to-product-library-panel";
import { RowHeightTextarea } from "@/components/quotations/row-height-textarea";
import {
  SharedQuotationMoreMenu,
  SharedQuotationRowDetailsPanel,
} from "@/components/quotations/shared-quotation-row-details-panel";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, formatMoney, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { ensureDefaultProductCategoryTree } from "@/lib/product-default-category-tree";
import { formatProjectReferenceDisplay } from "@/lib/project-reference";
import {
  formatBrandOriginSupplier,
  specificationWithoutDuplicateCode,
} from "@/lib/quotations/format-quotation-row";
import {
  formatQuotationDisplayNo,
  quotationOptionLabel,
  quotationRootBaseNo,
} from "@/lib/quotation-options";
import { formatQuotationMoney, quotationMoneyCell, quotationMoneyValue } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  createQuotationItem,
  createQuotationSection,
  deactivateQuotationItem,
  duplicateQuotationItemBelow,
  deactivateQuotationSection,
  moveQuotationItemDown,
  moveQuotationItemUp,
  restoreQuotationItem,
  restoreQuotationSection,
  updateQuotationExtraDiscount,
  updateQuotationLayoutSettings,
  updateQuotationItemInline,
  updateQuotationItem,
  updateQuotationSection,
  useCurrentSourcePriceForQuotationItem,
} from "../../actions";

export const dynamic = "force-dynamic";

type BuilderPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    message?: string;
    saved_template_id?: string;
    undo_item_id?: string;
    undo_kind?: string;
    undo_section_id?: string;
    view?: string;
  }>;
};

type Client = { id: string; company_name: string };

type Project = {
  id: string;
  project_name: string;
  project_number: string | null;
  project_code: string | null;
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
  option_no: number;
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
  finish_selections_snapshot: unknown;
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
  allow_material_continuation_page: boolean;
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
  parent_item_id: string | null;
  include_in_total: boolean;
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
  updated_at?: string;
};

type InactiveQuotationItem = {
  id: string;
  item_name_snapshot: string | null;
  updated_at: string;
};

type InactiveQuotationSection = {
  id: string;
  section_kind: string;
  section_title: string | null;
  updated_at: string;
};

type QuotationItemPriceHistoryEntry = {
  id: string;
  quotation_item_id: string;
  change_type: string;
  old_unit_price: number | null;
  new_unit_price: number;
  old_currency: string | null;
  new_currency: string | null;
  note: string | null;
  source_price_type: string | null;
  source_price_label: string | null;
  changed_by: string | null;
  changed_at: string;
  changed_by_name?: string | null;
};

type FinishSelection = {
  id?: string;
  source_type?: string;
  source_scope?: string;
  brand_material_id?: string;
  material_group_id?: string;
  product_template_material_group_id?: string;
  brand_name?: string;
  group_label?: string;
  group_sort_order?: number;
  material_category?: string;
  finish_code?: string;
  finish_name?: string;
  finish_description?: string;
  finish_image_url?: string;
  show_in_quotation?: boolean;
  show_in_specification?: boolean;
  sort_order?: number;
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

type OptimisticColumn = Pick<Column, "className" | "key">;

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

function withHash(path: string, hash: string) {
  const hashIndex = path.indexOf("#");
  const basePath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  return `${basePath}#${hash}`;
}

const sectionTypes = [
  ["section", "Section"],
  ["option", "Option"],
  ["floor", "Floor"],
  ["room", "Room"],
  ["category", "Category"],
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
  return formatQuotationMoney(currency, value);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function optionBadgeLabel(optionNo: number) {
  return quotationOptionLabel(optionNo);
}

function recentChangeTimeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function moneyCell(value: number) {
  return quotationMoneyCell(value);
}

function totalCell(item: QuotationItem) {
  if (item.is_rate_only || item.line_style === "rate_only") return "Rate Only";
  if (item.is_optional && item.include_in_total !== true) return "Optional";
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

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return Boolean(value);
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function numericValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function findById(rows: unknown, id: string | null) {
  if (!id) return null;

  return arrayValue(rows)
    .map(recordValue)
    .find((row) => row?.id === id) ?? null;
}

function currentAccessoryTotal({
  baseCurrency,
  selectedAddOns,
  template,
}: {
  baseCurrency: string;
  selectedAddOns: Record<string, unknown>;
  template: ProductLibraryTemplate;
}) {
  let total = 0;

  for (const group of arrayValue(selectedAddOns.groups).map(recordValue).filter(isRecord)) {
    for (const item of arrayValue(group.items).map(recordValue).filter(isRecord)) {
      const selectedId = stringValue(item.id);
      if (!selectedId) return null;

      const currentItem = arrayValue(template.accessory_pricing)
        .map(recordValue)
        .flatMap((accessoryGroup) => arrayValue(accessoryGroup?.items).map(recordValue))
        .find((candidate) => candidate?.id === selectedId);

      if (!currentItem) return null;

      const currency = normalizeCurrency(stringValue(currentItem.currency) ?? baseCurrency);
      if (currency !== baseCurrency) return null;

      total += numericValue(item.qty, 1) * quotationMoneyValue(numericValue(currentItem.price));
    }
  }

  return quotationMoneyValue(total);
}

function currentComponentOptionsTotal({
  baseCurrency,
  components,
  selectedOptions,
}: {
  baseCurrency: string;
  components: ProductLibraryComponent[];
  selectedOptions: unknown;
}) {
  let total = 0;

  for (const option of arrayValue(selectedOptions).map(recordValue).filter(isRecord)) {
    const optionId = stringValue(option.id);
    const isAccessorySnapshot = Boolean(option.group_name && option.item_name && option.price !== undefined);
    if (
      !optionId ||
      isAccessorySnapshot ||
      ["variant_pricing", "category_pricing", "desking_size"].includes(String(option.item_type))
    ) {
      continue;
    }

    const component = components.find((candidate) => candidate.id === optionId);
    if (!component) return null;

    const currency = normalizeCurrency(component.currency);
    if (currency !== baseCurrency) return null;

    total += quotationMoneyValue(component.unit_price);
  }

  return quotationMoneyValue(total);
}

function currentSourcePriceForItem({
  components,
  item,
  template,
}: {
  components: ProductLibraryComponent[];
  item: QuotationItem;
  template: ProductLibraryTemplate;
}) {
  const sourceData = recordValue(item.source_component_data);
  if (sourceData?.currency_conversion || sourceData?.linked_products) return null;

  let sourcePrice = quotationMoneyValue(template.default_unit_price);
  let sourceCurrency = normalizeCurrency(template.currency);
  let sourceKind = "default";

  const variantData = recordValue(sourceData?.variant_pricing);
  const variantId = stringValue(variantData?.id);
  if (variantId) {
    const currentVariant = findById(template.variant_pricing, variantId);
    if (!currentVariant) return null;

    sourcePrice = quotationMoneyValue(numericValue(currentVariant.price));
    sourceCurrency = normalizeCurrency(stringValue(currentVariant.currency) ?? template.currency);
    sourceKind = "variant";
  }

  const categoryData = recordValue(sourceData?.category_pricing);
  const categoryRow = recordValue(categoryData?.selected_row);
  const categoryId = stringValue(categoryRow?.id);
  const selectedCategory = stringValue(categoryData?.selected_category);
  if (categoryId && selectedCategory) {
    const currentCategory = findById(template.category_pricing, categoryId);
    const prices = recordValue(currentCategory?.prices);
    if (!currentCategory || !prices) return null;

    sourcePrice = quotationMoneyValue(numericValue(prices[selectedCategory]));
    sourceCurrency = normalizeCurrency(stringValue(currentCategory.currency) ?? template.currency);
    sourceKind = "category";
  }

  const deskingData = recordValue(sourceData?.desking);
  const deskingLabel = stringValue(deskingData?.size_label);
  if (deskingLabel) {
    if (numericValue(deskingData?.accessory_price) > 0) return null;

    const matches = arrayValue(template.desking_size_pricing)
      .map(recordValue)
      .filter(isRecord)
      .filter((row) => row?.label === deskingLabel);
    if (matches.length !== 1) return null;

    const currentSize = matches[0];
    sourceCurrency = normalizeCurrency(stringValue(currentSize.currency) ?? template.currency);
    sourcePrice = quotationMoneyValue(
      numericValue(currentSize.default_price) +
      numericValue(currentSize.additional_price) * numericValue(deskingData?.additional_qty),
    );
    sourceKind = "desking";
  }

  const componentOptionsTotal = currentComponentOptionsTotal({
    baseCurrency: sourceCurrency,
    components,
    selectedOptions: sourceData?.selected_options,
  });
  if (componentOptionsTotal === null) return null;

  const accessoryTotal = sourceData?.add_ons
    ? currentAccessoryTotal({
        baseCurrency: sourceCurrency,
        selectedAddOns: recordValue(sourceData.add_ons) ?? {},
        template,
      })
    : 0;
  if (accessoryTotal === null) return null;

  return {
    canApplyCurrentSourcePrice: true,
    sourceCurrency,
    sourceKind,
    sourcePrice: quotationMoneyValue(sourcePrice + componentOptionsTotal + accessoryTotal),
  };
}

function optionalNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function preciseDecimalValue(value: unknown, precision = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;

  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function formatSourceMoney(currency: string | null | undefined, value: unknown) {
  const amount = preciseDecimalValue(value, 2);
  return formatMoney(currency, amount, {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function sourceTypeLabel(sourceType: string | null) {
  const labels: Record<string, string> = {
    add_ons: "Add-ons",
    category: "Category Pricing",
    category_pricing: "Category Pricing",
    component_options: "Product Components",
    default: "Template Default",
    desking: "Desking / Size Pricing",
    desking_size_pricing: "Desking / Size Pricing",
    template_default: "Template Default",
    variant: "Size / Model Variant",
    variant_pricing: "Size / Model Variant",
  };

  return sourceType ? labels[sourceType] ?? sourceType : null;
}

function sourceLabelFromReference(reference: Record<string, unknown>) {
  return [
    stringValue(reference.source_price_label),
    stringValue(reference.source_price_key),
  ].filter(Boolean).join(" / ") || null;
}

function singleOriginalCurrencyTotal(conversionData: Record<string, unknown> | null | undefined) {
  const totals = recordValue(conversionData?.original_totals);
  if (!totals) return null;

  const entries = Object.entries(totals)
    .map(([currency, amount]) => [normalizeCurrency(currency), optionalNumericValue(amount)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null && entry[1] > 0);

  if (entries.length !== 1) return null;

  return {
    currency: entries[0][0],
    price: quotationMoneyValue(entries[0][1]),
  };
}

function sourcePriceReferenceForItem({
  components,
  item,
  template,
}: {
  components: ProductLibraryComponent[];
  item: QuotationItem;
  template: ProductLibraryTemplate | null;
}) {
  const sourceData = recordValue(item.source_component_data);
  const storedReference = recordValue(sourceData?.source_price_reference);
  const conversionData = recordValue(sourceData?.currency_conversion);
  const manualSourcePrice = optionalNumericValue(sourceData?.manual_source_price);
  const manualSourceCurrency = stringValue(sourceData?.manual_source_currency);
  const manualConversionRate = optionalNumericValue(sourceData?.manual_conversion_rate);
  const manualConvertedPrice = optionalNumericValue(sourceData?.manual_converted_price);
  const manualConvertedCurrency = stringValue(sourceData?.manual_converted_currency);
  const sourceName = [
    item.brand_name_snapshot ?? stringValue(sourceData?.brand_name),
    template?.template_name ?? stringValue(sourceData?.template_name) ?? item.item_name_snapshot,
    item.model_snapshot,
    item.size_snapshot,
  ].filter(Boolean).join(" / ");
  const quotationCurrency = normalizeCurrency(item.currency);
  const reference = {
    convertedPrice: optionalNumericValue(storedReference?.converted_quotation_price),
    convertedCurrency: normalizeCurrency(stringValue(storedReference?.quotation_currency) ?? quotationCurrency),
    currentSourceCurrency: null as string | null,
    currentSourcePrice: null as number | null,
    isManualConversion: false,
    manualConversionRate: null as number | null,
    originalCurrency: null as string | null,
    originalPrice: null as number | null,
    sourceLabel: storedReference ? sourceLabelFromReference(storedReference) : null,
    sourceName,
    sourceType: sourceTypeLabel(stringValue(storedReference?.source_price_type)),
  };

  if (storedReference) {
    const originalPrice = optionalNumericValue(storedReference.original_source_price);
    const originalCurrency = stringValue(storedReference.original_source_currency);

    if (originalPrice !== null && originalCurrency) {
      reference.originalPrice = quotationMoneyValue(originalPrice);
      reference.originalCurrency = normalizeCurrency(originalCurrency);
    }
  }

  if (manualSourcePrice !== null && manualSourceCurrency) {
    reference.isManualConversion = true;
    reference.originalPrice = preciseDecimalValue(manualSourcePrice, 2);
    reference.originalCurrency = normalizeCurrency(manualSourceCurrency);
    reference.manualConversionRate = manualConversionRate !== null ? preciseDecimalValue(manualConversionRate, 4) : null;
    reference.sourceType = "Manual currency conversion";
    reference.sourceLabel = reference.sourceLabel ?? "Manual row";
    if (manualConvertedPrice !== null) {
      reference.convertedPrice = quotationMoneyValue(manualConvertedPrice);
      reference.convertedCurrency = normalizeCurrency(manualConvertedCurrency ?? "AED");
    }
  }

  if (reference.originalPrice === null) {
    const singleTotal = singleOriginalCurrencyTotal(conversionData);
    if (singleTotal) {
      reference.originalPrice = singleTotal.price;
      reference.originalCurrency = singleTotal.currency;
    }
  }

  const variantData = recordValue(sourceData?.variant_pricing);
  if (reference.originalPrice === null && variantData) {
    const price = optionalNumericValue(variantData.price);
    if (price !== null) {
      reference.originalPrice = quotationMoneyValue(price);
      reference.originalCurrency = normalizeCurrency(stringValue(variantData.currency) ?? template?.currency ?? quotationCurrency);
      reference.sourceType = reference.sourceType ?? sourceTypeLabel("variant_pricing");
      reference.sourceLabel = reference.sourceLabel ?? [
        stringValue(variantData.variant_name),
        stringValue(variantData.dimension),
      ].filter(Boolean).join(" / ");
    }
  }

  const categoryData = recordValue(sourceData?.category_pricing);
  const categoryRow = recordValue(categoryData?.selected_row);
  if (reference.originalPrice === null && categoryData && categoryRow) {
    const price = optionalNumericValue(categoryData.selected_price);
    if (price !== null) {
      reference.originalPrice = quotationMoneyValue(price);
      reference.originalCurrency = normalizeCurrency(stringValue(categoryRow.currency) ?? template?.currency ?? quotationCurrency);
      reference.sourceType = reference.sourceType ?? sourceTypeLabel("category_pricing");
      reference.sourceLabel = reference.sourceLabel ?? [
        stringValue(categoryRow.variant_name),
        stringValue(categoryData.selected_category),
      ].filter(Boolean).join(" / ");
    }
  }

  const deskingData = recordValue(sourceData?.desking);
  if (reference.originalPrice === null && deskingData && !conversionData) {
    const price = optionalNumericValue(deskingData.final_price);
    if (price !== null) {
      reference.originalPrice = quotationMoneyValue(price);
      reference.originalCurrency = quotationCurrency;
      reference.sourceType = reference.sourceType ?? sourceTypeLabel("desking_size_pricing");
      reference.sourceLabel = reference.sourceLabel ?? [
        stringValue(deskingData.size_label),
        stringValue(deskingData.cluster_label),
      ].filter(Boolean).join(" / ");
    }
  }

  if (template) {
    const currentSource = currentSourcePriceForItem({ components, item, template });
    if (currentSource) {
      reference.currentSourceCurrency = currentSource.sourceCurrency;
      reference.currentSourcePrice = currentSource.sourcePrice;
      reference.sourceType = reference.sourceType ?? sourceTypeLabel(currentSource.sourceKind);
    }
  }

  return reference;
}

function manualConversionDefaults(item?: QuotationItem) {
  const sourceData = recordValue(item?.source_component_data);
  const storedSourcePrice = optionalNumericValue(sourceData?.manual_source_price);
  const storedSourceCurrency = stringValue(sourceData?.manual_source_currency);
  const storedRate = optionalNumericValue(sourceData?.manual_conversion_rate);
  const itemCurrency = normalizeCurrency(item?.currency ?? defaultCurrency);

  return {
    conversionRate: preciseDecimalValue(storedRate ?? (itemCurrency === "AED" ? 1 : 0), 4),
    hasStoredConversion: storedSourcePrice !== null && Boolean(storedSourceCurrency),
    sourceCurrency: normalizeCurrency(storedSourceCurrency ?? itemCurrency),
    sourcePrice: preciseDecimalValue(storedSourcePrice ?? item?.unit_price ?? 0, 2),
  };
}

function manualLibrarySourceDefaults(item?: QuotationItem) {
  const manualDefaults = manualConversionDefaults(item);

  return manualDefaults.hasStoredConversion
    ? {
        currency: manualDefaults.sourceCurrency,
        price: manualDefaults.sourcePrice,
      }
    : {
        currency: normalizeCurrency(item?.currency ?? defaultCurrency),
        price: quotationMoneyValue(item?.unit_price ?? 0),
      };
}

function SourceLibraryPriceReference({
  components,
  item,
  productTemplates,
}: {
  components: ProductLibraryComponent[];
  item?: QuotationItem;
  productTemplates: ProductLibraryTemplate[];
}) {
  if (!item) return null;

  const template = item.source_template_id
    ? productTemplates.find((entry) => entry.id === item.source_template_id) ?? null
    : null;
  const reference = sourcePriceReferenceForItem({
    components: template ? components.filter((component) => component.template_id === template.id) : [],
    item,
    template,
  });
  const hasSourceReference =
    reference.originalPrice !== null ||
    reference.currentSourcePrice !== null ||
    reference.manualConversionRate !== null ||
    Boolean(reference.sourceName || reference.sourceType || reference.sourceLabel);

  return (
    <fieldset className="border border-zinc-300 bg-zinc-50 p-3">
      <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Source / Library Price</legend>
      {hasSourceReference ? (
        <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-zinc-500">
              {reference.isManualConversion ? "Original manual source price" : "Original library price"}
            </p>
            <p className="font-semibold text-zinc-900">
              {reference.originalPrice !== null && reference.originalCurrency
                ? (reference.isManualConversion
                    ? formatSourceMoney(reference.originalCurrency, reference.originalPrice)
                    : formatQuotationMoney(reference.originalCurrency, reference.originalPrice))
                : "Not available for this row"}
            </p>
          </div>
          {reference.isManualConversion ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-zinc-500">Conversion rate</p>
              <p className="font-semibold text-zinc-900">
                {reference.manualConversionRate !== null ? reference.manualConversionRate.toFixed(2) : "Not available for this row"}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[10px] font-semibold uppercase text-zinc-500">Current source price</p>
              <p className="font-semibold text-zinc-900">
                {reference.currentSourcePrice !== null && reference.currentSourceCurrency
                  ? formatQuotationMoney(reference.currentSourceCurrency, reference.currentSourcePrice)
                  : "Not available for this row"}
              </p>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Quotation row price</p>
            <p className="font-semibold text-zinc-900">
              {formatQuotationMoney(normalizeCurrency(item.currency), item.unit_price)}
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Source</p>
            <p className="text-zinc-800">{reference.sourceName || "Source template not available"}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-zinc-500">Source type</p>
            <p className="text-zinc-800">
              {[reference.sourceType, reference.sourceLabel].filter(Boolean).join(" / ") || "Original library snapshot"}
            </p>
          </div>
          {reference.convertedPrice !== null ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-zinc-500">Converted quotation price</p>
              <p className="text-zinc-800">
                {formatQuotationMoney(reference.convertedCurrency, reference.convertedPrice)}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Original source price not available for this row.</p>
      )}
    </fieldset>
  );
}

function sourcePriceWarning(
  item: QuotationItem,
  productTemplateById: Map<string, ProductLibraryTemplate>,
  componentsByTemplate: Map<string, ProductLibraryComponent[]>,
) {
  if (!item.source_template_id || isPriceHiddenLine(item)) return null;

  const template = productTemplateById.get(item.source_template_id);
  if (!template) return null;

  const currentSource = currentSourcePriceForItem({
    components: componentsByTemplate.get(template.id) ?? [],
    item,
    template,
  });
  if (!currentSource) return null;

  const quotedPrice = quotationMoneyValue(item.unit_price);
  const sourcePrice = quotationMoneyValue(currentSource.sourcePrice);
  const quotedCurrency = normalizeCurrency(item.currency);
  const sourceCurrency = normalizeCurrency(currentSource.sourceCurrency);
  const priceChanged = Math.abs(quotedPrice - sourcePrice) >= 0.01;
  const currencyChanged = quotedCurrency !== sourceCurrency;

  if (!priceChanged && !currencyChanged) return null;

  return {
    quotedCurrency,
    quotedPrice,
    canApplyCurrentSourcePrice: currentSource.canApplyCurrentSourcePrice,
    sourceCurrency,
    sourceKind: currentSource.sourceKind,
    sourcePrice,
    templateName: template.template_name,
  };
}

function SourcePriceWarning({
  componentsByTemplate,
  item,
  productTemplateById,
  quotationId,
  returnTo,
  totalColumns,
}: {
  componentsByTemplate: Map<string, ProductLibraryComponent[]>;
  item: QuotationItem;
  productTemplateById: Map<string, ProductLibraryTemplate>;
  quotationId: string;
  returnTo: string;
  totalColumns: number;
}) {
  const warning = sourcePriceWarning(item, productTemplateById, componentsByTemplate);
  if (!warning) return null;

  return (
    <tr>
      <td colSpan={totalColumns} className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="font-semibold">Source price changed</span>
            <span>
              Quoted: {formatQuotationMoney(warning.quotedCurrency, warning.quotedPrice)} / Current source: {formatQuotationMoney(warning.sourceCurrency, warning.sourcePrice)}
            </span>
            <span>Existing quotation price is unchanged.</span>
          </div>
          {warning.canApplyCurrentSourcePrice ? (
            <form action={useCurrentSourcePriceForQuotationItem} className="shrink-0">
              <input type="hidden" name="quotation_id" value={quotationId} />
              <input type="hidden" name="quotation_item_id" value={item.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <ConfirmSubmitButton
                message="This will update only this quotation row to the current source price. Other rows and old quotation snapshots will not change. Continue?"
                className="h-7 border border-amber-300 bg-white px-2.5 text-[11px] font-semibold text-amber-900 transition hover:border-amber-500"
                pendingLabel="Updating..."
              >
                Use current source price
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function historyChangeTypeLabel(changeType: string) {
  const labels: Record<string, string> = {
    manual: "Manual price update",
    other: "Price update",
    revision_adjustment: "Revision adjustment",
    use_current_source_price: "Use current source price",
  };

  return labels[changeType] ?? changeType.replaceAll("_", " ");
}

function PriceChangeHistory({
  history,
}: {
  history: QuotationItemPriceHistoryEntry[];
}) {
  return (
    <fieldset className="border border-zinc-300 bg-zinc-50 p-3">
      <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Price Change History</legend>
      {history.length ? (
        <div className="grid gap-2">
          {history.slice(0, 5).map((entry) => (
            <div key={entry.id} className="border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800">
              <p className="font-semibold text-zinc-900">
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                }).format(new Date(entry.changed_at))} - {entry.changed_by_name || "Unknown user"} - {historyChangeTypeLabel(entry.change_type)} - {entry.old_unit_price !== null
                  ? formatQuotationMoney(
                      normalizeCurrency(entry.old_currency ?? entry.new_currency ?? defaultCurrency),
                      entry.old_unit_price,
                    )
                  : "-"}{" "}
                -&gt; {formatQuotationMoney(normalizeCurrency(entry.new_currency ?? entry.old_currency ?? defaultCurrency), entry.new_unit_price)}
              </p>
              {entry.note ? <p className="mt-1 text-zinc-500">{entry.note}</p> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">No price changes recorded for this row.</p>
      )}
    </fieldset>
  );
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
  return !["heading", "note", "no_quote"].includes(item.line_style) && !["heading", "note", "blank", "subtotal"].includes(item.item_type);
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
  list,
  className = "",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
  step?: string;
  list?: string;
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
        list={list}
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

function SubmitButton({ label }: { label: string }) {
  return (
    <PendingSubmitButton
      className="h-8 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </PendingSubmitButton>
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
    <QuotationRowFieldInput
      formId={formId}
      name={name}
      type={type}
      step={step}
      defaultValue={defaultValue}
      align={align}
      cellStyle={cellStyle}
      formatCellKey={formatCellKey}
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
        <details
          className="group"
          data-state-key={`insert-section-${insideMain ? parentSectionId ?? "root" : "root"}-${insertAfterSectionId}`}
        >
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

function finishSelections(value: unknown): FinishSelection[] {
  const normalize = (item: FinishSelection, index: number): FinishSelection => ({
    ...item,
    id: item.id || `finish-${index + 1}`,
    show_in_quotation: item.show_in_quotation === true,
    show_in_specification: item.show_in_specification !== false,
    sort_order: typeof item.sort_order === "number" ? item.sort_order : index,
  });

  if (Array.isArray(value)) {
    return value
      .filter((item): item is FinishSelection => typeof item === "object" && item !== null)
      .map(normalize);
  }
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is FinishSelection => typeof item === "object" && item !== null)
        .map(normalize)
      : [];
  } catch {
    return [];
  }
}

function quotationVisibleFinishes(item: QuotationItem) {
  return finishSelections(item.finish_selections_snapshot).filter((finish) => finish.show_in_quotation === true);
}

function FinishDisplay({ item }: { item: QuotationItem }) {
  const rows = quotationVisibleFinishes(item);

  if (!rows.length) return <span className="text-zinc-400">-</span>;

  return (
    <div className="grid gap-1.5 text-left">
      {rows.map((finish, index) => {
        const label = finish.group_label || "Finish";
        const codeName = [finish.finish_code, finish.finish_name].filter(Boolean).join(" - ");

        return (
          <div key={`${finish.id ?? "finish"}-${index}`} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2">
            <FinishImagePreview
              alt={finish.finish_name || label}
              className="h-7 w-7"
              value={finish.finish_image_url}
            />
            <div className="min-w-0 leading-4">
              <p className="font-semibold text-zinc-800">{label}</p>
              {codeName ? <p className="text-[11px] text-zinc-600">{codeName}</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MaterialsFinishesEditor({
  brands,
  item,
  materialGroups,
  materials,
  productTemplates,
  quotationId,
  templateMaterialGroupItems,
  templateMaterialGroups,
}: {
  brands: FinishMaterialBrand[];
  item?: QuotationItem;
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  productTemplates: ProductLibraryTemplate[];
  quotationId: string;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
}) {
  const rows = finishSelections(item?.finish_selections_snapshot);
  const template = productTemplates.find((entry) => entry.id === item?.source_template_id);
  const linkedGroups = templateMaterialGroups.filter((link) => link.product_template_id === item?.source_template_id);
  const linkedGroupIds = new Set(linkedGroups.map((link) => link.id));
  const linkedItems = templateMaterialGroupItems.filter((itemLink) => linkedGroupIds.has(itemLink.product_template_material_group_id));

  return (
    <FinishSelectionsEditor
      brands={brands}
      allowMaterialContinuationPage={item?.allow_material_continuation_page ?? false}
      initialBrandId={template?.brand_id ?? null}
      initialFinishes={rows}
      itemId={item?.id}
      materialGroups={materialGroups}
      materials={materials}
      templateMaterialGroupItems={linkedItems}
      templateMaterialGroups={linkedGroups}
      quotationId={quotationId}
    />
  );
}

function manualRowLibraryDescription(item?: QuotationItem) {
  return [
    item?.model_snapshot,
    item?.size_snapshot,
    item?.finish_snapshot,
    item?.notes,
  ]
    .filter(Boolean)
    .join(" / ");
}

function manualRowVariantSpecification(item?: QuotationItem) {
  return [
    item?.specification_snapshot,
    item?.item_code_snapshot ? `Item code: ${item.item_code_snapshot}` : null,
    item?.origin_snapshot ? `Origin: ${item.origin_snapshot}` : null,
    item?.supplier_name_snapshot ? `Supplier: ${item.supplier_name_snapshot}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function canSaveRowToProductLibrary(item?: QuotationItem) {
  if (!item) return false;
  if (item.source_template_id) return false;
  if (["note", "blank", "subtotal"].includes(item.item_type)) return false;
  if (["heading", "note", "no_quote"].includes(item.line_style)) return false;

  return true;
}

function SaveRowToProductLibraryPanel({
  canManageProductLibrary,
  item,
  productBrands,
  productCategories,
  productTemplates,
  quotationId,
  returnTo,
}: {
  canManageProductLibrary: boolean;
  item?: QuotationItem;
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  productTemplates: ProductLibraryTemplate[];
  quotationId: string;
  returnTo: string;
}) {
  if (!canSaveRowToProductLibrary(item)) return null;
  if (!item) return null;

  const matchingBrand = productBrands.find(
    (brand) =>
      brand.name.trim().toLowerCase() ===
      (item?.brand_name_snapshot ?? "").trim().toLowerCase(),
  );
  const librarySourceDefaults = manualLibrarySourceDefaults(item);

  return (
    <SaveRowToProductLibraryPanelClient
      canManageProductLibrary={canManageProductLibrary}
      defaultBrandId={matchingBrand?.id ?? ""}
      defaultCurrency={librarySourceDefaults.currency}
      defaultPrice={librarySourceDefaults.price}
      descriptionDefault={manualRowLibraryDescription(item)}
      item={{
        id: item.id,
        item_code_snapshot: item.item_code_snapshot,
        item_name_snapshot: item.item_name_snapshot,
        model_snapshot: item.model_snapshot,
        origin_snapshot: item.origin_snapshot,
        proposed_image_url_snapshot: item.proposed_image_url_snapshot,
        size_snapshot: item.size_snapshot,
        specification_snapshot: item.specification_snapshot,
        specified_image_url_snapshot: item.specified_image_url_snapshot,
        supplier_name_snapshot: item.supplier_name_snapshot,
        unit_label: item.unit_label,
      }}
      productBrands={productBrands}
      productCategories={productCategories}
      productTemplates={productTemplates}
      quotationId={quotationId}
      returnTo={returnTo}
      variantSpecificationDefault={manualRowVariantSpecification(item)}
    />
  );
}

function LineForm({
  brands,
  canManageProductLibrary,
  components,
  productBrands,
  productCategories,
  priceHistory,
  quotation,
  returnTo,
  sectionId,
  item,
  materialGroups,
  materials,
  productTemplates,
  showInternal,
  templateMaterialGroupItems,
  templateMaterialGroups,
}: {
  brands: FinishMaterialBrand[];
  canManageProductLibrary: boolean;
  components: ProductLibraryComponent[];
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  priceHistory: QuotationItemPriceHistoryEntry[];
  quotation: Quotation;
  returnTo: string;
  sectionId?: string | null;
  item?: QuotationItem;
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  productTemplates: ProductLibraryTemplate[];
  showInternal: boolean;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
}) {
  const manualConversion = manualConversionDefaults(item);
  const isManualRow = Boolean(item && !item.source_template_id);
  const manualItem = isManualRow ? item : undefined;

  return (
    <>
      {manualItem ? (
        <ManualCurrencyConversionPanel
          hasStoredConversion={manualConversion.hasStoredConversion}
          itemCurrency={manualItem.currency}
          itemId={manualItem.id}
          quotationId={quotation.id}
          returnTo={returnTo}
          sourceCurrencyDefault={manualConversion.sourceCurrency}
          sourcePriceDefault={manualConversion.sourcePrice}
          conversionRateDefault={manualConversion.conversionRate}
        />
      ) : null}

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
        {item?.parent_item_id ? <input type="hidden" name="parent_item_id" value={item.parent_item_id} /> : null}
        {item && (!item.is_optional || item.include_in_total) ? <input type="hidden" name="include_in_total" value="on" /> : null}
        {!showInternal && item ? (
          <>
            <input type="hidden" name="supplier_notes_snapshot" value={item.supplier_notes_snapshot ?? ""} />
            <input type="hidden" name="internal_cost" value={item.internal_cost} />
            <input type="hidden" name="margin_type" value={item.margin_type} />
            <input type="hidden" name="margin_value" value={item.margin_value} />
            <input type="hidden" name="notes" value={item.notes ?? ""} />
          </>
        ) : null}
        {isManualRow ? <input type="hidden" name="currency" value="AED" /> : null}

        <SharedQuotationRowDetailsPanel
          basicHint={
            isManualRow
              ? "Quotation pricing always uses AED for manual rows. Use the manual source price / conversion section for EUR or USD supplier pricing."
              : "Item / Model Name is the main visible title at the top of the Specification cell."
          }
          currencyFieldName={isManualRow ? undefined : "currency"}
          currencyOptions={
            isManualRow
              ? [{ code: "AED", label: "AED" }]
              : supportedCurrencies
          }
          extraSectionsAfterImages={(
            <MaterialsFinishesEditor
              brands={brands}
              item={item}
              materialGroups={materialGroups}
              materials={materials}
              productTemplates={productTemplates}
              quotationId={quotation.id}
              templateMaterialGroupItems={templateMaterialGroupItems}
              templateMaterialGroups={templateMaterialGroups}
            />
          )}
          extraSectionsBeforeSpecification={(
            <>
              <MergeModeSelect item={item} />
              <SourceLibraryPriceReference
                components={components}
                item={item}
                productTemplates={productTemplates}
              />
              {showInternal ? <PriceChangeHistory history={priceHistory} /> : null}
            </>
          )}
          item={item ?? {}}
          mode="server"
          showInternal={showInternal}
          unitPriceLabel={isManualRow ? "Quotation U.Price" : "U.Price"}
        />

        <div className="flex justify-end">
          <SubmitButton label={item ? "Save line" : "Add line"} />
        </div>
      </form>

      <SaveRowToProductLibraryPanel
        canManageProductLibrary={canManageProductLibrary}
        item={item}
        productBrands={productBrands}
        productCategories={productCategories}
        productTemplates={productTemplates}
        quotationId={quotation.id}
        returnTo={returnTo}
      />
    </>
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
  canManageProductLibrary,
  categories,
  components,
  linkedFamilies,
  materialGroups,
  materials,
  productTemplates,
  quotation,
  returnTo,
  sectionId,
  templateMaterialGroupItems,
  templateMaterialGroups,
}: {
  brands: ProductLibraryBrand[];
  canManageProductLibrary: boolean;
  categories: ProductLibraryCategory[];
  components: ProductLibraryComponent[];
  productTemplates: ProductLibraryTemplate[];
  linkedFamilies: ProductLibraryLinkedFamily[];
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  quotation: Quotation;
  returnTo: string;
  sectionId: string;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
}) {
  const summaryClass =
    "cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50";

  return (
    <div className="border border-zinc-300 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProductLibrarySelector
          brands={brands}
          canManageProductLibrary={canManageProductLibrary}
          categories={categories}
          components={components}
          linkedFamilies={linkedFamilies}
          materialGroups={materialGroups}
          materials={materials}
          quotationId={quotation.id}
          returnTo={returnTo}
          sectionId={sectionId}
          templateMaterialGroupItems={templateMaterialGroupItems}
          templateMaterialGroups={templateMaterialGroups}
          templates={productTemplates}
        />
        <OptimisticAddRowButton
          quotationId={quotation.id}
          returnTo={returnTo}
          sectionId={sectionId}
        />
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
    render: (_item, serial) => serial || "-",
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
        frameHeight={item.row_height ? Math.max(item.row_height - 34, 72) : undefined}
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
        frameHeight={item.row_height ? Math.max(item.row_height - 34, 72) : undefined}
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
        frameHeight={item.row_height ? Math.max(item.row_height - 34, 72) : undefined}
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
      const cleanedSpecification = specificationWithoutDuplicateCode({
        code: item.item_code_snapshot,
        specification: item.specification_snapshot,
      });

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
            <span className="border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">
              OPTIONAL
            </span>
          ) : null}
        </div>
        <div className="mt-1">
          {canEdit ? (
            <RowHeightTextarea
              formId={formId}
              name="specification_snapshot"
              defaultValue={cleanedSpecification}
              rowHeight={item.row_height}
              cellStyle={css}
              formatCellKey="specification"
            />
          ) : (
            <p className="text-zinc-700" style={displayCss}>
              {cleanedSpecification ?? "-"}
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
  const finish: Column = {
    key: "finish",
    label: "Finish",
    className: "w-44",
    defaultWidth: 170,
    render: (item) => <FinishDisplay item={item} />,
  };
  const size: Column = { key: "size", label: "Size", className: "w-28", defaultWidth: 110, render: (item, _serial, formId, canEdit) => canEdit ? <CellInput formId={formId} name="size_snapshot" defaultValue={item.size_snapshot} /> : item.size_snapshot ?? "-" };
  const origin: Column = {
    key: "origin",
    label: "ORIGIN / SUPPLIER",
    className: "w-32",
    defaultWidth: 136,
    render: (item, _serial, formId, canEdit) => {
      const originDisplay = formatBrandOriginSupplier({
        brandName: item.brand_name_snapshot,
        origin: item.origin_snapshot,
        supplier: item.supplier_name_snapshot,
      });

      return canEdit ? (
        <div className="grid h-full content-center gap-1.5">
          <CellInput formId={formId} name="brand_name_snapshot" defaultValue={item.brand_name_snapshot} />
          <CellInput formId={formId} name="origin_snapshot" defaultValue={item.origin_snapshot} />
          <CellInput formId={formId} name="supplier_name_snapshot" defaultValue={item.supplier_name_snapshot} />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center leading-5">
          {originDisplay.primaryLine ? <span>{originDisplay.primaryLine}</span> : null}
          {originDisplay.supplier ? <span className="text-[11px] text-zinc-600">Supplier: {originDisplay.supplier}</span> : null}
          {!originDisplay.primaryLine && !originDisplay.supplier ? "-" : null}
        </div>
      );
    },
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
        <div className="grid h-full items-center">
          <CellInput formId={formId} name="qty" type="number" step="1" defaultValue={formatNumber(item.qty)} align="center" />
        </div>
      ) : (
        formatNumber(item.qty)
      ),
  };
  const unitPrice: Column = {
    key: "unit_price",
    label: "U.Price",
    className: "w-24 text-center",
    defaultWidth: 90,
    render: (item, _serial, formId, canEdit) =>
      isPriceHiddenLine(item) ? "-" : canEdit ? <CellInput formId={formId} name="unit_price" type="number" step="5" defaultValue={item.unit_price} align="center" /> : moneyCell(item.unit_price),
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
        : (
          <QuotationRowComputedValue
            field="discount_percentage"
            fallback={item.discount_type === "percent" ? `${formatNumber(item.discount_value)}%` : "-"}
          />
        ),
  };
  const discountAmountColumn: Column = {
    key: "discount_amount",
    label: "Disc. Amount",
    className: "w-28 text-center",
    defaultWidth: 96,
    defaultVisible: false,
    render: (item) => (
      isPriceHiddenLine(item)
        ? "-"
        : <QuotationRowComputedValue field="discount_amount" fallback={moneyCell(discountAmount(item))} />
    ),
  };
  const netPrice: Column = {
    key: "net_price",
    label: "Net Price",
    className: "w-24 text-center",
    defaultWidth: 96,
    render: (item) => (
      isPriceHiddenLine(item)
        ? "-"
        : <QuotationRowComputedValue field="net_price" fallback={moneyCell(item.net_price)} />
    ),
  };
  const netTotal: Column = {
    key: "net_total",
    label: "Net Total",
    className: "w-28 text-center font-bold",
    defaultWidth: 106,
    render: (item) => (
      isPriceHiddenLine(item)
        ? "-"
        : <QuotationRowComputedValue field="net_total" fallback={totalCell(item)} />
    ),
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
    render: (item) => {
      const value = [item.notes, item.supplier_notes_snapshot].filter(Boolean).join(" / ");

      return value ? (
        <div className="max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap" title={value}>
          {value}
        </div>
      ) : (
        "-"
      );
    },
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
            <span className="border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">
              OPTIONAL
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
        <PendingSubmitButton
          className="h-7 border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 transition hover:border-red-700"
          pendingLabel="Deactivating..."
        >
          Deactivate
        </PendingSubmitButton>
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
      <PendingSubmitButton
        className="h-7 border border-red-200 bg-white px-2 text-xs font-semibold text-red-700 transition hover:border-red-700"
        pendingLabel="Deactivating..."
      >
        Deactivate
      </PendingSubmitButton>
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
      finish_selections_snapshot: item.finish_selections_snapshot,
      allow_material_continuation_page: item.allow_material_continuation_page,
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
  brands,
  canManageProductLibrary,
  components,
  materialGroups,
  materials,
  priceHistoryByItem,
  productBrands,
  productCategories,
  productTemplates,
  quotation,
  returnTo,
  inlineFormId,
  showInternal,
  templateMaterialGroupItems,
  templateMaterialGroups,
}: {
  item: QuotationItem;
  brands: FinishMaterialBrand[];
  canManageProductLibrary: boolean;
  components: ProductLibraryComponent[];
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  priceHistoryByItem: Map<string, QuotationItemPriceHistoryEntry[]>;
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  productTemplates: ProductLibraryTemplate[];
  quotation: Quotation;
  returnTo: string;
  inlineFormId: string;
  showInternal: boolean;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
}) {
  return (
    <div
      className="grid h-full content-center justify-items-center gap-1"
      data-preserve-anchor={`item-${item.id}`}
    >
      <form id={inlineFormId} action={updateQuotationItemInline}>
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="quotation_id" value={quotation.id} />
        <input type="hidden" name="return_to" value={returnTo} />
      </form>
      <div className="flex items-center gap-1.5">
        <QuotationRowSaveControls />
      </div>
      <div className="flex items-center gap-1">
        <RowMoveActions item={item} quotationId={quotation.id} returnTo={returnTo} />
        <SharedQuotationMoreMenu
          actionButtons={(
            <>
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
            </>
          )}
          detailsContent={(
            <LineForm
              brands={brands}
              canManageProductLibrary={canManageProductLibrary}
              components={components}
              item={item}
              productBrands={productBrands ?? []}
              productCategories={productCategories ?? []}
              priceHistory={priceHistoryByItem.get(item.id) ?? []}
              materialGroups={materialGroups}
              materials={materials}
              productTemplates={productTemplates}
              quotation={quotation}
              returnTo={returnTo}
              showInternal={showInternal}
              templateMaterialGroupItems={templateMaterialGroupItems}
              templateMaterialGroups={templateMaterialGroups}
            />
          )}
          itemId={item.id}
          mergeControl={(
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
          )}
        />
      </div>
    </div>
  );
}

function InlineRowEditCell({
  item,
  brands,
  canManageProductLibrary,
  components,
  materialGroups,
  materials,
  priceHistoryByItem,
  productBrands,
  productCategories,
  productTemplates,
  quotation,
  returnTo,
  inlineFormId,
  showInternal,
  templateMaterialGroupItems,
  templateMaterialGroups,
}: {
  item: QuotationItem;
  brands: FinishMaterialBrand[];
  canManageProductLibrary: boolean;
  components: ProductLibraryComponent[];
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  priceHistoryByItem: Map<string, QuotationItemPriceHistoryEntry[]>;
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  productTemplates: ProductLibraryTemplate[];
  quotation: Quotation;
  returnTo: string;
  inlineFormId: string;
  showInternal: boolean;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
}) {
  return (
    <td className="border border-zinc-300 px-1.5 py-1 text-center align-middle">
      <InlineRowActions
        item={item}
        brands={brands}
        canManageProductLibrary={canManageProductLibrary}
        components={components}
        materialGroups={materialGroups}
        materials={materials}
        priceHistoryByItem={priceHistoryByItem}
        productBrands={productBrands}
        productCategories={productCategories}
        productTemplates={productTemplates}
        quotation={quotation}
        returnTo={returnTo}
        inlineFormId={inlineFormId}
        showInternal={showInternal}
        templateMaterialGroupItems={templateMaterialGroupItems}
        templateMaterialGroups={templateMaterialGroups}
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
  const { profile, user } = await requireActiveUser();
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const canManageProductLibrary =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
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
    .select("id,project_name,project_number,project_code,project_year,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
    .eq("id", quotation.project_id)
    .single<Project>();

  const { data: projectQuotations, error: projectQuotationsError } = await supabase
    .from("quotations")
    .select("id,quotation_no,option_no")
    .eq("project_id", quotation.project_id)
    .returns<Array<{ id: string; quotation_no: string | null; option_no: number }>>();

  const { data: inactiveItems, error: inactiveItemsError } = showInternal && canManageRecords
    ? await supabase
        .from("quotation_items")
        .select("id,item_name_snapshot,updated_at")
        .eq("quotation_id", quotation.id)
        .eq("is_active", false)
        .order("updated_at", { ascending: false })
        .limit(5)
        .returns<InactiveQuotationItem[]>()
    : { data: [], error: null };

  const { data: inactiveSections, error: inactiveSectionsError } = showInternal && canManageRecords
    ? await supabase
        .from("quotation_sections")
        .select("id,section_title,section_kind,updated_at")
        .eq("quotation_id", quotation.id)
        .eq("is_active", false)
        .order("updated_at", { ascending: false })
        .limit(5)
        .returns<InactiveQuotationSection[]>()
    : { data: [], error: null };

  if (projectQuotationsError) {
    console.error("QUOTATION BUILDER PROJECT OPTIONS ERROR", projectQuotationsError.message);
  }
  if (inactiveItemsError) {
    console.error("QUOTATION BUILDER INACTIVE ITEMS ERROR", inactiveItemsError.message);
  }
  if (inactiveSectionsError) {
    console.error("QUOTATION BUILDER INACTIVE SECTIONS ERROR", inactiveSectionsError.message);
  }

  const builderRootBaseNo = quotationRootBaseNo(quotation.quotation_no);
  const builderOptionCount = builderRootBaseNo
    ? Math.max(
        1,
        ...(projectQuotations ?? [])
          .filter((candidate) => quotationRootBaseNo(candidate.quotation_no) === builderRootBaseNo)
          .map((candidate) => candidate.option_no ?? 1),
      )
    : 1;
  const showBuilderOptionNumber = builderOptionCount > 1;
  const builderDisplayQuotationNo = formatQuotationDisplayNo({
    optionNo: quotation.option_no,
    quotationNo: quotation.quotation_no,
    showOptionNumber: showBuilderOptionNumber,
  });
  const recentUndoActions = [
    ...(inactiveItems ?? []).map((item) => ({
      id: item.id,
      kind: "item" as const,
      label: item.item_name_snapshot?.trim() || "Quotation row",
      updatedAt: item.updated_at,
    })),
    ...(inactiveSections ?? []).map((section) => ({
      id: section.id,
      kind: "section" as const,
      label: section.section_title?.trim() || "Quotation section",
      updatedAt: section.updated_at,
    })),
  ]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 5);

  const { data: productBrands, error: productBrandsError } = await supabase
    .from("brands")
    .select("id,name,origin,last_price_list_checked_at,default_currency")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<ProductLibraryBrand[]>();

  if ((productBrands ?? []).length) {
    try {
      await ensureDefaultProductCategoryTree({
        supabase,
        brandIds: (productBrands ?? []).map((brand) => brand.id),
        userId: user.id,
      });
    } catch (seedError) {
      console.error("DEFAULT PRODUCT CATEGORY BACKFILL ERROR", seedError);
    }
  }

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
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,internal_selection_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,proposed_image_url_4,proposed_image_url_5,proposed_image_url_6,proposed_image_url_7,proposed_image_url_8,proposed_image_url_9,proposed_image_url_10,proposed_image_url_11,proposed_image_url_12,proposed_image_url_13,proposed_image_url_14,proposed_image_url_15,proposed_image_url_16,proposed_image_url_17,proposed_image_url_18,proposed_image_url_19,proposed_image_url_20,image_settings,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,unit_label,currency,default_unit_price,last_price_checked_at,price_check_interval_days,price_check_note,created_at,price_notes",
    )
    .eq("is_active", true)
    .eq("lifecycle_status", "active")
    .order("template_name", { ascending: true })
    .returns<ProductLibraryTemplate[]>();

  const { data: brandPriceListUpdates, error: brandPriceListUpdatesError } = await supabase
    .from("brand_price_list_updates")
    .select("id,brand_id,title,effective_from,received_at,status,created_at")
    .in("status", ["draft", "active"])
    .order("brand_id", { ascending: true })
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<Array<{
      id: string;
      brand_id: string;
      title: string | null;
      effective_from: string | null;
      received_at: string | null;
      status: string;
      created_at: string | null;
    }>>();

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

  const { data: materialGroups, error: materialGroupsError } = await supabase
    .from("brand_material_groups")
    .select("id,brand_id,group_name,sort_order")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("group_name", { ascending: true })
    .returns<FinishMaterialGroup[]>();

  const { data: materials, error: materialsError } = await supabase
    .from("brand_materials")
    .select("id,brand_id,material_group_id,material_category,material_collection,material_code,material_name,description,image_url,sort_order,is_active")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("material_group_id", { ascending: true })
    .order("material_category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("material_code", { ascending: true })
    .returns<FinishMaterial[]>();

  const { data: templateMaterialGroups, error: templateMaterialGroupsError } = await supabase
    .from("product_template_material_groups")
    .select("id,product_template_id,material_group_id,selection_mode,label_override,is_required,allow_multiple,show_in_specification,show_in_quotation,sort_order")
    .eq("is_active", true)
    .order("product_template_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductTemplateMaterialGroupLink[]>();

  const { data: templateMaterialGroupItems, error: templateMaterialGroupItemsError } = await supabase
    .from("product_template_material_group_items")
    .select("id,product_template_material_group_id,brand_material_id,sort_order,is_active")
    .eq("is_active", true)
    .order("product_template_material_group_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductTemplateMaterialGroupItemLink[]>();

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
      "id,quotation_id,section_id,item_type,source_template_id,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,internal_components_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,allow_material_continuation_page,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,parent_item_id,include_in_total,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,is_active,notes,created_at",
    )
    .eq("quotation_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<QuotationItem[]>();

  const { data: priceHistory, error: priceHistoryError } = await supabase
    .from("quotation_item_price_history")
    .select("id,quotation_item_id,change_type,old_unit_price,new_unit_price,old_currency,new_currency,note,source_price_type,source_price_label,changed_by,changed_at")
    .eq("quotation_id", id)
    .order("changed_at", { ascending: false })
    .returns<QuotationItemPriceHistoryEntry[]>();

  if (sectionsError) console.error("QUOTATION BUILDER SECTIONS ERROR", sectionsError.message);
  if (itemsError) console.error("QUOTATION BUILDER ITEMS ERROR", itemsError.message);
  if (priceHistoryError) console.error("QUOTATION ITEM PRICE HISTORY ERROR", priceHistoryError.message);
  if (productBrandsError) console.error("PRODUCT SELECTOR BRANDS ERROR", productBrandsError.message);
  if (productCategoriesError) console.error("PRODUCT SELECTOR CATEGORIES ERROR", productCategoriesError.message);
  if (productTemplatesError) console.error("PRODUCT SELECTOR TEMPLATES ERROR", productTemplatesError.message);
  if (brandPriceListUpdatesError) console.error("PRODUCT SELECTOR PRICE LIST UPDATES ERROR", brandPriceListUpdatesError.message);
  if (productComponentsError) console.error("PRODUCT SELECTOR OPTIONS ERROR", productComponentsError.message);
  if (linkedFamiliesError) console.error("PRODUCT SELECTOR LINKED FAMILIES ERROR", linkedFamiliesError.message);
  if (materialGroupsError) console.error("QUOTATION MATERIAL GROUPS ERROR", materialGroupsError.message);
  if (materialsError) console.error("QUOTATION MATERIALS ERROR", materialsError.message);
  if (templateMaterialGroupsError) console.error("QUOTATION TEMPLATE MATERIAL GROUPS ERROR", templateMaterialGroupsError.message);
  if (templateMaterialGroupItemsError) console.error("QUOTATION TEMPLATE MATERIAL GROUP ITEMS ERROR", templateMaterialGroupItemsError.message);

  const priceListUpdatesByBrand = new Map<string, NonNullable<typeof brandPriceListUpdates>>();

  for (const update of brandPriceListUpdates ?? []) {
    priceListUpdatesByBrand.set(update.brand_id, [
      ...(priceListUpdatesByBrand.get(update.brand_id) ?? []),
      update,
    ]);
  }

  const latestPriceListUpdateByBrand = new Map(
    Array.from(priceListUpdatesByBrand.entries())
      .map(([brandId, updates]) => [brandId, latestBrandPriceListUpdate(updates)] as const)
      .filter((entry): entry is readonly [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1])),
  );
  const brandById = new Map((productBrands ?? []).map((brand) => [brand.id, brand]));
  const productTemplatesWithPriceChecks = (productTemplates ?? []).map((template) => ({
    ...template,
    brand_latest_price_list_at: brandPriceBaselineDate({
      fallbackCheckedAt: brandById.get(template.brand_id)?.last_price_list_checked_at ?? null,
      latestBrandPriceListUpdate: latestPriceListUpdateByBrand.get(template.brand_id) ?? null,
    }),
    latest_brand_price_list_update: latestPriceListUpdateByBrand.get(template.brand_id) ?? null,
  }));

  for (const template of productTemplatesWithPriceChecks) {
    const brandName = brandById.get(template.brand_id)?.name ?? null;

    if (brandName !== "LAS MOBILI") {
      continue;
    }

    const status = productTemplatePriceCheckState({
      brandPriceBaselineAt: template.brand_latest_price_list_at,
      formatDate: (value) => value ?? "",
      latestBrandPriceListUpdate: template.latest_brand_price_list_update,
      template,
    });

    console.log("Product price status derived", {
      brandLatestPriceListAt: template.brand_latest_price_list_at,
      brandName,
      reason: status.reason,
      status: status.key,
      templateCreatedAt: template.created_at,
      templateId: template.id,
      templateName: template.internal_selection_name ?? template.template_name,
      templatePriceCheckedAt: template.last_price_checked_at,
    });
  }
  const productTemplateById = new Map(
    productTemplatesWithPriceChecks.map((template) => [template.id, template]),
  );
  const componentsByTemplate = new Map<string, ProductLibraryComponent[]>();

  for (const component of productComponents ?? []) {
    componentsByTemplate.set(component.template_id, [
      ...(componentsByTemplate.get(component.template_id) ?? []),
      component,
    ]);
  }

  const itemsBySection = new Map<string, QuotationItem[]>();
  const changedByIds = Array.from(
    new Set((priceHistory ?? []).map((entry) => entry.changed_by).filter(Boolean)),
  );
  const changedByNameById = new Map<string, string>();

  if (changedByIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .in("id", changedByIds)
      .returns<Array<{ id: string; full_name: string | null; email: string | null }>>();

    if (profilesError) {
      console.error("QUOTATION ITEM PRICE HISTORY PROFILES ERROR", profilesError.message);
    } else {
      for (const profile of profiles ?? []) {
        changedByNameById.set(profile.id, profile.full_name ?? profile.email ?? "User");
      }
    }
  }

  const priceHistoryByItem = new Map<string, QuotationItemPriceHistoryEntry[]>();

  for (const entry of priceHistory ?? []) {
    const historyEntry = {
      ...entry,
      changed_by_name: entry.changed_by ? changedByNameById.get(entry.changed_by) ?? null : null,
    };
    priceHistoryByItem.set(entry.quotation_item_id, [
      ...(priceHistoryByItem.get(entry.quotation_item_id) ?? []),
      historyEntry,
    ]);
  }

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
  const optimisticColumns: OptimisticColumn[] = columns.map((column) => ({
    className: column.className,
    key: column.key,
  }));
  const settingsMap = columnSettingsMap(quotation.layout_settings);
  const showEditColumn = canManageRecords;
  const editColumnWidth = settingsMap.get("edit")?.width ?? 132;
  const totalColumns = columns.length + (showEditColumn ? 1 : 0);
  const minimumSheetWidth = showInternal ? 2200 : 1480;
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
  let runningSerialNumber = 0;

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
                {builderDisplayQuotationNo ?? quotation.quotation_no ?? "Draft quotation"} - {quotation.title}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {client?.company_name ?? "Unknown client"} / {project?.project_name ?? "Unknown project"}
              </p>
            </div>
            <StatusBadge status={quotation.status} />
            {showBuilderOptionNumber ? (
              <span className="border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                {optionBadgeLabel(quotation.option_no)}
              </span>
            ) : null}
            <span className="border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
              {layoutLabels.get(quotation.layout_mode) ?? quotation.layout_mode}
            </span>
            <span className="text-xs text-zinc-500">All changes saved automatically</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canManageRecords ? (
              <details className="relative" data-state-key={`quotation-builder-add-section-${quotation.id}`}>
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
            <details className="relative" data-state-key={`quotation-builder-columns-${quotation.id}`}>
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
            <GlobalRefreshButton />
            <LocalDraftLink quotationId={quotation.id} />
            <Link
              href={`/quotations/${quotation.id}/pdf`}
              target="_blank"
              className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            >
              Preview PDF
            </Link>
            <PendingLinkButton
              href={`/quotations/${quotation.id}/download-pdf`}
              pendingLabel="Preparing PDF..."
              className="bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
            >
              Download PDF
            </PendingLinkButton>
            <ExportExcelButton
              quotationId={quotation.id}
              className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 inline-flex items-center gap-1.5"
            />
            <Link
              href={`/quotations/${id}/specification`}
              target="_blank"
              className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            >
              Specification Sheet
            </Link>
            <PendingLinkButton
              href={`/quotations/${quotation.id}/download-specification`}
              pendingLabel="Preparing Specification..."
              className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            >
              Download Specification
            </PendingLinkButton>
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
        <OptimisticQuotationBuilderProvider>
        {query?.message ? (
          <div className="mb-4 flex flex-col gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p>{query.message}</p>
              {query.saved_template_id ? (
                <Link
                  href={`/products/templates?template=${query.saved_template_id}`}
                  className="text-sm font-semibold text-emerald-900 underline underline-offset-2 transition hover:text-emerald-700"
                >
                  Open product template
                </Link>
              ) : null}
            </div>
            {showInternal && canManageRecords && query.undo_kind === "item" && query.undo_item_id ? (
              <form action={restoreQuotationItem}>
                <input type="hidden" name="quotation_id" value={quotation.id} />
                <input type="hidden" name="quotation_item_id" value={query.undo_item_id} />
                <input type="hidden" name="return_to" value={builderPath} />
                <button
                  type="submit"
                  className="text-sm font-semibold text-emerald-900 underline underline-offset-2 transition hover:text-emerald-700"
                >
                  Undo
                </button>
              </form>
            ) : null}
            {showInternal && canManageRecords && query.undo_kind === "section" && query.undo_section_id ? (
              <form action={restoreQuotationSection}>
                <input type="hidden" name="quotation_id" value={quotation.id} />
                <input type="hidden" name="quotation_section_id" value={query.undo_section_id} />
                <input type="hidden" name="return_to" value={builderPath} />
                <button
                  type="submit"
                  className="text-sm font-semibold text-emerald-900 underline underline-offset-2 transition hover:text-emerald-700"
                >
                  Undo
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {showInternal && canManageRecords ? (
          <section className="mb-4 rounded border border-zinc-300 bg-white">
            <details data-state-key={`quotation-builder-recent-changes-${quotation.id}`}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-800">
                Recent changes
              </summary>
              <div className="border-t border-zinc-200 px-3 py-3">
                {recentUndoActions.length ? (
                  <div className="grid gap-2">
                    {recentUndoActions.map((action) => (
                      <div
                        key={`${action.kind}-${action.id}`}
                        className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-medium text-zinc-900">
                            {action.kind === "item"
                              ? `Restore deactivated row: ${action.label}`
                              : `Restore deactivated section: ${action.label}`}
                          </p>
                          <p className="text-xs text-zinc-500">{recentChangeTimeLabel(action.updatedAt)}</p>
                        </div>
                        {action.kind === "item" ? (
                          <form action={restoreQuotationItem}>
                            <input type="hidden" name="quotation_id" value={quotation.id} />
                            <input type="hidden" name="quotation_item_id" value={action.id} />
                            <input type="hidden" name="return_to" value={builderPath} />
                            <button
                              type="submit"
                              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                            >
                              Restore row
                            </button>
                          </form>
                        ) : (
                          <form action={restoreQuotationSection}>
                            <input type="hidden" name="quotation_id" value={quotation.id} />
                            <input type="hidden" name="quotation_section_id" value={action.id} />
                            <input type="hidden" name="return_to" value={builderPath} />
                            <button
                              type="submit"
                              className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                            >
                              Restore section
                            </button>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No recent undoable changes.</p>
                )}
              </div>
            </details>
          </section>
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
                value={[
                  project?.project_name,
                  formatProjectReferenceDisplay(project),
                  project?.location,
                ].filter(Boolean).join(" - ")}
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
              <SheetInfo label="Quote No" value={builderDisplayQuotationNo ?? quotation.quotation_no ?? "Draft"} />
              <SheetInfo label="Date" value={quotation.quotation_date} />
              <SheetInfo label="Status" value={statusLabel(quotation.status)} />
              <SheetInfo label="Layout" value={layoutLabels.get(quotation.layout_mode) ?? quotation.layout_mode} />
              <SheetInfo label="Location" value={project?.location} />
              <SheetInfo label="Address" value={project?.project_address} />
              <SheetInfo label="View" value={showInternal ? "Internal" : "Client"} />
            </div>
          </div>

          <div className="w-full">
            <QuotationSheetTable
              quotationId={quotation.id}
              columns={sheetColumns}
              minimumTableWidth={minimumSheetWidth}
            >
              <tbody>
                {displaySections.map((section, sectionIndex) => {
                  const previousSection = displaySections[sectionIndex - 1];
                  const nextSection = displaySections[sectionIndex + 1];
                  const sectionAnchor = `section-${section.id}`;
                  const sectionReturnTo = withHash(builderPath, sectionAnchor);
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
                        <tr id={sectionAnchor}>
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
                                <details data-state-key={`quotation-main-section-add-sub-${section.id}`}>
                                  <summary className="cursor-pointer border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50">
                                    + Sub Section
                                  </summary>
                                  <div className="mt-2 w-[min(560px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3">
                                    <QuickSectionForm
                                      quotationId={quotation.id}
                                      returnTo={sectionReturnTo}
                                      label="Sub Section"
                                      sectionKind="sub"
                                      parentSectionId={section.id}
                                      insertAfterSectionId={addBelowId}
                                      placeholder="Section name (optional)"
                                    />
                                  </div>
                                </details>
                                <details
                                  data-state-key={`quotation-main-section-edit-${section.id}`}
                                  data-preserve-anchor={`quotation-section-${section.id}`}
                                >
                                  <summary className="cursor-pointer border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                    Edit main section
                                  </summary>
                                  <div className="mt-2 w-[min(820px,calc(100vw-4rem))] border border-zinc-300 bg-white p-3 text-left">
                                    <SectionForm quotationId={quotation.id} returnTo={sectionReturnTo} section={section} />
                                    <form action={deactivateQuotationSection} className="mt-2">
                                      <input type="hidden" name="id" value={section.id} />
                                      <input type="hidden" name="quotation_id" value={quotation.id} />
                                      <input type="hidden" name="return_to" value={sectionReturnTo} />
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
                      <tr id={sectionAnchor}>
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

                      <OptimisticSectionEmptyState
                        isServerEmpty={!sectionItems.length}
                        sectionId={section.id}
                        totalColumns={totalColumns}
                      />

                      <OptimisticSectionRows
                        columns={optimisticColumns}
                        quotationId={quotation.id}
                        realItemIds={sectionItems.map((item) => item.id)}
                        returnTo={sectionReturnTo}
                        sectionId={section.id}
                        showEditColumn={showEditColumn}
                      />

                      {sectionItems.map((item) => {
                        const mergedText = item.item_name_snapshot ?? item.specification_snapshot ?? "";
                        const rowSerial = isSerialCountedLine(item) ? ++runningSerialNumber : 0;
                        const inlineFormId = `inline-row-${item.id}`;
                        const itemReturnTo = withHash(builderPath, `item-${item.id}`);
                        const mergeMode = mergeModeForItem(item);

                        if (mergeMode === "merge_full_row") {
                          const fullRowStyle = cellStyleForItem(item, "full_row");
                          const fullRowCss = cellStyleCss(
                            fullRowStyle,
                            item.line_style === "heading" ? "center" : "left",
                          );

                          return (
                            <QuotationRowEditorProvider
                              key={`${item.id}-${item.qty}-${item.unit_price}-${item.discount_value}`}
                              formId={inlineFormId}
                              row={{
                                discountType: item.discount_type,
                                discountValue: item.discount_value,
                                qty: item.qty,
                                rowId: item.id,
                                unitPrice: item.unit_price,
                              }}
                            >
                              <tr
                                id={`item-${item.id}`}
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
                                    brands={productBrands ?? []}
                                    canManageProductLibrary={canManageProductLibrary}
                                    components={productComponents ?? []}
                                    materialGroups={materialGroups ?? []}
                                    materials={materials ?? []}
                                    priceHistoryByItem={priceHistoryByItem}
                                    productBrands={productBrands ?? []}
                                    productCategories={productCategories ?? []}
                                    productTemplates={productTemplatesWithPriceChecks}
                                    quotation={quotation}
                                    returnTo={itemReturnTo}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                    templateMaterialGroupItems={templateMaterialGroupItems ?? []}
                                    templateMaterialGroups={templateMaterialGroups ?? []}
                                  />
                                ) : null}
                              </tr>
                              {showInternal ? (
                                <SourcePriceWarning
                                  componentsByTemplate={componentsByTemplate}
                                  item={item}
                                  productTemplateById={productTemplateById}
                                  quotationId={quotation.id}
                                  returnTo={itemReturnTo}
                                  totalColumns={totalColumns}
                                />
                              ) : null}
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </QuotationRowEditorProvider>
                          );
                        }

                        if (item.line_style === "heading") {
                          const fullRowStyle = cellStyleForItem(item, "full_row");
                          const fullRowCss = cellStyleCss(fullRowStyle, "center");

                          return (
                            <QuotationRowEditorProvider
                              key={`${item.id}-${item.qty}-${item.unit_price}-${item.discount_value}`}
                              formId={inlineFormId}
                              row={{
                                discountType: item.discount_type,
                                discountValue: item.discount_value,
                                qty: item.qty,
                                rowId: item.id,
                                unitPrice: item.unit_price,
                              }}
                            >
                              <tr id={`item-${item.id}`} className="align-middle" style={item.row_height ? { height: `${item.row_height}px` } : undefined}>
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
                                    brands={productBrands ?? []}
                                    canManageProductLibrary={canManageProductLibrary}
                                    components={productComponents ?? []}
                                    materialGroups={materialGroups ?? []}
                                    materials={materials ?? []}
                                    priceHistoryByItem={priceHistoryByItem}
                                    productBrands={productBrands ?? []}
                                    productCategories={productCategories ?? []}
                                    productTemplates={productTemplatesWithPriceChecks}
                                    quotation={quotation}
                                    returnTo={itemReturnTo}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                    templateMaterialGroupItems={templateMaterialGroupItems ?? []}
                                    templateMaterialGroups={templateMaterialGroups ?? []}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </QuotationRowEditorProvider>
                          );
                        }

                        if (item.line_style === "note") {
                          const fullRowStyle = cellStyleForItem(item, "full_row");
                          const fullRowCss = cellStyleCss(fullRowStyle);

                          return (
                            <QuotationRowEditorProvider
                              key={`${item.id}-${item.qty}-${item.unit_price}-${item.discount_value}`}
                              formId={inlineFormId}
                              row={{
                                discountType: item.discount_type,
                                discountValue: item.discount_value,
                                qty: item.qty,
                                rowId: item.id,
                                unitPrice: item.unit_price,
                              }}
                            >
                              <tr id={`item-${item.id}`} className="align-middle" style={item.row_height ? { height: `${item.row_height}px` } : undefined}>
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
                                    brands={productBrands ?? []}
                                    canManageProductLibrary={canManageProductLibrary}
                                    components={productComponents ?? []}
                                    materialGroups={materialGroups ?? []}
                                    materials={materials ?? []}
                                    priceHistoryByItem={priceHistoryByItem}
                                    productBrands={productBrands ?? []}
                                    productCategories={productCategories ?? []}
                                    productTemplates={productTemplatesWithPriceChecks}
                                    quotation={quotation}
                                    returnTo={itemReturnTo}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                    templateMaterialGroupItems={templateMaterialGroupItems ?? []}
                                    templateMaterialGroups={templateMaterialGroups ?? []}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </QuotationRowEditorProvider>
                          );
                        }

                        if (item.line_style === "no_quote" && !mergedText) {
                          return (
                            <QuotationRowEditorProvider
                              key={`${item.id}-${item.qty}-${item.unit_price}-${item.discount_value}`}
                              formId={inlineFormId}
                              row={{
                                discountType: item.discount_type,
                                discountValue: item.discount_value,
                                qty: item.qty,
                                rowId: item.id,
                                unitPrice: item.unit_price,
                              }}
                            >
                              <tr id={`item-${item.id}`} className="align-middle" style={item.row_height ? { height: `${item.row_height}px` } : undefined}>
                                <td colSpan={showEditColumn ? totalColumns - 1 : totalColumns} className="h-8 border border-zinc-300 bg-white align-middle" />
                                {showEditColumn ? (
                                  <InlineRowEditCell
                                    item={item}
                                    brands={productBrands ?? []}
                                    canManageProductLibrary={canManageProductLibrary}
                                    components={productComponents ?? []}
                                    materialGroups={materialGroups ?? []}
                                    materials={materials ?? []}
                                    priceHistoryByItem={priceHistoryByItem}
                                    productBrands={productBrands ?? []}
                                    productCategories={productCategories ?? []}
                                    productTemplates={productTemplatesWithPriceChecks}
                                    quotation={quotation}
                                    returnTo={itemReturnTo}
                                    inlineFormId={inlineFormId}
                                    showInternal={showInternal}
                                    templateMaterialGroupItems={templateMaterialGroupItems ?? []}
                                    templateMaterialGroups={templateMaterialGroups ?? []}
                                  />
                                ) : null}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </QuotationRowEditorProvider>
                          );
                        }

                        return (
                          <QuotationRowEditorProvider
                            key={`${item.id}-${item.qty}-${item.unit_price}-${item.discount_value}`}
                            formId={inlineFormId}
                            row={{
                              discountType: item.discount_type,
                              discountValue: item.discount_value,
                              qty: item.qty,
                              rowId: item.id,
                              unitPrice: item.unit_price,
                            }}
                          >
                            <tr
                              id={`item-${item.id}`}
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
                                  brands={productBrands ?? []}
                                  canManageProductLibrary={canManageProductLibrary}
                                  components={productComponents ?? []}
                                  materialGroups={materialGroups ?? []}
                                  materials={materials ?? []}
                                  priceHistoryByItem={priceHistoryByItem}
                                  productBrands={productBrands ?? []}
                                  productCategories={productCategories ?? []}
                                  productTemplates={productTemplatesWithPriceChecks}
                                  quotation={quotation}
                                  returnTo={itemReturnTo}
                                  inlineFormId={inlineFormId}
                                  showInternal={showInternal}
                                  templateMaterialGroupItems={templateMaterialGroupItems ?? []}
                                  templateMaterialGroups={templateMaterialGroups ?? []}
                                />
                              ) : null}
                            </tr>
                            {showInternal ? (
                              <SourcePriceWarning
                                componentsByTemplate={componentsByTemplate}
                                item={item}
                                productTemplateById={productTemplateById}
                                quotationId={quotation.id}
                                returnTo={itemReturnTo}
                                totalColumns={totalColumns}
                              />
                            ) : null}
                            <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                          </QuotationRowEditorProvider>
                        );
                      })}

                      <SectionTotalRow
                        currency={quotation.currency}
                        total={sectionTotals.get(section.id) ?? 0}
                        totalColumns={totalColumns}
                      />

                      {canManageRecords ? (
                        <tr>
                          <td id={`section-actions-${section.id}`} colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-2 py-2">
                            <RowActionPanel
                              brands={productBrands ?? []}
                              canManageProductLibrary={canManageProductLibrary}
                              categories={productCategories ?? []}
                              components={productComponents ?? []}
                              linkedFamilies={linkedFamilies ?? []}
                              materialGroups={materialGroups ?? []}
                              materials={materials ?? []}
                              productTemplates={productTemplatesWithPriceChecks}
                              quotation={quotation}
                              returnTo={sectionReturnTo}
                              sectionId={section.id}
                              templateMaterialGroupItems={templateMaterialGroupItems ?? []}
                              templateMaterialGroups={templateMaterialGroups ?? []}
                            />
                            <PasteQuotationRowControls
                              quotationId={quotation.id}
                              returnTo={sectionReturnTo}
                              sectionId={section.id}
                            />
                            <details
                              data-state-key={`quotation-section-edit-${section.id}`}
                              data-preserve-anchor={`quotation-section-${section.id}`}
                            >
                              <summary className="mt-2 cursor-pointer text-xs font-semibold text-zinc-600">
                                Edit section
                              </summary>
                              <div className="mt-2 grid gap-3 xl:grid-cols-[1fr_auto]">
                                <SectionForm quotationId={quotation.id} returnTo={sectionReturnTo} section={section} />
                                <form action={deactivateQuotationSection}>
                                  <input type="hidden" name="id" value={section.id} />
                                  <input type="hidden" name="quotation_id" value={quotation.id} />
                                  <input type="hidden" name="return_to" value={sectionReturnTo} />
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
        </OptimisticQuotationBuilderProvider>
      </main>
    </div>
  );
}
