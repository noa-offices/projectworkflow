import type { NextRequest } from "next/server";
import { listMovementsForReport } from "@/lib/inventory/queries";
import { reportFileName } from "@/lib/inventory/reports/format";
import { REPORT_FAILED_MESSAGE, XLSX_TYPE, reportError, reportFile, requireReportManager } from "@/lib/inventory/reports/http";
import { MOVEMENT_REPORT_LIMIT, NARROW_RANGE_MESSAGE, ReportTooLargeError, buildMovementsWorkbook, movementFilterLines } from "@/lib/inventory/reports/movements-report";
import { parseMovementReportParams } from "@/lib/inventory/reports/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const guard = await requireReportManager(request);
  if (!guard.ok) return guard.response;
  const parsed = parseMovementReportParams(request.nextUrl.searchParams);
  if (!parsed.ok) return reportError(400, parsed.error);
  const { bounds, ...filters } = parsed.value;
  try {
    const generatedAt = new Date();
    const movements = await listMovementsForReport({ product_id: filters.product || undefined, action_type: filters.action || undefined, location: filters.location || undefined, person: filters.person || undefined, from: bounds.from, to: bounds.to }, MOVEMENT_REPORT_LIMIT);
    const buffer = await buildMovementsWorkbook(movements, { generatedAt, filterLines: movementFilterLines(filters, { product: movements[0]?.product?.item_name ?? null }) });
    return reportFile(buffer, reportFileName("inventory-movements", "xlsx", generatedAt), XLSX_TYPE);
  } catch (error) {
    if (error instanceof ReportTooLargeError) return reportError(413, NARROW_RANGE_MESSAGE);
    console.error("INVENTORY MOVEMENTS REPORT ERROR", error instanceof Error ? error.message : error);
    return reportError(500, REPORT_FAILED_MESSAGE);
  }
}
