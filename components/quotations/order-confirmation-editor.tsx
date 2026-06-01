"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { DocumentPrintSetupPanel, type PrintPlannerItem } from "@/components/quotations/document-print-setup-panel";
import { OrderConfirmationDocument } from "@/components/quotations/order-confirmation-document";
import { buildOrderConfirmationPages } from "@/lib/quotations/order-confirmation-pages";
import type { DocumentPrintSettings } from "@/lib/quotations/document-print-settings";
import {
  DEFAULT_ORDER_CONFIRMATION_ITEM_OVERRIDE,
  type OrderConfirmationColumnVisibility,
  type OrderConfirmationDocumentDetails,
  type OrderConfirmationItemOverride,
  type OrderConfirmationTerms,
  type QuotationOrderConfirmationSettings,
} from "@/lib/quotations/order-confirmation-settings";

type OrderConfirmationClient = {
  id: string;
  company_name: string;
};

type OrderConfirmationCompanyProfile = {
  displayName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
};

type OrderConfirmationProject = {
  id: string;
  project_name: string;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
};

type OrderConfirmationQuotation = {
  id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
  payment_terms: string | null;
  delivery_terms: string | null;
};

type OrderConfirmationSection = {
  id: string;
  section_title: string;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
};

type OrderConfirmationItem = {
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
  qty: number;
  imageUrl: string | null;
};

type OrderConfirmationEditorData = {
  client: OrderConfirmationClient | null;
  companyProfile: OrderConfirmationCompanyProfile;
  items: OrderConfirmationItem[];
  project: OrderConfirmationProject | null;
  quotation: OrderConfirmationQuotation;
  sections: OrderConfirmationSection[];
};

type OrderConfirmationEditorProps = {
  data: OrderConfirmationEditorData;
  defaultLogoUrl: string | null;
  defaultSettings: QuotationOrderConfirmationSettings;
  initialSettings: QuotationOrderConfirmationSettings;
  printMode: boolean;
};

type EditorTab = "document" | "items" | "columns" | "terms";

const TAB_OPTIONS: Array<{ key: EditorTab; label: string }> = [
  { key: "document", label: "Document" },
  { key: "items", label: "Items" },
  { key: "columns", label: "Columns" },
  { key: "terms", label: "Terms / Signature" },
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
  if (normalized.length <= 320) return normalized;
  return `${normalized.slice(0, 317).trimEnd()}...`;
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

function selectedFinishSummaries(item: Pick<OrderConfirmationItem, "finish_selections_snapshot" | "finish_snapshot">) {
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

function documentItemTitle(item: Pick<OrderConfirmationItem, "item_name_snapshot" | "model_snapshot" | "item_code_snapshot">) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Quotation Item";
}

function sectionContext(sectionId: string | null, sectionsById: Map<string, OrderConfirmationSection>) {
  const section = sectionId ? sectionsById.get(sectionId) ?? null : null;
  const mainSection = section?.parent_section_id ? sectionsById.get(section.parent_section_id) ?? null : null;
  return {
    area: mainSection?.section_title ?? (section?.section_kind === "main" ? section.section_title : null),
    section: section && section.section_kind !== "main" ? section.section_title : null,
  };
}

function sanitizeSettingsForCompare(settings: QuotationOrderConfirmationSettings) {
  return JSON.stringify({
    documentDetails: settings.documentDetails,
    print: settings.print,
    itemOverrides: settings.itemOverrides,
    columnVisibility: settings.columnVisibility,
    terms: settings.terms,
    itemOrder: settings.itemOrder,
  });
}

function orderedItems(items: OrderConfirmationItem[], settings: QuotationOrderConfirmationSettings) {
  const orderIndex = new Map(settings.itemOrder.map((itemId, index) => [itemId, index]));

  return [...items].sort((left, right) => {
    const leftIndex = orderIndex.get(left.id);
    const rightIndex = orderIndex.get(right.id);

    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return 0;
  });
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
        className="h-9 rounded-md border border-zinc-200 px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
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
        className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
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
    <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Order Confirmation Setup</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
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
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export function OrderConfirmationEditor({
  data,
  defaultLogoUrl,
  defaultSettings,
  initialSettings,
  printMode,
}: OrderConfirmationEditorProps) {
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<EditorTab>("document");
  const [showSettings, setShowSettings] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const isDirty = sanitizeSettingsForCompare(settings) !== sanitizeSettingsForCompare(savedSettings);

  const sectionsById = new Map(data.sections.map((section) => [section.id, section]));
  const ordered = orderedItems(data.items, settings);
  const previewItems = ordered
    .map((item, index) => {
      const override = {
        ...DEFAULT_ORDER_CONFIRMATION_ITEM_OVERRIDE,
        ...(settings.itemOverrides[item.id] ?? {}),
      };
      if (override.hidden) return null;
      const context = sectionContext(item.section_id, sectionsById);
      const areaSection = [context.area, context.section].filter(Boolean).join(" / ") || null;

      return {
        areaSection,
        brand: item.brand_name_snapshot,
        code: item.item_code_snapshot,
        description: override.description || compactSpecification(item.specification_snapshot),
        dimensions: override.dimensions || item.size_snapshot || "",
        finish: override.finish || selectedFinishSummaries(item).join(" | "),
        id: item.id,
        imageUrl: item.imageUrl,
        itemNumber: item.manual_serial?.trim() || String(index + 1).padStart(2, "0"),
        model: item.model_snapshot,
        note: override.note,
        origin: item.origin_snapshot,
        quantity: override.quantity ?? item.qty,
        specification: compactSpecification(item.specification_snapshot),
        title: override.title || documentItemTitle(item),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const plannerItems: PrintPlannerItem[] = buildOrderConfirmationPages({
    closing: { terms: settings.terms },
    columnVisibility: settings.columnVisibility,
    items: previewItems,
    print: settings.print,
  }).flatMap((page) =>
    page.items.map((item) => ({
      itemId: item.id,
      itemName: item.title,
      pageNumber: page.pageIndex + 1,
      sectionTitle: item.areaSection || "Order Confirmation",
      serial: item.itemNumber,
    })),
  );

  function updateDocumentDetails<K extends keyof OrderConfirmationDocumentDetails>(key: K, value: OrderConfirmationDocumentDetails[K]) {
    setSettings((current) => ({
      ...current,
      documentDetails: {
        ...current.documentDetails,
        [key]: value,
      },
    }));
  }

  function updateItemOverride(itemId: string, patch: Partial<OrderConfirmationItemOverride>) {
    setSettings((current) => ({
      ...current,
      itemOverrides: {
        ...current.itemOverrides,
        [itemId]: {
          ...DEFAULT_ORDER_CONFIRMATION_ITEM_OVERRIDE,
          ...(current.itemOverrides[itemId] ?? {}),
          ...patch,
        },
      },
    }));
  }

  function updateColumnVisibility<K extends keyof OrderConfirmationColumnVisibility>(key: K, value: OrderConfirmationColumnVisibility[K]) {
    setSettings((current) => ({
      ...current,
      columnVisibility: {
        ...current.columnVisibility,
        [key]: value,
      },
    }));
  }

  function updateTerms<K extends keyof OrderConfirmationTerms>(key: K, value: OrderConfirmationTerms[K]) {
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
    setFeedback("Order confirmation manual page breaks cleared locally.");
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    const currentIds = settings.itemOrder.length > 0
      ? [...settings.itemOrder]
      : ordered.map((item) => item.id);
    const currentIndex = currentIds.indexOf(itemId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentIds.length) return;

    const reordered = [...currentIds];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, movedItem);

    setSettings((current) => ({
      ...current,
      itemOrder: reordered,
    }));
  }

  function resetToDefaults() {
    setSettings(defaultSettings);
    setFeedback("Order confirmation settings reset locally. Save to persist the defaults.");
  }

  function saveSettings() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/quotations/${data.quotation.id}/order-confirmation-settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
        });
        const payload = await response.json() as {
          success?: boolean;
          error?: string;
          details?: string;
          settings?: QuotationOrderConfirmationSettings;
        };

        if (!response.ok || !payload.success || !payload.settings) {
          throw new Error(payload.details || payload.error || "Failed to save order confirmation settings.");
        }

        setSavedSettings(payload.settings);
        setSettings(payload.settings);
        setFeedback("Order confirmation settings saved.");
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to save order confirmation settings.");
      }
    });
  }

  function downloadPdf() {
    if (isDirty) {
      setFeedback("Save order confirmation settings before downloading to include your changes.");
      return;
    }

    window.location.href = `/quotations/${data.quotation.id}/download-order-confirmation`;
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
        <div className="mx-auto mb-5 w-[210mm] max-w-full print:hidden">
          <DocumentPrintSetupPanel
            actionLabel="Save Print Settings"
            backHref={`/quotations/${data.quotation.id}`}
            dirtyMessage="You have unsaved order confirmation print changes."
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
            savedMessage="Order confirmation print settings match latest saved version."
            settings={settings.print}
            showSettings={showSettings}
            title="Order Confirmation Print Setup"
            toggleSettings={() => setShowSettings((current) => !current)}
          />
        </div>
      ) : null}

      {!printMode && showSettings ? (
        <div className="mx-auto mb-5 w-[210mm] max-w-full print:hidden">
          <SetupPanel activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "document" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Document Title" value={settings.documentDetails.title} onChange={(value) => updateDocumentDetails("title", value)} />
                <Field label="Confirmation Number" value={settings.documentDetails.confirmationNumber} onChange={(value) => updateDocumentDetails("confirmationNumber", value)} />
                <Field label="Confirmation Date" type="date" value={settings.documentDetails.confirmationDate} onChange={(value) => updateDocumentDetails("confirmationDate", value)} />
                <Field label="Quotation Reference" value={settings.documentDetails.quotationReference} onChange={(value) => updateDocumentDetails("quotationReference", value)} />
                <Field label="Project Display Name" value={settings.documentDetails.projectDisplayName} onChange={(value) => updateDocumentDetails("projectDisplayName", value)} />
                <Field label="Client Display Name" value={settings.documentDetails.clientDisplayName} onChange={(value) => updateDocumentDetails("clientDisplayName", value)} />
                <Field label="Location" value={settings.documentDetails.location} onChange={(value) => updateDocumentDetails("location", value)} />
                <Field label="Attention / Contact" value={settings.documentDetails.attentionContact} onChange={(value) => updateDocumentDetails("attentionContact", value)} />
                <Field label="Prepared By" value={settings.documentDetails.preparedBy} onChange={(value) => updateDocumentDetails("preparedBy", value)} />
                <Field label="Company Display Name" value={settings.documentDetails.companyDisplayName} onChange={(value) => updateDocumentDetails("companyDisplayName", value)} />
                <Field label="Company Phone" value={settings.documentDetails.companyPhone} onChange={(value) => updateDocumentDetails("companyPhone", value)} />
                <Field label="Company Email" type="email" value={settings.documentDetails.companyEmail} onChange={(value) => updateDocumentDetails("companyEmail", value)} />
                <Field label="Company Website" value={settings.documentDetails.companyWebsite} onChange={(value) => updateDocumentDetails("companyWebsite", value)} />
                <div className="xl:col-span-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ToggleField checked={settings.documentDetails.showLogo} label="Show Company Logo" onChange={(value) => updateDocumentDetails("showLogo", value)} />
                  <label className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Logo Display Mode</span>
                    <select
                      value={settings.documentDetails.logoDisplayMode}
                      onChange={(event) => updateDocumentDetails("logoDisplayMode", event.target.value as OrderConfirmationDocumentDetails["logoDisplayMode"])}
                      className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                    >
                      <option value="logo_if_available">Logo if available</option>
                      <option value="text_wordmark_fallback">Text fallback</option>
                    </select>
                  </label>
                </div>
                <div className="md:col-span-2 xl:col-span-3">
                  <TextAreaField label="Company Address" rows={2} value={settings.documentDetails.companyAddress} onChange={(value) => updateDocumentDetails("companyAddress", value)} />
                </div>
              </div>
            ) : null}

            {activeTab === "items" ? (
              <div className="grid gap-3">
                {ordered.map((item, index) => {
                  const override = {
                    ...DEFAULT_ORDER_CONFIRMATION_ITEM_OVERRIDE,
                    ...(settings.itemOverrides[item.id] ?? {}),
                  };
                  const isExpanded = expandedItemId === item.id;

                  return (
                    <div key={item.id} className="rounded-xl border border-zinc-200">
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
                        <button type="button" onClick={() => setExpandedItemId(isExpanded ? null : item.id)} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">
                          {isExpanded ? "Close" : "Edit"}
                        </button>
                      </div>
                      {isExpanded ? (
                        <div className="border-t border-zinc-200 px-4 py-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="md:col-span-2">
                              <TextAreaField label="Confirmation Item Title Override" value={override.title} onChange={(value) => updateItemOverride(item.id, { title: value })} rows={2} />
                            </div>
                            <div className="md:col-span-2">
                              <TextAreaField label="Description / Specification Override" value={override.description} onChange={(value) => updateItemOverride(item.id, { description: value })} rows={3} />
                            </div>
                            <Field label="Dimension Override" value={override.dimensions} onChange={(value) => updateItemOverride(item.id, { dimensions: value })} />
                            <Field label="Finish Override" value={override.finish} onChange={(value) => updateItemOverride(item.id, { finish: value })} />
                            <Field
                              label="Quantity Override"
                              type="number"
                              value={override.quantity ?? ""}
                              onChange={(value) => {
                                const parsed = Number(value);
                                updateItemOverride(item.id, { quantity: value.trim() && Number.isFinite(parsed) ? parsed : null });
                              }}
                            />
                            <div className="md:col-span-2">
                              <TextAreaField label="Client Note / Confirmation Note" value={override.note} onChange={(value) => updateItemOverride(item.id, { note: value })} rows={2} />
                            </div>
                            <div className="md:col-span-2 flex flex-wrap gap-2">
                              <button type="button" onClick={() => moveItem(item.id, -1)} disabled={index === 0} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
                                Move Up
                              </button>
                              <button type="button" onClick={() => moveItem(item.id, 1)} disabled={index === ordered.length - 1} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
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
            ) : null}

            {activeTab === "columns" ? (
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                <ToggleField checked={settings.columnVisibility.image} label="Show Image" onChange={(value) => updateColumnVisibility("image", value)} />
                <ToggleField checked={settings.columnVisibility.code} label="Show Code" onChange={(value) => updateColumnVisibility("code", value)} />
                <ToggleField checked={settings.columnVisibility.model} label="Show Model" onChange={(value) => updateColumnVisibility("model", value)} />
                <ToggleField checked={settings.columnVisibility.brand} label="Show Brand" onChange={(value) => updateColumnVisibility("brand", value)} />
                <ToggleField checked={settings.columnVisibility.origin} label="Show Origin" onChange={(value) => updateColumnVisibility("origin", value)} />
                <ToggleField checked={settings.columnVisibility.dimensions} label="Show Dimensions" onChange={(value) => updateColumnVisibility("dimensions", value)} />
                <ToggleField checked={settings.columnVisibility.selectedFinishes} label="Show Selected Finishes" onChange={(value) => updateColumnVisibility("selectedFinishes", value)} />
                <ToggleField checked={settings.columnVisibility.specification} label="Show Specification" onChange={(value) => updateColumnVisibility("specification", value)} />
                <ToggleField checked={settings.columnVisibility.quantity} label="Show Quantity" onChange={(value) => updateColumnVisibility("quantity", value)} />
                <ToggleField checked={settings.columnVisibility.areaSection} label="Show Area / Section" onChange={(value) => updateColumnVisibility("areaSection", value)} />
              </div>
            ) : null}

            {activeTab === "terms" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <TextAreaField label="Delivery / Installation Note" value={settings.terms.deliveryInstallationNote} onChange={(value) => updateTerms("deliveryInstallationNote", value)} rows={3} />
                </div>
                <div className="md:col-span-2">
                  <TextAreaField label="Payment Terms" value={settings.terms.paymentTerms} onChange={(value) => updateTerms("paymentTerms", value)} rows={3} />
                </div>
                <div className="md:col-span-2">
                  <TextAreaField label="General Confirmation Note" value={settings.terms.generalConfirmationNote} onChange={(value) => updateTerms("generalConfirmationNote", value)} rows={4} />
                </div>
                <div className="md:col-span-2">
                  <TextAreaField label="Approval Statement" value={settings.terms.approvalStatement} onChange={(value) => updateTerms("approvalStatement", value)} rows={3} />
                </div>
                <Field label="Client Name" value={settings.terms.clientName} onChange={(value) => updateTerms("clientName", value)} />
                <Field label="Authorized Person" value={settings.terms.authorizedPerson} onChange={(value) => updateTerms("authorizedPerson", value)} />
                <Field label="Signature Label" value={settings.terms.signatureLabel} onChange={(value) => updateTerms("signatureLabel", value)} />
                <Field label="Date Label" value={settings.terms.dateLabel} onChange={(value) => updateTerms("dateLabel", value)} />
                <Field label="Company Stamp Label" value={settings.terms.companyStampLabel} onChange={(value) => updateTerms("companyStampLabel", value)} />
              </div>
            ) : null}
          </SetupPanel>
        </div>
      ) : null}

      <OrderConfirmationDocument
        companyLogoUrl={defaultLogoUrl}
        items={previewItems}
        settings={{
          columnVisibility: settings.columnVisibility,
          documentDetails: settings.documentDetails,
          print: settings.print,
          terms: settings.terms,
        }}
      />
    </main>
  );
}


