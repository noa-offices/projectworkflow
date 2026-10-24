import type { NextRequest } from "next/server";
import { listCurrentInventoryReport } from "@/lib/inventory/queries";
import { buildCurrentInventoryPdfHtml, buildCurrentInventoryWorkbook, currentFilterLines, reportPdfOptions } from "@/lib/inventory/reports/current-inventory";
import { reportFileName } from "@/lib/inventory/reports/format";
import { PDF_TYPE, REPORT_FAILED_MESSAGE, XLSX_TYPE, photoHeaders, reportError, reportFile, requireReportManager } from "@/lib/inventory/reports/http";
import { parseCurrentInventoryParams } from "@/lib/inventory/reports/params";
import { CURRENT_PHOTO_LIMIT, loadReportPhotos } from "@/lib/inventory/reports/photos";
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
    const generatedAt = new Date(), wantPhotos = format === "xlsx" ? filters.excelPhotos : filters.photos;
    const { rows, brandName, categoryName, photosOmitted } = await listCurrentInventoryReport(filters, { photos: wantPhotos, photoLimit: CURRENT_PHOTO_LIMIT });
    const meta = { generatedAt, filterLines: currentFilterLines(filters, { brand: brandName, category: categoryName }) };
    if (format === "xlsx") {
      // A photo that cannot be loaded is skipped: it never stops the report.
      const photos = wantPhotos && !photosOmitted ? await loadReportPhotos(rows.map(row => ({ url: row.photo_url }))) : null;
      return reportFile(await buildCurrentInventoryWorkbook(rows, meta, photos), reportFileName("inventory-current", "xlsx", generatedAt), XLSX_TYPE, photoHeaders({ skipped: photos?.skipped ?? 0, omitted: photosOmitted }));
    }
    const pdf = await generatePdfFromHtml({ html: buildCurrentInventoryPdfHtml(rows, meta, { photos: wantPhotos && !photosOmitted }), pdfOptions: reportPdfOptions(meta) });
    return reportFile(pdf, reportFileName("inventory-current", "pdf", generatedAt), PDF_TYPE, photoHeaders({ skipped: 0, omitted: photosOmitted }));
  } catch (error) {
    console.error("INVENTORY CURRENT REPORT ERROR", error instanceof Error ? error.message : error);
    return reportError(500, REPORT_FAILED_MESSAGE);
  }
}
