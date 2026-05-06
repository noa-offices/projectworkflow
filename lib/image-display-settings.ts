import type { CSSProperties } from "react";

export type ImageDisplaySettings = {
  fit: "contain" | "cover";
  zoom: number;
  positionX: number;
  positionY: number;
};

export const defaultImageDisplaySettings: ImageDisplaySettings = {
  fit: "contain",
  zoom: 1,
  positionX: 50,
  positionY: 50,
};

export function imageDisplayStyle(settings: ImageDisplaySettings): CSSProperties {
  return {
    objectFit: settings.fit,
    objectPosition: `${settings.positionX}% ${settings.positionY}%`,
    transform: `scale(${settings.zoom})`,
    transformOrigin: `${settings.positionX}% ${settings.positionY}%`,
  };
}

export function normalizeImageDisplaySettings(
  settings?: Partial<ImageDisplaySettings> | null,
): ImageDisplaySettings {
  return {
    fit: settings?.fit === "cover" ? "cover" : "contain",
    zoom: Math.min(Math.max(Number(settings?.zoom) || 1, 1), 3),
    positionX: Math.min(Math.max(Number(settings?.positionX) || 50, 0), 100),
    positionY: Math.min(Math.max(Number(settings?.positionY) || 50, 0), 100),
  };
}
