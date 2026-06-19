import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { loadDeliveryNoteSettings } from "@/lib/quotations/delivery-note-settings-store";
import { loadQuotationDerivedDocumentData } from "@/lib/quotations/derived-document-data";
import { generatePdfBuffer } from "@/lib/server/generate-pdf-buffer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const A4_PORTRAIT_VIEWPORT = {
  width: 794,
  height: 1123,
  deviceScaleFactor: 2,
  hasTouch: false,
  isLandscape: false,
  isMobile: false,
} as const;

const A4_LANDSCAPE_VIEWPORT = {
  width: 1404,
  height: 993,
  deviceScaleFactor: 2,
  hasTouch: false,
  isLandscape: true,
  isMobile: false,
} as const;

type DownloadDeliveryNoteRouteContext = {
  params: Promise<{ id: string }>;
};

function deliveryNoteFilename(dnNumber: string) {
  const safe = (dnNumber || "Delivery-Note").replace(/[\\/:*?"<>|]/g, "-");
  return `Delivery-Note-${safe}.pdf`;
}

function requestOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host");
  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }
  return new URL(request.url).origin;
}

export async function GET(request: NextRequest, { params }: DownloadDeliveryNoteRouteContext) {
  await requireActiveUser();

  const { id } = await params;
  const [data, settingsResult] = await Promise.all([
    loadQuotationDerivedDocumentData(id),
    loadDeliveryNoteSettings(id),
  ]);

  if (!data) {
    return new Response("Quotation not found.", { status: 404 });
  }

  const dnNumber = settingsResult.success
    ? settingsResult.settings.dnNumber || `DN-${data.quotation.quotation_no ?? "Draft"}`
    : `DN-${data.quotation.quotation_no ?? "Draft"}`;

  const landscape = settingsResult.success
    ? settingsResult.settings.orientation === "landscape"
    : false;

  const origin = requestOrigin(request);
  const sourceUrl = `${origin}/quotations/${id}/delivery-note?print=1`;
  const fallbackUrl = new URL(`/quotations/${id}/delivery-note?print=1`, origin);
  const cookieHeader = request.headers.get("cookie") ?? "";

  try {
    const pdfBuffer = await generatePdfBuffer({
      cookieHeader,
      pdfOptions: {
        displayHeaderFooter: false,
        format: "A4",
        landscape,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      },
      sourceUrl,
      viewport: landscape ? A4_LANDSCAPE_VIEWPORT : A4_PORTRAIT_VIEWPORT,
    });

    const filename = deliveryNoteFilename(dnNumber);
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
    console.error("DELIVERY NOTE DOWNLOAD ERROR", pdfError);
    return Response.redirect(fallbackUrl, 307);
  }
}
