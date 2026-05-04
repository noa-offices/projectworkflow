"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ChangeEvent, ClipboardEvent, FocusEvent, MouseEvent } from "react";
import { autosaveQuotationItemInline } from "@/app/quotations/actions";
import { createClient } from "@/lib/supabase/client";
import { uploadQuotationItemImage } from "@/lib/quotation-image-upload";

type ImageField = "specified_image_url_snapshot" | "proposed_image_url_snapshot";
type UploadStatus = "idle" | "uploading" | "failed";

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

async function signedImageUrl(path: string) {
  if (isDirectImageUrl(path)) return path;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("quote-images")
    .createSignedUrl(path, 60 * 60);

  if (error) {
    throw new Error(error.message || "Image could not be loaded.");
  }

  return data.signedUrl;
}

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

export function QuotationImageCell({
  canEdit,
  field,
  itemId,
  quotationId,
  value,
}: {
  canEdit: boolean;
  field: ImageField;
  itemId: string;
  quotationId: string;
  value: string | null;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedValue, setUploadedValue] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSelected, setIsSelected] = useState(false);
  const [status, setStatus] = useState<UploadStatus>("idle");
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

    void signedImageUrl(imageValue)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewUrl("");
          setErrorMessage(error instanceof Error ? error.message : "Image could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageValue]);

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

  async function uploadAndSaveImage(file: File) {
    setStatus("uploading");
    setErrorMessage("");

    try {
      const upload = await uploadQuotationItemImage({ file, itemId, quotationId });
      saveImagePath(upload.path);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Image upload failed.");
      setStatus("failed");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    await uploadAndSaveImage(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!canEdit || status === "uploading") return;

    event.preventDefault();
    const file = clipboardImageFile(event);

    if (!file) {
      setErrorMessage("Clipboard does not contain an image.");
      setStatus("failed");
      return;
    }

    await uploadAndSaveImage(file);
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
    "flex h-full min-h-16 max-h-[160px] w-full max-w-[180px] items-center justify-center border border-dashed bg-white transition";
  const selectedClassName = isSelected
    ? "border-emerald-600 ring-1 ring-emerald-600"
    : "border-zinc-300";

  return (
    <div
      ref={cellRef}
      tabIndex={canEdit ? 0 : undefined}
      onBlur={handleBlur}
      onFocus={() => setIsSelected(true)}
      onMouseDown={handleCellMouseDown}
      onPaste={handlePaste}
      className="flex h-full min-h-16 flex-col items-center justify-center gap-1 outline-none"
      aria-label={
        canEdit ? "Quotation image cell. Paste image or upload." : "Quotation image cell"
      }
    >
      {previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className={`${boxClassName} ${selectedClassName}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Quotation item"
            className="block h-full w-full object-contain p-1"
          />
        </a>
      ) : (
        <span
          className={`${boxClassName} ${selectedClassName} px-2 text-center text-[11px] text-zinc-400`}
        >
          {canEdit ? "Paste image or upload" : "No image"}
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
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={status === "uploading"}
            className="text-[10px] font-semibold text-emerald-900 transition hover:text-emerald-800 disabled:text-zinc-400"
          >
            {status === "uploading" ? "Uploading..." : imageValue ? "Replace" : "Upload"}
          </button>
        </>
      ) : null}

      {errorMessage ? (
        <span className="max-w-[180px] text-center text-[10px] leading-4 text-red-700">
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}
