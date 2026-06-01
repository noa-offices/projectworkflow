import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { loadOrderConfirmationSettings } from "@/lib/quotations/order-confirmation-settings-store";
import { generatePdfBuffer } from "@/lib/server/generate-pdf-buffer";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

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

type DownloadOrderConfirmationRouteContext = {
  params: Promise<{ id: string }>;
};

type QuotationFilenameData = {
  quotation_no: string | null;
  title: string;
};

function orderConfirmationFilename(quotation: QuotationFilenameData) {
  const quotationNo = quotation.quotation_no ?? "Draft";
  const title = quotation.title || "Quotation";

  return `${quotationNo} - ${title} - Order Confirmation`.replace(/[\\/:*?"<>|]/g, "-");
}

function requestOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host");

  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: NextRequest, { params }: DownloadOrderConfirmationRouteContext) {
  await requireActiveUser();

  const { id } = await params;
  const supabase = await createSupabaseClient();
  const [quotationResult, settingsResult] = await Promise.all([
    supabase
      .from("quotations")
      .select("quotation_no,title")
      .eq("id", id)
      .maybeSingle<QuotationFilenameData>(),
    loadOrderConfirmationSettings(id),
  ]);
  const { data: quotation, error } = quotationResult;

  if (error) {
    console.error("ORDER CONFIRMATION DOWNLOAD LOOKUP ERROR", error.message);
  }

  if (!quotation) {
    return new Response("Quotation not found.", { status: 404 });
  }

  const origin = requestOrigin(request);
  const sourceUrl = `${origin}/quotations/${id}/order-confirmation?print=1`;
  const fallbackUrl = new URL(`/quotations/${id}/order-confirmation?print=1`, origin);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const landscape = settingsResult.success ? settingsResult.settings.print.orientation === "landscape" : false;

  try {
    const pdfBuffer = await generatePdfBuffer({
      cookieHeader,
      pdfOptions: {
        displayHeaderFooter: false,
        format: "A4",
        landscape,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        },
      },
      sourceUrl,
      viewport: landscape ? A4_LANDSCAPE_VIEWPORT : A4_PORTRAIT_VIEWPORT,
    });
    const filename = `${orderConfirmationFilename(quotation)}.pdf`;
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
    console.error("ORDER CONFIRMATION DOWNLOAD ERROR", pdfError);
    return Response.redirect(fallbackUrl, 307);
  }
}
