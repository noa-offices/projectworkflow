"use client";

import { useRef, useState, useTransition } from "react";
import type React from "react";
import { logVendorMilestoneAction } from "@/lib/procurement/log-vendor-milestone-action";
import { saveVendorDocUrl, deleteVendorDoc, type VendorDocRecord } from "@/lib/procurement/vendor-docs-action";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { Check, FileText as FileIcon } from "lucide-react";

type VendorStep = {
  key: string;
  label: string;
};

const VENDOR_STEPS: VendorStep[] = [
  { key: "rfq", label: "RFQ" },
  { key: "po_issued", label: "PO Issued" },
  { key: "deposit_paid", label: "Deposit Paid" },
  { key: "in_production", label: "In Production" },
  { key: "shipped", label: "Shipped" },
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
};

export function VendorControlsPanel({ vendorKey, orderNo, quotationId, vendorLabel, initialDocs }: VendorControlsPanelProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [milestoneToast, setMilestoneToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedStatus, setSelectedStatus] = useState("");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<
    Record<string, { fileName: string; storagePath: string; publicUrl: string }>
  >(() => {
    const result: Record<string, { fileName: string; storagePath: string; publicUrl: string }> = {};
    for (const doc of initialDocs ?? []) {
      result[doc.slot_key] = {
        fileName: doc.file_name,
        storagePath: doc.storage_path,
        publicUrl: doc.public_url,
      };
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
      const storagePath = `procurement/${orderNo}/${slugKey}/${slotKey}/${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("project-documents")
        .upload(storagePath, file, { upsert: true });

      if (uploadError) {
        setStorageError("Upload failed: " + uploadError.message);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("project-documents")
        .getPublicUrl(storagePath);

      const publicUrl = urlData.publicUrl;

      const result = await saveVendorDocUrl(
        orderNo, quotationId, vendorKey, slotKey, file.name, storagePath, publicUrl,
      );

      if (!result.ok) {
        setStorageError(result.error);
        return;
      }

      setAttachedFiles((prev) => ({
        ...prev,
        [slotKey]: { fileName: file.name, storagePath, publicUrl },
      }));
    } finally {
      setIsStoragePending(false);
    }
  }

  async function handleClear(slotKey: string) {
    const existing = attachedFiles[slotKey];
    if (!existing) return;

    setIsStoragePending(true);
    setStorageError(null);

    try {
      const result = await deleteVendorDoc(orderNo, vendorKey, slotKey, existing.storagePath);
      if (!result.ok) {
        setStorageError(result.error);
        return;
      }
      setAttachedFiles((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
    } finally {
      setIsStoragePending(false);
    }
  }

  function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (!value) return;

    const STEP_INDEX: Record<string, number> = {
      po_issued: 1,
      deposit_paid: 2,
      in_production: 3,
      shipped: 4,
    };
    const STEP_LABEL: Record<string, string> = {
      po_issued: "📋 PO Issued",
      deposit_paid: "💰 Deposit Paid",
      in_production: "🏭 In Production",
      shipped: "🚢 Shipped",
    };

    const stepIndex = STEP_INDEX[value] ?? 0;
    const stepLabel = STEP_LABEL[value] ?? value;

    setActiveStep(stepIndex);
    setSelectedStatus("");

    startTransition(async () => {
      const result = await logVendorMilestoneAction(
        orderNo, quotationId, vendorKey, vendorLabel, value, stepLabel,
      );
      const msg = result.ok ? "✓ Milestone logged" : `⚠ ${result.error}`;
      setMilestoneToast(msg);
      setTimeout(() => setMilestoneToast(null), 3000);
    });
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Step Progress Tracker — visual only, driven by dropdown */}
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
          value={selectedStatus}
          disabled={isPending}
          onChange={handleStatusChange}
          className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="" disabled>Select milestone...</option>
          <option value="po_issued">📋 PO Issued</option>
          <option value="deposit_paid">💰 Deposit Paid</option>
          <option value="in_production">🏭 In Production</option>
          <option value="shipped">🚢 Shipped</option>
        </select>
        {milestoneToast ? (
          <p className={`mt-1.5 text-[11px] font-medium ${
            milestoneToast.startsWith("✓") ? "text-emerald-700" : "text-red-600"
          }`}>
            {milestoneToast}
          </p>
        ) : null}
      </div>

      {/* ETD / ETA Date Inputs */}
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
            const attached = attachedFiles[slot.key];
            return (
              <div
                key={slot.key}
                className="flex items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-1.5 transition hover:border-zinc-200 hover:bg-white"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-700">{slot.label}</p>
                  {attached ? (
                    <div className="mt-0.5 flex items-center gap-1">
                      <FileIcon className="h-3 w-3 shrink-0 text-emerald-700" />
                      <span className="truncate text-[10px] font-medium text-emerald-800">
                        {attached.fileName}
                      </span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-zinc-300">No file</p>
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
                {attached ? (
                  <div className="flex shrink-0 gap-1">
                    <a
                      href={attached.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900"
                    >
                      View
                    </a>
                    <button
                      type="button"
                      disabled={isStoragePending}
                      onClick={() => handleClear(slot.key)}
                      className="rounded border border-red-100 bg-white px-2 py-1 text-[10px] font-semibold text-red-500 transition hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={isStoragePending}
                    onClick={() => inputRefs.current[slot.key]?.click()}
                    className="shrink-0 rounded border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900 disabled:opacity-50"
                  >
                    {isStoragePending ? "…" : "Upload"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
