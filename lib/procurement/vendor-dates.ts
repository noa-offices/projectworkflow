// Date-only business values: no timezone conversion and no JavaScript date rollover.
export function normalizeVendorDate(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return { ok: false };
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return { ok: false };
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1] ? { ok: true, value } : { ok: false };
}
