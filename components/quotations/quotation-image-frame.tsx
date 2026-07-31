import type { CSSProperties, ReactNode } from "react";
import {
  imageDisplayStyle,
  normalizeImageDisplaySettings,
  type ImageDisplaySettings,
} from "@/lib/image-display-settings";

export function QuotationImageFrame({
  alt,
  className = "",
  emptyContent,
  imageClassName = "block h-full w-full",
  imageUrl,
  minimumZoom = 1,
  onImageError,
  settings,
  style,
}: {
  alt: string;
  className?: string;
  emptyContent?: ReactNode;
  imageClassName?: string;
  imageUrl: string | null;
  minimumZoom?: number;
  onImageError?: () => void;
  settings?: Partial<ImageDisplaySettings> | null;
  style?: CSSProperties;
}) {
  const normalizedSettings = normalizeImageDisplaySettings(settings, minimumZoom);

  return (
    <div className={className} style={style}>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={alt}
          className={imageClassName}
          onError={onImageError}
          style={imageDisplayStyle(normalizedSettings)}
        />
      ) : (
        emptyContent ?? null
      )}
    </div>
  );
}
