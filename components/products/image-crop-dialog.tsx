"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

// Fractions (0..1) of the displayed image, so the box survives a resize of the dialog.
type Box = { h: number; w: number; x: number; y: number };
type Shape = "square" | "free" | "4:3";
type Corner = "nw" | "ne" | "sw" | "se";

const MAX_SIDE = 1200;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_PIXELS = 24;
const shapes: Array<{ label: string; value: Shape }> = [
  { label: "Square", value: "square" },
  { label: "Free", value: "free" },
  { label: "4:3", value: "4:3" },
];

const ratioOf = (shape: Shape) => (shape === "square" ? 1 : shape === "4:3" ? 4 / 3 : null);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function fitBox(shape: Shape, width: number, height: number): Box {
  const ratio = ratioOf(shape);
  let w = width * 0.8;
  let h = height * 0.8;
  if (ratio) {
    w = Math.min(width * 0.8, height * 0.8 * ratio);
    h = w / ratio;
  }
  return { h: h / height, w: w / width, x: (1 - w / width) / 2, y: (1 - h / height) / 2 };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

// Crops the (EXIF-oriented) bitmap to the box, longest side at most 1200 px, WebP quality about 0.9 (lowered until it is under 5 MB).
async function cropToFile(bitmap: ImageBitmap, box: Box, originalName: string) {
  const sx = box.x * bitmap.width;
  const sy = box.y * bitmap.height;
  const sw = Math.max(1, box.w * bitmap.width);
  const sh = Math.max(1, box.h * bitmap.height);
  let scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    canvas.getContext("2d")?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    for (let quality = 0.9; quality >= 0.4; quality -= 0.1) {
      const blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size <= MAX_BYTES) {
        const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
        const base = originalName.replace(/\.[^.]+$/, "") || "swatch";
        return new File([blob], `${base}.${extension}`, { lastModified: Date.now(), type: blob.type });
      }
    }
    scale *= 0.8;
  }
  throw new Error("The cropped image is still too large. Try a smaller crop.");
}

export function ImageCropDialog({
  file,
  onCancel,
  onReplaceFile,
  onUseCrop,
  onUseOriginal,
}: {
  file: File;
  onCancel: () => void;
  onReplaceFile?: (file: File) => void;
  onUseCrop: (file: File) => void;
  onUseOriginal: () => void;
}) {
  const [url, setUrl] = useState("");
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [shape, setShape] = useState<Shape>("square");
  const [box, setBox] = useState<Box | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ box: Box; mode: "move" | Corner; x: number; y: number } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    let cancelled = false;
    let created: ImageBitmap | null = null;
    // State is set from the async callbacks (the parent remounts this dialog with a new key when the file changes).
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((next) => {
        if (cancelled) {
          next.close();
          return;
        }
        created = next;
        setBitmap(next);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setMessage("This image could not be read for cropping. You can still use the original.");
        setUrl(objectUrl);
      });
    return () => {
      cancelled = true;
      created?.close();
      setBitmap(null);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const resetBox = (nextShape: Shape) => {
    const image = imageRef.current;
    if (image && image.clientWidth > 0) setBox(fitBox(nextShape, image.clientWidth, image.clientHeight));
  };

  const applyCrop = async () => {
    if (!bitmap || !box || busy) return;
    setBusy(true);
    try {
      onUseCrop(await cropToFile(bitmap, box, file.name));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The image could not be cropped.");
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      void applyCrop();
    }
  };

  const begin = (event: ReactPointerEvent<HTMLElement>, mode: "move" | Corner) => {
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { box, mode, x: event.clientX, y: event.clientY };
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    const image = imageRef.current;
    if (!state || !image) return;
    const width = image.clientWidth;
    const height = image.clientHeight;
    const start = state.box;

    if (state.mode === "move") {
      setBox({
        ...start,
        x: clamp(start.x + (event.clientX - state.x) / width, 0, 1 - start.w),
        y: clamp(start.y + (event.clientY - state.y) / height, 0, 1 - start.h),
      });
      return;
    }

    // Resize: the opposite corner stays fixed; the pointer is clamped to the image.
    const rect = image.getBoundingClientRect();
    const px = clamp(event.clientX - rect.left, 0, width);
    const py = clamp(event.clientY - rect.top, 0, height);
    const ax = (state.mode.includes("w") ? start.x + start.w : start.x) * width;
    const ay = (state.mode.includes("n") ? start.y + start.h : start.y) * height;
    const maxW = px >= ax ? width - ax : ax;
    const maxH = py >= ay ? height - ay : ay;
    const ratio = ratioOf(shape);
    let w = Math.min(Math.abs(px - ax), maxW);
    let h = Math.min(Math.abs(py - ay), maxH);
    if (ratio) {
      w = Math.min(w, maxH * ratio);
      h = w / ratio;
    }
    w = Math.max(w, MIN_PIXELS);
    h = Math.max(ratio ? w / ratio : h, MIN_PIXELS);
    setBox({ h: h / height, w: w / width, x: (px >= ax ? ax : ax - w) / width, y: (py >= ay ? ay : ay - h) / height });
  };

  const end = () => {
    drag.current = null;
  };

  const handles = useMemo<Array<{ corner: Corner; className: string }>>(() => [
    { corner: "nw", className: "-left-3 -top-3 cursor-nwse-resize" },
    { corner: "ne", className: "-right-3 -top-3 cursor-nesw-resize" },
    { corner: "sw", className: "-bottom-3 -left-3 cursor-nesw-resize" },
    { corner: "se", className: "-bottom-3 -right-3 cursor-nwse-resize" },
  ], []);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/60 p-3" role="dialog" aria-modal="true" aria-label="Crop image">
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
          if (pasted && onReplaceFile) {
            event.preventDefault();
            onReplaceFile(pasted);
          }
        }}
        className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-xl outline-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-zinc-950">Crop swatch image</h2>
          <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200" role="group" aria-label="Crop shape">
            {shapes.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={shape === item.value}
                onClick={() => { setShape(item.value); resetBox(item.value); }}
                className={`h-9 px-3 text-sm font-semibold ${shape === item.value ? "bg-emerald-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 p-2">
          {url ? (
            <div className="relative inline-block max-w-full touch-none select-none overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imageRef}
                src={url}
                alt="Image to crop"
                draggable={false}
                onLoad={() => resetBox(shape)}
                className="block max-h-[55vh] max-w-full"
              />
              {box ? (
                <div
                  onPointerDown={(event) => begin(event, "move")}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                  style={{ height: `${box.h * 100}%`, left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%` }}
                >
                  {handles.map((handle) => (
                    <span
                      key={handle.corner}
                      onPointerDown={(event) => begin(event, handle.corner)}
                      onPointerMove={move}
                      onPointerUp={end}
                      onPointerCancel={end}
                      className={`absolute h-6 w-6 rounded-full border-2 border-white bg-emerald-700 ${handle.className}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="text-xs text-zinc-500">Drag the box to move it, drag a corner to resize. Enter = Use crop, Esc = Cancel.</p>
        {message ? <p className="text-xs text-red-700">{message}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="h-10 rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Cancel</button>
          <button type="button" onClick={onUseOriginal} className="h-10 rounded-lg border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Use original</button>
          <button type="button" disabled={!bitmap || !box || busy} onClick={() => void applyCrop()} className="h-10 rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? "Cropping..." : "Use crop"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
