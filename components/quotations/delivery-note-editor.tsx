"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { DeliveryNoteDocument, type DeliveryNoteDocItem } from "@/components/quotations/delivery-note-document";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import {
  DEFAULT_DELIVERY_NOTE_SETTINGS,
  type DeliveryNoteSettings,
} from "@/lib/quotations/delivery-note-settings";

// ─── Narrow data types (only what the editor needs) ──────────────────────────

type DeliveryNoteClient = {
  id: string;
  company_name: string;
};

type DeliveryNoteProject = {
  id: string;
  project_name: string;
  project_address: string | null;
};

type DeliveryNoteQuotation = {
  id: string;
  quotation_no: string | null;
  title: string;
};

type DeliveryNoteEditorItem = {
  id: string;
  item_name_snapshot: string | null;
  item_code_snapshot: string | null;
  brand_name_snapshot: string | null;
  specification_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  model_snapshot: string | null;
  origin_snapshot: string | null;
  supplier_name_snapshot: string | null;
  qty: number;
  imageUrl: string | null;
};

export type DeliveryNoteEditorData = {
  client: DeliveryNoteClient | null;
  companyProfile?: {
    companyName: string;
    phone: string | null;
    email: string | null;
    website: string | null;
  };
  project: DeliveryNoteProject | null;
  quotation: DeliveryNoteQuotation;
  items: DeliveryNoteEditorItem[];
};

type DeliveryNoteEditorProps = {
  data: DeliveryNoteEditorData;
  defaultLogoUrl: string | null;
  defaultSettings: DeliveryNoteSettings;
  initialSettings: DeliveryNoteSettings;
  printMode: boolean;
};

type EditorTab = "document" | "scope" | "items" | "columns" | "notes";

const TAB_OPTIONS: Array<{ key: EditorTab; label: string }> = [
  { key: "document", label: "Doc" },
  { key: "scope", label: "Scope" },
  { key: "items", label: "Items" },
  { key: "columns", label: "Cols" },
  { key: "notes", label: "Notes" },
];

// ─── Small field components ───────────────────────────────────────────────────

function Field({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "email";
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-md border border-zinc-200 px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  placeholder,
  rows = 3,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
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
        onChange={(e) => onChange(e.target.checked)}
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Delivery Note Setup</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={
                activeTab === tab.key
                  ? "rounded-full bg-emerald-900 px-3 py-2 text-xs font-semibold text-white"
                  : "rounded-full border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
              }
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

// ─── Main editor ──────────────────────────────────────────────────────────────

export function DeliveryNoteEditor({
  data,
  defaultLogoUrl,
  defaultSettings,
  initialSettings,
  printMode,
}: DeliveryNoteEditorProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<EditorTab>("document");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const effectiveGroups = buildEffectiveDocumentGroups(data.items);

  // Build processed items for the document preview, filtered by scope
  const docItems: DeliveryNoteDocItem[] = (() => {
    const groups = effectiveGroups.filter(
      (g) => settings.scope === "all" || g.dedupeKey === settings.scope,
    );
    let rowNumber = 1;
    const result: DeliveryNoteDocItem[] = [];
    for (const group of groups) {
      for (const item of group.items) {
        const override = settings.itemOverrides[item.id];
        if (override?.hidden) continue;
        result.push({
          id: item.id,
          vendorKey: group.dedupeKey,
          vendorLabel: group.displayLabel,
          rowNumber: rowNumber++,
          description: override?.description || item.item_name_snapshot || item.item_code_snapshot || "Item",
          code: item.item_code_snapshot,
          brand:
            [item.brand_name_snapshot, item.origin_snapshot].filter(Boolean).join(" / ") || null,
          specification: item.specification_snapshot?.trim() || null,
          size: item.size_snapshot?.trim() || null,
          finish: item.finish_snapshot?.trim() || null,
          model: item.model_snapshot?.trim() || null,
          quantity: item.qty,
          imageUrl: item.imageUrl,
        });
      }
    }
    return result;
  })();

  function patch(partial: Partial<DeliveryNoteSettings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  function patchCol(key: keyof DeliveryNoteSettings["columnVisibility"], value: boolean) {
    setSettings((prev) => ({
      ...prev,
      columnVisibility: { ...prev.columnVisibility, [key]: value },
    }));
  }

  function patchItemOverride(itemId: string, partial: Partial<{ hidden: boolean; description: string; remark: string }>) {
    setSettings((prev) => {
      const existing = prev.itemOverrides[itemId] ?? { hidden: false, description: "", remark: "" };
      return {
        ...prev,
        itemOverrides: {
          ...prev.itemOverrides,
          [itemId]: { ...existing, ...partial },
        },
      };
    });
  }

  function resetToDefaults() {
    setSettings(defaultSettings);
    setFeedback("Settings reset locally. Save to persist.");
  }

  function saveSettings() {
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/quotations/${data.quotation.id}/delivery-note-settings`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings }),
          },
        );
        const payload = (await response.json()) as {
          success?: boolean;
          error?: string;
          details?: string;
          settings?: DeliveryNoteSettings;
        };

        if (!response.ok || !payload.success || !payload.settings) {
          throw new Error(payload.details || payload.error || "Failed to save.");
        }

        setSavedSettings(payload.settings);
        setSettings(payload.settings);
        setFeedback("Delivery note settings saved.");
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Failed to save delivery note settings.",
        );
      }
    });
  }

  function downloadPdf() {
    if (isDirty) {
      setFeedback("Save settings before downloading to include your latest changes.");
      return;
    }
    window.location.href = `/quotations/${data.quotation.id}/download-delivery-note`;
  }

  const document = (
    <DeliveryNoteDocument
      companyLogoUrl={defaultLogoUrl}
      companyProfile={data.companyProfile}
      items={docItems}
      settings={settings}
    />
  );

  // Print mode: render document only
  if (printMode) {
    return (
      <main className="min-h-screen bg-white">
        <style>{`
          @page { size: A4 ${settings.orientation}; margin: 0; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @media print {
            html, body { background: #ffffff; margin: 0 !important; padding: 0 !important; }
            .doc-page { break-after: page; page-break-after: always; margin: 0 !important; }
            .doc-page:last-child { break-after: auto; page-break-after: auto; }
          }
        `}</style>
        {document}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-6 print:bg-white print:px-0 print:py-0">
      <style>{`
        @page { size: A4 ${settings.orientation}; margin: 0; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-page + .doc-page { margin-top: 24px; }
        @media print {
          html, body { background: #ffffff; margin: 0 !important; padding: 0 !important; }
          .doc-page { break-after: page; page-break-after: always; margin: 0 !important; }
          .doc-page:last-child { break-after: auto; page-break-after: auto; }
          .doc-page + .doc-page { margin-top: 0 !important; }
        }
      `}</style>

      <div className="mx-auto grid max-w-[calc(210mm+2rem+440px+1.25rem)] gap-5 xl:grid-cols-[minmax(0,calc(210mm+2rem))_minmax(380px,440px)] xl:items-start">

        {/* ── Left: toolbar + live preview ── */}
        <div className="min-w-0">

          {/* Top toolbar */}
          <div className="mx-auto mb-4 w-[210mm] max-w-full print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-5 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <a
                  href={`/quotations/${data.quotation.id}`}
                  className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-800"
                >
                  ← Back
                </a>
                <span className="text-zinc-300">|</span>
                <p className="text-sm font-semibold text-zinc-900">
                  Delivery Note
                  {settings.dnNumber ? ` — ${settings.dnNumber}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {feedback ? (
                  <p
                    className={`text-xs font-medium ${
                      feedback.toLowerCase().includes("fail") ||
                      feedback.toLowerCase().includes("error") ||
                      feedback.toLowerCase().includes("save")
                        ? "text-amber-700"
                        : "text-emerald-700"
                    }`}
                  >
                    {feedback}
                  </p>
                ) : isDirty ? (
                  <p className="text-xs text-zinc-400">Unsaved changes</p>
                ) : (
                  <p className="text-xs text-zinc-400">Saved</p>
                )}
                <button
                  type="button"
                  onClick={downloadPdf}
                  className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={isPending || !isDirty}
                  className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                  {isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>

          {/* Live preview */}
          {document}
        </div>

        {/* ── Right: settings panel ── */}
        <div className="print:hidden xl:sticky xl:top-6 xl:self-start">
          <SetupPanel activeTab={activeTab} onTabChange={setActiveTab}>

            {/* Tab: Document */}
            {activeTab === "document" ? (
              <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="DN Number"
                    value={settings.dnNumber}
                    placeholder={`DN-${data.quotation.quotation_no ?? "0000"}-001`}
                    onChange={(v) => patch({ dnNumber: v })}
                  />
                  <Field
                    label="DN Date"
                    type="date"
                    value={settings.dnDate}
                    onChange={(v) => patch({ dnDate: v })}
                  />
                  <Field
                    label="Project"
                    value={settings.projectDisplayName}
                    onChange={(v) => patch({ projectDisplayName: v })}
                  />
                  <Field
                    label="Client"
                    value={settings.clientDisplayName}
                    onChange={(v) => patch({ clientDisplayName: v })}
                  />
                </div>
                <TextAreaField
                  label="Delivery Address"
                  rows={2}
                  value={settings.deliveryAddress}
                  placeholder={data.project?.project_address ?? ""}
                  onChange={(v) => patch({ deliveryAddress: v })}
                />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Delivery Date"
                    type="date"
                    value={settings.deliveryDate}
                    onChange={(v) => patch({ deliveryDate: v })}
                  />
                  <Field
                    label="Driver Name"
                    value={settings.driverName}
                    onChange={(v) => patch({ driverName: v })}
                  />
                  <Field
                    label="Vehicle Details"
                    value={settings.vehicleDetails}
                    onChange={(v) => patch({ vehicleDetails: v })}
                  />
                </div>
                <div className="border-t border-zinc-100 pt-3">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Logo &amp; Print
                  </p>
                  <div className="grid gap-3">
                    <ToggleField
                      checked={settings.showLogo}
                      label="Show Company Logo"
                      onChange={(v) => patch({ showLogo: v })}
                    />
                    <label className="grid gap-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Logo Mode
                      </span>
                      <select
                        value={settings.logoMode}
                        onChange={(e) =>
                          patch({ logoMode: e.target.value as DeliveryNoteSettings["logoMode"] })
                        }
                        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                      >
                        <option value="logo_if_available">Logo if available</option>
                        <option value="text_wordmark_fallback">Text wordmark fallback</option>
                      </select>
                    </label>
                    <label className="grid gap-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Orientation
                      </span>
                      <select
                        value={settings.orientation}
                        onChange={(e) =>
                          patch({
                            orientation: e.target.value as DeliveryNoteSettings["orientation"],
                          })
                        }
                        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                      >
                        <option value="portrait">Portrait (A4)</option>
                        <option value="landscape">Landscape (A4)</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={resetToDefaults}
                    className="text-xs font-semibold text-zinc-400 underline transition hover:text-zinc-600"
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            ) : null}

            {/* Tab: Scope */}
            {activeTab === "scope" ? (
              <div className="grid gap-3">
                <p className="text-xs text-zinc-500">
                  Choose which vendor&apos;s items appear on this delivery note.
                </p>
                <label className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3 cursor-pointer">
                  <input
                    type="radio"
                    name="dn-scope"
                    value="all"
                    checked={settings.scope === "all"}
                    onChange={() => patch({ scope: "all" })}
                    className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-zinc-900">
                      All Vendors Combined
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {data.items.length} items across all vendors
                    </span>
                  </span>
                </label>
                {effectiveGroups.map((group) => (
                  <label
                    key={group.dedupeKey}
                    className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="dn-scope"
                      value={group.dedupeKey}
                      checked={settings.scope === group.dedupeKey}
                      onChange={() => patch({ scope: group.dedupeKey })}
                      className="h-4 w-4 border-zinc-300 text-emerald-900 focus:ring-emerald-900"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-zinc-900">
                        {group.displayLabel}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {group.displayType} · {group.items.length} item
                        {group.items.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                ))}
                {effectiveGroups.length === 0 ? (
                  <p className="text-xs text-zinc-400">No vendor groups found in this quotation.</p>
                ) : null}
              </div>
            ) : null}

            {/* Tab: Items */}
            {activeTab === "items" ? (
              <div className="grid gap-2">
                <p className="text-xs text-zinc-500">
                  Override description or add a remark for individual items.
                </p>
                {data.items.map((item) => {
                  const isExpanded = expandedItemId === item.id;
                  const override = settings.itemOverrides[item.id];
                  const title =
                    item.item_name_snapshot || item.item_code_snapshot || "Item";
                  return (
                    <div key={item.id} className="rounded-lg border border-zinc-200">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedItemId(isExpanded ? null : item.id)
                        }
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                      >
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-sm font-semibold ${
                              override?.hidden ? "line-through text-zinc-400" : "text-zinc-900"
                            }`}
                          >
                            {title}
                          </span>
                          {item.item_code_snapshot ? (
                            <span className="block text-[10px] text-zinc-400">
                              {item.item_code_snapshot}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-400">
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="border-t border-zinc-100 px-3 pb-3 pt-3 grid gap-3">
                          <ToggleField
                            checked={override?.hidden ?? false}
                            label="Hide this item"
                            description="Item will not appear on the delivery note."
                            onChange={(v) => patchItemOverride(item.id, { hidden: v })}
                          />
                          <Field
                            label="Description Override"
                            value={override?.description ?? ""}
                            placeholder={title}
                            onChange={(v) => patchItemOverride(item.id, { description: v })}
                          />
                          <TextAreaField
                            label="Remark"
                            rows={2}
                            value={override?.remark ?? ""}
                            onChange={(v) => patchItemOverride(item.id, { remark: v })}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {data.items.length === 0 ? (
                  <p className="text-xs text-zinc-400">No items in this quotation.</p>
                ) : null}
              </div>
            ) : null}

            {/* Tab: Columns */}
            {activeTab === "columns" ? (
              <div className="grid gap-3">
                <p className="text-xs text-zinc-500">
                  Quantity is always shown. Toggle other columns below.
                </p>
                <ToggleField
                  checked={settings.columnVisibility.image}
                  label="Image"
                  onChange={(v) => patchCol("image", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.code}
                  label="Item Code"
                  onChange={(v) => patchCol("code", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.brand}
                  label="Brand / Origin"
                  onChange={(v) => patchCol("brand", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.specification}
                  label="Specification"
                  onChange={(v) => patchCol("specification", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.size}
                  label="Size"
                  onChange={(v) => patchCol("size", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.finish}
                  label="Finish"
                  onChange={(v) => patchCol("finish", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.model}
                  label="Model"
                  onChange={(v) => patchCol("model", v)}
                />
                <ToggleField
                  checked={settings.columnVisibility.condition}
                  label='Condition (prints "New" for all items)'
                  onChange={(v) => patchCol("condition", v)}
                />
              </div>
            ) : null}

            {/* Tab: Notes */}
            {activeTab === "notes" ? (
              <div className="grid gap-4">
                <TextAreaField
                  label="Header Text"
                  rows={4}
                  value={settings.headerText}
                  placeholder="Text printed above the item table…"
                  onChange={(v) => patch({ headerText: v })}
                />
                <TextAreaField
                  label="Footer Text"
                  rows={4}
                  value={settings.footerText}
                  placeholder="Text printed below the item table…"
                  onChange={(v) => patch({ footerText: v })}
                />
              </div>
            ) : null}

          </SetupPanel>
        </div>
      </div>
    </main>
  );
}
