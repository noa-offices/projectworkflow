import { chromium } from "playwright";
import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const previewUrl = new URL(`/quotations/${id}/pdf?download=1`, request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      extraHTTPHeaders: cookieHeader ? { cookie: cookieHeader } : undefined,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(previewUrl.toString(), {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.emulateMedia({ media: "print" });

    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: false,
      margin: {
        top: "8mm",
        right: "8mm",
        bottom: "8mm",
        left: "8mm",
      },
      preferCSSPageSize: true,
    });
    const filename = `${quotationPdfFilename(quotation)}.pdf`;
    const pdfBody = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;

    return new Response(pdfBody, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (pdfError) {
    console.error("QUOTATION PDF DOWNLOAD ERROR", pdfError);

    return new Response("Quotation PDF could not be generated.", { status: 500 });
  } finally {
    await browser.close();
  }
}
