import { dubaiDateKey } from "../date-time";
export { DUBAI_TIME_ZONE, formatDubaiDateTime, dubaiDateKey, excelDubaiDate, isValidDateKey, dubaiDayBounds, shiftDateKey } from "../date-time";

/**
 * Formula-injection protection: text that a spreadsheet could read as a formula (starts with = + - @, a tab
 * or a carriage return) gets a leading apostrophe. Numbers and dates are never passed through here.
 */
export function safeCell(value: string | null | undefined): string {
  const text = value ?? "";
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
export function reportFileName(kind: "inventory-current" | "inventory-movements", extension: "xlsx" | "pdf", date: Date = new Date()): string {
  return `${kind}-${dubaiDateKey(date)}.${extension}`;
}
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
