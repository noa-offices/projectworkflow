import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { loadQuotationPdfSettings } from "@/lib/quotations/quotation-pdf-settings-store";
import { generatePdfBuffer } from "@/lib/server/generate-pdf-buffer";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const A4_LANDSCAPE_VIEWPORT = {
  width: 1123,
  height: 794,
  deviceScaleFactor: 2,
  hasTouch: false,
  isLandscape: true,
  isMobile: false,
} as const;

type DownloadPdfRouteContext = {
  params: Promise<{ id: string }>;
};

type QuotationFilenameData = {
  quotation_no: string | null;
  title: string;
};

function quotationPdfFilename(quotation: QuotationFilenameData) {
  const quotationNo = quotation.quotation_no ?? "Draft";
  const title = quotation.title || "Quotation";

  return `${quotationNo} - ${title}`.replace(/[\\/:*?"<>|]/g, "-");
}

function requestOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("host");

  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }

  return new URL(request.url).origin;
}

export async function GET(request: NextRequest, { params }: DownloadPdfRouteContext) {
  await requireActiveUser();

  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation, error } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<QuotationFilenameData>();

  if (error) {
    console.error("QUOTATION PDF DOWNLOAD LOOKUP ERROR", error.message);
  }

  if (!quotation) {
    return new Response("Quotation not found.", { status: 404 });
  }

  const origin = requestOrigin(request);
  const sourceUrl = `${origin}/quotations/${id}/pdf?print=1`;
  const fallbackUrl = new URL(`/quotations/${id}/pdf?print=1`, origin);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const settingsResult = await loadQuotationPdfSettings(id);
  const isLandscape = settingsResult.success
    ? settingsResult.settings.orientation === "landscape"
    : true;

  try {
    const pdfBuffer = await generatePdfBuffer({
      cookieHeader,
      pdfOptions: {
        displayHeaderFooter: false,
        format: "A4",
        landscape: isLandscape,
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
    const filename = `${quotationPdfFilename(quotation)}.pdf`;
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
    console.error("QUOTATION PDF DOWNLOAD ERROR", pdfError);
    return Response.redirect(fallbackUrl, 307);
  }
}
