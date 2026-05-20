import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { loadPurchaseOrderSettings } from "@/lib/quotations/purchase-order-settings-store";
import { loadQuotationDerivedDocumentData } from "@/lib/quotations/derived-document-data";
import { generatePdfBuffer } from "@/lib/server/generate-pdf-buffer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const A4_LANDSCAPE_VIEWPORT = {
  width: 1404,
  height: 993,
  deviceScaleFactor: 2,
  hasTouch: false,
  isLandscape: true,
  isMobile: false,
} as const;

type DownloadPurchaseOrderRouteContext = {
  params: Promise<{ id: string }>;
};

function effectiveSupplierLabel(items: Array<{ supplier_name_snapshot: string | null; brand_name_snapshot: string | null }>, selectedKey: string) {
  const groups = buildEffectiveDocumentGroups(items);
  const group = groups.find((entry) => entry.dedupeKey === selectedKey) ?? groups[0] ?? null;
  return group?.displayLabel || "Supplier";
}

function purchaseOrderFilename(poNumber: string, supplierName: string) {
  return `${poNumber} - ${supplierName}`.replace(/[\\/:*?"<>|]/g, "-");
}

function requestOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host");

  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: NextRequest, { params }: DownloadPurchaseOrderRouteContext) {
  await requireActiveUser();

  const { id } = await params;
  const [data, settingsResult] = await Promise.all([
    loadQuotationDerivedDocumentData(id),
    loadPurchaseOrderSettings(id),
  ]);

  if (!data) {
    return new Response("Quotation not found.", { status: 404 });
  }

  const poNumber = settingsResult.success ? settingsResult.settings.documentDetails.poNumber || `PO-${data.quotation.quotation_no ?? "Draft"}` : `PO-${data.quotation.quotation_no ?? "Draft"}`;
  const availableGroups = buildEffectiveDocumentGroups(data.items);
  const selectedKey = settingsResult.success && availableGroups.some((group) => group.dedupeKey === settingsResult.settings.selectedSupplierKey)
    ? settingsResult.settings.selectedSupplierKey
    : availableGroups[0]?.dedupeKey ?? "";
  const selectedGroup = availableGroups.find((group) => group.dedupeKey === selectedKey) ?? availableGroups[0] ?? null;
  const savedSupplierOverride = settingsResult.success && selectedGroup
    ? selectedGroup.keys
      .map((key) => settingsResult.settings.supplierOverrides[key])
      .find(Boolean)
    : null;
  const supplierName = savedSupplierOverride?.displayName || effectiveSupplierLabel(data.items, selectedKey) || "Supplier";

  const origin = requestOrigin(request);
  const sourceUrl = `${origin}/quotations/${id}/purchase-order?print=1`;
  const fallbackUrl = new URL(`/quotations/${id}/purchase-order?print=1`, origin);
  const cookieHeader = request.headers.get("cookie") ?? "";

  try {
    const pdfBuffer = await generatePdfBuffer({
      cookieHeader,
      pdfOptions: {
        displayHeaderFooter: false,
        format: "A4",
        landscape: true,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        },
      },
      sourceUrl,
      viewport: A4_LANDSCAPE_VIEWPORT,
    });
    const filename = `${purchaseOrderFilename(poNumber, supplierName)}.pdf`;
    const pdfBody = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength,
    ) as ArrayBuffer;

    return new Response(pdfBody, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (pdfError) {
    console.error("PURCHASE ORDER DOWNLOAD ERROR", pdfError);
    return Response.redirect(fallbackUrl, 307);
  }
}
