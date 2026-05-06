"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import { uploadBrandMaterialImage } from "@/lib/quotation-image-upload";
import { createClient } from "@/lib/supabase/client";

type UploadStatus = "idle" | "uploading" | "failed";

const extensionByType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

function filenameForClipboardImage(type: string) {
  return `pasted-material-${Date.now()}.${extensionByType[type] ?? "png"}`;
}

function clipboardImageFile(event: ClipboardEvent<HTMLDivElement>) {
  const items = Array.from(event.clipboardData.items);
  const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
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

async function previewUrlFor(value: string) {
  if (!value) return "";
  if (isDirectImageUrl(value)) return value;

  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("product-images")
    .createSignedUrl(storagePath, 60 * 60);

  if (error) throw new Error(error.message || "Swatch preview could not be loaded.");
  return data.signedUrl;
}

export function BrandMaterialSwatchInput({
  brandId,
  defaultValue,
  groupId,
}: {
  brandId: string;
  defaultValue?: string | null;
  groupId: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    void previewUrlFor(value)
      .then((url) => {
        if (!cancelled) {
          setPreviewUrl(url);
          setErrorMessage("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewUrl("");
          setErrorMessage(error instanceof Error ? error.message : "Swatch preview failed.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  async function uploadFile(file: File) {
    setStatus("uploading");
    setErrorMessage("");

    try {
      const upload = await uploadBrandMaterialImage({ brandId, file, groupId });
      setValue(`product-images:${upload.path}`);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Swatch upload failed.");
      setStatus("failed");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    await uploadFile(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = clipboardImageFile(event);
    if (!file) return;

    event.preventDefault();
    await uploadFile(file);
  }

  return (
    <div className="grid gap-3 md:col-span-2 md:grid-cols-[96px_minmax(0,1fr)]">
      <input type="hidden" name="image_url" value={value} />
      <div
        tabIndex={0}
        onPaste={handlePaste}
        className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-dashed border-zinc-300 bg-white outline-none transition focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
        aria-label="Material swatch paste area"
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Material swatch preview" className="h-full w-full object-cover" />
        ) : (
          <span className="px-2 text-center text-xs leading-5 text-zinc-400">Paste or upload</span>
        )}
      </div>
      <div className="grid content-start gap-2">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          disabled={status === "uploading"}
          className="block w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-700"
        />
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">Image URL</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste image URL, or upload/paste an image"
            className="h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-zinc-500">
            {status === "uploading" ? "Uploading..." : "Click the swatch box, then paste an image."}
          </span>
          {value ? (
            <button
              type="button"
              onClick={() => setValue("")}
              className="text-xs font-semibold text-zinc-500 transition hover:text-red-700"
            >
              Remove image
            </button>
          ) : null}
        </div>
        {status === "failed" && errorMessage ? <p className="text-xs text-red-700">{errorMessage}</p> : null}
      </div>
    </div>
  );
}
