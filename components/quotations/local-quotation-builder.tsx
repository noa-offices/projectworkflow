"use client";

import Link from "next/link";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ProductLibrarySelector,
  type ProductLibraryBrand,
  type ProductLibraryCategory,
  type ProductLibraryComponent,
  type ProductLibraryLinkedFamily,
  type ProductLibraryTemplate,
} from "@/components/quotations/product-library-selector";
import { LocalQuotationCustomPrintableImageCell, LocalQuotationImageCell } from "@/components/quotations/local-quotation-image-cell";
import { QuotationSheetTable } from "@/components/quotations/quotation-sheet-table";
import { FinishImagePreview } from "@/components/quotations/finish-image-uploader";
import { SharedQuotationMoreMenu } from "@/components/quotations/shared-quotation-row-details-panel";
import {
  FinishSelectionsEditor,
  type FinishSelectionEditorRow,
  type FinishMaterial,
  type FinishMaterialGroup,
  type ProductTemplateMaterialGroupItemLink,
  type ProductTemplateMaterialGroupLink,
} from "@/components/quotations/finish-selections-editor";
import { getWorkspaceDocument, saveWorkspaceDocument } from "@/lib/local/quotation-db";
import {
  createEmptyItem,
  createEmptySection,
  createLocalId,
  localNow,
  orderedItems,
  orderedSections,
  recalculateWorkspace,
  workspaceItemDisplayPricing,
  type LocalQuotationItem,
  type LocalQuotationSection,
  type LocalQuotationWorkspace,
} from "@/lib/local/quotation-workspace";
import {
  formatBrandOriginSupplier,
  specificationWithoutDuplicateCode,
} from "@/lib/quotations/format-quotation-row";
import { formatMoney } from "@/lib/currencies";

type BuilderView = "client" | "internal";
type LocalQuotationItemPatch = Partial<Omit<LocalQuotationItem, "qty" | "unit_price" | "discount_type" | "discount_value">> & {
  qty?: number | string;
  unit_price?: number | string;
  discount_type?: string | null;
  discount_value?: number | string;
};
type PriceRoundingMetadata = {
  rounded_net_prices?: Record<string, number>;
  step?: number | null;
  last_applied_step?: number | null;
  applied_at?: string | null;
  mode?: "nearest";
};
type LocalRowClipboardPayload = {
  copied_at: string;
  source_item_id: string;
  source_quotation_id: string;
  source_quotation_label: string;
  source_section_id: string | null;
  row_snapshot: LocalQuotationItem;
};

const allColumns = [
  { key: "manual_serial", label: "Manual S.No.", defaultWidth: 90, align: "center", defaultVisible: false },
  { key: "s_no", label: "S. No.", defaultWidth: 54, align: "center", defaultVisible: true },
  { key: "code", label: "Code", defaultWidth: 90, align: "left", defaultVisible: true },
  { key: "specified_image", label: "Specified Item Reference Image", defaultWidth: 180, align: "left", defaultVisible: false },
  { key: "proposed_image", label: "Proposed Item Reference Image", defaultWidth: 180, align: "left", defaultVisible: true },
  { key: "specification", label: "Specifications", defaultWidth: 500, align: "left", defaultVisible: true },
  { key: "origin", label: "Origin / Supplier", defaultWidth: 136, align: "center", defaultVisible: true },
  { key: "model", label: "Model", defaultWidth: 110, align: "left", defaultVisible: false },
  { key: "finish", label: "Finish", defaultWidth: 170, align: "left", defaultVisible: false },
  { key: "size", label: "Size", defaultWidth: 110, align: "left", defaultVisible: false },
  { key: "warranty", label: "Warranty", defaultWidth: 100, align: "left", defaultVisible: false },
  { key: "qty", label: "Qty", defaultWidth: 70, align: "center", defaultVisible: true },
  { key: "unit_price", label: "U.Price", defaultWidth: 90, align: "center", defaultVisible: true },
  { key: "discount", label: "Discount", defaultWidth: 90, align: "center", defaultVisible: false },
  { key: "discount_percentage", label: "Discount %", defaultWidth: 90, align: "center", defaultVisible: false },
  { key: "discount_amount", label: "Disc. Amount", defaultWidth: 96, align: "center", defaultVisible: false },
  { key: "net_price", label: "Net Price", defaultWidth: 96, align: "center", defaultVisible: true },
  { key: "net_total", label: "Net Total", defaultWidth: 106, align: "center", defaultVisible: true },
  { key: "supplier_name", label: "Supplier", defaultWidth: 128, align: "left", defaultVisible: false },
  { key: "edit", label: "Edit / Actions", defaultWidth: 132, align: "center", defaultVisible: true },
  { key: "internal_notes", label: "Internal Notes", defaultWidth: 220, align: "left", defaultVisible: true },
  { key: "cost_price", label: "Cost Price", defaultWidth: 100, align: "center", defaultVisible: false },
  { key: "margin_percent", label: "Margin %", defaultWidth: 90, align: "center", defaultVisible: false },
  { key: "margin_amount", label: "Margin Amt.", defaultWidth: 110, align: "center", defaultVisible: false },
  { key: "supplier_notes", label: "Supplier Notes", defaultWidth: 200, align: "left", defaultVisible: false },
  { key: "delivery_lead_time", label: "Lead Time", defaultWidth: 120, align: "left", defaultVisible: false },
  { key: "internal_status", label: "Internal Status", defaultWidth: 130, align: "left", defaultVisible: false },
];
type LocalBuilderColumn = {
  key: string;
  label: string;
  defaultWidth: number;
  align: string;
  defaultVisible: boolean;
  internalCustomColumnId?: string;
  internalCustomColumnType?: LocalInternalCustomColumnType;
  customPrintableColumnId?: string;
  customPrintableColumnType?: LocalCustomPrintableColumnType;
};
type LocalLayoutColumnSetting = {
  key: string;
  visible?: boolean;
  width?: number;
};
type LocalInternalCustomColumnType = "text" | "number" | "date";
type LocalInternalCustomColumn = {
  id: string;
  label: string;
  type: LocalInternalCustomColumnType;
  width?: number;
  visible?: boolean;
};
type LocalCustomPrintableColumnType = "text" | "number" | "percentage" | "image";
type LocalCustomPrintableColumn = {
  id: string;
  label: string;
  type: LocalCustomPrintableColumnType;
  width?: number;
  showInClient?: boolean;
  showInInternal?: boolean;
};
type LocalSpecificationMetadataKey = "title" | "size" | "finish" | "warranty";
type LocalLayoutSettings = {
  columns?: LocalLayoutColumnSetting[];
  columnOrder?: string[];
  internalColumns?: LocalInternalCustomColumn[];
  customPrintableColumns?: LocalCustomPrintableColumn[];
  specificationMetadata?: Partial<Record<LocalSpecificationMetadataKey, boolean>>;
};
type HistoryCommitMode = "push" | "merge" | "skip";
type HistoryCommitOptions = {
  groupKey?: string;
  mode?: HistoryCommitMode;
};

const minColumnWidth = 40;
const maxColumnWidth = 800;
const minRowHeight = 40;
const maxRowHeight = 600;
const localHistoryLimit = 50;
const localHistoryMergeWindowMs = 1200;
const localRowClipboardKey = "projectworkflow.localBuilderCopiedQuotationRow";
const localRowClipboardEvent = "projectworkflow:localBuilderCopiedQuotationRow";
const quotationStatusOptions = [
  "draft",
  "submitted",
  "pending_approval",
  "approved",
  "rejected",
  "converted",
] as const;
const layoutModeOptions = [
  "simple_proposal",
  "standard_proposal",
  "comparison",
  "boq_schedule",
  "internal_costing",
] as const;
const layoutLabels = new Map([
  ["simple_proposal", "Simple Proposal"],
  ["standard_proposal", "Standard Proposal"],
  ["comparison", "Comparison"],
  ["boq_schedule", "BOQ / Schedule"],
  ["internal_costing", "Internal Costing"],
]);
const specificationMetadataFields: Array<[LocalSpecificationMetadataKey, string]> = [
  ["title", "Show item/model title in specification"],
  ["size", "Show dimension in specification"],
  ["finish", "Show finish in specification"],
  ["warranty", "Show warranty in specification"],
];
const internalDefaultColumnKeys = [
  "internal_notes",
] as const;
const legacyInternalColumnKeys = [
  "cost_price",
  "margin_percent",
  "margin_amount",
  "supplier_notes",
  "delivery_lead_time",
  "internal_status",
] as const;
const columnSettingsGroups: Array<{
  title: string;
  keys: string[];
  internalOnly?: boolean;
}> = [
  {
    title: "Identity / Reference Columns",
    keys: ["manual_serial", "s_no", "code", "specified_image", "proposed_image", "specification"],
  },
  {
    title: "Product Detail Columns",
    keys: ["origin", "model", "finish", "size", "warranty", "supplier_name"],
  },
  {
    title: "Pricing Columns",
    keys: ["qty", "unit_price", "discount", "discount_percentage", "discount_amount", "net_price", "net_total"],
  },
  {
    title: "Custom Printable Columns",
    keys: [],
  },
  {
    title: "Internal View Columns",
    keys: ["internal_notes"],
    internalOnly: true,
  },
  {
    title: "Actions",
    keys: ["edit"],
  },
] as const;

function clampColumnWidth(width: number) {
  return Math.min(Math.max(Math.round(width), minColumnWidth), maxColumnWidth);
}

function clampRowHeight(height: number) {
  return Math.min(Math.max(Math.round(height), minRowHeight), maxRowHeight);
}

function ItemRowResizeHandle({ item, totalColumns }: { item: LocalQuotationItem; totalColumns: number }) {
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

function stringValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function cleanOptionalDetailValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function canSaveRowToProductLibrary(item?: LocalQuotationItem) {
  if (!item) return false;
  if (["note", "blank", "subtotal"].includes(item.item_type)) return false;
  if (["heading", "note", "no_quote"].includes(item.line_style)) return false;

  return true;
}

type QuotationRowImportDraft = {
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  model_snapshot: string | null;
  origin_snapshot: string | null;
  supplier_name_snapshot: string | null;
  specification_snapshot: string | null;
  size_snapshot: string | null;
  unit_label: string | null;
  currency: string | null;
  unit_price: number;
  proposed_image_url_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  notes: string | null;
};

function quotationRowImportDraft(item: LocalQuotationItem): QuotationRowImportDraft {
  return {
    item_name_snapshot: item.item_name_snapshot ?? null,
    item_code_snapshot: item.item_code_snapshot ?? null,
    model_snapshot: item.model_snapshot ?? null,
    origin_snapshot: item.origin_snapshot ?? null,
    supplier_name_snapshot: item.supplier_name_snapshot ?? null,
    specification_snapshot: item.specification_snapshot ?? null,
    size_snapshot: item.size_snapshot ?? null,
    unit_label: item.unit_label ?? null,
    currency: item.currency ?? null,
    unit_price: exactMoneyValue(item.unit_price),
    proposed_image_url_snapshot: item.proposed_image_url_snapshot ?? null,
    specified_image_url_snapshot: item.specified_image_url_snapshot ?? null,
    notes: item.notes ?? null,
  };
}

function encodeQuotationRowImportDraft(item: LocalQuotationItem) {
  const json = JSON.stringify(quotationRowImportDraft(item));
  const base64 = typeof window === "undefined"
    ? ""
    : window.btoa(unescape(encodeURIComponent(json)));

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function cloneUnknown<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function readLocalRowClipboard() {
  if (typeof window === "undefined") return null;

  const rawValue = window.localStorage.getItem(localRowClipboardKey);
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as LocalRowClipboardPayload;
    return parsed?.row_snapshot ? parsed : null;
  } catch {
    return null;
  }
}

function broadcastLocalRowClipboardChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(localRowClipboardEvent));
}

function cloneQuotationRowForSection(
  workspace: LocalQuotationWorkspace,
  source: LocalQuotationItem,
  destinationSectionId: string | null,
) {
  const sourceItemId = source.source_item_id ?? source.id;
  const nextSortOrder = (orderedItems(workspace.items, destinationSectionId).at(-1)?.sort_order ?? 0) + 10;
  const now = localNow();
  const rowSnapshot = cloneUnknown(source);

  return {
    ...rowSnapshot,
    id: createLocalId("local-item"),
    quotation_id: workspace.server_quotation_id,
    section_id: destinationSectionId,
    source_item_id: sourceItemId,
    sort_order: nextSortOrder,
    is_active: true,
    created_at: now,
    updated_at: now,
  } satisfies LocalQuotationItem;
}

function withReindexedSectionItems(
  items: LocalQuotationItem[],
  sectionId: string | null,
  insertAtIndex: number,
  nextItem: LocalQuotationItem,
) {
  const sectionItems = orderedItems(items, sectionId);
  const clampedIndex = Math.max(0, Math.min(insertAtIndex, sectionItems.length));
  const nextSectionItems = [...sectionItems];
  nextSectionItems.splice(clampedIndex, 0, nextItem);

  const nextSortById = new Map(
    nextSectionItems.map((item, index) => [item.id, (index + 1) * 10]),
  );

  return items
    .filter((item) => item.section_id !== sectionId)
    .concat(
      nextSectionItems.map((item) => ({
        ...item,
        sort_order: nextSortById.get(item.id) ?? item.sort_order,
      })),
    );
}

function statusText(workspace: LocalQuotationWorkspace, localDraftSaved: boolean, saveState: string) {
  if (saveState === "saving") return "Saving to software...";
  if (saveState === "saved") return "Saved to software";
  if (saveState === "error") return "Save failed / Retry";
  if (workspace.has_unsaved_changes) return localDraftSaved ? "Unsaved local changes" : "Saving local draft...";
  if (workspace.last_saved_to_software_at) return "Saved to software";
  return localDraftSaved ? "Local draft saved" : "Saving local draft...";
}

function LocalServerViewLink({
  children,
  disabled,
  href,
  primary = false,
  target,
}: {
  children: ReactNode;
  disabled: boolean;
  href: string;
  primary?: boolean;
  target?: string;
}) {
  const enabledClassName = primary
    ? "bg-emerald-900 text-white transition hover:bg-emerald-800"
    : "border border-zinc-300 bg-white text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900";
  const disabledClassName = primary
    ? "cursor-not-allowed bg-zinc-300 text-zinc-600"
    : "cursor-not-allowed border border-zinc-200 bg-zinc-100 text-zinc-400";
  const className = `px-3 py-2 text-xs font-semibold ${disabled ? disabledClassName : enabledClassName}`;

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={className}
        title="Save to Software before opening server-based preview or download."
      >
        {children}
      </span>
    );
  }

  return (
    <Link href={href} target={target} className={className}>
      {children}
    </Link>
  );
}

function moveSortOrder<T extends { id: string; sort_order: number }>(rows: T[], id: string, direction: -1 | 1) {
  const ordered = [...rows].sort((left, right) => left.sort_order - right.sort_order);
  const currentIndex = ordered.findIndex((row) => row.id === id);
  if (currentIndex < 0) return rows;

  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= ordered.length) return rows;

  const current = ordered[currentIndex];
  const target = ordered[targetIndex];

  return rows.map((row) => {
    if (row.id === current.id) return { ...row, sort_order: target.sort_order };
    if (row.id === target.id) return { ...row, sort_order: current.sort_order };
    return row;
  });
}

function SheetInfo({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="grid grid-cols-[92px_1fr] border-b border-zinc-200 text-xs">
      <span className="bg-zinc-50 px-2 py-1.5 font-semibold uppercase text-zinc-500">{label}</span>
      <span className="px-2 py-1.5 text-zinc-800">{value || "-"}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold capitalize text-zinc-700">
      {statusLabel(status)}
    </span>
  );
}

function sectionTitleClass(section: LocalQuotationSection) {
  if (section.section_kind === "main") {
    return "bg-zinc-900 text-center text-base font-bold text-white";
  }

  return "bg-zinc-100 text-xs font-bold text-zinc-800";
}

function itemTypeDisplay(item: LocalQuotationItem) {
  if (item.line_style === "note" || item.item_type === "note") return "note";
  if (item.line_style === "blank" || item.item_type === "blank") return "blank";
  return "item";
}

function mergeModeForItem(item: LocalQuotationItem) {
  const cellLayout = item.cell_layout as { mergeMode?: string } | null | undefined;
  if (cellLayout?.mergeMode === "merge_specification" || cellLayout?.mergeMode === "merge_full_row") {
    return cellLayout.mergeMode;
  }

  return "none";
}

function isSerialCountedLine(item: LocalQuotationItem) {
  return !["heading", "note", "no_quote"].includes(item.line_style) &&
    !["heading", "note", "blank", "subtotal"].includes(item.item_type);
}

const DEFAULT_ITEM_ROW_MIN_HEIGHT = 132;

function itemRowMinHeight(rowHeight: number | null | undefined) {
  if (typeof rowHeight !== "number" || !Number.isFinite(rowHeight)) {
    return DEFAULT_ITEM_ROW_MIN_HEIGHT;
  }

  return Math.max(rowHeight, DEFAULT_ITEM_ROW_MIN_HEIGHT);
}

function rowContentHeight(rowHeight: number | null | undefined, fallback: number) {
  return Math.max(itemRowMinHeight(rowHeight) - 18, fallback);
}

function LocalAutoResizeTextarea({
  className,
  onChange,
  placeholder,
  value,
}: {
  className?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={className ?? ""}
    />
  );
}

function sourceSnapshotRecord(item: LocalQuotationItem) {
  return recordEntries(item.source_component_data);
}

function firstNonEmptyValue(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function localDimensionValue(item: LocalQuotationItem) {
  const source = sourceSnapshotRecord(item);
  const desking = recordEntries(source.desking);

  return firstNonEmptyValue(
    item.size_snapshot,
    stringValue(source, "dimension"),
    stringValue(source, "dimensions"),
    stringValue(source, "dimension_label"),
    stringValue(source, "size"),
    stringValue(source, "size_label"),
    stringValue(source, "selected_size"),
    stringValue(source, "selectedSize"),
    stringValue(desking, "dimension"),
    stringValue(desking, "size_label"),
  );
}

function specificationHasDimension(specification: string | null | undefined, dimension: string | null) {
  if (!dimension || !specification) return false;
  return specification.toLowerCase().includes(dimension.toLowerCase());
}

function localOriginDisplay(item: LocalQuotationItem) {
  const source = sourceSnapshotRecord(item);
  const selectedOptions = Array.isArray(item.selected_options_snapshot)
    ? item.selected_options_snapshot.map((entry) => recordEntries(entry))
    : [];
  const selectedOptionOrigin = selectedOptions
    .map((entry) =>
      firstNonEmptyValue(
        stringValue(entry, "origin"),
        stringValue(entry, "origin_country"),
        stringValue(entry, "country_of_origin"),
        stringValue(entry, "country"),
        stringValue(entry, "brand_origin"),
        stringValue(entry, "supplier_country"),
      ))
    .find(Boolean) ?? null;
  const brand = firstNonEmptyValue(
    item.brand_name_snapshot,
    stringValue(source, "brand_name"),
    stringValue(source, "brand"),
  );
  const origin = firstNonEmptyValue(
    item.origin_snapshot,
    stringValue(source, "origin"),
    stringValue(source, "origin_country"),
    stringValue(source, "country_of_origin"),
    stringValue(source, "country"),
    selectedOptionOrigin,
  );
  const supplier = firstNonEmptyValue(
    item.supplier_name_snapshot,
    stringValue(source, "supplier_name"),
    stringValue(source, "supplier"),
    stringValue(source, "supplierName"),
    stringValue(source, "manufacturer"),
  );
  return formatBrandOriginSupplier({
    brandName: brand,
    origin,
    supplier,
  });
}

function layoutColumnSettings(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is LocalLayoutColumnSetting =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as LocalLayoutColumnSetting).key === "string",
    );
}

function layoutColumnOrder(value: unknown) {
  const order = localLayoutSettings(value).columnOrder;
  if (!Array.isArray(order)) return [];
  return order.filter((entry): entry is string => typeof entry === "string" && Boolean(entry));
}

function orderedColumnsBySettings(columns: LocalBuilderColumn[], settingsValue: unknown) {
  const order = layoutColumnOrder(settingsValue);
  if (!order.length) {
    const defaultColumns = [...columns];
    const editIndex = defaultColumns.findIndex((column) => column.key === "edit");
    if (editIndex >= 0) {
      const [editColumn] = defaultColumns.splice(editIndex, 1);
      defaultColumns.push(editColumn);
    }
    return defaultColumns;
  }

  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const ordered = order
    .map((key) => columnsByKey.get(key))
    .filter((column): column is LocalBuilderColumn => Boolean(column));
  const orderedKeys = new Set(ordered.map((column) => column.key));

  const nextColumns = [
    ...ordered,
    ...columns.filter((column) => !orderedKeys.has(column.key)),
  ];
  const editIndex = nextColumns.findIndex((column) => column.key === "edit");
  if (editIndex >= 0) {
    const [editColumn] = nextColumns.splice(editIndex, 1);
    nextColumns.push(editColumn);
  }

  return nextColumns;
}

function normalizeInternalCustomColumnType(value: unknown): LocalInternalCustomColumnType {
  return value === "number" ? "number" : value === "date" ? "date" : "text";
}

function internalCustomColumnKey(columnId: string) {
  return `internal_custom:${columnId}`;
}

function normalizeCustomPrintableColumnType(value: unknown): LocalCustomPrintableColumnType {
  return value === "number"
    ? "number"
    : value === "percentage"
      ? "percentage"
      : value === "image"
        ? "image"
        : "text";
}

function printableCustomColumnKey(columnId: string) {
  return `custom_printable:${columnId}`;
}

function customPrintableColumns(settingsValue: unknown): LocalCustomPrintableColumn[] {
  const entries = localLayoutSettings(settingsValue).customPrintableColumns;
  if (!Array.isArray(entries)) return [];

  return (entries as unknown[])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const id = typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : createLocalId("printable-column");
      const label = typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : "Printable Column";

      return {
        id,
        label,
        type: normalizeCustomPrintableColumnType(entry.type),
        width: typeof entry.width === "number" ? clampColumnWidth(entry.width) : 160,
        showInClient: entry.showInClient !== false,
        showInInternal: entry.showInInternal !== false,
      };
    });
}

function customPrintableColumnTableColumn(column: LocalCustomPrintableColumn): LocalBuilderColumn {
  return {
    key: printableCustomColumnKey(column.id),
    label: column.label,
    defaultWidth: column.width ?? 160,
    align: column.type === "number" || column.type === "percentage" ? "center" : "left",
    defaultVisible: true,
    customPrintableColumnId: column.id,
    customPrintableColumnType: column.type,
  };
}

function internalCustomColumns(settingsValue: unknown): LocalInternalCustomColumn[] {
  const entries = localLayoutSettings(settingsValue).internalColumns;
  if (!Array.isArray(entries)) return [];

  return (entries as unknown[])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const id = typeof entry.id === "string" && entry.id.trim()
        ? entry.id.trim()
        : createLocalId("internal-column");
      const label = typeof entry.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : "Internal Column";
      return {
        id,
        label,
        type: normalizeInternalCustomColumnType(entry.type),
        width: typeof entry.width === "number" ? clampColumnWidth(entry.width) : undefined,
        visible: entry.visible !== false,
      };
    });
}

function customInternalColumnTableColumn(column: LocalInternalCustomColumn) {
  return {
    key: internalCustomColumnKey(column.id),
    label: column.label,
    defaultWidth: column.width ?? 180,
    align: column.type === "number" ? "center" as const : "left" as const,
    defaultVisible: column.visible !== false,
    internalCustomColumnId: column.id,
    internalCustomColumnType: column.type,
  };
}

function updateItemMergeMode(item: LocalQuotationItem, mergeMode: string): LocalQuotationItem {
  const currentLayout = (item.cell_layout as Record<string, unknown> | null | undefined) ?? {};
  return {
    ...item,
    cell_layout: {
      ...currentLayout,
      mergeMode,
    },
  };
}

function finishSnapshotValue(finishes: FinishSelectionEditorRow[]) {
  const visibleFinishes = finishes.filter((finish) => finish.show_in_quotation === true);

  if (!visibleFinishes.length) return null;

  const groups = new Map<string, { label: string; items: string[] }>();

  visibleFinishes.forEach((finish, index) => {
    const groupKey =
      finish.product_template_material_group_id ||
      finish.material_group_id ||
      finish.group_label ||
      `group-${index}`;
    const groupLabel = finish.group_label || "Finish";
    const itemLabel = [finish.finish_code, finish.finish_name].filter(Boolean).join(" ").trim() ||
      finish.finish_description ||
      "Selected finish";
    const existing = groups.get(groupKey);

    if (existing) {
      existing.items.push(itemLabel);
      return;
    }

    groups.set(groupKey, {
      label: groupLabel,
      items: [itemLabel],
    });
  });

  return Array.from(groups.values())
    .map((group) => `${group.label}: ${group.items.join(", ")}`)
    .join("\n");
}

function sourceLibrarySummary(item: LocalQuotationItem) {
  const source = (item.source_component_data ?? {}) as Record<string, unknown>;
  const templateName = stringValue(source, "template_name");
  const templateCode = stringValue(source, "template_code");
  const selectedOptions = Array.isArray(source.selected_options)
    ? source.selected_options.filter((value): value is string => typeof value === "string" && Boolean(value))
    : [];
  const selectedOptionIds = Array.isArray(source.selected_option_ids)
    ? source.selected_option_ids.filter((value): value is string => typeof value === "string" && Boolean(value))
    : [];

  return {
    templateCode,
    templateName,
    selectedOptions,
    selectedOptionIds,
  };
}

function recordEntries(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function stableSerialize(value: unknown) {
  return JSON.stringify(value);
}

function cleanInlineValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function valuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    return stableSerialize(left) === stableSerialize(right);
  }
  return false;
}

function sourceSnapshotDetails(item: LocalQuotationItem) {
  const source = recordEntries(item.source_component_data);
  const sourcePriceReference = recordEntries(source.source_price_reference);
  const currencyConversion = recordEntries(source.currency_conversion);
  const linkedProducts = recordEntries(source.linked_products);
  const addOns = recordEntries(source.add_ons);
  const selectedOptionsSnapshot = Array.isArray(item.selected_options_snapshot)
    ? item.selected_options_snapshot
    : [];
  const accessoryGroups = Array.isArray(addOns.groups) ? addOns.groups : [];
  const linkedItems = Array.isArray(linkedProducts.items) ? linkedProducts.items : [];
  const selectedOptionNames = selectedOptionsSnapshot
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const record = recordEntries(entry);
      const parts = [
        stringValue(record, "label"),
        stringValue(record, "item_name"),
        stringValue(record, "template_name"),
        stringValue(record, "selected_category"),
        stringValue(record, "selected_variant"),
      ].filter(Boolean);
      return parts.join(" / ");
    })
    .filter(Boolean);
  const sourceTotals = recordEntries(sourcePriceReference.original_source_totals);
  const sourceTotalsSummary = Object.entries(sourceTotals)
    .map(([currency, amount]) => `${currency} ${stringValue({ value: amount }, "value")}`)
    .filter(Boolean);
  const exchangeRates = recordEntries(currencyConversion.exchange_rates);
  const exchangeRatesSummary = Object.entries(exchangeRates)
    .map(([currency, rate]) => `${currency}: ${stringValue({ value: rate }, "value")}`)
    .filter(Boolean);

  return {
    accessorySummary: accessoryGroups
      .map((group) => {
        const groupRecord = recordEntries(group);
        const items = Array.isArray(groupRecord.items) ? groupRecord.items : [];
        const names = items
          .map((entry) => {
            const itemRecord = recordEntries(entry);
            const qty = typeof itemRecord.qty === "number" ? ` x${itemRecord.qty}` : "";
            return `${stringValue(itemRecord, "item_name")}${qty}`.trim();
          })
          .filter(Boolean);
        const groupName = stringValue(groupRecord, "group_name") || "Accessories";
        return names.length ? `${groupName}: ${names.join(", ")}` : "";
      })
      .filter(Boolean),
    linkedFamilySummary: linkedItems
      .map((entry) => {
        const record = recordEntries(entry);
        const label = stringValue(record, "label") || stringValue(record, "template_name");
        const variant = stringValue(record, "selected_variant");
        const category = stringValue(record, "selected_category");
        const dimension = stringValue(record, "dimension");
        const qty = stringValue(record, "qty");
        const unitPrice = stringValue(record, "unit_price");
        const currency = stringValue(record, "currency");
        const accessorySummary = Array.isArray(record.accessories)
          ? record.accessories
              .map((accessory) => {
                const accessoryRecord = recordEntries(accessory);
                return `${stringValue(accessoryRecord, "item_name")} x${stringValue(accessoryRecord, "qty")}`;
              })
              .filter(Boolean)
              .join(", ")
          : "";
        return [
          [label, variant, category, dimension].filter(Boolean).join(" / "),
          qty ? `Qty ${qty}` : "",
          unitPrice ? `${currency || item.currency || "AED"} ${unitPrice}` : "",
          accessorySummary ? `Accessories: ${accessorySummary}` : "",
        ].filter(Boolean).join(" | ");
      })
      .filter(Boolean),
    model: item.model_snapshot || stringValue(source, "template_name"),
    selectedOptionNames,
    size: item.size_snapshot || stringValue(recordEntries(source.desking), "dimension"),
    sourceCurrency: stringValue(sourcePriceReference, "original_source_currency") || stringValue(sourcePriceReference, "quotation_currency"),
    sourcePrice: stringValue(sourcePriceReference, "original_source_price") || stringValue(sourcePriceReference, "converted_quotation_price"),
    sourceTotalsSummary,
    convertedQuotePrice: stringValue(sourcePriceReference, "converted_quotation_price"),
    quoteCurrency: stringValue(sourcePriceReference, "quotation_currency") || item.currency || "AED",
    sourcePriceLabel: stringValue(sourcePriceReference, "source_price_label"),
    sourcePriceType: stringValue(sourcePriceReference, "source_price_type"),
    exchangeRatesSummary,
    convertedTotalAed: stringValue(currencyConversion, "converted_total_aed"),
  };
}

function finishSelectionRows(value: unknown): FinishSelectionEditorRow[] {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is FinishSelectionEditorRow => typeof entry === "object" && entry !== null);
}

function rowLocalStatus(
  itemId: string,
  recentEditedRowId: string | null,
  localDraftSaved: boolean,
  workspaceDirty: boolean,
) {
  if (workspaceDirty && recentEditedRowId === itemId) {
    return localDraftSaved ? "Unsaved local changes" : "Saving local draft...";
  }

  return "Saved locally";
}

function sectionSubtotal(items: LocalQuotationItem[]) {
  return exactMoneyValue(
    items
      .filter((item) => item.is_active !== false)
      .filter((item) => !item.is_rate_only)
      .filter((item) => !["note", "blank", "subtotal"].includes(item.item_type))
      .filter((item) => !["heading", "note", "no_quote"].includes(item.line_style))
      .reduce((total, item) => total + exactMoneyValue(item.net_total), 0),
  );
}

function localLayoutSettings(value: unknown): LocalLayoutSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as LocalLayoutSettings;
}

function specificationMetadataSettings(settingsValue: unknown) {
  const metadata = localLayoutSettings(settingsValue).specificationMetadata;

  return {
    title: metadata?.title !== false,
    size: metadata?.size !== false,
    finish: metadata?.finish === true,
    warranty: metadata?.warranty === true,
  };
}

function columnsForLayoutMode(layoutMode: string) {
  const standardProposal = [
    "manual_serial",
    "s_no",
    "code",
    "specified_image",
    "proposed_image",
    "specification",
    "origin",
    "model",
    "finish",
    "size",
    "warranty",
    "qty",
    "unit_price",
    "discount",
    "discount_percentage",
    "discount_amount",
    "net_price",
    "net_total",
    "supplier_name",
    "edit",
  ];
  const byLayout: Record<string, string[]> = {
    simple_proposal: [
      "manual_serial",
      "s_no",
      "code",
      "proposed_image",
      "specification",
      "qty",
      "unit_price",
      "net_total",
      "supplier_name",
      "edit",
    ],
    standard_proposal: standardProposal,
    comparison: [
      "manual_serial",
      "s_no",
      "specified_image",
      "proposed_image",
      "specification",
      "code",
      "qty",
      "unit_price",
      "discount",
      "discount_percentage",
      "discount_amount",
      "net_price",
      "net_total",
      "supplier_name",
      "edit",
    ],
    boq_schedule: [
      "manual_serial",
      "code",
      "specification",
      "model",
      "finish",
      "size",
      "origin",
      "warranty",
      "qty",
      "unit_price",
      "discount",
      "discount_percentage",
      "discount_amount",
      "net_price",
      "net_total",
      "supplier_name",
      "edit",
    ],
    internal_costing: standardProposal,
  };

  const selectedKeys = byLayout[layoutMode] ?? byLayout.standard_proposal;

  return selectedKeys.map((key): LocalBuilderColumn => {
    const baseColumn = allColumns.find((column) => column.key === key);
    if (!baseColumn) {
      throw new Error(`Unknown local quotation column: ${key}`);
    }

    if (key === "specification") {
      return {
        ...baseColumn,
        label: layoutMode === "boq_schedule" ? "Description" : "Specifications",
        defaultWidth: layoutMode === "standard_proposal" ? 500 : 420,
      };
    }

    if (key === "proposed_image" && layoutMode === "simple_proposal") {
      return {
        ...baseColumn,
        label: "Reference Image",
      };
    }

    if (key === "supplier_name") {
      return {
        ...baseColumn,
        defaultVisible: layoutMode === "internal_costing",
      };
    }

    return baseColumn;
  });
}

function columnByKey(key: string) {
  const column = allColumns.find((entry) => entry.key === key);
  if (!column) {
    throw new Error(`Unknown local quotation column: ${key}`);
  }

  return column;
}

function combineColumns(columns: LocalBuilderColumn[]) {
  const seen = new Set<string>();
  return columns.filter((column) => {
    if (seen.has(column.key)) return false;
    seen.add(column.key);
    return true;
  });
}

type LocalInternalItemMetadata = {
  internalNotes?: string | null;
  supplierNotes?: string | null;
  costPrice?: number | null;
  deliveryLeadTime?: string | null;
  internalStatus?: string | null;
  internalColumnValues?: Record<string, string | null>;
};

function customPrintableColumnValues(item: LocalQuotationItem) {
  const cellLayout = recordEntries(item.cell_layout);
  const printableValues = recordEntries(cellLayout.customPrintableColumnValues);

  return Object.fromEntries(
    Object.entries(printableValues).map(([key, value]) => {
      if (typeof value === "string") return [key, value];
      if (typeof value === "number" && Number.isFinite(value)) return [key, String(value)];
      return [key, ""];
    }),
  ) as Record<string, string>;
}

function internalMetadataTextValue(record: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return null;
  }

  const value = record[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function internalItemMetadata(item: LocalQuotationItem): LocalInternalItemMetadata {
  const cellLayout = recordEntries(item.cell_layout);
  const internal = recordEntries(cellLayout.internal);
  const costPrice = Number(internal.costPrice);
  const rawInternalColumnValues = recordEntries(internal.internalColumnValues);
  const internalColumnValues = Object.fromEntries(
    Object.entries(rawInternalColumnValues).map(([key, value]) => {
      if (typeof value === "string") return [key, value];
      if (typeof value === "number" && Number.isFinite(value)) return [key, String(value)];
      return [key, null];
    }),
  );

  return {
    internalNotes: internalMetadataTextValue(internal, "internalNotes") ?? item.notes ?? null,
    supplierNotes: internalMetadataTextValue(internal, "supplierNotes") ?? item.supplier_notes_snapshot ?? null,
    costPrice: Number.isFinite(costPrice) ? costPrice : (Number.isFinite(Number(item.internal_cost)) ? Number(item.internal_cost) : null),
    deliveryLeadTime: internalMetadataTextValue(internal, "deliveryLeadTime"),
    internalStatus: internalMetadataTextValue(internal, "internalStatus"),
    internalColumnValues,
  };
}

function updateItemInternalMetadata(
  item: LocalQuotationItem,
  patch: Partial<LocalInternalItemMetadata>,
): Partial<LocalQuotationItem> {
  const cellLayout = recordEntries(item.cell_layout);
  const internal = recordEntries(cellLayout.internal);
  const internalColumnValues = recordEntries(internal.internalColumnValues);

  return {
    ...(Object.prototype.hasOwnProperty.call(patch, "internalNotes")
      ? { notes: patch.internalNotes ?? null }
      : {}),
    cell_layout: {
      ...cellLayout,
      internal: {
        ...internal,
        ...(Object.prototype.hasOwnProperty.call(patch, "internalNotes")
          ? { internalNotes: patch.internalNotes ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "supplierNotes")
          ? { supplierNotes: patch.supplierNotes ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "costPrice")
          ? { costPrice: patch.costPrice ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "deliveryLeadTime")
          ? { deliveryLeadTime: patch.deliveryLeadTime ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "internalStatus")
          ? { internalStatus: patch.internalStatus ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, "internalColumnValues")
          ? {
            internalColumnValues: {
              ...internalColumnValues,
              ...patch.internalColumnValues,
            },
          }
          : {}),
      },
    },
  };
}

function internalCustomColumnValue(
  item: LocalQuotationItem,
  columnId: string,
) {
  return internalItemMetadata(item).internalColumnValues?.[columnId] ?? "";
}

function updateItemInternalCustomColumnValue(
  item: LocalQuotationItem,
  columnId: string,
  value: string,
): Partial<LocalQuotationItem> {
  return updateItemInternalMetadata(item, {
    internalColumnValues: {
      [columnId]: value,
    },
  });
}

function customPrintableColumnValue(
  item: LocalQuotationItem,
  columnId: string,
) {
  return customPrintableColumnValues(item)[columnId] ?? "";
}

function updateItemCustomPrintableColumnValue(
  item: LocalQuotationItem,
  columnId: string,
  value: string,
): Partial<LocalQuotationItem> {
  const cellLayout = recordEntries(item.cell_layout);
  const printableValues = recordEntries(cellLayout.customPrintableColumnValues);

  return {
    cell_layout: {
      ...cellLayout,
      customPrintableColumnValues: {
        ...printableValues,
        [columnId]: value,
      },
    },
  };
}

function internalMarginValues(netPrice: number, costPrice: number | null) {
  if (!Number.isFinite(Number(costPrice))) {
    return {
      amount: null,
      percent: null,
    };
  }

  const safeCostPrice = Number(costPrice);
  const amount = exactMoneyValue(netPrice - safeCostPrice);
  const percent = netPrice > 0
    ? exactMoneyValue(amount / netPrice * 100)
    : null;

  return {
    amount,
    percent,
  };
}

function exactMoneyValue(value: unknown) {
  const number = Number(value);
  const safeValue = Number.isFinite(number) ? number : 0;

  return Math.round(safeValue * 100) / 100;
}

function tableNumberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatTableNumber(value: unknown) {
  return tableNumberValue(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function formatWorkspaceMoney(currency: string | null | undefined, value: unknown) {
  return formatMoney(currency, exactMoneyValue(value), {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function normalizedRowQty(item: LocalQuotationItem, value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return item.item_type === "blank" || item.item_type === "note" ? 0 : 1;
  }

  const wholeNumber = Math.max(Math.round(parsed), 0);
  if (item.item_type === "blank" || item.item_type === "note") {
    return wholeNumber;
  }

  return Math.max(wholeNumber, 1);
}

function normalizedDiscountType(value: unknown) {
  return value === "percent" ? "percent" : value === "amount" ? "amount" : "none";
}

function readPriceRoundingMetadata(workspace: LocalQuotationWorkspace): PriceRoundingMetadata {
  const metadata = (workspace.metadata ?? {}) as Record<string, unknown>;
  const rounding = (metadata.price_rounding ?? {}) as Record<string, unknown>;
  const roundedNetPricesRecord = (rounding.rounded_net_prices ?? {}) as Record<string, unknown>;
  const roundedNetPrices = Object.fromEntries(
    Object.entries(roundedNetPricesRecord).filter(([, value]) => Number.isFinite(Number(value))),
  ) as Record<string, number>;

  return {
    rounded_net_prices: roundedNetPrices,
    step: Number.isFinite(Number(rounding.step)) ? Number(rounding.step) : null,
    last_applied_step: Number.isFinite(Number(rounding.last_applied_step)) ? Number(rounding.last_applied_step) : null,
    applied_at: typeof rounding.applied_at === "string" ? rounding.applied_at : null,
    mode: "nearest",
  };
}

function withPriceRoundingMetadata(workspace: LocalQuotationWorkspace, nextRounding: PriceRoundingMetadata): LocalQuotationWorkspace {
  const currentMetadata = (workspace.metadata ?? {}) as Record<string, unknown>;
  return {
    ...workspace,
    metadata: {
      ...currentMetadata,
      price_rounding: nextRounding,
    },
  };
}

function roundToNearestStep(value: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return exactMoneyValue(value);
  return exactMoneyValue(Math.round(value / step) * step);
}

function InsertSectionRow({
  canManage,
  onAddMain,
  onAddSub,
  totalColumns,
}: {
  canManage: boolean;
  onAddMain: () => void;
  onAddSub: () => void;
  totalColumns: number;
}) {
  if (!canManage) return null;

  return (
    <tr>
      <td colSpan={totalColumns} className="border-0 bg-white px-3 py-2">
        <div className="flex items-center gap-3 text-[11px] font-semibold text-zinc-500">
          <span className="h-px flex-1 bg-zinc-200" />
          <div className="flex flex-wrap items-center gap-2 border border-dashed border-zinc-300 bg-white px-3 py-1">
            <span>+ Add section here</span>
            <button type="button" onClick={onAddSub} className="border border-zinc-300 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-700 hover:border-emerald-900 hover:text-emerald-900">Sub Section</button>
            <button type="button" onClick={onAddMain} className="border border-zinc-300 bg-zinc-50 px-2 py-1 text-[10px] text-zinc-700 hover:border-emerald-900 hover:text-emerald-900">Main Section</button>
          </div>
          <span className="h-px flex-1 bg-zinc-200" />
        </div>
      </td>
    </tr>
  );
}

function SectionTotalRow({ currency, total, totalColumns }: { currency: string; total: number; totalColumns: number }) {
  return (
    <tr>
      <td colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-zinc-700">
        <span className="mr-4 text-zinc-500">Section Total</span>
        <span className="text-zinc-950">{formatWorkspaceMoney(currency, total)}</span>
      </td>
    </tr>
  );
}

function MainSectionTotalRow({ currency, label, total, totalColumns }: { currency: string; label: string; total: number; totalColumns: number }) {
  return (
    <tr>
      <td colSpan={totalColumns} className="border border-zinc-950 bg-zinc-950 px-3 py-2 text-right text-sm font-bold uppercase tracking-wide text-white">
        <span className="mr-4">{label || "Main Section"} Total</span>
        <span>{formatWorkspaceMoney(currency, total)}</span>
      </td>
    </tr>
  );
}

export function LocalQuotationBuilder({
  canManageProductLibrary,
  clientName,
  initialWorkspace,
  materialGroups,
  materials,
  productBrands,
  productCategories,
  productComponents,
  productLinkedFamilies,
  productTemplates,
  projectName,
  templateMaterialGroupItems,
  templateMaterialGroups,
}: {
  canManageProductLibrary: boolean;
  clientName: string;
  initialWorkspace: LocalQuotationWorkspace;
  materialGroups: FinishMaterialGroup[];
  materials: FinishMaterial[];
  productBrands: ProductLibraryBrand[];
  productCategories: ProductLibraryCategory[];
  productComponents: ProductLibraryComponent[];
  productLinkedFamilies: ProductLibraryLinkedFamily[];
  productTemplates: ProductLibraryTemplate[];
  projectName: string;
  templateMaterialGroupItems: ProductTemplateMaterialGroupItemLink[];
  templateMaterialGroups: ProductTemplateMaterialGroupLink[];
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [historyPast, setHistoryPast] = useState<LocalQuotationWorkspace[]>([]);
  const [historyFuture, setHistoryFuture] = useState<LocalQuotationWorkspace[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [localDraftSaved, setLocalDraftSaved] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [view, setView] = useState<BuilderView>("client");
  const [recentEditedRowId, setRecentEditedRowId] = useState<string | null>(null);
  const [editingOriginCellId, setEditingOriginCellId] = useState<string | null>(null);
  const [detailsModalRowId, setDetailsModalRowId] = useState<string | null>(null);
  const [saveLibraryChoiceRowId, setSaveLibraryChoiceRowId] = useState<string | null>(null);
  const [saveLibraryMode, setSaveLibraryMode] = useState<"new" | "existing">("new");
  const [saveLibraryTemplateSearch, setSaveLibraryTemplateSearch] = useState("");
  const [saveLibraryTemplateId, setSaveLibraryTemplateId] = useState("");
  const [quoteDetailsOpen, setQuoteDetailsOpen] = useState(false);
  const [addInternalColumnOpen, setAddInternalColumnOpen] = useState(false);
  const [newInternalColumnName, setNewInternalColumnName] = useState("");
  const [newInternalColumnType, setNewInternalColumnType] = useState<LocalInternalCustomColumnType>("text");
  const [addPrintableColumnOpen, setAddPrintableColumnOpen] = useState(false);
  const [newPrintableColumnName, setNewPrintableColumnName] = useState("");
  const [newPrintableColumnType, setNewPrintableColumnType] = useState<LocalCustomPrintableColumnType>("text");
  const [newPrintableColumnWidth, setNewPrintableColumnWidth] = useState("160");
  const [newPrintableColumnShowInClient, setNewPrintableColumnShowInClient] = useState(true);
  const [newPrintableColumnShowInInternal, setNewPrintableColumnShowInInternal] = useState(true);
  const [roundingStepInput, setRoundingStepInput] = useState("5");
  const [copiedRowClipboard, setCopiedRowClipboard] = useState<LocalRowClipboardPayload | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const importRef = useRef<HTMLInputElement | null>(null);
  const columnSettingsRef = useRef<HTMLDetailsElement | null>(null);
  const lastPersistedSignatureRef = useRef<string | null>(null);
  const historyGroupRef = useRef<{ key: string; timestamp: number } | null>(null);
  const clientSnapshot = (workspace.client_snapshot ?? {}) as Record<string, unknown>;
  const projectSnapshot = (workspace.project_snapshot ?? {}) as Record<string, unknown>;
  const currentClientName = clientName || stringValue(clientSnapshot, "company_name") || "Unknown client";
  const currentProjectName = stringValue(projectSnapshot, "project_name") || projectName || "Unknown project";
  const workspaceSignature = useMemo(() => stableSerialize(workspace), [workspace]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const existing = await getWorkspaceDocument(initialWorkspace.server_quotation_id);

      if (cancelled) return;

      if (existing) {
        lastPersistedSignatureRef.current = stableSerialize(existing);
        setWorkspace(existing);
        setHistoryPast([]);
        setHistoryFuture([]);
        historyGroupRef.current = null;
        setLocalDraftSaved(true);
      } else {
        await saveWorkspaceDocument(initialWorkspace);
        lastPersistedSignatureRef.current = stableSerialize(initialWorkspace);
        setHistoryPast([]);
        setHistoryFuture([]);
        historyGroupRef.current = null;
        if (!cancelled) setLocalDraftSaved(true);
      }

      if (!cancelled) setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialWorkspace]);

  useEffect(() => {
    if (!hydrated) return;
    if (workspaceSignature === lastPersistedSignatureRef.current) return;

    const timeout = window.setTimeout(() => {
      void saveWorkspaceDocument(workspace).then(() => {
        lastPersistedSignatureRef.current = workspaceSignature;
        setLocalDraftSaved(true);
      });
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [hydrated, workspace, workspaceSignature]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!workspace.has_unsaved_changes) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [workspace.has_unsaved_changes]);

  useEffect(() => {
    function syncClipboard() {
      setCopiedRowClipboard(readLocalRowClipboard());
    }

    syncClipboard();
    window.addEventListener("storage", syncClipboard);
    window.addEventListener(localRowClipboardEvent, syncClipboard);

    return () => {
      window.removeEventListener("storage", syncClipboard);
      window.removeEventListener(localRowClipboardEvent, syncClipboard);
    };
  }, []);

  const orderedSectionRows = useMemo(() => orderedSections(workspace.sections), [workspace.sections]);
  const sectionsById = useMemo(() => new Map(orderedSectionRows.map((section) => [section.id, section])), [orderedSectionRows]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, LocalQuotationSection[]>();
    for (const section of orderedSectionRows) {
      if (section.section_kind !== "sub" || !section.parent_section_id) continue;
      map.set(section.parent_section_id, [...(map.get(section.parent_section_id) ?? []), section]);
    }
    return map;
  }, [orderedSectionRows]);
  const displaySections = useMemo(() => {
    const rows: Array<LocalQuotationSection & { renderAsMainOnly?: boolean }> = [];

    for (const section of orderedSectionRows) {
      if (section.section_kind === "main") {
        rows.push({ ...section, renderAsMainOnly: true });
        for (const child of childrenByParent.get(section.id) ?? []) {
          rows.push(child);
        }
        continue;
      }

      if (section.parent_section_id && sectionsById.get(section.parent_section_id)?.section_kind === "main") {
        continue;
      }

      rows.push(section);
    }

    return rows;
  }, [childrenByParent, orderedSectionRows, sectionsById]);
  const sectionTotalById = useMemo(() => {
    const map = new Map<string, number>();
    for (const section of orderedSectionRows) {
      map.set(section.id, sectionSubtotal(orderedItems(workspace.items, section.id)));
    }
    return map;
  }, [orderedSectionRows, workspace.items]);
  const mainSectionTotalById = useMemo(() => {
    const map = new Map<string, number>();
    for (const section of orderedSectionRows.filter((entry) => entry.section_kind === "main")) {
      const children = childrenByParent.get(section.id) ?? [];
      const total = children.length
        ? children.reduce((sum, child) => sum + (sectionTotalById.get(child.id) ?? 0), 0)
        : sectionTotalById.get(section.id) ?? 0;
      map.set(section.id, total);
    }
    return map;
  }, [childrenByParent, orderedSectionRows, sectionTotalById]);

  const layoutSettings = localLayoutSettings(workspace.layout_settings);
  const layoutColumns = columnsForLayoutMode(workspace.layout_mode);
  const customPrintableColumnDefs = customPrintableColumns(workspace.layout_settings);
  const customInternalColumns = internalCustomColumns(workspace.layout_settings);
  const editColumn = layoutColumns.find((column) => column.key === "edit");
  const layoutColumnsWithoutEdit = layoutColumns.filter((column) => column.key !== "edit");
  const printableColumnsForView = customPrintableColumnDefs
    .filter((column) => view === "internal" ? column.showInInternal !== false : column.showInClient !== false)
    .map((column) => customPrintableColumnTableColumn(column));
  const activeColumns = orderedColumnsBySettings(combineColumns(
    view === "internal"
      ? [
        ...layoutColumnsWithoutEdit,
        ...printableColumnsForView,
        ...(editColumn ? [editColumn] : []),
        ...internalDefaultColumnKeys.map((key) => columnByKey(key)),
        ...customInternalColumns.map((column) => customInternalColumnTableColumn(column)),
        ...legacyInternalColumnKeys.map((key) => columnByKey(key)),
      ]
      : [
        ...layoutColumnsWithoutEdit,
        ...printableColumnsForView,
        ...(editColumn ? [editColumn] : []),
      ],
  ), workspace.layout_settings);
  const columnSettings = new Map(
    layoutColumnSettings(layoutSettings.columns).map((column) => [column.key, column])
  );
  const metadataSettings = specificationMetadataSettings(layoutSettings);

  const visibleColumns = activeColumns.map(c => ({
    ...c,
    width: columnSettings.get(c.key)?.width ?? c.defaultWidth,
    visible: columnSettings.get(c.key)?.visible ?? c.defaultVisible ?? true,
  })).filter(c => c.visible);
  const visibleColumnKeys = new Set(visibleColumns.map((column) => column.key));
  const activeColumnByKey = new Map(activeColumns.map((column) => [column.key, column]));

  const tableWidth = visibleColumns.reduce((sum, c) => sum + c.width, 0);
  const totalColumns = visibleColumns.length;
  const sheetColumns = visibleColumns.map((column) => ({ key: column.key, width: column.width }));
  const sheetColumnSignature = sheetColumns.map((column) => `${column.key}:${column.width}`).join("|");
  const isColVisible = (key: string) => visibleColumns.some(c => c.key === key);
  const detailsModalItem = detailsModalRowId
    ? workspace.items.find((item) => item.id === detailsModalRowId) ?? null
    : null;
  const saveLibraryChoiceItem = saveLibraryChoiceRowId
    ? workspace.items.find((item) => item.id === saveLibraryChoiceRowId) ?? null
    : null;
  const priceRoundingMetadata = readPriceRoundingMetadata(workspace);
  const filteredLibraryTemplates = useMemo(() => {
    const query = saveLibraryTemplateSearch.trim().toLowerCase();
    if (!query) {
      return productTemplates.slice(0, 100);
    }

    return productTemplates.filter((template) =>
      [
        template.template_name,
        template.template_code,
        template.item_code,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    ).slice(0, 100);
  }, [productTemplates, saveLibraryTemplateSearch]);
  let runningSerialNumber = 0;

  function updateColumnSetting(key: string, patch: { visible?: boolean; width?: number }) {
    commit((current) => {
      const currentLayout = (current.layout_settings as Record<string, unknown>) || {};
      const currentCols = layoutColumnSettings(currentLayout.columns);
      const existingIndex = currentCols.findIndex((column) => column.key === key);
      const nextCols = [...currentCols];
      const normalizedPatch = {
        ...patch,
        width: typeof patch.width === "number" ? clampColumnWidth(patch.width) : patch.width,
      };
      if (existingIndex >= 0) {
        nextCols[existingIndex] = { ...nextCols[existingIndex], ...normalizedPatch };
      } else {
        nextCols.push({ key, ...normalizedPatch });
      }
      return { ...current, layout_settings: { ...currentLayout, columns: nextCols } };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function moveColumnOrder(key: string, direction: -1 | 1) {
    if (key === "edit") return;
    const activeKeys = activeColumns.map((column) => column.key);
    const currentIndex = activeKeys.indexOf(key);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeKeys.length) return;

    const nextActiveKeys = [...activeKeys];
    const [movedKey] = nextActiveKeys.splice(currentIndex, 1);
    nextActiveKeys.splice(targetIndex, 0, movedKey);

    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      const existingOrder = layoutColumnOrder(current.layout_settings).filter((entry) => !nextActiveKeys.includes(entry));
      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          columnOrder: [...nextActiveKeys, ...existingOrder],
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function updateInternalCustomColumn(
    columnId: string,
    patch: Partial<LocalInternalCustomColumn>,
  ) {
    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      const currentColumns = internalCustomColumns(current.layout_settings);
      const nextColumns = currentColumns.map((column) => {
        if (column.id !== columnId) return column;

        return {
          ...column,
          ...patch,
          label: typeof patch.label === "string" ? patch.label : column.label,
          type: patch.type ? normalizeInternalCustomColumnType(patch.type) : column.type,
          width: typeof patch.width === "number"
            ? clampColumnWidth(patch.width)
            : patch.width === undefined
              ? column.width
              : undefined,
        };
      });

      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          internalColumns: nextColumns,
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function updateCustomPrintableColumn(
    columnId: string,
    patch: Partial<LocalCustomPrintableColumn>,
  ) {
    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      const currentColumns = customPrintableColumns(current.layout_settings);
      const nextColumns = currentColumns.map((column) => {
        if (column.id !== columnId) return column;

        return {
          ...column,
          ...patch,
          label: typeof patch.label === "string" ? patch.label : column.label,
          type: patch.type ? normalizeCustomPrintableColumnType(patch.type) : column.type,
          width: typeof patch.width === "number"
            ? clampColumnWidth(patch.width)
            : patch.width === undefined
              ? column.width
              : undefined,
        };
      });

      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          customPrintableColumns: nextColumns,
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function removeCustomPrintableColumn(columnId: string) {
    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          customPrintableColumns: customPrintableColumns(current.layout_settings).filter((column) => column.id !== columnId),
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function removeInternalCustomColumn(columnId: string) {
    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          internalColumns: internalCustomColumns(current.layout_settings).filter((column) => column.id !== columnId),
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function createInternalCustomColumn() {
    const label = newInternalColumnName.trim();
    if (!label) return;

    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      const nextColumn: LocalInternalCustomColumn = {
        id: createLocalId("internal-column"),
        label,
        type: newInternalColumnType,
        width: 180,
        visible: true,
      };

      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          internalColumns: [
            ...internalCustomColumns(current.layout_settings),
            nextColumn,
          ],
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });

    setNewInternalColumnName("");
    setNewInternalColumnType("text");
    setAddInternalColumnOpen(false);
    setView("internal");
  }

  function createPrintableCustomColumn() {
    const label = newPrintableColumnName.trim();
    if (!label) return;

    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      const nextColumn: LocalCustomPrintableColumn = {
        id: createLocalId("printable-column"),
        label,
        type: newPrintableColumnType,
        width: clampColumnWidth(Number(newPrintableColumnWidth) || 160),
        showInClient: newPrintableColumnShowInClient,
        showInInternal: newPrintableColumnShowInInternal,
      };

      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          customPrintableColumns: [
            ...customPrintableColumns(current.layout_settings),
            nextColumn,
          ],
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });

    setNewPrintableColumnName("");
    setNewPrintableColumnType("text");
    setNewPrintableColumnWidth("160");
    setNewPrintableColumnShowInClient(true);
    setNewPrintableColumnShowInInternal(true);
    setAddPrintableColumnOpen(false);
  }

  function saveColumnSettingsPanel() {
    setSaveMessage("Column settings saved locally");
    window.setTimeout(() => setSaveMessage((current) => current === "Column settings saved locally" ? "" : current), 1800);
    if (columnSettingsRef.current) {
      columnSettingsRef.current.open = false;
    }
  }

  function updateSpecificationMetadataSetting(key: LocalSpecificationMetadataKey, checked: boolean) {
    commit((current) => {
      const currentLayout = localLayoutSettings(current.layout_settings);
      return {
        ...current,
        layout_settings: {
          ...currentLayout,
          specificationMetadata: {
            ...(currentLayout.specificationMetadata ?? {}),
            [key]: checked,
          },
        },
      };
    }, { groupKey: "layout-settings", mode: "merge" });
  }

  function updateRowHeight(type: "item" | "section", id: string, height: number) {
    const nextHeight = clampRowHeight(height);
    if (type === "section") {
      updateSection(id, { row_height: nextHeight });
      return;
    }

    updateItem(id, { row_height: nextHeight });
  }

  function commit(
    next: LocalQuotationWorkspace | ((current: LocalQuotationWorkspace) => LocalQuotationWorkspace),
    options: HistoryCommitOptions = {},
  ) {
    setLocalDraftSaved(false);
    const mode = options.mode ?? "push";
    const now = Date.now();
    setWorkspace((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (mode !== "skip") {
        const currentHistoryGroup = historyGroupRef.current;
        const canMerge =
          mode === "merge" &&
          Boolean(options.groupKey) &&
          currentHistoryGroup !== null &&
          currentHistoryGroup.key === options.groupKey &&
          now - currentHistoryGroup.timestamp <= localHistoryMergeWindowMs;

        if (!canMerge) {
          setHistoryPast((previous) => [
            ...previous.slice(-(localHistoryLimit - 1)),
            cloneUnknown(current),
          ]);
        }

        setHistoryFuture([]);
        historyGroupRef.current =
          mode === "merge" && options.groupKey
            ? (canMerge
              ? historyGroupRef.current
              : { key: options.groupKey, timestamp: now })
            : null;
      }
      const stamped = { ...resolved, has_unsaved_changes: true, updated_at: localNow() };
      return recalculateWorkspace(stamped);
    });
    setSaveState("idle");
    setSaveMessage("");
  }

  function restoreWorkspaceFromHistory(nextWorkspace: LocalQuotationWorkspace) {
    historyGroupRef.current = null;
    setLocalDraftSaved(false);
    setSaveState("idle");
    setSaveMessage("");
    setWorkspace(recalculateWorkspace({
      ...cloneUnknown(nextWorkspace),
      has_unsaved_changes: true,
      updated_at: localNow(),
    }));
  }

  function undoLastChange() {
    if (!historyPast.length) return;

    const previousWorkspace = historyPast[historyPast.length - 1];
    setHistoryPast((current) => current.slice(0, -1));
    setHistoryFuture((current) => [cloneUnknown(workspace), ...current]);
    restoreWorkspaceFromHistory(previousWorkspace);
  }

  function redoLastChange() {
    if (!historyFuture.length) return;

    const [nextWorkspace, ...remainingFuture] = historyFuture;
    setHistoryFuture(remainingFuture);
    setHistoryPast((current) => [
      ...current.slice(-(localHistoryLimit - 1)),
      cloneUnknown(workspace),
    ]);
    restoreWorkspaceFromHistory(nextWorkspace);
  }

  async function saveLocalDraftNow(rowId?: string) {
    try {
      await saveWorkspaceDocument(workspace);
      lastPersistedSignatureRef.current = workspaceSignature;
      setLocalDraftSaved(true);
      if (rowId) setRecentEditedRowId(rowId);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Local draft save failed.");
    }
  }

  function updateItem(itemId: string, patch: LocalQuotationItemPatch) {
    const currentItem = workspace.items.find((item) => item.id === itemId);
    if (!currentItem) return;
    const normalizedPatch = { ...patch };

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "qty")) {
      normalizedPatch.qty = normalizedRowQty(currentItem, normalizedPatch.qty);
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "unit_price")) {
      normalizedPatch.unit_price = exactMoneyValue(Math.max(tableNumberValue(normalizedPatch.unit_price), 0));
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "discount_type")) {
      normalizedPatch.discount_type = normalizedDiscountType(normalizedPatch.discount_type);
      if (normalizedPatch.discount_type === "none") {
        normalizedPatch.discount_value = 0;
      }
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "discount_value")) {
      normalizedPatch.discount_value = exactMoneyValue(Math.max(tableNumberValue(normalizedPatch.discount_value), 0));
    }

    const committedPatch = normalizedPatch as Partial<LocalQuotationItem>;

    const hasMeaningfulChange = Object.entries(committedPatch).some(([key, value]) =>
      !valuesEqual(currentItem[key as keyof LocalQuotationItem], value),
    );

    if (!hasMeaningfulChange) return;

    setRecentEditedRowId(itemId);
    commit((current) => {
      const nextWorkspace = {
        ...current,
        items: current.items.map((item) => (item.id === itemId ? { ...item, ...committedPatch, updated_at: localNow() } : item)),
      };

      if (
        !Object.prototype.hasOwnProperty.call(committedPatch, "unit_price") &&
        !Object.prototype.hasOwnProperty.call(committedPatch, "discount_type") &&
        !Object.prototype.hasOwnProperty.call(committedPatch, "discount_value") &&
        !Object.prototype.hasOwnProperty.call(committedPatch, "qty")
      ) {
        return nextWorkspace;
      }

      const roundingMetadata = readPriceRoundingMetadata(current);
      const nextRoundedNetPrices = { ...(roundingMetadata.rounded_net_prices ?? {}) };
      delete nextRoundedNetPrices[itemId];

      return withPriceRoundingMetadata(nextWorkspace, {
        ...roundingMetadata,
        rounded_net_prices: nextRoundedNetPrices,
      });
    }, { groupKey: `item:${itemId}`, mode: "merge" });
  }

  function updateSection(sectionId: string, patch: Partial<LocalQuotationSection>) {
    commit((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    }), { groupKey: `section:${sectionId}`, mode: "merge" });
  }

  function updateQuotationDetails(patch: Partial<LocalQuotationWorkspace>) {
    commit((current) => ({
      ...current,
      ...patch,
    }), { groupKey: "quote-details", mode: "merge" });
  }

  function updateProjectSnapshot(patch: Record<string, string | null>) {
    commit((current) => ({
      ...current,
      project_snapshot: {
        ...((current.project_snapshot ?? {}) as Record<string, unknown>),
        ...patch,
      },
    }), { groupKey: "quote-details", mode: "merge" });
  }

  function addSection(kind: "main" | "sub", parentSectionId?: string | null) {
    commit((current) => ({
      ...current,
      sections: [...current.sections, createEmptySection(current, kind, parentSectionId)],
    }));
  }

  function addItem(sectionId: string | null, itemType: "custom" | "note" | "blank") {
    commit((current) => ({
      ...current,
      items: [...current.items, createEmptyItem(current, itemType, sectionId)],
    }));
  }

  function addProductItem(sectionId: string, item: LocalQuotationItem) {
    commit((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          ...item,
          section_id: sectionId,
          sort_order: (orderedItems(current.items, sectionId).at(-1)?.sort_order ?? 0) + 10,
          updated_at: localNow(),
        },
      ],
    }));
  }

  function duplicateItem(itemId: string) {
    commit((current) => {
      const source = current.items.find((item) => item.id === itemId);
      if (!source) return current;

      return {
        ...current,
        items: [
          ...current.items,
          {
            ...source,
            id: `${source.id}-copy-${crypto.randomUUID()}`,
            source_item_id: source.source_item_id ?? source.id,
            sort_order: source.sort_order + 1,
            updated_at: localNow(),
          },
        ],
      };
    });
  }

  function copyItem(itemId: string) {
    const source = workspace.items.find((item) => item.id === itemId);
    if (!source) return;

    const payload: LocalRowClipboardPayload = {
      copied_at: localNow(),
      source_item_id: source.source_item_id ?? source.id,
      source_quotation_id: workspace.server_quotation_id,
      source_quotation_label: workspace.quotation_no || workspace.title || currentProjectName,
      source_section_id: source.section_id,
      row_snapshot: cloneUnknown(source),
    };

    window.localStorage.setItem(localRowClipboardKey, JSON.stringify(payload));
    broadcastLocalRowClipboardChange();
    setCopiedRowId(itemId);
  }

  function clearCopiedRow() {
    window.localStorage.removeItem(localRowClipboardKey);
    broadcastLocalRowClipboardChange();
    setCopiedRowClipboard(null);
    setCopiedRowId(null);
  }

  function pasteCopiedRow(sectionId: string) {
    const rowSnapshot = copiedRowClipboard?.row_snapshot;
    if (!rowSnapshot) return;

    let pastedRowId: string | null = null;

    commit((current) => {
      const nextItem = cloneQuotationRowForSection(current, rowSnapshot, sectionId);
      pastedRowId = nextItem.id;

      return {
        ...current,
        items: [...current.items, nextItem],
      };
    });

    if (pastedRowId) {
      setRecentEditedRowId(pastedRowId);
    }
  }

  function pasteCopiedRowRelative(targetRowId: string, position: "above" | "below") {
    const rowSnapshot = copiedRowClipboard?.row_snapshot;
    if (!rowSnapshot) return;

    let pastedRowId: string | null = null;

    commit((current) => {
      const targetRow = current.items.find((item) => item.id === targetRowId);
      if (!targetRow) return current;

      const targetSectionId = targetRow.section_id;
      const sectionItems = orderedItems(current.items, targetSectionId);
      const targetIndex = sectionItems.findIndex((item) => item.id === targetRowId);
      if (targetIndex < 0) return current;

      const nextItem = cloneQuotationRowForSection(current, rowSnapshot, targetSectionId);
      pastedRowId = nextItem.id;
      const insertAtIndex = position === "above" ? targetIndex : targetIndex + 1;

      return {
        ...current,
        items: withReindexedSectionItems(current.items, targetSectionId, insertAtIndex, nextItem),
      };
    });

    if (pastedRowId) {
      setRecentEditedRowId(pastedRowId);
    }
  }

  function removeItem(itemId: string) {
    if (detailsModalRowId === itemId) {
      setDetailsModalRowId(null);
    }
    commit((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId),
    }));
  }

  function removeSection(sectionId: string) {
    commit((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId),
      items: current.items.filter((item) => item.section_id !== sectionId),
    }));
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    commit((current) => ({
      ...current,
      sections: moveSortOrder(current.sections, sectionId, direction),
    }));
  }

  function moveItem(sectionId: string | null, itemId: string, direction: -1 | 1) {
    const sectionItems = workspace.items.filter((item) => item.section_id === sectionId);
    const moved = moveSortOrder(sectionItems, itemId, direction);
    commit((current) => ({
      ...current,
      items: current.items.map((item) => moved.find((candidate) => candidate.id === item.id) ?? item),
    }));
  }

  function applyPriceRounding() {
    const step = exactMoneyValue(Math.max(tableNumberValue(roundingStepInput), 0));
    if (step <= 0) {
      setSaveMessage("Enter a rounding step greater than zero before applying price rounding.");
      return;
    }

    commit((current) => {
      const currentRounding = readPriceRoundingMetadata(current);
      const roundedNetPrices: Record<string, number> = {};
      const items = current.items.map((item) => {
        if (
          item.is_active === false ||
          item.is_rate_only ||
          ["note", "blank", "subtotal"].includes(item.item_type) ||
          ["heading", "note", "no_quote"].includes(item.line_style)
        ) {
          return item;
        }

        const roundedNetPrice = roundToNearestStep(exactMoneyValue(item.net_price), step);
        roundedNetPrices[item.id] = roundedNetPrice;
        return item;
      });

      return withPriceRoundingMetadata(
        {
          ...current,
          items,
        },
        {
          ...currentRounding,
          rounded_net_prices: roundedNetPrices,
          step,
          last_applied_step: step,
          applied_at: localNow(),
          mode: "nearest",
        },
      );
    });

    setSaveMessage(`Applied nearest price rounding with step ${step}. Manual inputs are not auto-rounded.`);
  }

  function restoreRoundedPrices() {
    const roundedNetPrices = priceRoundingMetadata.rounded_net_prices ?? {};
    if (!Object.keys(roundedNetPrices).length) {
      setSaveMessage("No rounded prices are available to restore.");
      return;
    }

    commit((current) => {
      const currentRounding = readPriceRoundingMetadata(current);
      return withPriceRoundingMetadata(
        {
          ...current,
        },
        {
          ...currentRounding,
          rounded_net_prices: {},
          applied_at: null,
          last_applied_step: currentRounding.last_applied_step ?? currentRounding.step ?? null,
        },
      );
    });

    setSaveMessage("Restored original unrounded net prices.");
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${workspace.quotation_no ?? workspace.server_quotation_id}-local-backup.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function importBackup(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as LocalQuotationWorkspace;
    commit({
      ...parsed,
      local_id: workspace.local_id,
      server_quotation_id: workspace.server_quotation_id,
      project_id: workspace.project_id,
      client_id: workspace.client_id,
      quotation_no: workspace.quotation_no,
    });
  }

  function saveToSoftware() {
    startTransition(() => {
      setSaveState("saving");
      setSaveMessage("");

      void fetch(`/api/quotations/${workspace.server_quotation_id}/local-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Save failed." })) as {
              code?: string;
              details?: string;
              error?: string;
              hint?: string;
            };
            const detailParts = [error.details, error.hint, error.code ? `code=${error.code}` : ""].filter(Boolean);
            throw new Error(
              detailParts.length
                ? `${error.error || "Save failed."} ${detailParts.join(" | ")}`
                : (error.error || "Save failed."),
            );
          }

          const result = await response.json() as { savedAt: string };
          const nextWorkspace = {
            ...workspace,
            has_unsaved_changes: false,
            last_saved_to_software_at: result.savedAt,
            updated_at: localNow(),
          };
          historyGroupRef.current = null;
          setWorkspace(nextWorkspace);
          await saveWorkspaceDocument(nextWorkspace);
          setSaveState("saved");
          setSaveMessage("Saved to software");
        })
        .catch((error) => {
          setSaveState("error");
          setSaveMessage(error instanceof Error ? error.message : "Save failed.");
        });
      });
  }

  function renderRowDetailsModalContent(item: LocalQuotationItem) {
    const snapshotDetails = sourceSnapshotDetails(item);
    const templateLinkedGroups = templateMaterialGroups.filter((group) => group.product_template_id === item.source_template_id);
    const linkedGroupIds = new Set(templateLinkedGroups.map((group) => group.id));
    const selectedFinishes = finishSelectionRows(item.finish_selections_snapshot);
    const displayPricing = workspaceItemDisplayPricing(workspace, item);
    const selectedFinishChips = selectedFinishes.map((finish, index) => ({
      id: finish.id ?? `${finish.group_label ?? "finish"}-${index}`,
      label: [finish.group_label || "Finish", [finish.finish_code, finish.finish_name].filter(Boolean).join(" | ")].filter(Boolean).join(": "),
    }));
    const optionalDetailFields = [
      { label: "Room", value: item.room_name_snapshot },
      { label: "Model code / alternate model", value: item.model_snapshot },
      { label: "Finish", value: item.finish_snapshot },
      { label: "Origin", value: item.origin_snapshot },
      { label: "Warranty", value: item.warranty_snapshot },
      { label: "Supplier", value: item.supplier_name_snapshot },
    ].filter((field) => Boolean(field.value));
    const showOptionalDetailsOpen = optionalDetailFields.length > 0;
    const imagePreviewValue = item.proposed_image_url_snapshot || item.specified_image_url_snapshot || null;
    const sourceSummaryRows = [
      { label: "Source template", value: sourceLibrarySummary(item).templateName || "Manual row" },
      { label: "Source type", value: snapshotDetails.sourcePriceType },
      { label: "Source label", value: snapshotDetails.sourcePriceLabel },
      { label: "Source currency", value: snapshotDetails.sourceCurrency },
      { label: "Source total", value: snapshotDetails.sourcePrice },
      { label: "Exchange rate", value: snapshotDetails.exchangeRatesSummary.join(" | ") || (snapshotDetails.convertedTotalAed ? `AED total: ${snapshotDetails.convertedTotalAed}` : "") },
      {
        label: "Converted quote price",
        value: snapshotDetails.convertedQuotePrice
          ? `${snapshotDetails.quoteCurrency} ${snapshotDetails.convertedQuotePrice}`
          : formatWorkspaceMoney(item.currency || workspace.currency, item.unit_price),
      },
      { label: "Selected options", value: snapshotDetails.selectedOptionNames.join(", ") || sourceLibrarySummary(item).selectedOptions.join(", ") || sourceLibrarySummary(item).selectedOptionIds.join(", ") },
    ].filter((row) => Boolean(row.value));
    const selectedSnapshotRows = [
      { label: "Model", value: snapshotDetails.model },
      { label: "Size", value: snapshotDetails.size || item.size_snapshot },
      { label: "Accessories", value: snapshotDetails.accessorySummary.join(" | ") },
      { label: "Linked families", value: snapshotDetails.linkedFamilySummary.join(" | ") },
      { label: "Finish/material snapshot", value: item.finish_snapshot || finishSnapshotValue(selectedFinishes) },
    ].filter((row) => Boolean(row.value));
    const internalMetadata = internalItemMetadata(item);
    return (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="grid gap-4">
          <fieldset className="border border-zinc-300 bg-white p-3">
            <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Basic</legend>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Manual S.No.</span>
                <input value={item.manual_serial ?? ""} onChange={(event) => updateItem(item.id, { manual_serial: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Code</span>
                <input value={item.item_code_snapshot ?? ""} onChange={(event) => updateItem(item.id, { item_code_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1 md:col-span-2">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Item / Model Name</span>
                <input value={item.item_name_snapshot ?? ""} onChange={(event) => updateItem(item.id, { item_name_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Qty</span>
                <input type="number" min={item.item_type === "blank" || item.item_type === "note" ? 0 : 1} step="1" value={item.qty} onChange={(event) => updateItem(item.id, { qty: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Unit</span>
                <input value={item.unit_label ?? "Pc"} onChange={(event) => updateItem(item.id, { unit_label: event.target.value || "Pc" })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">U.Price</span>
                <input type="number" min={0} step="any" value={item.unit_price} onChange={(event) => updateItem(item.id, { unit_price: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Currency</span>
                <select value={item.currency ?? workspace.currency} onChange={(event) => updateItem(item.id, { currency: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Discount Type</span>
                <select value={normalizedDiscountType(item.discount_type)} onChange={(event) => updateItem(item.id, { discount_type: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                  <option value="none">None</option>
                  <option value="percent">Percent</option>
                  <option value="amount">Amount</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Discount Value</span>
                <input type="number" min={0} step="any" value={item.discount_value} onChange={(event) => updateItem(item.id, { discount_value: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Line Style</span>
                <select value={item.line_style ?? "normal"} onChange={(event) => updateItem(item.id, { line_style: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                  <option value="normal">Normal</option>
                  <option value="heading">Heading</option>
                  <option value="note">Note</option>
                  <option value="blank">Blank</option>
                  <option value="no_quote">No Quote</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Sort</span>
                <input type="number" step="1" value={item.sort_order ?? 0} onChange={(event) => updateItem(item.id, { sort_order: Number(event.target.value) || 0 })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Row Height</span>
                <input type="number" min={40} value={item.row_height ?? ""} onChange={(event) => updateItem(item.id, { row_height: event.target.value ? clampRowHeight(Number(event.target.value)) : null })} placeholder="Auto" className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="flex items-center gap-2 border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-700">
                <input type="checkbox" checked={item.is_rate_only === true} onChange={(event) => updateItem(item.id, { is_rate_only: event.target.checked })} className="h-4 w-4 rounded border-zinc-300" />
                <span>Rate only</span>
              </label>
              <label className="flex items-center gap-2 border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs text-zinc-700">
                <input type="checkbox" checked={item.allow_material_continuation_page === true} onChange={(event) => updateItem(item.id, { allow_material_continuation_page: event.target.checked })} className="h-4 w-4 rounded border-zinc-300" />
                <span>Allow material continuation page</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="border border-zinc-300 bg-white p-3">
            <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Specification</legend>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_240px]">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Main specification</span>
                <textarea value={item.specification_snapshot ?? ""} onChange={(event) => updateItem(item.id, { specification_snapshot: event.target.value || null })} rows={5} className="w-full resize-y border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Dimension</span>
                <input value={item.size_snapshot ?? ""} onChange={(event) => updateItem(item.id, { size_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
            </div>
          </fieldset>

          <details className="border border-zinc-300 bg-white" open={showOptionalDetailsOpen}>
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase text-zinc-500">
              {showOptionalDetailsOpen ? "Optional Product Details" : "Show optional product details"}
            </summary>
            <div className="grid gap-2 border-t border-zinc-200 p-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Room</span>
                <input value={item.room_name_snapshot ?? ""} onChange={(event) => updateItem(item.id, { room_name_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Model code / alternate model</span>
                <input value={item.model_snapshot ?? ""} onChange={(event) => updateItem(item.id, { model_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Finish</span>
                <input value={item.finish_snapshot ?? ""} onChange={(event) => updateItem(item.id, { finish_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Origin</span>
                <input value={item.origin_snapshot ?? ""} onChange={(event) => updateItem(item.id, { origin_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Warranty</span>
                <input value={item.warranty_snapshot ?? ""} onChange={(event) => updateItem(item.id, { warranty_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Supplier</span>
                <input value={item.supplier_name_snapshot ?? ""} onChange={(event) => updateItem(item.id, { supplier_name_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
              </label>
            </div>
          </details>

          <fieldset className="border border-zinc-300 bg-white p-3">
            <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Internal</legend>
            <div className="grid gap-2">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Internal Notes</span>
                <textarea
                  value={internalMetadata.internalNotes ?? ""}
                  onChange={(event) => updateItem(item.id, updateItemInternalMetadata(item, { internalNotes: event.target.value }))}
                  rows={4}
                  placeholder="Add internal note"
                  className="w-full resize-y border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-emerald-800"
                />
              </label>
              {customInternalColumns.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {customInternalColumns.map((column) => {
                    const fieldValue = internalCustomColumnValue(item, column.id);
                    if (column.type === "date") {
                      return (
                        <label key={column.id} className="grid gap-1">
                          <span className="text-[10px] font-semibold uppercase text-zinc-500">{column.label}</span>
                          <input
                            type="date"
                            value={fieldValue}
                            onChange={(event) => updateItem(item.id, updateItemInternalCustomColumnValue(item, column.id, event.target.value))}
                            className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                          />
                        </label>
                      );
                    }

                    return (
                      <label key={column.id} className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">{column.label}</span>
                        <input
                          type={column.type === "number" ? "number" : "text"}
                          step={column.type === "number" ? "any" : undefined}
                          value={fieldValue}
                          onChange={(event) => updateItem(item.id, updateItemInternalCustomColumnValue(item, column.id, event.target.value))}
                          className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </fieldset>

          {customPrintableColumnDefs.length ? (
            <fieldset className="border border-zinc-300 bg-white p-3">
              <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Custom Printable Columns</legend>
              <div className="grid gap-2 md:grid-cols-2">
                {customPrintableColumnDefs.map((column) => {
                  const fieldValue = customPrintableColumnValue(item, column.id);

                  if (column.type === "image") {
                    return (
                      <label key={column.id} className="grid gap-1 md:col-span-2">
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">{column.label}</span>
                        <LocalQuotationCustomPrintableImageCell
                          columnId={column.id}
                          item={item}
                          quotationId={workspace.server_quotation_id}
                          updateItem={(patch) => updateItem(item.id, patch)}
                        />
                        {fieldValue ? (
                          <details className="border border-zinc-200 bg-zinc-50">
                            <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase text-zinc-500">Advanced image value</summary>
                            <div className="border-t border-zinc-200 p-3">
                              <input
                                value={fieldValue}
                                onChange={(event) => updateItem(item.id, updateItemCustomPrintableColumnValue(item, column.id, event.target.value))}
                                className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                              />
                            </div>
                          </details>
                        ) : null}
                      </label>
                    );
                  }

                  return (
                    <label key={column.id} className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">{column.label}</span>
                      <div className="relative">
                        <input
                          type={column.type === "number" || column.type === "percentage" ? "number" : "text"}
                          step={column.type === "number" || column.type === "percentage" ? "any" : undefined}
                          value={fieldValue}
                          onChange={(event) => updateItem(item.id, updateItemCustomPrintableColumnValue(item, column.id, event.target.value))}
                          className={`h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800 ${column.type === "percentage" ? "pr-6" : ""}`}
                        />
                        {column.type === "percentage" ? (
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="border border-zinc-300 bg-white p-3">
            <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Image</legend>
            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)] md:items-start">
              <div className="grid gap-2">
                <FinishImagePreview alt={item.item_name_snapshot ?? "Item image"} className="h-28 w-full" value={imagePreviewValue} />
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                  <button type="button" className="border border-zinc-300 bg-white px-2 py-1 text-zinc-700">Replace</button>
                  <button type="button" className="border border-zinc-300 bg-white px-2 py-1 text-zinc-700">Paste</button>
                  <button type="button" className="border border-zinc-300 bg-white px-2 py-1 text-zinc-700">Adjust</button>
                </div>
              </div>
              <div className="grid gap-2">
                <p className="text-xs text-zinc-600">{imagePreviewValue ? "Current reference image is shown here." : "No reference image selected yet."}</p>
                <details className="border border-zinc-200 bg-zinc-50" open={Boolean(item.specified_image_url_snapshot || item.proposed_image_url_snapshot)}>
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase text-zinc-500">Edit image URLs</summary>
                  <div className="grid gap-2 border-t border-zinc-200 p-3">
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Specified Image URL</span>
                      <input value={item.specified_image_url_snapshot ?? ""} onChange={(event) => updateItem(item.id, { specified_image_url_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Proposed / Reference Image URL</span>
                      <input value={item.proposed_image_url_snapshot ?? ""} onChange={(event) => updateItem(item.id, { proposed_image_url_snapshot: event.target.value || null })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                  </div>
                </details>
              </div>
            </div>
          </fieldset>

          <fieldset className="border border-zinc-300 bg-white p-3">
            <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Materials & Finishes</legend>
            <div className="grid gap-3">
              {selectedFinishChips.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedFinishChips.map((chip) => (
                    <span key={chip.id} className="border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900">
                      {chip.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No finishes selected yet.</p>
              )}
              <div className="max-h-[460px] overflow-y-auto pr-1">
                <FinishSelectionsEditor
                  brands={productBrands}
                  allowMaterialContinuationPage={item.allow_material_continuation_page}
                  initialBrandId={null}
                  initialFinishes={selectedFinishes}
                  materialGroups={materialGroups}
                  materials={materials}
                  onChange={(nextFinishes) =>
                    updateItem(item.id, {
                      finish_selections_snapshot: nextFinishes,
                      finish_snapshot: finishSnapshotValue(nextFinishes),
                    })
                  }
                  quotationId={workspace.server_quotation_id}
                  templateMaterialGroupItems={templateMaterialGroupItems.filter((entry) => linkedGroupIds.has(entry.product_template_material_group_id))}
                  templateMaterialGroups={templateLinkedGroups}
                />
              </div>
            </div>
          </fieldset>
        </div>

        <div className="grid gap-4 lg:sticky lg:top-0">
          {canSaveRowToProductLibrary(item) ? (
            <fieldset className="border border-zinc-300 bg-white p-3">
              <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Product Library</legend>
              <div className="grid gap-2">
                <p className="text-xs text-zinc-500">
                  Save this quotation row as a new reusable product template.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSaveLibraryChoiceRowId(item.id);
                    setSaveLibraryMode("new");
                    setSaveLibraryTemplateSearch("");
                    setSaveLibraryTemplateId("");
                  }}
                  className="h-9 border border-emerald-900 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                >
                  Save to Product Library
                </button>
                {!canManageProductLibrary ? (
                  <p className="text-[11px] text-zinc-500">
                    Product Library saving is available to settings managers.
                  </p>
                ) : null}
              </div>
            </fieldset>
          ) : null}
          <fieldset className="border border-zinc-300 bg-white p-3">
            <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Row Summary</legend>
            <div className="grid gap-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                <p className="text-[10px] font-semibold uppercase text-zinc-500">Discount amount</p>
                <p className="font-semibold text-zinc-900">{formatTableNumber(displayPricing.discountAmount)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-zinc-500">Net price</p>
                <p className="font-semibold text-zinc-900">{formatTableNumber(displayPricing.netPrice)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-zinc-500">Net total</p>
                <p className="font-semibold text-zinc-900">{formatTableNumber(displayPricing.netTotal)}</p>
              </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase text-zinc-500">Row total</p>
                  <p className="font-semibold text-zinc-900">{formatTableNumber(exactMoneyValue(item.qty * item.net_price))}</p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void saveLocalDraftNow(item.id)}
                  className="h-9 flex-1 border border-emerald-900 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                >
                  Save Row
                </button>
                <button
                  type="button"
                  onClick={() => setDetailsModalRowId(null)}
                  className="h-9 flex-1 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                >
                  Done
                </button>
              </div>
            </div>
          </fieldset>

          {sourceSummaryRows.length ? (
            <fieldset className="border border-zinc-300 bg-white p-3">
              <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Source / Library Price</legend>
              <div className="grid gap-2 text-xs">
                {sourceSummaryRows.map((row) => (
                  <div key={row.label}>
                    <p className="text-[10px] font-semibold uppercase text-zinc-500">{row.label}</p>
                    <p className="text-zinc-800">{row.value}</p>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}

          {selectedSnapshotRows.length ? (
            <fieldset className="border border-zinc-300 bg-white p-3">
              <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Selected Product Snapshot</legend>
              <div className="grid gap-2 text-xs">
                {selectedSnapshotRows.map((row) => (
                  <div key={row.label}>
                    <p className="text-[10px] font-semibold uppercase text-zinc-500">{row.label}</p>
                    <p className="whitespace-pre-wrap text-zinc-800">{row.value}</p>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      </div>
    );
  }

  function continueSaveToProductLibrary(item: LocalQuotationItem) {
    const importDraft = encodeQuotationRowImportDraft(item);
    if (!importDraft) return;

    const nextHref =
      saveLibraryMode === "new"
        ? `/products/templates?addTemplate=1&quoteImportMode=new&quoteImportDraft=${encodeURIComponent(importDraft)}&returnTo=${encodeURIComponent(`/quotations/${workspace.server_quotation_id}/local-builder`)}`
        : saveLibraryTemplateId
          ? `/products/templates?template=${encodeURIComponent(saveLibraryTemplateId)}&editTemplate=${encodeURIComponent(saveLibraryTemplateId)}&quoteImportMode=existing&quoteImportDraft=${encodeURIComponent(importDraft)}&returnTo=${encodeURIComponent(`/quotations/${workspace.server_quotation_id}/local-builder`)}`
          : "";

    if (!nextHref) return;
    window.location.href = nextHref;
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-300 bg-white">
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Link href={`/clients/projects/${workspace.project_id}`} className="inline-flex h-9 items-center border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Back</Link>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-950">{workspace.quotation_no ?? "Draft quotation"} - {workspace.title}</p>
                <p className="truncate text-xs text-zinc-500">{currentClientName} / {currentProjectName}</p>
              </div>
              <StatusBadge status={workspace.status} />
              <span className="border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">Local Builder</span>
              <span className={`border px-2.5 py-1 text-xs font-semibold ${
                workspace.has_unsaved_changes
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900"
              }`}>
                {statusText(workspace, localDraftSaved, saveState)}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
              <button
                type="button"
                onClick={undoLastChange}
                disabled={!historyPast.length}
                title="Undo last change"
                className="inline-flex h-9 w-9 items-center justify-center border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                ↶
              </button>
              <button
                type="button"
                onClick={redoLastChange}
                disabled={!historyFuture.length}
                title="Redo last undone change"
                className="inline-flex h-9 w-9 items-center justify-center border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                ↷
              </button>
              <button type="button" onClick={saveToSoftware} disabled={isPending} className="inline-flex h-9 items-center bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-400">Save to Software</button>
              <details className="relative">
                <summary className="inline-flex h-9 cursor-pointer items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                  Downloads
                </summary>
                <div className="absolute right-0 z-30 mt-2 grid min-w-[220px] gap-2 border border-zinc-300 bg-white p-2 text-xs shadow-lg">
                  <LocalServerViewLink disabled={workspace.has_unsaved_changes} href={`/quotations/${workspace.server_quotation_id}/presentation`} target="_blank">
                    Preview Presentation
                  </LocalServerViewLink>
                  <LocalServerViewLink disabled={workspace.has_unsaved_changes} href={`/quotations/${workspace.server_quotation_id}/pdf`} target="_blank">
                    Preview PDF
                  </LocalServerViewLink>
                  <LocalServerViewLink disabled={workspace.has_unsaved_changes} href={`/quotations/${workspace.server_quotation_id}/download-pdf`} primary>
                    Download PDF
                  </LocalServerViewLink>
                  <LocalServerViewLink disabled={workspace.has_unsaved_changes} href={`/quotations/${workspace.server_quotation_id}/specification`} target="_blank">
                    Specification Sheet
                  </LocalServerViewLink>
                  <LocalServerViewLink disabled={workspace.has_unsaved_changes} href={`/quotations/${workspace.server_quotation_id}/download-specification`}>
                    Download Specification
                  </LocalServerViewLink>
                </div>
              </details>
              <details ref={columnSettingsRef} className="relative">
                <summary className="inline-flex h-9 cursor-pointer items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                  Columns
                </summary>
                <div className="absolute right-0 z-30 mt-2 flex w-[760px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border border-zinc-300 bg-white text-xs text-zinc-600 shadow-lg">
                  <div className="border-b border-zinc-200 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase text-zinc-500">Local Column Settings</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Column changes stay in this IndexedDB workspace until you use Save to Software.
                    </p>
                  </div>
                  <div className="max-h-[68vh] overflow-y-auto px-4 py-3">
                    <div className="grid gap-3 xl:grid-cols-2">
                      <fieldset className="border border-zinc-200 bg-zinc-50 p-3">
                        <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                          Specification Display
                        </legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {specificationMetadataFields.map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                              <input
                                type="checkbox"
                                checked={metadataSettings[key]}
                                onChange={(event) => updateSpecificationMetadataSetting(key, event.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      {columnSettingsGroups.map((group) => {
                        if (group.title === "Custom Printable Columns") {
                          return (
                            <fieldset key={group.title} className="border border-zinc-200 bg-zinc-50 p-3 xl:col-span-2">
                              <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                                {group.title}
                              </legend>
                              <p className="mb-2 text-[11px] text-zinc-500">Shown in Client View and PDF only when enabled per column.</p>
                              <div className="grid gap-2">
                                {customPrintableColumnDefs.length ? customPrintableColumnDefs.map((column) => {
                                  const tableColumn = activeColumnByKey.get(printableCustomColumnKey(column.id)) ?? customPrintableColumnTableColumn(column);
                                  const columnIndex = activeColumns.findIndex((entry) => entry.key === tableColumn.key);
                                  return (
                                    <div key={column.id} className="grid gap-2 rounded border border-zinc-200 bg-white p-2 lg:grid-cols-[minmax(0,1fr)_88px]">
                                      <div className="grid gap-2">
                                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                                          <label className="grid gap-1">
                                            <span className="text-[10px] font-semibold uppercase text-zinc-500">Column name</span>
                                            <input
                                              value={column.label}
                                              onChange={(event) => updateCustomPrintableColumn(column.id, { label: event.target.value || "Printable Column" })}
                                              className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                            />
                                          </label>
                                          <label className="grid gap-1">
                                            <span className="text-[10px] font-semibold uppercase text-zinc-500">Type</span>
                                            <select
                                              value={column.type}
                                              onChange={(event) => updateCustomPrintableColumn(column.id, { type: normalizeCustomPrintableColumnType(event.target.value) })}
                                              className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                            >
                                              <option value="text">Text</option>
                                              <option value="number">Number</option>
                                              <option value="percentage">Percentage</option>
                                              <option value="image">Image</option>
                                            </select>
                                          </label>
                                          <div className="grid content-end">
                                            <button
                                              type="button"
                                              onClick={() => removeCustomPrintableColumn(column.id)}
                                              className="h-8 border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:text-red-800"
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                                            <input
                                              type="checkbox"
                                              checked={column.showInClient !== false}
                                              onChange={(event) => updateCustomPrintableColumn(column.id, { showInClient: event.target.checked })}
                                              className="h-4 w-4 rounded border-zinc-300"
                                            />
                                            <span>Show in Client View / PDF</span>
                                          </label>
                                          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                                            <input
                                              type="checkbox"
                                              checked={column.showInInternal !== false}
                                              onChange={(event) => updateCustomPrintableColumn(column.id, { showInInternal: event.target.checked })}
                                              className="h-4 w-4 rounded border-zinc-300"
                                            />
                                            <span>Show in Internal View</span>
                                          </label>
                                        </div>
                                      </div>
                                      <label className="grid gap-1">
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="text-[10px] font-semibold uppercase text-zinc-500">Width</span>
                                          <div className="flex gap-1">
                                            <button
                                              type="button"
                                              onClick={() => moveColumnOrder(tableColumn.key, -1)}
                                              disabled={columnIndex <= 0}
                                              className="h-5 w-5 border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                                            >
                                              ↑
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => moveColumnOrder(tableColumn.key, 1)}
                                              disabled={columnIndex < 0 || columnIndex >= activeColumns.length - 1}
                                              className="h-5 w-5 border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                                            >
                                              ↓
                                            </button>
                                          </div>
                                        </div>
                                        <input
                                          type="number"
                                          min={40}
                                          max={800}
                                          value={column.width ?? tableColumn.defaultWidth}
                                          onChange={(event) => updateCustomPrintableColumn(column.id, { width: Number(event.target.value) || tableColumn.defaultWidth })}
                                          className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                        />
                                      </label>
                                    </div>
                                  );
                                }) : (
                                  <p className="text-xs text-zinc-500">No custom printable columns yet.</p>
                                )}
                                <div className="flex justify-start pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setAddPrintableColumnOpen(true)}
                                    className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-emerald-900 hover:text-emerald-900"
                                  >
                                    + Add printable column
                                  </button>
                                </div>
                              </div>
                            </fieldset>
                          );
                        }

                        const groupColumns = group.keys
                          .map((key) => activeColumnByKey.get(key))
                          .filter((column): column is LocalBuilderColumn => Boolean(column));
                        if (!groupColumns.length) return null;

                        return (
                          <fieldset key={group.title} className="border border-zinc-200 bg-zinc-50 p-3">
                            <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                              {group.title}
                            </legend>
                            {group.internalOnly ? (
                              <p className="mb-2 text-[11px] text-zinc-500">Internal View only</p>
                            ) : null}
                            <div className="grid gap-2">
                              {groupColumns.map((column) => {
                                const setting = columnSettings.get(column.key);
                                const isVisible = setting?.visible ?? column.defaultVisible ?? true;
                                const currentWidth = setting?.width ?? column.defaultWidth;
                                const columnIndex = activeColumns.findIndex((entry) => entry.key === column.key);

                                return (
                                  <div key={column.key} className="grid grid-cols-[1fr_88px] items-center gap-2 rounded border border-zinc-200 bg-white px-2 py-2">
                                    <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-zinc-700">
                                      <input
                                        type="checkbox"
                                        checked={isVisible}
                                        onChange={(event) => updateColumnSetting(column.key, { visible: event.target.checked })}
                                        className="h-4 w-4 rounded border-zinc-300"
                                      />
                                      <span className="truncate" title={column.label}>{column.label}</span>
                                    </label>
                                    <label className="grid gap-1">
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-[10px] font-semibold uppercase text-zinc-500">Width</span>
                                        <div className="flex gap-1">
                                          <button
                                            type="button"
                                            onClick={() => moveColumnOrder(column.key, -1)}
                                            disabled={columnIndex <= 0}
                                            className="h-5 w-5 border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveColumnOrder(column.key, 1)}
                                            disabled={columnIndex < 0 || columnIndex >= activeColumns.length - 1}
                                            className="h-5 w-5 border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                                          >
                                            ↓
                                          </button>
                                        </div>
                                      </div>
                                      <input
                                        type="number"
                                        min={40}
                                        max={800}
                                        value={currentWidth}
                                        onChange={(event) => updateColumnSetting(column.key, { width: Number(event.target.value) || column.defaultWidth })}
                                        className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                      />
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </fieldset>
                        );
                      })}

                      <fieldset className="border border-zinc-200 bg-zinc-50 p-3 xl:col-span-2">
                        <legend className="px-1 text-[10px] font-bold uppercase text-zinc-500">
                          Internal View Columns
                        </legend>
                        <p className="mb-2 text-[11px] text-zinc-500">Internal View only. Hidden in Client View and PDF/Preview.</p>
                        <div className="grid gap-2">
                          {["internal_notes", ...customInternalColumns.map((column) => internalCustomColumnKey(column.id))]
                            .map((key) => activeColumnByKey.get(key))
                            .filter((column): column is LocalBuilderColumn => Boolean(column))
                            .map((column) => {
                              const customColumnId = column.internalCustomColumnId ?? null;
                              const customColumn = customColumnId
                                ? customInternalColumns.find((entry) => entry.id === customColumnId) ?? null
                                : null;
                              const setting = columnSettings.get(column.key);
                              const columnIndex = activeColumns.findIndex((entry) => entry.key === column.key);
                              const isVisible = customColumn
                                ? customColumn.visible !== false
                                : setting?.visible ?? column.defaultVisible ?? true;
                              const currentWidth = customColumn
                                ? customColumn.width ?? column.defaultWidth
                                : setting?.width ?? column.defaultWidth;

                              return (
                                <div key={column.key} className="grid gap-2 rounded border border-zinc-200 bg-white p-2 lg:grid-cols-[minmax(0,1fr)_88px]">
                                  <div className="grid gap-2">
                                    <label className="flex min-w-0 items-center gap-2 text-xs font-semibold text-zinc-700">
                                      <input
                                        type="checkbox"
                                        checked={isVisible}
                                        onChange={(event) => customColumn
                                          ? updateInternalCustomColumn(customColumn.id, { visible: event.target.checked })
                                          : updateColumnSetting(column.key, { visible: event.target.checked })}
                                        className="h-4 w-4 rounded border-zinc-300"
                                      />
                                      <span className="truncate" title={column.label}>{column.label}</span>
                                    </label>
                                    {customColumn ? (
                                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                                        <label className="grid gap-1">
                                          <span className="text-[10px] font-semibold uppercase text-zinc-500">Column name</span>
                                          <input
                                            value={customColumn.label}
                                            onChange={(event) => updateInternalCustomColumn(customColumn.id, { label: event.target.value || "Internal Column" })}
                                            className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                          />
                                        </label>
                                        <label className="grid gap-1">
                                          <span className="text-[10px] font-semibold uppercase text-zinc-500">Type</span>
                                          <select
                                            value={customColumn.type}
                                            onChange={(event) => updateInternalCustomColumn(customColumn.id, { type: normalizeInternalCustomColumnType(event.target.value) })}
                                            className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                          >
                                            <option value="text">Text</option>
                                            <option value="number">Number</option>
                                            <option value="date">Date</option>
                                          </select>
                                        </label>
                                        <div className="grid content-end">
                                          <button
                                            type="button"
                                            onClick={() => removeInternalCustomColumn(customColumn.id)}
                                            className="h-8 border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:text-red-800"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                  <label className="grid gap-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Width</span>
                                      <div className="flex gap-1">
                                        <button
                                          type="button"
                                          onClick={() => moveColumnOrder(column.key, -1)}
                                          disabled={columnIndex <= 0}
                                          className="h-5 w-5 border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                                        >
                                          ↑
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => moveColumnOrder(column.key, 1)}
                                          disabled={columnIndex < 0 || columnIndex >= activeColumns.length - 1}
                                          className="h-5 w-5 border border-zinc-300 bg-white text-[10px] font-semibold text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
                                        >
                                          ↓
                                        </button>
                                      </div>
                                    </div>
                                    <input
                                      type="number"
                                      min={40}
                                      max={800}
                                      value={currentWidth}
                                      onChange={(event) => customColumn
                                        ? updateInternalCustomColumn(customColumn.id, { width: Number(event.target.value) || column.defaultWidth })
                                        : updateColumnSetting(column.key, { width: Number(event.target.value) || column.defaultWidth })}
                                      className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                    />
                                  </label>
                                </div>
                              );
                            })}
                          <div className="flex justify-start pt-1">
                            <button
                              type="button"
                              onClick={() => setAddInternalColumnOpen(true)}
                              className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-emerald-900 hover:text-emerald-900"
                            >
                              + Add internal column
                            </button>
                          </div>
                        </div>
                      </fieldset>
                    </div>
                  </div>
                  <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-zinc-200 bg-white px-4 py-3">
                    <p className="text-[11px] text-zinc-500">
                      Internal columns stay local to this quotation and do not appear in Client View or PDF.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAddInternalColumnOpen(true)}
                        className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-emerald-900 hover:text-emerald-900"
                      >
                        + Add internal column
                      </button>
                      <button
                        type="button"
                        onClick={() => commit((current) => ({
                          ...current,
                          layout_settings: {
                            ...localLayoutSettings(current.layout_settings),
                            columns: [],
                            columnOrder: [],
                            specificationMetadata: {},
                          },
                        }), { groupKey: "layout-settings", mode: "merge" })}
                        className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                      >
                        Reset defaults
                      </button>
                      <button
                        type="button"
                        onClick={saveColumnSettingsPanel}
                        className="border border-emerald-900 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                      >
                        Save columns
                      </button>
                    </div>
                  </div>
                </div>
              </details>
              <Link href={`/quotations/${workspace.server_quotation_id}`} className="inline-flex h-9 items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Summary</Link>
              <details className="relative">
                <summary className="inline-flex h-9 cursor-pointer items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                  More
                </summary>
                <div className="absolute right-0 z-30 mt-2 grid min-w-[220px] gap-2 border border-zinc-300 bg-white p-2 text-xs shadow-lg">
                  <button type="button" onClick={exportBackup} className="h-9 border border-zinc-300 bg-white px-3 text-left font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                    Export Backup JSON
                  </button>
                  <button type="button" onClick={() => importRef.current?.click()} className="h-9 border border-zinc-300 bg-white px-3 text-left font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                    Import Backup JSON
                  </button>
                  <Link href={`/quotations/${workspace.server_quotation_id}/builder`} className="inline-flex h-9 items-center border border-zinc-300 bg-white px-3 font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                    Open Legacy Builder
                  </Link>
                </div>
              </details>
              <div className="inline-flex h-9 items-center border border-emerald-900 bg-emerald-50 px-3 text-xs font-semibold text-emerald-950">
                Final Total: {formatWorkspaceMoney(workspace.currency, workspace.totals.grand_total)}
              </div>
            </div>
          </div>
          <div className="flex justify-start xl:justify-end">
            <div className="flex border border-zinc-300 text-xs font-semibold">
              <button type="button" onClick={() => setView("client")} className={`h-9 px-3 ${view === "client" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>Client View</button>
              <button type="button" onClick={() => setView("internal")} className={`h-9 border-l border-zinc-300 px-3 ${view === "internal" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>Internal View</button>
            </div>
          </div>
        </div>
      </header>

      {detailsModalItem ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/55 px-4 py-6">
          <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-hidden border border-zinc-300 bg-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Row Details</p>
                <p className="truncate text-sm font-semibold text-zinc-950">{detailsModalItem.item_name_snapshot || "Unnamed item"}</p>
                <p className="truncate text-xs text-zinc-500">
                  Code: {detailsModalItem.item_code_snapshot || "-"} / Qty {detailsModalItem.qty} / Net Total {formatTableNumber(detailsModalItem.net_total)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveLocalDraftNow(detailsModalItem.id)}
                  className="h-9 border border-emerald-900 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                >
                  Save Row
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDetailsModalRowId(null);
                    setSaveLibraryChoiceRowId(null);
                  }}
                  className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                >
                  Done
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {renderRowDetailsModalContent(detailsModalItem)}
            </div>
          </div>
        </div>
      ) : null}

      {saveLibraryChoiceItem ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-2xl border border-zinc-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Product Library</p>
                <p className="text-sm font-semibold text-zinc-950">Save row to Product Library</p>
              </div>
              <button
                type="button"
                onClick={() => setSaveLibraryChoiceRowId(null)}
                className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
              >
                Cancel
              </button>
            </div>
            <div className="grid gap-4 p-5">
              {!canManageProductLibrary ? (
                <p className="text-sm text-zinc-500">
                  Product Library saving is available to settings managers.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSaveLibraryMode("new")}
                      className={`rounded-lg border p-4 text-left transition ${saveLibraryMode === "new" ? "border-emerald-400 bg-emerald-50" : "border-zinc-200 bg-white hover:border-zinc-300"}`}
                    >
                      <p className="text-sm font-semibold text-zinc-950">New product/template</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Open the existing Add Template form with this quotation row prefilled.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSaveLibraryMode("existing")}
                      className={`rounded-lg border p-4 text-left transition ${saveLibraryMode === "existing" ? "border-emerald-400 bg-emerald-50" : "border-zinc-200 bg-white hover:border-zinc-300"}`}
                    >
                      <p className="text-sm font-semibold text-zinc-950">Existing product/template</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Open an existing template in the normal edit form and import this row there.
                      </p>
                    </button>
                  </div>
                  {saveLibraryMode === "existing" ? (
                    <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">Search existing template</span>
                        <input
                          value={saveLibraryTemplateSearch}
                          onChange={(event) => setSaveLibraryTemplateSearch(event.target.value)}
                          placeholder="Search by template name or code"
                          className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-semibold uppercase text-zinc-500">Select template</span>
                        <select
                          value={saveLibraryTemplateId}
                          onChange={(event) => setSaveLibraryTemplateId(event.target.value)}
                          className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                        >
                          <option value="">Choose existing template</option>
                          {filteredLibraryTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {[template.template_name, template.template_code || template.item_code].filter(Boolean).join(" / ")}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSaveLibraryChoiceRowId(null)}
                      className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => continueSaveToProductLibrary(saveLibraryChoiceItem)}
                      disabled={saveLibraryMode === "existing" && !saveLibraryTemplateId}
                      className="h-9 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
                    >
                      Continue
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {addInternalColumnOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/45 px-4 py-6">
          <div className="w-full max-w-md border border-zinc-300 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Internal Column</p>
                <p className="text-sm font-semibold text-zinc-950">Add internal column</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddInternalColumnOpen(false);
                  setNewInternalColumnName("");
                  setNewInternalColumnType("text");
                }}
                className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
              >
                Cancel
              </button>
            </div>
            <div className="grid gap-3 p-5">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Column name</span>
                <input
                  autoFocus
                  value={newInternalColumnName}
                  onChange={(event) => setNewInternalColumnName(event.target.value)}
                  placeholder="Factory Remark"
                  className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Column type</span>
                <select
                  value={newInternalColumnType}
                  onChange={(event) => setNewInternalColumnType(normalizeInternalCustomColumnType(event.target.value))}
                  className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAddInternalColumnOpen(false);
                    setNewInternalColumnName("");
                    setNewInternalColumnType("text");
                  }}
                  className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={createInternalCustomColumn}
                  disabled={!newInternalColumnName.trim()}
                  className="h-9 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
                >
                  Add column
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {addPrintableColumnOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/45 px-4 py-6">
          <div className="w-full max-w-md border border-zinc-300 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Printable Column</p>
                <p className="text-sm font-semibold text-zinc-950">Add printable column</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAddPrintableColumnOpen(false);
                  setNewPrintableColumnName("");
                  setNewPrintableColumnType("text");
                  setNewPrintableColumnWidth("160");
                  setNewPrintableColumnShowInClient(true);
                  setNewPrintableColumnShowInInternal(true);
                }}
                className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
              >
                Cancel
              </button>
            </div>
            <div className="grid gap-3 p-5">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500">Column name</span>
                <input
                  autoFocus
                  value={newPrintableColumnName}
                  onChange={(event) => setNewPrintableColumnName(event.target.value)}
                  placeholder="Factory Remark"
                  className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase text-zinc-500">Column type</span>
                  <select
                    value={newPrintableColumnType}
                    onChange={(event) => setNewPrintableColumnType(normalizeCustomPrintableColumnType(event.target.value))}
                    className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="percentage">Percentage</option>
                    <option value="image">Image</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase text-zinc-500">Width px</span>
                  <input
                    type="number"
                    min={40}
                    max={800}
                    value={newPrintableColumnWidth}
                    onChange={(event) => setNewPrintableColumnWidth(event.target.value)}
                    className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800"
                  />
                </label>
              </div>
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                  <input
                    type="checkbox"
                    checked={newPrintableColumnShowInClient}
                    onChange={(event) => setNewPrintableColumnShowInClient(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span>Show in Client View / PDF</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                  <input
                    type="checkbox"
                    checked={newPrintableColumnShowInInternal}
                    onChange={(event) => setNewPrintableColumnShowInInternal(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span>Show in Internal View</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAddPrintableColumnOpen(false);
                    setNewPrintableColumnName("");
                    setNewPrintableColumnType("text");
                    setNewPrintableColumnWidth("160");
                    setNewPrintableColumnShowInClient(true);
                    setNewPrintableColumnShowInInternal(true);
                  }}
                  className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={createPrintableCustomColumn}
                  disabled={!newPrintableColumnName.trim()}
                  className="h-9 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
                >
                  Add column
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {quoteDetailsOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/55 px-4 py-6">
          <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden border border-zinc-300 bg-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-300 bg-white px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Quotation Details</p>
                <p className="text-sm font-semibold text-zinc-950">{workspace.quotation_no ?? "Draft quotation"} / {currentProjectName}</p>
                <p className="text-xs text-zinc-500">Client company name stays read-only here. Quotation and linked project details save back when you use Save to Software.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuoteDetailsOpen(false)}
                  className="h-9 border border-emerald-900 bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                >
                  Save Details
                </button>
                <button
                  type="button"
                  onClick={() => setQuoteDetailsOpen(false)}
                  className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <fieldset className="border border-zinc-300 bg-white p-2.5">
                  <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Quotation</legend>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Client</span>
                      <input value={currentClientName} readOnly className="h-8 border border-zinc-300 bg-zinc-50 px-2 text-xs text-zinc-500 outline-none" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Quote No</span>
                      <input value={workspace.quotation_no ?? ""} onChange={(event) => updateQuotationDetails({ quotation_no: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Date</span>
                      <input type="date" value={workspace.quotation_date ?? ""} onChange={(event) => updateQuotationDetails({ quotation_date: event.target.value || workspace.quotation_date })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Status</span>
                      <select value={workspace.status} onChange={(event) => updateQuotationDetails({ status: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                        {quotationStatusOptions.map((option) => (
                          <option key={option} value={option}>{statusLabel(option)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Layout</span>
                      <select value={workspace.layout_mode} onChange={(event) => updateQuotationDetails({ layout_mode: event.target.value })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                        {layoutModeOptions.map((option) => (
                          <option key={option} value={option}>{layoutLabels.get(option) ?? option}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-zinc-500">
                        Supported local columns change immediately. Saved preview/PDF uses this layout after Save to Software.
                      </p>
                    </label>
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">View</span>
                      <input value={view === "internal" ? "Internal" : "Client"} readOnly className="h-8 border border-zinc-300 bg-zinc-50 px-2 text-xs text-zinc-500 outline-none" />
                    </label>
                  </div>
                </fieldset>

                <fieldset className="border border-zinc-300 bg-white p-2.5">
                  <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Project</legend>
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Project</span>
                      <input value={stringValue(projectSnapshot, "project_name")} onChange={(event) => updateProjectSnapshot({ project_name: cleanOptionalDetailValue(event.target.value) ?? "" })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Attn / Contact</span>
                      <input value={stringValue(projectSnapshot, "attention_to")} onChange={(event) => updateProjectSnapshot({ attention_to: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Location</span>
                      <input value={stringValue(projectSnapshot, "location")} onChange={(event) => updateProjectSnapshot({ location: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Mobile</span>
                      <input value={stringValue(projectSnapshot, "attention_mobile")} onChange={(event) => updateProjectSnapshot({ attention_mobile: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Telephone</span>
                      <input value={stringValue(projectSnapshot, "attention_landline")} onChange={(event) => updateProjectSnapshot({ attention_landline: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Email</span>
                      <input value={stringValue(projectSnapshot, "attention_email")} onChange={(event) => updateProjectSnapshot({ attention_email: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">PO Box</span>
                      <input value={stringValue(projectSnapshot, "po_box")} onChange={(event) => updateProjectSnapshot({ po_box: cleanOptionalDetailValue(event.target.value) })} className="h-8 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                    </label>
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-[10px] font-semibold uppercase text-zinc-500">Address</span>
                      <textarea value={stringValue(projectSnapshot, "project_address")} onChange={(event) => updateProjectSnapshot({ project_address: cleanOptionalDetailValue(event.target.value) })} rows={3} className="w-full resize-y border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-emerald-800" />
                    </label>
                  </div>
                </fieldset>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={importRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importBackup(file);
        }}
      />

      <main className="mx-auto max-w-[1900px] px-4 py-5">
        {saveMessage ? (
          <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{saveMessage}</div>
        ) : null}

        <section className="border border-zinc-300 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-300 bg-zinc-50 px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-zinc-950">Quotation Details</p>
              <p className="text-xs text-zinc-500">Edit quotation and linked project header details used by the saved software snapshot.</p>
            </div>
            <button
              type="button"
              onClick={() => setQuoteDetailsOpen(true)}
              className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
            >
              Edit Quote Details
            </button>
          </div>
          <div className="grid border-b border-zinc-300 lg:grid-cols-2">
            <div className="border-b border-zinc-300 lg:border-b-0 lg:border-r">
              <div className="border-b border-zinc-300 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide">Quotation</div>
              <SheetInfo label="Client" value={currentClientName} />
              <SheetInfo label="Attn" value={stringValue(projectSnapshot, "attention_to")} />
              <SheetInfo label="Project" value={[currentProjectName, stringValue(projectSnapshot, "project_year"), stringValue(projectSnapshot, "location")].filter(Boolean).join(" - ")} />
              <SheetInfo label="PO Box" value={stringValue(projectSnapshot, "po_box")} />
              <SheetInfo label="Mob" value={stringValue(projectSnapshot, "attention_mobile")} />
              <SheetInfo label="Tel" value={stringValue(projectSnapshot, "attention_landline")} />
              <SheetInfo label="Email" value={stringValue(projectSnapshot, "attention_email")} />
            </div>
            <div>
              <div className="border-b border-zinc-300 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide">Reference</div>
              <SheetInfo label="Quote No" value={workspace.quotation_no ?? "Draft"} />
              <SheetInfo label="Date" value={workspace.quotation_date} />
              <SheetInfo label="Status" value={statusLabel(workspace.status)} />
              <SheetInfo label="Layout" value={layoutLabels.get(workspace.layout_mode) ?? workspace.layout_mode} />
              <SheetInfo label="Location" value={stringValue(projectSnapshot, "location")} />
              <SheetInfo label="Address" value={stringValue(projectSnapshot, "project_address")} />
              <SheetInfo label="View" value={view === "internal" ? "Internal" : "Client"} />
            </div>
          </div>

          <div className="w-full">
            <QuotationSheetTable
              columns={sheetColumns}
              key={sheetColumnSignature}
              minimumTableWidth={Math.max(1480, tableWidth)}
              onColumnWidthChange={(key, width) => updateColumnSetting(key, { width })}
              onRowHeightChange={updateRowHeight}
              quotationId={workspace.server_quotation_id}
            >
              <tbody>
                {displaySections.map((section, sectionIndex) => {
                  const nextSection = displaySections[sectionIndex + 1];

                  if (section.renderAsMainOnly) {
                    const mainTotal = mainSectionTotalById.get(section.id) ?? 0;
                    return (
                      <Fragment key={section.id}>
                        <InsertSectionRow canManage onAddMain={() => addSection("main")} onAddSub={() => addSection("sub", section.id)} totalColumns={totalColumns} />
                        <tr>
                          <td colSpan={totalColumns} className={`relative border border-zinc-300 px-3 py-3 uppercase tracking-wide ${sectionTitleClass(section)}`} style={section.row_height ? { height: `${section.row_height}px` } : undefined}>
                              <div className="flex items-center justify-between gap-3">
                                <input value={section.section_title} onChange={(event) => updateSection(section.id, { section_title: event.target.value })} className="min-w-0 flex-1 bg-transparent outline-none" />
                                <div className="flex gap-2 text-[11px] normal-case">
                                  <button type="button" onClick={() => addSection("sub", section.id)} className="border border-white/20 px-2 py-1 hover:bg-white/10">+ Sub</button>
                                  <button type="button" onClick={() => moveSection(section.id, -1)} className="border border-white/20 px-2 py-1 hover:bg-white/10">Up</button>
                                  <button type="button" onClick={() => moveSection(section.id, 1)} className="border border-white/20 px-2 py-1 hover:bg-white/10">Down</button>
                                  <button type="button" onClick={() => removeSection(section.id)} className="border border-white/20 px-2 py-1 hover:bg-white/10">Remove</button>
                                </div>
                              </div>
                              <span aria-hidden="true" title="Drag to resize row" data-resize-row-id={section.id} data-resize-row-type="section" className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize border-b-2 border-transparent transition hover:border-emerald-700" />
                          </td>
                        </tr>
                        {!childrenByParent.get(section.id)?.length ? (
                          <MainSectionTotalRow currency={workspace.currency} label={section.section_title} total={mainTotal} totalColumns={totalColumns} />
                        ) : null}
                      </Fragment>
                    );
                  }

                  const sectionItems = orderedItems(workspace.items, section.id);
                  const sectionTotal = sectionTotalById.get(section.id) ?? 0;

                  return (
                    <Fragment key={section.id}>
                      <InsertSectionRow canManage onAddMain={() => addSection("main")} onAddSub={() => addSection("sub", section.parent_section_id ?? null)} totalColumns={totalColumns} />
                      <tr>
                        <td colSpan={totalColumns} className={`relative border border-zinc-300 px-3 py-2 uppercase tracking-wide ${sectionTitleClass(section)}`} style={section.row_height ? { height: `${section.row_height}px` } : undefined}>
                          <div className="flex items-center justify-between gap-3">
                            <input value={section.section_title} onChange={(event) => updateSection(section.id, { section_title: event.target.value })} className="min-w-0 flex-1 bg-transparent outline-none" />
                            <div className="flex gap-2 text-[11px] normal-case">
                              <button type="button" onClick={() => moveSection(section.id, -1)} className="border border-zinc-300 bg-white px-2 py-1 hover:border-emerald-900 hover:text-emerald-900">Up</button>
                              <button type="button" onClick={() => moveSection(section.id, 1)} className="border border-zinc-300 bg-white px-2 py-1 hover:border-emerald-900 hover:text-emerald-900">Down</button>
                              <button type="button" onClick={() => addSection("sub", section.parent_section_id ?? null)} className="border border-zinc-300 bg-white px-2 py-1 hover:border-emerald-900 hover:text-emerald-900">Add Section</button>
                              <button type="button" onClick={() => removeSection(section.id)} className="border border-red-200 bg-white px-2 py-1 text-red-700">Remove</button>
                            </div>
                          </div>
                          <span aria-hidden="true" title="Drag to resize row" data-resize-row-id={section.id} data-resize-row-type="section" className="absolute bottom-0 left-0 h-2 w-full cursor-row-resize border-b-2 border-transparent transition hover:border-emerald-700" />
                        </td>
                      </tr>
                      <tr className="bg-zinc-100 text-[11px] font-bold uppercase text-zinc-700">
                        {visibleColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`group relative border border-zinc-300 px-2 py-2 pr-4 ${col.key !== "edit" ? "pb-8" : ""} ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}`}
                          >
                            <span className="block break-words">{col.label}</span>
                              {col.key !== "edit" ? (
                                <div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                                <span className="pointer-events-auto flex items-center gap-1 text-[10px] font-semibold normal-case">
                                  <button
                                    type="button"
                                    onClick={() => moveColumnOrder(col.key, -1)}
                                    className="h-5 w-5 border border-zinc-300 bg-white text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                                    title={`Move ${col.label} left`}
                                    aria-label={`Move ${col.label} left`}
                                  >
                                    ←
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveColumnOrder(col.key, 1)}
                                    className="h-5 w-5 border border-zinc-300 bg-white text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                                    title={`Move ${col.label} right`}
                                    aria-label={`Move ${col.label} right`}
                                  >
                                    →
                                  </button>
                                </span>
                                </div>
                              ) : null}
                            <span aria-hidden="true" data-resize-column={col.key} className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r-2 border-transparent transition hover:border-emerald-700" />
                          </th>
                        ))}
                      </tr>
                      {section.section_notes ? (
                        <tr>
                          <td colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                            <textarea value={section.section_notes ?? ""} onChange={(event) => updateSection(section.id, { section_notes: event.target.value || null })} rows={2} className="w-full resize-none bg-transparent outline-none" />
                          </td>
                        </tr>
                      ) : null}
                      {!sectionItems.length ? (
                        <tr>
                          <td colSpan={totalColumns} className="border border-zinc-300 bg-white px-3 py-6 text-center text-sm text-zinc-500">No rows yet.</td>
                        </tr>
                      ) : null}
                      {sectionItems.map((item) => (
                        <Fragment key={item.id}>
                          {itemTypeDisplay(item) === "blank" ? (
                            <>
                              <tr className="align-middle" style={{ minHeight: `${itemRowMinHeight(item.row_height)}px` }}>
                                <td colSpan={isColVisible("edit") ? totalColumns - 1 : totalColumns} className="h-8 border border-zinc-300 bg-white" />
                                {isColVisible("edit") && (
                                  <td className="border border-zinc-300 bg-zinc-50 px-2 py-2 align-top text-center">
                                    <div className="flex flex-col gap-1 text-[11px] font-semibold">
                                      {copiedRowClipboard ? (
                                        <>
                                          <button type="button" onClick={() => pasteCopiedRowRelative(item.id, "above")} className="text-left text-emerald-900">Paste above</button>
                                          <button type="button" onClick={() => pasteCopiedRowRelative(item.id, "below")} className="text-left text-emerald-900">Paste below</button>
                                        </>
                                      ) : null}
                                      <button type="button" onClick={() => copyItem(item.id)} className="text-left text-emerald-900">Copy row</button>
                                      <button type="button" onClick={() => removeItem(item.id)} className="text-left text-red-700">Remove</button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </>
                          ) : itemTypeDisplay(item) === "note" ? (
                            <>
                              <tr className="align-middle" style={{ minHeight: `${itemRowMinHeight(item.row_height)}px` }}>
                                <td colSpan={isColVisible("edit") ? totalColumns - 1 : totalColumns} className="border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700 break-words whitespace-pre-wrap">
                                  <div className="grid gap-1">
                                    <input value={item.item_name_snapshot ?? "Note"} onChange={(event) => updateItem(item.id, { item_name_snapshot: event.target.value })} className="bg-transparent font-semibold outline-none w-full" />
                                    <textarea value={item.specification_snapshot ?? ""} onChange={(event) => updateItem(item.id, { specification_snapshot: event.target.value || null })} rows={3} className="w-full resize-none bg-transparent outline-none" />
                                  </div>
                                </td>
                                {isColVisible("edit") && (
                                  <td className="border border-zinc-300 bg-zinc-50 px-2 py-2 align-top text-center">
                                    <div className="flex flex-col gap-1 text-[11px] font-semibold">
                                      <button type="button" onClick={() => moveItem(section.id, item.id, -1)} className="text-left text-zinc-700">Up</button>
                                      <button type="button" onClick={() => moveItem(section.id, item.id, 1)} className="text-left text-zinc-700">Down</button>
                                      {copiedRowClipboard ? (
                                        <>
                                          <button type="button" onClick={() => pasteCopiedRowRelative(item.id, "above")} className="text-left text-emerald-900">Paste above</button>
                                          <button type="button" onClick={() => pasteCopiedRowRelative(item.id, "below")} className="text-left text-emerald-900">Paste below</button>
                                        </>
                                      ) : null}
                                      <button type="button" onClick={() => copyItem(item.id)} className="text-left text-emerald-900">Copy row</button>
                                      <button type="button" onClick={() => duplicateItem(item.id)} className="text-left text-zinc-700">Duplicate</button>
                                      <button type="button" onClick={() => removeItem(item.id)} className="text-left text-red-700">Remove</button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </>
                          ) : (() => {
                            const rowSerial = isSerialCountedLine(item) ? ++runningSerialNumber : 0;
                            const imageCellHeight = rowContentHeight(item.row_height, 118);
                            const compactCellClassName = "border border-zinc-300 px-2.5 py-2.5 align-middle text-zinc-700";
                            const dimensionValue = localDimensionValue(item);
                            const showDimensionLine = Boolean(dimensionValue && !specificationHasDimension(item.specification_snapshot, dimensionValue));
                            const originDisplay = localOriginDisplay(item);
                            const isEditingOriginCell = editingOriginCellId === item.id;
                            const displayPricing = workspaceItemDisplayPricing(workspace, item);
                            const cleanedSpecification = specificationWithoutDuplicateCode({
                              code: item.item_code_snapshot,
                              specification: item.specification_snapshot,
                            });
                            const specificationTitle = item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "";
                            const showSpecificationTitle = metadataSettings.title;
                            const showSpecificationDimension = metadataSettings.size;
                            const specificationDetailRows = [
                              metadataSettings.finish && !visibleColumnKeys.has("finish") && item.finish_snapshot
                                ? ["Finish", item.finish_snapshot]
                                : null,
                              metadataSettings.warranty && !visibleColumnKeys.has("warranty") && item.warranty_snapshot
                                ? ["Warranty", item.warranty_snapshot]
                                : null,
                            ].filter((row): row is [string, string] => Boolean(row));
                            const internalMetadata = internalItemMetadata(item);
                            const discountPercentValue = displayPricing.unitPrice > 0
                              ? exactMoneyValue(displayPricing.discountAmount / displayPricing.unitPrice * 100)
                              : 0;
                            const margin = internalMarginValues(displayPricing.netPrice, internalMetadata.costPrice ?? null);
                            const marginPercentLabel = margin.percent === null
                              ? "-"
                              : `${formatTableNumber(margin.percent)}%`;
                            const marginAmountLabel = margin.amount === null
                              ? "-"
                              : formatTableNumber(margin.amount);
                            const renderOrderedItemCell = (column: typeof visibleColumns[number]) => {
                              if (column.customPrintableColumnId) {
                                const customColumn = customPrintableColumnDefs.find((entry) => entry.id === column.customPrintableColumnId);
                                if (!customColumn) return null;

                                return (
                                  <td key={column.key} className={`${compactCellClassName} break-words`}>
                                    {customColumn.type === "text" ? (
                                      <LocalAutoResizeTextarea
                                        value={customPrintableColumnValue(item, customColumn.id)}
                                        onChange={(value) => updateItem(item.id, updateItemCustomPrintableColumnValue(item, customColumn.id, value))}
                                        placeholder={`Add ${customColumn.label.toLowerCase()}`}
                                        className="w-full resize-none overflow-hidden bg-transparent text-xs leading-5 outline-none focus:bg-emerald-50"
                                      />
                                    ) : customColumn.type === "image" ? (
                                      <LocalQuotationCustomPrintableImageCell
                                        columnId={customColumn.id}
                                        item={item}
                                        quotationId={workspace.server_quotation_id}
                                        rowHeight={item.row_height}
                                        updateItem={(patch) => updateItem(item.id, patch)}
                                      />
                                    ) : (
                                      <div className="relative grid h-full items-center">
                                        <input
                                          type="number"
                                          step="any"
                                          value={customPrintableColumnValue(item, customColumn.id)}
                                          onChange={(event) => updateItem(item.id, updateItemCustomPrintableColumnValue(item, customColumn.id, event.target.value))}
                                          className={`w-full bg-transparent text-xs outline-none ${customColumn.type === "percentage" ? "pr-5 text-center" : "text-center"}`}
                                        />
                                        {customColumn.type === "percentage" ? (
                                          <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span>
                                        ) : null}
                                      </div>
                                    )}
                                  </td>
                                );
                              }

                              if (column.internalCustomColumnId) {
                                const customColumn = customInternalColumns.find((entry) => entry.id === column.internalCustomColumnId);
                                if (!customColumn) return null;

                                return (
                                  <td key={column.key} className={`${compactCellClassName} break-words`}>
                                    {customColumn.type === "text" ? (
                                      <LocalAutoResizeTextarea
                                        value={internalCustomColumnValue(item, customColumn.id)}
                                        onChange={(value) => updateItem(item.id, updateItemInternalCustomColumnValue(item, customColumn.id, value))}
                                        placeholder={`Add ${customColumn.label.toLowerCase()}`}
                                        className="w-full resize-none overflow-hidden bg-transparent text-xs leading-5 outline-none focus:bg-emerald-50"
                                      />
                                    ) : (
                                      <div className="grid h-full items-center">
                                        <input
                                          type={customColumn.type === "date" ? "date" : "number"}
                                          step={customColumn.type === "number" ? "any" : undefined}
                                          value={internalCustomColumnValue(item, customColumn.id)}
                                          onChange={(event) => updateItem(item.id, updateItemInternalCustomColumnValue(item, customColumn.id, event.target.value))}
                                          className={`w-full bg-transparent text-xs outline-none ${customColumn.type === "number" ? "text-center" : ""}`}
                                        />
                                      </div>
                                    )}
                                  </td>
                                );
                              }

                              switch (column.key) {
                                case "manual_serial":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs`}><div className="grid h-full content-center"><input value={item.manual_serial ?? ""} onChange={(event) => updateItem(item.id, { manual_serial: cleanInlineValue(event.target.value) })} className="w-full bg-transparent text-center text-xs outline-none" /></div></td>;
                                case "s_no":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs`}>{rowSerial || "-"}</td>;
                                case "code":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={item.item_code_snapshot ?? ""} onChange={(event) => updateItem(item.id, { item_code_snapshot: event.target.value || null })} className="w-full bg-transparent text-xs font-semibold outline-none" /></div></td>;
                                case "specified_image":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="flex h-full items-center"><LocalQuotationImageCell field="specified_image_url_snapshot" item={item} quotationId={workspace.server_quotation_id} rowHeight={imageCellHeight} updateItem={(patch) => updateItem(item.id, patch)} /></div></td>;
                                case "proposed_image":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="flex h-full items-center"><LocalQuotationImageCell field="proposed_image_url_snapshot" item={item} quotationId={workspace.server_quotation_id} rowHeight={imageCellHeight} updateItem={(patch) => updateItem(item.id, patch)} /></div></td>;
                                case "specification":
                                  return <td key={column.key} className={`${compactCellClassName} break-words whitespace-pre-wrap`}><div className="flex h-full min-h-full flex-col justify-center py-0.5 text-left">{showSpecificationTitle ? (<input value={item.item_name_snapshot ?? specificationTitle} onChange={(event) => updateItem(item.id, { item_name_snapshot: cleanInlineValue(event.target.value) })} className="w-full bg-transparent text-xs font-semibold text-zinc-950 outline-none focus:bg-emerald-50" />) : (<span className="text-[10px] font-semibold uppercase text-zinc-400">Title hidden in specification</span>)}<LocalAutoResizeTextarea value={cleanedSpecification ?? ""} onChange={(value) => updateItem(item.id, { specification_snapshot: cleanInlineValue(value) })} placeholder="Click to add specification" className="mt-1 w-full resize-none overflow-hidden bg-transparent text-xs leading-5 text-zinc-700 outline-none focus:bg-emerald-50" />{showSpecificationDimension ? (<label className="mt-1 flex items-center gap-1 text-xs leading-4 text-zinc-500"><span className="font-semibold">Dimension:</span><input value={showDimensionLine ? (dimensionValue ?? "") : (item.size_snapshot ?? dimensionValue ?? "")} onChange={(event) => updateItem(item.id, { size_snapshot: cleanInlineValue(event.target.value) })} placeholder="Click to add dimension" className="min-w-0 flex-1 bg-transparent text-xs text-zinc-600 outline-none focus:bg-emerald-50" /></label>) : null}{specificationDetailRows.length ? (<dl className="mt-2 grid gap-0.5 border-t border-zinc-200 pt-1.5 text-[11px] leading-4 text-zinc-500">{specificationDetailRows.map(([label, value]) => (<div key={label} className="grid grid-cols-[88px_1fr] gap-1"><dt className="font-semibold text-zinc-500">{label}:</dt><dd className="text-zinc-600">{value}</dd></div>))}</dl>) : null}</div></td>;
                                case "origin":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="flex h-full min-h-full flex-col justify-center gap-1.5 py-0.5 text-center leading-5" onBlur={(event) => { const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null; if (!event.currentTarget.contains(nextTarget)) { setEditingOriginCellId((current) => (current === item.id ? null : current)); } }}>{isEditingOriginCell ? (<><input autoFocus value={item.brand_name_snapshot ?? (originDisplay.brand ?? "")} onChange={(event) => updateItem(item.id, { brand_name_snapshot: cleanInlineValue(event.target.value) })} placeholder="Brand" className="w-full bg-transparent text-center text-xs font-semibold text-zinc-950 outline-none focus:bg-emerald-50" /><input value={item.origin_snapshot ?? (originDisplay.origin ?? "")} onChange={(event) => updateItem(item.id, { origin_snapshot: cleanInlineValue(event.target.value) })} placeholder="Origin" className="w-full bg-transparent text-center text-xs text-zinc-700 outline-none focus:bg-emerald-50" /><input value={item.supplier_name_snapshot ?? (originDisplay.supplier ?? "")} onChange={(event) => updateItem(item.id, { supplier_name_snapshot: cleanInlineValue(event.target.value) })} placeholder="Supplier" className="w-full bg-transparent text-center text-xs text-zinc-500 outline-none focus:bg-emerald-50" /></>) : (<button type="button" onClick={() => setEditingOriginCellId(item.id)} className="w-full bg-transparent text-center outline-none">{originDisplay.primaryLine ? (<span className="block text-xs font-semibold uppercase text-zinc-950">{originDisplay.primaryLine}</span>) : (<span className="block text-xs text-zinc-400">Click to add origin / supplier</span>)}{originDisplay.supplier ? (<span className="mt-1 block text-[11px] text-zinc-500">Supplier: {originDisplay.supplier}</span>) : null}</button>)}</div></td>;
                                case "model":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={item.model_snapshot ?? ""} onChange={(event) => updateItem(item.id, { model_snapshot: cleanInlineValue(event.target.value) })} className="w-full bg-transparent text-xs outline-none" /></div></td>;
                                case "finish":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><LocalAutoResizeTextarea value={item.finish_snapshot ?? ""} onChange={(value) => updateItem(item.id, { finish_snapshot: cleanInlineValue(value) })} placeholder="Click to add finish" className="w-full resize-none overflow-hidden bg-transparent text-xs leading-5 outline-none focus:bg-emerald-50" /></td>;
                                case "size":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={item.size_snapshot ?? dimensionValue ?? ""} onChange={(event) => updateItem(item.id, { size_snapshot: cleanInlineValue(event.target.value) })} className="w-full bg-transparent text-xs outline-none" /></div></td>;
                                case "warranty":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={item.warranty_snapshot ?? ""} onChange={(event) => updateItem(item.id, { warranty_snapshot: cleanInlineValue(event.target.value) })} className="w-full bg-transparent text-xs outline-none" /></div></td>;
                                case "qty":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center`}><div className="grid h-full items-center"><input type="number" min={item.item_type === "blank" || item.item_type === "note" ? 0 : 1} step="1" value={item.qty} onChange={(event) => updateItem(item.id, { qty: event.target.value })} className="w-full bg-transparent text-center text-xs outline-none" /></div></td>;
                                case "unit_price":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center`}><div className="grid h-full items-center"><input type="number" min={0} step="any" value={displayPricing.unitPrice} onChange={(event) => updateItem(item.id, { unit_price: event.target.value })} className="w-full bg-transparent text-center text-xs outline-none" /></div></td>;
                                case "discount":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center`}><div className="grid h-full content-center"><input type="number" min={0} step="any" value={item.discount_value} onChange={(event) => updateItem(item.id, { discount_value: event.target.value })} className="w-full bg-transparent text-center text-xs outline-none" /><span className="mt-1 text-[10px] text-zinc-500">{normalizedDiscountType(item.discount_type) === "percent" ? "%" : normalizedDiscountType(item.discount_type) === "amount" ? workspace.currency : "No discount"}</span></div></td>;
                                case "discount_percentage":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs`}>{displayPricing.discountAmount > 0 ? `${formatTableNumber(discountPercentValue)}%` : "-"}</td>;
                                case "discount_amount":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center`}><div className="grid h-full content-center text-center text-xs">{formatTableNumber(displayPricing.discountAmount)}</div></td>;
                                case "net_price":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs`}>{formatTableNumber(displayPricing.netPrice)}</td>;
                                case "net_total":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs font-semibold`}>{formatTableNumber(displayPricing.netTotal)}</td>;
                                case "supplier_name":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={item.supplier_name_snapshot ?? ""} onChange={(event) => updateItem(item.id, { supplier_name_snapshot: cleanInlineValue(event.target.value) })} className="w-full bg-transparent text-xs outline-none" /></div></td>;
                                case "internal_notes":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><LocalAutoResizeTextarea value={internalMetadata.internalNotes ?? ""} onChange={(value) => updateItem(item.id, updateItemInternalMetadata(item, { internalNotes: value }))} placeholder="Add internal note" className="w-full resize-none overflow-hidden bg-transparent text-xs leading-5 outline-none focus:bg-emerald-50" /></td>;
                                case "cost_price":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center`}><div className="grid h-full items-center"><input type="number" min={0} step="any" value={internalMetadata.costPrice ?? ""} onChange={(event) => updateItem(item.id, updateItemInternalMetadata(item, { costPrice: event.target.value === "" ? null : Number(event.target.value) }))} className="w-full bg-transparent text-center text-xs outline-none" /></div></td>;
                                case "margin_percent":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs`}>{marginPercentLabel}</td>;
                                case "margin_amount":
                                  return <td key={column.key} className={`${compactCellClassName} break-words text-center text-xs`}>{marginAmountLabel}</td>;
                                case "supplier_notes":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><LocalAutoResizeTextarea value={internalMetadata.supplierNotes ?? ""} onChange={(value) => updateItem(item.id, updateItemInternalMetadata(item, { supplierNotes: value }))} placeholder="Add supplier note" className="w-full resize-none overflow-hidden bg-transparent text-xs leading-5 outline-none focus:bg-emerald-50" /></td>;
                                case "delivery_lead_time":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={internalMetadata.deliveryLeadTime ?? ""} onChange={(event) => updateItem(item.id, updateItemInternalMetadata(item, { deliveryLeadTime: event.target.value }))} className="w-full bg-transparent text-xs outline-none" /></div></td>;
                                case "internal_status":
                                  return <td key={column.key} className={`${compactCellClassName} break-words`}><div className="grid h-full content-center"><input value={internalMetadata.internalStatus ?? ""} onChange={(event) => updateItem(item.id, updateItemInternalMetadata(item, { internalStatus: event.target.value }))} className="w-full bg-transparent text-xs outline-none" /></div></td>;
                                case "edit":
                                  return <td key={column.key} className="border border-zinc-300 px-2 py-2 align-middle text-center">
                                    <div className="grid h-full min-h-full content-center justify-items-center gap-1.5" data-preserve-anchor={`item-${item.id}`}>
                                      <button type="button" onClick={() => void saveLocalDraftNow(item.id)} className="h-6 min-w-14 border border-emerald-900 bg-emerald-900 px-2 text-[11px] font-semibold text-white transition hover:bg-emerald-800">Save</button>
                                      <button type="button" onClick={() => setDetailsModalRowId(item.id)} className="h-6 min-w-20 border border-zinc-300 bg-white px-2 text-[11px] font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Edit Details</button>
                                      <span className={`text-[10px] font-semibold ${workspace.has_unsaved_changes && recentEditedRowId === item.id ? "text-zinc-500" : "text-emerald-800"}`}>{rowLocalStatus(item.id, recentEditedRowId, localDraftSaved, workspace.has_unsaved_changes)}</span>
                                      {copiedRowId === item.id ? (<span className="text-[10px] font-semibold text-emerald-800">Copied</span>) : null}
                                      <div className="flex items-center gap-1"><button type="button" onClick={() => moveItem(section.id, item.id, -1)} className="h-6 min-w-6 border border-zinc-300 bg-white px-1.5 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">^</button><button type="button" onClick={() => moveItem(section.id, item.id, 1)} className="h-6 min-w-6 border border-zinc-300 bg-white px-1.5 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">v</button></div>
                                      <SharedQuotationMoreMenu actionButtons={(<>{copiedRowClipboard ? (<><button type="button" onClick={() => pasteCopiedRowRelative(item.id, "above")} className="h-7 w-full border border-emerald-200 bg-emerald-50 px-2 text-left text-xs font-semibold text-emerald-900 transition hover:border-emerald-300">Paste copied row above</button><button type="button" onClick={() => pasteCopiedRowRelative(item.id, "below")} className="h-7 w-full border border-emerald-200 bg-emerald-50 px-2 text-left text-xs font-semibold text-emerald-900 transition hover:border-emerald-300">Paste copied row below</button></>) : null}<button type="button" onClick={() => copyItem(item.id)} className="h-7 w-full border border-emerald-200 bg-emerald-50 px-2 text-left text-xs font-semibold text-emerald-900 transition hover:border-emerald-300">Copy row</button><button type="button" onClick={() => duplicateItem(item.id)} className="h-7 w-full border border-zinc-300 bg-white px-2 text-left text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Duplicate below</button><button type="button" onClick={() => removeItem(item.id)} className="h-7 w-full border border-red-200 bg-white px-2 text-left text-xs font-semibold text-red-700 transition hover:border-red-300 hover:text-red-800">Remove</button></>)} itemId={item.id} menuClassName="absolute right-0 z-30 mt-1 w-56 border border-zinc-300 bg-white p-2 text-left shadow-lg" mergeControl={(<><label className="grid gap-1"><span className="text-[10px] font-semibold uppercase text-zinc-500">Merge</span><select value={mergeModeForItem(item)} onChange={(event) => updateItem(item.id, updateItemMergeMode(item, event.target.value))} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"><option value="none">No merge</option><option value="merge_specification">Merge spec</option><option value="merge_full_row">Merge full row</option></select></label><label className="grid gap-1 mt-2"><span className="text-[10px] font-semibold uppercase text-zinc-500">Row Height (px)</span><input type="number" min={40} value={item.row_height || ""} onChange={(event) => updateItem(item.id, { row_height: event.target.value ? clampRowHeight(Number(event.target.value)) : null })} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" placeholder="Auto" /></label></>)} />
                                    </div>
                                  </td>;
                                default:
                                  return null;
                              }
                            };

                            return (
                            <>
                              <tr className="align-middle" style={{ minHeight: `${itemRowMinHeight(item.row_height)}px` }}>
                              {visibleColumns.map((column) => renderOrderedItemCell(column))}
                            </tr>
                            <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </>
                            );
                          })()}
                        </Fragment>
                      ))}
                      <SectionTotalRow currency={workspace.currency} total={sectionTotal} totalColumns={totalColumns} />
                      <tr>
                        <td colSpan={totalColumns} className="border border-zinc-300 bg-zinc-50 px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => addItem(section.id, "custom")} className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">+ Item Row</button>
                            <button type="button" onClick={() => addItem(section.id, "note")} className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">+ Note Row</button>
                            <button type="button" onClick={() => addItem(section.id, "blank")} className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">+ Blank Row</button>
                            {copiedRowClipboard ? (
                              <>
                                <button type="button" onClick={() => pasteCopiedRow(section.id)} className="border border-emerald-900 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-800">Paste copied row</button>
                                <button type="button" onClick={clearCopiedRow} className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Clear copied row</button>
                                <span className="text-xs text-emerald-900">
                                  Copied from {copiedRowClipboard.source_quotation_label}
                                </span>
                              </>
                            ) : null}
                            <ProductLibrarySelector
                              brands={productBrands}
                              categories={productCategories}
                              components={productComponents}
                              linkedFamilies={productLinkedFamilies}
                              materialGroups={materialGroups}
                              materials={materials}
                              onAddLocalItem={(item) => addProductItem(section.id, item)}
                              quotationId={workspace.server_quotation_id}
                              returnTo={`/quotations/${workspace.server_quotation_id}/local-builder`}
                              sectionId={section.id}
                              templateMaterialGroupItems={templateMaterialGroupItems}
                              templateMaterialGroups={templateMaterialGroups}
                              templates={productTemplates}
                            />
                            <span className="ml-auto text-xs text-zinc-500">Save to Software before preview/download.</span>
                          </div>
                        </td>
                      </tr>
                      {section.parent_section_id && sectionsById.get(section.parent_section_id)?.section_kind === "main" && nextSection?.parent_section_id !== section.parent_section_id ? (
                        <MainSectionTotalRow currency={workspace.currency} label={sectionsById.get(section.parent_section_id)?.section_title ?? ""} total={mainSectionTotalById.get(section.parent_section_id) ?? 0} totalColumns={totalColumns} />
                      ) : null}
                    </Fragment>
                  );
                })}
                <InsertSectionRow canManage onAddMain={() => addSection("main")} onAddSub={() => addSection("sub")} totalColumns={totalColumns} />
                {!displaySections.length ? (
                  <tr>
                    <td colSpan={totalColumns} className="border-t border-zinc-300 bg-white p-8">
                      <div className="mx-auto max-w-xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center text-sm text-zinc-500">
                        Start with a main section like GROUND FLOOR, or add a normal section directly.
                      </div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </QuotationSheetTable>
          </div>
        </section>

        <section className="mt-4 flex justify-end">
          <div className="w-full max-w-md border border-zinc-300 bg-white text-sm">
            <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Existing PDF/spec routes still use the saved software snapshot. Save to Software before preview/download.
            </p>
            <div className="flex justify-between border-b border-zinc-300 px-3 py-2">
              <span className="font-semibold text-zinc-600">Total Price</span>
              <span>{formatWorkspaceMoney(workspace.currency, workspace.totals.subtotal)}</span>
            </div>
            <div className="flex justify-between border-b border-zinc-300 px-3 py-2">
              <span className="font-semibold text-zinc-600">Item Discount</span>
              <span>{formatWorkspaceMoney(workspace.currency, workspace.totals.discount_total)}</span>
            </div>
            <div className="border-b border-zinc-300 bg-zinc-50 px-3 py-3">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-zinc-600">Extra Discount</span>
                  <span className="text-xs text-zinc-500">
                    {formatWorkspaceMoney(workspace.currency, workspace.totals.overall_discount_amount)}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_72px]">
                  <select value={workspace.overall_discount_type} onChange={(event) => commit((current) => ({ ...current, overall_discount_type: event.target.value }), { groupKey: "quote-totals", mode: "merge" })} className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                    <option value="amount">Amount</option>
                    <option value="percent">Percent</option>
                  </select>
                  <input type="number" min={0} step="0.01" value={workspace.overall_discount_value} onChange={(event) => commit((current) => ({ ...current, overall_discount_value: Number(event.target.value) || 0 }), { groupKey: "quote-totals", mode: "merge" })} className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800" />
                  <div className="flex items-center justify-center border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-500">{workspace.overall_discount_type === "percent" ? "%" : workspace.currency}</div>
                </div>
              </div>
            </div>
            <div className="border-b border-zinc-300 px-3 py-3">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-zinc-600">Price Rounding</span>
                  {priceRoundingMetadata.last_applied_step ? (
                    <span className="text-xs text-zinc-500">Last applied: nearest {priceRoundingMetadata.last_applied_step}</span>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    value={roundingStepInput}
                    onChange={(event) => setRoundingStepInput(event.target.value)}
                    className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800"
                    placeholder="Rounding step, e.g. 5"
                  />
                  <button
                    type="button"
                    onClick={applyPriceRounding}
                    className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
                  >
                    Apply rounding
                  </button>
                  <button
                    type="button"
                    onClick={restoreRoundedPrices}
                    disabled={!Object.keys(priceRoundingMetadata.rounded_net_prices ?? {}).length}
                    className="h-9 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
                  >
                    Restore prices
                  </button>
                </div>
                <p className="text-[11px] leading-5 text-zinc-500">
                  Rounding is applied only when you click Apply. It rounds the final net selling price by adjusting the quotation U.Price, without changing discount inputs, quantity, source price, or exchange details.
                </p>
              </div>
            </div>
            <div className="flex justify-between border-b border-zinc-300 px-3 py-2">
              <span className="font-semibold text-zinc-600">VAT {workspace.vat_percent}%</span>
              <span>{formatWorkspaceMoney(workspace.currency, workspace.totals.vat_amount)}</span>
            </div>
            <div className="flex justify-between bg-emerald-950 px-3 py-3 text-base font-bold text-white">
              <span>Final Total</span>
              <span>{formatWorkspaceMoney(workspace.currency, workspace.totals.grand_total)}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
