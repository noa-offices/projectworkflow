import "server-only";

import {
  buildNoaRouteDiagnostics,
  classifyNoaRoute,
  classifyNoaRouteWithStrength,
  decideNoaSemanticV2Outcome,
  describeNoaPageContext,
  entityLookupCandidate,
  greetingResponseText,
  isNoaGenericSemanticCandidate,
  isNoaRouteDiagnosticsEnabled,
  isNoaSemanticV2FlagEnabled,
  NOA_CAPABILITY_SUMMARY_TEXT,
  noaSemanticV2Eligibility,
  recordedQuotationFollowUpReference,
  type NoaRouteClassification,
  type NoaRouteDiagnostics,
  type NoaSemanticV2Decision,
  type NoaSemanticV2Eligibility,
  type NoaSemanticV2ProtectedReason,
} from "@/lib/noa/noa-intent-router";
import { extractNoaSemanticRequest, extractNoaSemanticRequestV2, type NoaIntentExtractorV2Result } from "@/lib/noa/noa-intent-extractor.server";
import {
  bindNoaConversationFollowUp,
  boundConversationReferenceEntities,
  buildNoaInsightsConversationReference,
  buildNoaReferenceDiagnostics,
  detectNoaFollowUpCues,
  isNoaBindableConversationReference,
  isNoaConversationFollowUpCandidate,
  isNoaConversationReference,
  noaCurrentPageEntity,
  sanitizeNoaConversationReference,
  type NoaConversationReference,
} from "@/lib/noa/noa-conversation-reference";
import { resolveNoaConversationFollowUp, validateNoaSemanticCompatibility } from "@/lib/noa/noa-semantic-resolver";
import type { NoaSemanticIntent, NoaSemanticRequest } from "@/lib/noa/noa-semantic-request";
import { resolveNoaSemanticPeriod, resolveNoaSemanticSubject } from "@/lib/noa/noa-subject-resolver";
import { fetchNoaAdminCapability } from "@/lib/noa/noa-admin-capability.server";
import { fetchNoaAttentionCapability, type NoaAttentionItem } from "@/lib/noa/noa-attention-capability.server";
import { fetchNoaClientCapability } from "@/lib/noa/noa-client-capability.server";
import { fetchNoaInsightsCapability } from "@/lib/noa/noa-insights-capability.server";
import { fetchNoaPriceCapability } from "@/lib/noa/noa-price-capability.server";
import { fetchNoaProcurementCapability } from "@/lib/noa/noa-procurement-capability.server";
import { fetchNoaProductCapability, resolveNoaProductCandidate } from "@/lib/noa/noa-product-capability.server";
import { fetchNoaProjectCapability, projectFileIdentifierCount, projectFileIdentifierFromMessage, resolveNoaEntityCandidate } from "@/lib/noa/noa-project-capability.server";
import { fetchNoaQuotationCapability, quotationIdentifierCount, quotationStructuredRequest } from "@/lib/noa/noa-quotation-capability.server";
import { fetchNoaUserActivityCapability } from "@/lib/noa/noa-user-activity-capability.server";
import type { NoaAnalyticsTransport, NoaAnswer, NoaChatRequest, NoaChoice, NoaDomain, NoaPageContext } from "@/lib/noa/noa-types";
import { runNoaProvider } from "@/lib/noa/noa-provider.server";
// GPC-3: the ONLY configuration-state engine (GPC-1) and the ONLY single-template loader (GPC-2) -
// this file never reimplements auto-resolution/pricing/compatibility rules, it only calls them.
import {
  resolveProductConfigurationState,
  type ProductConfigurationOption,
  type ProductConfigurationState,
  type ProductConfigurationStep,
  type ProductConfigurationTemplateInput,
} from "@/lib/products/product-configuration-state";
import { loadProductConfigurationTemplate, type ProductConfigurationTemplateLoadResult } from "@/lib/products/product-configuration-loader.server";
import {
  isNoaProductConfigurationReference,
  type NoaProductConfigurationReference,
  type NoaProductConfigurationSelections,
} from "@/lib/noa/noa-product-configuration-reference";

// C2: the only 3 UserActivity semantic intents wired to that capability (recorded UserActivity,
// ProjectWorkflow active time, recent-presence-style questions). "follow_up"/"unsupported" for
// UserActivity are deliberately left unhandled by this set - the existing deterministic
// router/fallback owns everything else. Quotation (C4A, below) is intent-agnostic and uses its
// own, separate domain-only check, since that capability re-derives its own question kind from
// the message text regardless of which intent value the extractor picked.
const SUPPORTED_SEMANTIC_INTENTS: ReadonlySet<NoaSemanticIntent> = new Set([
  "activity_time",
  "recorded_activity",
  "recent_presence",
]);

// Conversation polish: a short clarification for an unclear/off-topic request - NOT a capability
// list. The capability list is shown only for the separate, explicit "capabilities" route above
// (NOA_CAPABILITY_SUMMARY_TEXT); repeating it here on every unclear message was the stale,
// stiff-feeling fallback this replaces.
const HELP_ANSWER_TEXT =
  "I'm not sure what you'd like me to check. Try asking about a product, quotation, project, activity, or another ProjectWorkflow area.";

// C3: narrow, fixed phrase classes for exactly the 2 follow-up shapes wired below (PART 6) - not
// a growing regex framework, just the deterministic "is this message a follow-up" signal used
// alongside (never instead of) the extractor's own "follow_up" intent classification.
const QUOTATION_FOLLOW_UP_PATTERN = /\bwhich quot|\bwhat quot|\bwhich quote\b/i;
const PERIOD_FOLLOW_UP_PATTERN = /\bwhat about (?:yesterday|today|this week)\b/i;
const DURATION_FOLLOW_UP_PATTERN = /^how long\??$/i;

// C4B: a pronoun that stands in for the previously-referenced project ("it"/"that project"/"this
// project") - the only Project follow-up shape that needs the entity substituted back in before
// the capability's own existing text parsing can recognize the target.
const PROJECT_PRONOUN_FOLLOW_UP_PATTERN = /\b(it|that project|this project)\b/i;

// C4C: a pronoun that stands in for the previously-referenced client, and a narrow fixed class of
// bare Client follow-ups that name no pronoun or target at all ("how many projects?").
const CLIENT_PRONOUN_FOLLOW_UP_PATTERN = /\b(they|them|that client|this client)\b/i;
const CLIENT_BARE_FOLLOW_UP_PATTERN = /^(?:how many projects|what projects|projects)\??$/i;

// C4C: a Procurement order-number-shaped token, mirroring the same heuristic already used inside
// the Procurement capability's own procurementOrderTarget()/procurementQuestionKind(). Used here
// only to detect whether a follow-up message already names its own order (skip rewriting) versus
// leaning on the inherited reference.
const PROCUREMENT_ORDER_TOKEN_PATTERN = /\b[a-z]{0,4}-?\d{3,}[a-z0-9-]*\b/i;
const PROCUREMENT_FOLLOW_UP_PATTERN = /\b(eta|etd|stage|documents?|vendors?|progress)\b/i;

// C4D: a pronoun that stands in for the previously-referenced product ("it"/"that product"/"this
// product"). Unlike Project/Client, the Product/Price capabilities' own text-classification is
// entirely stopword-based (extractSearchTerm), so the rewrite below always replaces the WHOLE
// message with a short canonical "<domain keyword> <label>" phrasing rather than substituting the
// pronoun in place - the original follow-up wording is preserved for the provider's own answer
// (runNoaProvider still receives request.message, never the rewritten override), only the
// capability's target lookup needs the clean canonical form.
const PRODUCT_PRONOUN_FOLLOW_UP_PATTERN = /\b(it|that product|this product)\b/i;

// Attention structured UI: a runtime guard for the Attention capability's own `{ kind: "attention",
// count, items }` data shape - never trusts `capabilityResult.data` (typed `unknown`) blindly.
// This is the ONLY place the orchestrator reads Attention's structured items; every other domain's
// capabilityData continues to reach the provider (or the deterministicOnly text path) exactly as
// before.
type NoaAttentionCapabilityData = { count: number; items: NoaAttentionItem[]; kind: "attention" };

function isAttentionCapabilityData(data: unknown): data is NoaAttentionCapabilityData {
  return Boolean(
    data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === "attention" &&
    Array.isArray((data as { items?: unknown }).items) &&
    typeof (data as { count?: unknown }).count === "number",
  );
}

// N2B3.4: a runtime guard for the Catch-Up capability's own `{ kind: "user_activity_catch_up", ...
// }` data shape (built by buildCatchUpResult() in noa-user-activity-capability.server.ts) - same
// "never trust unknown capabilityResult.data blindly" discipline as isAttentionCapabilityData()
// above. This is the ONLY place the orchestrator reads Catch-Up's structured items.
type NoaCatchUpItemData = {
  action: string;
  actorLabel?: string;
  changes?: Array<{
    field: string;
    label?: string;
    oldValue: string | number | boolean | null;
    newValue: string | number | boolean | null;
    currency?: string;
  }>;
  detail?: string;
  entityType: string;
  occurredAt: string;
  occurrenceCount?: number;
  title: string;
};

type NoaCatchUpCapabilityData = {
  entityIdentifier?: string;
  items: NoaCatchUpItemData[];
  kind: "user_activity_catch_up";
  returnedCount: number;
  totalMatching: number;
  truncatedCount: number;
};

function isCatchUpCapabilityData(data: unknown): data is NoaCatchUpCapabilityData {
  return Boolean(
    data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === "user_activity_catch_up" &&
    Array.isArray((data as { items?: unknown }).items) &&
    typeof (data as { returnedCount?: unknown }).returnedCount === "number" &&
    typeof (data as { totalMatching?: unknown }).totalMatching === "number" &&
    typeof (data as { truncatedCount?: unknown }).truncatedCount === "number",
  );
}

// N2B3.4 PART 12: the exact sentinel noa-user-activity-capability.server.ts's own
// UNRESOLVED_ACTOR_LABEL constant uses - never displayed (PART 12: "Do NOT show 'Unresolved
// user'"), so an item whose actorLabel equals this is treated as having no safe actor to show.
const CATCH_UP_UNRESOLVED_ACTOR_LABEL = "Unresolved user";

// N2C1.1: presentation-only guards for the C1 Insights capability's already-existing structured
// `data` shapes (built by noa-insights-capability.server.ts, NOT modified by this phase) - same
// "never trust unknown capabilityResult.data blindly" discipline as isAttentionCapabilityData()/
// isCatchUpCapabilityData() above. Deliberately narrower than the full data shape (only the
// fields actually needed for the card transport) - the empty-result variant of
// insights_quotation_analytics omits totalsByCurrency/statusCounts/etc entirely, so those stay
// optional here and are handled as the empty-state case below.
type NoaQuotationAnalyticsData = {
  averageByCurrency?: Record<string, number>;
  confirmedCount?: number;
  confirmedTotalsByCurrency?: Record<string, number>;
  kind: "insights_quotation_analytics";
  range: string;
  statusCounts?: Record<string, number>;
  totalMatching: number;
  totalsByCurrency?: Record<string, number>;
  deterministicText: string;
};

function isQuotationAnalyticsData(data: unknown): data is NoaQuotationAnalyticsData {
  return Boolean(
    data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === "insights_quotation_analytics" &&
    typeof (data as { totalMatching?: unknown }).totalMatching === "number" &&
    typeof (data as { deterministicText?: unknown }).deterministicText === "string",
  );
}

type NoaQuotationCompareData = {
  current: { count: number; totalsByCurrency: Record<string, number> };
  kind: "insights_quotation_compare";
  previous: { count: number; totalsByCurrency: Record<string, number> };
};

function isQuotationCompareData(data: unknown): data is NoaQuotationCompareData {
  const candidate = data as { current?: unknown; kind?: unknown; previous?: unknown } | null;
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    candidate.kind === "insights_quotation_compare" &&
    candidate.current && typeof candidate.current === "object" &&
    candidate.previous && typeof candidate.previous === "object",
  );
}

type NoaQuotationTrendData = {
  currency: string | null;
  kind: "insights_quotation_trend";
  monthCount: number;
  months: Array<{ count: number; month: string; total: number | null }>;
};

function isQuotationTrendData(data: unknown): data is NoaQuotationTrendData {
  return Boolean(
    data &&
    typeof data === "object" &&
    (data as { kind?: unknown }).kind === "insights_quotation_trend" &&
    Array.isArray((data as { months?: unknown }).months),
  );
}

// N2C1.1: a small, closed-enum display mapping over the SAME DateRangeKey values the Insights
// capability already resolves internally (lib/insights/date-ranges.ts) - never a new business
// definition, purely a Title Case label for the analytics card header. An unmapped/custom key
// falls back to a generic humanizer, never an invented meaning.
function analyticsHumanize(value: string): string {
  return value.split(/[\s_-]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

const ANALYTICS_PERIOD_LABEL: Record<string, string> = {
  today: "Today",
  this_week: "This week",
  this_month: "This month",
  last_month: "Last month",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  this_year: "This year",
};

function analyticsPeriodLabel(range: string): string {
  return ANALYTICS_PERIOD_LABEL[range] ?? analyticsHumanize(range);
}

// N2C1.1: a LOCAL mirror of noa-insights-capability.server.ts's own two proven status overrides
// (never imported - Insights/the orchestrator's transport layer never cross-imports a capability
// module's internals; this duplicates only the two known, authorized persisted-status keys,
// exactly matching the same convention lib/noa/noa-insights-capability.server.ts's own
// insightsQuotationStatusLabel() already established).
const ANALYTICS_STATUS_LABEL: Record<string, string> = {
  draft: "Pending",
  client_confirmed: "Client Confirmed",
};

function analyticsStatusLabel(status: string): string {
  return ANALYTICS_STATUS_LABEL[status] ?? analyticsHumanize(status);
}

const ANALYTICS_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function analyticsMonthLabel(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return monthKey;
  return `${ANALYTICS_MONTH_LABELS[monthIndex]} ${match[1]}`;
}

// PART 6: multiple currencies are joined as separate lines under ONE metric label - never summed,
// never converted. The client renders each line separately (never a single merged figure).
function analyticsCurrencyLines(totalsByCurrency: Record<string, number> | undefined): string {
  const entries = Object.entries(totalsByCurrency ?? {});
  if (entries.length === 0) return "—";
  return entries.map(([currency, total]) => `${currency} ${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`).join("\n");
}

// PART 4/7/12: the empty-result variant of insights_quotation_analytics omits totalsByCurrency
// entirely (see noa-insights-capability.server.ts's own early-return for a zero-row period) -
// detected here by that field's absence, never by parsing `deterministicText`. Reuses the
// server's own already-written empty sentence verbatim as `emptyMessage` (PART 12) - never a
// client-invented empty string.
function buildQuotationAnalyticsTransport(data: NoaQuotationAnalyticsData): NoaAnalyticsTransport {
  const period = analyticsPeriodLabel(data.range);
  if (!data.totalsByCurrency) {
    return { emptyMessage: data.deterministicText, kind: "quotation_analytics", period, title: "Quotation analytics" };
  }
  const metrics = [
    { key: "count", label: "Quotations", value: String(data.totalMatching) },
    { key: "quoted_value", label: "Quoted value", value: analyticsCurrencyLines(data.totalsByCurrency) },
    { key: "average_value", label: "Average value", value: analyticsCurrencyLines(data.averageByCurrency) },
    {
      key: "confirmed_value",
      label: "Client-confirmed",
      // PART 7: an honest "no confirmed records" dash, never a financial AED 0 the server itself
      // never asserted - gated on the server's own confirmedCount, never inferred from totals.
      value: (data.confirmedCount ?? 0) > 0 ? analyticsCurrencyLines(data.confirmedTotalsByCurrency) : "—",
    },
  ];
  const statusBreakdown = Object.entries(data.statusCounts ?? {}).map(([status, count]) => ({ label: analyticsStatusLabel(status), count }));
  return { kind: "quotation_analytics", metrics, period, statusBreakdown, title: "Quotation analytics" };
}

// PART 9: current/previous labels are hardcoded "This month"/"Last month" because
// quotationCompareAnswer() itself always compares exactly these two fixed ranges (never
// parameterized) - a safe, accurate label, not a guess.
function buildQuotationCompareTransport(data: NoaQuotationCompareData): NoaAnalyticsTransport {
  const currencies = Array.from(new Set([...Object.keys(data.current.totalsByCurrency), ...Object.keys(data.previous.totalsByCurrency)]));
  const currencyRows = currencies.map((currency) => {
    const currentValue = data.current.totalsByCurrency[currency] ?? 0;
    const previousValue = data.previous.totalsByCurrency[currency] ?? 0;
    return { currency, currentValue, difference: currentValue - previousValue, previousValue };
  });
  return {
    comparison: {
      countDifference: data.current.count - data.previous.count,
      currencyRows,
      currentCount: data.current.count,
      currentLabel: "This month",
      previousCount: data.previous.count,
      previousLabel: "Last month",
    },
    kind: "quotation_compare",
    title: "Quotation comparison",
  };
}

// PART 11: zero-activity months are filtered out here (a presentation reshape of the server's own
// already-computed 12-month array, never a new calculation) - matching the deterministic text's
// own nonEmptyMonths behavior exactly.
function buildQuotationTrendTransport(data: NoaQuotationTrendData): NoaAnalyticsTransport {
  const trend = data.months
    .filter((month) => month.count > 0)
    .map((month) => ({
      count: month.count,
      ...(data.currency && month.total !== null ? { currency: data.currency, total: month.total } : {}),
      label: analyticsMonthLabel(month.month),
    }));
  return {
    ...(trend.length === 0 ? { emptyMessage: "No quotation activity recorded in this period." } : { trend }),
    kind: "quotation_trend",
    period: `Last ${data.monthCount} months`,
    title: "Quotation trend",
  };
}

// N2C2.1: presentation-only reshapes of the C2 Insights capability's already-existing structured
// `data` (insights_project_file_analytics / insights_client_ranking / insights_client_summary) -
// same "never trust unknown data blindly" guard discipline as the quotation guards above, never
// parsed from `deterministicText`, never a recomputed total. Currency maps are rendered through
// the SAME analyticsCurrencyLines() helper as C1 (one line per currency, never summed/converted).
function analyticsDataKind(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const kind = (data as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

function analyticsCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function analyticsCurrencyMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return Object.fromEntries(entries);
}

function analyticsDeterministicText(data: unknown): string {
  const text = (data as { deterministicText?: unknown }).deterministicText;
  return typeof text === "string" ? text : "";
}

function analyticsAmount(currency: string, value: number): string {
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

type NoaProjectFileAnalyticsData = {
  activeCount?: number;
  activeTotalsByCurrency?: Record<string, number>;
  cancelledCount?: number;
  completedCount?: number;
  completedTotalsByCurrency?: Record<string, number>;
  kind: "insights_project_file_analytics";
  totalCount: number;
};

// Empty variant (totalCount 0) reuses the server's own empty sentence verbatim - never zero tiles.
// Counts render as tiles and the active/completed/cancelled distribution as neutral chips; each
// value tile is the server's own per-currency map, one line per currency.
function buildProjectFileAnalyticsTransport(data: unknown): NoaAnalyticsTransport {
  const record = data as NoaProjectFileAnalyticsData;
  const title = "Project File analytics";
  if (analyticsCount(record.totalCount) === 0) {
    return { emptyMessage: analyticsDeterministicText(data) || "I found no ERP Project Files.", kind: "project_file_analytics", title };
  }
  return {
    kind: "project_file_analytics",
    metrics: [
      { key: "project_files", label: "Project Files", value: String(analyticsCount(record.totalCount)) },
      { key: "active_value", label: "Active value", value: analyticsCurrencyLines(analyticsCurrencyMap(record.activeTotalsByCurrency)) },
      { key: "completed_value", label: "Completed value", value: analyticsCurrencyLines(analyticsCurrencyMap(record.completedTotalsByCurrency)) },
    ],
    period: "ERP Project Files",
    statusBreakdown: [
      { count: analyticsCount(record.activeCount), label: "Active" },
      { count: analyticsCount(record.completedCount), label: "Completed" },
      { count: analyticsCount(record.cancelledCount), label: "Cancelled" },
    ],
    title,
  };
}

const CLIENT_RANKING_TITLE: Record<string, string> = {
  confirmed_value: "Top clients by confirmed value",
  project_value: "Top clients by project value",
  quotation_count: "Quotations per client",
  quotation_value: "Top clients by quotation value",
};

// quotation_count is a single currency-free group (plain count). Every value metric is one group
// PER currency exactly as the server ranked it - never merged, never a cross-currency "overall top
// client". Rank numbers are the server's own already-sorted order (index + 1), never re-sorted.
function buildClientRankingTransport(data: unknown): NoaAnalyticsTransport {
  const record = data as { metric?: unknown; rankings?: unknown; rows?: unknown };
  const metric = typeof record.metric === "string" ? record.metric : "quotation_value";
  const title = CLIENT_RANKING_TITLE[metric] ?? "Client analytics";
  let rankings: NonNullable<NoaAnalyticsTransport["rankings"]> = [];

  if (metric === "quotation_count") {
    const rows = Array.isArray(record.rows) ? (record.rows as Array<{ clientName?: unknown; count?: unknown }>) : [];
    const rankingRows = rows
      .filter((row) => typeof row.clientName === "string")
      .map((row, index) => ({ label: row.clientName as string, rank: index + 1, value: String(analyticsCount(row.count)) }));
    rankings = rankingRows.length ? [{ rows: rankingRows }] : [];
  } else {
    const groups = Array.isArray(record.rankings) ? (record.rankings as Array<{ currency?: unknown; rows?: unknown }>) : [];
    rankings = groups
      .filter((group) => typeof group.currency === "string" && Array.isArray(group.rows))
      .map((group) => {
        const currency = group.currency as string;
        const rows = (group.rows as Array<{ clientName?: unknown; value?: unknown }>)
          .filter((row) => typeof row.clientName === "string")
          .map((row, index) => ({ label: row.clientName as string, rank: index + 1, value: analyticsAmount(currency, analyticsCount(row.value)) }));
        return { heading: currency, rows };
      })
      .filter((group) => group.rows.length > 0);
  }

  if (rankings.length === 0) {
    return { emptyMessage: analyticsDeterministicText(data) || "I found no client records to rank.", kind: "client_analytics", period: "All time", title };
  }
  return { kind: "client_analytics", period: "All time", rankings, title };
}

// Client summary: identity/lifecycle counts only (the SAME three numbers the prose already states).
function buildClientSummaryTransport(data: unknown): NoaAnalyticsTransport {
  const record = data as { activeClients?: unknown; archivedClients?: unknown; projectCount?: unknown };
  return {
    kind: "client_analytics",
    metrics: [
      { key: "active_clients", label: "Active clients", value: String(analyticsCount(record.activeClients)) },
      { key: "archived_clients", label: "Archived clients", value: String(analyticsCount(record.archivedClients)) },
      { key: "project_files", label: "Project Files", value: String(analyticsCount(record.projectCount)) },
    ],
    title: "Client summary",
  };
}

function analyticsCountRanking(value: unknown): Array<{ label: string; rank: number; value: string }> {
  const rows = Array.isArray(value) ? (value as Array<{ count?: unknown; name?: unknown }>) : [];
  return rows
    .filter((row) => typeof row.name === "string")
    .map((row, index) => ({ label: row.name as string, rank: index + 1, value: String(analyticsCount(row.count)) }));
}

// N2C3: Product Library analytics - lifecycle count tiles, the price-status helper's own labels as
// neutral chips, and brand/category rankings as plain numeric counts (no currency, no sales figure).
function buildProductAnalyticsTransport(data: unknown): NoaAnalyticsTransport {
  const record = data as {
    activeCount?: unknown; archivedCount?: unknown; brandRanking?: unknown; categoryRanking?: unknown; discontinuedCount?: unknown;
    priceStatus?: unknown; scanCapped?: unknown; scannedCount?: unknown; scannedTotal?: unknown; totalCount?: unknown; uncategorizedCount?: unknown;
  };
  const title = "Product analytics";
  if (analyticsCount(record.totalCount) === 0) {
    return { emptyMessage: analyticsDeterministicText(data) || "There are no product templates in the Product Library yet.", kind: "product_analytics", title };
  }
  const priceRows = Array.isArray(record.priceStatus) ? (record.priceStatus as Array<{ count?: unknown; label?: unknown }>) : [];
  const brandRows = analyticsCountRanking(record.brandRanking);
  const categoryRows = analyticsCountRanking(record.categoryRanking);
  const notes = [
    record.scanCapped === true
      ? `Price status and rankings are based on the first ${analyticsCount(record.scannedCount)} of ${analyticsCount(record.scannedTotal)} active templates.`
      : "",
    analyticsCount(record.uncategorizedCount) > 0 ? `${analyticsCount(record.uncategorizedCount)} active template${analyticsCount(record.uncategorizedCount) === 1 ? " has" : "s have"} no main category.` : "",
  ].filter(Boolean);
  return {
    kind: "product_analytics",
    metrics: [
      { key: "total_products", label: "Products", value: String(analyticsCount(record.totalCount)) },
      { key: "active_products", label: "Active", value: String(analyticsCount(record.activeCount)) },
      { key: "archived_products", label: "Archived", value: String(analyticsCount(record.archivedCount)) },
      { key: "discontinued_products", label: "Discontinued", value: String(analyticsCount(record.discontinuedCount)) },
    ],
    ...(notes.length ? { note: notes.join(" ") } : {}),
    period: "Product Library",
    rankings: [
      ...(brandRows.length ? [{ heading: "Top brands by product count", rows: brandRows }] : []),
      ...(categoryRows.length ? [{ heading: "Top categories by product count", rows: categoryRows }] : []),
    ],
    statusBreakdown: priceRows
      .filter((row) => typeof row.label === "string")
      .map((row) => ({ count: analyticsCount(row.count), label: row.label as string })),
    statusLabel: "Price status",
    title,
  };
}

// N2C4: procurement analytics - order/vendor count tiles plus vendor-stage chips (the existing
// vendorStepLabel() vocabulary, already applied server-side). Counts only, no currency.
function buildProcurementAnalyticsTransport(data: unknown): NoaAnalyticsTransport {
  const record = data as {
    activeCount?: unknown; completedCount?: unknown; detailCapped?: unknown; detailOrderCount?: unknown; missingEtaCount?: unknown;
    missingEtdCount?: unknown; vendorGroupCount?: unknown; vendorStages?: unknown;
  };
  const title = "Procurement analytics";
  if (analyticsCount(record.activeCount) + analyticsCount(record.completedCount) === 0) {
    return { emptyMessage: analyticsDeterministicText(data) || "I found no procurement orders.", kind: "procurement_analytics", title };
  }
  const stages = Array.isArray(record.vendorStages) ? (record.vendorStages as Array<{ count?: unknown; label?: unknown }>) : [];
  return {
    kind: "procurement_analytics",
    metrics: [
      { key: "active_orders", label: "Active orders", value: String(analyticsCount(record.activeCount)) },
      { key: "completed_orders", label: "Completed orders", value: String(analyticsCount(record.completedCount)) },
      { key: "vendor_groups", label: "Vendor groups", value: String(analyticsCount(record.vendorGroupCount)) },
      { key: "missing_eta", label: "Missing ETA", value: String(analyticsCount(record.missingEtaCount)) },
      { key: "missing_etd", label: "Missing ETD", value: String(analyticsCount(record.missingEtdCount)) },
    ],
    note: record.detailCapped === true
      ? `Vendor figures cover the ${analyticsCount(record.detailOrderCount)} most recent active orders.`
      : "Vendor figures cover active orders.",
    statusBreakdown: stages
      .filter((row) => typeof row.label === "string")
      .map((row) => ({ count: analyticsCount(row.count), label: row.label as string })),
    statusLabel: "Vendor stages",
    title,
  };
}

function analyticsLines(value: unknown): string {
  const lines = Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : [];
  return lines.length ? lines.join("\n") : "—";
}

// N2C4: client payment analytics - only ever reached for a role the capability already let
// through canViewClientPayments(); a denied role gets an ok:false refusal and therefore no data and
// no transport at all. Amount lines are the server's own per-currency formatted strings (one line
// per currency, never summed/converted here).
function buildPaymentAnalyticsTransport(data: unknown): NoaAnalyticsTransport {
  const record = data as { outstandingLines?: unknown; overdueInstallmentCount?: unknown; overdueLines?: unknown; projectFileCount?: unknown; receivedLines?: unknown; scopeNote?: unknown };
  const title = "Client payment analytics";
  if (analyticsCount(record.projectFileCount) === 0) {
    return { emptyMessage: analyticsDeterministicText(data) || "There are no active ERP Project Files to summarize client payments for.", kind: "payment_analytics", title };
  }
  return {
    kind: "payment_analytics",
    metrics: [
      { key: "received", label: "Received", value: analyticsLines(record.receivedLines) },
      { key: "outstanding", label: "Outstanding", value: analyticsLines(record.outstandingLines) },
      { key: "overdue_amount", label: "Overdue", value: analyticsLines(record.overdueLines) },
      { key: "overdue_count", label: "Overdue instalments", value: String(analyticsCount(record.overdueInstallmentCount)) },
    ],
    ...(typeof record.scopeNote === "string" ? { note: record.scopeNote } : {}),
    period: "Active Project Files",
    title,
  };
}

function buildAnalyticsTransport(domain: NoaDomain, data: unknown): NoaAnalyticsTransport | undefined {
  if (domain !== "Insights") return undefined;
  if (isQuotationAnalyticsData(data)) return buildQuotationAnalyticsTransport(data);
  if (isQuotationCompareData(data)) return buildQuotationCompareTransport(data);
  if (isQuotationTrendData(data)) return buildQuotationTrendTransport(data);
  const kind = analyticsDataKind(data);
  if (kind === "insights_project_file_analytics") return buildProjectFileAnalyticsTransport(data);
  if (kind === "insights_client_ranking") return buildClientRankingTransport(data);
  if (kind === "insights_client_summary") return buildClientSummaryTransport(data);
  if (kind === "insights_product_analytics") return buildProductAnalyticsTransport(data);
  if (kind === "insights_procurement_analytics") return buildProcurementAnalyticsTransport(data);
  if (kind === "insights_payment_analytics") return buildPaymentAnalyticsTransport(data);
  return undefined;
}

// C3: resolves a short UserActivity follow-up (PART 6/8/9) against the client-round-tripped
// conversationReference - pure, deterministic, never touches capabilityData/recentMessages/the
// database. Returns undefined for anything outside the 2 wired follow-up shapes (quotation entity
// recall; activity_time period/subject continuation), so the caller falls back to normal routing.
// Authorization is never inherited from the reference (PART 11) - the returned request is just a
// hint that still goes through the capability's own auth gate exactly like any other request.
function resolveUserActivityFollowUp(
  message: string,
  reference: NoaConversationReference,
  extractedIntent: NoaSemanticIntent | undefined,
): NoaSemanticRequest | undefined {
  const looksLikeFollowUp = extractedIntent === "follow_up" ||
    QUOTATION_FOLLOW_UP_PATTERN.test(message) ||
    PERIOD_FOLLOW_UP_PATTERN.test(message) ||
    DURATION_FOLLOW_UP_PATTERN.test(message.trim());
  if (!looksLikeFollowUp) return undefined;

  // A: quotation entity recall - only when the previous result actually carried quotation
  // entities; never falls through to a generic Quotation list (PART 8/9).
  if (reference.intent === "recorded_activity" && (reference.entities?.length ?? 0) > 0) {
    return { domain: "UserActivity", entityReference: { fromPreviousResult: true, type: "quotation" }, intent: "follow_up", subject: reference.subject };
  }

  // B/C: activity_time period/subject continuation - the period may change, but the subject
  // (self, or the same named user) carries over; always re-executed through the real capability
  // path below, never answered from a stale duration (PART 7).
  if (reference.intent === "activity_time" && reference.subject) {
    return {
      domain: "UserActivity",
      intent: "activity_time",
      period: resolveNoaSemanticPeriod(message, reference.period),
      subject: reference.subject,
    };
  }

  return undefined;
}

// C3: builds the fresh conversationReference for the NEXT request from THIS result's own
// already-authorized capabilityData only (PART 2/10) - never from provider text, never from
// recentMessages. Returns undefined when this result has nothing useful to remember, so the
// client always replaces its stored reference rather than accumulating one.
function buildUserActivityConversationReference(
  semanticRequest: NoaSemanticRequest | undefined,
  data: unknown,
): NoaConversationReference | undefined {
  if (!semanticRequest || semanticRequest.domain !== "UserActivity") return undefined;
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  const kind = record && typeof record.kind === "string" ? record.kind : undefined;

  if (kind === "user_activity_summary" || kind === "user_activity_quotation_follow_up") {
    const rawIdentifiers = Array.isArray(record?.quotationIdentifiers) ? (record?.quotationIdentifiers as unknown[]) : [];
    const identifiers = rawIdentifiers.filter((id): id is string => typeof id === "string");
    return {
      domain: "UserActivity",
      entities: boundConversationReferenceEntities(identifiers.map((label) => ({ label, type: "quotation" }))),
      intent: "recorded_activity",
      period: semanticRequest.period,
      subject: semanticRequest.subject,
    };
  }

  if (semanticRequest.intent === "activity_time") {
    return { domain: "UserActivity", intent: "activity_time", period: semanticRequest.period, subject: semanticRequest.subject };
  }

  return undefined;
}

// C4B: resolves a pronoun-only Project follow-up ("what status is it?", "what client is it for?")
// against the client-round-tripped conversationReference. Unlike UserActivity's resolver, this
// capability takes raw message text, not a structured option - so instead of steering the
// capability with a semanticRequest, this rewrites the PRONOUN back into the inherited project
// label and lets the capability's own existing, unchanged text parsing take it from there. The
// capability is always re-invoked fresh (PART "Current Facts Only") - only the identifying label
// carries over, never a status/client/location fact. A message that already names its own target
// directly ("tell me about ABC", no pronoun) does not need this - it is handled by the plain
// domain-only reroute below, exactly like Quotation's bare-identifier case in C4A.
function resolveProjectFollowUp(
  message: string,
  reference: NoaConversationReference,
  extractedIntent: NoaSemanticIntent | undefined,
): { rewrittenMessage: string; semanticRequest: NoaSemanticRequest } | undefined {
  if (reference.domain !== "Project") return undefined;
  // ERP-NOA-2: an ERP Project File reference (type "project_file", the ERP-NOA-1 default path) is
  // checked first; the explicit standalone Project Record shape (type "project") is still
  // supported unchanged as a fallback.
  const projectLabel = reference.entities?.find((entity) => entity.type === "project_file")?.label
    ?? reference.entities?.find((entity) => entity.type === "project")?.label;
  if (!projectLabel) return undefined;

  const looksLikeFollowUp = extractedIntent === "follow_up" || PROJECT_PRONOUN_FOLLOW_UP_PATTERN.test(message);
  if (!looksLikeFollowUp) return undefined;

  const cleanedMessage = message.trim().replace(/[?!.]+$/, "");
  if (!PROJECT_PRONOUN_FOLLOW_UP_PATTERN.test(cleanedMessage)) return undefined;

  const rewrittenMessage = cleanedMessage.replace(PROJECT_PRONOUN_FOLLOW_UP_PATTERN, `project ${projectLabel}`);

  return {
    rewrittenMessage,
    semanticRequest: { domain: "Project", entityReference: { fromPreviousResult: true, type: "project" }, intent: "follow_up" },
  };
}

// C4B/ERP-NOA-2: builds a bounded Project conversationReference from THIS successful,
// already-authorized capabilityData only - never from provider text. Supports BOTH current
// Project capability response shapes:
//   A. ERP Project File (ERP-NOA-1's default path): `data.projectFile.orderNo` (detail) /
//      `data.rows[].orderNo` (list) - checked first, since this is now the default "project"
//      concept. Entities use type "project_file", preferring orderNo as the primary label and
//      (for a single-result detail lookup) the human-readable `reference` as a secondary label.
//   B. Standalone Project Record (explicit "project record" path, unchanged since C4B):
//      `data.project.projectName` / `data.rows[].projectName`, entity type "project".
// Never reads an id/UUID/client id either way.
function buildProjectConversationReference(data: unknown): NoaConversationReference | undefined {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!record) return undefined;

  const orderNos: string[] = [];
  const projectFile = record.projectFile;
  if (projectFile && typeof projectFile === "object" && typeof (projectFile as Record<string, unknown>).orderNo === "string") {
    const label = ((projectFile as Record<string, unknown>).orderNo as string).trim();
    if (label) orderNos.push(label);
  }
  if (Array.isArray(record.rows)) {
    for (const row of record.rows) {
      if (row && typeof row === "object" && typeof (row as Record<string, unknown>).orderNo === "string") {
        const label = ((row as Record<string, unknown>).orderNo as string).trim();
        if (label) orderNos.push(label);
      }
    }
  }
  const uniqueOrderNos = Array.from(new Set(orderNos));
  if (uniqueOrderNos.length > 0) {
    const entities = uniqueOrderNos.map((label) => ({ label, type: "project_file" }));
    if (uniqueOrderNos.length === 1 && projectFile && typeof projectFile === "object") {
      const reference = (projectFile as Record<string, unknown>).reference;
      if (typeof reference === "string" && reference.trim()) {
        entities.push({ label: reference.trim(), type: "reference" });
      }
    }
    return { domain: "Project", entities: boundConversationReferenceEntities(entities), intent: "project_lookup" };
  }

  const labels: string[] = [];
  const project = record.project;
  if (project && typeof project === "object" && typeof (project as Record<string, unknown>).projectName === "string") {
    const label = ((project as Record<string, unknown>).projectName as string).trim();
    if (label) labels.push(label);
  }
  if (Array.isArray(record.rows)) {
    for (const row of record.rows) {
      if (row && typeof row === "object" && typeof (row as Record<string, unknown>).projectName === "string") {
        const label = ((row as Record<string, unknown>).projectName as string).trim();
        if (label) labels.push(label);
      }
    }
  }

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) return undefined;

  return {
    domain: "Project",
    entities: boundConversationReferenceEntities(uniqueLabels.map((label) => ({ label, type: "project" }))),
    intent: "project_lookup",
  };
}

// C4C: resolves a Client follow-up against the client-round-tripped conversationReference. Same
// "rewrite raw text, let the unchanged capability re-derive everything" shape as C4B's Project
// resolver: a pronoun ("they"/"that client") is substituted with the inherited client label; a
// bare follow-up with no pronoun at all ("how many projects?") has " for client <label>" appended
// instead, since procurementOrderTarget-style fallback isn't available here - clientTarget()'s own
// patterns all expect the client name to appear literally in the text. Always re-dispatched
// through the real capability (PART 7) - never answers from a stale project count/status.
function resolveClientFollowUp(
  message: string,
  reference: NoaConversationReference,
  extractedIntent: NoaSemanticIntent | undefined,
): { rewrittenMessage: string; semanticRequest: NoaSemanticRequest } | undefined {
  if (reference.domain !== "Client") return undefined;
  const clientLabel = reference.entities?.find((entity) => entity.type === "client")?.label;
  if (!clientLabel) return undefined;

  const cleanedMessage = message.trim().replace(/[?!.]+$/, "");
  const hasPronoun = CLIENT_PRONOUN_FOLLOW_UP_PATTERN.test(cleanedMessage);
  const isBareFollowUp = CLIENT_BARE_FOLLOW_UP_PATTERN.test(message.trim());
  const looksLikeFollowUp = extractedIntent === "follow_up" || hasPronoun || isBareFollowUp;
  if (!looksLikeFollowUp) return undefined;

  const rewrittenMessage = hasPronoun
    ? cleanedMessage.replace(CLIENT_PRONOUN_FOLLOW_UP_PATTERN, `client ${clientLabel}`)
    : isBareFollowUp
      ? `${cleanedMessage} for client ${clientLabel}`
      : undefined;
  if (!rewrittenMessage) return undefined;

  return {
    rewrittenMessage,
    semanticRequest: { domain: "Client", entityReference: { fromPreviousResult: true, type: "client" }, intent: "follow_up" },
  };
}

// C4C: builds a bounded Client conversationReference from THIS successful, already-authorized
// capabilityData only - never from provider text. Reads only `client.name`/`rows[].name`, the
// safe display name every existing Client capability result returns - deliberately never
// `client.id` (safeClientRow does return an id field; it is never read here).
function buildClientConversationReference(data: unknown): NoaConversationReference | undefined {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!record) return undefined;

  const labels: string[] = [];
  const client = record.client;
  if (client && typeof client === "object" && typeof (client as Record<string, unknown>).name === "string") {
    const label = ((client as Record<string, unknown>).name as string).trim();
    if (label) labels.push(label);
  }
  if (Array.isArray(record.rows)) {
    for (const row of record.rows) {
      if (row && typeof row === "object" && typeof (row as Record<string, unknown>).name === "string") {
        const label = ((row as Record<string, unknown>).name as string).trim();
        if (label) labels.push(label);
      }
    }
  }

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) return undefined;

  return {
    domain: "Client",
    entities: boundConversationReferenceEntities(uniqueLabels.map((label) => ({ label, type: "client" }))),
    intent: "client_lookup",
  };
}

// C4C: resolves a Procurement follow-up. Unlike Client/Project, no pronoun substitution is
// needed: procurementOrderTarget() already falls back to scanning the WHOLE message for a bare
// order-number-shaped token, so simply appending " for order <label>" is enough for the
// capability's own existing parsing to find it. Skipped entirely when the message already names
// its own order token (never overrides an explicit new order lookup). Always re-dispatched
// through the real capability (PART 7) - never answers from a stale ETA/stage/document count.
function resolveProcurementFollowUp(
  message: string,
  reference: NoaConversationReference,
  extractedIntent: NoaSemanticIntent | undefined,
): { rewrittenMessage: string; semanticRequest: NoaSemanticRequest } | undefined {
  if (reference.domain !== "Procurement") return undefined;
  const orderLabel = reference.entities?.find((entity) => entity.type === "procurement_order")?.label;
  if (!orderLabel) return undefined;
  if (PROCUREMENT_ORDER_TOKEN_PATTERN.test(message)) return undefined;

  const looksLikeFollowUp = extractedIntent === "follow_up" || PROCUREMENT_FOLLOW_UP_PATTERN.test(message);
  if (!looksLikeFollowUp) return undefined;

  const cleanedMessage = message.trim().replace(/[?!.]+$/, "");
  const rewrittenMessage = `${cleanedMessage} for order ${orderLabel}`;

  return {
    rewrittenMessage,
    semanticRequest: { domain: "Procurement", entityReference: { fromPreviousResult: true, type: "procurement_order" }, intent: "follow_up" },
  };
}

// C4C: builds a bounded Procurement conversationReference from THIS successful, already-authorized
// capabilityData only. Reads only `order.orderNo`/`rows[].orderNo` (never quotationId/an internal
// id) plus, only for a single-order detail result, the detail answer's own already-safe
// `vendors[].vendorLabel` (never vendor_key/dedupeKey, never a document's file storage path).
function buildProcurementConversationReference(data: unknown): NoaConversationReference | undefined {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!record) return undefined;

  const labels: string[] = [];
  const order = record.order;
  if (order && typeof order === "object" && typeof (order as Record<string, unknown>).orderNo === "string") {
    const label = ((order as Record<string, unknown>).orderNo as string).trim();
    if (label) labels.push(label);
  }
  if (Array.isArray(record.rows)) {
    for (const row of record.rows) {
      if (row && typeof row === "object" && typeof (row as Record<string, unknown>).orderNo === "string") {
        const label = ((row as Record<string, unknown>).orderNo as string).trim();
        if (label) labels.push(label);
      }
    }
  }

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) return undefined;

  const entities: { label: string; type: string }[] = uniqueLabels.map((label) => ({ label, type: "procurement_order" }));

  if (uniqueLabels.length === 1 && Array.isArray(record.vendors)) {
    const vendorLabel = record.vendors
      .map((vendor) => (vendor && typeof vendor === "object" ? (vendor as Record<string, unknown>).vendorLabel : undefined))
      .find((label): label is string => typeof label === "string" && label.trim().length > 0);
    if (vendorLabel) entities.push({ label: vendorLabel.trim(), type: "vendor" });
  }

  return {
    domain: "Procurement",
    entities: boundConversationReferenceEntities(entities),
    intent: "procurement_lookup",
  };
}

// C4D: resolves a pronoun-only Product follow-up ("is it active?", "what brand is it?") against
// the client-round-tripped conversationReference. Only a single-product reference (a detail
// lookup, never a multi-item list) can safely be inherited - "show me the first one" against a
// list reference is deliberately NOT resolved here (PART 2: return a clarification rather than
// invent selection/ranking logic). Always re-dispatched through the real capability for a fresh
// read (PART 8) - the rewrite only carries the identifying label forward, never a lifecycle/brand
// fact from the stale reference.
function resolveProductFollowUp(
  message: string,
  reference: NoaConversationReference,
  extractedIntent: NoaSemanticIntent | undefined,
): { rewrittenMessage: string; semanticRequest: NoaSemanticRequest } | undefined {
  if (reference.domain !== "Product") return undefined;
  const productEntities = (reference.entities ?? []).filter((entity) => entity.type === "product");
  if (productEntities.length !== 1) return undefined;
  const productLabel = productEntities[0]?.label;
  if (!productLabel) return undefined;

  const looksLikeFollowUp = extractedIntent === "follow_up" || PRODUCT_PRONOUN_FOLLOW_UP_PATTERN.test(message);
  if (!looksLikeFollowUp) return undefined;

  return {
    rewrittenMessage: `product ${productLabel}`,
    semanticRequest: { domain: "Product", entityReference: { fromPreviousResult: true, type: "product" }, intent: "follow_up" },
  };
}

// C4D: builds a bounded Product conversationReference from THIS successful, already-authorized
// capabilityData only - never from provider text. The detail path returns a plain array of
// templateSummary objects (never a `{ kind }` wrapper); the broad list/count path returns
// `{ kind: "product_list" | "product_count", rows, ... }`. Reads only each row's already-safe
// `name` (never `id`, even though templateSummary does return one) - PART 3.
function buildProductConversationReference(data: unknown): NoaConversationReference | undefined {
  let labels: string[] = [];

  if (Array.isArray(data)) {
    labels = data
      .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).name : undefined))
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());
  } else if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    if (record.kind === "product_list" && Array.isArray(record.rows)) {
      labels = record.rows
        .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).name : undefined))
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
        .map((name) => name.trim());
    }
  }

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) return undefined;

  return {
    domain: "Product",
    entities: boundConversationReferenceEntities(uniqueLabels.map((label) => ({ label, type: "product" }))),
    intent: "product_lookup",
  };
}

// C4D: resolves a pronoun-only Price follow-up ("when was it checked?") the same way as Product's
// resolver - only a single-product reference is inherited, always re-dispatched for a fresh read.
function resolveProductPriceFollowUp(
  message: string,
  reference: NoaConversationReference,
  extractedIntent: NoaSemanticIntent | undefined,
): { rewrittenMessage: string; semanticRequest: NoaSemanticRequest } | undefined {
  if (reference.domain !== "Price") return undefined;
  const productEntities = (reference.entities ?? []).filter((entity) => entity.type === "product");
  if (productEntities.length !== 1) return undefined;
  const productLabel = productEntities[0]?.label;
  if (!productLabel) return undefined;

  const looksLikeFollowUp = extractedIntent === "follow_up" || PRODUCT_PRONOUN_FOLLOW_UP_PATTERN.test(message);
  if (!looksLikeFollowUp) return undefined;

  return {
    rewrittenMessage: `price status ${productLabel}`,
    semanticRequest: { domain: "Price", entityReference: { fromPreviousResult: true, type: "product" }, intent: "follow_up" },
  };
}

// C4D: builds a bounded Price conversationReference from THIS successful, already-authorized
// capabilityData only. The detail path returns a plain `{ name, brand, statusKey, ... }` object
// with no `kind` field (distinguishing it from the list/summary paths' `{ kind, ... }` shape) -
// deliberately never reads `templateId` (PART 6/17: no internal id). Never stores `statusKey`/
// `statusLabel`/counts as reference facts (PART 6/18) - only the identifying labels.
function buildPriceConversationReference(data: unknown): NoaConversationReference | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;

  if (!("kind" in record) && typeof record.name === "string" && record.name.trim()) {
    const entities = [{ label: record.name.trim(), type: "product" }];
    if (typeof record.brand === "string" && record.brand.trim()) {
      entities.push({ label: record.brand.trim(), type: "brand" });
    }
    return { domain: "Price", entities: boundConversationReferenceEntities(entities), intent: "price_lookup" };
  }

  if (record.kind === "price_list" && Array.isArray(record.rows)) {
    const labels = record.rows
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).name : undefined))
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map((name) => name.trim());
    const uniqueLabels = Array.from(new Set(labels));
    if (uniqueLabels.length === 0) return undefined;
    return {
      domain: "Price",
      entities: boundConversationReferenceEntities(uniqueLabels.map((label) => ({ label, type: "product" }))),
      intent: "price_lookup",
    };
  }

  return undefined;
}

// C4A: builds a bounded Quotation conversationReference from THIS successful, already-authorized
// capabilityData only (PART "Reference Building") - never from provider text. Deliberately reads
// only `quotationNo`/`rows[].quotationNo`, fields every existing Quotation capability result
// already returns (detail, list, status list, comparison) - never a UUID, never a client id.
// Unlike UserActivity, this never depends on a semanticRequest: the Quotation capability already
// re-derives its own kind/filters from the raw message text (PART "Quotation semantic wiring"),
// so a reference is built for every successful Quotation answer, semantically-routed or not.
function buildQuotationConversationReference(data: unknown): NoaConversationReference | undefined {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!record) return undefined;

  const labels: string[] = [];
  if (typeof record.quotationNo === "string" && record.quotationNo.trim()) {
    labels.push(record.quotationNo.trim());
  }
  if (Array.isArray(record.rows)) {
    for (const row of record.rows) {
      if (row && typeof row === "object" && typeof (row as Record<string, unknown>).quotationNo === "string") {
        const label = ((row as Record<string, unknown>).quotationNo as string).trim();
        if (label) labels.push(label);
      }
    }
  }

  const uniqueLabels = Array.from(new Set(labels));
  if (uniqueLabels.length === 0) return undefined;

  return {
    domain: "Quotation",
    entities: boundConversationReferenceEntities(uniqueLabels.map((label) => ({ label, type: "quotation" }))),
    intent: "quotation_lookup",
  };
}

// C4A: ordinal list-selection follow-up ("yah for 3rd one") against the immediately previous
// Quotation LIST reference. A SMALL deterministic parser only - no AI, no semantic extractor call
// (this whole resolution runs BEFORE that block, so it's never reached for a message this resolves)
// - and deliberately narrow: every pattern below requires either a "the <ordinal>" prefix or an
// "<ordinal> one"/"number N" shape, never a bare digit or ordinal word alone, so an unrelated
// sentence that happens to contain "third"/"last" etc. is never misread as a list selection.
const QUOTATION_ORDINAL_WORDS: Record<string, number> = {
  eighth: 8, fifth: 5, first: 1, fourth: 4, ninth: 9,
  second: 2, seventh: 7, sixth: 6, tenth: 10, third: 3,
};
const QUOTATION_ORDINAL_WORD_PATTERN = new RegExp(
  `\\bthe\\s+(${Object.keys(QUOTATION_ORDINAL_WORDS).join("|")})\\b|\\b(${Object.keys(QUOTATION_ORDINAL_WORDS).join("|")})\\s+one\\b`,
  "i",
);
const QUOTATION_ORDINAL_SUFFIX_PATTERN = /\b(\d{1,2})(?:st|nd|rd|th)\s+one\b/i;
const QUOTATION_ORDINAL_NUMBER_PATTERN = /\bnumber\s+(\d{1,2})\b/i;
const QUOTATION_ORDINAL_LAST_PATTERN = /\blast\s+one\b/i;

// Returns a 1-based list position, or null when the message doesn't clearly indicate one.
function parseQuotationOrdinalPosition(message: string, entityCount: number): number | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;

  if (QUOTATION_ORDINAL_LAST_PATTERN.test(normalized)) return entityCount;

  const wordMatch = normalized.match(QUOTATION_ORDINAL_WORD_PATTERN);
  if (wordMatch) {
    const word = wordMatch[1] ?? wordMatch[2];
    if (word && word in QUOTATION_ORDINAL_WORDS) return QUOTATION_ORDINAL_WORDS[word];
  }

  const suffixMatch = normalized.match(QUOTATION_ORDINAL_SUFFIX_PATTERN);
  if (suffixMatch) {
    const value = Number(suffixMatch[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }

  const numberMatch = normalized.match(QUOTATION_ORDINAL_NUMBER_PATTERN);
  if (numberMatch) {
    const value = Number(numberMatch[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }

  return null;
}

// PART 5: a fixed, deterministic "1, 2, or 3"-style list of the valid choices - never a guess at
// which one the user meant.
function joinQuotationOrdinalChoices(count: number): string {
  const numbers = Array.from({ length: count }, (_, index) => String(index + 1));
  if (numbers.length === 1) return numbers[0];
  if (numbers.length === 2) return numbers.join(" or ");
  return `${numbers.slice(0, -1).join(", ")}, or ${numbers[numbers.length - 1]}`;
}

type QuotationOrdinalFollowUp =
  | { kind: "selected"; rewrittenMessage: string }
  | { kind: "out_of_range"; count: number };

// PART 3/6/7/9: only ever consulted when the round-tripped conversationReference is ALREADY
// Quotation-domain with at least one quotation entity - a Product/Client/Project/etc. reference (or
// no reference at all) never reaches parseQuotationOrdinalPosition, so it can never guess. Entities
// are read in their EXISTING stored order (PART 7) - never re-sorted/re-ranked here. PART 4: the
// reference supplies identity ONLY - the rewritten message re-dispatches through the same, unchanged
// Quotation capability text parsing every other C4A path already relies on, so the actual answer is
// always a fresh, freshly-authorized read, never the stale list data itself.
function resolveQuotationOrdinalFollowUp(
  message: string,
  reference: NoaConversationReference,
): QuotationOrdinalFollowUp | undefined {
  if (reference.domain !== "Quotation") return undefined;
  const quotationEntities = (reference.entities ?? []).filter(
    (entity): entity is { type: string; label: string } => entity.type === "quotation" && Boolean(entity.label),
  );
  if (quotationEntities.length === 0) return undefined;

  const position = parseQuotationOrdinalPosition(message, quotationEntities.length);
  if (position === null) return undefined;

  if (position < 1 || position > quotationEntities.length) {
    return { count: quotationEntities.length, kind: "out_of_range" };
  }

  return { kind: "selected", rewrittenMessage: `tell me about ${quotationEntities[position - 1].label}` };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GPC-3: Guided Product Configuration (start / resume / cancel / start-over)
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Deliberately isolated from the rest of the routing pipeline above: this whole block only ever
// calls GPC-2 (loadProductConfigurationTemplate) for data and GPC-1 (resolveProductConfigurationState)
// for every configuration/pricing decision - it never reimplements auto-resolution, compatibility,
// or pricing rules itself (PART 7/18). Every turn independently re-authorizes and re-loads the
// current template (PART 6/17) - a templateId round-tripped from a prior answer is never trusted
// on its own. Still fully READ-ONLY: no write action exists here (PART 10 is future work).

// PART 5: narrow start phrasing only - "configure X" / "help me configure X". Not a broad intent
// classifier; anything else falls through to normal routing unchanged.
const PRODUCT_CONFIGURATION_START_PATTERN = /^(?:help me )?configure\s+(.+?)[.!]?$/i;
// PART 14: exact control phrases only, not bare "cancel"/"stop" (too easily a false positive for
// an unrelated message).
const PRODUCT_CONFIGURATION_CANCEL_PATTERN = /^(?:cancel configuration|stop configuring)[.!]?$/i;
const PRODUCT_CONFIGURATION_START_OVER_PATTERN = /^start over[.!]?$/i;
const MAX_DISPLAYED_CONFIGURATION_OPTIONS = 10;

function productConfigurationStartTarget(message: string): string | null {
  const target = message.trim().match(PRODUCT_CONFIGURATION_START_PATTERN)?.[1]?.trim();
  return target || null;
}

// PART 15: only "obvious" deterministic fresh-domain signals - the same identifier fast-paths and
// deterministic router already used above, never a second semantic guess. A message that resolves
// to Product/Help/context/greeting/capabilities is NOT considered "fresh other-domain" (it's either
// still about the product in view, or genuinely ambiguous - both fall through to configuration
// resume, which is exactly what an answer like "1800 x 900" needs).
function looksLikeFreshOtherDomainRequest(message: string, context: NoaPageContext): boolean {
  if (quotationIdentifierCount(message) > 0 || projectFileIdentifierCount(message) > 0) return true;
  const route = classifyNoaRoute(message, context);
  return route !== "Product" && route !== "Help" && route !== "context" && route !== "greeting" && route !== "capabilities";
}

// PART 12: only the step kinds GPC-1 actually returns as a single-choice step map to a single
// selection field - modular/accessory (multi-selection) steps are deliberately excluded here (a
// step whose key isn't in this map is treated as PART 12's "not yet supported" case).
function productConfigurationSelectionKey(stepKey: string): keyof NoaProductConfigurationSelections | null {
  switch (stepKey) {
    case "system_base": return "systemRowId";
    case "variant_group": return "variantGroupId";
    case "variant_subgroup": return "subgroupId";
    case "variant_row": return "variantRowId";
    case "workstation_size": return "deskingSizeId";
    case "category_group": return "categoryGroupId";
    case "category_row": return "categoryRowId";
    case "fabric_category": return "fabricCategory";
    default: return null;
  }
}

// PART 7: GPC-1's own `autoApplied` output (never a second auto-resolution algorithm) is folded
// back into the persisted selections, so the NEXT turn's reference reflects what was actually
// auto-selected. Required-companion auto-applies (stepKey "accessory:...") are deliberately
// skipped - required-component-overrides.ts's effectiveRequiredQuantities() already re-derives
// them fresh every turn from the trigger/overrides, so persisting them would be redundant, not
// unsafe, but also not necessary; only single-choice steps need their id remembered.
function applyAutoResolvedSelections(
  selections: NoaProductConfigurationSelections,
  autoApplied: ProductConfigurationState["autoApplied"],
): NoaProductConfigurationSelections {
  let next = selections;
  for (const entry of autoApplied) {
    const key = productConfigurationSelectionKey(entry.stepKey);
    if (!key) continue;
    next = { ...next, [key]: entry.optionId };
  }
  return next;
}

type ProductConfigurationAnswerMatch =
  | { kind: "matched"; optionId: string }
  | { kind: "none" }
  // GPC-3.1 PART 9: the matcher's own candidate set is exposed here (cheap - it already computed
  // them to decide "more than one") so the caller can re-offer just THOSE instead of every current
  // option.
  | { kind: "ambiguous"; candidates: ProductConfigurationOption[] };

// GPC-3.1 PART 7: normalization only - lowercase, trim, collapse whitespace, fold every dash
// variant to a space, fold "×" to "x" and tighten "<digit> x <digit>" spacing so "210x100" and
// "210 x 100" compare equal. No fuzzy/Levenshtein matching, no synonym table.
function normalizeConfigurationAnswerText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/×/g, "x")
    .replace(/(\d)\s*x\s*(\d)/gi, "$1 x $2")
    .replace(/\s+/g, " ")
    .trim();
}

// A "tight" (space-free) form for token containment checks only - lets a typed "w210" match a
// haystack that actually reads "w 210" without treating every space as significant.
function tightenConfigurationAnswerText(value: string): string {
  return value.replace(/\s+/g, "");
}

function configurationOptionSearchText(option: ProductConfigurationOption): string {
  return normalizeConfigurationAnswerText(`${option.label} ${option.dimension ?? ""} ${option.supplierCode ?? ""}`);
}

// GPC-3.4 PART 8: a small, fully deterministic matcher - exact visible label, exact dimension,
// exact supplier code, a unique normalized-substring partial label, then (GPC-3.1 addition) a
// unique token-reduced match across label + dimension + supplier code combined. `supplierCode` is
// presentation-only metadata (PART 4) - matching against it never changes what gets selected; the
// same `option.id` is written either way. The model never picks the row - only this function does;
// no fuzzy/AI matching.
function matchProductConfigurationAnswer(message: string, options: ProductConfigurationOption[]): ProductConfigurationAnswerMatch {
  const normalized = normalizeConfigurationAnswerText(message);
  if (!normalized) return { kind: "none" };

  const exactLabel = options.find((option) => normalizeConfigurationAnswerText(option.label) === normalized);
  if (exactLabel) return { kind: "matched", optionId: exactLabel.id };

  const exactDimension = options.find((option) => option.dimension && normalizeConfigurationAnswerText(option.dimension) === normalized);
  if (exactDimension) return { kind: "matched", optionId: exactDimension.id };

  const exactSupplierCode = options.find((option) => option.supplierCode && normalizeConfigurationAnswerText(option.supplierCode) === normalized);
  if (exactSupplierCode) return { kind: "matched", optionId: exactSupplierCode.id };

  const partialMatches = options.filter((option) => normalizeConfigurationAnswerText(option.label).includes(normalized));
  if (partialMatches.length === 1) return { kind: "matched", optionId: partialMatches[0].id };
  if (partialMatches.length > 1) return { kind: "ambiguous", candidates: partialMatches };

  // GPC-3.1: tolerate a typed reply that omits repeated generic words (e.g. "Desk") or reorders
  // model/dimension fragments, as long as EVERY typed token is present (tight-contained) in
  // exactly one option's combined label+dimension text. Only tried for multi-token input - a
  // single leftover token is already covered by the partial-label check above.
  const userTokens = normalized.split(" ").filter(Boolean);
  if (userTokens.length > 1) {
    const tokenMatches = options.filter((option) => {
      const haystack = tightenConfigurationAnswerText(configurationOptionSearchText(option));
      return userTokens.every((token) => haystack.includes(tightenConfigurationAnswerText(token)));
    });
    if (tokenMatches.length === 1) return { kind: "matched", optionId: tokenMatches[0].id };
    if (tokenMatches.length > 1) return { kind: "ambiguous", candidates: tokenMatches };
  }

  return { kind: "none" };
}

// PART 3: cosmetic-only display formatting - never changes GPC-1's own option data, only how it
// is rendered. Folds the existing " - " separator into an em dash for a cleaner button label.
function configurationChoiceLabel(option: ProductConfigurationOption): string {
  return option.label.replace(/\s-\s/g, " — ");
}

// GPC-3.2: currency comes from THIS option's own source row (option.priceCurrency), never from the
// aggregate/current configuration currency - a different option can legitimately be priced in a
// different currency than whatever is currently resolved elsewhere (the proven UAT bug). When no
// currency is available for this option, the price is omitted rather than guessed.
// GPC-3.4 PART 4/7: the supplier code (when GPC-1 provided one) is shown here as secondary,
// deterministic information - never as the main label, and never in place of the price.
function configurationChoiceSecondary(option: ProductConfigurationOption): string | undefined {
  const parts: string[] = [];
  if (option.dimension) parts.push(option.dimension.replace(/(\d)\s*x\s*(\d)/gi, "$1 × $2"));
  if (option.supplierCode) parts.push(option.supplierCode);
  if (typeof option.priceContribution === "number" && option.priceCurrency) {
    parts.push(`${option.priceCurrency} ${option.priceContribution.toLocaleString()}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

// PART 1/6: bounded, server-issued, display-only choices for a set of CURRENT GPC-1 options -
// `value` is deliberately the option's own visible label (the exact string the matcher above
// already accepts via its exact-label path), never an internal id or a new opaque token.
function productConfigurationChoicesFor(options: ProductConfigurationOption[], includeSkip = false): NoaChoice[] {
  const choices = options.slice(0, MAX_DISPLAYED_CONFIGURATION_OPTIONS).map((option) => ({
    label: configurationChoiceLabel(option),
    secondary: configurationChoiceSecondary(option),
    value: option.label,
  }));
  return includeSkip ? [...choices, { label: "Skip", value: "Skip" }] : choices;
}

// PART 2: short, natural, GPC-terminology-free question text per step kind - never a step key,
// never an internal id. `noun` is reused by the invalid/ambiguous correction text below so both
// stay consistent for the same step. `terminator` is the punctuation the full question ends with
// ("." for a statement, "?" for the optional-accessory question) - the caller appends it once,
// never both.
//
// GPC-3.4 PART 5/6: for an "accessory" step (Service Unit / Modesty Panel / Top-Access / any other
// accessory group - never a MONOLITH-specific case), the generic "Choose an option." is replaced
// with wording built deterministically from the step's own group label and GPC-1's own
// `step.required` (never inferred from the group name/kind) - required groups read as a
// requirement with no Skip, optional groups read as an invitation with Skip (Skip is already
// wired in via `productConfigurationChoicesFor`'s own `includeSkip` check).
function productConfigurationStepPhrase(step: Pick<ProductConfigurationStep, "kind" | "label" | "required">): { question: string; noun: string; terminator: "." | "?" } {
  switch (step.kind) {
    case "system_base": return { question: "Choose a system or base", noun: "option", terminator: "." };
    case "variant_group": return { question: "Choose a product family", noun: "family", terminator: "." };
    case "variant_subgroup": return { question: "Choose a configuration", noun: "configuration", terminator: "." };
    case "variant_row": return { question: "Choose a model / size", noun: "model", terminator: "." };
    case "workstation_size": return { question: "Choose a size", noun: "size", terminator: "." };
    case "category_group": return { question: "Choose a category", noun: "category", terminator: "." };
    case "category_row": return { question: "Choose an item", noun: "item", terminator: "." };
    case "fabric_category": return { question: "Choose a finish", noun: "finish", terminator: "." };
    case "accessory": {
      const noun = step.label.trim().toLowerCase() || "option";
      return step.required
        ? { question: `Choose a required ${noun}`, noun, terminator: "." }
        : { question: `Would you like to add a ${noun}`, noun, terminator: "?" };
    }
    default: return { question: "Choose an option", noun: "option", terminator: "." };
  }
}

// PART 2/6/8/9: one short deterministic question with structured, bounded choices - the option
// list is never dumped into the message text. `isFirstQuestion` names the product once, on the
// very first question of a fresh configuration only (matches the worked example); every later
// question stays short. `correction` is an optional short PART 8/9 prefix for an invalid/ambiguous
// reply, and `candidates` (PART 9) narrows the re-offered choices to just the ambiguous matches
// when the matcher already exposed them, falling back to every current option otherwise.
function productConfigurationQuestionAnswer(
  step: ProductConfigurationStep,
  reference: NoaProductConfigurationReference,
  templateName: string,
  isFirstQuestion: boolean,
  correction?: { text: string; candidates?: ProductConfigurationOption[] },
): NoaAnswer {
  const phrase = productConfigurationStepPhrase(step);
  const offered = correction?.candidates ?? step.options;
  const boundedNote = step.options.length > MAX_DISPLAYED_CONFIGURATION_OPTIONS && !correction?.candidates
    ? ` I found ${step.options.length} options. Here are the first ${MAX_DISPLAYED_CONFIGURATION_OPTIONS} — you can also type part of the ${phrase.noun} name or dimension.`
    : "";
  const questionText = isFirstQuestion ? `${phrase.question} for ${templateName}${phrase.terminator}` : `${phrase.question}${phrase.terminator}`;
  const correctionLine = correction ? `${correction.text}\n\n` : "";
  return {
    choices: productConfigurationChoicesFor(offered, step.kind === "accessory" && !step.required),
    domain: "Product",
    productConfigurationReference: reference,
    sources: [],
    text: `${correctionLine}${questionText}${boundedNote}`,
  };
}

// PART 12: a required multi-selection step (modular/accessory) has no single selection field to
// write into yet - a bounded, honest deferral rather than an invented grammar.
function productConfigurationUnsupportedStepAnswer(step: ProductConfigurationStep, reference: NoaProductConfigurationReference): NoaAnswer {
  return {
    domain: "Product",
    productConfigurationReference: reference,
    sources: [],
    text: `"${step.label}" needs multiple selections, which guided configuration doesn't support yet - that's coming in a later phase. You can still ask me about this product directly.`,
  };
}

// ── GPC-4: post-completion (summary / specification / price) ───────────────────────────────────
// Everything below is read directly from GPC-1's OWN current output (state.steps/.specification/
// .dimension/.price) plus the persisted selection ids that chose them - never a second
// accessory/pricing evaluation, never a provider/LLM call. The reference is always passed through
// unchanged (PART 12) so a later phase (GPC-5) can still consume it for change/back/start-over.

type ProductConfigurationSummaryLine = { label: string; value: string };
type ProductConfigurationSummarySections = {
  fields: ProductConfigurationSummaryLine[];
  requiredAccessoryLines: string[];
  optionalAccessoryLines: string[];
};

// A step's own `options` array already carries the GPC-3.4 human label for whichever id was
// selected - looking it up here (by the SAME selection id GPC-1 already validated) is the only
// re-derivation this file does; it never re-parses Product Library data itself.
function selectedOptionLabel(step: ProductConfigurationStep | undefined, selectedId: string | null | undefined): string | null {
  if (!step || !selectedId) return null;
  return step.options.find((option) => option.id === selectedId)?.label ?? null;
}

// GPC-4.1 PART 2/3: a small, deterministic detector for internal/workflow-sounding GPC group
// labels (e.g. a Category/Matrix group's own persisted name, typically a pricing-engine label
// like "Finish Category Pricing"/"Category Pricing", or a Base/Model "... group" wrapper) - text
// pattern only, never a guess at what the "real" name should have been. When a label doesn't match
// this, PART 3's own fallback applies: the existing human step label is shown as-is.
function isInternalWorkflowLabel(label: string): boolean {
  return /\bpricing\b/i.test(label) || /\bgroup\b/i.test(label);
}

// PART 6/7/9/10/12: human-facing selection lines only - never a step key, internal id, or row id.
// Required vs. optional accessory groups are split into their own buckets (never an inline
// "Required — X" repeated per line) using `step.required` (GPC-1's own flag, never inferred from
// the group name); a skipped optional group is excluded entirely rather than shown as "selected
// nothing". PART 2: the Category/Matrix GROUP line itself is only shown when its own persisted
// name doesn't look like internal workflow/pricing terminology - the actually useful facts are the
// specific item chosen (shown as "Model", matching the Base/Model vocabulary) and its finish.
function productConfigurationSummarySections(
  state: ProductConfigurationState,
  selections: NoaProductConfigurationSelections,
): ProductConfigurationSummarySections {
  const stepByKey = new Map(state.steps.map((step) => [step.key, step]));
  const fields: ProductConfigurationSummaryLine[] = [];

  const push = (label: string, value: string | null) => {
    if (value) fields.push({ label, value });
  };

  push("System", selectedOptionLabel(stepByKey.get("system_base"), selections.systemRowId));
  push("Product family", selectedOptionLabel(stepByKey.get("variant_group"), selections.variantGroupId));
  push("Configuration", selectedOptionLabel(stepByKey.get("variant_subgroup"), selections.subgroupId));
  push("Model", selectedOptionLabel(stepByKey.get("variant_row"), selections.variantRowId));
  push("Size", selectedOptionLabel(stepByKey.get("workstation_size"), selections.deskingSizeId));

  const categoryGroupLabel = selectedOptionLabel(stepByKey.get("category_group"), selections.categoryGroupId);
  if (categoryGroupLabel && !isInternalWorkflowLabel(categoryGroupLabel)) push("Category", categoryGroupLabel);
  push("Model", selectedOptionLabel(stepByKey.get("category_row"), selections.categoryRowId));
  push("Finish", selectedOptionLabel(stepByKey.get("fabric_category"), selections.fabricCategory));

  if (state.dimension) fields.push({ label: "Dimension", value: state.dimension });

  const skippedGroupIds = new Set(selections.skippedAccessoryGroupIds ?? []);
  const requiredAccessoryLines: string[] = [];
  const optionalAccessoryLines: string[] = [];
  for (const step of state.steps) {
    if (step.kind !== "accessory" || !step.groupId || skippedGroupIds.has(step.groupId)) continue;
    const selectedLabels = (step.selectedOptionIds ?? [])
      .map((id) => step.options.find((option) => option.id === id)?.label)
      .filter((label): label is string => Boolean(label));
    if (!selectedLabels.length) continue;
    // PART 11: the ONLY joining this file ever does is a plain ", " between separately-selected
    // option labels (each already GPC-3.4's own human label) - never a rewrite of any one option's
    // own text, never AI, never a Product Library mutation.
    const line = `${step.label}: ${selectedLabels.join(", ")}`;
    (step.required ? requiredAccessoryLines : optionalAccessoryLines).push(line);
  }

  return { fields, requiredAccessoryLines, optionalAccessoryLines };
}

// PART 1/3/4/5/9/14: the default, immediate post-completion response - grouped sections joined
// with real blank-line-separated newlines (never one paragraph), the configured source unit price
// shown prominently in its own section near the end, required/optional accessory selections
// grouped under a single header each rather than repeated inline. PART 8: the price only claims
// completeness when GPC-1 itself reports no missing exchange rate.
function productConfigurationSummaryAnswer(
  template: ProductConfigurationTemplateInput,
  state: ProductConfigurationState,
  selections: NoaProductConfigurationSelections,
  reference: NoaProductConfigurationReference,
): NoaAnswer {
  const heading = template.brandName ? `${template.templateName} — ${template.brandName}` : template.templateName;
  const sections = productConfigurationSummarySections(state, selections);

  const configuredLines = sections.fields.map((line) => `${line.label}: ${line.value}`);
  if (sections.requiredAccessoryLines.length) configuredLines.push("Required", ...sections.requiredAccessoryLines);
  if (sections.optionalAccessoryLines.length) configuredLines.push("Optional", ...sections.optionalAccessoryLines);

  const priceBlock = state.price.missingExchangeRateCurrencies.length > 0
    ? ["Configured source unit price", `Incomplete - missing exchange rate for ${state.price.missingExchangeRateCurrencies.join(", ")}.`]
    : ["Configured source unit price", `${state.price.currency} ${state.price.unit.toLocaleString()}`];

  const blocks: string[] = [heading];
  if (configuredLines.length) blocks.push(["Configured selections", ...configuredLines].join("\n"));
  blocks.push(priceBlock.join("\n"));
  blocks.push("You can ask me for the final specification.");

  return { domain: "Product", productConfigurationReference: reference, sources: [], text: blocks.join("\n\n") };
}

// PART 4/5/13: the CURRENT, freshly-reevaluated `state.specification` only - no rewrite, no second
// generator, no chat-prose extraction. A blank/missing specification is reported honestly rather
// than invented.
function productConfigurationSpecificationAnswer(
  template: ProductConfigurationTemplateInput,
  state: ProductConfigurationState,
  reference: NoaProductConfigurationReference,
): NoaAnswer {
  const specification = state.specification?.trim();
  if (!specification) {
    return {
      domain: "Product",
      productConfigurationReference: reference,
      sources: [],
      text: "I don't have a configured specification for this selection.",
    };
  }
  const text = `Configured specification — ${template.templateName.toUpperCase()}\n\n${specification}`;
  return { domain: "Product", productConfigurationReference: reference, sources: [], text };
}

// PART 8/13: `state.price` only - no arithmetic, no FX/AED conversion performed here. Buckets are
// listed only when GPC-1 itself already reports a non-zero amount for them.
function productConfigurationPriceAnswer(
  template: ProductConfigurationTemplateInput,
  state: ProductConfigurationState,
  reference: NoaProductConfigurationReference,
): NoaAnswer {
  if (state.price.missingExchangeRateCurrencies.length > 0) {
    return {
      domain: "Product",
      productConfigurationReference: reference,
      sources: [],
      text: `I can't confirm a complete source unit price for ${template.templateName} - missing exchange rate for ${state.price.missingExchangeRateCurrencies.join(", ")}.`,
    };
  }
  const lines = [`Configured source unit price: ${state.price.currency} ${state.price.unit.toLocaleString()}.`];
  const buckets: Array<[string, number]> = [
    ["Base", state.price.base],
    ["System / Base", state.price.system],
    ["Workstation variant", state.price.workstationVariant],
    ["Accessories", state.price.accessories],
  ];
  for (const [label, amount] of buckets) {
    if (amount) lines.push(`${label}: ${state.price.currency} ${amount.toLocaleString()}`);
  }
  return { domain: "Product", productConfigurationReference: reference, sources: [], text: lines.join("\n") };
}

type ProductConfigurationPostCompletionIntent = "specification" | "summary" | "price";

// PART 2: a SMALL deterministic classifier - keyword matching only, no semantic extractor call, no
// general intent router. Applies ONLY while a reference is already GPC-3.3-complete (see the two
// call sites below); it is never consulted while a required/optional step is still pending, so it
// can never misfire against a normal typed answer to a configuration question.
function classifyProductConfigurationPostCompletionIntent(message: string): ProductConfigurationPostCompletionIntent | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("specification")) return "specification";
  if (/\bprice\b/.test(normalized) || normalized.includes("how much")) return "price";
  if (normalized.includes("summary") || normalized.includes("what did i configure") || /show (?:the )?configur/.test(normalized)) return "summary";
  return null;
}

// PART 10: the CURRENT user message decides which of the three deterministic answers comes back -
// an unrecognized message falls back to the same compact summary (PART 3), never the old
// unconditionally-repeated completion sentence.
function productConfigurationCompletionResponse(
  message: string,
  template: ProductConfigurationTemplateInput,
  state: ProductConfigurationState,
  selections: NoaProductConfigurationSelections,
  reference: NoaProductConfigurationReference,
): NoaAnswer {
  const intent = classifyProductConfigurationPostCompletionIntent(message);
  if (intent === "specification") return productConfigurationSpecificationAnswer(template, state, reference);
  if (intent === "price") return productConfigurationPriceAnswer(template, state, reference);
  return productConfigurationSummaryAnswer(template, state, selections, reference);
}

// PART 17: every terminal GPC-2 outcome ends the configuration with a deterministic message and
// NO productConfigurationReference (so the client naturally drops it) - never a guessed
// replacement template.
function terminateProductConfiguration(reason: Extract<ProductConfigurationTemplateLoadResult, { ok: false }>["reason"]): NoaAnswer {
  const text = reason === "unauthorized"
    ? "I don't have access to that ProjectWorkflow area with your current permissions."
    : reason === "not_found"
      ? "I couldn't find that product anymore, so this configuration has ended."
      : reason === "inactive"
        ? "That product is no longer available to configure, so this configuration has ended."
        : "That product's brand record could not be found, so this configuration has ended.";
  return { domain: "Product", sources: [], text };
}

// PART 5/6: template + brand load (GPC-2) then evaluate (GPC-1) with the given selections. Shared
// by both start and resume so there is exactly one place that turns a loaded template + selections
// into a NoaAnswer.
function answerForConfigurationState(
  template: ProductConfigurationTemplateInput,
  selections: NoaProductConfigurationSelections,
  templateId: string,
): NoaAnswer {
  const state = resolveProductConfigurationState(template, selections);
  const effectiveSelections = applyAutoResolvedSelections(selections, state.autoApplied);
  const reference: NoaProductConfigurationReference = { mode: "configuring", selections: effectiveSelections, templateId };

  const nextStep = state.nextRequiredStep ?? state.optionalSteps[0] ?? null;
  if (!nextStep) return productConfigurationSummaryAnswer(template, state, effectiveSelections, reference);

  const selectionKey = productConfigurationSelectionKey(nextStep.kind);
  if (!selectionKey && nextStep.kind !== "accessory") return productConfigurationUnsupportedStepAnswer(nextStep, reference);

  // PART 2: the product name is named once, only on the very first question of a fresh
  // configuration (empty incoming selections) - every later question stays short.
  const isFirstQuestion = Object.keys(selections).length === 0;
  return productConfigurationQuestionAnswer(nextStep, reference, template.templateName, isFirstQuestion);
}

// PART 5: start a NEW configuration. `existingTemplateId` is set only by "start over" (PART 14),
// which preserves the template but resets every selection. Otherwise the product target text is
// resolved through the EXISTING Product capability search (fetchNoaProductCapability) - never a
// second search implementation (PART 5's own instruction) - and only a single unambiguous match
// proceeds.
async function startProductConfiguration(
  searchText: string | null,
  context: NoaPageContext,
  existingTemplateId?: string,
): Promise<NoaAnswer> {
  let templateId = existingTemplateId ?? null;

  if (!templateId) {
    if (!searchText) return { domain: "Product", sources: [], text: "Which product would you like to configure?" };
    const result = await fetchNoaProductCapability(searchText, context);
    if (!result.ok) return { domain: "Product", sources: [], text: result.message };
    const rows = Array.isArray(result.data) ? (result.data as Array<Record<string, unknown>>) : [];
    if (rows.length === 0) return { domain: "Product", sources: [], text: "I couldn't find a matching product in the Product Library." };
    if (rows.length > 1) return { domain: "Product", sources: [], text: "I found more than one matching product in the Product Library. Please provide a more specific product name or code." };
    const candidateId = rows[0]?.id;
    if (typeof candidateId !== "string" || !candidateId) return { domain: "Product", sources: [], text: "I couldn't find a matching product in the Product Library." };
    templateId = candidateId;
  }

  const loaded = await loadProductConfigurationTemplate(templateId);
  if (!loaded.ok) return terminateProductConfiguration(loaded.reason);

  return answerForConfigurationState(loaded.template, {}, templateId);
}

// PART 6/10/17: every resume turn independently re-authorizes and reloads the current template
// through GPC-2 - the templateId is the only thing trusted from the prior reference, and even that
// is only ever used as a lookup key, never as proof of continued validity.
async function resumeProductConfiguration(reference: NoaProductConfigurationReference, message: string): Promise<NoaAnswer> {
  const loaded = await loadProductConfigurationTemplate(reference.templateId);
  if (!loaded.ok) return terminateProductConfiguration(loaded.reason);

  // PART 17: stale selections are GPC-1's own report, never guessed at or silently dropped by
  // this file - they simply don't block re-evaluation (GPC-1 already ignores them safely).
  const currentState = resolveProductConfigurationState(loaded.template, reference.selections);

  const nextStep = currentState.nextRequiredStep ?? currentState.optionalSteps[0] ?? null;
  if (!nextStep) {
    // GPC-4 PART 2/10: the configuration was ALREADY complete before this message arrived (no new
    // selection is being applied this turn) - the user's current message is what decides whether
    // they get the specification, the price, or the summary again, never a repeated generic
    // sentence.
    return productConfigurationCompletionResponse(message, loaded.template, currentState, reference.selections, reference);
  }

  const selectionKey = productConfigurationSelectionKey(nextStep.kind);
  if (!selectionKey && nextStep.kind !== "accessory") return productConfigurationUnsupportedStepAnswer(nextStep, reference);

  if (nextStep.kind === "accessory" && !nextStep.required && /^skip$/i.test(message.trim()) && nextStep.groupId) {
    const skippedAccessoryGroupIds = Array.from(new Set([...(reference.selections.skippedAccessoryGroupIds ?? []), nextStep.groupId]));
    return answerForConfigurationState(loaded.template, { ...reference.selections, skippedAccessoryGroupIds }, reference.templateId);
  }

  // PART 10/11: the user's answer is interpreted ONLY against the CURRENT step's CURRENT valid
  // options - never a raw id, never an LLM-picked row.
  const match = matchProductConfigurationAnswer(message, nextStep.options);
  const noun = productConfigurationStepPhrase(nextStep).noun;
  if (match.kind === "none") {
    return productConfigurationQuestionAnswer(
      nextStep,
      reference,
      loaded.template.templateName,
      false,
      { text: `I couldn't match that to one of the available ${noun}s. Choose one below, or type part of the ${noun} name or dimension.` },
    );
  }
  if (match.kind === "ambiguous") {
    return productConfigurationQuestionAnswer(
      nextStep,
      reference,
      loaded.template.templateName,
      false,
      { candidates: match.candidates, text: `That matches more than one ${noun}. Choose one below.` },
    );
  }

  const nextSelections: NoaProductConfigurationSelections = nextStep.kind === "accessory"
    ? {
        ...reference.selections,
        accessoryQuantities: {
          ...Object.fromEntries(Object.entries(reference.selections.accessoryQuantities ?? {}).filter(([itemId]) => !nextStep.options.some((option) => option.id === itemId))),
          [match.optionId]: 1,
        },
        skippedAccessoryGroupIds: (reference.selections.skippedAccessoryGroupIds ?? []).filter((groupId) => groupId !== nextStep.groupId),
      }
    : { ...reference.selections, [selectionKey!]: match.optionId };
  return answerForConfigurationState(loaded.template, nextSelections, reference.templateId);
}

// The single entry point for every configuration-shaped turn: start / resume / cancel / start
// over. Returns null when the message is not a configuration turn at all, so the caller falls
// through to normal routing unchanged (PART 15).
async function maybeHandleProductConfigurationTurn(request: NoaChatRequest): Promise<NoaAnswer | null> {
  const startTarget = productConfigurationStartTarget(request.message);
  if (startTarget) {
    // PART 16: an explicit new "configure X" always starts fresh and replaces any prior
    // configuration reference, even mid-configuration - never merged.
    return startProductConfiguration(startTarget, request.context);
  }

  const incomingReference = isNoaProductConfigurationReference(request.productConfigurationReference)
    ? request.productConfigurationReference
    : undefined;
  if (!incomingReference) return null;

  if (PRODUCT_CONFIGURATION_CANCEL_PATTERN.test(request.message.trim())) {
    return { domain: "Product", sources: [], text: "Product configuration cancelled." };
  }

  if (PRODUCT_CONFIGURATION_START_OVER_PATTERN.test(request.message.trim())) {
    return startProductConfiguration(null, request.context, incomingReference.templateId);
  }

  // PART 15: an obvious fresh other-domain request is never consumed as a configuration answer -
  // fall through to normal routing (the wrapper below re-attaches this reference afterward).
  if (looksLikeFreshOtherDomainRequest(request.message, request.context)) return null;

  return resumeProductConfiguration(incomingReference, request.message);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// I3: hybrid semantic V2 runtime (flag-gated by NOA_SEMANTIC_V2, default OFF)
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Deterministic fast path first; the V2 classifier runs only for an unresolved (strength "none")
// or page-context-only route - or (I4) a generic_keyword route whose narrow
// isNoaGenericSemanticCandidate() signal fired - with no deterministic protection, and its validated result is turned
// into a decision by the pure router helpers (decideNoaSemanticV2Outcome ->
// resolveNoaSemanticCapabilityRequest). The classifier only ever selects a route and a canonical
// capability phrase - the capability itself still runs through its own existing auth gates below.

// PART 4: an existing conversation-reference follow-up (UserActivity/Project/Client/Procurement/
// Product/Price pronoun or bare follow-up) is deterministic territory - pure checks only, the same
// resolvers the pipeline below already uses, called with no extracted intent.
function hasDeterministicConversationFollowUp(message: string, reference: NoaConversationReference | undefined): boolean {
  if (!reference) return false;
  return Boolean(
    (reference.domain === "UserActivity" && resolveUserActivityFollowUp(message, reference, undefined)) ||
    resolveProjectFollowUp(message, reference, undefined) ||
    resolveClientFollowUp(message, reference, undefined) ||
    resolveProcurementFollowUp(message, reference, undefined) ||
    resolveProductFollowUp(message, reference, undefined) ||
    resolveProductPriceFollowUp(message, reference, undefined),
  );
}

// PART 21: closed enum/status fields only (see NoaRouteDiagnostics) - console only, never persisted.
function logNoaRouteDiagnostics(diagnostics: NoaRouteDiagnostics): void {
  if (!isNoaRouteDiagnosticsEnabled(process.env.NODE_ENV, process.env.NOA_DEBUG_ROUTING)) return;
  console.info("[NOA_ROUTE_DIAG]", JSON.stringify(diagnostics));
}

// PART 7: the ONLY V2 classifier call site - current message + compact page section only (the
// extractor itself never sends recentMessages, DB rows, capability data, or auth data).
// I5: `preExtracted` is the SAME request's classification already obtained by the I5 follow-up
// pre-pass (below) - reused instead of calling the classifier a second time.
async function runNoaSemanticV2(
  request: NoaChatRequest,
  classification: NoaRouteClassification,
  preExtracted?: NoaIntentExtractorV2Result,
): Promise<NoaSemanticV2Decision> {
  let extraction = preExtracted ?? await extractNoaSemanticV2ForRequest(request);
  // A model-only `previous_result` on a fully specified fresh request is not authority to reuse
  // the active reference. I5 binds references only when the message itself proves a follow-up;
  // otherwise let the normal V2 resolver handle the complete request independently.
  if (extraction.stage === "success" &&
    extraction.request.reference === "previous_result" &&
    !isNoaConversationFollowUpCandidate(detectNoaFollowUpCues(request.message))) {
    extraction = { ...extraction, request: { ...extraction.request, reference: "none" } };
  }
  const { decision, diagnostics } = decideNoaSemanticV2Outcome(extraction, classification);
  logNoaRouteDiagnostics(diagnostics);
  return decision;
}

// The ONLY V2 extractor call in this file (shared by runNoaSemanticV2 and the I5 pre-pass, never
// both for one request): current message + compact page section only - I5 adds NO conversation
// context, label, identifier, or prior prose to it (PART 19; deterministic binding below owns it).
async function extractNoaSemanticV2ForRequest(request: NoaChatRequest): Promise<NoaIntentExtractorV2Result> {
  return await extractNoaSemanticRequestV2({ context: request.context, message: request.message });
}

// PART 9/13: clarify/unsupported are fixed resolver text; choices reuse the existing NoaAnswer
// `choices` transport (rendered by the same chat UI buttons GPC-3.1 already uses).
function semanticV2Answer(decision: Extract<NoaSemanticV2Decision, { kind: "answer" }>): NoaAnswer {
  return {
    domain: decision.domain,
    sources: [],
    text: decision.text,
    ...(decision.choices?.length ? { choices: decision.choices } : {}),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// I5: conversation intelligence (flag-gated by NOA_SEMANTIC_V2, like every other V2 behavior)
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// semantic V2 (expresses reference/ordinal/metric/period only) -> bindNoaConversationFollowUp()
// (pure, deterministic referent choice from the ONE stored reference / the page route) ->
// resolveNoaConversationFollowUp() (pure, existing canonical capability phrase) -> the SAME
// capability dispatch below, with its own auth gates. The model never selects an entity.

// The Project capability's own CO parser / the Quotation capability's own QN parser - a label is
// only ever used as an identifier when it is exactly one whole identifier by those parsers.
function isNoaIdentifierLabel(entityType: "quotation" | "project_file", label: string): boolean {
  const trimmed = label.trim();
  if (entityType === "quotation") return quotationIdentifierCount(trimmed) === 1 && quotationStructuredRequest(trimmed)?.quotationNo === trimmed;
  return projectFileIdentifierCount(trimmed) === 1 && projectFileIdentifierFromMessage(trimmed) === trimmed;
}

// I5 PART 8/18: an entity-scoped Catch-Up result remembers only its own already-authorized
// identifier (the capability's `entityIdentifier`), typed by the capability's own QN/CO parsers,
// under that entity's own domain so "what status is it?" / "what changed on it?" keep working.
function buildCatchUpConversationReference(data: unknown): NoaConversationReference | undefined {
  if (!isCatchUpCapabilityData(data) || !data.entityIdentifier) return undefined;
  const label = data.entityIdentifier.trim();
  if (isNoaIdentifierLabel("quotation", label)) return { domain: "Quotation", entities: [{ label, type: "quotation" }], intent: "catch_up" };
  if (isNoaIdentifierLabel("project_file", label)) return { domain: "Project", entities: [{ label, type: "project_file" }], intent: "catch_up" };
  return undefined;
}

type NoaConversationFollowUpOutcome =
  | { kind: "none"; extraction?: NoaIntentExtractorV2Result }
  | { kind: "dispatch"; domain: Exclude<NoaDomain, "Help">; canonicalMessage: string }
  | { kind: "answer"; answer: NoaAnswer };

const NO_CONVERSATION_FOLLOW_UP: NoaConversationFollowUpOutcome = { kind: "none" };

// I5.0.2: quotation history is a closed, deterministic previous-result operation. Keep it ahead
// of the semantic pre-pass so an already-authorized QN reference can never fall through to a
// page/current-state Project route. The stored entity type remains authoritative; the QN parser is
// only a final substitution safety check. CO references never enter this branch.
function resolveQuotationHistoryFollowUp(
  message: string,
  reference: NoaConversationReference | undefined,
): Extract<NoaConversationFollowUpOutcome, { kind: "dispatch" }> | undefined {
  if (reference?.domain !== "Quotation") return undefined;
  const cues = detectNoaFollowUpCues(message);
  if (!cues.history || !cues.entityPronoun) return undefined;
  const binding = bindNoaConversationFollowUp({
    cues,
    isIdentifierLabel: isNoaIdentifierLabel,
    pageEntity: null,
    reference,
    semantic: null,
  });
  const resolution = resolveNoaConversationFollowUp(binding);
  return resolution?.kind === "dispatch" && resolution.domain === "UserActivity" ? resolution : undefined;
}

function logNoaReferenceDiagnostics(diagnostics: ReturnType<typeof buildNoaReferenceDiagnostics>): void {
  if (!isNoaRouteDiagnosticsEnabled(process.env.NODE_ENV, process.env.NOA_DEBUG_ROUTING)) return;
  console.info("[NOA_REFERENCE_DIAG]", JSON.stringify(diagnostics));
}

// PART 3-9/11: the I5 pre-pass. Runs only for a narrow deterministic follow-up shape (see
// isNoaConversationFollowUpCandidate) with something to bind to. The protected Catch-Up route never
// calls the classifier (cues alone decide there); every other route calls it at most once, and a
// failed/unusable classification leaves the existing deterministic pipeline completely in charge
// (PART 21) - the stored reference is never mutated here. A clarification/unsupported answer
// re-emits the SAME (sanitized) incoming reference, so the user can answer it ("the second one").
async function resolveNoaConversationFollowUpTurn(
  request: NoaChatRequest,
  reference: NoaConversationReference | undefined,
  classification: NoaRouteClassification,
): Promise<NoaConversationFollowUpOutcome> {
  const cues = detectNoaFollowUpCues(request.message);
  if (!isNoaConversationFollowUpCandidate(cues)) return NO_CONVERSATION_FOLLOW_UP;

  const pageEntity = noaCurrentPageEntity(
    request.context.pathname ?? "",
    Boolean(request.context.quotationId),
    (label) => isNoaIdentifierLabel("project_file", label),
  );
  const bindable = isNoaBindableConversationReference(reference) ? reference : undefined;
  // C3 keeps owning its own UserActivity follow-ups ("what about yesterday?", "which quotation?").
  if (bindable?.domain === "UserActivity" && resolveUserActivityFollowUp(request.message, bindable, undefined)) return NO_CONVERSATION_FOLLOW_UP;

  const deterministicHistory = classification.rule === "catch_up";
  let extraction: NoaIntentExtractorV2Result | undefined;
  if (deterministicHistory) {
    // Protected Catch-Up route: no classifier call at all - only "it"/"here" history follow-ups.
    if (!cues.entityPronoun && !cues.currentPage) return NO_CONVERSATION_FOLLOW_UP;
  } else {
    // Never an exact/anchored deterministic route - only the same strengths V2 may already touch.
    if (classification.strength !== "none" && classification.strength !== "page_context" && classification.strength !== "generic_keyword") {
      return NO_CONVERSATION_FOLLOW_UP;
    }
    if (!bindable && !cues.currentPage) return NO_CONVERSATION_FOLLOW_UP;
    extraction = await extractNoaSemanticV2ForRequest(request);
    if (extraction.stage !== "success") return { extraction, kind: "none" };
  }

  // I6.3 PART 6: a reference may specialize a compatible semantic request, never repair an
  // incompatible one - an incompatible shape contributes no model slots, so only the user's own
  // deterministic cues can bind. action_requested is still passed through so the binder's own
  // write-request guard keeps firing.
  const extracted = extraction?.request ?? null;
  const bindingSemantic = extracted && (extracted.clarificationReason === "action_requested" || validateNoaSemanticCompatibility(extracted).compatible)
    ? extracted
    : null;
  const binding = bindNoaConversationFollowUp({
    cues,
    isIdentifierLabel: isNoaIdentifierLabel,
    pageEntity,
    reference: bindable,
    semantic: bindingSemantic,
  });
  logNoaReferenceDiagnostics(buildNoaReferenceDiagnostics(bindable, pageEntity, Boolean(extraction), binding));

  const resolution = resolveNoaConversationFollowUp(binding);
  if (!resolution) return { extraction, kind: "none" };
  if (resolution.kind === "dispatch") return resolution;
  return {
    answer: {
      domain: resolution.domain,
      sources: [],
      text: resolution.text,
      ...(resolution.choices?.length ? { choices: resolution.choices } : {}),
      ...(reference ? { conversationReference: reference } : {}),
    },
    kind: "answer",
  };
}

// The one and only dispatch point: classify -> call exactly one capability -> (optionally) phrase
// the result with the provider. No capability ever calls another, and the model never picks which
// capability or query runs - that's fully deterministic, in code, before the provider is invoked.
async function runNoaOrchestratorCore(request: NoaChatRequest): Promise<NoaAnswer> {
  const recordedQuotationFollowUpFrom = recordedQuotationFollowUpReference(request.message, request.recentMessages ?? []);
  const conversationReference = isNoaConversationReference(request.conversationReference)
    ? request.conversationReference
    : undefined;
  const projectReferenceFollowUp = conversationReference?.domain === "Project"
    ? resolveProjectFollowUp(request.message, conversationReference, undefined)
    : undefined;
  const clientReferenceFollowUp = !projectReferenceFollowUp && conversationReference?.domain === "Client"
    ? resolveClientFollowUp(request.message, conversationReference, undefined)
    : undefined;
  const referenceFollowUpRoute = projectReferenceFollowUp ? "Project" : clientReferenceFollowUp ? "Client" : undefined;
  // C4A: resolved BEFORE any route classification/extraction so it can never trigger the semantic
  // extractor (PART 1: "Do NOT use AI") - purely a deterministic parse of the current message
  // against the previous Quotation list reference. Lower priority than an explicit QN identifier
  // (quotationIdentifierTotal, checked first below) or a recorded UserActivity "which quotation?"
  // follow-up - both existing fast paths always win over an ordinal guess.
  const quotationOrdinalFollowUp = conversationReference?.domain === "Quotation"
    ? resolveQuotationOrdinalFollowUp(request.message, conversationReference)
    : undefined;
  // PART 5: an out-of-range ordinal never falls through to Help/the provider - it's a fixed,
  // deterministic clarification, answered immediately without a capability call.
  if (quotationOrdinalFollowUp?.kind === "out_of_range") {
    return {
      domain: "Quotation",
      sources: [],
      text: `There were only ${quotationOrdinalFollowUp.count} quotation${quotationOrdinalFollowUp.count === 1 ? "" : "s"} in the previous list. Choose ${joinQuotationOrdinalChoices(quotationOrdinalFollowUp.count)}.`,
    };
  }
  const quotationMessageOverride = quotationOrdinalFollowUp?.kind === "selected" ? quotationOrdinalFollowUp.rewrittenMessage : undefined;
  const deterministicQuotation = quotationStructuredRequest(request.message);
  const quotationIdentifierTotal = quotationIdentifierCount(request.message);
  const projectFileIdentifierTotal = projectFileIdentifierCount(request.message);
  // N2B2 PART 1: a bare QN/CO identifier used to force Quotation/Project detail unconditionally -
  // the exact collision the B0 audit proved ("what changed on CO-0003-001" landed on Project
  // detail). classifyNoaRoute() already recognizes historical/Catch-Up phrasing ("what changed"/
  // "what happened"/"catch me up") ahead of every other check (N2B1) - reusing that ONE existing
  // call (never a second classifier, never new keyword logic here), a message that BOTH carries
  // an identifier AND reads as historical now defers to it instead of the identifier fast path.
  // Deliberately narrow: this only ever changes behavior when an identifier is actually present -
  // every other precedence tier (quotationMessageOverride, referenceFollowUpRoute's pronoun
  // follow-ups, e.g. "what happened to it?", and classifyNoaRoute's own final-fallback role) is
  // completely untouched, so a bare identifier message ("tell me about QN-0005-001", which
  // classifyNoaRoute alone would route to Help) still falls through to the identifier fast path
  // exactly as before.
  const deterministicRoute = classifyNoaRoute(request.message, request.context);
  const identifierRoute = quotationIdentifierTotal > 0 ? "Quotation" : projectFileIdentifierTotal > 0 ? "Project" : null;

  // I3: route strength for the semantic V2 activation rule. Same pure precedence chain as
  // classifyNoaRoute() above (which returns this classification's `.route`), so routing itself is
  // unchanged; this only adds HOW the route was matched. Every deterministic fast path resolved
  // above (recorded follow-up, QN/CO/order identifiers, ordinal, reference rewrites) plus a generic
  // "tell me about X" entity lookup is a protection that keeps V2 from ever running (PART 4).
  const routeClassification = classifyNoaRouteWithStrength(request.message, request.context);
  const semanticV2FlagEnabled = isNoaSemanticV2FlagEnabled(process.env.NOA_SEMANTIC_V2);
  const quotationHistoryFollowUp = semanticV2FlagEnabled
    ? resolveQuotationHistoryFollowUp(request.message, sanitizeNoaConversationReference(request.conversationReference))
    : undefined;

  // I5: conversation follow-up binding (flag ON only - flag OFF never reaches it). Every existing
  // deterministic fast path above keeps absolute precedence: an explicit QN/CO/order identifier, a
  // recorded-quotation follow-up, or the C4A quotation ordinal rewrite all skip I5 entirely.
  const conversationFollowUp: NoaConversationFollowUpOutcome = quotationHistoryFollowUp ?? (semanticV2FlagEnabled &&
    !recordedQuotationFollowUpFrom &&
    !quotationOrdinalFollowUp &&
    !identifierRoute &&
    !PROCUREMENT_ORDER_TOKEN_PATTERN.test(request.message)
    ? await resolveNoaConversationFollowUpTurn(request, sanitizeNoaConversationReference(request.conversationReference), routeClassification)
    : NO_CONVERSATION_FOLLOW_UP);
  if (conversationFollowUp.kind === "answer") return conversationFollowUp.answer;
  const conversationDispatch = conversationFollowUp.kind === "dispatch" ? conversationFollowUp : undefined;

  const route = recordedQuotationFollowUpFrom
    ? "UserActivity"
    : conversationDispatch
      ? conversationDispatch.domain
      : identifierRoute && deterministicRoute !== "UserActivity"
        ? identifierRoute
        : quotationMessageOverride
          ? "Quotation"
          : referenceFollowUpRoute ?? deterministicRoute;

  const semanticV2ProtectedReason: NoaSemanticV2ProtectedReason | null = recordedQuotationFollowUpFrom
    ? "recorded_quotation_follow_up"
    : identifierRoute || PROCUREMENT_ORDER_TOKEN_PATTERN.test(request.message)
      ? "identifier"
      : quotationOrdinalFollowUp
        ? "ordinal_follow_up"
        : referenceFollowUpRoute || hasDeterministicConversationFollowUp(request.message, conversationReference)
          ? "reference_follow_up"
          : entityLookupCandidate(request.message)
            ? "entity_lookup_candidate"
            : null;
  // I4: a generic_keyword route becomes eligible only when this pure, narrow intent-shape signal
  // fires (never generic_keyword in general); every protection above still wins first.
  const genericSemanticCandidate = isNoaGenericSemanticCandidate(request.message, routeClassification);
  // I5: a bound follow-up already has its deterministic destination - no second V2 decision.
  const semanticV2Eligibility: NoaSemanticV2Eligibility = conversationDispatch
    ? { eligible: false, reason: "conversation_reference_bound" }
    : noaSemanticV2Eligibility({
        classification: routeClassification,
        flagEnabled: semanticV2FlagEnabled,
        genericSemanticCandidate,
        protectedReason: semanticV2ProtectedReason,
      });
  if (!semanticV2Eligibility.eligible) {
    logNoaRouteDiagnostics(buildNoaRouteDiagnostics(routeClassification, undefined, semanticV2Eligibility.reason, genericSemanticCandidate));
  }
  // At most ONE semantic classification per request (PART 23): once V2 has been attempted, the V1
  // extractor below is skipped for this message. I5: the pre-pass above counts as that attempt
  // (its extraction, if any, is reused by runNoaSemanticV2 below rather than repeated).
  let semanticV2Attempted = conversationFollowUp.kind === "dispatch" || conversationFollowUp.extraction !== undefined;
  const semanticV2PreExtraction = conversationFollowUp.kind === "none" ? conversationFollowUp.extraction : undefined;
  let semanticV2Dispatch: Extract<NoaSemanticV2Decision, { kind: "dispatch" }> | undefined = conversationDispatch
    ? { canonicalMessage: conversationDispatch.canonicalMessage, domain: conversationDispatch.domain, kind: "dispatch" }
    : undefined;

  // NOA self/page-context questions ("where am I", "which page is this") are answered directly
  // from NoaPageContext - never a capability call, never the AI provider. Not exposed as a
  // user-facing domain (PART 1): the badge shown is the existing Help domain.
  if (route === "context") {
    return { domain: "Help", sources: [], text: describeNoaPageContext(request.context) };
  }

  // Conversation polish: a pure greeting gets a short, personalized reply - never a capability
  // call, never the AI provider (same "fixed, fast, no model call" pattern as "context"/Help).
  if (route === "greeting") {
    return { domain: "Help", sources: [], text: greetingResponseText(request.message, request.displayName) };
  }

  // Conversation polish: NOA's capability list is shown ONLY for this explicit route, never on
  // every Help/out-of-scope fallback.
  if (route === "capabilities") {
    return { domain: "Help", sources: [], text: NOA_CAPABILITY_SUMMARY_TEXT };
  }

  // I3 PART 5/18: an eligible non-Help route is a page_context route or a client-ranking cue the
  // generic keyword lists only matched incidentally (strength "none"), or (I4) a generic_keyword
  // route whose genericSemanticCandidate signal fired. A fallback decision keeps `route` exactly as
  // the deterministic router chose it, so the original keyword capability still runs.
  if (semanticV2Eligibility.eligible && route !== "Help") {
    semanticV2Attempted = true;
    const decision = await runNoaSemanticV2(request, routeClassification, semanticV2PreExtraction);
    if (decision.kind === "answer") return semanticV2Answer(decision);
    if (decision.kind === "dispatch") semanticV2Dispatch = decision;
  }

  // C2/C3 hybrid routing: only for a message already deterministically routed to UserActivity, or
  // one that fell all the way through to "Help" (unresolved) and might semantically be a
  // UserActivity question. Never runs for any other clear domain (Product/Price/Quotation/
  // Project/Client/Procurement/Admin/Insights already returned above or matched deterministically
  // below) and never for the already-resolved recordedQuotationFollowUpFrom case. At most one
  // extractor call per request. Any failure or non-UserActivity/unsupported-intent result is
  // silently ignored - the existing deterministic route/fallback is preserved exactly (PART 9).
  let semanticRequest: NoaSemanticRequest | undefined = projectReferenceFollowUp?.semanticRequest ?? clientReferenceFollowUp?.semanticRequest;
  let projectMessageOverride: string | undefined = projectReferenceFollowUp?.rewrittenMessage;
  let clientMessageOverride: string | undefined = clientReferenceFollowUp?.rewrittenMessage;
  let procurementMessageOverride: string | undefined;
  let productMessageOverride: string | undefined;
  if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help")) {
    const genericEntityCandidate = route === "Help" ? entityLookupCandidate(request.message) : null;
    if (genericEntityCandidate) {
      const resolved = await resolveNoaEntityCandidate(genericEntityCandidate);
      if (resolved.domain === "Project" || resolved.domain === "Client") {
        semanticRequest = { domain: resolved.domain, entity: resolved.entity, intent: "unsupported" };
      } else if (resolved.domain === "ambiguous") {
        return { domain: "Help", sources: [], text: `I found both a Project File and a Client matching "${genericEntityCandidate}". Which one do you mean?` };
      }
    }

    if (!semanticRequest && route === "Help") {
      const productResolution = await resolveNoaProductCandidate(genericEntityCandidate ?? request.message);
      if (productResolution.kind === "resolved") {
        semanticRequest = { domain: "Product", intent: "unsupported", product: productResolution.product };
      } else if (productResolution.kind === "ambiguous") {
        return { domain: "Help", sources: [], text: "I found more than one matching product in the Product Library. Please provide a more specific product name or code." };
      }
    }

    // I3 PART 5/6/23: an unresolved Help fallback (strength "none", never explicit Help/how-to/
    // off-topic) goes to V2 instead of V1 when the flag is on - only after the existing
    // deterministic product-candidate check above found nothing, so its resolved/ambiguous
    // outcomes keep precedence. A V2 fallback decision simply continues this existing path with
    // V1 skipped (no second classification), ending at the same Help answer as before.
    if (!semanticRequest && route === "Help" && semanticV2Eligibility.eligible) {
      semanticV2Attempted = true;
      const decision = await runNoaSemanticV2(request, routeClassification, semanticV2PreExtraction);
      if (decision.kind === "answer") return semanticV2Answer(decision);
      if (decision.kind === "dispatch") semanticV2Dispatch = decision;
    } else if (semanticRequest && route === "Help" && semanticV2Eligibility.eligible) {
      logNoaRouteDiagnostics(buildNoaRouteDiagnostics(routeClassification, undefined, "deterministic_candidate_resolved"));
    }

    // I3 PART 16: with the flag on, a protected Catch-Up message is never handed to the V1
    // extractor either, so V1's semantic UserActivity override can never preempt Catch-Up. Flag
    // off: unchanged.
    const skipV1Extraction = semanticV2Attempted || (semanticV2FlagEnabled && routeClassification.rule === "catch_up");
    const extracted = semanticRequest || skipV1Extraction
      ? { domain: "Unclear" as const, intent: "unsupported" as const }
      : await extractNoaSemanticRequest({ context: request.context, message: request.message });

    if (!semanticRequest && route === "Help" && !genericEntityCandidate && extracted.entity?.type === "unknown") {
      const resolved = await resolveNoaEntityCandidate(extracted.entity.text);
      if (resolved.domain === "Project" || resolved.domain === "Client") {
        semanticRequest = { domain: resolved.domain, entity: resolved.entity, intent: extracted.intent };
      } else if (resolved.domain === "ambiguous") {
        return { domain: "Help", sources: [], text: `I found both a Project File and a Client matching "${extracted.entity.text}". Which one do you mean?` };
      }
    }

    // C3: a follow-up-shaped message is only ever resolved against a valid UserActivity
    // conversationReference - never any other domain's stale reference (PART 9). Subject/period
    // still flow through the normal capability auth gate below; nothing here grants access.
    if (conversationReference?.domain === "UserActivity") {
      semanticRequest = resolveUserActivityFollowUp(request.message, conversationReference, extracted.intent);
    }

    if (!semanticRequest && extracted.domain === "UserActivity" && SUPPORTED_SEMANTIC_INTENTS.has(extracted.intent)) {
      semanticRequest = {
        ...extracted,
        subject: resolveNoaSemanticSubject(request.message, extracted.subject),
        period: resolveNoaSemanticPeriod(request.message, extracted.period),
      };
    }

    // C4A: a Quotation-domain classification reroutes Help too - e.g. a bare "what is QN-0005-001
    // worth"/"what status is QN-0005-001" has no domain keyword the deterministic router
    // recognizes, but does contain an identifier the extractor (and, once routed, the Quotation
    // capability's own existing text parsing) can recognize. No intent gate here - unlike
    // UserActivity, the Quotation capability re-derives its own question kind from the message
    // text regardless of which intent value the extractor picked, so any confident Quotation
    // domain classification is enough to route there; the capability's own existing ambiguous/
    // not-found handling stays the safety net if the message turns out not to be answerable.
    if (!semanticRequest && extracted.domain === "Quotation") {
      semanticRequest = {
        domain: "Quotation",
        intent: extracted.intent,
        ...(extracted.quotation ? { quotation: extracted.quotation } : {}),
      };
    }

    // C4B: a pronoun-shaped Project follow-up ("what status is it?") only ever resolves against a
    // valid Project conversationReference - never any other domain's stale reference. Checked
    // before the plain domain-only reroute so a resolved follow-up always wins.
    if (!semanticRequest && conversationReference?.domain === "Project") {
      const resolved = resolveProjectFollowUp(request.message, conversationReference, extracted.intent);
      if (resolved) {
        semanticRequest = resolved.semanticRequest;
        projectMessageOverride = resolved.rewrittenMessage;
      }
    }

    // C4B: a Project-domain classification reroutes Help too - e.g. "tell me about ABC" has no
    // domain keyword the deterministic router recognizes, but the extractor (and, once routed, the
    // Project capability's own text parsing) can. Same domain-only, no-intent-gate shape as
    // Quotation's C4A reroute.
    if (!semanticRequest && extracted.domain === "Project") {
      semanticRequest = {
        domain: "Project",
        intent: extracted.intent,
        ...(extracted.entity?.type === "project_file" || extracted.entity?.type === "unknown" ? { entity: { type: "project_file" as const, text: extracted.entity.text } } : {}),
      };
    }

    // C4C: a Client follow-up ("what projects do they have?", "how many projects?") only ever
    // resolves against a valid Client conversationReference - never any other domain's stale
    // reference. Checked before the plain domain-only reroute so a resolved follow-up always wins.
    if (!semanticRequest && conversationReference?.domain === "Client") {
      const resolved = resolveClientFollowUp(request.message, conversationReference, extracted.intent);
      if (resolved) {
        semanticRequest = resolved.semanticRequest;
        clientMessageOverride = resolved.rewrittenMessage;
      }
    }

    // C4C: a Client-domain classification reroutes Help too - e.g. "what projects does Apex have"
    // has no domain keyword the deterministic router recognizes. Same domain-only, no-intent-gate
    // shape as Quotation/Project's C4A/C4B reroutes.
    if (!semanticRequest && extracted.domain === "Client") {
      semanticRequest = {
        domain: "Client",
        intent: extracted.intent,
        ...(extracted.entity?.type === "client" || extracted.entity?.type === "unknown" ? { entity: { type: "client" as const, text: extracted.entity.text } } : {}),
      };
    }

    // C4C: a Procurement follow-up ("what is the ETA?") only ever resolves against a valid
    // Procurement conversationReference - never any other domain's stale reference.
    if (!semanticRequest && conversationReference?.domain === "Procurement") {
      const resolved = resolveProcurementFollowUp(request.message, conversationReference, extracted.intent);
      if (resolved) {
        semanticRequest = resolved.semanticRequest;
        procurementMessageOverride = resolved.rewrittenMessage;
      }
    }

    // C4C: a Procurement-domain classification reroutes Help too - e.g. "what stage is CO-0003-001
    // at" has no domain keyword the deterministic router recognizes, but the Procurement
    // capability's own existing bare-order-token fallback can already answer it once routed there.
    if (!semanticRequest && extracted.domain === "Procurement") {
      semanticRequest = { domain: "Procurement", intent: extracted.intent };
    }

    // C4D: a Product follow-up ("is it active?", "what brand is it?") only ever resolves against
    // a valid single-product Product conversationReference - never any other domain's stale
    // reference, and never a multi-item list reference (PART 2).
    if (!semanticRequest && conversationReference?.domain === "Product") {
      const resolved = resolveProductFollowUp(request.message, conversationReference, extracted.intent);
      if (resolved) {
        semanticRequest = resolved.semanticRequest;
        productMessageOverride = resolved.rewrittenMessage;
      }
    }

    // C4D: a Product-domain classification reroutes Help too - e.g. "show LAS chairs" has no
    // domain keyword the deterministic router recognizes. Same domain-only, no-intent-gate shape
    // as every other C4 reroute (PART 7: Price is a separate, later check below, so a confident
    // Price classification is never collapsed into Product here).
    if (!semanticRequest && extracted.domain === "Product") {
      semanticRequest = { domain: "Product", intent: extracted.intent, ...(extracted.product ? { product: extracted.product } : {}) };
    }

    // C4D: a Price follow-up ("when was it checked?") only ever resolves against a valid
    // single-product Price conversationReference.
    if (!semanticRequest && conversationReference?.domain === "Price") {
      const resolved = resolveProductPriceFollowUp(request.message, conversationReference, extracted.intent);
      if (resolved) {
        semanticRequest = resolved.semanticRequest;
        productMessageOverride = resolved.rewrittenMessage;
      }
    }

    // C4D: a Price-domain classification reroutes Help too - checked after the Product domain
    // check above (PART 7), so an extractor classification of "Price" is never collapsed into a
    // Product reroute; both are still gated on the extractor's own independent domain enum value.
    if (!semanticRequest && extracted.domain === "Price") {
      semanticRequest = { domain: "Price", intent: extracted.intent, ...(extracted.product ? { product: extracted.product } : {}) };
    }
  }

  // A resolved semantic request reroutes an otherwise-unresolved "Help" message to that request's
  // own domain; it never overrides any other already-resolved domain. The `!== "Unclear"` check
  // is a type narrowing only - semanticRequest is never actually set to "Unclear" above (only to
  // a real "UserActivity"/"Quotation" domain), since UNCLEAR_SEMANTIC_REQUEST is filtered out by
  // the SUPPORTED_SEMANTIC_INTENTS/domain checks before semanticRequest is ever assigned.
  const effectiveRoute = route === "Help" && semanticRequest && semanticRequest.domain !== "Unclear"
    ? semanticRequest.domain
    : route;

  // Help/out-of-scope never reaches a capability or the AI provider at all - it's a fixed,
  // deterministic redirect back to what NOA can actually do.
  // I3 PART 9: a V2 dispatch selects the resolver's own deterministic domain (never "Help", never a
  // model-supplied name); everything else keeps the existing effectiveRoute.
  const dispatchRoute = semanticV2Dispatch ? semanticV2Dispatch.domain : effectiveRoute;
  if (dispatchRoute === "Help") {
    return { domain: "Help", sources: [], text: HELP_ANSWER_TEXT };
  }

  const domain = dispatchRoute;

  // I5: a bound follow-up's canonical phrase is the ONLY capability input - a C4 pronoun rewrite
  // computed above from the raw follow-up wording ("how much did client X confirm") can never
  // override it or double-bind the same message.
  if (conversationDispatch) {
    semanticRequest = undefined;
    projectMessageOverride = undefined;
    clientMessageOverride = undefined;
    procurementMessageOverride = undefined;
    productMessageOverride = undefined;
  }

  // I3 PART 10/11: the SAME capability functions below receive the resolver's canonical phrase as
  // their message (e.g. "top clients by quotation value") - nothing else about the request changes
  // (context, auth, the capability's own permission gates are untouched). The user's original
  // wording is kept for provider phrasing only.
  const originalMessage = request.message;
  if (semanticV2Dispatch) {
    request = { ...request, message: semanticV2Dispatch.canonicalMessage };
  }

  const capabilityResult = domain === "Product"
    ? await fetchNoaProductCapability(productMessageOverride ?? request.message, request.context, semanticRequest?.domain === "Product" ? { product: semanticRequest.product } : undefined)
    : domain === "Quotation"
      ? await fetchNoaQuotationCapability(quotationMessageOverride ?? request.message, request.context, {
          quotation: deterministicQuotation ?? (semanticRequest?.domain === "Quotation" ? semanticRequest.quotation : undefined),
        })
      : domain === "Project"
        ? await fetchNoaProjectCapability(projectMessageOverride ?? request.message, request.context, {
            entity: semanticRequest?.entity?.type === "project_file" ? semanticRequest.entity : undefined,
          })
        : domain === "Client"
        ? await fetchNoaClientCapability(clientMessageOverride ?? request.message, request.context, {
            entity: semanticRequest?.entity?.type === "client" ? semanticRequest.entity : undefined,
          })
          : domain === "Procurement"
            ? await fetchNoaProcurementCapability(procurementMessageOverride ?? request.message, request.context)
            : domain === "UserActivity"
              ? await fetchNoaUserActivityCapability(request.message, request.context, {
                  conversationReference,
                  recordedQuotationFollowUpFrom: recordedQuotationFollowUpFrom ?? undefined,
                  semanticRequest,
                })
              : domain === "Admin"
                ? await fetchNoaAdminCapability(request.message, request.context)
                : domain === "Insights"
                  ? await fetchNoaInsightsCapability(request.message, request.context)
                  : domain === "Attention"
                    ? await fetchNoaAttentionCapability(request.message, request.context)
                    : await fetchNoaPriceCapability(productMessageOverride ?? request.message, request.context, semanticRequest?.domain === "Price" ? { product: semanticRequest.product } : undefined);

  if (!capabilityResult.ok) {
    // Unauthorized / not-found / ambiguous: return the capability's own safe copy directly,
    // without spending a provider call on something the model can't help with anyway. I5 keeps
    // the previous sanitized reference because a failed read produced no newer authorized result
    // that could safely replace it; flag OFF retains the pre-I5 clearing behavior.
    const preservedConversationReference = semanticV2FlagEnabled
      ? sanitizeNoaConversationReference(conversationReference)
      : undefined;
    return { conversationReference: preservedConversationReference, domain, sources: [], text: capabilityResult.message };
  }

  // C3/C4A: built ONLY from this successful, already-authorized capabilityData (PART 2/10) -
  // never from provider text, never sent into the provider payload below (PART 12: capabilityData
  // remains the only source of business facts for the model).
  // I5 PART 17/18 (flag ON only): Insights (client ranking / quotation analytics) and entity-scoped
  // Catch-Up results now also create a reference; still exactly ONE active reference. The newest
  // useful authorized result replaces it; when this result cannot create a useful reference, I5
  // preserves the previous sanitized one. Flag OFF retains the pre-I5 clearing behavior.
  const freshConversationReference = domain === "UserActivity"
    ? buildUserActivityConversationReference(semanticRequest, capabilityResult.data) ??
      (semanticV2FlagEnabled ? buildCatchUpConversationReference(capabilityResult.data) : undefined)
    : semanticV2FlagEnabled && domain === "Insights"
      ? buildNoaInsightsConversationReference(capabilityResult.data)
      : domain === "Quotation"
      ? buildQuotationConversationReference(capabilityResult.data)
      : domain === "Project"
        ? buildProjectConversationReference(capabilityResult.data)
        : domain === "Client"
          ? buildClientConversationReference(capabilityResult.data)
          : domain === "Procurement"
            ? buildProcurementConversationReference(capabilityResult.data)
            : domain === "Product"
              ? buildProductConversationReference(capabilityResult.data)
              : domain === "Price"
                ? buildPriceConversationReference(capabilityResult.data)
                : undefined;
  const newConversationReference = freshConversationReference ??
    (semanticV2FlagEnabled ? sanitizeNoaConversationReference(conversationReference) : undefined);

  const deterministicData = typeof capabilityResult.data === "object" && capabilityResult.data !== null
    ? capabilityResult.data as { deterministicOnly?: unknown; deterministicText?: unknown }
    : null;
  // Attention structured UI: the SAME already-authorized `items`/`count` the deterministic text
  // was built from, reshaped into the small transport-safe shape (never the internal-only `key`,
  // never a DB uuid) - computed only for a real Attention answer that actually has the `attention`
  // capability's own data shape, so every other domain's deterministicOnly answer (UserActivity's
  // attendance/Catch-Up/etc.) is completely unaffected. The client never parses `text` to recover
  // this - it's the exact same array the prose was generated from, just re-shaped.
  const attention = domain === "Attention" && isAttentionCapabilityData(capabilityResult.data)
    ? {
        count: capabilityResult.data.count,
        items: capabilityResult.data.items.map((item) => ({
          detail: item.detail,
          entityIdentifier: item.entityIdentifier,
          entityLabel: item.entityLabel,
          kind: item.kind,
          sourceDomain: item.sourceDomain,
          title: item.title,
        })),
      }
    : undefined;
  // N2B3.4: the SAME already-fetched `items`/counts the deterministic text was built from,
  // reshaped into the small transport-safe shape (never the internal-only `key`, never a DB
  // uuid) - computed only for a real Catch-Up answer. `groupCount` is the TOTAL consolidated
  // group count (displayed + truncated), matching the "X activity groups" figure the deterministic
  // text's own capNote already describes - pure arithmetic on already-authoritative fields, never
  // a client-side recount. The client never parses `text` to recover any of this.
  const catchUp = domain === "UserActivity" && isCatchUpCapabilityData(capabilityResult.data)
    ? {
        ...(capabilityResult.data.entityIdentifier
          ? { entityIdentifier: capabilityResult.data.entityIdentifier, heading: capabilityResult.data.entityIdentifier }
          : {}),
        groupCount: capabilityResult.data.returnedCount + capabilityResult.data.truncatedCount,
        items: capabilityResult.data.items.map((item) => ({
          action: item.action,
          ...(item.actorLabel && item.actorLabel !== CATCH_UP_UNRESOLVED_ACTOR_LABEL ? { actorLabel: item.actorLabel } : {}),
          ...(item.changes?.length ? { changes: item.changes } : {}),
          ...(item.detail ? { detail: item.detail } : {}),
          entityType: item.entityType,
          occurredAt: item.occurredAt,
          ...(item.occurrenceCount ? { occurrenceCount: item.occurrenceCount } : {}),
          title: item.title,
        })),
        rawEventCount: capabilityResult.data.totalMatching,
      }
    : undefined;
  // N2C1.1: reshaped from the SAME already-computed capabilityResult.data every Insights answer
  // already returns (see noa-insights-capability.server.ts, untouched by this phase) - never
  // parsed from `deterministicText`. Computed unconditionally (like attention/catchUp above) so it
  // reaches the client regardless of which return path below is taken - quotation_trend/
  // quotation_summary don't set deterministicOnly and would otherwise only ever hit the provider
  // path, where this transport would never be attached.
  const analytics = buildAnalyticsTransport(domain, capabilityResult.data);
  if (deterministicData?.deterministicOnly === true && typeof deterministicData.deterministicText === "string") {
    return { analytics, attention, catchUp, conversationReference: newConversationReference, domain, sources: capabilityResult.sources, text: deterministicData.deterministicText };
  }

  try {
    const { text } = await runNoaProvider({
      capabilityData: capabilityResult.data,
      context: request.context,
      displayName: request.displayName,
      domain,
      message: originalMessage,
      recentMessages: request.recentMessages ?? [],
    });
    return { analytics, conversationReference: newConversationReference, domain, sources: capabilityResult.sources, text };
  } catch (error) {
    const deterministicText = typeof capabilityResult.data === "object" && capabilityResult.data !== null
      && "deterministicText" in capabilityResult.data && typeof capabilityResult.data.deterministicText === "string"
      ? capabilityResult.data.deterministicText.trim()
      : "";
    if (deterministicText) return { analytics, conversationReference: newConversationReference, domain, sources: capabilityResult.sources, text: deterministicText };
    throw error;
  }
}

// PART 15/20: the real public entry point. Configuration start/resume/cancel/start-over is
// intercepted FIRST and short-circuits entirely (its own reference handling, never touching
// runNoaOrchestratorCore's routing at all). Otherwise the existing core pipeline runs completely
// unchanged, and - only when an active configuration reference came in AND the core's own answer
// didn't already return one of its own - that reference is re-attached to the outgoing answer, so
// an ordinary unrelated request (PART 15) never silently drops an in-progress configuration. This
// is the ENTIRE passthrough mechanism: no other line in runNoaOrchestratorCore was touched to
// achieve it.
export async function runNoaOrchestrator(request: NoaChatRequest): Promise<NoaAnswer> {
  const configurationAnswer = await maybeHandleProductConfigurationTurn(request);
  if (configurationAnswer) return configurationAnswer;

  const answer = await runNoaOrchestratorCore(request);
  const incomingConfigurationReference = isNoaProductConfigurationReference(request.productConfigurationReference)
    ? request.productConfigurationReference
    : undefined;
  if (incomingConfigurationReference && answer.productConfigurationReference === undefined) {
    return { ...answer, productConfigurationReference: incomingConfigurationReference };
  }
  return answer;
}
