"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadQuotationFinishImage } from "@/lib/quotation-image-upload";

type UploadStatus = "idle" | "uploading" | "failed";

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

async function signedImageUrl(path: string) {
  if (isDirectImageUrl(path)) return path;

  const bucket = path.startsWith("product-images:") ? "product-images" : "quote-images";
  const storagePath = path.startsWith("product-images:")
    ? path.slice("product-images:".length)
    : path.startsWith("quote-images:")
      ? path.slice("quote-images:".length)
      : path;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    throw new Error(error.message || "Swatch could not be loaded.");
  }

  return data.signedUrl;
}

export function FinishImagePreview({
  alt,
  className = "h-8 w-8",
  value,
}: {
  alt: string;
  className?: string;
  value?: string | null;
}) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (!value) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl("");
      });
      return;
    }

    void signedImageUrl(value)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden border border-zinc-200 bg-white ${className}`}>
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt={alt} className="h-full w-full object-cover" />
      ) : null}
    </span>
  );
}

export function FinishImageUploader({
  defaultValue,
  disabled,
  itemId,
  name,
  quotationId,
}: {
  defaultValue?: string | null;
  disabled?: boolean;
  itemId?: string | null;
  name: string;
  quotationId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !itemId || disabled) return;

    setStatus("uploading");
    setErrorMessage("");

    try {
      const upload = await uploadQuotationFinishImage({ file, itemId, quotationId });
      setValue(`quote-images:${upload.path}`);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Swatch upload failed.");
      setStatus("failed");
    }
  }

  return (
    <div className="grid gap-1 md:col-span-2">
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-zinc-500">Swatch image URL or upload</span>
        <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-2">
          <FinishImagePreview alt="Finish swatch" className="h-10 w-10" value={value} />
          <input
            name={name}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="h-10 w-full border border-zinc-300 bg-white px-2 text-xs text-zinc-800 outline-none focus:border-emerald-800 focus:ring-1 focus:ring-emerald-900/20"
          />
        </div>
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={handleFileChange}
          disabled={disabled || !itemId || status === "uploading"}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || !itemId || status === "uploading"}
          className="text-[10px] font-semibold text-emerald-900 transition hover:text-emerald-800 disabled:text-zinc-400"
        >
          {status === "uploading" ? "Uploading..." : value ? "Replace" : "Upload"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => setValue("")}
            className="text-[10px] font-semibold text-zinc-500 transition hover:text-red-700"
          >
            Remove image
          </button>
        ) : null}
      </div>
      {!itemId ? <p className="text-[10px] text-zinc-500">Save the row before uploading a swatch.</p> : null}
      {errorMessage ? <p className="text-[10px] text-red-700">{errorMessage}</p> : null}
      {status === "failed" ? null : null}
    </div>
  );
}
