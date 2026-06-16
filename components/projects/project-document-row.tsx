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
  X,
  FileText as FileIcon,
} from "lucide-react";

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

export type DocumentRowProps = {
  iconKey: string;
  label: string;
  hint: string;
  procurementLinked?: boolean;
  accept?: string;
};

export function DocumentRow({
  iconKey,
  label,
  hint,
  procurementLinked,
  accept = ".pdf,.doc,.docx,.dwg,.jpg,.png",
}: DocumentRowProps) {
  const Icon = ICON_MAP[iconKey] ?? FileText;
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // FUTURE STORAGE HOOK (Phase 3C): Upload file to Supabase Storage bucket
    // project-documents/{orderNo}/{label-slug}/{file.name}
    // then store the signed URL in project_document_attachments table.
    setAttachedFile(file.name);

    // Reset input so the same file can be re-selected if cleared
    e.target.value = "";
  }

  function handleClear() {
    // FUTURE STORAGE HOOK (Phase 3C): Delete file from Supabase Storage
    // and remove the record from project_document_attachments table.
    setAttachedFile(null);
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2.5 transition hover:border-zinc-200 hover:bg-white">

      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white">
        <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-zinc-800">{label}</p>
          {procurementLinked ? (
            <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              Procurement linked
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-400">{hint}</p>

        {attachedFile ? (
          <div className="mt-1 flex items-center gap-1.5">
            <FileIcon className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />
            <span className="truncate text-xs font-medium text-emerald-800">{attachedFile}</span>
            <button
              type="button"
              onClick={handleClear}
              className="ml-0.5 rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
              aria-label="Remove file"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-zinc-300">No files attached</p>
        )}
      </div>

      {/* Hidden native file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        aria-label={`Upload file for ${label}`}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="shrink-0 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900"
      >
        Upload
      </button>

    </div>
  );
}
