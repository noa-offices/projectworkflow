"use client";

import { useEffect, useState } from "react";
import {
  markQuotationImagePathFailed,
  normalizeProductImageSnapshotPath,
  resolveQuotationImageUrl,
} from "@/lib/quotation-image-path";

export function ProductLibraryPreviewImage({
  alt,
  className,
  imageClassName = "h-full w-full object-contain",
  path,
  placeholder = "No preview image",
}: {
  alt: string;
  className: string;
  imageClassName?: string;
  path: string | null;
  placeholder?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    if (!path) {
      window.queueMicrotask(() => {
        if (!cancelled) setPreviewUrl("");
      });
      return;
    }

    void resolveQuotationImageUrl(normalizeProductImageSnapshotPath(path) ?? path)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl("");
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className={className}>
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={alt}
          onError={() => {
            if (path) {
              markQuotationImagePathFailed(normalizeProductImageSnapshotPath(path) ?? path);
            }
            setPreviewUrl("");
          }}
          className={imageClassName}
        />
      ) : (
        <div className="px-6 text-center text-sm text-zinc-400">{placeholder}</div>
      )}
    </div>
  );
}
