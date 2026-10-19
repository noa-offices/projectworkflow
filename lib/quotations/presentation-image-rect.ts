import { normalizePresentationImageRect, type PresentationImageRect } from "./presentation-settings";

// Pure geometry for the on-slide image editor. All numbers are percent (0-100) of the product image box.

export type ImageRectCorner = "nw" | "ne" | "sw" | "se";

const round = (value: number) => Math.round(value * 100) / 100;

// Rounds, then enforces the same limits the settings normalizer applies. Falls back to the input when invalid.
function finish(rect: PresentationImageRect, fallback: PresentationImageRect) {
  return normalizePresentationImageRect({ x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) }) ?? fallback;
}

export function moveRect(start: PresentationImageRect, dx: number, dy: number): PresentationImageRect {
  return finish({
    ...start,
    x: Math.min(Math.max(start.x + dx, 0), 100 - start.w),
    y: Math.min(Math.max(start.y + dy, 0), 100 - start.h),
  }, start);
}

/**
 * Resize from a corner. The opposite corner is the anchor, the ratio from the start of the drag is kept,
 * the minimum is 10% in width and height, and the rect never leaves the box.
 */
export function resizeRect(start: PresentationImageRect, corner: ImageRectCorner, dx: number, dy: number): PresentationImageRect {
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  const factorX = (start.w + (east ? dx : -dx)) / start.w;
  const factorY = (start.h + (south ? dy : -dy)) / start.h;
  // The axis the pointer moved furthest drives the size, so a mostly vertical drag still resizes.
  let factor = Math.abs(factorX - 1) >= Math.abs(factorY - 1) ? factorX : factorY;

  const minimum = Math.max(10 / start.w, 10 / start.h);
  const availableWidth = east ? 100 - start.x : start.x + start.w;
  const availableHeight = south ? 100 - start.y : start.y + start.h;
  const maximum = Math.min(availableWidth / start.w, availableHeight / start.h);
  factor = Math.min(Math.max(factor, minimum), maximum);

  const w = start.w * factor;
  const h = start.h * factor;
  return finish({
    x: east ? start.x : start.x + start.w - w,
    y: south ? start.y : start.y + start.h - h,
    w,
    h,
  }, start);
}

export function nudgeRect(start: PresentationImageRect, key: string, step: number): PresentationImageRect {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  return moveRect(start, dx, dy);
}
