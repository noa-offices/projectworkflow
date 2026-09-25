// I2: pure deterministic bridge between the I1 V2 semantic contract and the EXISTING NOA
// capabilities. No "server-only", no Supabase import, no auth import, no capability-execution
// import, no AI-provider import - this module never queries a database, never authorizes, and
// never calculates a business fact. It only decides WHICH existing capability owns a semantic
// request and WHAT already-recognized phrase to hand it, or that the request needs a
// clarification/is unsupported/should fall back to the deterministic router.
//
// Dormant by design: nothing in the orchestrator/router imports this file yet (I3 activates it
// behind a feature flag). Every canonical message this module produces is a phrase already proven
// to reach the intended question-kind in the target capability's own existing regex classifier
// (noa-quotation-capability.server.ts, noa-project-capability.server.ts,
// noa-product-capability.server.ts, noa-client-capability.server.ts,
// noa-procurement-capability.server.ts, noa-user-activity-capability.server.ts,
// noa-insights-capability.server.ts) - verified by this module's own test file, never phrases that
// merely "look right".
import type { NoaChoice, NoaDomain } from "./noa-types";
import type {
  NoaSemanticClarificationReasonV2,
  NoaSemanticMetricV2,
  NoaSemanticPeriodV2,
  NoaSemanticRequestV2,
} from "./noa-semantic-request";
import type { NoaFollowUpBinding, NoaReferenceEntityType } from "./noa-conversation-reference";

export type NoaSemanticResolution =
  | {
      kind: "dispatch";
      domain: NoaDomain;
      canonicalMessage: string;
      semantic: NoaSemanticRequestV2;
    }
  | {
      kind: "clarify";
      text: string;
      choices?: NoaChoice[];
      reason: NoaSemanticClarificationReasonV2 | "missing_entity_generic";
    }
  | {
      kind: "unsupported";
      text: string;
    }
  | {
      kind: "fallback";
      reason: string;
    };

function dispatch(domain: NoaDomain, canonicalMessage: string, semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  return { kind: "dispatch", domain, canonicalMessage, semantic };
}

function clarify(text: string, reason: NoaSemanticClarificationReasonV2 | "missing_entity_generic", choices?: NoaChoice[]): NoaSemanticResolution {
  return { kind: "clarify", text, reason, ...(choices ? { choices } : {}) };
}

function unsupported(text: string): NoaSemanticResolution {
  return { kind: "unsupported", text };
}

function fallback(reason: string): NoaSemanticResolution {
  return { kind: "fallback", reason };
}

// ============================================================================================
// PART 4/17: client-ranking clarification - the model identifies the missing metric only; these
// are the deterministic choices, each `value` an existing phrase that already re-enters the
// deterministic Insights fast path (noa-insights-capability.server.ts's own insightsQuestionKind()
// client_ranking phrases) exactly as GPC-3.1's own choices already re-enter the deterministic
// message path. Never model-generated text.
// ============================================================================================
export const NOA_CLIENT_RANKING_CLARIFICATION_CHOICES: NoaChoice[] = [
  { label: "Quotation value", value: "top clients by quotation value" },
  { label: "Client-confirmed value", value: "top clients by confirmed value" },
  { label: "Project File value", value: "top clients by project value" },
  { label: "Number of quotations", value: "how many quotations does each client have" },
];

const CLIENT_RANKING_MISSING_METRIC_TEXT =
  "What would you like to compare clients by — quotation value, client-confirmed value, Project File value, or number of quotations?";

// PART 3: the only 4 metrics noa-insights-capability.server.ts's clientRankingMetric()/
// insightsQuestionKind() actually recognize - no new ranking-specific metric enum invented, reuses
// I1's existing NoaSemanticMetricV2 values verbatim.
const CLIENT_RANKING_METRIC_PHRASE: Partial<Record<NoaSemanticMetricV2, string>> = {
  quotation_value: "top clients by quotation value",
  confirmed_value: "top clients by confirmed value",
  project_file_value: "top clients by project value",
  quotation_count: "how many quotations does each client have",
};

// PART 2/3: semantic domain does not always equal implementation ownership - a "best client"
// question is conceptually about Client, but the actual ranking calculation lives in the Insights
// capability (noa-insights-capability.server.ts's client_ranking question kind). The model prompt
// never needs to know this; the resolver owns it.
function resolveClientRanking(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  if (semantic.metric === null) {
    return clarify(CLIENT_RANKING_MISSING_METRIC_TEXT, "missing_metric", NOA_CLIENT_RANKING_CLARIFICATION_CHOICES);
  }
  const phrase = CLIENT_RANKING_METRIC_PHRASE[semantic.metric];
  if (!phrase) {
    // average_quotation_value/client_count/etc. are real V2 metrics but not ones the ranking
    // capability itself supports - never coerced into a wrong ranking.
    return unsupported("I can't rank clients by that yet - I can compare them by quotation value, client-confirmed value, Project File value, or number of quotations.");
  }
  return dispatch("Insights", phrase, semantic);
}

// ============================================================================================
// PART 6: UserActivity - activity / activity_time / presence. Canonical phrases match
// noa-user-activity-capability.server.ts's own userActivityQuestionKind()/activityTimeKind()/
// isPresenceBoundaryQuestion() regexes exactly (verified by this module's test file).
// ============================================================================================
function resolveUserActivity(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, subject, subjectName } = semantic;

  if (intent === "activity") {
    if (subject === "self" || subject === null) return dispatch("UserActivity", "what did i work on today", semantic);
    if (subject === "named_user" && subjectName) return dispatch("UserActivity", `what did ${subjectName} work on today`, semantic);
    if (subject === "team") return dispatch("UserActivity", "what did the team work on today", semantic);
    return fallback("user_activity_subject_unresolved");
  }

  if (intent === "activity_time") {
    // The existing capability's activity_time kinds don't vary by period today (I0 PART 5,
    // finding 7) - only the self/named-user distinction changes the canonical phrase.
    if (subject === "self" || subject === null) return dispatch("UserActivity", "projectworkflow active time today", semantic);
    if (subject === "named_user" && subjectName) return dispatch("UserActivity", `show ${subjectName}'s projectworkflow active time`, semantic);
    // Team activity_time has no proven canonical destination in the current capability.
    return unsupported("I can't show ProjectWorkflow active time for the whole team yet - try asking about yourself or a named person.");
  }

  if (intent === "presence") {
    if (subject === "self" || subject === null) return dispatch("UserActivity", "am i online", semantic);
    if (subject === "team") return dispatch("UserActivity", "who is online", semantic);
    if (subject === "named_user" && subjectName) return dispatch("UserActivity", `is ${subjectName} online`, semantic);
    return fallback("user_activity_subject_unresolved");
  }

  return fallback("user_activity_intent_unresolved");
}

// ============================================================================================
// PART 7: history/Catch-Up. Canonical phrases match
// noa-user-activity-capability.server.ts's own CATCH_UP_PATTERNS + activityDateRangeKey()
// exactly. Reference binding (previous_result/current_page) is I5's job - I2 never invents an
// identifier, it signals that binding is required instead.
// ============================================================================================
// Catch-Up's own activityDateRangeKey() only recognizes today/yesterday/this_week (else it
// silently defaults to today) - a wider requested period (last_month, this_quarter, "since
// Monday", ...) is not something the current capability can honor without being silently coerced
// to "today", which would misrepresent what was actually checked. One shared text/result so a
// period the model spells out (last_month) and a period it can only flag as unsupported (I6.5:
// clarificationReason "unsupported_period" with period left null, e.g. "since Monday") are refused
// identically, never silently narrowed to today.
const CATCH_UP_UNSUPPORTED_PERIOD_RESULT: NoaSemanticResolution = unsupported(
  "Catch-Up only covers today, yesterday, or this week right now - try one of those instead.",
);

function resolveHistory(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  if (semantic.reference !== "none") {
    return clarify(
      "Which quotation or Project File do you mean? I can check what changed once you name one.",
      "ambiguous_reference",
    );
  }

  // I6.5: the model may leave period null NOT because none was asked for, but because it
  // explicitly could not represent the period the user asked for (I6.4's catchup-02 finding: "catch
  // me up since Monday" -> period=null, needsClarification=true, clarificationReason=
  // "unsupported_period"). That signal must win over the "no period asked -> today" default below -
  // a flagged-unsupported period must never be silently answered as if it meant today.
  if (semantic.needsClarification && semantic.clarificationReason === "unsupported_period") {
    return CATCH_UP_UNSUPPORTED_PERIOD_RESULT;
  }

  if (semantic.period === "yesterday") return dispatch("UserActivity", "what happened yesterday", semantic);
  if (semantic.period === "this_week") return dispatch("UserActivity", "what changed this week", semantic);
  // Only a genuinely unspecified period (no period stated, no unsupported-period flag) defaults to
  // today - the existing, intentional default for "what changed" with nothing else said.
  if (semantic.period === null || semantic.period === "today") return dispatch("UserActivity", "what changed today", semantic);

  return CATCH_UP_UNSUPPORTED_PERIOD_RESULT;
}

// ============================================================================================
// PART 8: Attention. The existing capability (fetchNoaAttentionCapability) takes the message text
// as an unused parameter - it always returns the full authorized finding list regardless of
// phrasing. attentionKind is therefore accepted on the semantic request but has no effect: there
// is no supported filter to honor, so I2 dispatches the one generic phrase rather than inventing
// filtering the capability doesn't have.
// ============================================================================================
function resolveAttention(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  return dispatch("Attention", "what needs my attention", semantic);
}

// ============================================================================================
// PART 9: Project File. Canonical phrases match noa-project-capability.server.ts's own
// isDetailQuestion()/countOnly/completed logic exactly.
// ============================================================================================
function resolveProject(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, entityType, entityText, metric, projectFileStatus } = semantic;

  // PART 9: a Project-domain aggregate keyed by project_file_value is analytics, not a plain
  // list/count - that calculation is owned by Insights' project_file_analytics kind, not the
  // Project capability itself.
  if (intent === "aggregate" && metric === "project_file_value") {
    return dispatch("Insights", "project file analytics", semantic);
  }

  if (intent === "count" && (entityType === "project_file" || entityType === null)) {
    if (projectFileStatus === "completed") return dispatch("Project", "how many completed project files", semantic);
    return dispatch("Project", "how many active project files", semantic);
  }

  if (intent === "list" && (entityType === "project_file" || entityType === null)) {
    if (projectFileStatus === "completed") return dispatch("Project", "show completed project files", semantic);
    return dispatch("Project", "show active project files", semantic);
  }

  if (intent === "lookup" && entityType === "project_file") {
    if (!entityText) return clarify("Please specify the Project File number or reference.", "missing_entity");
    return dispatch("Project", `project details for ${entityText}`, semantic);
  }

  return fallback("project_intent_unresolved");
}

// ============================================================================================
// PART 10: Quotation. Exact QN identifiers are the deterministic fast path's job (I3) - the
// semantic layer never carries one (I1 PART 21), so a Quotation lookup with no grounded
// entityText/reference is genuinely ambiguous, never guessed.
// ============================================================================================
function resolveQuotation(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, metric, period, comparison, quotationStatus } = semantic;

  // I8 GOAL B/PART 3: the I6.3 compatibility gate already allowed Quotation+list and
  // Quotation+count (noa-quotation-capability.server.ts's own quotationQuestionKind() genuinely
  // supports both - "show|list|which" -> list, "how many|count|number of" -> count), but this
  // resolver had no branch for either, so a compatible request silently fell to
  // "quotation_intent_unresolved". Canonical phrases mirror the exact wording
  // noa-semantic-eval-corpus.ts's own quotation-05/06/07 rows already exercise against that real
  // classifier - no new business query, just closing the gap between what compatibility allows and
  // what the resolver does.
  if (intent === "list") {
    if (quotationStatus === "draft") return dispatch("Quotation", "show pending quotations", semantic);
    if (quotationStatus === "client_confirmed") return dispatch("Quotation", "show client confirmed quotations", semantic);
    return dispatch("Quotation", "show quotations", semantic);
  }

  if (intent === "count") {
    return dispatch("Quotation", "how many quotations", semantic);
  }

  if (intent === "aggregate" && metric === "quotation_value") {
    const periodPhrase = period === "last_month" ? "last month"
      : period === "this_month" ? "this month"
        : period === "today" ? "today"
          : null;
    if (!periodPhrase) return unsupported("I can only total quotation value for this month, last month, or today right now.");
    return dispatch("Insights", `quotations ${periodPhrase}`, semantic);
  }

  if (intent === "compare" && metric === "quotation_value" && comparison === "previous_period") {
    return dispatch("Insights", "compare this month to last month", semantic);
  }

  if (intent === "trend" && metric === "quotation_value") {
    return dispatch("Insights", "quotation trend", semantic);
  }

  if (intent === "lookup") {
    return clarify("Which quotation would you like? Please give the quotation number.", "missing_entity");
  }

  return fallback("quotation_intent_unresolved");
}

// ============================================================================================
// PART 11: Product. Only entityType/entityText (already grounded by I1) are used - category is
// never inferred from free text here, matching noa-product-capability.server.ts's own
// extractSearchTerm() stopword-strip behavior (it already tolerates a plain phrase).
// ============================================================================================
function resolveProduct(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, entityText } = semantic;

  if (intent === "list") {
    if (!entityText) return clarify("What product, brand, or category are you looking for?", "missing_entity");
    return dispatch("Product", `show ${entityText}`, semantic);
  }

  if (intent === "count") {
    return dispatch("Product", entityText ? `how many ${entityText}` : "how many products", semantic);
  }

  if (intent === "lookup") {
    if (!entityText) return clarify("What product are you looking for?", "missing_entity");
    return dispatch("Product", entityText, semantic);
  }

  return fallback("product_intent_unresolved");
}

// ============================================================================================
// Price. A separate domain/capability from Product (different canonical phrasing:
// noa-price-capability.server.ts's own priceQuestionKind() uses "summary" rather than "count",
// and its own list/detail keyword set), so it is deliberately NOT folded into resolveProduct()
// above even though both start from entityType/entityText.
// ============================================================================================
function resolvePrice(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, entityText } = semantic;

  if (intent === "list") {
    if (!entityText) return clarify("Which product, brand, or category's price do you mean?", "missing_entity");
    return dispatch("Price", `which ${entityText} prices`, semantic);
  }

  if (intent === "count" || intent === "aggregate") {
    return dispatch("Price", "price summary", semantic);
  }

  if (intent === "lookup") {
    if (!entityText) return clarify("What product's price are you asking about?", "missing_entity");
    return dispatch("Price", `${entityText} price`, semantic);
  }

  return fallback("price_intent_unresolved");
}

// ============================================================================================
// PART 12: Procurement. Only lookup/list/count are supported by the existing capability - rank/
// aggregate/compare/trend (supplier ranking, "ready for shipment", a missing-ETA filter) have no
// deterministic destination today and must not be coerced into a wrong answer.
// ============================================================================================
function resolveProcurement(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, procurementStatus, entityText } = semantic;

  if (intent === "count") {
    return dispatch("Procurement", procurementStatus === "completed" ? "how many completed procurement orders" : "how many active procurement orders", semantic);
  }

  if (intent === "list") {
    return dispatch("Procurement", procurementStatus === "completed" ? "show completed procurement orders" : "show active procurement orders", semantic);
  }

  if (intent === "lookup") {
    if (!entityText) return clarify("Please specify the procurement order number.", "missing_entity");
    return dispatch("Procurement", `order details for ${entityText}`, semantic);
  }

  // rank/aggregate/compare/trend: no existing Procurement or Insights path computes supplier
  // ranking, a shipping-status filter, or a missing-ETA aggregate.
  return unsupported("I can't do that with procurement orders yet - I can look up an order or list active/completed orders.");
}

// ============================================================================================
// PART 13: Client. Mirrors noa-client-capability.server.ts's own clientQuestionKind() phrases.
// ============================================================================================
function resolveClient(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  const { intent, entityText } = semantic;

  if (intent === "lookup" || intent === "list") {
    if (entityText) return dispatch("Client", `tell me about client ${entityText}`, semantic);
    if (intent === "list") return dispatch("Client", "list clients", semantic);
    return clarify("Which client do you mean?", "missing_entity");
  }

  if (intent === "count") return dispatch("Client", "how many clients", semantic);

  return fallback("client_intent_unresolved");
}

// ============================================================================================
// PART 13 (Help/howto): the current Help capability has no how-to content (I0 PART 4, item Help
// row) - never invented here. Mirrors the orchestrator's own existing HELP_ANSWER_TEXT tone
// without importing the orchestrator module (this file must stay import-pure per PART 20).
// ============================================================================================
const HOWTO_UNSUPPORTED_TEXT =
  "I don't have step-by-step instructions for that yet. Try asking about a product, quotation, project, activity, or another ProjectWorkflow area instead.";

const ACTION_REQUESTED_TEXT =
  "I can understand the request, but NOA is read-only for this action right now.";

// ============================================================================================
// PART 16/17: a small deterministic table for the clarification reasons a domain handler doesn't
// already resolve on its own (e.g. the model flagged an ambiguity I2's own slot checks wouldn't
// otherwise catch). Kept intentionally small - not a general chatbot clarification framework.
// ============================================================================================
function genericClarification(reason: NoaSemanticClarificationReasonV2): NoaSemanticResolution {
  switch (reason) {
    case "missing_entity":
      return clarify("Which client, product, project, or quotation do you mean?", reason);
    case "ambiguous_entity_type":
      return clarify("I'm not sure what kind of thing you mean - a client, product, project, or quotation?", reason);
    case "ambiguous_reference":
      return clarify("Which one do you mean? Please name it directly.", reason);
    case "unsupported_period":
      return unsupported("I can't cover that time period yet - try today, this week, this month, or last month.");
    case "unsupported_metric":
      return unsupported("I don't have a defined way to calculate that yet.");
    case "multiple_requests":
      return clarify("Could you ask one thing at a time?", reason);
    case "missing_metric":
      return clarify("What would you like to measure that by?", reason);
    case "action_requested":
      return unsupported(ACTION_REQUESTED_TEXT);
  }
}

// ============================================================================================
// I6.3: closed semantic compatibility gate. The model PROPOSES a semantic shape; this table decides
// whether that shape is coherent for the domain it names BEFORE any resolver mapping can turn it
// into a dispatch. It validates meaning only - never auth, never ownership (Client+rank still
// normalizes to Insights below). Derived from what the per-domain resolvers above actually honor;
// anything outside it fails closed to the deterministic route rather than being coerced.
// ============================================================================================
export type NoaSemanticCompatibilityReason =
  | "unsupported_domain_intent"
  | "incompatible_entity_type"
  | "incompatible_metric"
  | "incompatible_status"
  | "unsupported_combination";

export type NoaSemanticCompatibility =
  | { compatible: true }
  | { compatible: false; reason: NoaSemanticCompatibilityReason };

type StatusField = "quotationStatus" | "projectFileStatus" | "priceStatus" | "procurementStatus" | "attentionKind";

type CompatibilityRule = {
  intents: readonly NoaSemanticRequestV2["intent"][];
  entityTypes: readonly NonNullable<NoaSemanticRequestV2["entityType"]>[];
  metrics: readonly NoaSemanticMetricV2[];
  statuses: readonly StatusField[];
};

const QUOTATION_METRICS: readonly NoaSemanticMetricV2[] = ["quotation_count", "quotation_value", "average_quotation_value", "confirmed_count", "confirmed_value"];
const CLIENT_RANKING_METRICS: readonly NoaSemanticMetricV2[] = ["quotation_value", "confirmed_value", "project_file_value", "quotation_count"];
const STATUS_FIELDS: readonly StatusField[] = ["quotationStatus", "projectFileStatus", "priceStatus", "procurementStatus", "attentionKind"];

// Keyed by semantic domain, then by a closed intent group. An empty rule list means the domain has
// no semantic V2 destination at all (Admin/Unclear stay deterministic-only).
const NOA_SEMANTIC_COMPATIBILITY: Readonly<Record<NoaSemanticRequestV2["domain"], readonly CompatibilityRule[]>> = {
  Product: [{ intents: ["lookup", "list", "count"], entityTypes: ["product", "brand", "product_category"], metrics: ["product_count"], statuses: [] }],
  Price: [{ intents: ["lookup", "list", "count", "aggregate"], entityTypes: ["product", "brand", "product_category"], metrics: ["price_status_count"], statuses: ["priceStatus"] }],
  Quotation: [
    { intents: ["lookup", "list", "count", "aggregate", "compare", "trend"], entityTypes: ["quotation"], metrics: QUOTATION_METRICS, statuses: ["quotationStatus"] },
    { intents: ["history"], entityTypes: ["quotation"], metrics: [], statuses: [] },
  ],
  Project: [
    { intents: ["lookup", "list", "count", "aggregate"], entityTypes: ["project_file"], metrics: ["project_file_count", "project_file_value"], statuses: ["projectFileStatus"] },
    { intents: ["history"], entityTypes: ["project_file"], metrics: [], statuses: [] },
  ],
  Client: [
    // A confirmed-value ranking legitimately carries quotationStatus=client_confirmed (I4 live smoke).
    { intents: ["rank"], entityTypes: ["client"], metrics: CLIENT_RANKING_METRICS, statuses: ["quotationStatus"] },
    { intents: ["lookup", "list", "count"], entityTypes: ["client"], metrics: ["client_count"], statuses: [] },
  ],
  Procurement: [{ intents: ["lookup", "list", "count"], entityTypes: ["procurement_order"], metrics: ["procurement_order_count"], statuses: ["procurementStatus"] }],
  UserActivity: [
    { intents: ["activity", "activity_time", "presence"], entityTypes: ["user"], metrics: ["active_time"], statuses: [] },
    { intents: ["history"], entityTypes: ["quotation", "project_file"], metrics: [], statuses: [] },
  ],
  Insights: [
    { intents: ["rank"], entityTypes: ["client"], metrics: CLIENT_RANKING_METRICS, statuses: ["quotationStatus"] },
    {
      intents: ["aggregate", "compare", "trend", "count"],
      entityTypes: ["quotation", "project_file", "client"],
      metrics: [...QUOTATION_METRICS, "project_file_count", "project_file_value", "client_count"],
      statuses: ["quotationStatus", "projectFileStatus"],
    },
  ],
  // PART 10: only a genuine, unfiltered needs-attention request. The Attention capability ignores
  // its message and cannot filter by kind or entity, so a specific attentionKind or entity would be
  // answered with a broader list than was asked for - that is rejected, never coerced.
  Attention: [{ intents: ["attention"], entityTypes: [], metrics: [], statuses: [] }],
  Help: [{ intents: ["howto"], entityTypes: [], metrics: [], statuses: [] }],
  Admin: [],
  Unclear: [],
};

// Pure, closed, data-free. Reference/ordinal are deliberately NOT consulted: a previous_result or
// current_page reference can specialize a compatible request later (I5 binding) but can never make
// an incompatible domain/intent/entity/metric/status combination compatible.
export function validateNoaSemanticCompatibility(semantic: NoaSemanticRequestV2): NoaSemanticCompatibility {
  const rule = NOA_SEMANTIC_COMPATIBILITY[semantic.domain].find((candidate) => candidate.intents.includes(semantic.intent));
  if (!rule) return { compatible: false, reason: "unsupported_domain_intent" };
  if (semantic.entityType !== null && !rule.entityTypes.includes(semantic.entityType)) {
    return { compatible: false, reason: "incompatible_entity_type" };
  }
  if (semantic.metric !== null && !rule.metrics.includes(semantic.metric)) {
    return { compatible: false, reason: "incompatible_metric" };
  }
  if (STATUS_FIELDS.some((field) => semantic[field] !== null && !rule.statuses.includes(field))) {
    return { compatible: false, reason: "incompatible_status" };
  }
  // A named-user subject only means something for UserActivity; elsewhere it is a model error.
  if (semantic.subject === "named_user" && semantic.domain !== "UserActivity") {
    return { compatible: false, reason: "unsupported_combination" };
  }
  return { compatible: true };
}

// ============================================================================================
// PART 1: the resolver entry point. Pure function: NoaSemanticRequestV2 in, one
// NoaSemanticResolution out. Never queries a database, never authorizes, never calculates a
// business value, never emits an identifier the model itself supplied (I1's grounding already
// ensures entityText/subjectName are message-derived, never invented).
// ============================================================================================
export function resolveNoaSemanticCapabilityRequest(semantic: NoaSemanticRequestV2): NoaSemanticResolution {
  // PART 15: a write/action request is never mapped onto any capability, read-only or not.
  if (semantic.clarificationReason === "action_requested") {
    return unsupported(ACTION_REQUESTED_TEXT);
  }

  // PART 14: no fake dispatch for a domain/intent the model itself couldn't place.
  if (semantic.domain === "Unclear" || semantic.intent === "unsupported") {
    return fallback(semantic.domain === "Unclear" ? "semantic_domain_unclear" : "semantic_intent_unsupported");
  }

  // I6.3: fail closed before ANY mapping - an incompatible shape never reaches a dispatch, a
  // clarification, or a semantic "unsupported" refusal; the deterministic route keeps the message.
  // Runs regardless of confidence, so neither high confidence nor the I5.2 low-confidence allow-list
  // (which only inspects a dispatch this function returned) can bypass it.
  const compatibility = validateNoaSemanticCompatibility(semantic);
  if (!compatibility.compatible) return fallback(`semantic_incompatible_${compatibility.reason}`);

  // PART 5: ordinal is only meaningful when it binds to a previous result - outside that context
  // it is treated as semantically inactive, never mutated, never turned into "first previous
  // result" (I1 live-test finding: "Who is our best client?" returned ordinal=1 with
  // reference="none", which must have no effect here).

  // PART 2/3/4: Client ranking is resolved before the generic per-domain switch below because its
  // ownership (Insights) differs from its semantic domain (Client) - every other domain's
  // ownership matches its semantic domain one-to-one.
  if (semantic.intent === "rank" && semantic.entityType === "client") {
    return resolveClientRanking(semantic);
  }

  // PART 16: rank against anything other than "client" has no proven capability destination yet.
  if (semantic.intent === "rank") {
    return unsupported("I can only rank clients right now - not that yet.");
  }

  if (semantic.intent === "history") return resolveHistory(semantic);
  if (semantic.intent === "attention" || semantic.domain === "Attention") return resolveAttention(semantic);
  if (semantic.intent === "howto") return unsupported(HOWTO_UNSUPPORTED_TEXT);
  if (semantic.intent === "activity" || semantic.intent === "activity_time" || semantic.intent === "presence") {
    return resolveUserActivity(semantic);
  }

  let result: NoaSemanticResolution;
  switch (semantic.domain) {
    case "Project":
      result = resolveProject(semantic);
      break;
    case "Quotation":
      result = resolveQuotation(semantic);
      break;
    case "Product":
      result = resolveProduct(semantic);
      break;
    case "Price":
      result = resolvePrice(semantic);
      break;
    case "Procurement":
      result = resolveProcurement(semantic);
      break;
    case "Client":
      result = resolveClient(semantic);
      break;
    case "Insights":
      // A semantic Insights request outside the client-ranking special case above has no other
      // proven canonical destination in I2 yet (I4 domain expansion territory).
      result = fallback("insights_intent_unresolved");
      break;
    default:
      result = fallback("domain_unresolved");
  }

  // PART 16/18: if the domain handler couldn't resolve a dispatch/clarify/unsupported outcome on
  // its own, fall back to the model's own flagged clarification reason (if any) rather than
  // dispatching something incomplete - confidence alone is never treated as authorization to guess
  // (PART 18).
  if (result.kind === "fallback" && semantic.needsClarification && semantic.clarificationReason) {
    return genericClarification(semantic.clarificationReason);
  }

  return result;
}

// ============================================================================================
// I5: canonical phrases for an ALREADY-BOUND conversation follow-up. The binding itself (which
// entity, which position, whether a page entity exists) is decided deterministically in
// noa-conversation-reference.ts's bindNoaConversationFollowUp() - this function only maps that
// closed binding onto a phrase an EXISTING capability classifier already recognizes, or onto a
// fixed clarification/unsupported text. Still pure: no DB, no auth, no calculation, and the only
// labels it ever emits are the ones the binder already validated against the target parser.
// ============================================================================================

export type NoaFollowUpResolution =
  | { kind: "dispatch"; domain: Exclude<NoaDomain, "Help">; canonicalMessage: string }
  | { kind: "answer"; domain: NoaDomain; text: string; choices?: NoaChoice[] };

// Mirrors noa-insights-capability.server.ts's own insightsDateRangeKey() exactly - only the
// periods it already recognizes (anything else would silently default to "this month" there).
const ANALYTICS_PERIOD_PHRASE: Partial<Record<NoaSemanticPeriodV2, string>> = {
  today: "today",
  this_week: "this week",
  last_7_days: "last 7 days",
  this_month: "this month",
  last_month: "last month",
  this_year: "this year",
};

const ENTITY_NOUN: Record<NoaReferenceEntityType, { one: string; many: string }> = {
  client: { many: "clients", one: "client" },
  project_file: { many: "Project Files", one: "Project File" },
  product: { many: "products", one: "product" },
  quotation: { many: "quotations", one: "quotation" },
};

function entityNoun(type: NoaReferenceEntityType | undefined, count = 2): string {
  if (!type) return count === 1 ? "item" : "items";
  return count === 1 ? ENTITY_NOUN[type].one : ENTITY_NOUN[type].many;
}

// Same fixed "1, 2, or 3" phrasing as the existing C4A quotation ordinal clarification.
function joinPositionChoices(count: number): string {
  const numbers = Array.from({ length: Math.max(1, count) }, (_, index) => String(index + 1));
  if (numbers.length === 1) return numbers[0];
  if (numbers.length === 2) return numbers.join(" or ");
  return `${numbers.slice(0, -1).join(", ")}, or ${numbers[numbers.length - 1]}`;
}

// The existing Quotation capability's client-relation read (buildBroadQuotationAnswer ->
// quotation_relation_read): "client <name>" is parsed by its own b2Target(), "confirmed" by its own
// status aliases, "total" by its own wantsTotal check. No new calculator - that path already sums
// the selected client's authorized quotations per currency.
function clientMetricPhrase(label: string, metric: "confirmed_value" | "quotation_value"): string {
  return metric === "confirmed_value"
    ? `total confirmed quotation value for client ${label}`
    : `total quotation value for client ${label}`;
}

function followUpAnswer(text: string, choices?: NoaChoice[], domain: NoaDomain = "Help"): NoaFollowUpResolution {
  return { domain, kind: "answer", text, ...(choices?.length ? { choices } : {}) };
}

function clarificationText(binding: Extract<NoaFollowUpBinding, { kind: "clarify" }>): { text: string; choices?: NoaChoice[] } {
  switch (binding.reason) {
    case "no_compatible_reference":
      return { text: "Which one do you mean? I don't have a previous result I can safely refer back to - please name it directly." };
    case "ambiguous_entity": {
      const clientChoices = binding.clientChoices;
      const choices = clientChoices
        ? [
            ...clientChoices.labels.slice(0, 5).map((label) => ({ label, value: clientMetricPhrase(label, clientChoices.metric) })),
            ...(clientChoices.metric === "confirmed_value"
              ? [{ label: "Rank all clients by confirmed value", value: "top clients by confirmed value" }]
              : []),
          ]
        : undefined;
      return {
        choices,
        text: `The previous result had ${binding.count ?? "several"} ${entityNoun(binding.referenceType)}. Which one do you mean? You can also say, for example, "the second one".`,
      };
    }
    case "ordinal_out_of_range": {
      const count = binding.count ?? 0;
      return { text: `There ${count === 1 ? "was" : "were"} only ${count} ${entityNoun(binding.referenceType, count)} in the previous result. Choose ${joinPositionChoices(count)}.` };
    }
    case "ordinal_beyond_stored":
      return { text: `I can only refer back to the first ${binding.count ?? 0} items from that result. Please name the one you mean.` };
    case "ordinal_unavailable":
      return { text: "I can't pick an item by position from that result (for example, a ranking split across currencies). Please name the one you mean." };
    case "ordinal_conflict":
      return { text: "Which position do you mean? Please say, for example, \"the second one\"." };
    case "entity_type_mismatch":
      return { text: `The previous result listed ${entityNoun(binding.referenceType)}, not ${entityNoun(binding.requestedType)}. Which ${entityNoun(binding.requestedType, 1)} do you mean?` };
    case "page_entity_unavailable":
      return { text: "This page doesn't point to a single quotation or Project File I can use. Which one do you mean?" };
    case "page_quotation_unavailable":
      return { text: "I can't read this quotation's number from the page yet. Please give the quotation number." };
    case "unsafe_label":
      return { text: "Please name that one directly so I can look it up." };
    case "period_not_applicable":
      return { text: "I can't apply a different time period to that result. Please ask the full question with the period you want." };
    case "history_not_supported_for_type":
      return { text: "I can only check what changed on a quotation or Project File. Which one do you mean?" };
  }
}

export function resolveNoaConversationFollowUp(binding: NoaFollowUpBinding): NoaFollowUpResolution | null {
  switch (binding.kind) {
    case "not_applicable":
      return null;
    case "entity_detail":
      // Each phrase is the SAME one an existing deterministic path already uses for that entity:
      // client detail (clientTarget()), the C4A quotation ordinal rewrite, I2's Project lookup
      // phrase, and the C4D product rewrite.
      if (binding.entityType === "client") return { canonicalMessage: `tell me about client ${binding.label}`, domain: "Client", kind: "dispatch" };
      if (binding.entityType === "quotation") return { canonicalMessage: `tell me about ${binding.label}`, domain: "Quotation", kind: "dispatch" };
      if (binding.entityType === "project_file") return { canonicalMessage: `project details for ${binding.label}`, domain: "Project", kind: "dispatch" };
      return { canonicalMessage: `product ${binding.label}`, domain: "Product", kind: "dispatch" };
    case "entity_history":
      // PART 8: the existing entity-scoped Catch-Up path (catch_up_quotation / catch_up_project_file
      // in noa-user-activity-capability.server.ts) - never the current-state detail capability.
      return { canonicalMessage: `what changed on ${binding.label}`, domain: "UserActivity", kind: "dispatch" };
    case "client_metric":
      return { canonicalMessage: clientMetricPhrase(binding.label, binding.metric), domain: "Quotation", kind: "dispatch" };
    case "quotation_value":
      // quotationStructuredRequest() reads "worth" as request "total" for exactly one QN.
      return { canonicalMessage: `what is ${binding.label} worth`, domain: "Quotation", kind: "dispatch" };
    case "analytics_period": {
      const phrase = ANALYTICS_PERIOD_PHRASE[binding.period];
      if (!phrase) {
        return followUpAnswer("Quotation analytics covers today, this week, the last 7 days, this month, last month, or this year - not that period yet.", undefined, "Insights");
      }
      return { canonicalMessage: `quotation analytics ${phrase}`, domain: "Insights", kind: "dispatch" };
    }
    case "ranking_metric": {
      const phrase = CLIENT_RANKING_METRIC_PHRASE[binding.metric];
      if (!phrase) {
        return followUpAnswer("I can't rank clients by that yet - I can compare them by quotation value, client-confirmed value, Project File value, or number of quotations.", undefined, "Insights");
      }
      return { canonicalMessage: phrase, domain: "Insights", kind: "dispatch" };
    }
    case "ranking_period":
      return followUpAnswer("Client rankings cover all recorded quotations - I can't limit them to a time period yet.", undefined, "Insights");
    case "page_entity_options":
      // No existing capability computes "what's missing" on a Project File - offer only the two
      // existing deterministic paths for the page's own CO, never an invented check.
      return followUpAnswer(
        `For ${binding.label}, I can show its current details or what changed on it.`,
        [
          { label: "Show details", value: `project details for ${binding.label}` },
          { label: "What changed", value: `what changed on ${binding.label}` },
        ],
        "Project",
      );
    case "clarify": {
      const { text, choices } = clarificationText(binding);
      return followUpAnswer(text, choices);
    }
  }
}
