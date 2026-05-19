"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import {
  type ProcurementRfqColumnVisibility,
  type ProcurementRfqDocumentDetails,
  type ProcurementRfqItemOverride,
  type ProcurementRfqNotes,
  type ProcurementRfqSupplierOverride,
  type QuotationProcurementRfqSettings,
} from "@/lib/quotations/procurement-rfq-settings";

type ProcurementRfqClient = {
  id: string;
  company_name: string;
};

type ProcurementRfqCompanyProfile = {
  displayName: string;
  phone: string | null;
  email: string | null;
};

type ProcurementRfqProject = {
  id: string;
  project_name: string;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

type ProcurementRfqQuotation = {
  id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
};

type ProcurementRfqSection = {
  id: string;
  section_title: string;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
};

type ProcurementRfqItem = {
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

type ProcurementRfqEditorData = {
  client: ProcurementRfqClient | null;
  companyProfile: ProcurementRfqCompanyProfile;
  items: ProcurementRfqItem[];
  project: ProcurementRfqProject | null;
  quotation: ProcurementRfqQuotation;
  sections: ProcurementRfqSection[];
};

type ProcurementRfqEditorProps = {
  data: ProcurementRfqEditorData;
  defaultLogoUrl: string | null;
  defaultSettings: QuotationProcurementRfqSettings;
  initialSettings: QuotationProcurementRfqSettings;
  printMode: boolean;
};

type PreviewGroup = {
  key: string;
  label: string;
  type: string;
  supplier: ProcurementRfqSupplierOverride;
  items: Array<{
    item: ProcurementRfqItem;
    description: string;
    finish: string;
    quantity: number;
    remark: string;
    size: string;
  }>;
};

type EffectiveGroup = {
  dedupeKey: string;
  displayLabel: string;
  displayType: string;
  keys: string[];
  items: ProcurementRfqItem[];
};

type EditorTab = "document" | "suppliers" | "items" | "columns" | "notes";

const TAB_OPTIONS: Array<{ key: EditorTab; label: string }> = [
  { key: "document", label: "Document" },
  { key: "suppliers", label: "Suppliers" },
  { key: "items", label: "Items" },
  { key: "columns", label: "Columns" },
  { key: "notes", label: "Notes" },
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

function selectedFinishSummaries(item: Pick<ProcurementRfqItem, "finish_selections_snapshot" | "finish_snapshot">) {
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

function documentItemTitle(item: Pick<ProcurementRfqItem, "item_name_snapshot" | "model_snapshot" | "item_code_snapshot">) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Quotation Item";
}

function normalizeGroupName(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim()
    .toLowerCase();
}

function itemGroupInfo(item: Pick<ProcurementRfqItem, "supplier_name_snapshot" | "brand_name_snapshot">) {
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

function sectionContext(sectionId: string | null, sectionsById: Map<string, ProcurementRfqSection>) {
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

function sanitizeSettingsForCompare(settings: QuotationProcurementRfqSettings) {
  return JSON.stringify({
    documentDetails: settings.documentDetails,
    supplierOverrides: settings.supplierOverrides,
    itemOverrides: settings.itemOverrides,
    columnVisibility: settings.columnVisibility,
    notes: settings.notes,
    groupOrder: settings.groupOrder,
  });
}

function effectiveSupplierOverride(settings: QuotationProcurementRfqSettings, groupKeys: string[]) {
  for (const groupKey of groupKeys) {
    const override = settings.supplierOverrides[groupKey];
    if (override) return override;
  }

  return {
    displayName: "",
    contactPerson: "",
    email: "",
    phone: "",
    address: "",
  };
}

function buildEffectiveGroups(items: ProcurementRfqItem[]) {
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
    }, new Map<string, { key: string; label: string; type: string; items: ProcurementRfqItem[] }>()),
  ).map(([, group]) => group);

  const effectiveMap = new Map<string, EffectiveGroup>();

  for (const group of rawGroups) {
    const normalizedLabel = normalizeGroupName(group.label) || group.key;
    const dedupeKey = normalizedLabel === "unassignedsupplier"
      ? "unassigned"
      : normalizedLabel;
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

function groupOrderForKeys(settings: QuotationProcurementRfqSettings, groupKeys: string[]) {
  return groupKeys.flatMap((groupKey) => settings.groupOrder[groupKey] ?? []);
}

function orderedItemsForGroup(group: EffectiveGroup, settings: QuotationProcurementRfqSettings) {
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

function firstGroupKeyForItem(group: EffectiveGroup, settings: QuotationProcurementRfqSettings, itemId: string) {
  for (const groupKey of group.keys) {
    if ((settings.groupOrder[groupKey] ?? []).includes(itemId)) {
      return groupKey;
    }
  }

  return group.keys[0] ?? "unassigned";
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
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
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
      <span>
        <span className="block text-sm font-semibold text-zinc-900">{label}</span>
        {description ? <span className="block text-xs text-zinc-500">{description}</span> : null}
      </span>
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">RFQ Setup</p>
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

function SupplierSummary({
  group,
  override,
}: {
  group: EffectiveGroup;
  override: ProcurementRfqSupplierOverride;
}) {
  const detailCount = [override.contactPerson, override.email, override.phone, override.address].filter(Boolean).length;

  return (
    <div>
      <p className="text-sm font-semibold text-zinc-950">{override.displayName || group.displayLabel}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{group.displayType}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {group.items.length} item{group.items.length === 1 ? "" : "s"}
        {detailCount ? ` | ${detailCount} contact field${detailCount === 1 ? "" : "s"} filled` : ""}
      </p>
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
  logoDisplayMode: ProcurementRfqDocumentDetails["logoDisplayMode"];
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
        className="max-h-[58px] max-w-[190px] w-auto object-contain"
        onError={() => setLogoFailed(true)}
      />
    </div>
  );
}

export function ProcurementRfqEditor({
  data,
  defaultLogoUrl,
  defaultSettings,
  initialSettings,
  printMode,
}: ProcurementRfqEditorProps) {
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<EditorTab>("document");
  const [expandedSupplierKey, setExpandedSupplierKey] = useState<string | null>(null);
  const [expandedItemGroupKey, setExpandedItemGroupKey] = useState<string | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const isDirty = sanitizeSettingsForCompare(settings) !== sanitizeSettingsForCompare(savedSettings);

  const sectionsById = new Map(data.sections.map((section) => [section.id, section]));
  const effectiveGroups = buildEffectiveGroups(data.items);

  const previewGroups: PreviewGroup[] = effectiveGroups.map((group) => {
    const supplier = effectiveSupplierOverride(settings, group.keys);
    const orderedItems = orderedItemsForGroup(group, settings);
    const items = orderedItems
      .map((item) => {
        const override = settings.itemOverrides[item.id];
        if (override?.hidden) return null;

        return {
          item,
          description: override?.description || documentItemTitle(item),
          finish: override?.finish || selectedFinishSummaries(item).join("\n"),
          quantity: override?.quantity ?? item.qty,
          remark: override?.remark ?? "",
          size: override?.size || item.size_snapshot || "",
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return {
      key: group.dedupeKey,
      label: supplier.displayName || group.displayLabel,
      type: group.displayType,
      supplier,
      items,
    };
  }).filter((group) => group.items.length > 0);

  function updateDocumentDetails<K extends keyof ProcurementRfqDocumentDetails>(key: K, value: ProcurementRfqDocumentDetails[K]) {
    setSettings((current) => ({
      ...current,
      documentDetails: {
        ...current.documentDetails,
        [key]: value,
      },
    }));
  }

  function updateSupplierOverride(groupKeys: string[], key: keyof ProcurementRfqSupplierOverride, value: string) {
    const targetKey = groupKeys[0] ?? "unassigned";

    setSettings((current) => ({
      ...current,
      supplierOverrides: {
        ...current.supplierOverrides,
        [targetKey]: {
          ...effectiveSupplierOverride(current, groupKeys),
          [key]: value,
        },
      },
    }));
  }

  function updateItemOverride(itemId: string, patch: Partial<ProcurementRfqItemOverride>) {
    setSettings((current) => ({
      ...current,
      itemOverrides: {
        ...current.itemOverrides,
        [itemId]: {
          ...(current.itemOverrides[itemId] ?? {
            hidden: false,
            description: "",
            size: "",
            finish: "",
            quantity: null,
            remark: "",
          }),
          ...patch,
        },
      },
    }));
  }

  function updateColumnVisibility<K extends keyof ProcurementRfqColumnVisibility>(key: K, value: ProcurementRfqColumnVisibility[K]) {
    setSettings((current) => ({
      ...current,
      columnVisibility: {
        ...current.columnVisibility,
        [key]: value,
      },
    }));
  }

  function updateNotes<K extends keyof ProcurementRfqNotes>(key: K, value: ProcurementRfqNotes[K]) {
    setSettings((current) => ({
      ...current,
      notes: {
        ...current.notes,
        [key]: value,
      },
    }));
  }

  function moveItem(group: EffectiveGroup, itemId: string, direction: -1 | 1) {
    const ownerKey = firstGroupKeyForItem(group, settings, itemId);
    const currentIds = (settings.groupOrder[ownerKey] && settings.groupOrder[ownerKey].length > 0)
      ? [...settings.groupOrder[ownerKey]]
      : orderedItemsForGroup(group, settings).map((item) => item.id);
    const currentIndex = currentIds.indexOf(itemId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentIds.length) {
      return;
    }

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
    setFeedback("RFQ settings reset locally. Save to persist the defaults.");
  }

  function saveSettings() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/quotations/${data.quotation.id}/procurement-rfq-settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
        });
        const payload = await response.json() as {
          success?: boolean;
          error?: string;
          details?: string;
          settings?: QuotationProcurementRfqSettings;
        };

        if (!response.ok || !payload.success || !payload.settings) {
          throw new Error(payload.details || payload.error || "Failed to save RFQ settings.");
        }

        setSavedSettings(payload.settings);
        setSettings(payload.settings);
        setFeedback("RFQ settings saved.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to save RFQ settings.");
      }
    });
  }

  function downloadPdf() {
    if (isDirty) {
      setFeedback("Save RFQ settings before downloading to include your changes.");
      return;
    }

    window.location.href = `/quotations/${data.quotation.id}/download-procurement-rfq`;
  }

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          html, body { background: #ffffff; }
          .rfq-group { break-before: page; page-break-before: always; }
          .rfq-group:first-of-type { break-before: auto; page-break-before: auto; }
          .rfq-table thead { display: table-header-group; }
          .rfq-table tr, .rfq-response, .rfq-notes { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {!printMode ? (
        <div className="mx-auto mb-5 w-[297mm] max-w-full print:hidden">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Procurement / Supplier RFQ</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/quotations/${data.quotation.id}`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                  Back to Quotation
                </Link>
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={isPending}
                  className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-700"
                >
                  {isPending ? "Saving..." : "Save RFQ Settings"}
                </button>
                <button
                  type="button"
                  onClick={resetToDefaults}
                  disabled={isPending}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed"
                >
                  Reset RFQ Settings
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
                >
                  Download PDF
                </button>
              </div>
            </div>
            <div className="mt-4 text-sm text-zinc-600">
              {isDirty ? "You have unsaved RFQ changes." : "RFQ settings match latest saved version."}
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
                <Field label="RFQ Title" value={settings.documentDetails.title} onChange={(value) => updateDocumentDetails("title", value)} />
                <Field label="RFQ Number" value={settings.documentDetails.rfqNumber} onChange={(value) => updateDocumentDetails("rfqNumber", value)} />
                <Field label="RFQ Date" type="date" value={settings.documentDetails.rfqDate} onChange={(value) => updateDocumentDetails("rfqDate", value)} />
                <Field label="Quotation Date" type="date" value={settings.documentDetails.quotationDate} onChange={(value) => updateDocumentDetails("quotationDate", value)} />
                <Field label="Project Display Name" value={settings.documentDetails.projectDisplayName} onChange={(value) => updateDocumentDetails("projectDisplayName", value)} />
                <Field label="Client Display Name" value={settings.documentDetails.clientDisplayName} onChange={(value) => updateDocumentDetails("clientDisplayName", value)} />
                <Field label="Prepared By" value={settings.documentDetails.preparedBy} onChange={(value) => updateDocumentDetails("preparedBy", value)} />
                <Field label="Project Contact" value={settings.documentDetails.projectContact} onChange={(value) => updateDocumentDetails("projectContact", value)} />
                <Field label="Phone" value={settings.documentDetails.phone} onChange={(value) => updateDocumentDetails("phone", value)} />
                <Field label="Email" type="email" value={settings.documentDetails.email} onChange={(value) => updateDocumentDetails("email", value)} />
                <Field label="PO Box" value={settings.documentDetails.poBox} onChange={(value) => updateDocumentDetails("poBox", value)} />
                <Field label="Company Display Name" value={settings.documentDetails.companyDisplayName} onChange={(value) => updateDocumentDetails("companyDisplayName", value)} />
                <div className="xl:col-span-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ToggleField
                    checked={settings.documentDetails.showLogo}
                    label="Show Company Logo"
                    description="Uses the local same-origin RFQ logo asset."
                    onChange={(value) => updateDocumentDetails("showLogo", value)}
                  />
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Logo Display Mode</span>
                    <select
                      value={settings.documentDetails.logoDisplayMode}
                      onChange={(event) => updateDocumentDetails("logoDisplayMode", event.target.value as ProcurementRfqDocumentDetails["logoDisplayMode"])}
                      className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    >
                      <option value="logo_if_available">Logo if available</option>
                      <option value="text_wordmark_fallback">Text wordmark fallback</option>
                    </select>
                  </label>
                </div>
              </div>
            ) : null}

            {activeTab === "suppliers" ? (
              <div className="grid gap-3">
                {effectiveGroups.map((group) => {
                  const override = effectiveSupplierOverride(settings, group.keys);
                  const isExpanded = expandedSupplierKey === group.dedupeKey;

                  return (
                    <div key={group.dedupeKey} className="rounded-xl border border-zinc-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <SupplierSummary group={group} override={override} />
                        <button
                          type="button"
                          onClick={() => setExpandedSupplierKey(isExpanded ? null : group.dedupeKey)}
                          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        >
                          {isExpanded ? "Close" : "Edit"}
                        </button>
                      </div>
                      {isExpanded ? (
                        <div className="border-t border-zinc-200 px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            <Field label="Supplier Display Name" value={override.displayName} onChange={(value) => updateSupplierOverride(group.keys, "displayName", value)} />
                            <Field label="Contact Person" value={override.contactPerson} onChange={(value) => updateSupplierOverride(group.keys, "contactPerson", value)} />
                            <Field label="Supplier Email" type="email" value={override.email} onChange={(value) => updateSupplierOverride(group.keys, "email", value)} />
                            <Field label="Supplier Phone" value={override.phone} onChange={(value) => updateSupplierOverride(group.keys, "phone", value)} />
                            <div className="md:col-span-2 xl:col-span-3">
                              <TextAreaField label="Supplier Address" value={override.address} onChange={(value) => updateSupplierOverride(group.keys, "address", value)} rows={2} />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {activeTab === "items" ? (
              <div className="grid gap-3">
                {effectiveGroups.map((group) => {
                  const orderedItems = orderedItemsForGroup(group, settings);
                  const isGroupExpanded = expandedItemGroupKey === group.dedupeKey;

                  return (
                    <div key={group.dedupeKey} className="rounded-xl border border-zinc-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-950">{group.displayLabel}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{group.displayType}</p>
                          <p className="mt-1 text-xs text-zinc-500">{orderedItems.length} item{orderedItems.length === 1 ? "" : "s"}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedItemGroupKey(isGroupExpanded ? null : group.dedupeKey);
                            if (isGroupExpanded) setExpandedItemId(null);
                          }}
                          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
                        >
                          {isGroupExpanded ? "Close" : "Open"}
                        </button>
                      </div>
                      {isGroupExpanded ? (
                        <div className="border-t border-zinc-200 px-4 py-4">
                          <div className="grid gap-3">
                            {orderedItems.map((item, index) => {
                              const override = settings.itemOverrides[item.id] ?? {
                                hidden: false,
                                description: "",
                                size: "",
                                finish: "",
                                quantity: null,
                                remark: "",
                              };
                              const isItemExpanded = expandedItemId === item.id;

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
                                          {item.item_code_snapshot ? `Code: ${item.item_code_snapshot} | ` : ""}
                                          Qty: {override.quantity ?? item.qty}
                                        </p>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setExpandedItemId(isItemExpanded ? null : item.id)}
                                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-white"
                                    >
                                      {isItemExpanded ? "Close" : "Edit"}
                                    </button>
                                  </div>
                                  {isItemExpanded ? (
                                    <div className="border-t border-zinc-200 bg-white px-4 py-4">
                                      <div className="grid gap-4 md:grid-cols-2">
                                        <div className="md:col-span-2">
                                          <TextAreaField label="RFQ Description Override" value={override.description} onChange={(value) => updateItemOverride(item.id, { description: value })} rows={2} />
                                        </div>
                                        <Field label="RFQ Size Override" value={override.size} onChange={(value) => updateItemOverride(item.id, { size: value })} />
                                        <Field label="RFQ Finish Override" value={override.finish} onChange={(value) => updateItemOverride(item.id, { finish: value })} />
                                        <Field
                                          label="RFQ Quantity Override"
                                          type="number"
                                          value={override.quantity ?? ""}
                                          onChange={(value) => {
                                            const parsed = Number(value);
                                            updateItemOverride(item.id, {
                                              quantity: value.trim() && Number.isFinite(parsed) ? parsed : null,
                                            });
                                          }}
                                        />
                                        <div className="md:col-span-2">
                                          <TextAreaField label="Supplier Remark / Internal RFQ Note" value={override.remark} onChange={(value) => updateItemOverride(item.id, { remark: value })} rows={2} />
                                        </div>
                                        <div className="md:col-span-2 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => moveItem(group, item.id, -1)}
                                            disabled={index === 0}
                                            className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            Move Up
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveItem(group, item.id, 1)}
                                            disabled={index === orderedItems.length - 1}
                                            className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
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
                  );
                })}
              </div>
            ) : null}

            {activeTab === "columns" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ToggleField checked={settings.columnVisibility.image} label="Show Image" onChange={(value) => updateColumnVisibility("image", value)} />
                <ToggleField checked={settings.columnVisibility.code} label="Show Code inside Description" onChange={(value) => updateColumnVisibility("code", value)} />
                <ToggleField checked={settings.columnVisibility.model} label="Show Model inside Description" onChange={(value) => updateColumnVisibility("model", value)} />
                <ToggleField checked={settings.columnVisibility.brandOrigin} label="Show Brand / Origin inside Description" onChange={(value) => updateColumnVisibility("brandOrigin", value)} />
                <ToggleField checked={settings.columnVisibility.specification} label="Show Specification inside Description" onChange={(value) => updateColumnVisibility("specification", value)} />
                <ToggleField checked={settings.columnVisibility.size} label="Show Size" onChange={(value) => updateColumnVisibility("size", value)} />
                <ToggleField checked={settings.columnVisibility.finish} label="Show Finish" onChange={(value) => updateColumnVisibility("finish", value)} />
                <ToggleField checked={settings.columnVisibility.quantity} label="Show Total Qty" onChange={(value) => updateColumnVisibility("quantity", value)} />
                <ToggleField checked={settings.columnVisibility.supplierResponseFields} label="Show Supplier Response Fields" onChange={(value) => updateColumnVisibility("supplierResponseFields", value)} />
              </div>
            ) : null}

            {activeTab === "notes" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <TextAreaField label="General RFQ Note" value={settings.notes.generalNote} onChange={(value) => updateNotes("generalNote", value)} rows={5} />
                </div>
                <Field label="Required Submission Date" type="date" value={settings.notes.submissionDate} onChange={(value) => updateNotes("submissionDate", value)} />
                <Field label="Delivery Location" value={settings.notes.deliveryLocation} onChange={(value) => updateNotes("deliveryLocation", value)} />
                <div className="md:col-span-2">
                  <TextAreaField label="Terms / Remarks" value={settings.notes.terms} onChange={(value) => updateNotes("terms", value)} rows={4} />
                </div>
              </div>
            ) : null}
          </SetupPanel>
        </div>
      ) : null}

      {previewGroups.map((group, groupIndex) => (
        <section
          key={group.key}
          className={`rfq-group mx-auto mb-6 w-[297mm] max-w-full rounded-2xl border border-zinc-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] print:mb-0 print:w-auto print:max-w-none print:rounded-none print:border-0 print:px-0 print:py-0 print:shadow-none ${groupIndex === 0 ? "" : "print:mt-0"}`}
        >
          <header className="border-b border-zinc-200 pb-5">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
                  {settings.documentDetails.title || "Request for Quotation"}
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-zinc-950">{group.label}</h1>
                <p className="mt-1 text-sm text-zinc-500">{group.type}</p>
              </div>
              <BrandBlock
                companyDisplayName={settings.documentDetails.companyDisplayName}
                defaultLogoUrl={defaultLogoUrl}
                logoDisplayMode={settings.documentDetails.logoDisplayMode}
                showLogo={settings.documentDetails.showLogo}
              />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
              <div className="grid gap-3 text-xs text-zinc-600 md:grid-cols-2 xl:grid-cols-3">
                <p><span className="font-semibold text-zinc-900">Client:</span> {settings.documentDetails.clientDisplayName || data.client?.company_name || "-"}</p>
                <p><span className="font-semibold text-zinc-900">Prepared By:</span> {settings.documentDetails.preparedBy || data.companyProfile.displayName || "Noa Offices"}</p>
                {settings.documentDetails.phone ? <p><span className="font-semibold text-zinc-900">Phone:</span> {settings.documentDetails.phone}</p> : null}
                {settings.documentDetails.email ? <p><span className="font-semibold text-zinc-900">Email:</span> {settings.documentDetails.email}</p> : null}
                {settings.documentDetails.projectContact ? <p><span className="font-semibold text-zinc-900">Project Contact:</span> {settings.documentDetails.projectContact}</p> : null}
                {settings.documentDetails.poBox ? <p><span className="font-semibold text-zinc-900">PO Box:</span> {settings.documentDetails.poBox}</p> : null}
              </div>
              <div className="grid gap-2 text-right text-xs text-zinc-600">
                <p><span className="font-semibold text-zinc-900">RFQ No:</span> {settings.documentDetails.rfqNumber || "-"}</p>
                <p><span className="font-semibold text-zinc-900">RFQ Date:</span> {formatDate(settings.documentDetails.rfqDate)}</p>
                <p><span className="font-semibold text-zinc-900">Quotation Date:</span> {formatDate(settings.documentDetails.quotationDate)}</p>
                <p><span className="font-semibold text-zinc-900">Project:</span> {settings.documentDetails.projectDisplayName || data.project?.project_name || data.quotation.title}</p>
              </div>
            </div>
            {(group.supplier.contactPerson || group.supplier.email || group.supplier.phone || group.supplier.address) ? (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
                <p className="font-semibold uppercase tracking-[0.18em] text-zinc-500">Supplier Details</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {group.supplier.contactPerson ? <p><span className="font-semibold text-zinc-900">Contact:</span> {group.supplier.contactPerson}</p> : null}
                  {group.supplier.email ? <p><span className="font-semibold text-zinc-900">Email:</span> {group.supplier.email}</p> : null}
                  {group.supplier.phone ? <p><span className="font-semibold text-zinc-900">Phone:</span> {group.supplier.phone}</p> : null}
                  {group.supplier.address ? <p><span className="font-semibold text-zinc-900">Address:</span> {group.supplier.address}</p> : null}
                </div>
              </div>
            ) : null}
          </header>

          <div className="mt-5 overflow-hidden border border-zinc-200">
            <table className="rfq-table w-full border-collapse text-left text-[11px] text-zinc-700">
              <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="w-[6%] border-b border-zinc-200 px-3 py-3">SR</th>
                  {settings.columnVisibility.image ? <th className="w-[12%] border-b border-zinc-200 px-3 py-3">Image</th> : null}
                  <th className="border-b border-zinc-200 px-3 py-3">Description</th>
                  {settings.columnVisibility.size ? <th className="w-[15%] border-b border-zinc-200 px-3 py-3">Size</th> : null}
                  {settings.columnVisibility.finish ? <th className="w-[15%] border-b border-zinc-200 px-3 py-3">Finish</th> : null}
                  {settings.columnVisibility.quantity ? <th className="w-[8%] border-b border-zinc-200 px-3 py-3 text-center">Total Qty</th> : null}
                </tr>
              </thead>
              <tbody>
                {group.items.map((entry, itemIndex) => {
                  const context = sectionContext(entry.item.section_id, sectionsById);
                  const specification = compactSpecification(entry.item.specification_snapshot);
                  const finishLines = splitMultiline(entry.finish);

                  return (
                    <tr key={entry.item.id} className={itemIndex % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}>
                      <td className="align-top border-b border-zinc-200 px-3 py-3 text-xs font-semibold text-zinc-900">
                        {String(itemIndex + 1).padStart(2, "0")}
                      </td>
                      {settings.columnVisibility.image ? (
                        <td className="align-top border-b border-zinc-200 px-3 py-3">
                          <div className="h-24 w-24 overflow-hidden border border-zinc-200 bg-white">
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
                            <p>
                              <span className="font-semibold text-zinc-900">Brand / Origin:</span>{" "}
                              {[entry.item.brand_name_snapshot, entry.item.origin_snapshot].filter(Boolean).join(" / ")}
                            </p>
                          ) : null}
                          {settings.columnVisibility.specification && specification ? <p className="text-zinc-600">{specification}</p> : null}
                          {entry.remark ? <p className="text-zinc-600"><span className="font-semibold text-zinc-900">Supplier Note:</span> {entry.remark}</p> : null}
                        </div>
                      </td>
                      {settings.columnVisibility.size ? <td className="align-top border-b border-zinc-200 px-3 py-3 text-zinc-700"><p className="leading-5">{entry.size || "-"}</p></td> : null}
                      {settings.columnVisibility.finish ? (
                        <td className="align-top border-b border-zinc-200 px-3 py-3 text-zinc-700">
                          {finishLines.length ? (
                            <div className="grid gap-1 leading-5">
                              {finishLines.map((finish, finishIndex) => (
                                <p key={`${entry.item.id}-finish-${finishIndex}`}>{finish}</p>
                              ))}
                            </div>
                          ) : (
                            <p>-</p>
                          )}
                        </td>
                      ) : null}
                      {settings.columnVisibility.quantity ? <td className="align-top border-b border-zinc-200 px-3 py-3 text-center font-semibold text-zinc-900">{entry.quantity}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {settings.columnVisibility.supplierResponseFields ? (
            <section className="rfq-response mt-5 border border-zinc-200 bg-zinc-50/60 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Supplier Response</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div><p className="text-xs font-semibold text-zinc-900">Supplier Price</p><div className="mt-3 h-8 border-b border-zinc-300" /></div>
                <div><p className="text-xs font-semibold text-zinc-900">Lead Time</p><div className="mt-3 h-8 border-b border-zinc-300" /></div>
                <div><p className="text-xs font-semibold text-zinc-900">Availability</p><div className="mt-3 h-8 border-b border-zinc-300" /></div>
                <div><p className="text-xs font-semibold text-zinc-900">Remarks</p><div className="mt-3 h-8 border-b border-zinc-300" /></div>
              </div>
            </section>
          ) : null}

          {(settings.notes.generalNote || settings.notes.submissionDate || settings.notes.deliveryLocation || settings.notes.terms) ? (
            <section className="rfq-notes mt-5 border border-zinc-200 bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Notes / Terms</p>
              <div className="mt-3 grid gap-2 text-sm text-zinc-700">
                {splitMultiline(settings.notes.generalNote).map((line, index) => (
                  <p key={`${group.key}-note-${index}`}>{line}</p>
                ))}
                {settings.notes.submissionDate ? <p><span className="font-semibold text-zinc-900">Required Submission Date:</span> {formatDate(settings.notes.submissionDate)}</p> : null}
                {settings.notes.deliveryLocation ? <p><span className="font-semibold text-zinc-900">Delivery Location:</span> {settings.notes.deliveryLocation}</p> : null}
                {settings.notes.terms ? <p><span className="font-semibold text-zinc-900">Terms / Remarks:</span> {settings.notes.terms}</p> : null}
              </div>
            </section>
          ) : null}
        </section>
      ))}
    </main>
  );
}
