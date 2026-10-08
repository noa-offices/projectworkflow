export type PriceListLifecycle = "current" | "update_in_progress" | "previous" | "upcoming" | "archived" | "unfinished";
export type PriceListReviewState = "Not started" | "In progress" | "Ready to complete" | "Completed" | "Abandoned";
export const priceListLabels: Record<PriceListLifecycle, string> = { current: "Current", update_in_progress: "Update in progress", previous: "Previous", upcoming: "Upcoming", archived: "Archived", unfinished: "Unfinished import" };
export function priceListReviewState(status: string | null, unresolved?: number): PriceListReviewState {
  if (status === "completed") return "Completed";
  if (status === "abandoned") return "Abandoned";
  if (status === "review" && unresolved === 0) return "Ready to complete";
  return status === "review" || status === "matching" ? "In progress" : "Not started";
}
