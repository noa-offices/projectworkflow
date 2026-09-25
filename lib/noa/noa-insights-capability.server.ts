import "server-only";

import { requireActiveUser, requireProcurementManager, requireProductLibraryManager } from "@/lib/auth";
import {
  brandPriceBaselineDate,
  latestBrandPriceListUpdate,
  productTemplatePriceCheckState,
  type ProductPriceCheckState,
} from "@/lib/product-price-check";
import { resolveDateRange, type DateRangeKey } from "@/lib/insights/date-ranges";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient } from "@/lib/supabase/server";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

// B7: NOA Insights is deliberately NARROWER than the existing app/insights/sales-report page,
// which uses a privileged/service-level database client for cross-user reporting. NOA Insights
// never does that - every read here goes through requireActiveUser() + a user-scoped
// createClient(), and every
// permission-sensitive subsection (Product/Price, Procurement) additionally preserves that
// domain's own existing gate (requireProductLibraryManager()/requireProcurementManager()) rather
// than being unlocked just because the question is phrased as "insights".

const MAX_QUOTATION_SCAN = 300;
const MAX_TREND_MONTHS = 12;
const MAX_PRICE_SCAN = 200;
// N2C2: mirrors the Project capability's own proven Project File scan bound - never imported
// (Insights never cross-imports another NOA capability module), just the same bound reapplied to
// the same underlying `quotations` scan reimplemented locally below.
const PROJECT_FILE_SCAN_LIMIT = 200;
const MAX_CLIENT_RANKING_ROWS = 10;

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access ProjectWorkflow insights for this account.",
  ok: false,
  reason: "unauthorized",
};

const PRODUCT_PRICE_UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "Product price insights aren't available with your current permissions.",
  ok: false,
  reason: "unauthorized",
};

const PROCUREMENT_UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "Procurement insights aren't available with your current permissions.",
  ok: false,
  reason: "unauthorized",
};

function isNextRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

type InsightsQuestionKind =
  // N2C2: additive kinds only - every existing kind below is reused exactly as before.
  | "client_ranking"
  | "client_summary"
  | "overview"
  | "procurement_summary"
  | "product_price_summary"
  | "project_file_analytics"
  | "project_file_on_hold_unsupported"
  | "project_summary"
  // N2C1: additive kinds only - quotation_summary/quotation_trend are reused exactly as before.
  | "quotation_analytics"
  | "quotation_compare"
  | "quotation_conversion_rate"
  | "quotation_summary"
  | "quotation_trend";

// PART 3: deterministic classification only - trend before plain summary (so "quotation trend"
// doesn't fall into quotation_summary), domain noun otherwise decides the section, "overview" as
// the final default for a general/business-summary phrasing.
// N2C1: one classifier extended in place (no second classifier) - conversion-rate and
// compare-period phrasing are checked first (most specific), then the explicit "analytics/
// overview/breakdown" phrasing, then the existing generic quotation/project/product/client/
// procurement checks, widened only enough to catch "how much did we quote"/"client confirmed"
// phrasing that doesn't contain the literal word "quotation".
function insightsQuestionKind(message: string): InsightsQuestionKind {
  const normalized = message.toLowerCase();
  if (/\btrend\b/.test(normalized) && /\bquotations?\b/.test(normalized)) return "quotation_trend";
  // C0 proved no authoritative conversion/win/success-rate denominator exists - always the fixed
  // definition-required response, never a computed number.
  if (/\b(?:conversion|win|success) rate\b/.test(normalized)) return "quotation_conversion_rate";
  if (
    /\bcompare\b/.test(normalized) &&
    /\bthis (?:month|week|quarter|year)\b/.test(normalized) &&
    /\blast (?:month|week|quarter|year)\b/.test(normalized)
  ) {
    return "quotation_compare";
  }
  if (
    /\bquotation analytics\b/.test(normalized) ||
    /\bsales overview\b/.test(normalized) ||
    /\bquotation status breakdown\b/.test(normalized)
  ) {
    return "quotation_analytics";
  }
  // N2C2.0.1: explicit client-ranking/analytics phrasing MUST be checked before the generic
  // quotation-noun catch-all directly below - two of the five C2 client-ranking phrases
  // ("top clients by quotation value", "how many quotations does each client have") contain the
  // literal word "quotation(s)", which the old ordering let the generic quotation_summary check
  // win first (proven root cause of the live-UAT bug: those two phrases returned the current-
  // month quotation_summary "no quotations recorded this month" text instead of the all-time
  // client ranking). Moved up from its previous position (which was already correctly ordered
  // relative to project_summary/client_summary, just not relative to quotation_summary). The
  // specific metric (quotation/confirmed/project value, or count) is re-derived from the message
  // inside clientRankingAnswer() itself - see clientRankingMetric().
  if (
    /\bclient analytics\b/.test(normalized) ||
    /\btop clients? by (?:quotation|confirmed|project(?:\s*file)?) value\b/.test(normalized) ||
    /\bhow many quotations does each client have\b/.test(normalized)
  ) {
    return "client_ranking";
  }
  if (
    /\bquotations?\b/.test(normalized) ||
    /\bclient[- ]confirmed\b/.test(normalized) ||
    (/\bquote[d]?\b/.test(normalized) && /\b(?:this|last) (?:month|week|quarter|year|today)\b/.test(normalized))
  ) {
    return "quotation_summary";
  }
  // N2C2: on-hold phrasing checked BEFORE the generic Project File analytics check - C0 proved no
  // authoritative ERP Project File on-hold status exists, so this always returns the fixed
  // refusal, never a fabricated count from the standalone `projects.project_status` enum.
  if (/\b(?:projects?|project files?)\b/.test(normalized) && /\bon[- ]?hold\b/.test(normalized)) {
    return "project_file_on_hold_unsupported";
  }
  // N2C2: explicit Project File analytics/breakdown/value phrasing - checked before the generic
  // "project"-noun catch-all below, so it wins over the terse existing project_summary answer.
  if (
    /\bproject file analytics\b/.test(normalized) ||
    /\bproject analytics\b/.test(normalized) ||
    /\bhow many active project files?\b/.test(normalized) ||
    /\bactive project (?:file )?value\b/.test(normalized) ||
    /\bproject file status breakdown\b/.test(normalized)
  ) {
    return "project_file_analytics";
  }
  if (/\bproject(s)?\b/.test(normalized) && !/\bproject orders?\b/.test(normalized)) return "project_summary";
  if (/\b(product|products|price|pricing)\b/.test(normalized)) return "product_price_summary";
  if (/\bclients?\b/.test(normalized)) return "client_summary";
  if (/\bprocurement\b/.test(normalized)) return "procurement_summary";
  return "overview";
}

// PART 4: reuses the existing Insights date-range helper, same convention/limitations as
// UA-1A/UA-1B (server-process local time, no new timezone logic).
function insightsDateRangeKey(message: string): DateRangeKey {
  const normalized = message.toLowerCase();
  if (/\blast month\b/.test(normalized)) return "last_month";
  if (/\bthis month\b/.test(normalized)) return "this_month";
  if (/\blast 7 days?\b/.test(normalized)) return "7d";
  if (/\blast 30 days?\b/.test(normalized)) return "30d";
  if (/\bthis week\b/.test(normalized)) return "this_week";
  if (/\bthis year\b/.test(normalized)) return "this_year";
  if (/\btoday\b/.test(normalized)) return "today";
  return "this_month";
}

function rangeLabel(range: DateRangeKey) {
  switch (range) {
    case "last_month": return "last month";
    case "7d": return "in the last 7 days";
    case "30d": return "in the last 30 days";
    case "this_week": return "this week";
    case "this_year": return "this year";
    case "today": return "today";
    default: return "this month";
  }
}

// PART 5: currencies are never combined - every total is grouped by currency, computed in code.
function currencyEntries(totalsByCurrency: Map<string, number>): string[] {
  return Array.from(totalsByCurrency.entries())
    .map(([currency, total]) => `${currency} ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
}
function formatCurrencyTotals(totalsByCurrency: Map<string, number>): string {
  const entries = currencyEntries(totalsByCurrency);
  return entries.length === 0 ? "no value recorded" : entries.join(", ");
}
// N2C1 PART 13: same per-currency entries as formatCurrencyTotals, one per line - used only by the
// multi-line quotation_analytics rendering (PART 11), never a mixed-currency single figure.
function formatCurrencyLines(totalsByCurrency: Map<string, number>): string {
  const entries = currencyEntries(totalsByCurrency);
  return entries.length === 0 ? "no value recorded" : entries.join("\n");
}

type QuotationInsightRow = { created_at: string; currency: string; grand_total: number; status: string };

type QuotationAnalyticsAggregate = {
  averageByCurrency: Map<string, number>;
  confirmedCount: number;
  confirmedTotalsByCurrency: Map<string, number>;
  rows: QuotationInsightRow[];
  scanCapped: boolean;
  statusCounts: Map<string, number>;
  totalMatching: number;
  totalsByCurrency: Map<string, number>;
};

// N2C1 PART 4: the ONE bounded, date-scoped, active-only quotations scan every quotation
// analytics answer (summary/analytics/compare) reuses - never a second/duplicate scan for the
// same period. Identical query shape to the pre-N2C1 quotationSummaryAnswer() this replaces.
async function quotationAnalyticsAggregate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rangeKey: DateRangeKey,
): Promise<QuotationAnalyticsAggregate> {
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const { data, count } = await supabase
    .from("quotations")
    .select("created_at,currency,grand_total,status", { count: "exact" })
    .eq("is_active", true)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_QUOTATION_SCAN)
    .returns<QuotationInsightRow[]>();

  const rows = data ?? [];
  const totalMatching = count ?? rows.length;
  const scanCapped = totalMatching > rows.length;

  const statusCounts = new Map<string, number>();
  const totalsByCurrency = new Map<string, number>();
  const countByCurrency = new Map<string, number>();
  const confirmedTotalsByCurrency = new Map<string, number>();
  let confirmedCount = 0;

  for (const row of rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    totalsByCurrency.set(row.currency, (totalsByCurrency.get(row.currency) ?? 0) + (row.grand_total ?? 0));
    countByCurrency.set(row.currency, (countByCurrency.get(row.currency) ?? 0) + 1);
    if (row.status === "client_confirmed") {
      confirmedCount += 1;
      confirmedTotalsByCurrency.set(row.currency, (confirmedTotalsByCurrency.get(row.currency) ?? 0) + (row.grand_total ?? 0));
    }
  }

  // PART 5: average computed PER CURRENCY only - that currency's own total / that currency's own
  // count - never a division across mixed currencies.
  const averageByCurrency = new Map<string, number>();
  for (const [currency, total] of totalsByCurrency.entries()) {
    const currencyCount = countByCurrency.get(currency) ?? 0;
    if (currencyCount > 0) averageByCurrency.set(currency, total / currencyCount);
  }

  return { averageByCurrency, confirmedCount, confirmedTotalsByCurrency, rows, scanCapped, statusCounts, totalMatching, totalsByCurrency };
}

// PRESERVED byte-for-byte in output shape/text - only its internals now call the shared
// aggregate above instead of running their own scan (PART 4/17).
async function quotationSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = insightsDateRangeKey(message);
  const aggregate = await quotationAnalyticsAggregate(supabase, rangeKey);
  const { confirmedCount, confirmedTotalsByCurrency, rows, scanCapped, statusCounts, totalMatching, totalsByCurrency } = aggregate;

  const label = rangeLabel(rangeKey);
  const statusText = Array.from(statusCounts.entries()).map(([status, count2]) => `${count2} ${status}`).join(", ");
  const capNote = scanCapped ? ` (showing the first ${rows.length} of ${totalMatching})` : "";

  return {
    data: {
      confirmedCount,
      confirmedTotalsByCurrency: Object.fromEntries(confirmedTotalsByCurrency),
      kind: "insights_quotation_summary",
      range: rangeKey,
      scanCapped,
      statusCounts: Object.fromEntries(statusCounts),
      totalMatching,
      totalsByCurrency: Object.fromEntries(totalsByCurrency),
      deterministicText: rows.length === 0
        ? `I found no quotations ${label}.`
        : `You can access ${totalMatching} quotation${totalMatching === 1 ? "" : "s"} ${label}${capNote}: ${statusText}. Total value: ${formatCurrencyTotals(totalsByCurrency)}. Confirmed: ${confirmedCount} (${formatCurrencyTotals(confirmedTotalsByCurrency)}).`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
  };
}

// N2C1 PART 7/11: a small LOCAL mirror of the Quotation capability's own two proven status
// overrides (never imported - Insights never cross-imports another NOA capability module, an
// existing B7 architectural rule; this duplicates only the two known, authorized persisted-status
// keys, not a new business definition). Anything not in this map falls back to a deterministic
// word-split Title Case humanizer - never a second business-meaning invention (no "Lost"/
// "Rejected"/"Cancelled" unless the raw status string itself actually says so).
function insightsQuotationStatusLabel(status: string): string {
  const key = status.toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "draft") return "Pending";
  if (key === "clientconfirmed") return "Client Confirmed";
  return status.split(/[\s_-]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

// N2C1 PART 11: richer multi-line rendering of the EXACT SAME aggregate quotation_summary uses -
// never a second scan, never a different set of authoritative numbers. Average and confirmed
// value are additive fields quotation_summary itself never rendered this way.
async function quotationAnalyticsAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = insightsDateRangeKey(message);
  const aggregate = await quotationAnalyticsAggregate(supabase, rangeKey);
  const label = rangeLabel(rangeKey);

  if (aggregate.rows.length === 0) {
    return {
      data: {
        kind: "insights_quotation_analytics",
        range: rangeKey,
        scanCapped: false,
        totalMatching: 0,
        deterministicOnly: true,
        deterministicText: `I found no quotations ${label}.`,
      },
      ok: true,
      sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
    };
  }

  const capNote = aggregate.scanCapped ? ` (showing the first ${aggregate.rows.length} of ${aggregate.totalMatching})` : "";
  const statusText = Array.from(aggregate.statusCounts.entries())
    .map(([status, count]) => `${insightsQuotationStatusLabel(status)} ${count}`)
    .join(" · ");
  const periodTitle = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;

  const deterministicText = [
    `Quotation analytics — ${periodTitle}`,
    "",
    `${aggregate.totalMatching} quotation${aggregate.totalMatching === 1 ? "" : "s"}${capNote}`,
    "",
    "Quoted value",
    formatCurrencyLines(aggregate.totalsByCurrency),
    "",
    "Client-confirmed value",
    formatCurrencyLines(aggregate.confirmedTotalsByCurrency),
    "",
    "Average quotation value",
    formatCurrencyLines(aggregate.averageByCurrency),
    "",
    "Status",
    statusText,
  ].join("\n");

  return {
    data: {
      averageByCurrency: Object.fromEntries(aggregate.averageByCurrency),
      confirmedCount: aggregate.confirmedCount,
      confirmedTotalsByCurrency: Object.fromEntries(aggregate.confirmedTotalsByCurrency),
      kind: "insights_quotation_analytics",
      range: rangeKey,
      scanCapped: aggregate.scanCapped,
      statusCounts: Object.fromEntries(aggregate.statusCounts),
      totalMatching: aggregate.totalMatching,
      totalsByCurrency: Object.fromEntries(aggregate.totalsByCurrency),
      deterministicOnly: true,
      deterministicText,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
  };
}

// N2C1 PART 8: reuses the existing "this_month"/"last_month" DateRangeKeys verbatim - no new
// month-boundary math. Compares ONLY matching currencies per period; a currency present in only
// one period shows the other side as an honest zero (correctly meaning no quotations in that
// currency for that period, never a guessed/omitted value). No currency conversion, ever.
async function quotationCompareAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const [current, previous] = await Promise.all([
    quotationAnalyticsAggregate(supabase, "this_month"),
    quotationAnalyticsAggregate(supabase, "last_month"),
  ]);

  const countDiff = current.totalMatching - previous.totalMatching;
  const countDiffText = `${countDiff >= 0 ? "+" : ""}${countDiff}`;

  const currencies = new Set([...current.totalsByCurrency.keys(), ...previous.totalsByCurrency.keys()]);
  const valueLines = Array.from(currencies).map((currency) => {
    const currentTotal = current.totalsByCurrency.get(currency) ?? 0;
    const previousTotal = previous.totalsByCurrency.get(currency) ?? 0;
    const diff = currentTotal - previousTotal;
    const sign = diff >= 0 ? "+" : "-";
    const diffAmount = Math.abs(diff).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${currency} ${currentTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })} this month vs ${currency} ${previousTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })} last month (${sign}${currency} ${diffAmount}).`;
  });

  const deterministicText = [
    `${current.totalMatching} quotation${current.totalMatching === 1 ? "" : "s"} this month vs ${previous.totalMatching} last month (${countDiffText}).`,
    ...valueLines,
  ].join(" ");

  return {
    data: {
      current: { count: current.totalMatching, totalsByCurrency: Object.fromEntries(current.totalsByCurrency) },
      kind: "insights_quotation_compare",
      previous: { count: previous.totalMatching, totalsByCurrency: Object.fromEntries(previous.totalsByCurrency) },
      deterministicOnly: true,
      deterministicText,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
  };
}

// N2C1 PART 16: C0 proved no authoritative conversion/win/success-rate denominator exists - this
// is a fixed, deterministic refusal, never a computed percentage, and requires no database read.
async function quotationRateDefinitionRequiredAnswer(): Promise<NoaCapabilityResult> {
  return {
    data: {
      kind: "insights_quotation_conversion_rate",
      deterministicOnly: true,
      deterministicText: "ProjectWorkflow doesn't have a defined quotation conversion-rate basis yet - a conversion rate needs an agreed denominator (for example: all created quotations, or only those sent to a client) before I can calculate one safely.",
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
  };
}

// PART 13: monthly counts are always safe regardless of currency mix; monthly VALUE is only
// included when every scanned quotation shares a single currency, so a multi-currency trend is
// never silently summed together.
async function quotationTrendAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (MAX_TREND_MONTHS - 1), 1);

  const { data, count } = await supabase
    .from("quotations")
    .select("created_at,currency,grand_total,status", { count: "exact" })
    .eq("is_active", true)
    .gte("created_at", from.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_QUOTATION_SCAN)
    .returns<QuotationInsightRow[]>();

  const rows = data ?? [];
  const totalMatching = count ?? rows.length;
  const scanCapped = totalMatching > rows.length;

  const months: { count: number; monthKey: string; total: number }[] = Array.from({ length: MAX_TREND_MONTHS }, (_, index) => {
    const date = new Date(from.getFullYear(), from.getMonth() + index, 1);
    return { count: 0, monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, total: 0 };
  });
  const monthByKey = new Map(months.map((month) => [month.monthKey, month]));
  const currencies = new Set<string>();

  for (const row of rows) {
    const date = new Date(row.created_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthByKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.total += row.grand_total ?? 0;
    currencies.add(row.currency);
  }

  const singleCurrency = currencies.size === 1 ? Array.from(currencies)[0] : null;
  const nonEmptyMonths = months.filter((month) => month.count > 0);
  const capNote = scanCapped ? ` (based on the ${rows.length} most recent of ${totalMatching} matching quotations)` : "";

  return {
    data: {
      currency: singleCurrency,
      kind: "insights_quotation_trend",
      monthCount: MAX_TREND_MONTHS,
      months: months.map((month) => ({ count: month.count, month: month.monthKey, total: singleCurrency ? month.total : null })),
      scanCapped,
      deterministicText: nonEmptyMonths.length === 0
        ? `I found no quotation activity over the last ${MAX_TREND_MONTHS} months.`
        : `Quotation trend over the last ${MAX_TREND_MONTHS} months${capNote}: ${nonEmptyMonths.map((month) => `${month.monthKey}: ${month.count}${singleCurrency ? ` (${singleCurrency} ${month.total.toLocaleString("en-US", { maximumFractionDigits: 2 })})` : ""}`).join(", ")}.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
  };
}

type InsightsProjectFileStatus = "active" | "cancelled" | "completed";

type InsightsProjectFile = {
  clientId: string;
  clientName: string;
  currency: string;
  orderNo: string;
  status: InsightsProjectFileStatus;
  total: number;
};

type InsightsProjectFileLayoutRow = { id: string; layout_settings: unknown };

// N2C2 PART 2/5/18: the SAME authoritative Project File parsing the Project capability's own
// resolver uses - projectFileFromLayoutSettings()/clientApprovalDraftFromLayoutSettings() fallback,
// both already imported above (unchanged, already used by procurementSummaryAnswer() below).
// Reimplemented locally rather than importing that resolver itself, since Insights never
// cross-imports another NOA capability module (existing B7 architectural rule) - same bound
// (PROJECT_FILE_SCAN_LIMIT), same dedup-by-orderNo,
// same 3-value status rule (cancelled/completed/active, PART 5 - never a 4th invented state).
// Exposes `clientId` (which allProjectFiles()'s own narrower return type omits) since client
// analytics needs a stable identifier, never a freeform-name-only grouping (PART 10).
async function insightsProjectFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<InsightsProjectFile[]> {
  const { data } = await supabase
    .from("quotations")
    .select("id,layout_settings")
    .order("created_at", { ascending: false })
    .limit(PROJECT_FILE_SCAN_LIMIT)
    .returns<InsightsProjectFileLayoutRow[]>();

  const seen = new Set<string>();
  const orders: InsightsProjectFile[] = [];
  for (const quotation of data ?? []) {
    const settings = quotation.layout_settings as Record<string, unknown> | null;
    const cancelledAt = typeof settings?.projectCancelledAt === "string" ? settings.projectCancelledAt : null;
    const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
    const order = projectFileFromLayoutSettings(quotation.layout_settings) ??
      clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
    if (!order || seen.has(order.orderNo)) continue;
    seen.add(order.orderNo);
    orders.push({
      clientId: order.clientId,
      clientName: order.clientName,
      currency: order.currency,
      orderNo: order.orderNo,
      status: cancelledAt ? "cancelled" : completedAt ? "completed" : "active",
      total: order.total,
    });
  }
  return orders;
}

type ProjectFileAggregate = {
  activeCount: number;
  activeTotalsByCurrency: Map<string, number>;
  byClient: Map<string, { clientName: string; count: number; totalsByCurrency: Map<string, number> }>;
  cancelledCount: number;
  cancelledTotalsByCurrency: Map<string, number>;
  completedCount: number;
  completedTotalsByCurrency: Map<string, number>;
  totalCount: number;
  totalsByCurrency: Map<string, number>;
};

// N2C2 PART 4/6/13: pure in-memory aggregation over the already-fetched Project File rows - never
// a second query. Value is the Project File's own already-established `total`/`currency` (PART 6 -
// the same snapshot every other Project File caller treats as authoritative), never procurement/
// invoice/payment totals, never converted across currencies.
function buildProjectFileAggregate(orders: InsightsProjectFile[]): ProjectFileAggregate {
  const activeTotalsByCurrency = new Map<string, number>();
  const completedTotalsByCurrency = new Map<string, number>();
  const cancelledTotalsByCurrency = new Map<string, number>();
  const totalsByCurrency = new Map<string, number>();
  const byClient = new Map<string, { clientName: string; count: number; totalsByCurrency: Map<string, number> }>();
  let activeCount = 0;
  let completedCount = 0;
  let cancelledCount = 0;

  for (const order of orders) {
    totalsByCurrency.set(order.currency, (totalsByCurrency.get(order.currency) ?? 0) + order.total);
    if (order.status === "active") {
      activeCount += 1;
      activeTotalsByCurrency.set(order.currency, (activeTotalsByCurrency.get(order.currency) ?? 0) + order.total);
    } else if (order.status === "completed") {
      completedCount += 1;
      completedTotalsByCurrency.set(order.currency, (completedTotalsByCurrency.get(order.currency) ?? 0) + order.total);
    } else {
      cancelledCount += 1;
      cancelledTotalsByCurrency.set(order.currency, (cancelledTotalsByCurrency.get(order.currency) ?? 0) + order.total);
    }

    const client = byClient.get(order.clientId) ?? { clientName: order.clientName, count: 0, totalsByCurrency: new Map<string, number>() };
    client.count += 1;
    client.totalsByCurrency.set(order.currency, (client.totalsByCurrency.get(order.currency) ?? 0) + order.total);
    byClient.set(order.clientId, client);
  }

  return { activeCount, activeTotalsByCurrency, byClient, cancelledCount, cancelledTotalsByCurrency, completedCount, completedTotalsByCurrency, totalCount: orders.length, totalsByCurrency };
}

// N2C2 PART 2/18: corrected to read from ERP Project Files (insightsProjectFiles()) instead of the
// standalone `projects` table, which C0 proved is empty and not authoritative for this concept.
// Same public phrase ("project summary") and `kind` - this is a bug fix, not a new feature/route.
async function projectSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const orders = await insightsProjectFiles(supabase);
  const aggregate = buildProjectFileAggregate(orders);
  const statusText = `${aggregate.activeCount} active, ${aggregate.completedCount} completed, ${aggregate.cancelledCount} cancelled`;

  return {
    data: {
      activeCount: aggregate.activeCount,
      cancelledCount: aggregate.cancelledCount,
      completedCount: aggregate.completedCount,
      kind: "insights_project_summary",
      totalCount: aggregate.totalCount,
      deterministicText: `ERP Project Files: ${aggregate.totalCount} total - ${statusText}.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from ERP Project File records", type: "insights" }],
  };
}

// N2C2 PART 7: richer multi-line rendering of the SAME aggregate projectSummaryAnswer() uses -
// never a second scan. Status rows with a zero count are still shown (stable keys/shape, matching
// C1's own quotation_analytics convention) rather than conditionally omitted.
async function projectFileAnalyticsAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const orders = await insightsProjectFiles(supabase);
  const aggregate = buildProjectFileAggregate(orders);

  if (aggregate.totalCount === 0) {
    return {
      data: {
        kind: "insights_project_file_analytics",
        totalCount: 0,
        deterministicOnly: true,
        deterministicText: "I found no ERP Project Files.",
      },
      ok: true,
      sources: [{ label: "Insights · Calculated from ERP Project File records", type: "insights" }],
    };
  }

  const deterministicText = [
    "Project File analytics",
    "",
    `${aggregate.totalCount} Project File${aggregate.totalCount === 1 ? "" : "s"}`,
    `${aggregate.activeCount} active`,
    `${aggregate.completedCount} completed`,
    `${aggregate.cancelledCount} cancelled`,
    "",
    "Active Project File value",
    formatCurrencyLines(aggregate.activeTotalsByCurrency),
    "",
    "Completed Project File value",
    formatCurrencyLines(aggregate.completedTotalsByCurrency),
  ].join("\n");

  return {
    data: {
      activeCount: aggregate.activeCount,
      activeTotalsByCurrency: Object.fromEntries(aggregate.activeTotalsByCurrency),
      cancelledCount: aggregate.cancelledCount,
      cancelledTotalsByCurrency: Object.fromEntries(aggregate.cancelledTotalsByCurrency),
      completedCount: aggregate.completedCount,
      completedTotalsByCurrency: Object.fromEntries(aggregate.completedTotalsByCurrency),
      kind: "insights_project_file_analytics",
      totalCount: aggregate.totalCount,
      deterministicOnly: true,
      deterministicText,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from ERP Project File records", type: "insights" }],
  };
}

// N2C2 PART 8: a fixed, deterministic refusal - no query, no fabricated count. C0 proved no
// authoritative ERP Project File on-hold status exists; the standalone `projects.project_status`
// enum's "on_hold" value belongs to a different, unrelated, currently-empty table.
async function projectFileOnHoldUnsupportedAnswer(): Promise<NoaCapabilityResult> {
  return {
    data: {
      kind: "insights_project_file_on_hold_unsupported",
      deterministicOnly: true,
      deterministicText: "ERP Project Files do not currently have an authoritative on-hold status in ProjectWorkflow.",
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from ERP Project File records", type: "insights" }],
  };
}

type PriceScanTemplateRow = {
  brand_id: string;
  created_at: string | null;
  id: string;
  last_price_checked_at: string | null;
  price_check_interval_days: number | null;
  template_name: string;
};
type PriceScanBrandRow = { id: string; last_price_list_checked_at: string | null; name: string };
type PriceScanBrandUpdateRow = { brand_id: string; created_at: string | null; effective_from: string | null; received_at: string | null; status: string; title: string | null };

// PART 7: reuses productTemplatePriceCheckState() per template - the exact same rule set the
// Price capability and Product Management price badges use, never reimplemented here. Gated by
// requireProductLibraryManager() in the entry point before this ever runs.
async function productPriceSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const { data, count } = await supabase
    .from("product_templates")
    .select("id,template_name,brand_id,created_at,last_price_checked_at,price_check_interval_days", { count: "exact" })
    .eq("is_active", true)
    .order("template_name", { ascending: true })
    .limit(MAX_PRICE_SCAN)
    .returns<PriceScanTemplateRow[]>();

  const templates = data ?? [];
  const totalMatching = count ?? templates.length;
  const scanCapped = totalMatching > templates.length;

  if (templates.length === 0) {
    return {
      data: { kind: "insights_product_price_summary", scanCapped: false, statusCounts: {}, totalMatching: 0, deterministicText: "There are no active product templates to check price status for." },
      ok: true,
      sources: [{ label: "Insights · Calculated from authorized product price status", type: "insights" }],
    };
  }

  const brandIds = Array.from(new Set(templates.map((template) => template.brand_id)));
  const [{ data: brandRows }, { data: updateRows }] = await Promise.all([
    supabase.from("brands").select("id,name,last_price_list_checked_at").in("id", brandIds).returns<PriceScanBrandRow[]>(),
    supabase.from("brand_price_list_updates").select("brand_id,title,effective_from,received_at,created_at,status").in("brand_id", brandIds).in("status", ["draft", "active"]).returns<PriceScanBrandUpdateRow[]>(),
  ]);
  const brandsById = new Map((brandRows ?? []).map((row) => [row.id, row]));
  const updatesByBrand = new Map<string, PriceScanBrandUpdateRow[]>();
  for (const update of updateRows ?? []) {
    updatesByBrand.set(update.brand_id, [...(updatesByBrand.get(update.brand_id) ?? []), update]);
  }

  const formatDate = (value: string | null) => value ?? "unknown date";
  const statusCounts = new Map<ProductPriceCheckState["key"], number>();
  for (const template of templates) {
    const brandRow = brandsById.get(template.brand_id);
    const latestUpdate = latestBrandPriceListUpdate(updatesByBrand.get(template.brand_id) ?? []);
    const baseline = brandPriceBaselineDate({ fallbackCheckedAt: brandRow?.last_price_list_checked_at ?? null, latestBrandPriceListUpdate: latestUpdate });
    const status = productTemplatePriceCheckState({ brandPriceBaselineAt: baseline, formatDate, latestBrandPriceListUpdate: latestUpdate, template });
    statusCounts.set(status.key, (statusCounts.get(status.key) ?? 0) + 1);
  }

  const needsCheck = statusCounts.get("needs_check") ?? 0;
  const due = statusCounts.get("due") ?? 0;
  const capNote = scanCapped ? ` (based on the ${templates.length} of ${totalMatching} templates scanned)` : "";

  return {
    data: {
      kind: "insights_product_price_summary",
      scanCapped,
      statusCounts: Object.fromEntries(statusCounts),
      totalMatching,
      deterministicText: `${needsCheck} product template${needsCheck === 1 ? "" : "s"} need price checking and ${due} ${due === 1 ? "is" : "are"} due for a recheck${capNote}.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized product price status", type: "insights" }],
  };
}

// PART 8/N2C2 PART 3: identity/lifecycle counts only - never contact data. `projectCount`
// corrected to count ERP Project Files (insightsProjectFiles()) instead of the standalone
// `projects` table - same bug fix as projectSummaryAnswer() above; active/archived client
// semantics are completely unchanged.
async function clientSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const [{ count: activeCount }, { count: archivedCount }, orders] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_active", false),
    insightsProjectFiles(supabase),
  ]);

  const active = activeCount ?? 0;
  const archived = archivedCount ?? 0;
  const projects = orders.length;

  return {
    data: {
      activeClients: active,
      archivedClients: archived,
      kind: "insights_client_summary",
      projectCount: projects,
      deterministicText: `There are ${active} active client${active === 1 ? "" : "s"} and ${archived} archived, across ${projects} ERP Project File${projects === 1 ? "" : "s"}.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized client records", type: "insights" }],
  };
}

type ClientQuotationRow = { client_id: string | null; currency: string; grand_total: number; status: string };

type ClientQuotationAggregate = {
  byClient: Map<string, { confirmedTotalsByCurrency: Map<string, number>; count: number; totalsByCurrency: Map<string, number> }>;
  scanCapped: boolean;
  totalMatching: number;
};

// N2C2 PART 10/11/12/16: an all-time (not date-scoped) bounded, active-only quotations scan for
// client ranking - same MAX_QUOTATION_SCAN bound and `grand_total`/`client_confirmed` authority as
// C1's quotation aggregate, just grouped by client_id instead of by month. No date filter, since
// none of the target client-analytics questions are period-scoped.
async function clientQuotationAggregate(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ClientQuotationAggregate> {
  const { data, count } = await supabase
    .from("quotations")
    .select("client_id,currency,grand_total,status", { count: "exact" })
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_QUOTATION_SCAN)
    .returns<ClientQuotationRow[]>();

  const rows = data ?? [];
  const totalMatching = count ?? rows.length;
  const scanCapped = totalMatching > rows.length;

  const byClient = new Map<string, { confirmedTotalsByCurrency: Map<string, number>; count: number; totalsByCurrency: Map<string, number> }>();
  for (const row of rows) {
    if (!row.client_id) continue;
    const entry = byClient.get(row.client_id) ?? { confirmedTotalsByCurrency: new Map<string, number>(), count: 0, totalsByCurrency: new Map<string, number>() };
    entry.count += 1;
    entry.totalsByCurrency.set(row.currency, (entry.totalsByCurrency.get(row.currency) ?? 0) + (row.grand_total ?? 0));
    if (row.status === "client_confirmed") {
      entry.confirmedTotalsByCurrency.set(row.currency, (entry.confirmedTotalsByCurrency.get(row.currency) ?? 0) + (row.grand_total ?? 0));
    }
    byClient.set(row.client_id, entry);
  }

  return { byClient, scanCapped, totalMatching };
}

type ClientNameRow = { company_name: string; id: string };

// N2C2 PART 14: a bounded id->name lookup, scoped to only the client ids the already-bounded
// quotation scan actually returned - never a whole-table clients read, never purely-for-display
// scope creep (PART 21 - required here because `quotations` itself has no name column, only
// client_id).
async function clientNamesById(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientIds: string[],
): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const { data } = await supabase.from("clients").select("id,company_name").in("id", clientIds).returns<ClientNameRow[]>();
  return new Map((data ?? []).map((row) => [row.id, row.company_name]));
}

type ClientRankingMetric = "confirmed_value" | "project_value" | "quotation_count" | "quotation_value";

// N2C2 PART 14: re-derives which metric was asked for directly from the message - a small,
// deterministic, closed-set check (never a fuzzy/free-text interpretation), mirroring the same
// phrasing insightsQuestionKind() already used to route here in the first place.
function clientRankingMetric(message: string): ClientRankingMetric {
  const normalized = message.toLowerCase();
  if (/\bconfirmed value\b/.test(normalized)) return "confirmed_value";
  if (/\bproject(?:\s*file)? value\b/.test(normalized)) return "project_value";
  if (/\bhow many quotations does each client have\b/.test(normalized)) return "quotation_count";
  return "quotation_value";
}

// N2C2 PART 15: groups already-aggregated per-client totals by CURRENCY first, then sorts
// descending within each currency group independently - never one combined cross-currency figure.
function rankClientsByCurrency(
  entries: Array<{ clientId: string; totalsByCurrency: Map<string, number> }>,
  namesById: Map<string, string>,
): Array<{ currency: string; rows: Array<{ clientName: string; value: number }> }> {
  const byCurrency = new Map<string, Array<{ clientName: string; value: number }>>();
  for (const entry of entries) {
    const clientName = namesById.get(entry.clientId) ?? entry.clientId;
    for (const [currency, value] of entry.totalsByCurrency.entries()) {
      const list = byCurrency.get(currency) ?? [];
      list.push({ clientName, value });
      byCurrency.set(currency, list);
    }
  }
  return Array.from(byCurrency.entries()).map(([currency, rows]) => ({
    currency,
    rows: rows.sort((a, b) => b.value - a.value).slice(0, MAX_CLIENT_RANKING_ROWS),
  }));
}

// N2C2 PART 10/12/13/14/16: one deterministic ranking answer for all 4 client-ranking phrasings -
// quotation_count is currency-independent (a plain sorted list); the other 3 metrics are ranked
// per-currency (PART 15, never combined). Project-value ranking reuses ERP Project Files' own
// already-known clientName (no extra lookup); quotation-based rankings resolve names via the
// bounded clientNamesById() lookup, since `quotations` itself carries no name column.
async function clientRankingAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const metric = clientRankingMetric(message);
  const [quotationAggregate, orders] = await Promise.all([clientQuotationAggregate(supabase), insightsProjectFiles(supabase)]);
  const projectAggregate = buildProjectFileAggregate(orders);

  if (metric === "quotation_count") {
    const clientIds = Array.from(quotationAggregate.byClient.keys());
    const namesById = await clientNamesById(supabase, clientIds);
    const rows = clientIds
      .map((clientId) => ({ clientName: namesById.get(clientId) ?? clientId, count: quotationAggregate.byClient.get(clientId)!.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CLIENT_RANKING_ROWS);

    const deterministicText = rows.length === 0
      ? "I found no recorded quotations to count by client."
      : ["Quotations per client", "", ...rows.map((row, index) => `${index + 1}. ${row.clientName} — ${row.count}`)].join("\n");

    return {
      data: { kind: "insights_client_ranking", metric, rows, deterministicOnly: true, deterministicText },
      ok: true,
      sources: [{ label: "Insights · Calculated from authorized quotation records", type: "insights" }],
    };
  }

  const entries = metric === "project_value"
    ? Array.from(projectAggregate.byClient.entries()).map(([clientId, value]) => ({ clientId, totalsByCurrency: value.totalsByCurrency }))
    : Array.from(quotationAggregate.byClient.entries()).map(([clientId, value]) => ({
        clientId,
        totalsByCurrency: metric === "confirmed_value" ? value.confirmedTotalsByCurrency : value.totalsByCurrency,
      }));

  const namesById = metric === "project_value"
    ? new Map(Array.from(projectAggregate.byClient.entries()).map(([clientId, value]) => [clientId, value.clientName]))
    : await clientNamesById(supabase, entries.map((entry) => entry.clientId));

  const rankings = rankClientsByCurrency(entries, namesById);
  const label = metric === "confirmed_value"
    ? "Top clients by confirmed value"
    : metric === "project_value"
      ? "Top clients by project value"
      : "Top clients by quotation value";

  const deterministicText = rankings.length === 0
    ? `I found no recorded ${metric === "project_value" ? "Project File" : "quotation"} value to rank clients by.`
    : [
        label,
        ...rankings.flatMap((group) => [
          "",
          group.currency,
          ...group.rows.map((row, index) => `${index + 1}. ${row.clientName} — ${group.currency} ${row.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`),
        ]),
      ].join("\n");

  return {
    data: {
      kind: "insights_client_ranking",
      metric,
      rankings: rankings.map((group) => ({ currency: group.currency, rows: group.rows })),
      deterministicOnly: true,
      deterministicText,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized quotation and ERP Project File records", type: "insights" }],
  };
}

type ProcurementLayoutRow = { layout_settings: unknown };

// PART 9: mirrors the Procurement capability's own active/completed resolution exactly (order
// status comes only from quotations.layout_settings, never from vendor step counters) - gated by
// requireProcurementManager() in the entry point before this ever runs.
async function procurementSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const { data } = await supabase.from("quotations").select("layout_settings").returns<ProcurementLayoutRow[]>();

  const orderNosSeen = new Set<string>();
  let active = 0;
  let completed = 0;

  for (const quotation of data ?? []) {
    const settings = quotation.layout_settings as Record<string, unknown> | null;
    const cancelledAt = typeof settings?.projectCancelledAt === "string" ? settings.projectCancelledAt : null;
    if (cancelledAt) continue;
    const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
    const order = projectFileFromLayoutSettings(quotation.layout_settings) ??
      clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
    if (!order || orderNosSeen.has(order.orderNo)) continue;
    orderNosSeen.add(order.orderNo);
    if (completedAt) completed += 1;
    else active += 1;
  }

  return {
    data: {
      active,
      completed,
      kind: "insights_procurement_summary",
      deterministicText: `There are ${active} active and ${completed} completed procurement order${active + completed === 1 ? "" : "s"}.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized procurement orders", type: "insights" }],
  };
}

// PART 10: cross-domain overview - each subsection preserves its own domain's permission gate.
// A permission gap never fails the whole overview; that subsection's line simply says so.
async function overviewAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const quotationResult = await quotationSummaryAnswer(supabase, "");
  const projectResult = await projectSummaryAnswer(supabase);
  const clientResult = await clientSummaryAnswer(supabase);

  let productPriceLine = "Product price status: unavailable with your current permissions.";
  try {
    await requireProductLibraryManager();
    const result = await productPriceSummaryAnswer(supabase);
    if (result.ok) productPriceLine = (result.data as { deterministicText: string }).deterministicText;
  } catch (error) {
    if (!isNextRedirectError(error)) throw error;
  }

  let procurementLine = "Procurement: unavailable with your current permissions.";
  try {
    await requireProcurementManager();
    const result = await procurementSummaryAnswer(supabase);
    if (result.ok) procurementLine = (result.data as { deterministicText: string }).deterministicText;
  } catch (error) {
    if (!isNextRedirectError(error)) throw error;
  }

  const quotationLine = quotationResult.ok ? (quotationResult.data as { deterministicText: string }).deterministicText : quotationResult.message;
  const projectLine = projectResult.ok ? (projectResult.data as { deterministicText: string }).deterministicText : projectResult.message;
  const clientLine = clientResult.ok ? (clientResult.data as { deterministicText: string }).deterministicText : clientResult.message;

  return {
    data: {
      kind: "insights_overview",
      sections: {
        client: clientLine,
        procurement: procurementLine,
        productPrice: productPriceLine,
        project: projectLine,
        quotation: quotationLine,
      },
      deterministicText: [
        `Quotations: ${quotationLine}`,
        `Projects: ${projectLine}`,
        `Clients: ${clientLine}`,
        `Product price status: ${productPriceLine}`,
        `Procurement: ${procurementLine}`,
      ].join(" "),
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from your authorized ProjectWorkflow records", type: "insights" }],
  };
}

// PART 2 entry point: requireActiveUser() gates the overview and Quotation/Project/Client
// sections; Product/Price and Procurement additionally require their own existing capability gate
// before their data is ever read - Insights never broadens access beyond what each domain already
// allows the caller. No writes anywhere in this file, no cross-capability chaining.
export async function fetchNoaInsightsCapability(
  message: string,
  _context: NoaPageContext,
): Promise<NoaCapabilityResult> {
  try {
    await requireActiveUser();
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  const supabase = await createClient();
  const kind = insightsQuestionKind(message);

  if (kind === "quotation_summary") return quotationSummaryAnswer(supabase, message);
  if (kind === "quotation_trend") return quotationTrendAnswer(supabase);
  if (kind === "quotation_analytics") return quotationAnalyticsAnswer(supabase, message);
  if (kind === "quotation_compare") return quotationCompareAnswer(supabase);
  if (kind === "quotation_conversion_rate") return quotationRateDefinitionRequiredAnswer();
  if (kind === "project_summary") return projectSummaryAnswer(supabase);
  if (kind === "project_file_analytics") return projectFileAnalyticsAnswer(supabase);
  if (kind === "project_file_on_hold_unsupported") return projectFileOnHoldUnsupportedAnswer();
  if (kind === "client_summary") return clientSummaryAnswer(supabase);
  if (kind === "client_ranking") return clientRankingAnswer(supabase, message);

  if (kind === "product_price_summary") {
    try {
      await requireProductLibraryManager();
    } catch (error) {
      if (isNextRedirectError(error)) return PRODUCT_PRICE_UNAUTHORIZED_RESULT;
      throw error;
    }
    return productPriceSummaryAnswer(supabase);
  }

  if (kind === "procurement_summary") {
    try {
      await requireProcurementManager();
    } catch (error) {
      if (isNextRedirectError(error)) return PROCUREMENT_UNAUTHORIZED_RESULT;
      throw error;
    }
    return procurementSummaryAnswer(supabase);
  }

  return overviewAnswer(supabase);
}
