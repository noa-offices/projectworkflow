"use client";

import { useState } from "react";
import type { LocalQuotationItem } from "@/lib/local/quotation-workspace";
import type { ImageDisplaySettings } from "@/components/images/image-adjustment-dialog";
import { QuotationImageCellBase } from "@/components/quotations/quotation-image-cell-base";
import { uploadQuotationItemImage } from "@/lib/quotation-image-upload";
import { normalizeStoredImagePath } from "@/lib/quotation-image-path";

type ImageField = "specified_image_url_snapshot" | "proposed_image_url_snapshot";

type LocalCellLayout = {
  images?: Partial<Record<ImageField, Partial<ImageDisplaySettings> | undefined>>;
};

function imageSettingsForItem(item: LocalQuotationItem, field: ImageField) {
  const cellLayout = (item.cell_layout as LocalCellLayout | null | undefined) ?? {};
  return cellLayout.images?.[field] ?? null;
}

function updateItemImageSettings(
  item: LocalQuotationItem,
  field: ImageField,
  settings: ImageDisplaySettings,
): Partial<LocalQuotationItem> {
  const cellLayout = (item.cell_layout as LocalCellLayout | null | undefined) ?? {};
  const images = cellLayout.images ?? {};

  return {
    cell_layout: {
      ...cellLayout,
      images: {
        ...images,
        [field]: settings,
      },
    },
  };
}

export function LocalQuotationImageCell({
  item,
  quotationId,
  updateItem,
}: {
  item: LocalQuotationItem;
  quotationId: string;
  updateItem: (patch: Partial<LocalQuotationItem>) => void;
}) {
  const [errorMessage, setErrorMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "failed">("idle");
  const field: ImageField = item.proposed_image_url_snapshot || !item.specified_image_url_snapshot
    ? "proposed_image_url_snapshot"
    : "specified_image_url_snapshot";
  const value = item.proposed_image_url_snapshot || item.specified_image_url_snapshot || null;

  async function handleFileSelected(file: File) {
    setStatus("uploading");
    setErrorMessage("");

    try {
      const upload = await uploadQuotationItemImage({ file, itemId: item.id, quotationId });
      updateItem({
        [field]: normalizeStoredImagePath(upload.bucket, upload.path),
      } as Partial<LocalQuotationItem>);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Image upload failed.");
      setStatus("failed");
    }
  }

  async function handleAdjustSave(settings: ImageDisplaySettings) {
    updateItem(updateItemImageSettings(item, field, settings));
  }

  function handleClear() {
    updateItem({
      [field]: null,
    } as Partial<LocalQuotationItem>);
  }

  return (
    <QuotationImageCellBase
      canEdit
      errorMessage={errorMessage}
      imageSettings={imageSettingsForItem(item, field)}
      onAdjustSave={handleAdjustSave}
      onClear={handleClear}
      onFileSelected={handleFileSelected}
      uploading={status === "uploading"}
      value={value}
    />
  );
}
