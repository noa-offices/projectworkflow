// C1: the structured semantic layer NOA's intent extractor produces and the subject/period
// resolver refines. Pure, dependency-free (no "@/..." imports, no database client, no auth) so
// it stays
// unit-testable with the plain Node test runner, same convention as lib/noa/noa-types.ts and
// lib/noa/noa-intent-router.ts.
//
// This type is deliberately business-fact-free: no counts, prices, statuses, or database IDs -
// only enough structure to say WHAT the user is asking about (domain/intent), WHO it's about
// (subject), WHEN (period), and whether it refers back to something already discussed
// (entityReference). Turning that into an actual authorized answer is entirely the job of the
// existing deterministic capability/auth layer in later phases - this file has no opinion on it.

import type { NoaDomain } from "./noa-types";

export type NoaSemanticIntent =
  | "recorded_activity"
  | "activity_time"
  | "recent_presence"
  | "follow_up"
  | "unsupported";

export type NoaSemanticSubject =
  | { type: "self" }
  | { type: "named_user"; name: string }
  | { type: "team" };

export type NoaSemanticPeriod =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7_days"
  | "this_month";

export type NoaSemanticEntityReference = {
  type: string;
  value?: string;
  fromPreviousResult?: boolean;
};

export type NoaSemanticQuotation = {
  quotationNo: string;
  request: "detail" | "total" | "status";
};

// Candidate text only: the extractor never supplies IDs, rows, prices, or status facts.
export type NoaSemanticProduct = {
  productText?: string;
  brandText?: string;
  categoryText?: string;
};

export type NoaSemanticEntity =
  | { type: "unknown"; text: string }
  | { type: "project_file"; text: string }
  | { type: "client"; text: string };

export type NoaSemanticRequest = {
  domain: NoaDomain | "Unclear";
  intent: NoaSemanticIntent;
  subject?: NoaSemanticSubject;
  period?: NoaSemanticPeriod;
  entityReference?: NoaSemanticEntityReference;
  metric?: string;
  followUp?: boolean;
  quotation?: NoaSemanticQuotation;
  product?: NoaSemanticProduct;
  entity?: NoaSemanticEntity;
};

// The safe, deterministic result for any extraction failure (malformed provider output, schema
// mismatch, provider error, parse error) - never an answer-generation error. A caller receiving
// this should fall back to the existing deterministic router/clarification, never guess.
export const UNCLEAR_SEMANTIC_REQUEST: NoaSemanticRequest = {
  domain: "Unclear",
  intent: "unsupported",
};

const NOA_SEMANTIC_INTENTS: ReadonlySet<string> = new Set<NoaSemanticIntent>([
  "recorded_activity",
  "activity_time",
  "recent_presence",
  "follow_up",
  "unsupported",
]);

const NOA_SEMANTIC_PERIODS: ReadonlySet<string> = new Set<NoaSemanticPeriod>([
  "today",
  "yesterday",
  "this_week",
  "last_7_days",
  "this_month",
]);

// Mirrors NoaDomain's literal members plus "Unclear" - kept as a small local runtime set (rather
// than importing one from noa-types.ts, which only exports the type) purely for validating
// untrusted provider JSON; NoaDomain itself remains the single source of truth for the type.
const NOA_SEMANTIC_DOMAINS: ReadonlySet<string> = new Set<NoaDomain | "Unclear">([
  "Product", "Quotation", "Price", "Project", "Client", "Procurement",
  "UserActivity", "Admin", "Insights", "Help", "Unclear",
]);

function isNoaSemanticSubjectShape(value: unknown): value is NoaSemanticSubject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "self" || candidate.type === "team") return true;
  if (candidate.type === "named_user") {
    return typeof candidate.name === "string" && candidate.name.trim().length > 0;
  }
  return false;
}

function isNoaSemanticEntityReferenceShape(value: unknown): value is NoaSemanticEntityReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !candidate.type.trim()) return false;
  if (candidate.value !== undefined && typeof candidate.value !== "string") return false;
  if (candidate.fromPreviousResult !== undefined && typeof candidate.fromPreviousResult !== "boolean") return false;
  return true;
}

function isNoaSemanticQuotationShape(value: unknown): value is NoaSemanticQuotation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.quotationNo === "string"
    && candidate.quotationNo.trim().length > 0
    && candidate.quotationNo.trim().length <= 80
    && (candidate.request === "detail" || candidate.request === "total" || candidate.request === "status");
}

function isNoaSemanticProductShape(value: unknown): value is NoaSemanticProduct {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const values = [candidate.productText, candidate.brandText, candidate.categoryText];
  return values.every((text) => text === undefined || (typeof text === "string" && text.trim().length > 0 && text.trim().length <= 160))
    && values.some((text) => typeof text === "string");
}

function isNoaSemanticEntityShape(value: unknown): value is NoaSemanticEntity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.type === "unknown" || candidate.type === "project_file" || candidate.type === "client")
    && typeof candidate.text === "string"
    && candidate.text.trim().length > 0
    && candidate.text.trim().length <= 160;
}

// Strict, closed-shape validation for untrusted provider JSON - anything that doesn't fully
// conform is not a NoaSemanticRequest at all (the caller should treat it as UNCLEAR_SEMANTIC_REQUEST
// rather than trusting a partially-matching object).
export function isNoaSemanticRequest(value: unknown): value is NoaSemanticRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.domain !== "string" || !NOA_SEMANTIC_DOMAINS.has(candidate.domain)) return false;
  if (typeof candidate.intent !== "string" || !NOA_SEMANTIC_INTENTS.has(candidate.intent)) return false;
  if (candidate.subject !== undefined && !isNoaSemanticSubjectShape(candidate.subject)) return false;
  if (candidate.period !== undefined && (typeof candidate.period !== "string" || !NOA_SEMANTIC_PERIODS.has(candidate.period))) return false;
  if (candidate.entityReference !== undefined && !isNoaSemanticEntityReferenceShape(candidate.entityReference)) return false;
  if (candidate.metric !== undefined && typeof candidate.metric !== "string") return false;
  if (candidate.followUp !== undefined && typeof candidate.followUp !== "boolean") return false;
  if (candidate.quotation !== undefined && !isNoaSemanticQuotationShape(candidate.quotation)) return false;
  if (candidate.product !== undefined && !isNoaSemanticProductShape(candidate.product)) return false;
  if (candidate.entity !== undefined && !isNoaSemanticEntityShape(candidate.entity)) return false;

  return true;
}

// ============================================================================================
// I1: NoaSemanticRequest V2 - additive only. V1 (above) remains the runtime-active contract; no
// existing caller changes behavior. V2 exists so the extractor's JSON schema can be genuinely
// provider-strict-compatible (I0.5 proved the V1 schema is rejected by OpenAI's strict mode
// because optional nested properties are missing from their own object's `required`) and so the
// intent/entity/metric vocabulary can grow to match what the deterministic capabilities actually
// support (I0's coverage matrix), without touching the V1 shape any running code depends on.
//
// Design rules carried over from I0/I0.5 (see PART 18 of the I1 task): the wire schema is flat
// (no nested objects at all), every root property is listed in `required`, optional semantics are
// expressed as a nullable union rather than omission, and nothing resembling a length constraint
// lives in the wire schema - lengths and cross-field rules (e.g. subject/subjectName) are enforced
// here in TypeScript instead. V2 is never used by the orchestrator/router/capabilities yet.
// ============================================================================================

export const NOA_SEMANTIC_REQUEST_V2_VERSION = 2 as const;

export type NoaSemanticIntentV2 =
  | "lookup"
  | "list"
  | "count"
  | "aggregate"
  | "rank"
  | "compare"
  | "trend"
  | "history"
  | "attention"
  | "activity"
  | "activity_time"
  | "presence"
  | "howto"
  | "unsupported";

// Candidate text only - never an identifier. Deliberately excludes DB table names (e.g.
// "project_files", "quotation_items") and excludes "payment" (I0 PART 5: Attention payment
// findings are not a standalone semantic entity today - nothing resolves a bare "payment" lookup).
export type NoaSemanticEntityTypeV2 =
  | "quotation"
  | "project_file"
  | "client"
  | "product"
  | "brand"
  | "product_category"
  | "supplier"
  | "procurement_order"
  | "user"
  | "role"
  | "ai_provider"
  | "ai_agent";

// Every value here is already computed by an existing deterministic capability (I0 PART 9) -
// conversion/win rate, revenue, margin, profit and performance/target metrics are deliberately
// excluded because no capability has an authoritative business definition for them.
export type NoaSemanticMetricV2 =
  | "quotation_count"
  | "quotation_value"
  | "average_quotation_value"
  | "confirmed_count"
  | "confirmed_value"
  | "project_file_count"
  | "project_file_value"
  | "client_count"
  | "product_count"
  | "price_status_count"
  | "procurement_order_count"
  | "active_time";

// Every value maps onto an existing lib/insights/date-ranges.ts DateRangeKey ("last_7_days" ->
// "7d"): no period is included here unless resolveDateRange() already supports it. Named-month
// parsing ("compare with August") remains unsupported - I1 does not invent date arithmetic.
export type NoaSemanticPeriodV2 =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7_days"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "this_year";

export type NoaSemanticReferenceV2 = "none" | "previous_result" | "current_page";

export type NoaSemanticOrdinalV2 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | "last";

export type NoaSemanticSortDirectionV2 = "asc" | "desc";

export type NoaSemanticSubjectKindV2 = "self" | "team" | "named_user";

// Sourced from noa-quotation-capability.server.ts's own QuotationStatusIntent: "waiting" is
// deliberately excluded because that capability comments it is "intentionally not assigned a
// business status until that relationship is defined" - it is a recognized alias that never maps
// to a real persisted status, so it is not a genuine closed semantic value.
export type NoaSemanticQuotationStatusV2 = "draft" | "client_confirmed";

// Sourced from noa-project-capability.server.ts's own ProjectFileStatus union.
export type NoaSemanticProjectFileStatusV2 = "active" | "completed" | "cancelled";

// Sourced from noa-price-capability.server.ts's own PriceStatusKey/STATUS_ALIASES - the complete
// set of statuses that capability already recognizes and filters by.
export type NoaSemanticPriceStatusV2 = "current" | "needs_check" | "due" | "scheduled" | "checked" | "no_price_list_date";

// Sourced from noa-procurement-capability.server.ts's own order-status derivation.
export type NoaSemanticProcurementStatusV2 = "active" | "completed";

// Sourced verbatim from noa-types.ts's own NoaAttentionSourceDomain/kind values as produced by
// noa-attention-capability.server.ts - no new finding kind is invented here.
export type NoaSemanticAttentionKindV2 =
  | "price_needs_check"
  | "price_due"
  | "procurement_missing_eta"
  | "procurement_missing_etd"
  | "payment_overdue";

// The model identifies the missing/ambiguous slot only - it never produces the clarification
// choices themselves (I0 PART 8's "option B": deterministic code owns the allowed choices from
// the missing slot, which is I2's job, not I1's).
export type NoaSemanticClarificationReasonV2 =
  | "missing_metric"
  | "missing_entity"
  | "ambiguous_entity_type"
  | "ambiguous_reference"
  | "unsupported_period"
  | "unsupported_metric"
  | "multiple_requests"
  | "action_requested";

export type NoaSemanticConfidenceV2 = "high" | "low";

// Deliberately flat (no nested objects) and every field always present (null for "not
// applicable") - this exact shape is what the strict wire schema below encodes and what
// isNoaSemanticRequestV2() validates. entityText/subjectName are candidate text only, never an
// identifier: QN/CO/order-number extraction remains the existing deterministic regex parsers'
// job, so identifier hallucination is structurally excluded from V2 (I0 PART 21).
export type NoaSemanticRequestV2 = {
  version: 2;
  domain: NoaDomain | "Unclear";
  intent: NoaSemanticIntentV2;
  entityType: NoaSemanticEntityTypeV2 | null;
  entityText: string | null;
  reference: NoaSemanticReferenceV2;
  ordinal: NoaSemanticOrdinalV2 | null;
  metric: NoaSemanticMetricV2 | null;
  period: NoaSemanticPeriodV2 | null;
  comparison: "previous_period" | null;
  sortDirection: NoaSemanticSortDirectionV2 | null;
  subject: NoaSemanticSubjectKindV2 | null;
  subjectName: string | null;
  quotationStatus: NoaSemanticQuotationStatusV2 | null;
  projectFileStatus: NoaSemanticProjectFileStatusV2 | null;
  priceStatus: NoaSemanticPriceStatusV2 | null;
  procurementStatus: NoaSemanticProcurementStatusV2 | null;
  attentionKind: NoaSemanticAttentionKindV2 | null;
  needsClarification: boolean;
  clarificationReason: NoaSemanticClarificationReasonV2 | null;
  confidence: NoaSemanticConfidenceV2;
};

// The safe, deterministic V2 result for any extraction failure - a distinct constant from V1's
// UNCLEAR_SEMANTIC_REQUEST (PART 22: do not reuse the V1 constant) since the two contracts are
// unrelated shapes.
export const UNCLEAR_SEMANTIC_REQUEST_V2: NoaSemanticRequestV2 = {
  version: 2,
  domain: "Unclear",
  intent: "unsupported",
  entityType: null,
  entityText: null,
  reference: "none",
  ordinal: null,
  metric: null,
  period: null,
  comparison: null,
  sortDirection: null,
  subject: null,
  subjectName: null,
  quotationStatus: null,
  projectFileStatus: null,
  priceStatus: null,
  procurementStatus: null,
  attentionKind: null,
  needsClarification: false,
  clarificationReason: null,
  confidence: "low",
};

// Mirrors NoaDomain's literal members plus "Unclear", same rationale/pattern as
// NOA_SEMANTIC_DOMAINS above - kept as its own local runtime set (rather than a shared export)
// so V1 is not touched; parity with the real NoaDomain union is enforced by a dedicated test in
// noa-semantic-v2.test.mts instead of a shared runtime source of truth (I1 PART 3).
const NOA_SEMANTIC_DOMAINS_V2: ReadonlySet<string> = new Set<NoaDomain | "Unclear">([
  "Product", "Quotation", "Price", "Project", "Client", "Procurement",
  "UserActivity", "Admin", "Insights", "Attention", "Help", "Unclear",
]);

const NOA_SEMANTIC_INTENTS_V2: ReadonlySet<string> = new Set<NoaSemanticIntentV2>([
  "lookup", "list", "count", "aggregate", "rank", "compare", "trend", "history",
  "attention", "activity", "activity_time", "presence", "howto", "unsupported",
]);

const NOA_SEMANTIC_ENTITY_TYPES_V2: ReadonlySet<string> = new Set<NoaSemanticEntityTypeV2>([
  "quotation", "project_file", "client", "product", "brand", "product_category",
  "supplier", "procurement_order", "user", "role", "ai_provider", "ai_agent",
]);

const NOA_SEMANTIC_METRICS_V2: ReadonlySet<string> = new Set<NoaSemanticMetricV2>([
  "quotation_count", "quotation_value", "average_quotation_value", "confirmed_count",
  "confirmed_value", "project_file_count", "project_file_value", "client_count",
  "product_count", "price_status_count", "procurement_order_count", "active_time",
]);

const NOA_SEMANTIC_PERIODS_V2: ReadonlySet<string> = new Set<NoaSemanticPeriodV2>([
  "today", "yesterday", "this_week", "last_7_days", "this_month",
  "last_month", "this_quarter", "last_quarter", "this_year",
]);

const NOA_SEMANTIC_REFERENCES_V2: ReadonlySet<string> = new Set<NoaSemanticReferenceV2>([
  "none", "previous_result", "current_page",
]);

const NOA_SEMANTIC_QUOTATION_STATUSES_V2: ReadonlySet<string> = new Set<NoaSemanticQuotationStatusV2>(["draft", "client_confirmed"]);
const NOA_SEMANTIC_PROJECT_FILE_STATUSES_V2: ReadonlySet<string> = new Set<NoaSemanticProjectFileStatusV2>(["active", "completed", "cancelled"]);
const NOA_SEMANTIC_PRICE_STATUSES_V2: ReadonlySet<string> = new Set<NoaSemanticPriceStatusV2>(["current", "needs_check", "due", "scheduled", "checked", "no_price_list_date"]);
const NOA_SEMANTIC_PROCUREMENT_STATUSES_V2: ReadonlySet<string> = new Set<NoaSemanticProcurementStatusV2>(["active", "completed"]);
const NOA_SEMANTIC_ATTENTION_KINDS_V2: ReadonlySet<string> = new Set<NoaSemanticAttentionKindV2>([
  "price_needs_check", "price_due", "procurement_missing_eta", "procurement_missing_etd", "payment_overdue",
]);
const NOA_SEMANTIC_CLARIFICATION_REASONS_V2: ReadonlySet<string> = new Set<NoaSemanticClarificationReasonV2>([
  "missing_metric", "missing_entity", "ambiguous_entity_type", "ambiguous_reference",
  "unsupported_period", "unsupported_metric", "multiple_requests", "action_requested",
]);
const NOA_SEMANTIC_CONFIDENCES_V2: ReadonlySet<string> = new Set<NoaSemanticConfidenceV2>(["high", "low"]);

// Bounds enforced here rather than in the wire schema (I1 PART 18) - chosen to match the
// candidate-text bounds V1's own product/entity fields already use (160) and the subject.name
// bound V1 already uses (80).
const ENTITY_TEXT_MAX_LENGTH = 160;
const SUBJECT_NAME_MAX_LENGTH = 80;

function isNullableEnumMember<T extends string>(value: unknown, allowed: ReadonlySet<string>): value is T | null {
  if (value === null) return true;
  return typeof value === "string" && allowed.has(value);
}

function isNullableBoundedString(value: unknown, maxLength: number): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isNoaSemanticOrdinalV2(value: unknown): value is NoaSemanticOrdinalV2 | null {
  if (value === null) return true;
  if (value === "last") return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

// Strict, closed-shape validation for untrusted provider JSON against the V2 contract - anything
// that doesn't fully conform (unknown enum value, wrong null/value combination, out-of-range
// ordinal, oversized text) is rejected outright; the caller should fall back to
// UNCLEAR_SEMANTIC_REQUEST_V2 rather than trust a partially-matching object.
export function isNoaSemanticRequestV2(value: unknown): value is NoaSemanticRequestV2 {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;

  if (c.version !== NOA_SEMANTIC_REQUEST_V2_VERSION) return false;
  if (typeof c.domain !== "string" || !NOA_SEMANTIC_DOMAINS_V2.has(c.domain)) return false;
  if (typeof c.intent !== "string" || !NOA_SEMANTIC_INTENTS_V2.has(c.intent)) return false;
  if (!isNullableEnumMember(c.entityType, NOA_SEMANTIC_ENTITY_TYPES_V2)) return false;
  if (!isNullableBoundedString(c.entityText, ENTITY_TEXT_MAX_LENGTH)) return false;
  if (typeof c.reference !== "string" || !NOA_SEMANTIC_REFERENCES_V2.has(c.reference)) return false;
  if (!isNoaSemanticOrdinalV2(c.ordinal)) return false;
  if (!isNullableEnumMember(c.metric, NOA_SEMANTIC_METRICS_V2)) return false;
  if (!isNullableEnumMember(c.period, NOA_SEMANTIC_PERIODS_V2)) return false;
  if (c.comparison !== null && c.comparison !== "previous_period") return false;
  if (c.sortDirection !== null && c.sortDirection !== "asc" && c.sortDirection !== "desc") return false;
  if (c.subject !== null && c.subject !== "self" && c.subject !== "team" && c.subject !== "named_user") return false;
  if (!isNullableBoundedString(c.subjectName, SUBJECT_NAME_MAX_LENGTH)) return false;
  // subjectName is required exactly when subject is "named_user" - never present otherwise
  // (I1 PART 11): a provider that fills subjectName without subject === "named_user", or that
  // omits it when subject IS "named_user", produced an internally inconsistent object.
  if (c.subject === "named_user" ? c.subjectName === null : c.subjectName !== null) return false;
  if (!isNullableEnumMember(c.quotationStatus, NOA_SEMANTIC_QUOTATION_STATUSES_V2)) return false;
  if (!isNullableEnumMember(c.projectFileStatus, NOA_SEMANTIC_PROJECT_FILE_STATUSES_V2)) return false;
  if (!isNullableEnumMember(c.priceStatus, NOA_SEMANTIC_PRICE_STATUSES_V2)) return false;
  if (!isNullableEnumMember(c.procurementStatus, NOA_SEMANTIC_PROCUREMENT_STATUSES_V2)) return false;
  if (!isNullableEnumMember(c.attentionKind, NOA_SEMANTIC_ATTENTION_KINDS_V2)) return false;
  if (typeof c.needsClarification !== "boolean") return false;
  if (!isNullableEnumMember(c.clarificationReason, NOA_SEMANTIC_CLARIFICATION_REASONS_V2)) return false;
  if (typeof c.confidence !== "string" || !NOA_SEMANTIC_CONFIDENCES_V2.has(c.confidence)) return false;

  return true;
}

function normalizeForGrounding(value: string): string {
  return value.trim().toLowerCase();
}

// A separate pure check from isNoaSemanticRequestV2() on purpose (I1 PART 21): shape validity and
// grounding-against-the-original-message are different concerns. A structurally valid V2 object
// can still fail grounding if the model invented entityText/subjectName the user never typed -
// case-insensitive normalized exact substring only, no fuzzy matching in I1. There is no
// model-supplied QN/CO/order-number field in V2 at all, so identifier hallucination cannot occur
// structurally, independent of this check.
export function validateNoaSemanticRequestV2AgainstMessage(request: NoaSemanticRequestV2, message: string): boolean {
  const normalizedMessage = normalizeForGrounding(message);

  if (request.entityText !== null) {
    const candidate = normalizeForGrounding(request.entityText);
    if (!candidate || !normalizedMessage.includes(candidate)) return false;
  }

  if (request.subject === "named_user") {
    if (request.subjectName === null) return false;
    const candidate = normalizeForGrounding(request.subjectName);
    if (!candidate || !normalizedMessage.includes(candidate)) return false;
  }

  return true;
}

// ============================================================================================
// I8 GOAL A: explicit-period safety. A model may leave `period` null (or set a period that
// contradicts the message) even when the user's own wording names a specific, already-supported
// time range - I6.4/I6.6/I7 proved this happens (a model can fail to raise
// clarificationReason:"unsupported_period" the way I6.5 protects against). This is a SEPARATE,
// independent check from grounding above: grounding asks "did the model invent text"; this asks
// "did the model silently drop or contradict an explicit period the user actually said" - the
// application must not trust `needsClarification`/confidence for this, it must re-derive the
// period from the raw message itself, the same way it re-derives entityText grounding.
//
// Only checked for the intents where `period` is ever semantically meaningful (history/aggregate/
// compare/trend) - a Product lookup that happens to mention "this month" in passing must not be
// penalized for an irrelevant field.
//
// The phrase->period table mirrors the wording ALREADY supported by existing deterministic date
// helpers (lib/insights/date-ranges.ts's DateRangeKey options and
// noa-user-activity-capability.server.ts's activityDateRangeKey(), which is the one place "monday"
// is already recognized - N2B1 - mapping it to the current week). No new date range is invented
// here; this only decides whether the MODEL's own period value is consistent with wording the
// application already knows how to honor.
// ============================================================================================

const PERIOD_RELEVANT_INTENTS: ReadonlySet<NoaSemanticIntentV2> = new Set(["history", "aggregate", "compare", "trend"]);

// Order matters only in that each pattern is independent (no overlapping wording below), so first-
// match is sufficient. "monday" mirrors activityDateRangeKey()'s own existing "since Monday" ->
// this_week equivalence - not a new date concept, the same one Catch-Up already honors.
const PERIOD_PHRASE_PATTERNS: ReadonlyArray<{ pattern: RegExp; period: NoaSemanticPeriodV2 }> = [
  { pattern: /\byesterday\b/, period: "yesterday" },
  { pattern: /\bmonday\b/, period: "this_week" },
  { pattern: /\bthis week\b/, period: "this_week" },
  { pattern: /\blast 7 days?\b/, period: "last_7_days" },
  { pattern: /\blast month\b/, period: "last_month" },
  { pattern: /\bthis month\b/, period: "this_month" },
  { pattern: /\blast quarter\b/, period: "last_quarter" },
  { pattern: /\bthis quarter\b/, period: "this_quarter" },
  { pattern: /\bthis year\b/, period: "this_year" },
  { pattern: /\btoday\b/, period: "today" },
];

// Pure, data-free: takes only the raw message text and the model's own period claim. Returns
// false when the message names a specific, already-supported period and the semantic period
// doesn't match it exactly (including being null) - the caller should treat that exactly like a
// grounding failure (fall back to the deterministic route), never dispatch on the mismatched/
// missing period. Returns true whenever period isn't semantically relevant to this intent, or the
// message names no recognized period at all (the existing default, e.g. "today", may still apply).
export function validateSemanticPeriodAgainstMessage(message: string, semantic: NoaSemanticRequestV2): boolean {
  if (!PERIOD_RELEVANT_INTENTS.has(semantic.intent)) return true;
  const normalized = message.toLowerCase();
  for (const { pattern, period } of PERIOD_PHRASE_PATTERNS) {
    if (pattern.test(normalized)) return semantic.period === period;
  }
  return true;
}

// The provider-neutral strict wire schema (I1 PART 18/19): flat (no nested objects at all), every
// root property listed in `required`, additionalProperties:false, nullable unions instead of
// omitted optional keys, and no maxLength/minProperties/other portability-risk keywords - lengths
// and cross-field rules are enforced by isNoaSemanticRequestV2()/validateNoaSemanticRequestV2AgainstMessage()
// above instead. Passed through the existing runAiProvider() exactly as V1's schema is - no
// provider-specific fork of this schema is introduced.
export const NOA_SEMANTIC_REQUEST_V2_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "version", "domain", "intent", "entityType", "entityText", "reference", "ordinal", "metric",
    "period", "comparison", "sortDirection", "subject", "subjectName", "quotationStatus",
    "projectFileStatus", "priceStatus", "procurementStatus", "attentionKind", "needsClarification",
    "clarificationReason", "confidence",
  ],
  properties: {
    version: { type: "integer", enum: [2] },
    domain: { type: "string", enum: ["Product", "Quotation", "Price", "Project", "Client", "Procurement", "UserActivity", "Admin", "Insights", "Attention", "Help", "Unclear"] },
    intent: { type: "string", enum: ["lookup", "list", "count", "aggregate", "rank", "compare", "trend", "history", "attention", "activity", "activity_time", "presence", "howto", "unsupported"] },
    entityType: { type: ["string", "null"], enum: ["quotation", "project_file", "client", "product", "brand", "product_category", "supplier", "procurement_order", "user", "role", "ai_provider", "ai_agent", null] },
    entityText: { type: ["string", "null"] },
    reference: { type: "string", enum: ["none", "previous_result", "current_page"] },
    ordinal: { type: ["integer", "string", "null"], enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "last", null] },
    metric: { type: ["string", "null"], enum: ["quotation_count", "quotation_value", "average_quotation_value", "confirmed_count", "confirmed_value", "project_file_count", "project_file_value", "client_count", "product_count", "price_status_count", "procurement_order_count", "active_time", null] },
    period: { type: ["string", "null"], enum: ["today", "yesterday", "this_week", "last_7_days", "this_month", "last_month", "this_quarter", "last_quarter", "this_year", null] },
    comparison: { type: ["string", "null"], enum: ["previous_period", null] },
    sortDirection: { type: ["string", "null"], enum: ["asc", "desc", null] },
    subject: { type: ["string", "null"], enum: ["self", "team", "named_user", null] },
    subjectName: { type: ["string", "null"] },
    quotationStatus: { type: ["string", "null"], enum: ["draft", "client_confirmed", null] },
    projectFileStatus: { type: ["string", "null"], enum: ["active", "completed", "cancelled", null] },
    priceStatus: { type: ["string", "null"], enum: ["current", "needs_check", "due", "scheduled", "checked", "no_price_list_date", null] },
    procurementStatus: { type: ["string", "null"], enum: ["active", "completed", null] },
    attentionKind: { type: ["string", "null"], enum: ["price_needs_check", "price_due", "procurement_missing_eta", "procurement_missing_etd", "payment_overdue", null] },
    needsClarification: { type: "boolean" },
    clarificationReason: { type: ["string", "null"], enum: ["missing_metric", "missing_entity", "ambiguous_entity_type", "ambiguous_reference", "unsupported_period", "unsupported_metric", "multiple_requests", "action_requested", null] },
    confidence: { type: "string", enum: ["high", "low"] },
  },
} as const;
