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
const PROJECT_STATUSES = ["active", "on_hold", "completed", "cancelled"] as const;

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
  | "client_summary"
  | "overview"
  | "procurement_summary"
  | "product_price_summary"
  | "project_summary"
  | "quotation_summary"
  | "quotation_trend";

// PART 3: deterministic classification only - trend before plain summary (so "quotation trend"
// doesn't fall into quotation_summary), domain noun otherwise decides the section, "overview" as
// the final default for a general/business-summary phrasing.
function insightsQuestionKind(message: string): InsightsQuestionKind {
  const normalized = message.toLowerCase();
  if (/\btrend\b/.test(normalized) && /\bquotations?\b/.test(normalized)) return "quotation_trend";
  if (/\bquotations?\b/.test(normalized)) return "quotation_summary";
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
function formatCurrencyTotals(totalsByCurrency: Map<string, number>): string {
  if (totalsByCurrency.size === 0) return "no value recorded";
  return Array.from(totalsByCurrency.entries())
    .map(([currency, total]) => `${currency} ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
    .join(", ");
}

type QuotationInsightRow = { created_at: string; currency: string; grand_total: number; status: string };

async function quotationSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = insightsDateRangeKey(message);
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
  const confirmedTotalsByCurrency = new Map<string, number>();
  let confirmedCount = 0;

  for (const row of rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    totalsByCurrency.set(row.currency, (totalsByCurrency.get(row.currency) ?? 0) + (row.grand_total ?? 0));
    if (row.status === "client_confirmed") {
      confirmedCount += 1;
      confirmedTotalsByCurrency.set(row.currency, (confirmedTotalsByCurrency.get(row.currency) ?? 0) + (row.grand_total ?? 0));
    }
  }

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

// PART 6: exact 4-value project_status vocabulary; is_active (archive state) kept as a fully
// separate, independently-computed fact - never merged with status counts.
async function projectSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const [statusResults, listedResult, archivedResult] = await Promise.all([
    Promise.all(PROJECT_STATUSES.map((status) =>
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("project_status", status),
    )),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("is_active", false),
  ]);

  const statusCounts = PROJECT_STATUSES.map((status, index) => ({ count: statusResults[index].count ?? 0, status }));
  const listed = listedResult.count ?? 0;
  const archived = archivedResult.count ?? 0;
  const statusText = statusCounts.map((entry) => `${entry.count} ${entry.status.replace("_", " ")}`).join(", ");

  return {
    data: {
      archived,
      kind: "insights_project_summary",
      listed,
      statusCounts: Object.fromEntries(statusCounts.map((entry) => [entry.status, entry.count])),
      deterministicText: `Project records by status: ${statusText}. ${listed} listed and ${archived} archived.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from project records", type: "insights" }],
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

// PART 8: identity/lifecycle counts only - never contact data.
async function clientSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NoaCapabilityResult> {
  const [{ count: activeCount }, { count: archivedCount }, { count: projectCount }] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("projects").select("id", { count: "exact", head: true }),
  ]);

  const active = activeCount ?? 0;
  const archived = archivedCount ?? 0;
  const projects = projectCount ?? 0;

  return {
    data: {
      activeClients: active,
      archivedClients: archived,
      kind: "insights_client_summary",
      projectCount: projects,
      deterministicText: `There are ${active} active client${active === 1 ? "" : "s"} and ${archived} archived, across ${projects} project record${projects === 1 ? "" : "s"}.`,
    },
    ok: true,
    sources: [{ label: "Insights · Calculated from authorized client records", type: "insights" }],
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
  if (kind === "project_summary") return projectSummaryAnswer(supabase);
  if (kind === "client_summary") return clientSummaryAnswer(supabase);

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
