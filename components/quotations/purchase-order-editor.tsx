"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { buildEffectiveDocumentGroups, type EffectiveDocumentGroup } from "@/lib/quotations/document-grouping";
import { normalizePurchaseOrderCurrency, purchaseOrderCurrencies } from "@/lib/quotations/purchase-order-currency";
import { PurchaseOrderDocument } from "@/components/quotations/purchase-order-document";
import { DocumentPrintSetupPanel, type PrintPlannerItem } from "@/components/quotations/document-print-setup-panel";
import { buildPurchaseOrderPages } from "@/lib/quotations/purchase-order-pages";
import type { DocumentPrintSettings } from "@/lib/quotations/document-print-settings";
import {
  DEFAULT_PURCHASE_ORDER_ITEM_OVERRIDE,
  DEFAULT_PURCHASE_ORDER_SUPPLIER_OVERRIDE,
  type PurchaseOrderColumnVisibility,
  type PurchaseOrderDocumentDetails,
  type PurchaseOrderItemOverride,
  type PurchaseOrderSupplierOverride,
  type PurchaseOrderTerms,
  type QuotationPurchaseOrderSettings,
} from "@/lib/quotations/purchase-order-settings";

type PurchaseOrderClient = {
  id: string;
  company_name: string;
};

type PurchaseOrderCompanyProfile = {
  displayName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  trn: string | null;
};

type PurchaseOrderProject = {
  id: string;
  project_name: string;
};

type PurchaseOrderQuotation = {
  id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
  currency: string;
};

type PurchaseOrderSection = {
  id: string;
  section_title: string;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
};

type PurchaseOrderItem = {
  id: string;
  section_id: string | null;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  specification_snapshot: string | null;
  finish_selections_snapshot: unknown;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_price_list_code_snapshot: string | null;
  qty: number;
  currency: string;
  imageUrl: string | null;
};

type PurchaseOrderEditorData = {
  client: PurchaseOrderClient | null;
  companyProfile: PurchaseOrderCompanyProfile;
  items: PurchaseOrderItem[];
  project: PurchaseOrderProject | null;
  quotation: PurchaseOrderQuotation;
  sections: PurchaseOrderSection[];
};

type PurchaseOrderEditorProps = {
  data: PurchaseOrderEditorData;
  defaultLogoUrl: string | null;
  defaultSettings: QuotationPurchaseOrderSettings;
  initialSettings: QuotationPurchaseOrderSettings;
  printMode: boolean;
};

type EffectiveGroup = EffectiveDocumentGroup<PurchaseOrderItem>;

type PurchaseOrderPreviewItem = {
  item: PurchaseOrderItem;
  description: string;
  size: string;
  finish: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  remark: string;
};

type EditorTab = "document" | "supplier" | "items" | "columns" | "terms";

const TAB_OPTIONS: Array<{ key: EditorTab; label: string }> = [
  { key: "document", label: "Document" },
  { key: "supplier", label: "Supplier" },
  { key: "items", label: "Items" },
  { key: "columns", label: "Columns" },
  { key: "terms", label: "Terms" },
];

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

function compactSpecification(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= 260) return normalized;
  return `${normalized.slice(0, 257).trimEnd()}...`;
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

function selectedFinishSummaries(item: Pick<PurchaseOrderItem, "finish_selections_snapshot" | "finish_snapshot">) {
  const selectedFinishes = finishSelections(item.finish_selections_snapshot)
    .filter((finish) => stringFromRecord(finish, ["type"]) !== "material_group_chart")
    .map((finish) => {
      const group = stringFromRecord(finish, ["group_label"]);
      const code = stringFromRecord(finish, ["finish_code"]);
      const name = stringFromRecord(finish, ["finish_name", "finish_value", "value", "name"]);
      const detail = [name, code].filter(Boolean).join(" / ");
      return [group, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean);

  if (selectedFinishes.length > 0) {
    return selectedFinishes;
  }

  return item.finish_snapshot?.trim() ? [item.finish_snapshot.trim()] : [];
}

function documentItemTitle(item: Pick<PurchaseOrderItem, "item_name_snapshot" | "model_snapshot" | "item_code_snapshot">) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Quotation Item";
}

function buildEffectiveGroups(items: PurchaseOrderItem[]) {
  return buildEffectiveDocumentGroups(items);
}

function groupOrderForKeys(settings: QuotationPurchaseOrderSettings, groupKeys: string[]) {
  return groupKeys.flatMap((groupKey) => settings.groupOrder[groupKey] ?? []);
}

function orderedItemsForGroup(group: EffectiveGroup, settings: QuotationPurchaseOrderSettings) {
  const preferredOrder = groupOrderForKeys(settings, group.keys);
  const orderIndex = new Map(preferredOrder.map((itemId, index) => [itemId, index]));

  return [...group.items].sort((left, right) => {
    const leftIndex = orderIndex.get(left.id);
    const rightIndex = orderIndex.get(right.id);

    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return 0;
  });
}

function firstGroupKeyForItem(group: EffectiveGroup, settings: QuotationPurchaseOrderSettings, itemId: string) {
  for (const groupKey of group.keys) {
    if ((settings.groupOrder[groupKey] ?? []).includes(itemId)) {
      return groupKey;
    }
  }

  return group.keys[0] ?? "unassigned";
}

function sectionContext(sectionId: string | null, sectionsById: Map<string, PurchaseOrderSection>) {
  const section = sectionId ? sectionsById.get(sectionId) ?? null : null;
  const mainSection = section?.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
  return {
    area: mainSection?.section_title ?? (section?.section_kind === "main" ? section.section_title : null),
    section: section && section.section_kind !== "main" ? section.section_title : null,
  };
}

function sanitizeSettingsForCompare(settings: QuotationPurchaseOrderSettings) {
  return JSON.stringify({
    documentDetails: settings.documentDetails,
    print: settings.print,
    selectedSupplierKey: settings.selectedSupplierKey,
    supplierOverrides: settings.supplierOverrides,
    itemOverrides: settings.itemOverrides,
    columnVisibility: settings.columnVisibility,
    terms: settings.terms,
    groupOrder: settings.groupOrder,
  });
}

function effectiveSupplierOverride(settings: QuotationPurchaseOrderSettings, groupKeys: string[]) {
  for (const groupKey of groupKeys) {
    const override = settings.supplierOverrides[groupKey];
    if (override) return override;
  }

  return DEFAULT_PURCHASE_ORDER_SUPPLIER_OVERRIDE;
}

function numericAmount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lineTotalFromOverride(override: PurchaseOrderItemOverride, quantity: number) {
  if (numericAmount(override.lineTotal) !== null) {
    return numericAmount(override.lineTotal);
  }

  const unitPrice = numericAmount(override.unitPrice);
  return unitPrice === null ? null : unitPrice * quantity;
}

function Field({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "email" | "number";
  value: string | number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-zinc-200 px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  rows = 3,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900"
      />
      <span className="text-sm font-semibold text-zinc-900">{label}</span>
    </label>
  );
}

function SetupPanel({
  activeTab,
  children,
  onTabChange,
}: {
  activeTab: EditorTab;
  children: ReactNode;
  onTabChange: (tab: EditorTab) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">PO Setup</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={activeTab === tab.key
                ? "rounded-full bg-emerald-900 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

export function PurchaseOrderEditor({
  data,
  defaultLogoUrl,
  defaultSettings,
  initialSettings,
  printMode,
}: PurchaseOrderEditorProps) {
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<EditorTab>("document");
  const [showSettings, setShowSettings] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const isDirty = sanitizeSettingsForCompare(settings) !== sanitizeSettingsForCompare(savedSettings);

  const sectionsById = new Map(data.sections.map((section) => [section.id, section]));
  const effectiveGroups = buildEffectiveGroups(data.items);
  const activeSupplierKey = settings.selectedSupplierKey || effectiveGroups[0]?.dedupeKey || "";
  const selectedGroup = effectiveGroups.find((group) => group.dedupeKey === activeSupplierKey) ?? effectiveGroups[0] ?? null;
  const poCurrency = normalizePurchaseOrderCurrency(settings.documentDetails.currency);
  const selectedSupplier = selectedGroup
    ? effectiveSupplierOverride(settings, selectedGroup.keys)
    : DEFAULT_PURCHASE_ORDER_SUPPLIER_OVERRIDE;
  const selectedItems = selectedGroup ? orderedItemsForGroup(selectedGroup, settings) : [];

  const previewItems: PurchaseOrderPreviewItem[] = selectedItems
    .map((item) => {
      const override = {
        ...DEFAULT_PURCHASE_ORDER_ITEM_OVERRIDE,
        ...(settings.itemOverrides[item.id] ?? {}),
      };
      if (override.hidden) return null;

      const quantity = override.quantity ?? item.qty;
      const unitPrice = numericAmount(override.unitPrice);
      const lineTotal = lineTotalFromOverride(override, quantity);

      return {
        item,
        description: override.description || documentItemTitle(item),
        size: override.size || item.size_snapshot || "",
        finish: override.finish || selectedFinishSummaries(item).join("\n"),
        quantity,
        unitPrice,
        lineTotal,
        remark: override.remark,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const subtotal = previewItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
  const hasPriceValues = previewItems.some((item) => item.unitPrice !== null || item.lineTotal !== null);
  const documentItems = previewItems.map((entry) => {
    const context = sectionContext(entry.item.section_id, sectionsById);
    return {
      id: entry.item.id,
      description: entry.description,
      context: (context.area || context.section) ? [context.area, context.section].filter(Boolean).join(" / ") : null,
      code: entry.item.item_code_snapshot,
      supplierPriceListCode: entry.item.supplier_price_list_code_snapshot,
      model: entry.item.model_snapshot,
      brandOrigin: [entry.item.brand_name_snapshot, entry.item.origin_snapshot].filter(Boolean).join(" / ") || null,
      specification: compactSpecification(entry.item.specification_snapshot),
      finish: entry.finish,
      quantity: entry.quantity,
      remark: entry.remark,
      imageUrl: entry.item.imageUrl,
      lineTotal: entry.lineTotal,
      unitPrice: entry.unitPrice,
    };
  });
  const plannerItems: PrintPlannerItem[] = buildPurchaseOrderPages({
    closing: {
      hasPriceValues,
      poDate: settings.documentDetails.poDate,
      preparedBy: settings.documentDetails.preparedBy,
      subtotal,
      supplier: selectedSupplier,
      terms: settings.terms,
    },
    columnVisibility: settings.columnVisibility,
    items: documentItems,
    print: settings.print,
  }).flatMap((page) =>
    page.items.map((item) => ({
      itemId: item.id,
      itemName: item.description,
      pageNumber: page.pageIndex + 1,
      sectionTitle: item.context || selectedGroup?.displayLabel || "Supplier",
      serial: String(item.rowNumber).padStart(2, "0"),
    })),
  );

  function updateDocumentDetails<K extends keyof PurchaseOrderDocumentDetails>(key: K, value: PurchaseOrderDocumentDetails[K]) {
    setSettings((current) => ({
      ...current,
      documentDetails: {
        ...current.documentDetails,
        [key]: value,
      },
    }));
  }

  function updateSupplierSelection(value: string) {
    setSettings((current) => ({
      ...current,
      selectedSupplierKey: value,
    }));
    setExpandedItemId(null);
  }

  function updateSupplierOverride(key: keyof PurchaseOrderSupplierOverride, value: string) {
    if (!selectedGroup) return;
    const targetKey = selectedGroup.keys[0] ?? "unassigned";

    setSettings((current) => ({
      ...current,
      supplierOverrides: {
        ...current.supplierOverrides,
        [targetKey]: {
          ...effectiveSupplierOverride(current, selectedGroup.keys),
          [key]: value,
        },
      },
    }));
  }

  function updateItemOverride(itemId: string, patch: Partial<PurchaseOrderItemOverride>) {
    setSettings((current) => ({
      ...current,
      itemOverrides: {
        ...current.itemOverrides,
        [itemId]: {
          ...DEFAULT_PURCHASE_ORDER_ITEM_OVERRIDE,
          ...(current.itemOverrides[itemId] ?? {}),
          ...patch,
        },
      },
    }));
  }

  function updateColumnVisibility<K extends keyof PurchaseOrderColumnVisibility>(key: K, value: PurchaseOrderColumnVisibility[K]) {
    setSettings((current) => ({
      ...current,
      columnVisibility: {
        ...current.columnVisibility,
        [key]: value,
      },
    }));
  }

  function updateTerms<K extends keyof PurchaseOrderTerms>(key: K, value: PurchaseOrderTerms[K]) {
    setSettings((current) => ({
      ...current,
      terms: {
        ...current.terms,
        [key]: value,
      },
    }));
  }

  function updatePrintSettings(patch: Partial<DocumentPrintSettings>) {
    setSettings((current) => ({
      ...current,
      print: {
        ...current.print,
        ...patch,
      },
    }));
  }

  function toggleManualPageBreak(itemId: string, enabled: boolean) {
    const nextBreaks = new Set(settings.print.manualPageBreaks);
    if (enabled) {
      nextBreaks.add(itemId);
    } else {
      nextBreaks.delete(itemId);
    }

    updatePrintSettings({ manualPageBreaks: Array.from(nextBreaks) });
  }

  function assignPage(itemId: string, pageNumber: number | null) {
    const nextAssignments = { ...settings.print.pageAssignments };
    if (pageNumber === null) {
      delete nextAssignments[itemId];
    } else {
      nextAssignments[itemId] = pageNumber;
    }

    updatePrintSettings({ pageAssignments: nextAssignments });
  }

  function resetManualPageBreaks() {
    updatePrintSettings({ manualPageBreaks: [], pageAssignments: {} });
    setFeedback("PO manual page breaks cleared locally.");
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    if (!selectedGroup) return;

    const ownerKey = firstGroupKeyForItem(selectedGroup, settings, itemId);
    const currentIds = (settings.groupOrder[ownerKey] && settings.groupOrder[ownerKey].length > 0)
      ? [...settings.groupOrder[ownerKey]]
      : selectedItems.map((item) => item.id);
    const currentIndex = currentIds.indexOf(itemId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentIds.length) return;

    const reordered = [...currentIds];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, movedItem);

    setSettings((current) => ({
      ...current,
      groupOrder: {
        ...current.groupOrder,
        [ownerKey]: reordered,
      },
    }));
  }

  function resetToDefaults() {
    setSettings(defaultSettings);
    setFeedback("PO settings reset locally. Save to persist the defaults.");
  }

  function saveSettings() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/quotations/${data.quotation.id}/purchase-order-settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
        });
        const payload = await response.json() as {
          success?: boolean;
          error?: string;
          details?: string;
          settings?: QuotationPurchaseOrderSettings;
        };

        if (!response.ok || !payload.success || !payload.settings) {
          throw new Error(payload.details || payload.error || "Failed to save PO settings.");
        }

        setSavedSettings(payload.settings);
        setSettings(payload.settings);
        setFeedback("PO settings saved.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to save PO settings.");
      }
    });
  }

  function downloadPdf() {
    if (isDirty) {
      setFeedback("Save PO settings before downloading to include your changes.");
      return;
    }

    window.location.href = `/quotations/${data.quotation.id}/download-purchase-order`;
  }

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 ${settings.print.orientation}; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-page + .doc-page { margin-top: 24px; }
        @media print {
          html, body { background: #ffffff; }
          html, body { margin: 0 !important; padding: 0 !important; width: ${settings.print.orientation === "portrait" ? "210mm" : "297mm"} !important; background: #fff !important; }
          .doc-page { break-after: page; page-break-after: always; margin: 0 !important; }
          .doc-page:last-child { break-after: auto; page-break-after: auto; }
          .doc-page + .doc-page { margin-top: 0 !important; }
        }
      `}</style>

      {!printMode ? (
        <div className="mx-auto mb-5 w-[297mm] max-w-full print:hidden">
          <DocumentPrintSetupPanel
            actionLabel="Save Print Settings"
            backHref={`/quotations/${data.quotation.id}`}
            dirtyMessage="You have unsaved purchase order print changes."
            feedback={feedback}
            isDirty={isDirty}
            isPending={isPending}
            onDownload={downloadPdf}
            onReset={resetToDefaults}
            onResetManualPageBreaks={resetManualPageBreaks}
            onSave={saveSettings}
            onSettingsChange={updatePrintSettings}
            onAssignPage={assignPage}
            onToggleManualPageBreak={toggleManualPageBreak}
            plannerItems={plannerItems}
            resetLabel="Reset Print Settings"
            savedMessage="Purchase order print settings match latest saved version."
            settings={settings.print}
            showSettings={showSettings}
            title="Purchase Order Print Setup"
            toggleSettings={() => setShowSettings((current) => !current)}
          >
            {effectiveGroups.length > 0 ? (
              <div className="max-w-md">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Purchase Order For</span>
                  <select
                    value={activeSupplierKey}
                    onChange={(event) => updateSupplierSelection(event.target.value)}
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  >
                    {effectiveGroups.map((group) => (
                      <option key={group.dedupeKey} value={group.dedupeKey}>
                        {group.displayLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </DocumentPrintSetupPanel>
        </div>
      ) : null}

      {!printMode && showSettings ? (
        <div className="mx-auto mb-5 w-[297mm] max-w-full print:hidden">
          <SetupPanel activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "document" ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="PO Title" value={settings.documentDetails.title} onChange={(value) => updateDocumentDetails("title", value)} />
                <Field label="PO Number" value={settings.documentDetails.poNumber} onChange={(value) => updateDocumentDetails("poNumber", value)} />
                <Field label="PO Date" type="date" value={settings.documentDetails.poDate} onChange={(value) => updateDocumentDetails("poDate", value)} />
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Currency</span>
                  <select
                    value={poCurrency}
                    onChange={(event) => updateDocumentDetails("currency", event.target.value)}
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  >
                    {purchaseOrderCurrencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>{currency.label}</option>
                    ))}
                  </select>
                </label>
                <Field label="Quotation Reference" value={settings.documentDetails.quotationReference} onChange={(value) => updateDocumentDetails("quotationReference", value)} />
                <Field label="Project Display Name" value={settings.documentDetails.projectDisplayName} onChange={(value) => updateDocumentDetails("projectDisplayName", value)} />
                <Field label="Client / Project Owner" value={settings.documentDetails.clientDisplayName} onChange={(value) => updateDocumentDetails("clientDisplayName", value)} />
                <Field label="Prepared By" value={settings.documentDetails.preparedBy} onChange={(value) => updateDocumentDetails("preparedBy", value)} />
                <Field label="Company Display Name" value={settings.documentDetails.companyDisplayName} onChange={(value) => updateDocumentDetails("companyDisplayName", value)} />
                <Field label="Company Phone" value={settings.documentDetails.phone} onChange={(value) => updateDocumentDetails("phone", value)} />
                <Field label="Company Email" type="email" value={settings.documentDetails.email} onChange={(value) => updateDocumentDetails("email", value)} />
                <Field label="TRN / VAT Number" value={settings.documentDetails.trn} onChange={(value) => updateDocumentDetails("trn", value)} />
                <div className="md:col-span-2 xl:col-span-3">
                  <TextAreaField label="Company Address" value={settings.documentDetails.address} onChange={(value) => updateDocumentDetails("address", value)} rows={2} />
                </div>
                <div className="xl:col-span-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ToggleField checked={settings.documentDetails.showLogo} label="Show Company Logo" onChange={(value) => updateDocumentDetails("showLogo", value)} />
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Logo Display Mode</span>
                    <select
                      value={settings.documentDetails.logoDisplayMode}
                      onChange={(event) => updateDocumentDetails("logoDisplayMode", event.target.value as PurchaseOrderDocumentDetails["logoDisplayMode"])}
                      className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    >
                      <option value="logo_if_available">Logo if available</option>
                      <option value="text_wordmark_fallback">Text fallback</option>
                    </select>
                  </label>
                </div>
              </div>
            ) : null}

            {activeTab === "supplier" ? (
              <div className="grid gap-4">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Supplier / Brand</span>
                  <select
                    value={activeSupplierKey}
                    onChange={(event) => updateSupplierSelection(event.target.value)}
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  >
                    {effectiveGroups.map((group) => (
                      <option key={group.dedupeKey} value={group.dedupeKey}>
                        {group.displayLabel} ({group.displayType})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedGroup ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Field label="Supplier Display Name" value={selectedSupplier.displayName} onChange={(value) => updateSupplierOverride("displayName", value)} />
                    <Field label="Contact Person" value={selectedSupplier.contactPerson} onChange={(value) => updateSupplierOverride("contactPerson", value)} />
                    <Field label="Supplier Email" type="email" value={selectedSupplier.email} onChange={(value) => updateSupplierOverride("email", value)} />
                    <Field label="Supplier Phone" value={selectedSupplier.phone} onChange={(value) => updateSupplierOverride("phone", value)} />
                    <Field label="Supplier TRN / Tax Number" value={selectedSupplier.trn} onChange={(value) => updateSupplierOverride("trn", value)} />
                    <Field label="Delivery Contact" value={selectedSupplier.deliveryContact} onChange={(value) => updateSupplierOverride("deliveryContact", value)} />
                    <div className="md:col-span-2 xl:col-span-3">
                      <TextAreaField label="Supplier Address" value={selectedSupplier.address} onChange={(value) => updateSupplierOverride("address", value)} rows={2} />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No supplier groups available for this quotation.</p>
                )}
              </div>
            ) : null}

            {activeTab === "items" ? (
              <div className="grid gap-3">
                <div className="rounded-xl border border-zinc-200">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">{selectedGroup?.displayLabel ?? "No Supplier Selected"}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{selectedGroup?.displayType ?? ""}</p>
                    </div>
                    <button type="button" onClick={() => setItemsOpen((current) => !current)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
                      {itemsOpen ? "Close" : "Open"}
                    </button>
                  </div>
                  {itemsOpen && selectedGroup ? (
                    <div className="border-t border-zinc-200 px-4 py-4">
                      <div className="grid gap-3">
                        {selectedItems.map((item, index) => {
                          const override = {
                            ...DEFAULT_PURCHASE_ORDER_ITEM_OVERRIDE,
                            ...(settings.itemOverrides[item.id] ?? {}),
                          };
                          const isExpanded = expandedItemId === item.id;

                          return (
                            <div key={item.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60">
                              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={!override.hidden}
                                    onChange={(event) => updateItemOverride(item.id, { hidden: !event.target.checked })}
                                    className="h-4 w-4 rounded border-zinc-300 text-emerald-900 focus:ring-emerald-900"
                                  />
                                  <div>
                                    <p className="text-sm font-semibold text-zinc-950">
                                      {item.manual_serial?.trim() || String(index + 1).padStart(2, "0")} - {documentItemTitle(item)}
                                    </p>
                                    <p className="mt-1 text-xs text-zinc-500">
                                      {item.item_code_snapshot ? `Code: ${item.item_code_snapshot} | ` : ""}Current Qty: {item.qty} | PO Qty: {override.quantity ?? item.qty}
                                    </p>
                                  </div>
                                </div>
                                <button type="button" onClick={() => setExpandedItemId(isExpanded ? null : item.id)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white">
                                  {isExpanded ? "Close" : "Edit"}
                                </button>
                              </div>
                              {isExpanded ? (
                                <div className="border-t border-zinc-200 bg-white px-4 py-4">
                                  <div className="grid gap-4 md:grid-cols-2">
                                    <div className="md:col-span-2">
                                      <TextAreaField label="PO Description Override" value={override.description} onChange={(value) => updateItemOverride(item.id, { description: value })} rows={2} />
                                    </div>
                                    <Field label="PO Size Override" value={override.size} onChange={(value) => updateItemOverride(item.id, { size: value })} />
                                    <Field label="PO Finish Override" value={override.finish} onChange={(value) => updateItemOverride(item.id, { finish: value })} />
                                    <Field
                                      label="PO Quantity Override"
                                      type="number"
                                      value={override.quantity ?? ""}
                                      onChange={(value) => {
                                        const parsed = Number(value);
                                        updateItemOverride(item.id, { quantity: value.trim() && Number.isFinite(parsed) ? parsed : null });
                                      }}
                                    />
                                    <Field
                                      label="PO Unit Price Override"
                                      type="number"
                                      value={override.unitPrice ?? ""}
                                      onChange={(value) => {
                                        const parsed = Number(value);
                                        updateItemOverride(item.id, { unitPrice: value.trim() && Number.isFinite(parsed) ? parsed : null });
                                      }}
                                    />
                                    <Field
                                      label="PO Total Override"
                                      type="number"
                                      value={override.lineTotal ?? ""}
                                      onChange={(value) => {
                                        const parsed = Number(value);
                                        updateItemOverride(item.id, { lineTotal: value.trim() && Number.isFinite(parsed) ? parsed : null });
                                      }}
                                    />
                                    <div className="md:col-span-2">
                                      <TextAreaField label="Item Remark / Supplier Instruction" value={override.remark} onChange={(value) => updateItemOverride(item.id, { remark: value })} rows={2} />
                                    </div>
                                    <div className="md:col-span-2 flex flex-wrap gap-2">
                                      <button type="button" onClick={() => moveItem(item.id, -1)} disabled={index === 0} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                                        Move Up
                                      </button>
                                      <button type="button" onClick={() => moveItem(item.id, 1)} disabled={index === selectedItems.length - 1} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                                        Move Down
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {activeTab === "columns" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ToggleField checked={settings.columnVisibility.image} label="Show Image" onChange={(value) => updateColumnVisibility("image", value)} />
                <ToggleField checked={settings.columnVisibility.code} label="Show Code inside Description" onChange={(value) => updateColumnVisibility("code", value)} />
                <ToggleField checked={settings.columnVisibility.supplierPriceListCode} label="Show Supplier Price List Code" onChange={(value) => updateColumnVisibility("supplierPriceListCode", value)} />
                <ToggleField checked={settings.columnVisibility.model} label="Show Model inside Description" onChange={(value) => updateColumnVisibility("model", value)} />
                <ToggleField checked={settings.columnVisibility.brandOrigin} label="Show Brand / Origin inside Description" onChange={(value) => updateColumnVisibility("brandOrigin", value)} />
                <ToggleField checked={settings.columnVisibility.size} label="Show Size" onChange={(value) => updateColumnVisibility("size", value)} />
                <ToggleField checked={settings.columnVisibility.finish} label="Show Finish" onChange={(value) => updateColumnVisibility("finish", value)} />
                <ToggleField checked={settings.columnVisibility.unitPrice} label="Show Unit Price" onChange={(value) => updateColumnVisibility("unitPrice", value)} />
                <ToggleField checked={settings.columnVisibility.lineTotal} label="Show Line Total" onChange={(value) => updateColumnVisibility("lineTotal", value)} />
                <ToggleField checked={settings.columnVisibility.remarks} label="Show Item Remarks" onChange={(value) => updateColumnVisibility("remarks", value)} />
              </div>
            ) : null}

            {activeTab === "terms" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Delivery Location" value={settings.terms.deliveryLocation} onChange={(value) => updateTerms("deliveryLocation", value)} />
                <Field label="Delivery Date / Required Date" type="date" value={settings.terms.deliveryDate} onChange={(value) => updateTerms("deliveryDate", value)} />
                <Field label="Payment Terms" value={settings.terms.paymentTerms} onChange={(value) => updateTerms("paymentTerms", value)} />
                <Field label="Warranty Note" value={settings.terms.warrantyNote} onChange={(value) => updateTerms("warrantyNote", value)} />
                <Field label="Installation Note" value={settings.terms.installationNote} onChange={(value) => updateTerms("installationNote", value)} />
                <Field label="Authorized By Name" value={settings.terms.authorizedBy} onChange={(value) => updateTerms("authorizedBy", value)} />
                <Field label="Authorized Designation" value={settings.terms.authorizedDesignation} onChange={(value) => updateTerms("authorizedDesignation", value)} />
                <div className="md:col-span-2">
                  <TextAreaField label="General PO Notes" value={settings.terms.generalNote} onChange={(value) => updateTerms("generalNote", value)} rows={5} />
                </div>
              </div>
            ) : null}
          </SetupPanel>
        </div>
      ) : null}

      <PurchaseOrderDocument
        companyLogoUrl={defaultLogoUrl}
        hasPriceValues={hasPriceValues}
        items={documentItems}
        poCurrency={poCurrency}
        settings={{
          columnVisibility: settings.columnVisibility,
          documentDetails: settings.documentDetails,
          print: settings.print,
          terms: settings.terms,
        }}
        subtotal={subtotal}
        supplier={selectedSupplier}
        supplierLabel={selectedGroup?.displayLabel || "Supplier"}
      />
    </main>
  );
}


