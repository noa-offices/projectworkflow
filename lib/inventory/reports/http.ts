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
export function reportError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: noStore });
}
export function reportFile(body: Uint8Array | Buffer, filename: string, contentType: string): Response {
  const bytes = new Uint8Array(body);
  return new Response(bytes, { headers: { ...noStore, "Content-Type": contentType, "Content-Length": String(bytes.byteLength), "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}` } });
}
