/** Shared helpers for Inventory reports: Dubai time, safe text, file names. No prices or costs live in reports. */
export const DUBAI_TIME_ZONE = "Asia/Dubai";
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC+4, no daylight saving
const dubaiParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DUBAI_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Oct 2026, 14:05" in Dubai time. */
export function formatDubaiDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "";
  const p = dubaiParts(date);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}
/** YYYY-MM-DD of the Dubai calendar day. */
export function dubaiDateKey(value: Date = new Date()): string {
  const p = dubaiParts(value);
  return `${p.year}-${p.month}-${p.day}`;
}
/** A real Excel date whose wall-clock time is Dubai time (Excel stores no time zone). */
export function excelDubaiDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + DUBAI_OFFSET_MS) : null;
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDateKey(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}
/** Whole Dubai days [from, to] as UTC instants, for filtering created_at. */
export function dubaiDayBounds(from: string, to: string): { from: string; to: string } {
  return { from: new Date(`${from}T00:00:00+04:00`).toISOString(), to: new Date(`${to}T23:59:59.999+04:00`).toISOString() };
}
export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
