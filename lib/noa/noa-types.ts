// Pure, dependency-free NOA types shared by the assistant UI and its page-context/state-machine
// helpers. Kept alias-free (no "@/..." imports) so lib/noa/noa-state-machine.ts and
// lib/noa/use-noa-page-context.ts can be unit tested with the plain Node test runner.
//
// C3: NoaConversationReference is defined in its own file and imported here type-only. That file
// itself imports NoaDomain from this one, also type-only - a type-only circular reference is
// fully erased at compile time (no runtime cycle), the same safe pattern TypeScript projects use
// whenever two small type modules reference each other.
import type { NoaConversationReference } from "./noa-conversation-reference";
// GPC-3: a SEPARATE bounded reference for an in-progress Product Library guided configuration -
// see noa-product-configuration-reference.ts for why this is not merged into
// NoaConversationReference. Same type-only import shape as the line above.
import type { NoaProductConfigurationReference } from "./noa-product-configuration-reference";

export type NoaVisualState =
  | "idle"
  | "hover"
  | "open"
  | "thinking"
  | "responding"
  | "success"
  | "error";

export type NoaMessageRole = "user" | "assistant";

// GPC-3.1: a bounded, human-readable choice the server offers for the CURRENT guided-configuration
// question only - display data, never proof of anything. `value` is deliberately the same visible
// text the existing free-text matcher already accepts (never an internal row id, never a
// price/spec-bearing token) - clicking a choice sends `value` through the exact same message path
// as typed text, and the server revalidates it against the CURRENT step exactly as it would any
// other reply. See PART 1 of GPC-3.1's own task for why a signed/opaque token was deliberately
// not introduced here.
export type NoaChoice = {
  label: string;
  // Optional short secondary line (dimension/price) - display-only, never sent back to the server.
  secondary?: string;
  value: string;
};

// NOA Attention structured UI: the smallest additive transport for rendering Attention findings
// as cards/chips instead of parsing the deterministic prose (see noa-orchestrator.ts's own
// comment on why this exists). Deliberately narrow - only the fields the renderer needs, all
// already safe/business-facing values the Attention capability itself already produces. Never a
// DB uuid, vendor_key, quotation_id, or internal audit id - `entityIdentifier` is always a plain
// business identifier (e.g. an orderNo) when present, nothing else.
export type NoaAttentionSourceDomain = "Price" | "Procurement" | "ClientPayment";

export type NoaAttentionTransportItem = {
  sourceDomain: NoaAttentionSourceDomain;
  kind: string;
  title: string;
  detail: string;
  entityLabel: string;
  entityIdentifier?: string;
};

export type NoaAttentionTransport = {
  count: number;
  items: NoaAttentionTransportItem[];
};

// N2B3.4: the smallest additive transport for rendering Catch-Up answers as a timeline instead of
// the client parsing deterministic prose. Mirrors the structured-change shape B3.1/B3.2 already
// validate server-side (never redefined differently here) and only the fields
// noa-user-activity-capability.server.ts's own NoaCatchUpItem already exposes - never a DB uuid,
// entity uuid, parent uuid, or raw metadata. `actorLabel` is omitted by the orchestrator whenever
// the server's own unresolved-actor sentinel would otherwise show, so its mere presence here
// already means "safe to display".
export type NoaCatchUpChange = {
  field: string;
  label?: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  currency?: string;
};

export type NoaCatchUpTransportItem = {
  occurredAt: string;
  action: string;
  title: string;
  detail?: string;
  actorLabel?: string;
  entityType: string;
  occurrenceCount?: number;
  changes?: NoaCatchUpChange[];
};

export type NoaCatchUpTransport = {
  // Present only for entity-scoped Catch-Up (the CO/QN identifier itself) - global Catch-Up omits
  // this and the client falls back to a neutral heading, never an inferred time-window label.
  heading?: string;
  entityIdentifier?: string;
  rawEventCount: number;
  groupCount: number;
  items: NoaCatchUpTransportItem[];
};

// N2C1.1: the smallest additive transport for rendering quotation Analytics as compact cards
// instead of the client parsing deterministic prose. Deliberately narrower than a general-purpose
// dashboard contract - no chart/axis/color config, just factual values already computed by
// noa-insights-capability.server.ts. `value` on a metric may contain multiple `\n`-separated lines
// when multiple currencies exist (PART 6) - never a merged/converted single figure.
export type NoaAnalyticsMetric = {
  key: string;
  label: string;
  value: string;
};

export type NoaAnalyticsStatusRow = {
  label: string;
  count: number;
};

export type NoaAnalyticsCurrencyComparisonRow = {
  currency: string;
  currentValue: number;
  previousValue: number;
  difference: number;
};

export type NoaAnalyticsComparison = {
  currentLabel: string;
  previousLabel: string;
  currentCount: number;
  previousCount: number;
  countDifference: number;
  currencyRows: NoaAnalyticsCurrencyComparisonRow[];
};

export type NoaAnalyticsTrendRow = {
  label: string;
  count: number;
  currency?: string;
  total?: number;
};

// N2C2.1: a numbered ranking row - `value` is the server's own already-formatted figure (a plain
// count, or ONE currency's amount), never a merged cross-currency figure.
export type NoaAnalyticsRankingRow = {
  rank: number;
  label: string;
  value: string;
};

// N2C2.1: one ranked list. A currency-based ranking is emitted as one group PER currency (heading =
// that currency code); a count ranking is a single group with no currency at all.
export type NoaAnalyticsRankingGroup = {
  heading?: string;
  rows: NoaAnalyticsRankingRow[];
};

export type NoaAnalyticsTransport = {
  kind:
    | "quotation_analytics"
    | "quotation_compare"
    | "quotation_trend"
    // N2C2.1/N2C3/N2C4: additive kinds over the SAME transport/card UI - never a second UI stack.
    | "project_file_analytics"
    | "client_analytics"
    | "product_analytics"
    | "procurement_analytics"
    | "payment_analytics";
  title: string;
  period?: string;
  metrics?: NoaAnalyticsMetric[];
  statusBreakdown?: NoaAnalyticsStatusRow[];
  // N2C2.1: optional heading for the status chip section (defaults to "Status").
  statusLabel?: string;
  comparison?: NoaAnalyticsComparison;
  trend?: NoaAnalyticsTrendRow[];
  rankings?: NoaAnalyticsRankingGroup[];
  // N2C2.1: a short muted scope/bound note (e.g. "Based on the 200 most recent records") - always
  // server-written, never client-invented.
  note?: string;
  emptyMessage?: string;
};

export type NoaMessage = {
  createdAt: number;
  // Attention structured UI: present only on an assistant Attention answer, and only ever the
  // server's own already-authorized items for THAT answer - never client-computed, never carried
  // over from a prior message. See NoaAnswer.attention below for the full rationale.
  attention?: NoaAttentionTransport;
  // N2C1.1: present only on an assistant quotation-Analytics answer, reshaped from the SAME
  // capabilityResult.data every Insights answer already returns - never client-computed. See
  // NoaAnswer.analytics below.
  analytics?: NoaAnalyticsTransport;
  // N2B3.4: present only on an assistant Catch-Up answer that actually has items - the same
  // server-authorized items array the deterministic text was built from, never client-computed,
  // never carried over from a prior message. See NoaAnswer.catchUp below.
  catchUp?: NoaCatchUpTransport;
  // GPC-3.1: only ever set on an assistant guided-configuration question, and only ever the SAME
  // choices that answer's own text already describes - never client-supplied, never persisted
  // beyond this one message (see noa-messages.tsx: only the LATEST assistant message's choices are
  // clickable).
  choices?: NoaChoice[];
  // Set only on assistant replies once a real backend answer arrives (Phase 1B) - user messages
  // never carry these.
  domain?: NoaDomain;
  id: string;
  role: NoaMessageRole;
  sources?: NoaSource[];
  text: string;
};

// Phase 1A only needs enough to gate visibility and (later) pass along to a real backend -
// appRole is kept as a plain string here (rather than importing the app's AppRole type) so this
// module stays alias-free; callers can pass the real AppRole value in, since it's string-based.
export type NoaAuthContext = {
  appRole: string | null;
  displayName: string;
  userId: string;
};

export type NoaPageSection =
  | "dashboard"
  | "projects"
  | "products"
  | "quotations"
  | "procurement"
  | "insights"
  | "system"
  | "other";

export type NoaPageContext = {
  brandId?: string;
  pathname: string;
  productTemplateId?: string;
  projectId?: string;
  quotationId?: string;
  section: NoaPageSection;
};

// Phase 1B backend types - still alias-free/pure, so lib/noa/noa-intent-router.ts (and any other
// pure NOA helper) can depend on them and stay unit testable.

export type NoaDomain = "Product" | "Quotation" | "Price" | "Project" | "Client" | "Procurement" | "UserActivity" | "Admin" | "Insights" | "Attention" | "Help";

export type NoaSource = {
  label: string;
  recordId?: string;
  type: string;
};

export type NoaAnswer = {
  // Attention structured UI: present ONLY for a successful Attention answer that actually has
  // findings - the orchestrator populates this from the SAME already-authorized items array the
  // deterministic text was built from, never a client-side reconstruction. Absent for every other
  // domain and for an empty/unauthorized Attention result, so the client's existing fallback to
  // plain `text` rendering (PART 11) is exercised automatically, not a special case.
  attention?: NoaAttentionTransport;
  // N2C1.1: present ONLY for a quotation Analytics answer (quotation_analytics/quotation_compare/
  // quotation_trend) - reshaped from the SAME structured `data` every Insights answer already
  // returns, never a client-side reconstruction from prose. Absent for every other Insights kind
  // (quotation_summary, project/client/product/procurement summaries, overview, the
  // conversion-rate refusal) and every other domain, so the client's existing fallback to plain
  // `text` rendering (PART 17) is exercised automatically, not a special case.
  analytics?: NoaAnalyticsTransport;
  // N2B3.4: present ONLY for a successful Catch-Up answer that actually has items - the
  // orchestrator populates this from the SAME already-fetched items array the deterministic text
  // was built from, never a client-side reconstruction. Absent for every other UserActivity kind
  // and every other domain, so the client's existing fallback to plain `text` rendering (PART 19)
  // is exercised automatically, not a special case.
  catchUp?: NoaCatchUpTransport;
  // GPC-3.1: present only for a guided-configuration question - see NoaChoice/NoaMessage above.
  // Absent (undefined) for every ordinary NOA answer (Quotation/Project/Client/Product Q&A/Price/
  // Procurement/UserActivity), so existing rendering is entirely unaffected (PART 11).
  choices?: NoaChoice[];
  domain: NoaDomain;
  sources: NoaSource[];
  text: string;
  // C3: the fresh, bounded reference to THIS result (UserActivity only today) - the caller
  // round-trips it verbatim on the next request so a short follow-up ("which quotation?", "what
  // about yesterday?") can be resolved without parsing prose. Omitted (not merged/accumulated)
  // whenever this result has no useful reference, so the client always replaces its stored
  // reference with exactly what the server returns.
  conversationReference?: NoaConversationReference;
  // GPC-3: the fresh Product Configuration reference for THIS result, if a guided configuration is
  // active - kept entirely separate from conversationReference (see
  // noa-product-configuration-reference.ts). Unlike conversationReference, this is preserved
  // across an ordinary unrelated answer rather than cleared by omission - see
  // noa-orchestrator.ts's passthrough handling.
  productConfigurationReference?: NoaProductConfigurationReference;
};

export type NoaChatRequest = {
  context: NoaPageContext;
  // C3: the caller's own previously-returned conversationReference, round-tripped verbatim - see
  // NoaAnswer.conversationReference. Untrusted input: validated with isNoaConversationReference()
  // before use, never assumed well-formed.
  conversationReference?: NoaConversationReference;
  // GPC-3: the caller's own previously-returned productConfigurationReference, round-tripped
  // verbatim - see NoaAnswer.productConfigurationReference. Untrusted input: validated with
  // isNoaProductConfigurationReference() before use, never assumed well-formed.
  productConfigurationReference?: NoaProductConfigurationReference;
  // Conversation polish: the caller's own safe display name (profiles.full_name), used only for
  // occasional personalization (greetings, provider tone) - optional since callers/tests that
  // don't have it yet must keep working unchanged.
  displayName?: string;
  message: string;
  recentMessages?: Array<{ role: NoaMessageRole; text: string }>;
};

// Internal routing result, richer than the public NoaDomain shown to users: covers self/page-
// context questions, plus (conversation polish) casual greetings and explicit "what can you do"
// capability questions. None of "context"/"greeting"/"capabilities" is ever exposed as a
// user-facing domain badge - all three resolve to the Help domain in the final NoaAnswer. Kept
// alias-free like the rest of this file.
// B5: Procurement is now a real NoaDomain rather than a placeholder unsupported-domain route,
// mirroring exactly how Project and Client were each promoted the same way in earlier phases.
export type NoaRouteKind = NoaDomain | "context" | "greeting" | "capabilities";

// Shared result shape every NOA capability function returns: either the allow-listed data it
// fetched (already scoped to what the current user is authorized to see) plus the source
// descriptors to surface, or a safe reason the request could not be fulfilled - never a raw
// error/exception, so the orchestrator/route never has to guess what happened.
export type NoaCapabilityResult =
  | { data: unknown; ok: true; sources: NoaSource[] }
  | { message: string; ok: false; reason: "unauthorized" | "not_found" | "ambiguous" };
