import { existsSync } from "node:fs";
import type { PDFOptions, Page, Viewport } from "puppeteer-core";

type GeneratePdfBufferOptions = {
  cookieHeader?: string;
  pdfOptions: PDFOptions;
  sourceUrl: string;
  timeoutMs?: number;
  viewport?: Viewport;
  waitForImages?: boolean;
};

const defaultViewport: Viewport = {
  deviceScaleFactor: 1,
  hasTouch: false,
  height: 900,
  isLandscape: false,
  isMobile: false,
  width: 1280,
};

function localExecutableCandidates() {
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_EXECUTABLE_PATH,
    process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : null,
    process.platform === "win32"
      ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      : null,
    process.platform === "win32"
      ? "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
      : null,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : null,
    process.platform === "darwin"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : null,
    process.platform === "linux"
      ? "/usr/bin/google-chrome"
      : null,
    process.platform === "linux"
      ? "/usr/bin/chromium-browser"
      : null,
    process.platform === "linux"
      ? "/usr/bin/chromium"
      : null,
  ].filter((value): value is string => Boolean(value));
}

function resolveLocalExecutablePath() {
  return localExecutableCandidates().find((candidate) => existsSync(candidate)) ?? null;
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

async function resolveExecutablePath() {
  const isVercel = Boolean(process.env.VERCEL);
  const chromiumPackUrl = process.env.CHROMIUM_PACK_URL?.trim() || "";

  console.log("pdf executablePath resolution start", {
    hasChromiumPackUrl: Boolean(chromiumPackUrl),
    isVercel,
  });

  if (isVercel) {
    if (!chromiumPackUrl) {
      throw new Error("CHROMIUM_PACK_URL is not configured.");
    }

    const chromium = (await import("@sparticuz/chromium-min")).default;
    try {
      const executablePath = await chromium.executablePath(chromiumPackUrl);
      console.log("pdf executablePath resolution success", { executablePath });
      return {
        executablePath,
        headless: "shell" as const,
        launchArgs: chromium.args,
      };
    } catch (error) {
      console.error("pdf executablePath resolution failure", {
        cwd: process.cwd(),
        hasChromiumPackUrl: Boolean(chromiumPackUrl),
        isVercel,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  const localExecutablePath = resolveLocalExecutablePath();
  if (localExecutablePath) {
    console.log("pdf executablePath resolution success", { executablePath: localExecutablePath });
    return {
      executablePath: localExecutablePath,
      headless: true as const,
      launchArgs: [],
    };
  }

  throw new Error(
    "No local Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH or CHROME_EXECUTABLE_PATH for local PDF downloads.",
  );
}

export async function generatePdfBuffer({
  cookieHeader,
  pdfOptions,
  sourceUrl,
  timeoutMs = 60_000,
  viewport = defaultViewport,
  waitForImages = true,
}: GeneratePdfBufferOptions) {
  console.log("pdf generation sourceUrl", { sourceUrl });
  console.log("pdf chromium env", {
    hasChromiumPackUrl: Boolean(process.env.CHROMIUM_PACK_URL),
    isVercel: Boolean(process.env.VERCEL),
  });

  const puppeteer = await import("puppeteer-core");
  const { executablePath, headless, launchArgs } = await resolveExecutablePath();
  const launchOptions = {
    args: puppeteer.defaultArgs({ args: launchArgs, headless }),
    executablePath,
    headless,
  };

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setExtraHTTPHeaders(cookieHeader ? { cookie: cookieHeader } : {});
    await page.emulateMediaType("print");

    const response = await page.goto(sourceUrl, {
      waitUntil: "networkidle0",
      timeout: timeoutMs,
    });
    const status = response?.status() ?? 0;
    console.log("pdf page.goto status", { sourceUrl, status });

    if (!response?.ok()) {
      throw new Error(`PDF source request failed with status ${status}.`);
    }

    if (waitForImages) {
      await waitForFontsAndImages(page);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const pdfBuffer = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      ...pdfOptions,
    });
    console.log("pdf buffer size", { bytes: pdfBuffer.byteLength, sourceUrl });

    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
