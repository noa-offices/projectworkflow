export const IMAGE_PREVIEW_ZOOM_STEP = 10;
export const IMAGE_PREVIEW_ZOOM_MIN = 50;
export const IMAGE_PREVIEW_ZOOM_MAX = 200;

/** "fit" renders the image at its natural size (never upscaled), shrunk only as far as the preview area requires; a number is an explicit user-chosen zoom percentage. */
export type ImagePreviewZoomMode = "fit" | number;

/** Steps +10 percentage points. From Fit, starts just above 100% rather than an arbitrary large jump. */
export function nextImagePreviewZoomIn(current: ImagePreviewZoomMode): number {
  return current === "fit"
    ? 100 + IMAGE_PREVIEW_ZOOM_STEP
    : Math.min(IMAGE_PREVIEW_ZOOM_MAX, current + IMAGE_PREVIEW_ZOOM_STEP);
}

/** Steps -10 percentage points. From Fit, starts just below 100% rather than an arbitrary large jump. */
export function nextImagePreviewZoomOut(current: ImagePreviewZoomMode): number {
  return current === "fit"
    ? 100 - IMAGE_PREVIEW_ZOOM_STEP
    : Math.max(IMAGE_PREVIEW_ZOOM_MIN, current - IMAGE_PREVIEW_ZOOM_STEP);
}
