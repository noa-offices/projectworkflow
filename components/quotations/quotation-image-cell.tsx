"use client";

import { useState, useTransition } from "react";
import {
  autosaveQuotationItemInline,
  updateQuotationItemImageSettings,
} from "@/app/quotations/actions";
import {
  QuotationImageCellBase,
} from "@/components/quotations/quotation-image-cell-base";
import type { ImageDisplaySettings } from "@/components/images/image-adjustment-dialog";
import { uploadQuotationItemImage } from "@/lib/quotation-image-upload";
import { normalizeStoredImagePath } from "@/lib/quotation-image-path";

type ImageField = "specified_image_url_snapshot" | "proposed_image_url_snapshot";

export function QuotationImageCell({
  canEdit,
  field,
  frameHeight,
  imageSettings,
  itemId,
  quotationId,
  value,
}: {
  canEdit: boolean;
  field: ImageField;
  frameHeight?: number;
  imageSettings?: Partial<ImageDisplaySettings> | null;
  itemId: string;
  quotationId: string;
  value: string | null;
}) {
  const [uploadedValue, setUploadedValue] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "failed">("idle");
  const [, startTransition] = useTransition();
  const imageValue = uploadedValue || value || "";

  function saveImagePath(path: string) {
    const formData = new FormData();
    formData.set("id", itemId);
    formData.set("quotation_id", quotationId);
    formData.set(field, path);

    startTransition(() => {
      void autosaveQuotationItemInline(formData)
        .then((result) => {
          if (!result.ok) {
            setErrorMessage(result.message || "Image path could not be saved.");
            setStatus("failed");
            return;
          }

          setUploadedValue(path);
          setStatus("idle");
        })
        .catch((error: unknown) => {
          setErrorMessage(error instanceof Error ? error.message : "Image path could not be saved.");
          setStatus("failed");
        });
    });
  }

  async function handleFileSelected(file: File) {
    setStatus("uploading");
    setErrorMessage("");

    try {
      const upload = await uploadQuotationItemImage({ file, itemId, quotationId });
      saveImagePath(normalizeStoredImagePath(upload.bucket, upload.path));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Image upload failed.");
      setStatus("failed");
    }
  }

  async function handleAdjustSave(settings: ImageDisplaySettings) {
    const formData = new FormData();
    formData.set("id", itemId);
    formData.set("quotation_id", quotationId);
    formData.set("image_field", field);
    formData.set("image_fit", settings.fit);
    formData.set("image_zoom", String(settings.zoom));
    formData.set("image_position_x", String(settings.positionX));
    formData.set("image_position_y", String(settings.positionY));

    const result = await updateQuotationItemImageSettings(formData);

    if (!result.ok) {
      throw new Error(result.message || "Image settings could not be saved.");
    }
  }

  return (
    <QuotationImageCellBase
      boxStyle={frameHeight ? { height: `${frameHeight}px`, minHeight: `${Math.min(frameHeight, 96)}px` } : undefined}
      canEdit={canEdit}
      errorMessage={errorMessage}
      imageSettings={imageSettings}
      onAdjustSave={handleAdjustSave}
      onFileSelected={handleFileSelected}
      uploading={status === "uploading"}
      value={imageValue}
    />
  );
}
