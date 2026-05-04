"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ChangeEvent } from "react";
import {
  updateProductTemplateImageSettings,
  updateProductTemplateMainImage,
} from "@/app/products/templates/actions";
import {
  ImageAdjustmentDialog,
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/components/images/image-adjustment-dialog";
import { uploadProductTemplateImage } from "@/lib/quotation-image-upload";
import { createClient } from "@/lib/supabase/client";

type UploadStatus = "idle" | "uploading" | "failed";

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

async function signedProductImageUrl(path: string) {
  if (isDirectImageUrl(path)) return path;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("product-images")
    .createSignedUrl(path, 60 * 60);

  if (error) {
    throw new Error(error.message || "Image could not be loaded.");
  }

  return data.signedUrl;
}

export function ProductTemplateImageUploader({
  canEdit = false,
  imageSettings,
  templateId,
  value,
}: {
  canEdit?: boolean;
  imageSettings?: Partial<ImageDisplaySettings> | null;
  templateId: string;
  value: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedValue, setUploadedValue] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentImageSettings, setCurrentImageSettings] = useState<ImageDisplaySettings>(
    normalizeImageDisplaySettings(imageSettings),
  );
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [settingsStatus, setSettingsStatus] = useState<UploadStatus>("idle");
  const [, startTransition] = useTransition();
  const imageValue = uploadedValue || value || "";

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
        if (!cancelled) setPreviewUrl(url);
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
    const formData = new FormData();
    formData.set("id", templateId);
    formData.set("default_image_url", path);

    startTransition(() => {
      void updateProductTemplateMainImage(formData)
        .then((result) => {
          if (!result.ok) {
            setErrorMessage(
              result.message || "Product image could not be saved.",
            );
            setStatus("failed");
            return;
          }

          setUploadedValue(path);
          const pathInput = containerRef.current
            ?.closest("form")
            ?.querySelector<HTMLInputElement>('input[name="default_image_url"]');

          if (pathInput) {
            pathInput.value = path;
          }

          setStatus("idle");
        })
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Product image could not be saved.",
          );
          setStatus("failed");
        });
    });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStatus("uploading");
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

  function saveImageSettings(settings: ImageDisplaySettings) {
    const formData = new FormData();
    formData.set("id", templateId);
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

  return (
    <div ref={containerRef} className="flex items-center gap-3">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-dashed border-zinc-300 bg-white text-center text-[11px] text-zinc-400">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Product template"
            className="block h-full w-full p-1"
            style={imageDisplayStyle(currentImageSettings)}
          />
        ) : (
          <span className="px-2">{canEdit ? "Upload image" : "No image"}</span>
        )}
      </div>

      <div className="min-w-0">
        {canEdit ? (
          <>
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
              disabled={status === "uploading"}
              className="text-xs font-semibold text-emerald-900 transition hover:text-emerald-800 disabled:text-zinc-400"
            >
              {status === "uploading"
                ? "Uploading..."
                : imageValue
                  ? "Replace image"
                  : "Upload image"}
            </button>
            {previewUrl ? (
              <button
                type="button"
                onClick={() => setIsAdjusting(true)}
                disabled={settingsStatus === "uploading"}
                className="ml-3 text-xs font-semibold text-zinc-600 transition hover:text-zinc-950 disabled:text-zinc-400"
              >
                Adjust
              </button>
            ) : null}
          </>
        ) : null}

        {errorMessage ? (
          <p className="mt-1 max-w-48 text-xs leading-4 text-red-700">
            {errorMessage}
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
