"use client";

import { useRef, useState } from "react";
import type React from "react";
import { logVendorMilestoneAction } from "@/lib/procurement/log-vendor-milestone-action";
import {
  saveVendorDocUrl,
  deleteVendorDocById,
  saveVendorProgress,
  type VendorDocRecord,
} from "@/lib/procurement/vendor-docs-action";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Check, FileText as FileIcon } from "lucide-react";

type VendorStep = {
  key: string;
  label: string;
};

const VENDOR_STEPS: VendorStep[] = [
  { key: "rfq",                 label: "RFQ" },
  { key: "po_issued",           label: "PO Issued" },
  { key: "deposit_paid",        label: "Deposit Paid" },
  { key: "in_production",       label: "In Production" },
  { key: "quality_check",       label: "Quality Check" },
  { key: "ready_for_shipment",  label: "Ready for Shipment" },
  { key: "in_transit",          label: "In Transit" },
  { key: "delivered_installed", label: "Delivered & Installed" },
];

type MilestoneOption = {
  value: string;
  label: string;
  stepIndex: number;
};

const MILESTONE_OPTIONS: MilestoneOption[] = [
  { value: "po_issued",           label: "📋 PO Issued",            stepIndex: 1 },
  { value: "deposit_paid",        label: "💰 Deposit Paid",          stepIndex: 2 },
  { value: "in_production",       label: "🏭 In Production",         stepIndex: 3 },
  { value: "quality_check",       label: "🔍 Quality Check (QA)",    stepIndex: 4 },
  { value: "ready_for_shipment",  label: "📦 Ready for Shipment",    stepIndex: 5 },
  { value: "in_transit",          label: "🚢 In Transit",            stepIndex: 6 },
  { value: "delivered_installed", label: "🔧 Delivered & Installed", stepIndex: 7 },
];

type DocSlot = {
  key: string;
  label: string;
  accept: string;
};

const DOC_SLOTS: DocSlot[] = [
  { key: "pi", label: "Proforma Invoice (PI)", accept: ".pdf,.doc,.docx" },
  { key: "oc", label: "Factory Confirmation (OC)", accept: ".pdf,.doc,.docx" },
  { key: "bl", label: "Shipping / Packing List (BL)", accept: ".pdf,.doc,.docx,.xls,.xlsx" },
];

type AttachedFile = {
  id: string;
  fileName: string;
  storagePath: string;
  publicUrl: string;
};

function formatDateDisplay(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(value));
}

type VendorControlsPanelProps = {
  vendorKey: string;
  orderNo: string;
  quotationId: string;
  vendorLabel: string;
  initialDocs?: VendorDocRecord[];
  initialStep?: number;
  initialEtd?: string;
  initialEta?: string;
};

export function VendorControlsPanel({
  vendorKey,
  orderNo,
  quotationId,
  vendorLabel,
  initialDocs,
  initialStep,
  initialEtd,
  initialEta,
}: VendorControlsPanelProps) {
  const [activeStep, setActiveStep] = useState(initialStep ?? 0);
  const [milestoneToast, setMilestoneToast] = useState<string | null>(null);
  const [selectedMilestoneValue, setSelectedMilestoneValue] = useState("");
  const [milestoneNote, setMilestoneNote] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [etd, setEtd] = useState(initialEtd ?? "");
  const [eta, setEta] = useState(initialEta ?? "");
  const [isSavingProgress, setIsSavingProgress] = useState(false);
  const [dateSavedToast, setDateSavedToast] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Record<string, AttachedFile[]>>(() => {
    const result: Record<string, AttachedFile[]> = {};
    for (const doc of initialDocs ?? []) {
      if (!result[doc.slot_key]) result[doc.slot_key] = [];
      result[doc.slot_key].push({
        id: doc.id,
        fileName: doc.file_name,
        storagePath: doc.storage_path,
        publicUrl: doc.public_url,
      });
    }
    return result;
  });
  const [isStoragePending, setIsStoragePending] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleFileChange(slotKey: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsStoragePending(true);
    setStorageError(null);

    try {
      const supabase = createBrowserClient();
      const slugKey = vendorKey.replace(/\s+/g, "_").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const storagePath = `procurement/${orderNo}/${slugKey}/${slotKey}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("project-documents")
        .upload(storagePath, file, { upsert: false });

      if (uploadError) {
        setStorageError("Upload failed: " + uploadError.message);
        return;
      }

      // FUTURE: regenerate signed URL on load if expired (check expiry timestamp)
      const { data: signedData, error: signedError } = await supabase.storage
        .from("project-documents")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 day expiry
      if (signedError || !signedData?.signedUrl) {
        setStorageError("Could not generate file URL.");
        return;
      }
      const publicUrl = signedData.signedUrl;

      const result = await saveVendorDocUrl(
        orderNo, quotationId, vendorKey, slotKey, file.name, storagePath, publicUrl,
      );

      if (!result.ok) {
        setStorageError(result.error);
        return;
      }

      setAttachedFiles((prev) => ({
        ...prev,
        [slotKey]: [...(prev[slotKey] ?? []), { id: result.id, fileName: file.name, storagePath, publicUrl }],
      }));
    } finally {
      setIsStoragePending(false);
    }
  }

  async function handleClear(slotKey: string, id: string, storagePath: string) {
    setIsStoragePending(true);
    setStorageError(null);

    try {
      const result = await deleteVendorDocById(id, storagePath);
      if (!result.ok) {
        setStorageError(result.error);
        return;
      }
      setAttachedFiles((prev) => ({
        ...prev,
        [slotKey]: (prev[slotKey] ?? []).filter((f) => f.id !== id),
      }));
    } finally {
      setIsStoragePending(false);
    }
  }

  async function handleApply() {
    if (!selectedMilestoneValue) return;

    const milestone = MILESTONE_OPTIONS.find((m) => m.value === selectedMilestoneValue);
    if (!milestone) return;

    setIsApplying(true);

    const [progressResult, logResult] = await Promise.all([
      saveVendorProgress(orderNo, vendorKey, milestone.stepIndex, etd, eta),
      logVendorMilestoneAction(orderNo, quotationId, vendorKey, vendorLabel, selectedMilestoneValue, milestone.label, milestoneNote.trim() || null),
    ]);

    if (!progressResult.ok || !logResult.ok) {
      const errorMsg = !progressResult.ok ? progressResult.error : logResult.ok ? "Unknown error" : logResult.error;
      setMilestoneToast(`⚠ ${errorMsg}`);
      setTimeout(() => setMilestoneToast(null), 4000);
      setIsApplying(false);
      return;
    }

    setActiveStep(milestone.stepIndex);
    setSelectedMilestoneValue("");
    setMilestoneNote("");
    setMilestoneToast("✓ Milestone logged");
    setTimeout(() => setMilestoneToast(null), 3000);
    setIsApplying(false);
  }

  async function handleSaveDates() {
    setIsSavingProgress(true);
    setStorageError(null);
    try {
      const result = await saveVendorProgress(orderNo, vendorKey, activeStep, etd, eta);
      if (!result.ok) {
        setStorageError("Failed to save dates: " + result.error);
        return;
      }
      setDateSavedToast(true);
      setTimeout(() => setDateSavedToast(false), 2000);
    } finally {
      setIsSavingProgress(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Step Progress Tracker — driven by milestone dropdown */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Procurement Progress
        </p>
        <div className="flex items-center gap-0">
          {VENDOR_STEPS.map((step, index) => {
            const isCompleted = index < activeStep;
            const isActive = index === activeStep;
            const isLast = index === VENDOR_STEPS.length - 1;

            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition ${
                    isCompleted
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : isActive
                        ? "border-emerald-800 bg-emerald-50 text-emerald-900"
                        : "border-zinc-300 bg-white text-zinc-400"
                  }`}>
                    {isCompleted ? <Check className="h-3.5 w-3.5" /> : String(index + 1)}
                  </div>
                  <span className={`text-center text-[9px] font-semibold leading-tight ${
                    isActive ? "text-emerald-900" : isCompleted ? "text-emerald-700" : "text-zinc-400"
                  }`}>
                    {step.label}
                  </span>
                </div>
                {!isLast && (
                  <div className={`h-0.5 flex-1 transition ${index < activeStep ? "bg-emerald-500" : "bg-zinc-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Factory Status Dropdown */}
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          ⚡ Update Factory Status
        </p>
        <select
          value={selectedMilestoneValue}
          onChange={(e) => setSelectedMilestoneValue(e.target.value)}
          disabled={isApplying}
          className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/10"
        >
          <option value="" disabled>Select milestone...</option>
          {MILESTONE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={milestoneNote}
            onChange={(e) => setMilestoneNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
            placeholder="Optional note..."
            disabled={isApplying}
            className="h-8 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/10"
          />
          <button
            type="button"
            onClick={handleApply}
            disabled={!selectedMilestoneValue || isApplying}
            className="h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {isApplying ? "Applying…" : "Apply"}
          </button>
        </div>
        {milestoneToast ? (
          <p className={`mt-1.5 text-[11px] font-medium ${
            milestoneToast.startsWith("✓") ? "text-emerald-700" : "text-red-600"
          }`}>
            {milestoneToast}
          </p>
        ) : null}
      </div>

      {/* ETD / ETA Date Inputs */}
      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">ETD</span>
              <input
                type="date"
                value={etd}
                onChange={(e) => setEtd(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/10"
              />
            </label>
            <p className="mt-0.5 text-[10px] text-zinc-400">Est. Departure</p>
          </div>
          <div>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">ETA</span>
              <input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/10"
              />
            </label>
            <p className="mt-0.5 text-[10px] text-zinc-400">Est. Arrival</p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={isSavingProgress}
            onClick={handleSaveDates}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 disabled:opacity-50"
          >
            {isSavingProgress ? "Saving…" : "Save dates"}
          </button>
          {dateSavedToast ? (
            <span className="text-[11px] font-medium text-emerald-700">✓ Saved</span>
          ) : null}
        </div>
      </div>

      {/* Transit window summary */}
      {etd && eta ? (
        <p className="rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-800">
          Transit window: {formatDateDisplay(etd)} → {formatDateDisplay(eta)}
        </p>
      ) : null}

      {/* Vendor Document Slots */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Vendor Documents
        </p>
        {storageError ? (
          <p className="mb-2 rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
            {storageError}
          </p>
        ) : null}
        <div className="space-y-1.5">
          {DOC_SLOTS.map((slot) => {
            const slotFiles = attachedFiles[slot.key] ?? [];
            return (
              <div
                key={slot.key}
                className="flex items-start gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-1.5 transition hover:border-zinc-200 hover:bg-white"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-700">{slot.label}</p>
                  {slotFiles.length === 0 ? (
                    <p className="text-[10px] text-zinc-300">No files</p>
                  ) : (
                    <div className="mt-0.5 space-y-0.5">
                      {slotFiles.map((f) => (
                        <div key={f.id} className="flex items-center gap-1">
                          <FileIcon className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />
                          <span className="min-w-0 truncate text-[10px] font-medium text-emerald-800">
                            {f.fileName}
                          </span>
                          <a
                            href={f.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-0.5 shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900"
                          >
                            View
                          </a>
                          <button
                            type="button"
                            disabled={isStoragePending}
                            onClick={() => handleClear(slot.key, f.id, f.storagePath)}
                            className="shrink-0 rounded border border-red-100 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-red-500 transition hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                          >
                            Del
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  accept={slot.accept}
                  className="hidden"
                  ref={(el) => { inputRefs.current[slot.key] = el; }}
                  onChange={(e) => handleFileChange(slot.key, e)}
                  aria-label={`Upload ${slot.label}`}
                />
                <button
                  type="button"
                  disabled={isStoragePending}
                  onClick={() => inputRefs.current[slot.key]?.click()}
                  className="mt-0.5 shrink-0 rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900 disabled:opacity-50"
                >
                  {isStoragePending ? "…" : "Upload"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
