"use client";

import { useState } from "react";
const PPTX_LAYOUT_NAME = "A4_LANDSCAPE";
const PPTX_SLIDE_WIDTH = 11.69;
const PPTX_SLIDE_HEIGHT = 8.27;
const PRESENTATION_SLIDE_SELECTOR = "[data-presentation-slide='true']";
const PRESENTATION_IMAGE_PROXY_PATH = "/api/presentation-image-proxy";

function safePptxFileName() {
  const rawTitle = typeof document !== "undefined" ? document.title.trim() : "";
  const baseTitle = rawTitle || "quotation-presentation";
  const normalized = baseTitle.replace(/\s+Presentation$/i, "").trim() || baseTitle;
  return `${normalized.replace(/[\\/:*?"<>|]/g, "-")}.pptx`;
}

function exactExportError(error: unknown, slideNumber?: number) {
  const message = error instanceof Error ? error.message : "Unknown export error.";
  const isCorsError = /taint|cors|cross-origin|security|canvas/i.test(message);
  const prefix = slideNumber ? `Failed to capture slide ${slideNumber}` : "Failed to export exact PPTX";

  if (isCorsError) {
    return `${prefix}: one or more slide images could not be captured due to browser cross-origin restrictions.`;
  }

  return `${prefix}: ${message}`;
}

function isRemoteImageSource(value: string) {
  return /^https?:/i.test(value);
}

function sameOriginProxyUrl(source: string) {
  const params = new URLSearchParams({ src: source });
  return `${PRESENTATION_IMAGE_PROXY_PATH}?${params.toString()}`;
}

function safeImageHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "remote image";
  }
}

async function waitForImages(slide: HTMLElement) {
  const images = Array.from(slide.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return;

    try {
      await image.decode();
    } catch {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        image.addEventListener("load", done, { once: true });
        image.addEventListener("error", done, { once: true });
        window.setTimeout(resolve, 4000);
      });
    }
  }));
}

async function waitForImageLoad(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0) return;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Image load failed."));
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    window.setTimeout(() => {
      cleanup();
      reject(new Error("Image load timed out."));
    }, 10000);
  });
}

async function prepareSlideImagesForExport(slide: HTMLElement, slideNumber: number) {
  const images = Array.from(slide.querySelectorAll<HTMLImageElement>("img"));
  const restorableImages: Array<{
    image: HTMLImageElement;
    src: string | null;
    srcset: string | null;
  }> = [];

  for (const image of images) {
    const originalSrc = image.getAttribute("src");
    if (!originalSrc || !isRemoteImageSource(originalSrc)) continue;

    try {
      if (new URL(originalSrc, window.location.href).origin === window.location.origin) continue;
    } catch {
      continue;
    }

    restorableImages.push({
      image,
      src: originalSrc,
      srcset: image.getAttribute("srcset"),
    });

    image.removeAttribute("srcset");
    image.src = sameOriginProxyUrl(originalSrc);

    try {
      await waitForImageLoad(image);
    } catch {
      throw new Error(`Failed to prepare image for slide ${slideNumber} (${safeImageHost(originalSrc)}).`);
    }
  }

  return () => {
    restorableImages.forEach(({ image, src, srcset }) => {
      if (srcset) {
        image.setAttribute("srcset", srcset);
      } else {
        image.removeAttribute("srcset");
      }

      if (src) {
        image.setAttribute("src", src);
      } else {
        image.removeAttribute("src");
      }
    });
  };
}

export function PresentationPptxExportButton() {
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleExport() {
    setIsExporting(true);
    setErrorMessage(null);
    setStatusMessage("Preparing slides...");

    try {
      const [{ toPng }, { default: PptxGenJS }] = await Promise.all([
        import("html-to-image"),
        import("pptxgenjs"),
      ]);

      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      const slideNodes = Array.from(document.querySelectorAll<HTMLElement>(PRESENTATION_SLIDE_SELECTOR));
      if (!slideNodes.length) {
        throw new Error("No presentation slides were found on the page.");
      }

      const pptx = new PptxGenJS();
      pptx.defineLayout({
        name: PPTX_LAYOUT_NAME,
        width: PPTX_SLIDE_WIDTH,
        height: PPTX_SLIDE_HEIGHT,
      });
      pptx.layout = PPTX_LAYOUT_NAME;
      pptx.author = "ProjectWorkflow";
      pptx.subject = "Quotation Presentation";
      pptx.title = document.title || "Quotation Presentation";

      const pixelRatio = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));

      for (const [index, slideNode] of slideNodes.entries()) {
        const currentSlide = index + 1;
        setStatusMessage(`Capturing slide ${currentSlide} of ${slideNodes.length}...`);
        await waitForImages(slideNode);
        const restoreImageSources = await prepareSlideImagesForExport(slideNode, currentSlide);

        try {
          const dataUrl = await toPng(slideNode, {
            cacheBust: true,
            backgroundColor: "#ffffff",
            pixelRatio,
          });

          const slide = pptx.addSlide();
          slide.addImage({
            data: dataUrl,
            x: 0,
            y: 0,
            w: PPTX_SLIDE_WIDTH,
            h: PPTX_SLIDE_HEIGHT,
          });
        } catch {
          throw new Error(
            exactExportError(
              new Error("Slide capture failed because one or more images could not be prepared for export."),
              currentSlide,
            ),
          );
        } finally {
          restoreImageSources();
        }
      }

      setStatusMessage("Building PowerPoint file...");
      await pptx.writeFile({ fileName: safePptxFileName(), compression: true });
      setStatusMessage("PPTX exported.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to export exact PPTX.");
    } finally {
      setIsExporting(false);
      window.setTimeout(() => setStatusMessage(null), 1500);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 print:hidden">
      <button
        type="button"
        disabled={isExporting}
        onClick={handleExport}
        className="inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
      >
        {isExporting ? "Exporting PPTX..." : "Export PPTX"}
      </button>
      {statusMessage ? <p className="text-xs text-zinc-500">{statusMessage}</p> : null}
      {errorMessage ? <p className="text-xs text-red-700">{errorMessage}</p> : null}
    </div>
  );
}
