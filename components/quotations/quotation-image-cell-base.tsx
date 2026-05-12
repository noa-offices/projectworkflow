"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, ClipboardEvent, FocusEvent, MouseEvent } from "react";
import {
  ImageAdjustmentDialog,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/components/images/image-adjustment-dialog";
import { QuotationImageFrame } from "@/components/quotations/quotation-image-frame";
import {
  markQuotationImagePathFailed,
  resolveQuotationImageUrl,
} from "@/lib/quotation-image-path";

type UploadStatus = "idle" | "uploading" | "failed";

function filenameForClipboardImage(type: string) {
  const extensionByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  return `pasted-image-${Date.now()}.${extensionByType[type] ?? "png"}`;
}

function clipboardImageFile(event: ClipboardEvent<HTMLDivElement>) {
  const items = Array.from(event.clipboardData.items);
  const imageItem = items.find(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
  const file =
    imageItem?.getAsFile() ??
    Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));

  if (!file) return null;
  if (file.name) return file;

  return new File([file], filenameForClipboardImage(file.type), {
    lastModified: file.lastModified,
    type: file.type,
  });
}

export function QuotationImageCellBase({
  boxStyle,
  canEdit,
  containerClassName,
  controlsClassName,
  emptyHint,
  errorMessage,
  fieldLabel,
  imageSettings,
  onAdjustSave,
  onClear,
  onFileSelected,
  uploading,
  value,
}: {
  boxStyle?: CSSProperties;
  canEdit: boolean;
  containerClassName?: string;
  controlsClassName?: string;
  emptyHint?: string;
  errorMessage?: string;
  fieldLabel?: string;
  imageSettings?: Partial<ImageDisplaySettings> | null;
  onAdjustSave?: (settings: ImageDisplaySettings) => Promise<void> | void;
  onClear?: () => void;
  onFileSelected?: (file: File) => Promise<void> | void;
  uploading?: boolean;
  value: string | null;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [currentImageSettings, setCurrentImageSettings] = useState<ImageDisplaySettings>(
    normalizeImageDisplaySettings(imageSettings),
  );
  const [frameSize, setFrameSize] = useState({ width: 180, height: 132 });
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [localError, setLocalError] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<UploadStatus>("idle");
  const imageValue = value || "";

  useEffect(() => {
    let cancelled = false;

    if (!imageValue) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl("");
      });
      return;
    }

    void resolveQuotationImageUrl(imageValue)
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url);
          setLocalError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewUrl("");
          setLocalError(error instanceof Error ? error.message : "Image could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageValue]);

  useEffect(() => {
    const frameElement = frameRef.current;
    if (!frameElement) return;

    const syncFrameSize = () => {
      const nextWidth = Math.round(frameElement.clientWidth);
      const nextHeight = Math.round(frameElement.clientHeight);

      if (nextWidth > 0 && nextHeight > 0) {
        setFrameSize({ width: nextWidth, height: nextHeight });
      }
    };

    syncFrameSize();
    const observer = new ResizeObserver(syncFrameSize);
    observer.observe(frameElement);

    return () => observer.disconnect();
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onFileSelected) return;

    setLocalError("");
    await onFileSelected(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!canEdit || uploading || !onFileSelected) return;

    event.preventDefault();
    const file = clipboardImageFile(event);

    if (!file) {
      setLocalError("Clipboard does not contain an image.");
      return;
    }

    setLocalError("");
    await onFileSelected(file);
  }

  async function handleAdjustSave(settings: ImageDisplaySettings) {
    if (!onAdjustSave) return;

    setSettingsStatus("uploading");
    setLocalError("");

    try {
      await onAdjustSave(settings);
      setCurrentImageSettings(settings);
      setIsAdjusting(false);
      setSettingsStatus("idle");
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Image settings could not be saved.",
      );
      setSettingsStatus("failed");
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;

    if (!event.currentTarget.contains(nextTarget)) {
      setIsSelected(false);
    }
  }

  function handleCellMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (
      !canEdit ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement
    ) {
      return;
    }

    cellRef.current?.focus();
  }

  const boxClassName =
    "relative flex h-full min-h-[72px] w-full min-w-0 flex-1 items-center justify-center overflow-hidden border border-dashed bg-white transition";
  const selectedClassName = isSelected
    ? "border-emerald-600 ring-1 ring-emerald-600"
    : "border-zinc-300";
  const effectiveError = errorMessage || (imageValue ? localError : "");
  const resolvedContainerClassName =
    containerClassName ??
    "grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_auto] gap-1 outline-none";
  const resolvedControlsClassName =
    controlsClassName ?? "flex flex-wrap items-center justify-center gap-2";

  function handleImageError() {
    if (!imageValue) return;

    markQuotationImagePathFailed(imageValue);
    setPreviewUrl("");
    setLocalError("Image could not be loaded.");
  }

  return (
    <div
      ref={cellRef}
      tabIndex={canEdit ? 0 : undefined}
      onBlur={handleBlur}
      onFocus={() => setIsSelected(true)}
      onMouseDown={handleCellMouseDown}
      onPaste={handlePaste}
      className={resolvedContainerClassName}
      aria-label={fieldLabel ?? (canEdit ? "Quotation image cell. Paste image or upload." : "Quotation image cell")}
    >
      {previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className={`${boxClassName} ${selectedClassName}`}
          style={boxStyle}
        >
          <span ref={frameRef} className="absolute inset-0 h-full w-full overflow-hidden">
            <QuotationImageFrame
              alt="Quotation item"
              className="h-full w-full overflow-hidden"
              imageUrl={previewUrl}
              onImageError={handleImageError}
              settings={currentImageSettings}
            />
          </span>
        </a>
      ) : (
        <span
          ref={frameRef}
          className={`${boxClassName} ${selectedClassName} px-2 text-center text-[11px] text-zinc-400`}
          style={boxStyle}
        >
          {canEdit ? (emptyHint ?? "Paste image or upload") : "No image"}
        </span>
      )}

      {canEdit ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={handleFileChange}
          />
          <div className={resolvedControlsClassName}>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-[10px] font-semibold text-emerald-900 transition hover:text-emerald-800 disabled:text-zinc-400"
            >
              {uploading ? "Uploading..." : imageValue ? "Replace" : "Upload"}
            </button>
            <button
              type="button"
              onClick={() => cellRef.current?.focus()}
              disabled={uploading}
              className="text-[10px] font-semibold text-zinc-600 transition hover:text-zinc-950 disabled:text-zinc-400"
            >
              Paste
            </button>
            {previewUrl ? (
              <button
                type="button"
                onClick={() => setIsAdjusting(true)}
                disabled={settingsStatus === "uploading"}
                className="text-[10px] font-semibold text-zinc-600 transition hover:text-zinc-950 disabled:text-zinc-400"
              >
                Adjust
              </button>
            ) : null}
            {imageValue && onClear ? (
              <button
                type="button"
                onClick={onClear}
                disabled={uploading}
                className="text-[10px] font-semibold text-zinc-500 transition hover:text-red-700 disabled:text-zinc-400"
              >
                Remove
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {effectiveError ? (
        <span className="max-w-[180px] text-center text-[10px] leading-4 text-red-700">
          {effectiveError}
        </span>
      ) : null}

      {isAdjusting && previewUrl ? (
        <ImageAdjustmentDialog
          imageUrl={previewUrl}
          initialSettings={currentImageSettings}
          onCancel={() => setIsAdjusting(false)}
          onSave={handleAdjustSave}
          previewFrameHeight={frameSize.height}
          previewFrameWidth={frameSize.width}
          saving={settingsStatus === "uploading"}
        />
      ) : null}
    </div>
  );
}
