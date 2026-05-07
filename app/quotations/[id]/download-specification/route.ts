import serverlessChromium from "@sparticuz/chromium";
import { chromium as playwrightChromium } from "playwright-core";
import type { Page } from "playwright-core";
import type { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type DownloadSpecificationRouteContext = {
  params: Promise<{ id: string }>;
};

type QuotationFilenameData = {
  quotation_no: string | null;
  title: string;
};

function specificationPdfFilename(quotation: QuotationFilenameData) {
  const quotationNo = quotation.quotation_no ?? "Draft";
  const title = quotation.title || "Quotation";

  return `${quotationNo} - ${title} - Specification Sheet`.replace(/[\\/:*?"<>|]/g, "-");
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

  return playwrightChromium.launch({
    args: isServerless ? serverlessChromium.args : undefined,
    executablePath: isServerless ? await serverlessChromium.executablePath() : undefined,
    headless: true,
  });
}

async function waitForFontsAndImages(page: Page) {
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready;
    }

    const images = Array.from(document.images);
    await Promise.all(
      images.map(async (image) => {
        if (image.complete && image.naturalWidth > 0) return;

        await new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }),
    );

    await Promise.all(
      images.map(async (image) => {
        if (!image.complete || typeof image.decode !== "function") return;

        try {
          await image.decode();
        } catch {
          // Missing/failed images should not block PDF generation.
        }
      }),
    );

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

export async function GET(request: NextRequest, { params }: DownloadSpecificationRouteContext) {
  await requireActiveUser();

  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation, error } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<QuotationFilenameData>();

  if (error) {
    console.error("SPECIFICATION PDF DOWNLOAD LOOKUP ERROR", error.message);
  }

  if (!quotation) {
    return new Response("Quotation not found.", { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const previewUrl = new URL(`/quotations/${id}/specification?download=1`, origin);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const browser = await launchPdfBrowser();

  try {
    const context = await browser.newContext({
      extraHTTPHeaders: cookieHeader ? { cookie: cookieHeader } : undefined,
      deviceScaleFactor: 2,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.emulateMedia({ media: "print" });

    await page.goto(previewUrl.toString(), {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    const renderedPath = new URL(page.url()).pathname;

    if (renderedPath === "/login" || renderedPath === "/pending-approval") {
      throw new Error(`Specification preview loaded an auth page instead of content: ${renderedPath}`);
    }

    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch((error) => {
      console.warn("SPECIFICATION PDF NETWORK IDLE WARNING", error);
    });
    await withTimeout(
      waitForFontsAndImages(page),
      10_000,
      "PDF image readiness timed out.",
    ).catch((error) => {
      console.warn("SPECIFICATION PDF IMAGE WAIT WARNING", error);
    });
    await page.waitForTimeout(250);

    const pdf = await withTimeout(
      page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        displayHeaderFooter: false,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0",
        },
        preferCSSPageSize: true,
      }),
      30_000,
      "PDF rendering timed out.",
    );
    const filename = `${specificationPdfFilename(quotation)}.pdf`;
    const pdfBody = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;

    return new Response(pdfBody, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (pdfError) {
    console.error("SPECIFICATION PDF DOWNLOAD ERROR", pdfError);

    return new Response("PDF generation failed. Please use Specification Sheet preview as fallback.", { status: 500 });
  } finally {
    await browser.close();
  }
}
