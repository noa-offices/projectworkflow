export const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "1y", label: "Last 1 year" },
  { value: "custom", label: "Custom range" },
] as const;

export type DateRangeKey = (typeof DATE_RANGE_OPTIONS)[number]["value"];
export const DEFAULT_DATE_RANGE: DateRangeKey = "6m";

export function isDateRangeKey(value: string | undefined): value is DateRangeKey {
  return DATE_RANGE_OPTIONS.some((option) => option.value === value);
}

export function dateParam(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dayStart(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function dayEnd(date: Date) {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function getRangeStart(range: DateRangeKey, from: Date): Date {
  const date = new Date(from);
  switch (range) {
    case "today": return dayStart(date);
    case "yesterday": date.setDate(date.getDate() - 1); return dayStart(date);
    case "this_week": date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return dayStart(date);
    case "last_week": date.setDate(date.getDate() - ((date.getDay() + 6) % 7) - 7); return dayStart(date);
    case "this_month": date.setDate(1); return dayStart(date);
    case "last_month": date.setMonth(date.getMonth() - 1, 1); return dayStart(date);
    case "7d": date.setDate(date.getDate() - 7); return date;
    case "30d": date.setDate(date.getDate() - 30); return date;
    case "3m": date.setMonth(date.getMonth() - 3); return date;
    case "6m": date.setMonth(date.getMonth() - 6); return date;
    case "this_quarter": date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1); return dayStart(date);
    case "last_quarter": date.setMonth(Math.floor(date.getMonth() / 3) * 3 - 3, 1); return dayStart(date);
    case "ytd":
    case "this_year": date.setMonth(0, 1); return dayStart(date);
    case "last_year": date.setFullYear(date.getFullYear() - 1, 0, 1); return dayStart(date);
    case "1y": date.setFullYear(date.getFullYear() - 1); return date;
    default: return date;
  }
}

export function resolveDateRange(
  rawRange: string | undefined,
  rawFrom: string | undefined,
  rawTo: string | undefined,
  now = new Date(),
) {
  const requested = isDateRangeKey(rawRange) ? rawRange : DEFAULT_DATE_RANGE;
  const customFrom = dateParam(rawFrom);
  const customTo = dateParam(rawTo, true);
  const validCustom = requested === "custom" && customFrom !== null && customTo !== null && customFrom <= customTo;
  const range = requested === "custom" && !validCustom ? DEFAULT_DATE_RANGE : requested;
  const from = validCustom && customFrom ? customFrom : getRangeStart(range, now);
  let to = validCustom && customTo ? customTo : now;

  if (range === "yesterday") to = dayEnd(from);
  if (range === "last_week") { to = new Date(from); to.setDate(to.getDate() + 6); to = dayEnd(to); }
  if (range === "last_month") { to = new Date(from); to.setMonth(to.getMonth() + 1, 0); to = dayEnd(to); }
  if (range === "last_quarter") { to = new Date(from); to.setMonth(to.getMonth() + 3, 0); to = dayEnd(to); }
  if (range === "last_year") { to = new Date(from); to.setFullYear(to.getFullYear() + 1, 0, 0); to = dayEnd(to); }

  return { range, from, to, validCustom };
}
