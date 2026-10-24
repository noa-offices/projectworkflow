import { requireInventoryUser } from "@/lib/auth";
import { canUseManagerMovements } from "../movement-form";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PDF_TYPE = "application/pdf";
export const REPORT_FAILED_MESSAGE = "The file could not be made. Please try again.";

/** Role check for every report route. Others are sent back to Inventory; nothing is read first. */
export async function requireReportManager(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { profile } = await requireInventoryUser();
  if (canUseManagerMovements(profile?.role)) return { ok: true };
  return { ok: false, response: Response.redirect(new URL("/inventory", request.url), 303) };
}
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
/** Tells the screen about photos: how many could not be loaded, or that there were too many to include. */
export function photoHeaders(info: { skipped: number; omitted: boolean }): Record<string, string> {
  return { ...(info.omitted ? { "X-Photos-Omitted": "too-many" } : {}), ...(info.skipped > 0 ? { "X-Photos-Skipped": String(info.skipped) } : {}), "Access-Control-Expose-Headers": "X-Photos-Omitted, X-Photos-Skipped, Content-Disposition" };
}
export function reportError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: noStore });
}
export function reportFile(body: Uint8Array | Buffer, filename: string, contentType: string, extraHeaders: Record<string, string> = {}): Response {
  const bytes = new Uint8Array(body);
  return new Response(bytes, { headers: { ...noStore, ...extraHeaders, "Content-Type": contentType, "Content-Length": String(bytes.byteLength), "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}` } });
}
