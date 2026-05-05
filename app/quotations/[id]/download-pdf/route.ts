import serverlessChromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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

async function launchPdfBrowser() {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  return playwrightChromium.launch({
    args: isServerless ? serverlessChromium.args : undefined,
    executablePath: isServerless ? await serverlessChromium.executablePath() : undefined,
    headless: true,
  });
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

  const origin = new URL(request.url).origin;
  const previewUrl = new URL(`/quotations/${id}/pdf?download=1`, origin);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const browser = await launchPdfBrowser();

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
    const renderedPath = new URL(page.url()).pathname;

    if (renderedPath === "/login" || renderedPath === "/pending-approval") {
      throw new Error(`PDF preview loaded an auth page instead of quotation content: ${renderedPath}`);
    }

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

    return new Response("PDF generation failed. Please use Preview PDF as a fallback.", { status: 500 });
  } finally {
    await browser.close();
  }
}
