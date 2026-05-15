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
import { SaveRowToProductLibraryPanel } from "@/components/quotations/save-row-to-product-library-panel";
import { LocalQuotationImageCell } from "@/components/quotations/local-quotation-image-cell";
import { QuotationSheetTable } from "@/components/quotations/quotation-sheet-table";
import {
  SharedQuotationMoreMenu,
  SharedQuotationRowDetailsPanel,
} from "@/components/quotations/shared-quotation-row-details-panel";
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
  localNow,
  orderedItems,
  orderedSections,
  recalculateWorkspace,
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

const allColumns = [
  { key: "s_no", label: "S. No.", defaultWidth: 54, align: "center" },
  { key: "code", label: "Code", defaultWidth: 90, align: "left" },
  { key: "proposed_image", label: "Proposed Item Reference Image", defaultWidth: 180, align: "left" },
  { key: "specification", label: "Specifications", defaultWidth: 500, align: "left" },
  { key: "origin", label: "Origin / Supplier", defaultWidth: 136, align: "center" },
  { key: "qty", label: "Qty", defaultWidth: 70, align: "center" },
  { key: "unit_price", label: "U.Price", defaultWidth: 90, align: "center" },
  { key: "discount_amount", label: "Disc. Amount", defaultWidth: 96, align: "center" },
  { key: "net_price", label: "Net Price", defaultWidth: 96, align: "center" },
  { key: "net_total", label: "Net Total", defaultWidth: 106, align: "center" },
  { key: "edit", label: "Edit / Actions", defaultWidth: 132, align: "center" },
];
type LocalLayoutColumnSetting = {
  key: string;
  visible?: boolean;
  width?: number;
};

const minColumnWidth = 40;
const maxColumnWidth = 800;
const minRowHeight = 40;
const maxRowHeight = 600;

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

function lineDiscountAmountPerUnit(item: LocalQuotationItem) {
  return exactMoneyValue(Math.max(exactMoneyValue(item.unit_price) - exactMoneyValue(item.net_price), 0));
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
  const [hydrated, setHydrated] = useState(false);
  const [localDraftSaved, setLocalDraftSaved] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [view, setView] = useState<BuilderView>("client");
  const [recentEditedRowId, setRecentEditedRowId] = useState<string | null>(null);
  const [editingOriginCellId, setEditingOriginCellId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const importRef = useRef<HTMLInputElement | null>(null);
  const lastPersistedSignatureRef = useRef<string | null>(null);
  const clientSnapshot = (workspace.client_snapshot ?? {}) as Record<string, unknown>;
  const projectSnapshot = (workspace.project_snapshot ?? {}) as Record<string, unknown>;
  const workspaceSignature = useMemo(() => stableSerialize(workspace), [workspace]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const existing = await getWorkspaceDocument(initialWorkspace.server_quotation_id);

      if (cancelled) return;

      if (existing) {
        lastPersistedSignatureRef.current = stableSerialize(existing);
        setWorkspace(existing);
        setLocalDraftSaved(true);
      } else {
        await saveWorkspaceDocument(initialWorkspace);
        lastPersistedSignatureRef.current = stableSerialize(initialWorkspace);
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

  const layoutSettings = (workspace.layout_settings as Record<string, unknown>) || {};
  const columnSettings = new Map(
    layoutColumnSettings(layoutSettings.columns).map((column) => [column.key, column])
  );

  const visibleColumns = allColumns.map(c => ({
    ...c,
    width: columnSettings.get(c.key)?.width ?? c.defaultWidth,
    visible: columnSettings.get(c.key)?.visible ?? true
  })).filter(c => c.visible);

  const tableWidth = visibleColumns.reduce((sum, c) => sum + c.width, 0);
  const totalColumns = visibleColumns.length;
  const sheetColumns = visibleColumns.map((column) => ({ key: column.key, width: column.width }));
  const sheetColumnSignature = sheetColumns.map((column) => `${column.key}:${column.width}`).join("|");
  const isColVisible = (key: string) => visibleColumns.some(c => c.key === key);
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
    });
  }

  function updateRowHeight(type: "item" | "section", id: string, height: number) {
    const nextHeight = clampRowHeight(height);
    if (type === "section") {
      updateSection(id, { row_height: nextHeight });
      return;
    }

    updateItem(id, { row_height: nextHeight });
  }

  function commit(next: LocalQuotationWorkspace | ((current: LocalQuotationWorkspace) => LocalQuotationWorkspace)) {
    setLocalDraftSaved(false);
    setWorkspace((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      const stamped = { ...resolved, has_unsaved_changes: true, updated_at: localNow() };
      return recalculateWorkspace(stamped);
    });
    setSaveState("idle");
    setSaveMessage("");
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
    commit((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, ...committedPatch, updated_at: localNow() } : item)),
    }));
  }

  function updateSection(sectionId: string, patch: Partial<LocalQuotationSection>) {
    commit((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    }));
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

  function removeItem(itemId: string) {
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

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-300 bg-white">
        <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link href={`/clients/projects/${workspace.project_id}`} className="border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Back</Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950">{workspace.quotation_no ?? "Draft quotation"} - {workspace.title}</p>
              <p className="truncate text-xs text-zinc-500">{clientName} / {projectName}</p>
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
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveToSoftware} disabled={isPending} className="bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-400">Save to Software</button>
            <button type="button" onClick={exportBackup} className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Export Backup JSON</button>
            <button type="button" onClick={() => importRef.current?.click()} className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Import Backup JSON</button>
            <details className="relative">
              <summary className="cursor-pointer border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                Column settings
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-[400px] max-w-[calc(100vw-2rem)] border border-zinc-300 bg-white p-3 text-xs text-zinc-600 shadow-lg">
                <p className="mb-2 text-[10px] font-bold uppercase text-zinc-500">Local Column Settings</p>
                <p className="mb-3 text-xs text-zinc-500">
                  Column changes stay in this IndexedDB workspace until you use Save to Software.
                </p>
                <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                  {allColumns.map((column) => {
                    const setting = columnSettings.get(column.key);
                    const isVisible = setting?.visible ?? true;
                    const currentWidth = setting?.width ?? column.defaultWidth;
                    return (
                      <div key={column.key} className="grid grid-cols-[1fr_86px] gap-2 border border-zinc-200 bg-zinc-50 p-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                          <input type="checkbox" checked={isVisible} onChange={(e) => updateColumnSetting(column.key, { visible: e.target.checked })} className="h-4 w-4 rounded border-zinc-300" />
                          <span className="truncate" title={column.label}>Show: {column.label}</span>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Width px</span>
                          <input type="number" min={40} max={800} value={currentWidth} onChange={(e) => updateColumnSetting(column.key, { width: Number(e.target.value) || column.defaultWidth })} className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800" />
                        </label>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => commit((current) => ({ ...current, layout_settings: { ...((current.layout_settings as Record<string, unknown>) || {}), columns: [] } }))} className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">Reset Defaults</button>
                </div>
              </div>
            </details>
            <Link href={`/quotations/${workspace.server_quotation_id}`} className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Open Summary</Link>
            <Link href={`/quotations/${workspace.server_quotation_id}/builder`} className="border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">Open Legacy Builder</Link>
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
            <div className="flex border border-zinc-300 text-xs font-semibold">
              <button type="button" onClick={() => setView("client")} className={`px-3 py-2 ${view === "client" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>Client View</button>
              <button type="button" onClick={() => setView("internal")} className={`border-l border-zinc-300 px-3 py-2 ${view === "internal" ? "bg-zinc-900 text-white" : "bg-white text-zinc-700"}`}>Internal View</button>
            </div>
            <div className="border border-emerald-900 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950">
              Final Total: {formatWorkspaceMoney(workspace.currency, workspace.totals.grand_total)}
            </div>
          </div>
        </div>
      </header>

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
          <div className="grid border-b border-zinc-300 lg:grid-cols-2">
            <div className="border-b border-zinc-300 lg:border-b-0 lg:border-r">
              <div className="border-b border-zinc-300 px-3 py-2 text-center text-sm font-bold uppercase tracking-wide">Quotation</div>
              <SheetInfo label="Client" value={clientName || stringValue(clientSnapshot, "company_name") || "Unknown client"} />
              <SheetInfo label="Attn" value={stringValue(projectSnapshot, "attention_to")} />
              <SheetInfo label="Project" value={[projectName, stringValue(projectSnapshot, "project_year"), stringValue(projectSnapshot, "location")].filter(Boolean).join(" - ")} />
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
              <SheetInfo label="Layout" value={workspace.layout_mode} />
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
                          <th key={col.key} className={`relative border border-zinc-300 px-2 py-2 pr-4 ${col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : "text-left"}`}>
                            {col.label}
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
                                      <button type="button" onClick={() => duplicateItem(item.id)} className="text-left text-zinc-700">Duplicate</button>
                                      <button type="button" onClick={() => removeItem(item.id)} className="text-left text-red-700">Remove</button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                              <ItemRowResizeHandle item={item} totalColumns={totalColumns} />
                            </>
                          ) : (() => {
                            const snapshotDetails = sourceSnapshotDetails(item);
                            const rowSerial = isSerialCountedLine(item) ? ++runningSerialNumber : 0;
                            const imageCellHeight = rowContentHeight(item.row_height, 118);
                            const compactCellClassName = "border border-zinc-300 px-2.5 py-2.5 align-middle text-zinc-700";
                            const dimensionValue = localDimensionValue(item);
                            const showDimensionLine = Boolean(dimensionValue && !specificationHasDimension(item.specification_snapshot, dimensionValue));
                            const originDisplay = localOriginDisplay(item);
                            const isEditingOriginCell = editingOriginCellId === item.id;
                            const cleanedSpecification = specificationWithoutDuplicateCode({
                              code: item.item_code_snapshot,
                              specification: item.specification_snapshot,
                            });

                            return (
                            <>
                              <tr className="align-middle" style={{ minHeight: `${itemRowMinHeight(item.row_height)}px` }}>
                              {isColVisible("s_no") && <td className={`${compactCellClassName} break-words text-center text-xs`}>{rowSerial || "-"}</td>}
                              {isColVisible("code") && <td className={`${compactCellClassName} break-words`}>
                                <div className="grid h-full content-center">
                                  <input value={item.item_code_snapshot ?? ""} onChange={(event) => updateItem(item.id, { item_code_snapshot: event.target.value || null })} className="w-full bg-transparent text-xs font-semibold outline-none" />
                                </div>
                              </td>}
                              {isColVisible("proposed_image") && <td className={`${compactCellClassName} break-words`}>
                                <div className="flex h-full items-center">
                                  <LocalQuotationImageCell
                                  item={item}
                                  quotationId={workspace.server_quotation_id}
                                  rowHeight={imageCellHeight}
                                  updateItem={(patch) => updateItem(item.id, patch)}
                                />
                                </div>
                              </td>}
                              {isColVisible("specification") && <td className={`${compactCellClassName} break-words whitespace-pre-wrap`}>
                                <div className="flex h-full min-h-full flex-col justify-center py-0.5 text-left">
                                  <input
                                    value={item.item_name_snapshot ?? ""}
                                    onChange={(event) => updateItem(item.id, { item_name_snapshot: event.target.value || null })}
                                    className="w-full bg-transparent text-xs font-semibold text-zinc-950 outline-none focus:bg-emerald-50"
                                  />
                                  <LocalAutoResizeTextarea
                                    value={cleanedSpecification ?? ""}
                                    onChange={(value) => updateItem(item.id, { specification_snapshot: cleanInlineValue(value) })}
                                    placeholder="Click to add specification"
                                    className="mt-1 w-full resize-none overflow-hidden bg-transparent text-xs leading-5 text-zinc-700 outline-none focus:bg-emerald-50"
                                  />
                                  <label className="mt-1 flex items-center gap-1 text-xs leading-4 text-zinc-500">
                                    <span className="font-semibold">Dimension:</span>
                                    <input
                                      value={showDimensionLine ? (dimensionValue ?? "") : (item.size_snapshot ?? dimensionValue ?? "")}
                                      onChange={(event) => updateItem(item.id, { size_snapshot: cleanInlineValue(event.target.value) })}
                                      placeholder="Click to add dimension"
                                      className="min-w-0 flex-1 bg-transparent text-xs text-zinc-600 outline-none focus:bg-emerald-50"
                                    />
                                  </label>
                                </div>
                              </td>}
                              {isColVisible("origin") && <td className={`${compactCellClassName} break-words`}>
                                <div
                                  className="flex h-full min-h-full flex-col justify-center gap-1.5 py-0.5 text-center leading-5"
                                  onBlur={(event) => {
                                    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
                                    if (!event.currentTarget.contains(nextTarget)) {
                                      setEditingOriginCellId((current) => (current === item.id ? null : current));
                                    }
                                  }}
                                >
                                  {isEditingOriginCell ? (
                                    <>
                                      <input
                                        autoFocus
                                        value={item.brand_name_snapshot ?? (originDisplay.brand ?? "")}
                                        onChange={(event) => updateItem(item.id, { brand_name_snapshot: cleanInlineValue(event.target.value) })}
                                        placeholder="Brand"
                                        className="w-full bg-transparent text-center text-xs font-semibold text-zinc-950 outline-none focus:bg-emerald-50"
                                      />
                                      <input
                                        value={item.origin_snapshot ?? (originDisplay.origin ?? "")}
                                        onChange={(event) => updateItem(item.id, { origin_snapshot: cleanInlineValue(event.target.value) })}
                                        placeholder="Origin"
                                        className="w-full bg-transparent text-center text-xs text-zinc-700 outline-none focus:bg-emerald-50"
                                      />
                                      <input
                                        value={item.supplier_name_snapshot ?? (originDisplay.supplier ?? "")}
                                        onChange={(event) => updateItem(item.id, { supplier_name_snapshot: cleanInlineValue(event.target.value) })}
                                        placeholder="Supplier"
                                        className="w-full bg-transparent text-center text-xs text-zinc-500 outline-none focus:bg-emerald-50"
                                      />
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setEditingOriginCellId(item.id)}
                                      className="w-full bg-transparent text-center outline-none"
                                    >
                                      {originDisplay.primaryLine ? (
                                        <span className="block text-xs font-semibold uppercase text-zinc-950">
                                          {originDisplay.primaryLine}
                                        </span>
                                      ) : (
                                        <span className="block text-xs text-zinc-400">Click to add origin / supplier</span>
                                      )}
                                      {originDisplay.supplier ? (
                                        <span className="mt-1 block text-[11px] text-zinc-500">
                                          Supplier: {originDisplay.supplier}
                                        </span>
                                      ) : null}
                                    </button>
                                  )}
                                </div>
                              </td>}
                              {isColVisible("qty") && <td className={`${compactCellClassName} break-words text-center`}>
                                <div className="grid h-full items-center">
                                  <input type="number" min={item.item_type === "blank" || item.item_type === "note" ? 0 : 1} step="1" value={item.qty} onChange={(event) => updateItem(item.id, { qty: event.target.value })} className="w-full bg-transparent text-center text-xs outline-none" />
                                </div>
                              </td>}
                              {isColVisible("unit_price") && <td className={`${compactCellClassName} break-words text-center`}>
                                <div className="grid h-full items-center">
                                  <input type="number" min={0} step="any" value={item.unit_price} onChange={(event) => updateItem(item.id, { unit_price: event.target.value })} className="w-full bg-transparent text-center text-xs outline-none" />
                                </div>
                              </td>}
                              {isColVisible("discount_amount") && <td className={`${compactCellClassName} break-words text-center`}>
                                <div className="grid h-full content-center text-center text-xs">
                                  {formatTableNumber(lineDiscountAmountPerUnit(item))}
                                </div>
                              </td>}
                              {isColVisible("net_price") && <td className={`${compactCellClassName} break-words text-center text-xs`}>{formatTableNumber(item.net_price)}</td>}
                              {isColVisible("net_total") && <td className={`${compactCellClassName} break-words text-center text-xs font-semibold`}>{formatTableNumber(item.net_total)}</td>}
                              {isColVisible("edit") && <td className="border border-zinc-300 px-2 py-2 align-middle text-center">
                                <div className="grid h-full min-h-full content-center justify-items-center gap-1.5" data-preserve-anchor={`item-${item.id}`}>
                                  <button
                                    type="button"
                                    onClick={() => void saveLocalDraftNow(item.id)}
                                    className="h-6 min-w-14 border border-emerald-900 bg-emerald-900 px-2 text-[11px] font-semibold text-white transition hover:bg-emerald-800"
                                  >
                                    Save
                                  </button>
                                  <span className={`text-[10px] font-semibold ${workspace.has_unsaved_changes && recentEditedRowId === item.id ? "text-zinc-500" : "text-emerald-800"}`}>
                                    {rowLocalStatus(item.id, recentEditedRowId, localDraftSaved, workspace.has_unsaved_changes)}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button type="button" onClick={() => moveItem(section.id, item.id, -1)} className="h-6 min-w-6 border border-zinc-300 bg-white px-1.5 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">^</button>
                                    <button type="button" onClick={() => moveItem(section.id, item.id, 1)} className="h-6 min-w-6 border border-zinc-300 bg-white px-1.5 text-[11px] font-semibold leading-none text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">v</button>
                                  </div>
                                  <SharedQuotationMoreMenu
                                    actionButtons={(
                                      <>
                                        <button type="button" onClick={() => duplicateItem(item.id)} className="h-7 w-full border border-zinc-300 bg-white px-2 text-left text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                          Duplicate below
                                        </button>
                                        <button type="button" onClick={() => removeItem(item.id)} className="h-7 w-full border border-red-200 bg-white px-2 text-left text-xs font-semibold text-red-700 transition hover:border-red-300 hover:text-red-800">
                                          Remove
                                        </button>
                                      </>
                                    )}
                                    detailsContent={(
                                      <div className="grid gap-3">
                                        <SharedQuotationRowDetailsPanel
                                          basicHint={
                                            item.source_template_id
                                              ? "Item / Model Name is the main visible title at the top of the Specification cell."
                                              : "Quotation pricing stays local in this draft. Use Save to Software to write the current local row back to the server."
                                          }
                                          currencyOptions={[
                                            { code: "AED", label: "AED" },
                                            { code: "USD", label: "USD" },
                                            { code: "EUR", label: "EUR" },
                                          ]}
                                          discountTypeOptions={[
                                            { label: "None", value: "none" },
                                            { label: "Percent", value: "percent" },
                                            { label: "Amount", value: "amount" },
                                          ]}
                                          extraSectionsAfterImages={(
                                            <>
                                              <fieldset className="border border-zinc-300 bg-white p-3">
                                                <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Materials & Finishes</legend>
                                                <FinishSelectionsEditor
                                                  brands={productBrands}
                                                  allowMaterialContinuationPage={item.allow_material_continuation_page}
                                                  initialBrandId={null}
                                                  initialFinishes={finishSelectionRows(item.finish_selections_snapshot)}
                                                  materialGroups={materialGroups}
                                                  materials={materials}
                                                  onChange={(nextFinishes) =>
                                                    updateItem(item.id, {
                                                      finish_selections_snapshot: nextFinishes,
                                                      finish_snapshot: finishSnapshotValue(nextFinishes),
                                                    })
                                                  }
                                                  quotationId={workspace.server_quotation_id}
                                                  templateMaterialGroupItems={templateMaterialGroupItems.filter((entry) => {
                                                    const linkedIds = new Set(
                                                      templateMaterialGroups
                                                        .filter((group) => group.product_template_id === item.source_template_id)
                                                        .map((group) => group.id),
                                                    );
                                                    return linkedIds.has(entry.product_template_material_group_id);
                                                  })}
                                                  templateMaterialGroups={templateMaterialGroups.filter((group) => group.product_template_id === item.source_template_id)}
                                                />
                                              </fieldset>
                                              <fieldset className="border border-zinc-300 bg-white p-3">
                                                <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Manual Currency Conversion</legend>
                                                <p className="text-xs text-zinc-600">Local support coming next. Save the row locally for now; conversion application to row pricing will be expanded in the next pass.</p>
                                              </fieldset>
                                            </>
                                          )}
                                          extraSectionsBeforeSpecification={(
                                            <>
                                              <fieldset className="border border-zinc-300 bg-white p-3">
                                                <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Source / Library Price</legend>
                                                <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source template</p>
                                                    <p className="font-semibold text-zinc-900">{sourceLibrarySummary(item).templateName || "Manual row"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source code</p>
                                                    <p className="text-zinc-800">{sourceLibrarySummary(item).templateCode || "-"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Quotation row price</p>
                                                    <p className="text-zinc-800">{formatWorkspaceMoney(item.currency || workspace.currency, item.unit_price)}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source type</p>
                                                    <p className="text-zinc-800">{snapshotDetails.sourcePriceType || "TODO"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source label</p>
                                                    <p className="text-zinc-800">{snapshotDetails.sourcePriceLabel || "TODO"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source currency</p>
                                                    <p className="text-zinc-800">{snapshotDetails.sourceCurrency || "TODO"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source price</p>
                                                    <p className="text-zinc-800">{snapshotDetails.sourcePrice || "TODO"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Converted quote price</p>
                                                    <p className="text-zinc-800">
                                                      {snapshotDetails.convertedQuotePrice
                                                        ? `${snapshotDetails.quoteCurrency} ${snapshotDetails.convertedQuotePrice}`
                                                        : formatWorkspaceMoney(item.currency || workspace.currency, item.unit_price)}
                                                    </p>
                                                  </div>
                                                  <div className="md:col-span-2 xl:col-span-3">
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Source totals</p>
                                                    <p className="text-zinc-800">{snapshotDetails.sourceTotalsSummary.join(" | ") || "Single-source snapshot only"}</p>
                                                  </div>
                                                  <div className="md:col-span-2 xl:col-span-3">
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Exchange / conversion</p>
                                                    <p className="text-zinc-800">
                                                      {snapshotDetails.exchangeRatesSummary.join(" | ") ||
                                                        (snapshotDetails.convertedTotalAed ? `AED total: ${snapshotDetails.convertedTotalAed}` : "No conversion snapshot")}
                                                    </p>
                                                  </div>
                                                  <div className="md:col-span-2 xl:col-span-3">
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Selected options</p>
                                                    <p className="text-zinc-800">{snapshotDetails.selectedOptionNames.join(", ") || sourceLibrarySummary(item).selectedOptions.join(", ") || sourceLibrarySummary(item).selectedOptionIds.join(", ") || "No source option snapshot yet"}</p>
                                                  </div>
                                                </div>
                                              </fieldset>
                                              <fieldset className="border border-zinc-300 bg-white p-3">
                                                <legend className="px-1 text-[11px] font-bold uppercase text-zinc-500">Selected Product Snapshot</legend>
                                                <div className="grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-3">
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Model</p>
                                                    <p className="text-zinc-800">{snapshotDetails.model || "TODO"}</p>
                                                  </div>
                                                  <div>
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Size</p>
                                                    <p className="text-zinc-800">{snapshotDetails.size || "TODO"}</p>
                                                  </div>
                                                  <div className="md:col-span-2 xl:col-span-3">
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Accessories</p>
                                                    <p className="text-zinc-800">{snapshotDetails.accessorySummary.join(" | ") || "No accessory snapshot"}</p>
                                                  </div>
                                                  <div className="md:col-span-2 xl:col-span-3">
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Linked families</p>
                                                    <p className="text-zinc-800">{snapshotDetails.linkedFamilySummary.join(" | ") || "No linked family snapshot"}</p>
                                                  </div>
                                                  <div className="md:col-span-2 xl:col-span-3">
                                                    <p className="text-[10px] font-semibold uppercase text-zinc-500">Finish / material snapshot</p>
                                                    <p className="whitespace-pre-wrap text-zinc-800">{item.finish_snapshot || finishSnapshotValue(finishSelectionRows(item.finish_selections_snapshot)) || "No finish snapshot"}</p>
                                                  </div>
                                                </div>
                                              </fieldset>
                                            </>
                                          )}
                                          imageActions={(
                                            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                                              <button type="button" className="border border-zinc-300 bg-white px-2 py-1 text-zinc-700">Replace</button>
                                              <button type="button" className="border border-zinc-300 bg-white px-2 py-1 text-zinc-700">Paste</button>
                                              <button type="button" className="border border-zinc-300 bg-white px-2 py-1 text-zinc-700">Adjust</button>
                                            </div>
                                          )}
                                          imageNote={<p className="text-[10px] text-zinc-500">Local upload/paste/adjust support coming next.</p>}
                                          item={item}
                                          mode="local"
                                          onFieldChange={(patch) => updateItem(item.id, patch as Partial<LocalQuotationItem>)}
                                          showImagePreview
                                          showInternal={view === "internal"}
                                        />

                                        {item.item_type !== "product" ? (
                                          <SaveRowToProductLibraryPanel
                                            canManageProductLibrary={canManageProductLibrary}
                                            defaultBrandId={productBrands[0]?.id ?? ""}
                                            defaultCurrency={workspace.currency}
                                            defaultPrice={item.unit_price}
                                            descriptionDefault={item.specification_snapshot ?? ""}
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
                                            quotationId={workspace.server_quotation_id}
                                            returnTo={`/quotations/${workspace.server_quotation_id}/local-builder`}
                                            variantSpecificationDefault={item.specification_snapshot ?? ""}
                                          />
                                        ) : null}
                                      </div>
                                    )}
                                    detailsPanelClassName="absolute right-0 top-full z-40 mt-2 w-[960px] max-w-[calc(100vw-3rem)] border border-zinc-300 bg-zinc-50 p-3 shadow-lg"
                                    itemId={item.id}
                                    menuClassName="absolute right-0 z-30 mt-1 w-56 border border-zinc-300 bg-white p-2 text-left shadow-lg"
                                    mergeControl={(
                                      <>
                                        <label className="grid gap-1">
                                          <span className="text-[10px] font-semibold uppercase text-zinc-500">Merge</span>
                                          <select
                                            value={mergeModeForItem(item)}
                                            onChange={(event) => updateItem(item.id, updateItemMergeMode(item, event.target.value))}
                                            className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                          >
                                            <option value="none">No merge</option>
                                            <option value="merge_specification">Merge spec</option>
                                            <option value="merge_full_row">Merge full row</option>
                                          </select>
                                        </label>
                                        <label className="grid gap-1 mt-2">
                                          <span className="text-[10px] font-semibold uppercase text-zinc-500">Row Height (px)</span>
                                          <input
                                            type="number" min={40}
                                            value={item.row_height || ""}
                                            onChange={(event) => updateItem(item.id, { row_height: event.target.value ? clampRowHeight(Number(event.target.value)) : null })}
                                            className="h-8 w-full border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800"
                                            placeholder="Auto"
                                          />
                                        </label>
                                      </>
                                    )}
                                  />
                                </div>
                              </td>}
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
              <span className="font-semibold text-zinc-600">Total Discount</span>
              <span>{formatWorkspaceMoney(workspace.currency, workspace.totals.discount_total + workspace.totals.overall_discount_amount)}</span>
            </div>
            <div className="border-b border-zinc-300 bg-zinc-50 px-3 py-3">
              <div className="grid gap-3 sm:grid-cols-[120px_1fr_120px]">
                <select value={workspace.overall_discount_type} onChange={(event) => commit({ ...workspace, overall_discount_type: event.target.value })} className="h-9 border border-zinc-300 bg-white px-2 text-xs outline-none focus:border-emerald-800">
                  <option value="amount">Amount</option>
                  <option value="percent">Percent</option>
                </select>
                <input type="number" min={0} step="0.01" value={workspace.overall_discount_value} onChange={(event) => commit({ ...workspace, overall_discount_value: Number(event.target.value) || 0 })} className="h-9 border border-zinc-300 bg-white px-3 text-xs outline-none focus:border-emerald-800" />
                <div className="flex items-center border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-500">{workspace.overall_discount_type === "percent" ? "%" : workspace.currency}</div>
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
