import { LOCATION_LABELS } from "./types";
export function inventoryErrorMessage(error: unknown): string | null {
  const value = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  const message = value.message ?? "";
  if (message.includes("pending product request")) return "Photos can only be added while the request is pending review.";
  if (value.code === "42501") return "You do not have permission to do that.";
  if (message.includes("item code already in use")) return "That item code is already in use.";
  if (message.includes("stock ref already in use")) return "That stock reference is already in use.";
  if (message.includes("already been reviewed")) return "This request has already been reviewed.";
  const stock = /^Only (\d+) units are in (warehouse|dubai_showroom|abudhabi_showroom|mockup|temporary_out)$/.exec(message);
  if (stock) return `Only ${stock[1]} units are in ${LOCATION_LABELS[stock[2] as keyof typeof LOCATION_LABELS]}.`;
  if (/^(Active product|Product request|Movement request|Photo|Photo owner) not found$/.test(message)) return "That inventory record is no longer available.";
  if (message.includes("Photo changed") || message.includes("Photo ownership changed")) return "The photo changed. Refresh and try again.";
  if (value.code === "23505") return "Those details or photo positions are already in use. Refresh and try again.";
  if (value.code === "23503") return "A selected inventory record is no longer available.";
  return null;
}
