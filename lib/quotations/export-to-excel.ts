"use client";

export async function exportQuotationToExcel(quotationId: string): Promise<void> {
  const res = await fetch(
    "/api/export-quotation?quotationId=" + encodeURIComponent(quotationId),
  );
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = res.headers.get("X-Filename") ?? "quotation.xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
