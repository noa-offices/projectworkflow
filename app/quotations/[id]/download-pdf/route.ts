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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout>;

  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function launchPdfBrowser() {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  console.log("chromium package loaded");

  const chromium = (await import("@sparticuz/chromium")).default;
  const { chromium: playwrightChromium } = await import("playwright-core");

  if (!isServerless) {
    return playwrightChromium.launch({
      headless: true,
    });
  }

  console.log("chromium executablePath start");
  let executablePath: string;
  try {
    executablePath = await chromium.executablePath();
  } catch (error) {
    console.error("CHROMIUM EXECUTABLE PATH ERROR", {
      cwd: process.cwd(),
      message: error instanceof Error ? error.message : String(error),
      vercel: process.env.VERCEL ?? null,
    });
    throw error;
  }

  return playwrightChromium.launch({
    args: chromium.args,
    executablePath,
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
  const fallbackUrl = new URL(`/quotations/${id}/pdf?print=1`, origin);
  let browser:
    | Awaited<ReturnType<typeof launchPdfBrowser>>
    | null = null;

  try {
    browser = await launchPdfBrowser();
    const context = await browser.newContext({
      extraHTTPHeaders: cookieHeader ? { cookie: cookieHeader } : undefined,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);

    await page.goto(previewUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const renderedPath = new URL(page.url()).pathname;

    if (renderedPath === "/login" || renderedPath === "/pending-approval") {
      throw new Error(`PDF preview loaded an auth page instead of quotation content: ${renderedPath}`);
    }

    await page.emulateMedia({ media: "print" });

    const pdf = await withTimeout(
      page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: `
          <div style="width:100%; font-size:8px; color:#6b7280; text-align:center; padding:0 8mm;">
            Page <span class="pageNumber"></span> of <span class="totalPages"></span>
          </div>
        `,
        margin: {
          top: "8mm",
          right: "8mm",
          bottom: "12mm",
          left: "8mm",
        },
        preferCSSPageSize: true,
      }),
      30_000,
      "PDF rendering timed out.",
    );
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
    return Response.redirect(fallbackUrl, 307);
  } finally {
    await browser?.close();
  }
}
