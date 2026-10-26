/** All Inventory wall-clock dates use this IANA zone, independent of the device. */
export const DUBAI_TIME_ZONE = 'Asia/Dubai';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DUBAI_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function instant(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Database timestamptz strings carry an offset. Ambiguous device-local inputs
  // belong in dubaiLocalToIso instead of being parsed differently during hydration.
  if (!isValidDateKey(value.slice(0,10)) || (value.length !== 10 && !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) return new Date(NaN);
  return new Date(value);
}
function dubaiParts(date: Date) {
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}
/** No host locale/timezone defaults, so the server and client render identically. */
export function formatDubaiDateTime(value: string | Date): string {
  const date = instant(value);
  if (!Number.isFinite(date.getTime())) return '';
  const p = dubaiParts(date);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}
export function dubaiDateKey(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) return '';
  const p = dubaiParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
/** Excel has no zone. Encode Dubai calendar parts as an Excel wall-clock date. */
export function excelDubaiDate(value: string): Date | null {
  const date = instant(value);
  if (!Number.isFinite(date.getTime())) return null;
  const p = dubaiParts(date);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second, date.getUTCMilliseconds()));
}
export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}
/** Interpret a datetime-local value as Dubai time, never the browser's timezone. */
export function dubaiLocalToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value) || !isValidDateKey(value.slice(0, 10))) throw new Error('Enter a valid Dubai date and time.');
  const wall = new Date(`${value}Z`);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== value.slice(0, 16)) throw new Error('Enter a valid Dubai date and time.');
  // Derive the zone offset from Intl, including historical zone rules; no fixed +4.
  const projected = excelDubaiDate(wall.toISOString())!;
  return new Date(wall.getTime() - (projected.getTime() - wall.getTime())).toISOString();
}
export function dubaiDayBounds(from: string, to: string): { from: string; to: string } {
  return { from: dubaiLocalToIso(`${from}T00:00:00.000`), to: dubaiLocalToIso(`${to}T23:59:59.999`) };
}
export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
