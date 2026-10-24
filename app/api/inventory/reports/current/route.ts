import type { NextRequest } from "next/server";
import { listCurrentInventoryReport } from "@/lib/inventory/queries";
import { buildCurrentInventoryPdfHtml, buildCurrentInventoryWorkbook, currentFilterLines, reportPdfOptions } from "@/lib/inventory/reports/current-inventory";
import { reportFileName } from "@/lib/inventory/reports/format";
import { PDF_TYPE, REPORT_FAILED_MESSAGE, XLSX_TYPE, reportError, reportFile, requireReportManager } from "@/lib/inventory/reports/http";
import { parseCurrentInventoryParams } from "@/lib/inventory/reports/params";
import { generatePdfFromHtml } from "@/lib/server/generate-pdf-buffer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const guard = await requireReportManager(request);
  if (!guard.ok) return guard.response;
  const parsed = parseCurrentInventoryParams(request.nextUrl.searchParams);
  if (!parsed.ok) return reportError(400, parsed.error);
  const { format, ...filters } = parsed.value;
  try {
    const generatedAt = new Date(), { rows, brandName, categoryName } = await listCurrentInventoryReport(filters);
    const meta = { generatedAt, filterLines: currentFilterLines(filters, { brand: brandName, category: categoryName }) };
    if (format === "xlsx") return reportFile(await buildCurrentInventoryWorkbook(rows, meta), reportFileName("inventory-current", "xlsx", generatedAt), XLSX_TYPE);
    const pdf = await generatePdfFromHtml({ html: buildCurrentInventoryPdfHtml(rows, meta, { photos: filters.photos }), pdfOptions: reportPdfOptions(meta) });
    return reportFile(pdf, reportFileName("inventory-current", "pdf", generatedAt), PDF_TYPE);
  } catch (error) {
    console.error("INVENTORY CURRENT REPORT ERROR", error instanceof Error ? error.message : error);
    return reportError(500, REPORT_FAILED_MESSAGE);
  }
}
