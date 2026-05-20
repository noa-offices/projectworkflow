import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";
import { loadProcurementRfqSettings } from "@/lib/quotations/procurement-rfq-settings-store";
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

type DownloadProcurementRfqRouteContext = {
  params: Promise<{ id: string }>;
};

function procurementRfqFilename(rfqNumber: string, scopeLabel: string) {
  return `${rfqNumber} - ${scopeLabel}`.replace(/[\\/:*?"<>|]/g, "-");
}

function requestOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host");

  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: NextRequest, { params }: DownloadProcurementRfqRouteContext) {
  await requireActiveUser();

  const { id } = await params;
  const [data, settingsResult] = await Promise.all([
    loadQuotationDerivedDocumentData(id),
    loadProcurementRfqSettings(id),
  ]);

  if (!data) {
    return new Response("Quotation not found.", { status: 404 });
  }

  const savedGroupKey = settingsResult.success ? settingsResult.settings.selectedGroupKey : "all";
  const effectiveGroups = buildEffectiveDocumentGroups(data.items);
  const selectedGroup = savedGroupKey !== "all"
    ? effectiveGroups.find((group) => group.dedupeKey === savedGroupKey) ?? null
    : null;
  const savedSupplierOverride = settingsResult.success && selectedGroup
    ? selectedGroup.keys
      .map((key) => settingsResult.settings.supplierOverrides[key])
      .find((entry) => entry?.displayName)
    : null;
  const rfqNumber = settingsResult.success
    ? settingsResult.settings.documentDetails.rfqNumber || `RFQ-${data.quotation.quotation_no ?? "Draft"}`
    : `RFQ-${data.quotation.quotation_no ?? "Draft"}`;
  const scopeLabel = savedGroupKey === "all"
    ? "All Suppliers"
    : savedSupplierOverride?.displayName || selectedGroup?.displayLabel || "All Suppliers";

  const origin = requestOrigin(request);
  const sourceUrl = `${origin}/quotations/${id}/procurement-rfq?print=1`;
  const fallbackUrl = new URL(`/quotations/${id}/procurement-rfq?print=1`, origin);
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
    const filename = `${procurementRfqFilename(rfqNumber, scopeLabel)}.pdf`;
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
    console.error("PROCUREMENT RFQ DOWNLOAD ERROR", pdfError);
    return Response.redirect(fallbackUrl, 307);
  }
}
