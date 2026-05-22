"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  FocusEvent,
  MouseEvent,
} from "react";
import {
  updateProductTemplateImageSettings,
  updateProductTemplateImage,
} from "@/app/products/templates/actions";
import {
  ImageAdjustmentDialog,
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/components/images/image-adjustment-dialog";
import { uploadProductTemplateImage } from "@/lib/quotation-image-upload";
import { createClient } from "@/lib/supabase/client";

type UploadStatus = "idle" | "uploading" | "pasting" | "uploaded" | "failed";
type SettingsStatus = "idle" | "uploading" | "failed";
type ProductTemplateImageField =
  | "proposed_image_url_1"
  | "proposed_image_url_2"
  | "proposed_image_url_3"
  | "proposed_image_url_4"
  | "proposed_image_url_5"
  | "proposed_image_url_6"
  | "proposed_image_url_7"
  | "proposed_image_url_8"
  | "proposed_image_url_9"
  | "proposed_image_url_10"
  | "proposed_image_url_11"
  | "proposed_image_url_12"
  | "proposed_image_url_13"
  | "proposed_image_url_14"
  | "proposed_image_url_15"
  | "proposed_image_url_16"
  | "proposed_image_url_17"
  | "proposed_image_url_18"
  | "proposed_image_url_19"
  | "proposed_image_url_20";

const extensionByType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

function isQuoteStoragePath(value: string) {
  return value.startsWith("quotation-items/") || value.startsWith("quotation-finishes/");
}

function isProductStoragePath(value: string) {
  return value.startsWith("product-templates/") || value.startsWith("brand-materials/");
}

function filenameForClipboardImage(type: string) {
  return `pasted-template-${Date.now()}.${extensionByType[type] ?? "png"}`;
}

function clipboardImageFile(event: ClipboardEvent<HTMLDivElement>) {
  const items = Array.from(event.clipboardData.items);
  const imageItem = items.find(
    (item) =>
      item.kind === "file" &&
      ["image/png", "image/jpeg", "image/webp"].includes(item.type),
  );
  const file =
    imageItem?.getAsFile() ??
    Array.from(event.clipboardData.files).find((item) =>
      ["image/png", "image/jpeg", "image/webp"].includes(item.type),
    );

  if (!file) return null;
  if (file.name) return file;

  return new File([file], filenameForClipboardImage(file.type), {
    lastModified: file.lastModified,
    type: file.type,
  });
}

async function signedProductImageUrl(path: string) {
  if (isDirectImageUrl(path)) return path;

  const bucketAndPath = path.startsWith("quote-images:")
    ? { bucket: "quote-images", objectPath: path.slice("quote-images:".length) }
    : path.startsWith("product-images:")
      ? { bucket: "product-images", objectPath: path.slice("product-images:".length) }
      : isQuoteStoragePath(path)
        ? { bucket: "quote-images", objectPath: path }
        : isProductStoragePath(path)
          ? { bucket: "product-images", objectPath: path }
          : { bucket: "product-images", objectPath: path };

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(bucketAndPath.bucket)
    .createSignedUrl(bucketAndPath.objectPath, 60 * 60);

  if (error) {
    throw new Error(error.message || "Image could not be loaded.");
  }

  return data.signedUrl;
}

export function ProductTemplateImageUploader({
  canEdit = false,
  field = "proposed_image_url_1",
  formOnly = false,
  imageSettings,
  label = "Product template image",
  onValueChange,
  templateId,
  value,
}: {
  canEdit?: boolean;
  field?: ProductTemplateImageField;
  formOnly?: boolean;
  imageSettings?: Partial<ImageDisplaySettings> | null;
  label?: string;
  onValueChange?: (value: string | null) => void;
  templateId: string;
  value: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pasteTargetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPasteSignatureRef = useRef("");
  const lastPasteAtRef = useRef(0);
  const [currentValue, setCurrentValue] = useState(value ?? "");
  const [previewUrl, setPreviewUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentImageSettings, setCurrentImageSettings] = useState<ImageDisplaySettings>(
    normalizeImageDisplaySettings(imageSettings),
  );
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>("idle");
  const [, startTransition] = useTransition();
  const imageValue = currentValue;

  useEffect(() => {
    let cancelled = false;

    if (!imageValue) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl("");
      });
      return;
    }

    void signedProductImageUrl(imageValue)
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url);
          setErrorMessage("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewUrl("");
          setErrorMessage(
            error instanceof Error ? error.message : "Image could not be loaded.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageValue]);

  function saveImagePath(path: string) {
    const pathInput = containerRef.current
      ?.closest("form")
      ?.querySelector<HTMLInputElement>(`input[name="${field}"]`);

    if (pathInput) {
      pathInput.value = path;
    }

    if (formOnly) {
      setCurrentValue(path);
      onValueChange?.(path || null);
      setErrorMessage("");
      setStatus(path ? "uploaded" : "idle");
      return;
    }

    const formData = new FormData();
    formData.set("id", templateId);
    formData.set("image_field", field);
    formData.set("image_path", path);

    startTransition(() => {
      void updateProductTemplateImage(formData)
        .then((result) => {
          if (!result.ok) {
            setErrorMessage(result.message || "Product image could not be saved.");
            setStatus("failed");
            return;
          }

          setCurrentValue(path);
          onValueChange?.(path || null);
          setErrorMessage("");
          setStatus(path ? "uploaded" : "idle");
        })
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Product image could not be saved.",
          );
          setStatus("failed");
        });
    });
  }

  function clearImage() {
    setErrorMessage("");
    const pathInput = containerRef.current
      ?.closest("form")
      ?.querySelector<HTMLInputElement>(`input[name="${field}"]`);

    if (pathInput) {
      pathInput.value = "";
    }

    setCurrentValue("");
    onValueChange?.(null);
    setStatus("idle");
  }

  async function uploadAndSaveImage(
    file: File,
    nextStatus: "uploading" | "pasting",
  ) {
    setStatus(nextStatus);
    setErrorMessage("");

    try {
      const upload = await uploadProductTemplateImage({ file, templateId });
      saveImagePath(upload.path);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Product image upload failed.",
      );
      setStatus("failed");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    await uploadAndSaveImage(file, "uploading");
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!canEdit || status === "uploading" || status === "pasting") return;

    const file = clipboardImageFile(event);
    if (!file) {
      return;
    }

    event.preventDefault();
    const signature = [file.name, file.size, file.type, file.lastModified].join(":");
    const now = Date.now();

    if (
      signature === lastPasteSignatureRef.current &&
      now - lastPasteAtRef.current < 1000
    ) {
      return;
    }

    lastPasteSignatureRef.current = signature;
    lastPasteAtRef.current = now;

    await uploadAndSaveImage(file, "pasting");
  }

  function saveImageSettings(settings: ImageDisplaySettings) {
    if (formOnly) {
      const settingsInput = containerRef.current
        ?.closest("form")
        ?.querySelector<HTMLInputElement>(`input[name="image_settings_${field}"]`);

      if (settingsInput) {
        settingsInput.value = JSON.stringify(settings);
      }

      setCurrentImageSettings(settings);
      setIsAdjusting(false);
      setSettingsStatus("idle");
      return;
    }

    const formData = new FormData();
    formData.set("id", templateId);
    formData.set("image_field", field);
    formData.set("image_fit", settings.fit);
    formData.set("image_zoom", String(settings.zoom));
    formData.set("image_position_x", String(settings.positionX));
    formData.set("image_position_y", String(settings.positionY));

    setSettingsStatus("uploading");
    setErrorMessage("");

    startTransition(() => {
      void updateProductTemplateImageSettings(formData)
        .then((result) => {
          if (!result.ok) {
            setErrorMessage(result.message || "Product image settings could not be saved.");
            setSettingsStatus("failed");
            return;
          }

          setCurrentImageSettings(settings);
          setIsAdjusting(false);
          setSettingsStatus("idle");
        })
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Product image settings could not be saved.",
          );
          setSettingsStatus("failed");
        });
    });
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;

    if (!event.currentTarget.contains(nextTarget)) {
      setIsSelected(false);
    }
  }

  function handlePreviewMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLInputElement
    ) {
      return;
    }

    pasteTargetRef.current?.focus();
  }

  const statusMessage = errorMessage
    ? status === "failed"
      ? errorMessage
      : errorMessage
    : status === "uploading"
      ? "Uploading..."
      : status === "pasting"
        ? "Pasting..."
        : status === "uploaded"
          ? "Uploaded"
          : canEdit
            ? isSelected
              ? "Press Ctrl+V to paste an image."
              : "Click the image card, then paste or upload."
            : "";
  const boxClassName =
    "relative flex h-28 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-white transition";
  const selectedClassName = isSelected
    ? "border-emerald-600 ring-1 ring-emerald-600"
    : "border-zinc-300";

  return (
    <div ref={containerRef} className="grid gap-2">
      <div
        ref={pasteTargetRef}
        tabIndex={canEdit ? 0 : undefined}
        onBlur={handleBlur}
        onFocus={() => setIsSelected(true)}
        onMouseDown={handlePreviewMouseDown}
        onPaste={handlePaste}
        className={`${boxClassName} ${selectedClassName} outline-none`}
        aria-label={
          canEdit
            ? `${label}. Click or focus this image card, then paste or upload.`
            : label
        }
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={label}
            className="block h-full w-full p-1"
            style={imageDisplayStyle(currentImageSettings)}
          />
        ) : (
          <span className="px-3 text-center text-[11px] leading-5 text-zinc-400">
            {canEdit ? "Paste image or upload" : "No image"}
          </span>
        )}
      </div>

      <div className="min-w-0">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={status === "uploading" || status === "pasting"}
              className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-800 disabled:text-zinc-400"
            >
              {status === "uploading"
                ? "Uploading..."
                : imageValue
                  ? "Replace image"
                  : "Upload image"}
            </button>
            <button
              type="button"
              onClick={() => pasteTargetRef.current?.focus()}
              disabled={status === "uploading" || status === "pasting"}
              className="text-xs font-semibold text-zinc-600 transition hover:text-zinc-950 disabled:text-zinc-400"
            >
              {status === "pasting" ? "Pasting..." : "Paste image"}
            </button>
            {imageValue ? (
              <button
                type="button"
                onClick={clearImage}
                disabled={status === "uploading" || status === "pasting"}
                className="text-xs font-semibold text-red-700 transition hover:text-red-800 disabled:text-zinc-400"
              >
                Remove
              </button>
            ) : null}
            {previewUrl ? (
              <button
                type="button"
                onClick={() => setIsAdjusting(true)}
                disabled={settingsStatus === "uploading"}
                className="text-xs font-semibold text-zinc-600 transition hover:text-zinc-950 disabled:text-zinc-400"
              >
                Adjust
              </button>
            ) : null}
          </div>
        ) : null}

        {statusMessage ? (
          <p
            className={`mt-1 max-w-48 text-xs leading-4 ${
              status === "failed" ? "text-red-700" : "text-zinc-500"
            }`}
          >
            {statusMessage}
          </p>
        ) : null}
      </div>

      {isAdjusting && previewUrl ? (
        <ImageAdjustmentDialog
          imageUrl={previewUrl}
          initialSettings={currentImageSettings}
          onCancel={() => setIsAdjusting(false)}
          onSave={saveImageSettings}
          saving={settingsStatus === "uploading"}
        />
      ) : null}
    </div>
  );
}
