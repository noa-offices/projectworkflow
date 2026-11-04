import type { ReadEntity } from "./types";

/**
 * What the top bar "Refresh data" button does inside the read-cache runtime.
 * - "probe": the page is not a saved read view, so only the session and health are checked.
 * - "refresh": online on a saved read view, so the saved snapshot is refreshed quietly. No overlay.
 * - "preview": offline, or a preview is already open, so the saved read view opens (or stays open) as before.
 */
export type ManualRefreshAction = "probe" | "refresh" | "preview";

export function manualRefreshAction(online: boolean, entity: ReadEntity | null | undefined, previewOpen: boolean): ManualRefreshAction {
  if (!entity) return "probe";
  return !online || previewOpen ? "preview" : "refresh";
}
