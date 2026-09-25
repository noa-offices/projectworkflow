// C3: a small, bounded, ephemeral reference to the immediately previous NOA result - never
// long-term memory, never server-persisted (round-tripped with the next request exactly like
// recentMessages already is), and never built from assistant prose. Pure, alias-free (only
// type-only imports from ./noa-types and ./noa-semantic-request, both themselves pure) so it
// stays unit-testable with the plain Node test runner, same convention as every other pure NOA
// helper module.

import type { NoaDomain } from "./noa-types";
import type {
  NoaSemanticMetricV2,
  NoaSemanticPeriod,
  NoaSemanticPeriodV2,
  NoaSemanticRequestV2,
  NoaSemanticSubject,
} from "./noa-semantic-request";

// Hard cap (PART 13): never more than this many entities, regardless of source.
export const MAX_CONVERSATION_REFERENCE_ENTITIES = 5;

export type NoaConversationReferenceEntity = {
  type: string;
  // An internal database id is never included here today - every current caller only ever
  // populates `label` (a safe business label such as a quotation number). `id` exists in the type
  // for a future entity kind that genuinely needs one, but nothing writes it yet.
  id?: string;
  label?: string;
};

export type NoaConversationReference = {
  domain: NoaDomain;
  intent: string;
  subject?: NoaSemanticSubject;
  period?: NoaSemanticPeriod;
  entities?: NoaConversationReferenceEntity[];
  // I5: three small, closed, optional additions - enough to continue an Insights result
  // (metric/period inheritance) and to know whether the stored entity list is the WHOLE ordered
  // result or only its first MAX_CONVERSATION_REFERENCE_ENTITIES items (ordinal "last"/out-of-range
  // safety). Never a business value, never a row, never a filter.
  metric?: NoaSemanticMetricV2;
  analyticsPeriod?: NoaSemanticPeriodV2;
  resultCount?: number;
};

const KNOWN_DOMAINS: ReadonlySet<string> = new Set<NoaDomain>([
  "Product", "Quotation", "Price", "Project", "Client", "Procurement",
  "UserActivity", "Admin", "Insights", "Help",
]);

const KNOWN_PERIODS: ReadonlySet<string> = new Set<NoaSemanticPeriod>([
  "today", "yesterday", "this_week", "last_7_days", "this_month",
]);

// I5: local closed mirrors of the V2 metric/period enums (type-checked against the V2 unions, so
// a drift is a compile error) - this module stays runtime-import-free.
const KNOWN_METRICS: ReadonlySet<string> = new Set<NoaSemanticMetricV2>([
  "quotation_count", "quotation_value", "average_quotation_value", "confirmed_count",
  "confirmed_value", "project_file_count", "project_file_value", "client_count",
  "product_count", "price_status_count", "procurement_order_count", "active_time",
]);

const KNOWN_ANALYTICS_PERIODS: ReadonlySet<string> = new Set<NoaSemanticPeriodV2>([
  "today", "yesterday", "this_week", "last_7_days", "this_month",
  "last_month", "this_quarter", "last_quarter", "this_year",
]);

const MAX_REFERENCE_RESULT_COUNT = 10_000;

function isSubjectShape(value: unknown): value is NoaSemanticSubject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "self" || candidate.type === "team") return true;
  if (candidate.type === "named_user") {
    return typeof candidate.name === "string" && candidate.name.trim().length > 0;
  }
  return false;
}

function isEntityShape(value: unknown): value is NoaConversationReferenceEntity {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !candidate.type.trim()) return false;
  if (candidate.id !== undefined && typeof candidate.id !== "string") return false;
  if (candidate.label !== undefined && typeof candidate.label !== "string") return false;
  return true;
}

// Strict, closed validation for an untrusted, client-round-tripped conversationReference -
// malformed input is simply ignored by the caller (never trusted, never a source of
// authorization or business fact; see noa-orchestrator.ts).
export function isNoaConversationReference(value: unknown): value is NoaConversationReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.domain !== "string" || !KNOWN_DOMAINS.has(candidate.domain)) return false;
  if (typeof candidate.intent !== "string" || !candidate.intent.trim()) return false;
  if (candidate.subject !== undefined && !isSubjectShape(candidate.subject)) return false;
  if (candidate.period !== undefined && (typeof candidate.period !== "string" || !KNOWN_PERIODS.has(candidate.period))) return false;
  if (candidate.entities !== undefined) {
    if (!Array.isArray(candidate.entities)) return false;
    if (candidate.entities.length > MAX_CONVERSATION_REFERENCE_ENTITIES) return false;
    if (!candidate.entities.every(isEntityShape)) return false;
  }
  if (candidate.metric !== undefined && (typeof candidate.metric !== "string" || !KNOWN_METRICS.has(candidate.metric))) return false;
  if (
    candidate.analyticsPeriod !== undefined &&
    (typeof candidate.analyticsPeriod !== "string" || !KNOWN_ANALYTICS_PERIODS.has(candidate.analyticsPeriod))
  ) {
    return false;
  }
  if (
    candidate.resultCount !== undefined &&
    (typeof candidate.resultCount !== "number" || !Number.isInteger(candidate.resultCount) ||
      candidate.resultCount < 0 || candidate.resultCount > MAX_REFERENCE_RESULT_COUNT)
  ) {
    return false;
  }

  return true;
}

// I5 PART 20: a validated reference rebuilt field-by-field from the closed shape only - any extra
// key an untrusted client round-tripped (a role, a user id, a filter, a table name, ...) is simply
// never copied, so nothing outside the documented shape can ever be re-emitted or read by I5.
export function sanitizeNoaConversationReference(value: unknown): NoaConversationReference | undefined {
  if (!isNoaConversationReference(value)) return undefined;
  const subject: NoaSemanticSubject | undefined = value.subject
    ? value.subject.type === "named_user"
      ? { name: value.subject.name, type: "named_user" }
      : { type: value.subject.type }
    : undefined;
  return {
    domain: value.domain,
    intent: value.intent,
    ...(subject ? { subject } : {}),
    ...(value.period ? { period: value.period } : {}),
    ...(value.entities
      ? {
          entities: boundConversationReferenceEntities(value.entities).map((entity) => ({
            type: entity.type,
            ...(entity.id !== undefined ? { id: entity.id } : {}),
            ...(entity.label !== undefined ? { label: entity.label } : {}),
          })),
        }
      : {}),
    ...(value.metric ? { metric: value.metric } : {}),
    ...(value.analyticsPeriod ? { analyticsPeriod: value.analyticsPeriod } : {}),
    ...(value.resultCount !== undefined ? { resultCount: value.resultCount } : {}),
  };
}

// Bounds an entities list to the hard cap regardless of source - never trust a caller (internal
// or external) to have already bounded it before this is the last line of defense.
export function boundConversationReferenceEntities(
  entities: NoaConversationReferenceEntity[],
): NoaConversationReferenceEntity[] {
  return entities.slice(0, MAX_CONVERSATION_REFERENCE_ENTITIES);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// I5: conversation intelligence - deterministic follow-up binding
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Pure, alias-free, no I/O. The semantic V2 classifier (which never sees the stored reference or
// any label) may only EXPRESS a follow-up (reference/ordinal/metric/period/intent); the actual
// referent is always chosen here, deterministically, from the ONE stored reference (built by the
// orchestrator from an already-authorized capability result) or from the current page route. The
// result is a small binding the pure resolver (resolveNoaConversationFollowUp in
// noa-semantic-resolver.ts) turns into an existing canonical capability phrase - the capability
// itself then re-authorizes and re-reads everything. Nothing here queries a database, grants
// access, or computes a business value.
//
// Confidence (I3.1 / I5 PART 22): model-only slots are trusted only at HIGH confidence. At LOW
// confidence (the common case for context-free follow-ups like "which client is second?") a slot
// counts only when a deterministic cue in the user's own message independently proves it - the
// ordinal is ALWAYS the deterministic parse (the model's ordinal can only veto on disagreement),
// the referent is ALWAYS chosen here, and the metric/period must be corroborated by the message
// text. So a low-confidence classification can never bind something the message itself doesn't
// prove; anything unproven degrades to a clarification or to the existing deterministic path.

export type NoaReferenceEntityType = "client" | "project_file" | "quotation" | "product";

const REFERENCE_ENTITY_TYPES: ReadonlySet<string> = new Set<NoaReferenceEntityType>(["client", "project_file", "quotation", "product"]);

export type NoaFollowUpCues = {
  ordinal: number | "last" | null;
  entityPronoun: boolean;
  continuation: boolean;
  currentPage: boolean;
  history: boolean;
  metric: NoaSemanticMetricV2 | null;
  period: NoaSemanticPeriodV2 | null;
  entityNouns: NoaReferenceEntityType[];
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
// A following time/quantity noun means the word is not a list position ("first quarter", "last
// month", "last 7 days", "second half").
const NON_ORDINAL_FOLLOWER = "(?:quarter|half|time|times|week|weeks|month|months|year|years|day|days|night|few|hour|hours|minute|minutes|seven|thirty|\\d)";
const ORDINAL_WORD_PATTERN = new RegExp(`\\b(${Object.keys(ORDINAL_WORDS).join("|")})\\b(?!\\s+${NON_ORDINAL_FOLLOWER})`, "g");
const ORDINAL_SUFFIX_PATTERN = new RegExp(`\\b(10|[1-9])(?:st|nd|rd|th)\\b(?!\\s+${NON_ORDINAL_FOLLOWER})`, "g");
const ORDINAL_NUMBER_PATTERN = /(?:\bnumber\s+|#)(10|[1-9])\b/g;
const ORDINAL_LAST_PATTERN = new RegExp(`\\blast\\b(?!\\s+${NON_ORDINAL_FOLLOWER})`);

const ENTITY_PRONOUN_PATTERN =
  /\b(?:it|its|they|them|their|theirs|he|she|him|his|her|that one|this one|the same one|(?:that|this|the same) (?:client|customer|quotation|quote|project file|project|product))\b/;
const CONTINUATION_PATTERN = /^(?:(?:ok|okay|so|also|then)\b[,\s]*)?(?:and\b|what about\b|how about\b|same for\b|now for\b)/;
const CURRENT_PAGE_PATTERN = /\b(?:here|this page|this screen|on screen|the current page)\b/;
const HISTORY_PATTERN =
  /\b(?:what changed|what has changed|what's changed|what happened|what has happened|catch me up|any (?:changes|updates)|anything new|what's new|what is new|recent changes)\b/;

const PERIOD_PATTERNS: ReadonlyArray<[RegExp, NoaSemanticPeriodV2]> = [
  [/\btoday\b/, "today"],
  [/\byesterday\b/, "yesterday"],
  [/\bthis week\b/, "this_week"],
  [/\b(?:last|past) (?:7|seven) days\b/, "last_7_days"],
  [/\bthis month\b/, "this_month"],
  [/\blast month\b/, "last_month"],
  [/\bthis quarter\b/, "this_quarter"],
  [/\blast quarter\b/, "last_quarter"],
  [/\bthis year\b/, "this_year"],
];

const ENTITY_NOUN_PATTERNS: ReadonlyArray<[RegExp, NoaReferenceEntityType]> = [
  [/\b(?:clients?|customers?)\b/, "client"],
  [/\b(?:quotations?|quotes?)\b/, "quotation"],
  [/\bprojects?(?: files?)?\b/, "project_file"],
  [/\bproducts?\b/, "product"],
];

function normalizeFollowUpMessage(message: string): string {
  return message.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().replace(/[?!.]+$/, "").trim();
}

function detectOrdinal(normalized: string): number | "last" | null {
  const found = new Set<number | "last">();
  for (const match of normalized.matchAll(ORDINAL_WORD_PATTERN)) found.add(ORDINAL_WORDS[match[1]]);
  for (const match of normalized.matchAll(ORDINAL_SUFFIX_PATTERN)) found.add(Number(match[1]));
  for (const match of normalized.matchAll(ORDINAL_NUMBER_PATTERN)) found.add(Number(match[1]));
  if (ORDINAL_LAST_PATTERN.test(normalized)) found.add("last");
  // More than one distinct position ("first and second") is never guessed.
  return found.size === 1 ? Array.from(found)[0] : null;
}

// Only the metrics a bound follow-up can actually reach through an existing capability phrase -
// never a new metric definition.
function detectMetric(normalized: string): NoaSemanticMetricV2 | null {
  if (/\b(?:how many|number of|count of)\b/.test(normalized) && /\b(?:quotations?|quotes?)\b/.test(normalized)) return "quotation_count";
  if (/\bconfirm(?:ed|s|ation)?\b/.test(normalized)) return "confirmed_value";
  if (/\bproject(?: file)? value\b/.test(normalized)) return "project_file_value";
  if (/\b(?:worth|value|valued|quoted|how much)\b/.test(normalized)) return "quotation_value";
  return null;
}

function detectPeriod(normalized: string): NoaSemanticPeriodV2 | null {
  const matches = PERIOD_PATTERNS.filter(([pattern]) => pattern.test(normalized)).map(([, period]) => period);
  return matches.length === 1 ? matches[0] : null;
}

// Deterministic, message-only cue detection - the "independent proof" half of every binding.
export function detectNoaFollowUpCues(message: string): NoaFollowUpCues {
  const normalized = normalizeFollowUpMessage(message);
  return {
    ordinal: detectOrdinal(normalized),
    entityPronoun: ENTITY_PRONOUN_PATTERN.test(normalized),
    continuation: CONTINUATION_PATTERN.test(normalized),
    currentPage: CURRENT_PAGE_PATTERN.test(normalized),
    history: HISTORY_PATTERN.test(normalized),
    metric: detectMetric(normalized),
    period: detectPeriod(normalized),
    entityNouns: ENTITY_NOUN_PATTERNS.filter(([pattern]) => pattern.test(normalized)).map(([, type]) => type),
  };
}

// The narrow gate for even ASKING the classifier about a follow-up: a list position, a
// continuation that changes a period/metric, a pronoun plus a value question, a current-page
// reference, or a history question about "it". A bare pronoun question ("is it active?", "what
// status is it?") is deliberately NOT a candidate - the existing C4 deterministic pronoun
// follow-ups keep owning those unchanged.
export function isNoaConversationFollowUpCandidate(cues: NoaFollowUpCues): boolean {
  return cues.ordinal !== null ||
    (cues.continuation && (cues.period !== null || cues.metric !== null)) ||
    (cues.entityPronoun && cues.metric !== null) ||
    cues.currentPage ||
    (cues.history && cues.entityPronoun);
}

export type NoaPageEntity = { type: "project_file"; label: string } | { type: "quotation_record" };

// I5 PART 9/10: the current page is only a HINT, and only a route-level one: the ERP Project File
// route (/projects/orders/<orderNo>) carries its CO number in the path itself, validated by the
// caller-supplied deterministic identifier check (the Project capability's own CO parser) - never
// page text, never a guess. A quotation record page exposes only an internal record id (no QN), so
// it is reported as present-but-unbindable rather than resolved here (no DB read in this module).
// Every bound page entity still flows through the normal capability + auth path downstream.
export function noaCurrentPageEntity(
  pathname: string,
  hasQuotationRecord: boolean,
  isProjectFileIdentifier: (label: string) => boolean,
): NoaPageEntity | null {
  const match = /^\/projects\/orders\/([^/?#]+)\/?$/.exec(pathname);
  if (match) {
    let segment: string;
    try {
      segment = decodeURIComponent(match[1]).trim();
    } catch {
      return null;
    }
    return isProjectFileIdentifier(segment) ? { label: segment, type: "project_file" } : null;
  }
  return hasQuotationRecord ? { type: "quotation_record" } : null;
}

export type NoaFollowUpClarifyReason =
  | "no_compatible_reference"
  | "ambiguous_entity"
  | "ordinal_out_of_range"
  | "ordinal_beyond_stored"
  | "ordinal_unavailable"
  | "ordinal_conflict"
  | "entity_type_mismatch"
  | "page_entity_unavailable"
  | "page_quotation_unavailable"
  | "unsafe_label"
  | "period_not_applicable"
  | "history_not_supported_for_type";

export type NoaFollowUpBindingSource = "ordinal" | "single_entity" | "current_page";

export type NoaFollowUpBinding =
  | { kind: "not_applicable" }
  | { kind: "entity_detail"; entityType: NoaReferenceEntityType; label: string; source: NoaFollowUpBindingSource }
  | { kind: "entity_history"; entityType: "quotation" | "project_file"; label: string; source: NoaFollowUpBindingSource }
  | { kind: "client_metric"; label: string; metric: "confirmed_value" | "quotation_value"; source: NoaFollowUpBindingSource }
  | { kind: "quotation_value"; label: string; source: NoaFollowUpBindingSource }
  | { kind: "analytics_period"; period: NoaSemanticPeriodV2 }
  | { kind: "ranking_metric"; metric: NoaSemanticMetricV2 }
  | { kind: "ranking_period" }
  | { kind: "page_entity_options"; label: string }
  | {
      kind: "clarify";
      reason: NoaFollowUpClarifyReason;
      count?: number;
      requestedType?: NoaReferenceEntityType;
      referenceType?: NoaReferenceEntityType;
      clientChoices?: { labels: string[]; metric: "confirmed_value" | "quotation_value" };
    };

export type NoaFollowUpBindingInput = {
  cues: NoaFollowUpCues;
  // null = no classifier ran (the protected deterministic Catch-Up route) - cues alone decide.
  semantic: NoaSemanticRequestV2 | null;
  reference: NoaConversationReference | undefined;
  pageEntity: NoaPageEntity | null;
  isIdentifierLabel: (entityType: "quotation" | "project_file", label: string) => boolean;
};

const NOT_APPLICABLE: NoaFollowUpBinding = { kind: "not_applicable" };

type NoaFollowUpClarifyExtra = Omit<Extract<NoaFollowUpBinding, { kind: "clarify" }>, "kind" | "reason">;

function clarifyBinding(reason: NoaFollowUpClarifyReason, extra: NoaFollowUpClarifyExtra = {}): NoaFollowUpBinding {
  return { kind: "clarify", reason, ...extra };
}

// Labels are only ever substituted into an existing capability phrase when that phrase's own text
// parser is proven to read them back unchanged: no sentence punctuation (the Quotation relation
// parser stops at ?.,), no newline, bounded length, and none of the words those parsers treat as
// structure ("has/total/value/quotations/projects/how many/...").
const UNSAFE_LABEL_WORDS = /\b(?:has|have|total|value|quotations?|quotes?|projects?|how many|count|number of|show|list|all|which|price|prices)\b/i;

export function isNoaSafeReferenceLabel(label: string): boolean {
  const trimmed = label.trim();
  return trimmed.length > 0 && trimmed.length <= 120 && !/[?.,\n\r]/.test(trimmed) && !UNSAFE_LABEL_WORDS.test(trimmed);
}

function v2EntityTypeToReferenceType(entityType: NoaSemanticRequestV2["entityType"] | undefined): NoaReferenceEntityType | null {
  return entityType === "client" || entityType === "project_file" || entityType === "quotation" || entityType === "product" ? entityType : null;
}

function referenceEntityLabels(reference: NoaConversationReference, type: NoaReferenceEntityType): string[] {
  return (reference.entities ?? [])
    .filter((entity) => entity.type === type && typeof entity.label === "string" && entity.label.trim().length > 0)
    .map((entity) => (entity.label as string).trim());
}

function primaryReferenceType(reference: NoaConversationReference): NoaReferenceEntityType | null {
  const first = (reference.entities ?? []).find((entity) => REFERENCE_ENTITY_TYPES.has(entity.type));
  return first ? (first.type as NoaReferenceEntityType) : null;
}

type OrdinalSelection = { kind: "selected"; label: string } | { kind: "clarify"; binding: NoaFollowUpBinding };

// Positions are read in the reference's EXISTING stored order (the authorized result's own order)
// - never re-sorted. "last"/out-of-range are only answered when the stored list is provably the
// whole result (resultCount known, or fewer than the storage cap were stored).
function selectByOrdinal(labels: string[], ordinal: number | "last", resultCount: number | undefined): OrdinalSelection {
  const stored = labels.length;
  if (stored === 0) return { binding: clarifyBinding("ordinal_unavailable", resultCount ? { count: resultCount } : {}), kind: "clarify" };
  const storedIsWhole = resultCount !== undefined ? resultCount <= stored : stored < MAX_CONVERSATION_REFERENCE_ENTITIES;
  if (ordinal === "last") {
    if (!storedIsWhole) return { binding: clarifyBinding("ordinal_beyond_stored", { count: stored }), kind: "clarify" };
    return { kind: "selected", label: labels[stored - 1] };
  }
  if (ordinal > stored) {
    return storedIsWhole || (resultCount !== undefined && ordinal > resultCount)
      ? { binding: clarifyBinding("ordinal_out_of_range", { count: resultCount ?? stored }), kind: "clarify" }
      : { binding: clarifyBinding("ordinal_beyond_stored", { count: stored }), kind: "clarify" };
  }
  return { kind: "selected", label: labels[ordinal - 1] };
}

function requestedEntityType(
  cues: NoaFollowUpCues,
  semantic: NoaSemanticRequestV2 | null,
  highConfidence: boolean,
  referenceType: NoaReferenceEntityType,
): NoaReferenceEntityType {
  if (cues.entityNouns.includes(referenceType)) return referenceType;
  if (cues.entityNouns.length > 0) return cues.entityNouns[0];
  const modelType = highConfidence ? v2EntityTypeToReferenceType(semantic?.entityType) : null;
  return modelType ?? referenceType;
}

function clientMetricOf(metric: NoaSemanticMetricV2 | null): "confirmed_value" | "quotation_value" | null {
  return metric === "confirmed_value" || metric === "quotation_value" ? metric : null;
}

type NoaFollowUpSlots = {
  highConfidence: boolean;
  history: boolean;
  metric: NoaSemanticMetricV2 | null;
  period: NoaSemanticPeriodV2 | null;
};

function bindInsightsReference(input: NoaFollowUpBindingInput, reference: NoaConversationReference, slots: NoaFollowUpSlots): NoaFollowUpBinding {
  const { cues, semantic } = input;

  if (reference.intent === "quotation_analytics") {
    // PART 6/15: inherit the analytics intent, replace ONLY the period.
    if (cues.ordinal === null && !cues.entityPronoun && !slots.history && slots.period !== null) {
      return { kind: "analytics_period", period: slots.period };
    }
    return NOT_APPLICABLE;
  }

  if (reference.intent !== "client_ranking") return NOT_APPLICABLE;
  const clients = referenceEntityLabels(reference, "client");
  const metric = clientMetricOf(slots.metric);

  if (cues.ordinal !== null) {
    const requested = requestedEntityType(cues, semantic, slots.highConfidence, "client");
    if (requested !== "client") return clarifyBinding("entity_type_mismatch", { referenceType: "client", requestedType: requested });
    const selection = selectByOrdinal(clients, cues.ordinal, reference.resultCount);
    if (selection.kind === "clarify") return selection.binding;
    if (!isNoaSafeReferenceLabel(selection.label)) return clarifyBinding("unsafe_label");
    return metric
      ? { kind: "client_metric", label: selection.label, metric, source: "ordinal" }
      : { entityType: "client", kind: "entity_detail", label: selection.label, source: "ordinal" };
  }

  if (cues.entityPronoun && metric) {
    // PART 16: "they" over several ranked clients is never guessed.
    if (clients.length === 1) {
      return isNoaSafeReferenceLabel(clients[0])
        ? { kind: "client_metric", label: clients[0], metric, source: "single_entity" }
        : clarifyBinding("unsafe_label");
    }
    if (clients.length > 1) {
      return clarifyBinding("ambiguous_entity", {
        clientChoices: { labels: clients.filter(isNoaSafeReferenceLabel), metric },
        count: reference.resultCount ?? clients.length,
        referenceType: "client",
      });
    }
    // A ranking with no referable ordered list (e.g. split across currencies) is still several
    // clients - ask, never guess.
    return (reference.resultCount ?? 0) > 1
      ? clarifyBinding("ambiguous_entity", { count: reference.resultCount, referenceType: "client" })
      : clarifyBinding("no_compatible_reference");
  }

  // PART 7: a metric-only continuation keeps the ranking intent and switches only the metric.
  if (cues.continuation && !cues.entityPronoun) {
    if (slots.metric !== null) return { kind: "ranking_metric", metric: slots.metric };
    if (slots.period !== null) return { kind: "ranking_period" };
  }

  return NOT_APPLICABLE;
}

type EntityAction = "history" | "client_metric" | "quotation_value" | "detail" | "period_not_applicable";

function bindEntityReference(input: NoaFollowUpBindingInput, reference: NoaConversationReference, slots: NoaFollowUpSlots): NoaFollowUpBinding {
  const { cues, semantic } = input;
  const referenceType = primaryReferenceType(reference);
  if (!referenceType) return slots.history ? clarifyBinding("no_compatible_reference") : NOT_APPLICABLE;

  const metric = clientMetricOf(slots.metric);
  const action: EntityAction | null = slots.history
    ? "history"
    : referenceType === "client" && metric
      ? "client_metric"
      : referenceType === "quotation" && slots.metric === "quotation_value"
        ? "quotation_value"
        : cues.ordinal !== null
          ? "detail"
          : cues.continuation && slots.period !== null
            ? "period_not_applicable"
            : null;
  if (!action) return NOT_APPLICABLE;
  if (action === "period_not_applicable") return clarifyBinding("period_not_applicable");

  // PART 5: a position/history request naming a different entity type never binds across types.
  if (cues.ordinal !== null || action === "history") {
    const requested = requestedEntityType(cues, semantic, slots.highConfidence, referenceType);
    if (requested !== referenceType) return clarifyBinding("entity_type_mismatch", { referenceType, requestedType: requested });
  }

  const labels = referenceEntityLabels(reference, referenceType);
  let label: string;
  let source: NoaFollowUpBindingSource;
  if (cues.ordinal !== null) {
    const selection = selectByOrdinal(labels, cues.ordinal, reference.resultCount);
    if (selection.kind === "clarify") return selection.binding;
    label = selection.label;
    source = "ordinal";
  } else if (labels.length === 1) {
    label = labels[0];
    source = "single_entity";
  } else if (labels.length > 1) {
    return clarifyBinding("ambiguous_entity", {
      count: reference.resultCount ?? labels.length,
      referenceType,
      ...(action === "client_metric" && metric ? { clientChoices: { labels: labels.filter(isNoaSafeReferenceLabel), metric } } : {}),
    });
  } else {
    return clarifyBinding("no_compatible_reference");
  }

  if (action === "history") {
    if (referenceType !== "quotation" && referenceType !== "project_file") return clarifyBinding("history_not_supported_for_type", { referenceType });
    return input.isIdentifierLabel(referenceType, label)
      ? { entityType: referenceType, kind: "entity_history", label, source }
      : clarifyBinding("unsafe_label");
  }
  if (action === "client_metric" && metric) {
    return isNoaSafeReferenceLabel(label) ? { kind: "client_metric", label, metric, source } : clarifyBinding("unsafe_label");
  }
  if (action === "quotation_value") {
    return input.isIdentifierLabel("quotation", label) ? { kind: "quotation_value", label, source } : clarifyBinding("unsafe_label");
  }
  // "detail": selection by position only.
  if (referenceType === "quotation" || referenceType === "project_file") {
    return input.isIdentifierLabel(referenceType, label)
      ? { entityType: referenceType, kind: "entity_detail", label, source }
      : clarifyBinding("unsafe_label");
  }
  return isNoaSafeReferenceLabel(label) ? { entityType: referenceType, kind: "entity_detail", label, source } : clarifyBinding("unsafe_label");
}

// Reference domains an I5 binding may continue from. UserActivity is included only for its
// recorded-quotation entity list; Price/Procurement/Admin keep their existing C4 follow-ups only.
const BINDABLE_REFERENCE_DOMAINS: ReadonlySet<NoaDomain> = new Set<NoaDomain>(["Insights", "Client", "Quotation", "Project", "Product", "UserActivity"]);

export function isNoaBindableConversationReference(reference: NoaConversationReference | undefined): reference is NoaConversationReference {
  return Boolean(reference && BINDABLE_REFERENCE_DOMAINS.has(reference.domain));
}

// The single binding entry point. Returns "not_applicable" whenever this is not an I5-shaped
// follow-up, so the caller keeps the existing deterministic pipeline exactly as before.
export function bindNoaConversationFollowUp(input: NoaFollowUpBindingInput): NoaFollowUpBinding {
  const { cues, semantic, pageEntity } = input;
  if (semantic?.clarificationReason === "action_requested") return NOT_APPLICABLE;
  if (cues.ordinal !== null && semantic && semantic.ordinal !== null && semantic.ordinal !== cues.ordinal) {
    return clarifyBinding("ordinal_conflict");
  }

  const highConfidence = semantic?.confidence === "high";
  const slots: NoaFollowUpSlots = {
    highConfidence,
    history: cues.history || (highConfidence && semantic?.intent === "history"),
    metric: cues.metric ?? (highConfidence ? semantic?.metric ?? null : null),
    period: cues.period ?? (highConfidence ? semantic?.period ?? null : null),
  };

  // PART 9: the current page is used only when the message itself points at it AND it is either a
  // history question or the classifier also read it as current_page.
  const pageRequested = cues.currentPage && (slots.history || semantic?.reference === "current_page");
  if (pageRequested) {
    if (pageEntity?.type === "project_file") {
      return slots.history
        ? { entityType: "project_file", kind: "entity_history", label: pageEntity.label, source: "current_page" }
        : { kind: "page_entity_options", label: pageEntity.label };
    }
    // Without a bindable page entity only a history question is answered here (it would otherwise
    // run an unscoped Catch-Up); any other "here" question is left to the existing paths (e.g. an
    // Attention paraphrase the classifier also tagged current_page).
    if (!slots.history) return NOT_APPLICABLE;
    return clarifyBinding(pageEntity?.type === "quotation_record" ? "page_quotation_unavailable" : "page_entity_unavailable");
  }

  const reference = isNoaBindableConversationReference(input.reference) ? input.reference : undefined;
  if (!reference) return slots.history && cues.entityPronoun ? clarifyBinding("no_compatible_reference") : NOT_APPLICABLE;

  const referenceCue = cues.ordinal !== null || cues.entityPronoun || cues.continuation;
  if (!referenceCue) return NOT_APPLICABLE;

  if (reference.domain === "Insights") return bindInsightsReference(input, reference, slots);
  return bindEntityReference(input, reference, slots);
}

// PART 27: closed-enum observability only - never a label, identifier, message, or value. The
// reference's own `intent`/entity `type` are free strings on an untrusted round-tripped object, so
// they are mapped onto closed sets ("other" otherwise) before they can ever be logged.
const KNOWN_REFERENCE_INTENTS: ReadonlySet<string> = new Set([
  "recorded_activity", "activity_time", "project_lookup", "client_lookup", "procurement_lookup",
  "product_lookup", "price_lookup", "quotation_lookup", "client_ranking", "quotation_analytics", "catch_up",
]);

export type NoaReferenceDiagnostics = {
  referenceAvailable: boolean;
  referenceDomain: NoaDomain | null;
  referenceIntent: string | null;
  referenceEntityType: NoaReferenceEntityType | "other" | null;
  referenceEntityCount: number;
  pageEntity: NoaPageEntity["type"] | null;
  semanticUsed: boolean;
  referenceBound: boolean;
  referenceBindingKind: NoaFollowUpBinding["kind"];
  clarifyReason: NoaFollowUpClarifyReason | null;
  ordinalResolved: boolean;
};

export function buildNoaReferenceDiagnostics(
  reference: NoaConversationReference | undefined,
  pageEntity: NoaPageEntity | null,
  semanticUsed: boolean,
  binding: NoaFollowUpBinding,
): NoaReferenceDiagnostics {
  const firstType = reference?.entities?.[0]?.type;
  return {
    referenceAvailable: Boolean(reference),
    referenceDomain: reference?.domain ?? null,
    referenceIntent: reference ? (KNOWN_REFERENCE_INTENTS.has(reference.intent) ? reference.intent : "other") : null,
    referenceEntityType: firstType === undefined ? null : REFERENCE_ENTITY_TYPES.has(firstType) ? (firstType as NoaReferenceEntityType) : "other",
    referenceEntityCount: reference?.entities?.length ?? 0,
    pageEntity: pageEntity?.type ?? null,
    semanticUsed,
    referenceBound: binding.kind !== "not_applicable" && binding.kind !== "clarify",
    referenceBindingKind: binding.kind,
    clarifyReason: binding.kind === "clarify" ? binding.reason : null,
    ordinalResolved: "source" in binding && binding.source === "ordinal",
  };
}

const INSIGHTS_RANKING_METRICS: Record<string, NoaSemanticMetricV2> = {
  confirmed_value: "confirmed_value",
  project_value: "project_file_value",
  quotation_count: "quotation_count",
  quotation_value: "quotation_value",
};

// The same DateRangeKey values insightsDateRangeKey() produces, mapped onto the V2 period enum
// ("30d" has no V2 period and is simply not remembered).
const INSIGHTS_RANGE_PERIODS: Record<string, NoaSemanticPeriodV2> = {
  "7d": "last_7_days",
  last_month: "last_month",
  this_month: "this_month",
  this_week: "this_week",
  this_year: "this_year",
  today: "today",
};

const UUID_SHAPED_LABEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// I5 PART 14/18: an Insights reference built ONLY from the capability's own structured `data`
// (never the ranking text). Client ranking keeps its ordered clientName list only when the ranking
// is ONE ordered list (quotation_count, or a single currency group) and every name is a real,
// unique display name - a multi-currency ranking has no single "second client", and the capability
// falls back to a raw id when a name is missing, so either case stores NO entities (an ordinal then
// clarifies instead of guessing). No value, currency, or id is ever stored.
export function buildNoaInsightsConversationReference(data: unknown): NoaConversationReference | undefined {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!record) return undefined;

  if (record.kind === "insights_client_ranking") {
    const metric = typeof record.metric === "string" ? INSIGHTS_RANKING_METRICS[record.metric] : undefined;
    if (!metric) return undefined;
    const namesOf = (rows: unknown): unknown[] => (Array.isArray(rows) ? rows.map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).clientName : undefined)) : []);
    let names: unknown[] = [];
    let resultCount = 0;
    let singleOrderedList = false;
    if (Array.isArray(record.rows)) {
      names = namesOf(record.rows);
      resultCount = names.length;
      singleOrderedList = true;
    } else if (Array.isArray(record.rankings)) {
      const groups = record.rankings.map((group) => (group && typeof group === "object" ? namesOf((group as Record<string, unknown>).rows) : []));
      resultCount = groups.reduce((total, group) => total + group.length, 0);
      singleOrderedList = groups.length === 1;
      names = groups[0] ?? [];
    }
    const labels = names.filter((name): name is string => typeof name === "string" && name.trim().length > 0).map((name) => name.trim());
    const safe = singleOrderedList &&
      labels.length === names.length &&
      new Set(labels).size === labels.length &&
      labels.every((label) => !UUID_SHAPED_LABEL.test(label));
    return {
      domain: "Insights",
      intent: "client_ranking",
      metric,
      resultCount: Math.min(resultCount, 10_000),
      ...(safe && labels.length > 0 ? { entities: boundConversationReferenceEntities(labels.map((label) => ({ label, type: "client" }))) } : {}),
    };
  }

  if (record.kind === "insights_quotation_analytics") {
    const analyticsPeriod = typeof record.range === "string" ? INSIGHTS_RANGE_PERIODS[record.range] : undefined;
    return { domain: "Insights", intent: "quotation_analytics", ...(analyticsPeriod ? { analyticsPeriod } : {}) };
  }

  return undefined;
}
