"use client";

import { useRef, useState } from "react";
import type React from "react";
import {
  FileText,
  ClipboardList,
  Ruler,
  Factory,
  ShoppingCart,
  PackageCheck,
  Truck,
  Wrench,
  StickyNote,
  FolderOpen,
  FileText as FileIcon,
} from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  saveProjectDoc,
  deleteProjectDocById,
  type ProjectDocRecord,
} from "@/lib/projects/project-doc-action";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "file-text": FileText,
  "clipboard-list": ClipboardList,
  "ruler": Ruler,
  "factory": Factory,
  "shopping-cart": ShoppingCart,
  "package-check": PackageCheck,
  "truck": Truck,
  "wrench": Wrench,
  "sticky-note": StickyNote,
  "folder-open": FolderOpen,
};

type AttachedFile = {
  id: string;
  fileName: string;
  storagePath: string;
  publicUrl: string;
};

export type DocumentRowProps = {
  iconKey: string;
  label: string;
  hint: string;
  procurementLinked?: boolean;
  accept?: string;
  orderNo: string;
  initialDoc?: ProjectDocRecord[];
};

export function DocumentRow({
  iconKey,
  label,
  hint,
  procurementLinked,
  accept = ".pdf,.doc,.docx,.dwg,.jpg,.png",
  orderNo,
  initialDoc,
}: DocumentRowProps) {
  const Icon = ICON_MAP[iconKey] ?? FileText;
  const inputRef = useRef<HTMLInputElement>(null);

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>(() =>
    (initialDoc ?? []).map((doc) => ({
      id: doc.id,
      fileName: doc.file_name,
      storagePath: doc.storage_path,
      publicUrl: doc.public_url,
    })),
  );
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function showError(msg: string) {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 4000);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const slotKey = label.toLowerCase().replace(/\s+/g, "_");
    const storagePath = `projects/${orderNo}/${slotKey}/${Date.now()}_${file.name}`;

    setIsUploading(true);
    setErrorMsg(null);

    try {
      const supabase = createBrowserClient();

      const { error: uploadError } = await supabase.storage
        .from("project-documents")
        .upload(storagePath, file, { upsert: false });

      if (uploadError) {
        showError("Upload failed: " + uploadError.message);
        return;
      }

      // FUTURE: regenerate signed URL on load if expired (check expiry timestamp)
      const { data: signedData, error: signedError } = await supabase.storage
        .from("project-documents")
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 day expiry
      if (signedError || !signedData?.signedUrl) {
        showError("Could not generate file URL.");
        return;
      }
      const publicUrl = signedData.signedUrl;

      const result = await saveProjectDoc(orderNo, slotKey, file.name, storagePath, publicUrl);

      if (!result.ok) {
        showError(result.error);
        return;
      }

      setAttachedFiles((prev) => [
        ...prev,
        { id: result.id, fileName: file.name, storagePath, publicUrl },
      ]);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleClear(id: string, storagePath: string) {
    setIsUploading(true);
    setErrorMsg(null);

    try {
      const result = await deleteProjectDocById(id, storagePath);

      if (!result.ok) {
        showError(result.error);
        return;
      }

      setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 transition hover:shadow-sm">

      {/* Top row: icon + label + add button */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-100 bg-zinc-50">
            <Icon className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-800">{label}</p>
            {procurementLinked ? (
              <span className="mt-0.5 inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                Procurement linked
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-semibold text-zinc-500 transition hover:border-emerald-800 hover:text-emerald-900 disabled:opacity-50"
        >
          {isUploading ? "…" : "+ Add"}
        </button>
      </div>

      {/* Hint */}
      <p className="mt-1.5 text-[10px] leading-snug text-zinc-400">{hint}</p>

      {/* File list */}
      {attachedFiles.length > 0 ? (
        <div className="mt-2 space-y-1">
          {attachedFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 rounded border border-zinc-100 bg-zinc-50 px-2 py-1">
              <FileIcon className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-emerald-800">
                {f.fileName}
              </span>
              <a
                href={f.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold text-zinc-500 transition hover:text-zinc-800"
              >
                View
              </a>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => handleClear(f.id, f.storagePath)}
                className="text-[10px] font-semibold text-red-400 transition hover:text-red-600 disabled:opacity-50"
              >
                Del
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-zinc-300">No files yet</p>
      )}

      {/* Error */}
      {errorMsg ? (
        <p className="mt-1 text-[10px] text-red-500">{errorMsg}</p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        aria-label={`Upload file for ${label}`}
      />
    </div>
  );
}
