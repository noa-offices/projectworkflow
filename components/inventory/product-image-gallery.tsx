"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useId, useState } from "react";
import type { InventoryImage } from "@/lib/inventory/types";

function GalleryImage({ image, productName }: { image: InventoryImage; productName: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = image.signed_url;

  if (!url || failedUrl === url) {
    return <ImagePlaceholder label="Image unavailable" />;
  }

  return (
    <Image
      src={url}
      alt={image.alt_text || productName}
      fill
      unoptimized
      loading="lazy"
      sizes="(min-width: 1024px) 40vw, 100vw"
      className="object-contain p-4"
      onError={() => setFailedUrl(url)}
    />
  );
}

function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-zinc-500">
      <ImageOff className="h-9 w-9 text-zinc-400" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ProductImageGallery({ images, productName }: { images: InventoryImage[]; productName: string }) {
  const galleryId = useId();
  const slides = images.slice(0, 3);

  return (
    <section aria-label="Product photos" className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      {slides.length ? (
        <>
          <div
            tabIndex={0}
            aria-label="Product photos. Scroll horizontally to see more images."
            className="flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto overscroll-x-contain bg-zinc-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700"
          >
            {slides.map((image, index) => (
              <div key={image.id} id={`${galleryId}-photo-${index + 1}`} className="relative aspect-[4/3] w-full min-w-0 shrink-0 snap-center">
                <GalleryImage image={image} productName={productName} />
                <span className="absolute right-3 bottom-3 rounded-full border border-zinc-200 bg-white/95 px-2.5 py-1 text-sm font-medium text-zinc-600">
                  {index + 1} / {slides.length}
                </span>
              </div>
            ))}
          </div>
          {slides.length > 1 ? (
            <nav aria-label="Choose product photo" className="flex flex-wrap items-center justify-center gap-1 border-t border-zinc-200 px-3 py-2">
              {slides.map((image, index) => (
                <a
                  key={image.id}
                  href={`#${galleryId}-photo-${index + 1}`}
                  aria-label={`View product photo ${index + 1}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  {index + 1}
                </a>
              ))}
            </nav>
          ) : null}
        </>
      ) : (
        <div className="aspect-[4/3] bg-zinc-50"><ImagePlaceholder label="No product photos" /></div>
      )}
    </section>
  );
}
