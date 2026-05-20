"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { ProcurementRfqDocument } from "@/components/quotations/procurement-rfq-document";
import { buildEffectiveDocumentGroups, type EffectiveDocumentGroup } from "@/lib/quotations/document-grouping";
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

type EffectiveGroup = EffectiveDocumentGroup<ProcurementRfqItem>;

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

function sectionContext(sectionId: string | null, sectionsById: Map<string, ProcurementRfqSection>) {
  const section = sectionId ? sectionsById.get(sectionId) ?? null : null;
  const mainSection = section?.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
  return {
    area: mainSection?.section_title ?? (section?.section_kind === "main" ? section.section_title : null),
    section: section && section.section_kind !== "main" ? section.section_title : null,
  };
}

function sanitizeSettingsForCompare(settings: QuotationProcurementRfqSettings) {
  return JSON.stringify({
    documentDetails: settings.documentDetails,
    selectedGroupKey: settings.selectedGroupKey,
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
  return buildEffectiveDocumentGroups(items);
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
  const activeGroupKey = settings.selectedGroupKey || "all";

  const previewGroups: PreviewGroup[] = effectiveGroups
    .filter((group) => activeGroupKey === "all" || group.dedupeKey === activeGroupKey)
    .map((group) => {
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
  })
    .filter((group) => group.items.length > 0);
  const currentScopeLabel = activeGroupKey === "all"
    ? "All Supplier Groups"
    : effectiveGroups.find((group) => group.dedupeKey === activeGroupKey)?.displayLabel ?? "All Supplier Groups";
  const documentGroups = previewGroups.map((group) => ({
    key: group.key,
    label: group.label,
    type: group.type,
    supplier: group.supplier,
    items: group.items.map((entry) => {
      const context = sectionContext(entry.item.section_id, sectionsById);
      return {
        id: entry.item.id,
        description: entry.description,
        context: (context.area || context.section) ? [context.area, context.section].filter(Boolean).join(" / ") : null,
        code: entry.item.item_code_snapshot,
        model: entry.item.model_snapshot,
        brandOrigin: [entry.item.brand_name_snapshot, entry.item.origin_snapshot].filter(Boolean).join(" / ") || null,
        specification: compactSpecification(entry.item.specification_snapshot),
        size: entry.size,
        finish: entry.finish,
        quantity: entry.quantity,
        remark: entry.remark,
        imageUrl: entry.item.imageUrl,
      };
    }),
  }));

  function updateDocumentDetails<K extends keyof ProcurementRfqDocumentDetails>(key: K, value: ProcurementRfqDocumentDetails[K]) {
    setSettings((current) => ({
      ...current,
      documentDetails: {
        ...current.documentDetails,
        [key]: value,
      },
    }));
  }

  function updateSelectedGroupKey(value: string) {
    setSettings((current) => ({
      ...current,
      selectedGroupKey: value,
    }));
    setExpandedItemGroupKey(null);
    setExpandedItemId(null);
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
        @page { size: A4 landscape; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-page + .doc-page { margin-top: 24px; }
        @media print {
          html, body { background: #ffffff; }
          html, body { margin: 0 !important; padding: 0 !important; width: 297mm !important; background: #fff !important; }
          .doc-page { break-after: page; page-break-after: always; margin: 0 !important; }
          .doc-page:last-child { break-after: auto; page-break-after: auto; }
          .doc-page + .doc-page { margin-top: 0 !important; }
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
            <p className="mt-3 text-sm text-zinc-600">
              Showing: {currentScopeLabel}
            </p>
          </div>
        </div>
      ) : null}

      {!printMode ? (
        <div className="mx-auto mb-5 w-[297mm] max-w-full print:hidden">
          <SetupPanel activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "document" ? (
              <div className="grid gap-4">
                <label className="grid gap-1 md:max-w-md">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Supplier / Brand Scope</span>
                  <select
                    value={activeGroupKey}
                    onChange={(event) => updateSelectedGroupKey(event.target.value)}
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  >
                    <option value="all">All Supplier Groups</option>
                    {effectiveGroups.map((group) => (
                      <option key={group.dedupeKey} value={group.dedupeKey}>
                        {group.displayLabel}
                      </option>
                    ))}
                  </select>
                </label>
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

      <ProcurementRfqDocument
        companyLogoUrl={defaultLogoUrl}
        currentScopeLabel={currentScopeLabel}
        groups={documentGroups}
        notes={settings.notes}
        settings={{
          columnVisibility: settings.columnVisibility,
          documentDetails: settings.documentDetails,
        }}
      />
    </main>
  );
}
