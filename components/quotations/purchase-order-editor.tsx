"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
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
  qty: number;
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

type EffectiveGroup = {
  dedupeKey: string;
  displayLabel: string;
  displayType: string;
  keys: string[];
  items: PurchaseOrderItem[];
};

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

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
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

function normalizeGroupName(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim()
    .toLowerCase();
}

function itemGroupInfo(item: Pick<PurchaseOrderItem, "supplier_name_snapshot" | "brand_name_snapshot">) {
  const supplier = item.supplier_name_snapshot?.trim();
  if (supplier) {
    return { key: `supplier:${supplier}`, label: supplier, type: "Supplier" };
  }

  const brand = item.brand_name_snapshot?.trim();
  if (brand) {
    return { key: `brand:${brand}`, label: brand, type: "Brand" };
  }

  return { key: "unassigned", label: "Unassigned Supplier", type: "Unassigned Supplier" };
}

function buildEffectiveGroups(items: PurchaseOrderItem[]) {
  const rawGroups = Array.from(
    items.reduce((map, item) => {
      const group = itemGroupInfo(item);
      const existing = map.get(group.key);

      if (existing) {
        existing.items.push(item);
        return map;
      }

      map.set(group.key, { ...group, items: [item] });
      return map;
    }, new Map<string, { key: string; label: string; type: string; items: PurchaseOrderItem[] }>()),
  ).map(([, group]) => group);

  const effectiveMap = new Map<string, EffectiveGroup>();

  for (const group of rawGroups) {
    const normalizedLabel = normalizeGroupName(group.label) || group.key;
    const dedupeKey = normalizedLabel === "unassignedsupplier" ? "unassigned" : normalizedLabel;
    const existing = effectiveMap.get(dedupeKey);

    if (existing) {
      existing.keys.push(group.key);
      existing.items.push(...group.items);
      if (existing.displayType !== "Supplier" && group.type === "Supplier") {
        existing.displayType = "Supplier";
        existing.displayLabel = group.label;
      }
      continue;
    }

    effectiveMap.set(dedupeKey, {
      dedupeKey,
      displayLabel: group.label,
      displayType: group.type,
      keys: [group.key],
      items: [...group.items],
    });
  }

  return Array.from(effectiveMap.values());
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

function splitMultiline(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sanitizeSettingsForCompare(settings: QuotationPurchaseOrderSettings) {
  return JSON.stringify({
    documentDetails: settings.documentDetails,
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

function currencyAmount(value: number | null, currency: string) {
  if (value === null) return "-";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

function BrandBlock({
  companyDisplayName,
  defaultLogoUrl,
  logoDisplayMode,
  showLogo,
}: {
  companyDisplayName: string;
  defaultLogoUrl: string | null;
  logoDisplayMode: PurchaseOrderDocumentDetails["logoDisplayMode"];
  showLogo: boolean;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const shouldUseText = !showLogo || logoDisplayMode === "text_wordmark_fallback" || !defaultLogoUrl || logoFailed;

  if (shouldUseText) {
    return showLogo ? (
      <div className="max-w-[180px] text-right">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-900">{companyDisplayName || "Noa Offices"}</p>
      </div>
    ) : null;
  }

  return (
    <div className="flex justify-end">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={defaultLogoUrl}
        alt={companyDisplayName || "Noa Offices"}
        className="max-h-[55px] max-w-[180px] w-auto object-contain"
        onError={() => setLogoFailed(true)}
      />
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
  const [itemsOpen, setItemsOpen] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const isDirty = sanitizeSettingsForCompare(settings) !== sanitizeSettingsForCompare(savedSettings);

  const sectionsById = new Map(data.sections.map((section) => [section.id, section]));
  const effectiveGroups = buildEffectiveGroups(data.items);
  const activeSupplierKey = settings.selectedSupplierKey || effectiveGroups[0]?.dedupeKey || "";
  const selectedGroup = effectiveGroups.find((group) => group.dedupeKey === activeSupplierKey) ?? effectiveGroups[0] ?? null;
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
        @page { size: A4 landscape; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          html, body { background: #ffffff; }
          .po-table thead { display: table-header-group; }
          .po-table tr, .po-terms, .po-signature { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {!printMode ? (
        <div className="mx-auto mb-5 w-[297mm] max-w-full print:hidden">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Purchase Order</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/quotations/${data.quotation.id}`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                  Back to Quotation
                </Link>
                <button type="button" onClick={saveSettings} disabled={isPending} className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700">
                  {isPending ? "Saving..." : "Save PO Settings"}
                </button>
                <button type="button" onClick={resetToDefaults} disabled={isPending} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed">
                  Reset PO Settings
                </button>
                <button type="button" onClick={downloadPdf} className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800">
                  Download PDF
                </button>
              </div>
            </div>
            <div className="mt-4 text-sm text-zinc-600">
              {isDirty ? "You have unsaved PO changes." : "PO settings match latest saved version."}
            </div>
            {feedback ? <p className="mt-2 text-sm font-medium text-zinc-900">{feedback}</p> : null}
          </div>
        </div>
      ) : null}

      {!printMode ? (
        <div className="mx-auto mb-5 w-[297mm] max-w-full print:hidden">
          <SetupPanel activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "document" ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="PO Title" value={settings.documentDetails.title} onChange={(value) => updateDocumentDetails("title", value)} />
                <Field label="PO Number" value={settings.documentDetails.poNumber} onChange={(value) => updateDocumentDetails("poNumber", value)} />
                <Field label="PO Date" type="date" value={settings.documentDetails.poDate} onChange={(value) => updateDocumentDetails("poDate", value)} />
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

      <section className="mx-auto w-[297mm] max-w-full rounded-2xl border border-zinc-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] print:w-auto print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none">
        <header className="border-b border-zinc-200 pb-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                {settings.documentDetails.title || "Purchase Order"}
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-zinc-950">{selectedSupplier.displayName || selectedGroup?.displayLabel || "Supplier"}</h1>
              <p className="mt-1 text-sm text-zinc-500">{selectedGroup?.displayType ?? "Supplier"}</p>
            </div>
            <BrandBlock
              companyDisplayName={settings.documentDetails.companyDisplayName}
              defaultLogoUrl={defaultLogoUrl}
              logoDisplayMode={settings.documentDetails.logoDisplayMode}
              showLogo={settings.documentDetails.showLogo}
            />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
            <div className="grid gap-2 text-xs text-zinc-600">
              <p><span className="font-semibold text-zinc-900">Supplier:</span> {selectedSupplier.displayName || selectedGroup?.displayLabel || "-"}</p>
              {selectedSupplier.contactPerson ? <p><span className="font-semibold text-zinc-900">Contact:</span> {selectedSupplier.contactPerson}</p> : null}
              {selectedSupplier.phone ? <p><span className="font-semibold text-zinc-900">Phone:</span> {selectedSupplier.phone}</p> : null}
              {selectedSupplier.email ? <p><span className="font-semibold text-zinc-900">Email:</span> {selectedSupplier.email}</p> : null}
              {selectedSupplier.address ? <p><span className="font-semibold text-zinc-900">Address:</span> {selectedSupplier.address}</p> : null}
              {selectedSupplier.trn ? <p><span className="font-semibold text-zinc-900">TRN:</span> {selectedSupplier.trn}</p> : null}
              {selectedSupplier.deliveryContact ? <p><span className="font-semibold text-zinc-900">Delivery Contact:</span> {selectedSupplier.deliveryContact}</p> : null}
            </div>
            <div className="grid gap-2 text-xs text-zinc-600">
              <p><span className="font-semibold text-zinc-900">PO No:</span> {settings.documentDetails.poNumber || "-"}</p>
              <p><span className="font-semibold text-zinc-900">PO Date:</span> {formatDate(settings.documentDetails.poDate)}</p>
              <p><span className="font-semibold text-zinc-900">Quotation Ref:</span> {settings.documentDetails.quotationReference || "-"}</p>
              <p><span className="font-semibold text-zinc-900">Project:</span> {settings.documentDetails.projectDisplayName || data.project?.project_name || data.quotation.title}</p>
              <p><span className="font-semibold text-zinc-900">Client:</span> {settings.documentDetails.clientDisplayName || data.client?.company_name || "-"}</p>
            </div>
            <div className="grid gap-2 text-xs text-zinc-600">
              <p><span className="font-semibold text-zinc-900">Prepared By:</span> {settings.documentDetails.preparedBy || data.companyProfile.displayName || "Noa Offices"}</p>
              <p><span className="font-semibold text-zinc-900">Company:</span> {settings.documentDetails.companyDisplayName || "Noa Offices"}</p>
              {settings.documentDetails.phone ? <p><span className="font-semibold text-zinc-900">Phone:</span> {settings.documentDetails.phone}</p> : null}
              {settings.documentDetails.email ? <p><span className="font-semibold text-zinc-900">Email:</span> {settings.documentDetails.email}</p> : null}
              {settings.documentDetails.address ? <p><span className="font-semibold text-zinc-900">Address:</span> {settings.documentDetails.address}</p> : null}
              {settings.documentDetails.trn ? <p><span className="font-semibold text-zinc-900">TRN / VAT:</span> {settings.documentDetails.trn}</p> : null}
            </div>
          </div>
        </header>

        <div className="mt-5 overflow-hidden border border-zinc-200">
          <table className="po-table w-full border-collapse text-left text-[11px] text-zinc-700">
            <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="w-[6%] border-b border-zinc-200 px-3 py-3">S.No</th>
                {settings.columnVisibility.image ? <th className="w-[10%] border-b border-zinc-200 px-3 py-3">Image</th> : null}
                <th className="border-b border-zinc-200 px-3 py-3">Description</th>
                {settings.columnVisibility.size ? <th className="w-[12%] border-b border-zinc-200 px-3 py-3">Size</th> : null}
                {settings.columnVisibility.finish ? <th className="w-[14%] border-b border-zinc-200 px-3 py-3">Finish</th> : null}
                <th className="w-[8%] border-b border-zinc-200 px-3 py-3 text-center">Qty</th>
                {settings.columnVisibility.unitPrice ? <th className="w-[12%] border-b border-zinc-200 px-3 py-3 text-right">Unit Price</th> : null}
                {settings.columnVisibility.lineTotal ? <th className="w-[12%] border-b border-zinc-200 px-3 py-3 text-right">Total</th> : null}
              </tr>
            </thead>
            <tbody>
              {previewItems.map((entry, itemIndex) => {
                const context = sectionContext(entry.item.section_id, sectionsById);
                const specification = compactSpecification(entry.item.specification_snapshot);
                const finishLines = splitMultiline(entry.finish);

                return (
                  <tr key={entry.item.id} className={itemIndex % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}>
                    <td className="align-top border-b border-zinc-200 px-3 py-3 text-xs font-semibold text-zinc-900">{String(itemIndex + 1).padStart(2, "0")}</td>
                    {settings.columnVisibility.image ? (
                      <td className="align-top border-b border-zinc-200 px-3 py-3">
                        <div className="h-20 w-20 overflow-hidden border border-zinc-200 bg-white">
                          <QuotationImageFrame
                            alt={entry.description}
                            className="h-full w-full overflow-hidden"
                            emptyContent={<span className="flex h-full items-center justify-center px-2 text-center text-[10px] text-zinc-400">No image</span>}
                            imageUrl={entry.item.imageUrl}
                          />
                        </div>
                      </td>
                    ) : null}
                    <td className="align-top border-b border-zinc-200 px-3 py-3">
                      <p className="font-semibold text-zinc-900">{entry.description}</p>
                      <div className="mt-2 grid gap-1 text-[11px] leading-5">
                        {(context.area || context.section) ? <p className="text-zinc-500">{[context.area, context.section].filter(Boolean).join(" / ")}</p> : null}
                        {settings.columnVisibility.code && entry.item.item_code_snapshot ? <p><span className="font-semibold text-zinc-900">Code:</span> {entry.item.item_code_snapshot}</p> : null}
                        {settings.columnVisibility.model && entry.item.model_snapshot ? <p><span className="font-semibold text-zinc-900">Model:</span> {entry.item.model_snapshot}</p> : null}
                        {settings.columnVisibility.brandOrigin && (entry.item.brand_name_snapshot || entry.item.origin_snapshot) ? (
                          <p><span className="font-semibold text-zinc-900">Brand / Origin:</span> {[entry.item.brand_name_snapshot, entry.item.origin_snapshot].filter(Boolean).join(" / ")}</p>
                        ) : null}
                        {specification ? <p className="text-zinc-600">{specification}</p> : null}
                        {settings.columnVisibility.remarks && entry.remark ? <p className="text-zinc-600"><span className="font-semibold text-zinc-900">Remark:</span> {entry.remark}</p> : null}
                      </div>
                    </td>
                    {settings.columnVisibility.size ? <td className="align-top border-b border-zinc-200 px-3 py-3">{entry.size || "-"}</td> : null}
                    {settings.columnVisibility.finish ? (
                      <td className="align-top border-b border-zinc-200 px-3 py-3">
                        {finishLines.length ? (
                          <div className="grid gap-1">
                            {finishLines.map((finish, finishIndex) => (
                              <p key={`${entry.item.id}-finish-${finishIndex}`}>{finish}</p>
                            ))}
                          </div>
                        ) : (
                          <p>-</p>
                        )}
                      </td>
                    ) : null}
                    <td className="align-top border-b border-zinc-200 px-3 py-3 text-center font-semibold text-zinc-900">{entry.quantity}</td>
                    {settings.columnVisibility.unitPrice ? <td className="align-top border-b border-zinc-200 px-3 py-3 text-right">{currencyAmount(entry.unitPrice, data.quotation.currency)}</td> : null}
                    {settings.columnVisibility.lineTotal ? <td className="align-top border-b border-zinc-200 px-3 py-3 text-right font-semibold text-zinc-900">{currencyAmount(entry.lineTotal, data.quotation.currency)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <section className="po-terms border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Terms / Notes</p>
            <div className="mt-3 grid gap-2 text-sm text-zinc-700">
              {settings.terms.deliveryLocation ? <p><span className="font-semibold text-zinc-900">Delivery Location:</span> {settings.terms.deliveryLocation}</p> : null}
              {settings.terms.deliveryDate ? <p><span className="font-semibold text-zinc-900">Delivery Date:</span> {formatDate(settings.terms.deliveryDate)}</p> : null}
              {settings.terms.paymentTerms ? <p><span className="font-semibold text-zinc-900">Payment Terms:</span> {settings.terms.paymentTerms}</p> : null}
              {settings.terms.warrantyNote ? <p><span className="font-semibold text-zinc-900">Warranty:</span> {settings.terms.warrantyNote}</p> : null}
              {settings.terms.installationNote ? <p><span className="font-semibold text-zinc-900">Installation:</span> {settings.terms.installationNote}</p> : null}
              {splitMultiline(settings.terms.generalNote).map((line, index) => (
                <p key={`po-term-${index}`}>{line}</p>
              ))}
            </div>
          </section>

          <section className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Totals</p>
            <div className="mt-4 grid gap-3 text-sm text-zinc-700">
              <div className="flex items-center justify-between gap-4">
                <span>Subtotal</span>
                <span className="font-semibold text-zinc-900">{hasPriceValues ? currencyAmount(subtotal, data.quotation.currency) : "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-3">
                <span className="font-semibold text-zinc-900">Grand Total</span>
                <span className="font-semibold text-zinc-900">{hasPriceValues ? currencyAmount(subtotal, data.quotation.currency) : "-"}</span>
              </div>
            </div>
          </section>
        </div>

        <section className="po-signature mt-5 grid gap-4 md:grid-cols-4">
          <div className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Prepared By</p>
            <p className="mt-6 text-sm font-semibold text-zinc-900">{settings.documentDetails.preparedBy || "-"}</p>
          </div>
          <div className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Authorized Signature</p>
            <p className="mt-6 text-sm font-semibold text-zinc-900">{settings.terms.authorizedBy || "-"}</p>
            {settings.terms.authorizedDesignation ? <p className="mt-1 text-xs text-zinc-500">{settings.terms.authorizedDesignation}</p> : null}
          </div>
          <div className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Date</p>
            <p className="mt-6 text-sm font-semibold text-zinc-900">{formatDate(settings.documentDetails.poDate)}</p>
          </div>
          <div className="border border-zinc-200 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Company Stamp</p>
            <div className="mt-6 h-8 border-b border-zinc-300" />
          </div>
        </section>
      </section>
    </main>
  );
}
