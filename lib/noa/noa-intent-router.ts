import type { NoaDomain, NoaPageContext, NoaRouteKind } from "./noa-types";

// Pure, alias-free, deterministic routing (no second LLM call) - kept in its own module per the
// Phase 1B testability requirement: everything else that would dispatch to it
// (lib/noa/noa-orchestrator.ts) also imports "@/..." capability/provider modules and so can't be
// unit tested directly with the plain Node test runner, but this classifier can be.

// Conversation polish: pure conversational greetings only - anchored to the WHOLE normalized
// message (not a substring check) so a greeting embedded in a longer real question ("hi, how many
// quotations do we have") is never misrouted here; only a message that IS just a greeting matches.
// Checked before everything else, including HELP_PHRASES, so "hey noa" never falls through to the
// stiff capability-list Help answer.
const GREETING_PATTERNS = [
  /^hi$/, /^hi noa$/,
  /^hello$/, /^hello noa$/,
  /^hey$/, /^hey noa$/,
  /^good morning$/, /^good afternoon$/, /^good evening$/,
  /^how are you$/, /^how are you doing$/, /^how'?s it going$/,
];

// Conversation polish: explicit "what can you do" style questions only - NOA's capability list is
// shown ONLY here, never on every unrelated Help/out-of-scope fallback.
const CAPABILITY_HELP_PHRASES = [
  "what can you do",
  "what are your capabilities",
  "how can you help",
  "how can you help me",
  "what do you support",
  "what can noa do",
  "tell me what you can do",
];

// Phrasing that means "help me use ProjectWorkflow" regardless of which domain nouns appear in
// the rest of the sentence (e.g. "How do I archive a product?" is a Help question, not a Product
// lookup) - checked before any domain keyword list.
const HELP_PHRASES = ["how do i", "how can i", "where do i", "where can i", "how does noa"];

// Generic off-topic signals that must resolve to Help/out-of-scope regardless of which page the
// user happens to be on, so page-context fallback never accidentally routes an unrelated question
// (e.g. "what's the weather?" asked while on a Products page) into a capability lookup.
const OFF_TOPIC_SIGNALS = [
  "weather",
  "joke",
  "recipe",
  "movie",
  "song",
  "poem",
  "sports score",
  "celebrity",
  "trivia",
  "translate this",
  "write me a",
  "what is the capital of",
];

// NOA self/page-context questions ("where am I", "which page is this") - these ask about NOA's
// own current context, never about product/quotation/price data, and must never fall through to
// a capability lookup just because the current page happens to be Products.
const SELF_CONTEXT_PHRASES = [
  "where am i",
  "which page",
  "what page",
  "what am i viewing",
  "what section am i",
  "where are we",
  "what screen is this",
  "what can you see",
];

// UA-1A: explicit "my own recorded activity" phrasing only - checked before every domain keyword
// list (including Price/Quotation, since "what prices did i check" and "quotations did i work on"
// contain the bare substrings "price"/"quotation" that would otherwise win) so explicit activity
// intent always beats both domain keywords and page context, per the UA-1A routing requirement.
// Deliberately narrow: every pattern requires an explicit "i"/"my" activity verb, so ordinary
// domain questions ("show quotations", "show products") never match any of these.
const USER_ACTIVITY_PATTERNS = [
  /\b(?:projectworkflow )?active time\b/,
  /\bactivity time\b/,
  /\bhow active (?:was|am) i\b/,
  /\bhow (?:much|long) (?:time )?(?:am|i) active\b/,
  /\bfirst (?:recorded )?activity today\b/,
  /\b(?:latest activity|last activity today)\b/,
  /\bwas i active recently\b/,
  /\b(?:activity|active) intervals? today\b/,
  /\bhow many active intervals?\b/,
  /\bhow many (?:activity )?intervals?\b/,
  /\bmy interval count\b/,
  /\bwhat (?:did|do) i (?:work|worked) on\b/,
  /\bwhat i (?:work|worked) (?:on )?today\b/,
  /\bwhat did i do\b/,
  /\bwhat i did\b/,
  /\bshow my (?:recent )?(?:projectworkflow )?activity\b/,
  /\bmy (?:recent )?activity\b/,
  /\bmy last activity\b/,
  /\blast projectworkflow activity\b/,
  /\bshow my last work\b/,
  /\bhow many (?:quotations?|quote) did i (?:work|worked) on\b/,
  /\bhow many quote i worked\b/,
  /\bwhat (?:prices|price) did i check\b/,
  /\bwhat did i (?:update|check)\b/,
  /\bhow many hours did i work\b/,
  /\bwhat time did i start work\b/,
  /\bwhen did i clock in\b/,
  /\bam i online\b/,
  /\bam i (?:currently )?working\b/,
  /\bam i (?:currently )?at work\b/,
  // Natural-language "record"/"activity" phrasing - deliberately requires "my"/"i"/"today" in a
  // specific position (never a bare "record" keyword) so "show client record"/"show project
  // record"/"show quotation record" are never matched here and keep routing to their own domain.
  /\bmy record today\b/,
  /\bwhat is my record\b/,
  /\btoday'?s? record\b/,
  /\bmy work record\b/,
  /\btoday'?s activity\b/,
  /\bwhat activity i have\b/,
];

// UA-1B: explicit team/other-user activity phrasing - same routing precedence as
// USER_ACTIVITY_PATTERNS above (checked at the same point, before every domain keyword list), so
// e.g. "who worked on quotations today" isn't stolen by the Quotation keyword list. Deliberately
// narrow: every pattern requires an explicit "team"/"who <verb>"/named-target activity phrase, so
// "show users" (no activity verb) and ordinary domain questions never match any of these.
const TEAM_AND_OTHER_USER_ACTIVITY_PATTERNS = [
  /\bwho (?:has|had) (?:recent )?(?:projectworkflow )?activity\b/,
  /\bwho is working now\b/,
  /\bshow today'?s user activity time\b/,
  /\b(?:show|what is|how much|how long) \w+(?:'s)? (?:projectworkflow )?(?:active|activity) time\b/,
  /\bshow \w+(?:'s)? (?:projectworkflow )?activity intervals?\b/,
  /^\w+(?:'s)? (?:projectworkflow )?(?:active|activity) time\b/,
  /\bwhat did the team work on\b/,
  /\bshow (?:recent )?team activity\b/,
  /\bhow many (?:quotations?|quote) did the team work on\b/,
  /\bwho worked on quotations?\b/,
  /\bwho edited quotations?\b/,
  /\bwho is active recently\b/,
  /\bwho is (?:currently )?working\b/,
  // Specific-other-user phrasing - \w+ intentionally also matches "i"/"my" (already handled
  // above, same UserActivity route either way) but never matches multi-word subjects like
  // "the team" (handled separately above), so it can't misfire on team phrasing.
  /\bwhat did \w+(?:'s)? work on\b/,
  /\bshow \w+(?:'s)? activity\b/,
  /\bwhat quotations did \w+ work on\b/,
  /\bwhat was \w+'s last (?:recorded )?(?:projectworkflow )?activity\b/,
];

// B6: narrow Admin/System phrasing - checked at the same early precedence point as UserActivity
// (before every domain keyword list), since "model"/"provider" would otherwise collide with
// PRODUCT_KEYWORDS' bare "model" and other lists below. Deliberately specific: "show users" /
// role-count phrasing / named-user role-or-status lookup / AI provider+agent phrasing / an
// explicit "admin summary"/"system summary" phrase - never a bare "who"/"users" mention alone,
// so it can't collide with UA-1B's team-activity "who" phrasing above (checked first, so a
// genuine team-activity question like "who worked on quotations" already returned UserActivity
// before this list is ever reached).
const ADMIN_PATTERNS = [
  /\bshow (?:active |disabled |pending )?users?\b/,
  /\bhow many users?\b/,
  /\bhow many (?:system owners?|admin managers?|sales designers?|sales coordinators?|procurement managers?|designers?|viewers?)\b/,
  /\bwhat role does .+ have\b/,
  /\bwhat is .+ account status\b/,
  /\bwhich (?:ai )?providers?\b/,
  /\bwhich (?:ai )?agents? (?:are|is)\b/,
  /\bwhat provider does .+ use\b/,
  /\bwhat model does .+ use\b/,
  /\bshow ai agent (?:configuration|settings|status)\b/,
  /\b(?:admin|system) summary\b/,
  /\bwhich provider credentials?\b/,
];

// B7: narrow analytics/summary/trend phrasing only - checked at the same early precedence point
// as Admin/UserActivity above, but deliberately never matches a bare domain-noun question ("show
// pending quotations", "show active projects", "which products need price checking",
// "procurement status") - each of those still routes to its own operational capability exactly as
// before, since none of them contain "summary"/"trend"/"overview"/"insights" wording.
const INSIGHTS_PATTERNS = [
  /\bshow insights?\b/,
  /\binsights? (?:summary|overview)\b/,
  /\bshow (?:projectworkflow|business) summary\b/,
  /\b(?:projectworkflow|business) summary\b/,
  /\bquotation trend\b/,
  /\bquotation summary\b/,
  /\bproject summary\b/,
  /\bclient summary\b/,
  /\bprocurement summary\b/,
  /\bproduct price (?:status )?summary\b/,
  /\bbusiness overview\b/,
  /\bthis month'?s overview\b/,
  /\bgive me (?:a|this month'?s) (?:business )?(?:summary|overview)\b/,
  /\bwhat changed\b/,
];

const PRICE_KEYWORDS = [
  "price status",
  "needs check",
  "price list",
  "price warning",
  "current price",
  "due",
  "pricing",
  "price",
];

const QUOTATION_KEYWORDS = [
  "quotation",
  "quote number",
  "quote",
  "line item",
  "project quotation",
  "quoted product",
  "client",
  "total",
];

const PRODUCT_KEYWORDS = [
  "supplier code",
  "linked family",
  "linked families",
  "discontinued",
  "archived",
  "product",
  "template",
  "brand",
  "finish",
  "material",
  "model",
  "accessory",
  "origin",
  // A bare search verb: "find OXI" / "find Every" is an implicit product-search request even
  // with no other product noun present, including when asked on a Quotation page.
  "find",
];

// Checked only AFTER the explicit Price/Quotation/Product keyword lists above (see
// classifyNoaRoute) so a message like "what is the project quotation total" - which already
// contains the more specific Quotation keyword "project quotation" - is never misclassified just
// because it also contains the bare word "project".
const PROJECT_KEYWORDS = ["project", "projects"];
// B5: Procurement is a real NoaDomain now, previously a placeholder unsupported-domain route.
const PROCUREMENT_KEYWORDS = ["procurement", "purchase order", "purchase orders", "rfq", "vendor"];

// B4: explicit Client-record phrasing only. Deliberately NOT a bare "client" keyword (that stays
// a Quotation keyword below) - each pattern here requires a Client-specific verb/phrase, so
// "show quotations for client X" and "quotation total for client X" never match any of these and
// keep routing to Quotation exactly as before.
const CLIENT_INTENT_PATTERNS = [
  /\bclient details?\b/,
  /\bdetails? for (?:the )?client\b/,
  /\bclient info(?:rmation)?\b/,
  /\bshow clients?\b/,
  /\blist clients?\b/,
  /\ball clients?\b/,
  /\brecent clients?\b/,
  /\bclients? list\b/,
  /\bhow many clients\b/,
  /\bprojects?\b[\s\S]*\bfor (?:the )?client\b/,
  /\bhow many projects\b[\s\S]*\bclient\b/,
];

// Words that mark a message as a genuine follow-up about whatever is currently on screen, rather
// than an unrelated fresh statement that merely happens to share a page with a capability domain.
// Page-context fallback (classifyNoaRoute's last resort before defaulting to Help) only applies
// when one of these is present.
// B1 addition: "show"/"which"/"all"/"how many" cover broad browsing/counting phrasing that names
// no other domain noun the router can verify ("show LAS chairs", "how many chairs") - these only
// resolve a domain via page context (like every other contextual-fallback word already did), so a
// bare "how many users" asked from an unrelated page still safely falls through to Help rather
// than guessing a domain NOA has no capability for.
const CONTEXTUAL_FOLLOWUP_WORDS = [
  "this", "current", "here", "warning", "status", "item", "line", "selected", "viewing",
  "show", "which", "all", "how many",
];

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

// A small, explicit, ProjectWorkflow-relevant typo/spelling-variant table - not a generic
// spellchecker and not a fuzzy-matching library. Whole-token replacement only (applied after
// normalizeNoaUserMessage has already split on whitespace), so it never corrupts an unrelated
// word that merely contains one of these strings as a substring.
const SPELLING_VARIANTS: Readonly<Record<string, string>> = {
  availble: "available",
  confimed: "confirmed",
  confrimed: "confirmed",
  curent: "current",
  currenly: "currently",
  mange: "manage",
  pendng: "pending",
  pric: "price",
  prdcut: "product",
  prdct: "product",
  prduct: "product",
  prodcut: "product",
  qoutation: "quotation",
  qoute: "quote",
  quatation: "quotation",
  quostion: "question",
  quotatoin: "quotation",
  quots: "quotes",
  statuz: "status",
};

// Pure normalization for rough/imperfect user input: lowercases, trims, collapses repeated
// whitespace, strips simple sentence punctuation (so it never breaks a multi-word keyword phrase
// like "how do i" or "price status"), and corrects a small fixed set of common ProjectWorkflow-
// relevant typos. This is deliberately NOT a spellchecker and NOT fuzzy matching - it only ever
// does exact whole-token lookups against SPELLING_VARIANTS, so it stays fast, predictable, and
// free of any new dependency. classifyNoaRoute runs every message through this before any keyword
// check, so all routing below already benefits from it without each list needing typo entries.
export function normalizeNoaUserMessage(message: string): string {
  const collapsed = message
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!collapsed) {
    return "";
  }

  return collapsed
    .split(" ")
    .map((token) => SPELLING_VARIANTS[token] ?? token)
    .join(" ");
}

// Pure detector for lib/noa/noa-orchestrator.ts's narrow page-context fallback (PART 7/4): a
// message with none of these words is not "about this page" and must not silently become a
// Product/Quotation guess just because of where the user happens to be.
export function isContextualFollowUp(message: string): boolean {
  const normalized = message.toLowerCase();
  return CONTEXTUAL_FOLLOWUP_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(normalized));
}

// The full internal routing decision (NoaRouteKind), including the one deterministic-answer-only
// route ("context") that must never reach a capability or the AI provider. The message is run
// through normalizeNoaUserMessage() first (typos, spacing, punctuation), so every keyword check
// below already tolerates rough/imperfect English without each keyword list needing its own typo
// entries. Priority, exactly as specified: A. Help/out-of-scope -> B. self/page-context ->
// D/E/F. explicit Price/Quotation/Product keywords -> C. Project/Procurement keywords -> G.
// narrow contextual page-context fallback -> H. Help default.
// (C is coded after D/E/F rather than before: since D/E/F return immediately on any match, this
// is behaviorally identical to "C before D/E/F, guarded to only fire when none of them matched" -
// simpler code, same precedence, and it's what prevents "project quotation total" from ever being
// misrouted to the Project domain instead of Quotation.)
export function classifyNoaRoute(message: string, context: NoaPageContext): NoaRouteKind {
  const normalized = normalizeNoaUserMessage(message);

  // Conversation polish: checked before everything else - a pure greeting or an explicit
  // capability question always wins, regardless of page context or any domain keyword.
  if (GREETING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "greeting";
  }

  if (includesAny(normalized, CAPABILITY_HELP_PHRASES)) {
    return "capabilities";
  }

  if (includesAny(normalized, HELP_PHRASES)) {
    return "Help";
  }

  if (includesAny(normalized, OFF_TOPIC_SIGNALS)) {
    return "Help";
  }

  if (includesAny(normalized, SELF_CONTEXT_PHRASES)) {
    return "context";
  }

  // UA-1A: explicit own-activity intent beats every domain keyword and page-context fallback
  // below, including Price/Quotation (see USER_ACTIVITY_PATTERNS' comment for why this must be
  // checked first among the domain-ish routes).
  if (
    USER_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    TEAM_AND_OTHER_USER_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return "UserActivity";
  }

  // B6: checked immediately after UserActivity so a genuine team-activity "who" question above
  // already won; Admin never gets a chance to steal it.
  if (ADMIN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "Admin";
  }

  // B7: checked after Admin, before every operational domain keyword list, so an explicit
  // analytics/summary/trend question always wins - but never a bare operational question (see
  // INSIGHTS_PATTERNS' comment).
  if (INSIGHTS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "Insights";
  }

  // Price checked before Quotation/Product: a price-specific ask ("is this product's price
  // status current or due?") is more specific than the domain noun it also mentions.
  if (includesAny(normalized, PRICE_KEYWORDS)) {
    return "Price";
  }

  if (/\b(compare|difference between)\b/.test(normalized) && /\b[a-z]{0,4}-?\d{3,}/i.test(normalized)) {
    return "Quotation";
  }

  // A client label is part of Project detail, not a cross-domain Client request. Keep this
  // narrow so explicit quotation vocabulary below still wins for "quotations for project X".
  if (/\bproject\b/.test(normalized) && /\b(what client|which client)\b/.test(normalized)) {
    return "Project";
  }

  // B4: narrow, explicit Client-intent phrasing only - never a bare "client" capture, since
  // "client" is also a Quotation keyword just below ("quotations for client X" / "quotation
  // total for client X" must keep routing to Quotation exactly as before). Only phrasing that
  // unambiguously asks about the Client record itself resolves here.
  if (CLIENT_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "Client";
  }

  if (includesAny(normalized, QUOTATION_KEYWORDS)) {
    return "Quotation";
  }

  if (includesAny(normalized, PROJECT_KEYWORDS)) {
    return "Project";
  }

  if (includesAny(normalized, PRODUCT_KEYWORDS)) {
    return "Product";
  }

  if (includesAny(normalized, PROCUREMENT_KEYWORDS)) {
    return "Procurement";
  }

  if (normalized.includes("help")) {
    return "Help";
  }

  // Narrow page-context fallback: only for a genuinely contextual/ambiguous follow-up ("why is
  // this warning showing?", "tell me about this"), never for an unrelated bare statement that
  // merely happens to share a page with a capability domain.
  if (isContextualFollowUp(normalized)) {
    if (context.section === "quotations" || context.quotationId) {
      return "Quotation";
    }

    if (context.section === "products" || context.productTemplateId) {
      return "Product";
    }
  }

  return "Help";
}

// Backward-compatible entry point for callers that only need the public, user-facing domain
// (e.g. the chat UI's pendingDomain/status text) - "context" and "unsupported_*" routes are
// internal-only and never shown as a domain badge, so they collapse to "Help" here.
export function classifyNoaIntent(message: string, context: NoaPageContext): NoaDomain {
  const route = classifyNoaRoute(message, context);
  return route === "Product" || route === "Quotation" || route === "Price" || route === "Project" || route === "Client" || route === "Procurement" || route === "UserActivity" || route === "Admin" || route === "Insights" || route === "Help"
    ? route
    : "Help";
}

const PATHNAME_LABELS: ReadonlyArray<{ label: string; prefix: string }> = [
  { label: "Product Management", prefix: "/products/manage" },
];

function specificPathnameLabel(pathname: string): string | null {
  const match = PATHNAME_LABELS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`),
  );
  return match?.label ?? null;
}

const SECTION_SENTENCES: Record<NoaPageContext["section"], string> = {
  dashboard: "You're currently on the Dashboard.",
  insights: "You're currently in Insights.",
  other: "You're currently in ProjectWorkflow.",
  procurement: "You're currently in Procurement.",
  products: "You're currently in Products.",
  projects: "You're currently in Projects.",
  quotations: "You're currently in Quotations.",
  system: "You're currently in System settings.",
};

// Pure, human-readable description of NoaPageContext for the "context"/self-question route -
// never exposes a raw UUID; ids only ever gate which sentence is chosen.
export function describeNoaPageContext(context: NoaPageContext): string {
  if (context.productTemplateId) {
    return "You're currently in Product Management, viewing/editing a product template.";
  }

  if (context.quotationId) {
    return "You're currently viewing a quotation.";
  }

  if (context.projectId) {
    return "You're currently viewing a project.";
  }

  const specificLabel = specificPathnameLabel(context.pathname);
  if (specificLabel) {
    return `You're currently in ${specificLabel}.`;
  }

  return SECTION_SENTENCES[context.section];
}

// Conversation polish: pure, deterministic greeting text for the "greeting" route - never sent to
// the AI provider, matching the existing "context"/Help fallback pattern (fast, fixed, no model
// call for something this trivial). Uses the caller's own safe display name (profiles.full_name)
// only occasionally - once, in the greeting itself - never forced into routine answers elsewhere.
// Falls back to a generic greeting when no name is available, per PART 1's explicit requirement.
export function greetingResponseText(message: string, displayName?: string): string {
  const normalized = normalizeNoaUserMessage(message);
  const name = displayName?.trim().split(/\s+/).find(Boolean) || null;

  if (/\bhow are you\b/.test(normalized) || /\bhow'?s it going\b/.test(normalized)) {
    return "I'm doing well — how can I help?";
  }

  const timeGreeting = /\bgood morning\b/.test(normalized)
    ? "Good morning"
    : /\bgood afternoon\b/.test(normalized)
      ? "Good afternoon"
      : /\bgood evening\b/.test(normalized)
        ? "Good evening"
        : null;

  if (timeGreeting) {
    return name ? `${timeGreeting}, ${name}. How can I help?` : `${timeGreeting}! How can I help?`;
  }

  const casualWord = /\bhi\b/.test(normalized) ? "Hi" : "Hey";
  return name ? `${casualWord} ${name} 👋 How can I help?` : "Hey 👋 How can I help?";
}

// Conversation polish: NOA's capability summary, shown ONLY for an explicit "what can you do"
// style question (the "capabilities" route) - never on ordinary Help/out-of-scope fallback.
// Manually kept in sync with the currently-implemented NOA capabilities; Attendance and any
// write action are deliberately not advertised since neither exists yet.
export const NOA_CAPABILITY_SUMMARY_TEXT =
  "I can help with products and pricing, quotations, projects, clients, procurement, your ProjectWorkflow activity, admin settings where you have access, insights, and your current page/context. Ask me naturally — for example, \"show active projects\" or \"what did I work on today?\"";

const THINKING_STATUS_BY_DOMAIN: Record<NoaDomain, string> = {
  Admin: "Checking system settings...",
  Client: "Checking client records...",
  Insights: "Calculating insights...",
  Help: "Reviewing ProjectWorkflow guidance...",
  Price: "Checking price status...",
  Procurement: "Checking procurement orders...",
  Product: "Checking Product Library...",
  Project: "Checking projects...",
  Quotation: "Checking this quotation...",
  UserActivity: "Checking your ProjectWorkflow activity...",
};

// Domain-aware "what NOA is checking" copy for the thinking status, derived from the same
// deterministic classification - never a second routing implementation. Kept NoaDomain-typed
// (not NoaRouteKind) since the current chat UI's pendingDomain state is NoaDomain-typed.
export function noaThinkingStatusText(domain: NoaDomain): string {
  return THINKING_STATUS_BY_DOMAIN[domain];
}

const ROUTE_STATUS_TEXT: Record<NoaRouteKind, string> = {
  ...THINKING_STATUS_BY_DOMAIN,
  capabilities: "Reviewing ProjectWorkflow guidance...",
  context: "Checking your current ProjectWorkflow page...",
  greeting: "Saying hello...",
};

// Richer, NoaRouteKind-aware status text covering the "context" route too (PART 9) - additive;
// the chat UI can adopt this in place of noaThinkingStatusText once it threads a NoaRouteKind
// instead of a NoaDomain through to NoaStatus.
export function noaRouteStatusText(route: NoaRouteKind): string {
  return ROUTE_STATUS_TEXT[route];
}
