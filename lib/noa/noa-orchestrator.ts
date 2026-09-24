import "server-only";

import { classifyNoaRoute, describeNoaPageContext, greetingResponseText, NOA_CAPABILITY_SUMMARY_TEXT, recordedQuotationFollowUpReference } from "@/lib/noa/noa-intent-router";
import { extractNoaSemanticRequest } from "@/lib/noa/noa-intent-extractor.server";
import { boundConversationReferenceEntities, isNoaConversationReference, type NoaConversationReference } from "@/lib/noa/noa-conversation-reference";
import type { NoaSemanticIntent, NoaSemanticRequest } from "@/lib/noa/noa-semantic-request";
import { resolveNoaSemanticPeriod, resolveNoaSemanticSubject } from "@/lib/noa/noa-subject-resolver";
import { fetchNoaAdminCapability } from "@/lib/noa/noa-admin-capability.server";
import { fetchNoaClientCapability } from "@/lib/noa/noa-client-capability.server";
import { fetchNoaInsightsCapability } from "@/lib/noa/noa-insights-capability.server";
import { fetchNoaPriceCapability } from "@/lib/noa/noa-price-capability.server";
import { fetchNoaProcurementCapability } from "@/lib/noa/noa-procurement-capability.server";
import { fetchNoaProductCapability } from "@/lib/noa/noa-product-capability.server";
import { fetchNoaProjectCapability } from "@/lib/noa/noa-project-capability.server";
import { fetchNoaQuotationCapability } from "@/lib/noa/noa-quotation-capability.server";
import { fetchNoaUserActivityCapability } from "@/lib/noa/noa-user-activity-capability.server";
import type { NoaAnswer, NoaChatRequest } from "@/lib/noa/noa-types";
import { runNoaProvider } from "@/lib/noa/noa-provider.server";

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
  const projectLabel = reference.entities?.find((entity) => entity.type === "project")?.label;
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

// C4B: builds a bounded Project conversationReference from THIS successful, already-authorized
// capabilityData only - never from provider text. Reads only `project.projectName`/
// `rows[].projectName`, the safe human-readable label every existing Project capability result
// (detail/list/count) already returns - never a UUID, never a client id.
function buildProjectConversationReference(data: unknown): NoaConversationReference | undefined {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
  if (!record) return undefined;

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

// The one and only dispatch point: classify -> call exactly one capability -> (optionally) phrase
// the result with the provider. No capability ever calls another, and the model never picks which
// capability or query runs - that's fully deterministic, in code, before the provider is invoked.
export async function runNoaOrchestrator(request: NoaChatRequest): Promise<NoaAnswer> {
  const recordedQuotationFollowUpFrom = recordedQuotationFollowUpReference(request.message, request.recentMessages ?? []);
  const route = recordedQuotationFollowUpFrom ? "UserActivity" : classifyNoaRoute(request.message, request.context);

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

  // C3: an untrusted, client-round-tripped conversationReference - validated before any use;
  // malformed input is simply ignored (never trusted, never a source of authorization or
  // business fact).
  const conversationReference = isNoaConversationReference(request.conversationReference)
    ? request.conversationReference
    : undefined;

  // C2/C3 hybrid routing: only for a message already deterministically routed to UserActivity, or
  // one that fell all the way through to "Help" (unresolved) and might semantically be a
  // UserActivity question. Never runs for any other clear domain (Product/Price/Quotation/
  // Project/Client/Procurement/Admin/Insights already returned above or matched deterministically
  // below) and never for the already-resolved recordedQuotationFollowUpFrom case. At most one
  // extractor call per request. Any failure or non-UserActivity/unsupported-intent result is
  // silently ignored - the existing deterministic route/fallback is preserved exactly (PART 9).
  let semanticRequest: NoaSemanticRequest | undefined;
  let projectMessageOverride: string | undefined;
  let clientMessageOverride: string | undefined;
  let procurementMessageOverride: string | undefined;
  let productMessageOverride: string | undefined;
  if (!recordedQuotationFollowUpFrom && (route === "UserActivity" || route === "Help")) {
    const extracted = await extractNoaSemanticRequest({ context: request.context, message: request.message });

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
      semanticRequest = { domain: "Quotation", intent: extracted.intent };
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
      semanticRequest = { domain: "Project", intent: extracted.intent };
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
      semanticRequest = { domain: "Client", intent: extracted.intent };
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
      semanticRequest = { domain: "Product", intent: extracted.intent };
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
      semanticRequest = { domain: "Price", intent: extracted.intent };
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
  if (effectiveRoute === "Help") {
    return { domain: "Help", sources: [], text: HELP_ANSWER_TEXT };
  }

  const domain = effectiveRoute;

  const capabilityResult = domain === "Product"
    ? await fetchNoaProductCapability(productMessageOverride ?? request.message, request.context)
    : domain === "Quotation"
      ? await fetchNoaQuotationCapability(request.message, request.context)
      : domain === "Project"
        ? await fetchNoaProjectCapability(projectMessageOverride ?? request.message, request.context)
        : domain === "Client"
          ? await fetchNoaClientCapability(clientMessageOverride ?? request.message, request.context)
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
                  : await fetchNoaPriceCapability(productMessageOverride ?? request.message, request.context);

  if (!capabilityResult.ok) {
    // Unauthorized / not-found / ambiguous: return the capability's own safe copy directly,
    // without spending a provider call on something the model can't help with anyway. No
    // conversationReference is returned - an unsuccessful result has nothing safe to remember.
    return { domain, sources: [], text: capabilityResult.message };
  }

  // C3/C4A: built ONLY from this successful, already-authorized capabilityData (PART 2/10) -
  // never from provider text, never sent into the provider payload below (PART 12: capabilityData
  // remains the only source of business facts for the model).
  const newConversationReference = domain === "UserActivity"
    ? buildUserActivityConversationReference(semanticRequest, capabilityResult.data)
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

  const deterministicData = typeof capabilityResult.data === "object" && capabilityResult.data !== null
    ? capabilityResult.data as { deterministicOnly?: unknown; deterministicText?: unknown }
    : null;
  if (deterministicData?.deterministicOnly === true && typeof deterministicData.deterministicText === "string") {
    return { conversationReference: newConversationReference, domain, sources: capabilityResult.sources, text: deterministicData.deterministicText };
  }

  try {
    const { text } = await runNoaProvider({
      capabilityData: capabilityResult.data,
      context: request.context,
      displayName: request.displayName,
      domain,
      message: request.message,
      recentMessages: request.recentMessages ?? [],
    });
    return { conversationReference: newConversationReference, domain, sources: capabilityResult.sources, text };
  } catch (error) {
    const deterministicText = typeof capabilityResult.data === "object" && capabilityResult.data !== null
      && "deterministicText" in capabilityResult.data && typeof capabilityResult.data.deterministicText === "string"
      ? capabilityResult.data.deterministicText.trim()
      : "";
    if (deterministicText) return { conversationReference: newConversationReference, domain, sources: capabilityResult.sources, text: deterministicText };
    throw error;
  }
}
