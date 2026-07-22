"use client";

import { useRef, type ReactNode } from "react";

export function QuotationFolderActionDialog({
  children,
  label,
  title,
}: {
  children: ReactNode;
  label: string;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="inline-flex h-9 w-full items-center rounded-md border border-zinc-200 bg-white px-3 text-left text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
        onClick={() => dialogRef.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={dialogRef}
        className="w-[min(960px,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-0 shadow-xl backdrop:bg-zinc-950/40"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
          <button
            type="button"
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-semibold text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-5">
          {children}
        </div>
      </dialog>
    </>
  );
}
