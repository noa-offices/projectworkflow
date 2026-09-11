"use client";

/* Local object URLs intentionally use a native image element. */
/* eslint-disable @next/next/no-img-element */

import { useState, type ClipboardEvent } from "react";
import { clipboardImageFileFromClipboard, compressedClipboardImage, formatProductImageSize } from "@/lib/products/product-template-row-image-client";
import type { StagedReviewedRowImage } from "@/lib/products/smart-product-row-images";

export function StagedPricingRowReferenceImage({ image, onChange, sourceKey, rowId }: { image: StagedReviewedRowImage | null; onChange: (image: StagedReviewedRowImage | null) => void; sourceKey: string; rowId: string }) {
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const paste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const clipboardFile = clipboardImageFileFromClipboard(event.clipboardData);
    if (!clipboardFile) { setMessage("Clipboard does not contain an image."); return; }
    event.preventDefault(); setBusy(true); setMessage(null);
    try { const file = await compressedClipboardImage(clipboardFile); onChange({ file, previewUrl: URL.createObjectURL(file), sourceKey, sourceRowId: rowId }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Image could not be processed."); }
    finally { setBusy(false); }
  };
  return <span className="inline-block w-[68px]"><span tabIndex={0} onClick={(event) => event.stopPropagation()} onPaste={paste} title="Focus and press Ctrl+V to paste an image" className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-1 text-center text-[9px] leading-3 text-zinc-500 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100">{image ? <img src={image.previewUrl} alt="Pending row reference" className="h-full w-full object-contain" /> : busy ? "Processing..." : <>Paste image<br />Ctrl+V</>}</span><button type="button" onClick={(event) => { event.stopPropagation(); window.dispatchEvent(new CustomEvent("source-qa-crop", { detail: { sourceKey, rowId } })); }} className="mt-1 text-[10px] font-semibold text-sky-800">Crop from PDF</button>{image ? <><span className="mt-1 block text-[9px] text-zinc-500">Compressed: {formatProductImageSize(image.file.size)}</span><span className="mt-1 block text-[9px] text-zinc-500">Paste to replace</span><button type="button" onClick={(event) => { event.stopPropagation(); onChange(null); }} className="text-[10px] font-semibold text-red-700">Remove</button></> : null}{message ? <span className="mt-1 block text-[9px] leading-3 text-amber-800">{message}</span> : null}</span>;
}
