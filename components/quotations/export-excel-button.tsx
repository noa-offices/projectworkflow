"use client";

import { FileSpreadsheet } from "lucide-react";
import { exportQuotationToExcel, type ExportQuotationData } from "@/lib/quotations/export-to-excel";

export type { ExportQuotationData };

export function ExportExcelButton({
  data,
  className,
}: {
  data: ExportQuotationData;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => exportQuotationToExcel(data)}
      className={
        className ??
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      }
    >
      <FileSpreadsheet className="h-4 w-4 shrink-0" />
      Export Excel
    </button>
  );
}
