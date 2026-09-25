import type { NoaChoice, NoaDomain, NoaPageContext, NoaRouteKind } from "./noa-types";
import type { NoaSemanticRequestV2 } from "./noa-semantic-request";
import { resolveNoaSemanticCapabilityRequest, type NoaSemanticResolution } from "./noa-semantic-resolver";

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
  /\bfirst (?:recorded |projectworkflow )?activity today\b/,
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
  /\bwho is (?:currently )?(?:online|working|at work)\b/,
  /\bis [a-z][a-z'-]* online\b/,
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
// N2B1: narrow, historical/event-oriented phrasing - "what changed"/"what happened"/"catch me
// up" - checked at this SAME early precedence point (before every domain keyword list, including
// Insights) so a genuine change-history question always wins. This is the proven fix for the B0
// UAT collision: INSIGHTS_PATTERNS used to contain `/\bwhat changed\b/` itself, which is why
// "What changed today?" used to route to Insights before ever reaching this check - that pattern
// has been removed from INSIGHTS_PATTERNS (a message matching it now only ever matches here
// instead). Deliberately anchored to the actual verb phrase, never a bare "changed"/"happened"/
// "catch"/"check"/"attention" keyword, so ordinary Insights summary/trend/overview phrasing (none
// of which contains "changed"/"happened"/"catch me up") is never captured here.
const CATCH_UP_PATTERNS = [/\bwhat changed\b/, /\bwhat happened\b/, /\bcatch me up\b/];

// e.g. "who worked on quotations today" isn't stolen by the Quotation keyword list. Deliberately
// narrow: every pattern requires an explicit "team"/"who <verb>"/named-target activity phrase, so
// "show users" (no activity verb) and ordinary domain questions never match any of these.
const TEAM_AND_OTHER_USER_ACTIVITY_PATTERNS = [
  /\bwho (?:has|had) (?:recent )?(?:projectworkflow )?activity\b/,
  /\bwho is working now\b/,
  /\bwho is currently online\b/,
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
  /\bwhat did \w+(?:'s)? do today\b/,
  /\bwhat \w+(?:'s)? did today\b/,
  /\bwhat has \w+(?:'s)? done today\b/,
  /\bshow \w+(?:'s)? activity\b/,
  /\bwhat quotations did \w+ work on\b/,
  /\bwhat was \w+'s last (?:recorded )?(?:projectworkflow )?activity\b/,
];

const RECORDED_QUOTATION_FOLLOW_UP_PATTERNS = [
  /^which (?:quotation|quote)$/,
  /^show me which (?:quotation|quote)$/,
  /^what (?:quotation|quote) was that$/,
];

const RECORDED_OWN_ACTIVITY_REFERENCE = /\bwhat (?:did|do) i work on\b|\bwhat did i do\b|\b(?:show )?my (?:recent )?(?:projectworkflow )?activity\b|\b(?:what is )?my record\b|\bmy work record\b/;

// Conversation text establishes only the referent. The follow-up capability re-reads bounded
// audit rows for every quotation fact and identity rather than trusting remembered prose.
export function recordedQuotationFollowUpReference(
  message: string,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>,
): string | null {
  const normalized = normalizeNoaUserMessage(message);
  if (!RECORDED_QUOTATION_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  const priorUserMessage = [...recentMessages].reverse().find((entry) => entry.role === "user")?.text;
  if (!priorUserMessage || !RECORDED_OWN_ACTIVITY_REFERENCE.test(normalizeNoaUserMessage(priorUserMessage))) return null;
  return priorUserMessage;
}

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
  // N2C1: narrow, anchored quotation-analytics/aggregate phrasing only - checked at this same
  // INSIGHTS_PATTERNS precedence point (after UserActivity/Catch-Up, before every operational
  // domain keyword list), so historical/change-event phrasing (already caught earlier by
  // CATCH_UP_PATTERNS) and single-quotation current-state questions ("tell me about QN-0005-001",
  // "what is QN-0005-001 worth", "show QN-0005-001" - none of which match any pattern below,
  // since none contain "analytics"/"overview"/"breakdown"/a period word/"conversion rate"/
  // "compare ... month") are never stolen from their existing routes.
  /\bquotation analytics\b/,
  /\bsales overview\b/,
  /\bquotation status breakdown\b/,
  /\bhow much (?:did we|have we) quote[d]?\b/,
  /\bhow many quotations?\b[\s\S]*\b(?:this|last) (?:month|week|quarter|year)\b/,
  /\bhow much (?:was|is) client[- ]confirmed\b/,
  /\bcompare (?:this month|this week|this quarter|this year) (?:with|to|vs\.?) (?:last month|last week|last quarter|last year)\b/,
  /\b(?:conversion|win|success) rate\b/,
  // N2C2: narrow, anchored Project File/client analytics phrasing only - same precedence point as
  // the N2C1 block above. None of these match a bare CO/client-name identifier lookup ("tell me
  // about CO-0003-001", "tell me about Apex Luxury Retail"), a Catch-Up phrase (caught earlier by
  // CATCH_UP_PATTERNS), or an Attention phrase (caught earlier by ATTENTION_PATTERNS) - so those
  // stay on their existing routes untouched.
  /\bproject file analytics\b/,
  /\bproject analytics\b/,
  /\bhow many active project files?\b/,
  /\bactive project (?:file )?value\b/,
  /\bproject file status breakdown\b/,
  /\bhow many (?:projects?|project files?) (?:are|is) on[- ]?hold\b/,
  /\bclient analytics\b/,
  /\btop clients? by (?:quotation|confirmed|project(?:\s*file)?) value\b/,
  /\bhow many quotations does each client have\b/,
  // N2C3: narrow Product Library analytics/ranking phrasing only. Current-state Product/Price
  // questions ("show products", "how many active products", "which products need a price check",
  // "product price status") match none of these and keep their existing Product/Price routes.
  /\bproduct analytics\b/,
  /\bproduct summary\b/,
  /\b(?:products|product count) by (?:brand|category)\b/,
  /\btop (?:brands|categories) by product count\b/,
  // N2C4: narrow procurement/payment analytics phrasing only. Current-state Procurement questions
  // ("show procurement orders", "procurement status", "how many completed purchase orders do we
  // have", "which supplier is missing eta") match none of these and keep their existing routes.
  /\bprocurement analytics\b/,
  /\bprocurement status breakdown\b/,
  /\bhow many vendors? (?:are |is )?missing (?:eta|etd)\b/,
  /\bpayment analytics\b/,
  /\bclient payments? summary\b/,
  /\bhow much has been received\b/,
  /\bhow much (?:is )?(?:still )?outstanding\b/,
  /\bhow many (?:client )?payments? (?:are|is) overdue\b/,
];

// N2A1: explicit "what needs attention" style phrasing only - checked at the same early
// precedence point as Insights (before every operational domain keyword list below), so it can
// never be stolen by Price's bare "due" keyword or any other domain list. Deliberately full,
// anchored phrases (never a bare "check"/"attention" word alone) so an unrelated message that
// merely contains "check" ("what did i check") is never misrouted here - that phrasing already
// belongs to USER_ACTIVITY_PATTERNS, checked earlier, and stays there unaffected.
const ATTENTION_PATTERNS = [
  /\bwhat needs my attention\b/,
  /\bwhat needs attention(?: today)?\b/,
  /\banything i need to check\b/,
  /\bwhat should i look at\b/,
  /\bshow attention items\b/,
  /\bshow what needs attention\b/,
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
  /\btell me about client\b/,
  /\bshow client\b/,
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

export function entityLookupCandidate(message: string): string | null {
  const candidate = message.match(/^\s*tell me about\s+(.+?)\s*[?.!]*\s*$/i)?.[1]?.trim();
  return candidate || null;
}

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
  return classifyNoaRouteWithStrength(message, context).route;
}

// ============================================================================================
// I3: route match strength - additive metadata over the SAME precedence chain classifyNoaRoute()
// has always used (classifyNoaRoute() above now simply returns `.route` from this function, so its
// output is byte-for-byte unchanged for every existing caller). Strength says HOW the router
// arrived at the route, which is what the semantic-V2 activation rule needs:
//   exact           - greeting / capability-list / self-context / identifier-driven compare
//   anchored        - explicit anchored phrase lists (UserActivity, Catch-Up, Admin, Insights,
//                     Attention, how-to, off-topic, explicit Client phrasing, explicit "help")
//   generic_keyword - a bare Price/Quotation/Project/Product/Procurement keyword substring hit
//   page_context    - chosen only because the current page implies a domain
//   none            - nothing matched; the Help default is an UNRESOLVED fallback, not explicit Help
// `rule` is a closed, message-free label of which branch matched (diagnostics + protected-route
// checks such as Catch-Up), never user text.
// ============================================================================================
export type NoaRouteStrength = "exact" | "anchored" | "generic_keyword" | "page_context" | "none";

export type NoaRouteRule =
  | "greeting"
  | "capabilities"
  | "howto"
  | "off_topic"
  | "self_context"
  | "user_activity"
  | "catch_up"
  | "admin"
  | "insights"
  | "attention"
  | "price_keyword"
  | "identifier_compare"
  | "project_client_label"
  | "client_intent"
  | "quotation_keyword"
  | "project_keyword"
  | "product_keyword"
  | "procurement_keyword"
  | "client_ranking_cue"
  | "explicit_help"
  | "page_context"
  | "unresolved";

export type NoaRouteClassification = {
  route: NoaRouteKind;
  rule: NoaRouteRule;
  strength: NoaRouteStrength;
};

// I3: the one narrow exception to "a generic keyword hit is generic_keyword". A superlative/
// ranking question about clients ("who is our best client", "top clients", "which client do we
// quote the most") only lands on Quotation/Price/etc. because "client"/"quotation" happen to be
// bare keywords in those lists - no deterministic route or capability answers a client ranking
// question from that match (the only client-ranking calculation is Insights' anchored
// "top clients by ..." phrasing, already matched earlier by INSIGHTS_PATTERNS). The ROUTE is left
// exactly as before (so classifyNoaRoute() and every fallback are unchanged); only the strength is
// reported as "none" so the flag-gated semantic layer may interpret it. Rollback: delete this check.
const CLIENT_RANKING_CUE_CLIENT = /\bclients?\b/;
const CLIENT_RANKING_CUE_SUPERLATIVE = /\b(?:best|top|biggest|largest|highest|most|leading)\b/;

function isClientRankingCue(normalized: string): boolean {
  return CLIENT_RANKING_CUE_CLIENT.test(normalized) && CLIENT_RANKING_CUE_SUPERLATIVE.test(normalized);
}

function genericKeywordRoute(route: NoaRouteKind, rule: NoaRouteRule, normalized: string): NoaRouteClassification {
  return isClientRankingCue(normalized)
    ? { route, rule: "client_ranking_cue", strength: "none" }
    : { route, rule, strength: "generic_keyword" };
}

export function classifyNoaRouteWithStrength(message: string, context: NoaPageContext): NoaRouteClassification {
  const normalized = normalizeNoaUserMessage(message);

  // Conversation polish: checked before everything else - a pure greeting or an explicit
  // capability question always wins, regardless of page context or any domain keyword.
  if (GREETING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { route: "greeting", rule: "greeting", strength: "exact" };
  }

  if (includesAny(normalized, CAPABILITY_HELP_PHRASES)) {
    return { route: "capabilities", rule: "capabilities", strength: "exact" };
  }

  if (includesAny(normalized, HELP_PHRASES)) {
    return { route: "Help", rule: "howto", strength: "anchored" };
  }

  if (includesAny(normalized, OFF_TOPIC_SIGNALS)) {
    return { route: "Help", rule: "off_topic", strength: "anchored" };
  }

  if (includesAny(normalized, SELF_CONTEXT_PHRASES)) {
    return { route: "context", rule: "self_context", strength: "exact" };
  }

  // UA-1A: explicit own-activity intent beats every domain keyword and page-context fallback
  // below, including Price/Quotation (see USER_ACTIVITY_PATTERNS' comment for why this must be
  // checked first among the domain-ish routes).
  if (
    USER_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    TEAM_AND_OTHER_USER_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return { route: "UserActivity", rule: "user_activity", strength: "anchored" };
  }

  // I3: same route as the UserActivity check above (identical precedence - it was previously one
  // combined `||` condition), split out only so Catch-Up can be recognized as its own protected
  // rule.
  if (CATCH_UP_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { route: "UserActivity", rule: "catch_up", strength: "anchored" };
  }

  // B6: checked immediately after UserActivity so a genuine team-activity "who" question above
  // already won; Admin never gets a chance to steal it.
  if (ADMIN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { route: "Admin", rule: "admin", strength: "anchored" };
  }

  // B7: checked after Admin, before every operational domain keyword list, so an explicit
  // analytics/summary/trend question always wins - but never a bare operational question (see
  // INSIGHTS_PATTERNS' comment).
  if (INSIGHTS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { route: "Insights", rule: "insights", strength: "anchored" };
  }

  // N2A1: checked immediately after Insights, before every operational domain keyword list, so
  // an explicit "what needs my attention" style question always wins - never a semantic
  // extraction call for these phrases (see ATTENTION_PATTERNS' own comment).
  if (ATTENTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { route: "Attention", rule: "attention", strength: "anchored" };
  }

  // Price checked before Quotation/Product: a price-specific ask ("is this product's price
  // status current or due?") is more specific than the domain noun it also mentions.
  if (includesAny(normalized, PRICE_KEYWORDS)) {
    return genericKeywordRoute("Price", "price_keyword", normalized);
  }

  if (/\b(compare|difference between)\b/.test(normalized) && /\b[a-z]{0,4}-?\d{3,}/i.test(normalized)) {
    return { route: "Quotation", rule: "identifier_compare", strength: "exact" };
  }

  // A client label is part of Project detail, not a cross-domain Client request. Keep this
  // narrow so explicit quotation vocabulary below still wins for "quotations for project X".
  if (/\bproject\b/.test(normalized) && /\b(what client|which client)\b/.test(normalized)) {
    return { route: "Project", rule: "project_client_label", strength: "anchored" };
  }

  // B4: narrow, explicit Client-intent phrasing only - never a bare "client" capture, since
  // "client" is also a Quotation keyword just below ("quotations for client X" / "quotation
  // total for client X" must keep routing to Quotation exactly as before). Only phrasing that
  // unambiguously asks about the Client record itself resolves here.
  const genericClientTellAbout = /\btell me about\b.*\bclient\b/.test(normalized) &&
    !/\b(?:quotation|quote|quoted|quote number|line item|project quotation)\b/.test(normalized);
  if (genericClientTellAbout || CLIENT_INTENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { route: "Client", rule: "client_intent", strength: "anchored" };
  }

  if (includesAny(normalized, QUOTATION_KEYWORDS)) {
    return genericKeywordRoute("Quotation", "quotation_keyword", normalized);
  }

  if (includesAny(normalized, PROJECT_KEYWORDS)) {
    return genericKeywordRoute("Project", "project_keyword", normalized);
  }

  if (includesAny(normalized, PRODUCT_KEYWORDS)) {
    return genericKeywordRoute("Product", "product_keyword", normalized);
  }

  if (includesAny(normalized, PROCUREMENT_KEYWORDS)) {
    return genericKeywordRoute("Procurement", "procurement_keyword", normalized);
  }

  if (normalized.includes("help")) {
    return { route: "Help", rule: "explicit_help", strength: "anchored" };
  }

  // Narrow page-context fallback: only for a genuinely contextual/ambiguous follow-up ("why is
  // this warning showing?", "tell me about this"), never for an unrelated bare statement that
  // merely happens to share a page with a capability domain.
  if (isContextualFollowUp(normalized)) {
    if (context.section === "quotations" || context.quotationId) {
      return { route: "Quotation", rule: "page_context", strength: "page_context" };
    }

    if (context.section === "products" || context.productTemplateId) {
      return { route: "Product", rule: "page_context", strength: "page_context" };
    }
  }

  // I3 PART 6: "nothing matched" - an unresolved fallback, distinct from explicit Help above.
  return { route: "Help", rule: "unresolved", strength: "none" };
}

// ============================================================================================
// I3: semantic V2 runtime helpers - pure, deterministic, alias-free (testable with the plain
// test runner). The orchestrator owns the only extractor call and the only capability dispatch;
// these helpers only decide WHETHER the semantic layer may run and WHAT its validated result
// means. Nothing here reads a database, authorizes anything, or sees business data.
// ============================================================================================

// PART 1: explicit opt-in only. Anything other than "1"/"true"/"on" (case-insensitive) - including
// unset - is OFF. Rollback = unset NOA_SEMANTIC_V2 (or set it to 0).
export function isNoaSemanticV2FlagEnabled(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

// PART 21: dev-only diagnostics unless explicitly enabled in production.
export function isNoaRouteDiagnosticsEnabled(nodeEnv: string | undefined, debugRouting: string | undefined): boolean {
  return nodeEnv !== "production" || debugRouting === "1";
}

// Deterministic protections the orchestrator detects outside the router (identifier fast paths,
// conversation-reference follow-ups, generic entity lookup). Closed labels only.
export type NoaSemanticV2ProtectedReason =
  | "recorded_quotation_follow_up"
  | "identifier"
  | "ordinal_follow_up"
  | "reference_follow_up"
  | "entity_lookup_candidate";

// Route rules that are never semantic territory regardless of strength (PART 4) - belt-and-braces
// on top of the strength check below, so a future strength re-labeling can't silently expose them.
const NOA_SEMANTIC_V2_PROTECTED_RULES: ReadonlySet<NoaRouteRule> = new Set<NoaRouteRule>([
  "greeting", "capabilities", "howto", "off_topic", "self_context", "user_activity", "catch_up",
  "admin", "insights", "attention", "identifier_compare", "client_intent", "explicit_help",
]);

export type NoaSemanticV2Eligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

// ============================================================================================
// I4: generic-keyword semantic candidate. A bare Quotation/Project/Product/Procurement keyword hit
// ("quote", "projects", "procurement") says which LIST matched, not what the user asked. This pure
// helper answers one narrow question - "is this generic-keyword message shaped like a higher-level
// natural-language request the keyword route can't express?" - using a few intent-SHAPE cues, never
// a sentence list and never a domain decision (V2 + the I2 resolver still own the meaning, and the
// original deterministic route still runs on every fallback):
//   ranking      - a superlative/ranking word ("who do we quote the most", "highest quotation
//                  value"). Allowed on Quotation/Project/Product/Procurement keyword routes: the
//                  only rank the resolver can dispatch is client ranking (Insights); every other
//                  rank is an honest unsupported, which a generic_keyword route never surfaces
//                  (decideNoaSemanticV2Outcome falls back instead).
//   natural list - collective "do we have"/"gives us" phrasing, or a "which/what <noun> are
//                  <state>" status question ("which projects are finished"). Project/Procurement
//                  keyword routes only - their resolvers map exactly the active/completed status the
//                  capability itself filters by. Product/Quotation list/count are deliberately NOT
//                  included: their resolvers can't carry the capability's own filters (archived,
//                  brand, pending, ...) so a rewrite could only lose information.
// Price keyword routes are never candidates (precise current-state capability). Any
// identifier-shaped token disqualifies the message outright (identifiers stay deterministic).
// Rollback: make this return false.
// ============================================================================================
const GENERIC_SEMANTIC_IDENTIFIER_GUARD = /\b[a-z]{0,4}-?\d{3,}/;
const GENERIC_SEMANTIC_RANKING_CUE = /\b(?:best|worst|top|biggest|largest|highest|lowest|leading|most|least|ranking|ranked)\b(?! recent)/;
const GENERIC_SEMANTIC_COLLECTIVE_CUE = /\b(?:do|did|have) we\b|\bgives? us\b/;
const GENERIC_SEMANTIC_STATE_QUESTION = /^(?:which|what) (?!(?:is|are|was|were)\b)(?:[a-z]+ ){1,3}(?:are|is|were) (?:now |currently |still |already )?[a-z]+$/;
const GENERIC_SEMANTIC_RANKING_RULES: ReadonlySet<NoaRouteRule> = new Set<NoaRouteRule>([
  "quotation_keyword", "project_keyword", "product_keyword", "procurement_keyword",
]);
const GENERIC_SEMANTIC_NATURAL_LIST_RULES: ReadonlySet<NoaRouteRule> = new Set<NoaRouteRule>([
  "project_keyword", "procurement_keyword",
]);

export function isNoaGenericSemanticCandidate(message: string, classification: NoaRouteClassification): boolean {
  if (classification.strength !== "generic_keyword") return false;
  const normalized = normalizeNoaUserMessage(message);
  if (GENERIC_SEMANTIC_IDENTIFIER_GUARD.test(normalized)) return false;
  if (GENERIC_SEMANTIC_RANKING_RULES.has(classification.rule) && GENERIC_SEMANTIC_RANKING_CUE.test(normalized)) return true;
  return GENERIC_SEMANTIC_NATURAL_LIST_RULES.has(classification.rule) &&
    (GENERIC_SEMANTIC_COLLECTIVE_CUE.test(normalized) || GENERIC_SEMANTIC_STATE_QUESTION.test(normalized));
}

// PART 5: I3's conservative activation rule - flag ON, no deterministic protection, and route
// strength none/page_context. I4: a generic_keyword route is eligible ONLY when the caller also
// reports isNoaGenericSemanticCandidate() === true for it - never generic_keyword in general.
export function noaSemanticV2Eligibility(input: {
  classification: NoaRouteClassification;
  flagEnabled: boolean;
  protectedReason: NoaSemanticV2ProtectedReason | null;
  genericSemanticCandidate?: boolean;
}): NoaSemanticV2Eligibility {
  if (!input.flagEnabled) return { eligible: false, reason: "flag_off" };
  if (input.protectedReason) return { eligible: false, reason: `protected_${input.protectedReason}` };
  if (NOA_SEMANTIC_V2_PROTECTED_RULES.has(input.classification.rule)) return { eligible: false, reason: `protected_${input.classification.rule}` };
  const { strength } = input.classification;
  if (strength === "generic_keyword" && input.genericSemanticCandidate === true) return { eligible: true };
  if (strength !== "none" && strength !== "page_context") return { eligible: false, reason: `route_strength_${strength}` };
  return { eligible: true };
}

export type NoaSemanticV2ExtractionStage = "disabled" | "provider_error" | "invalid_json" | "schema_mismatch" | "grounding_failed" | "success";

export type NoaSemanticV2Decision =
  | { kind: "dispatch"; domain: Exclude<NoaDomain, "Help">; canonicalMessage: string }
  | { kind: "answer"; domain: NoaDomain; text: string; choices?: NoaChoice[] }
  | { kind: "fallback"; reason: string };

// PART 21: the ONLY fields ever logged - closed enums/status values. Never the raw message,
// entityText, subjectName, capability data, provider response, or any credential.
export type NoaRouteDiagnostics = {
  deterministicRoute: NoaRouteKind;
  routeStrength: NoaRouteStrength;
  routeRule: NoaRouteRule;
  semanticRan: boolean;
  semanticStage: NoaSemanticV2ExtractionStage | null;
  semanticDomain: string | null;
  semanticIntent: string | null;
  semanticMetric: string | null;
  semanticConfidence: string | null;
  // I5.2: application-code proof for the one narrow low-confidence dispatch exception. This is a
  // fixed policy label, never a message, entity, identifier, or business value.
  confidenceOverride: "deterministic_safe_dispatch" | null;
  resolverKind: NoaSemanticResolution["kind"] | null;
  fallbackReason: string | null;
  // I4: whether isNoaGenericSemanticCandidate() fired - a boolean, never the cue text itself.
  genericSemanticCandidate: boolean;
};

export function buildNoaRouteDiagnostics(
  classification: NoaRouteClassification,
  semantic?: { stage: NoaSemanticV2ExtractionStage; request: NoaSemanticRequestV2 | null; resolverKind: NoaSemanticResolution["kind"] | null },
  fallbackReason?: string | null,
  genericSemanticCandidate = false,
  confidenceOverride: NoaRouteDiagnostics["confidenceOverride"] = null,
): NoaRouteDiagnostics {
  const request = semantic?.stage === "success" ? semantic.request : null;
  return {
    deterministicRoute: classification.route,
    routeStrength: classification.strength,
    routeRule: classification.rule,
    semanticRan: Boolean(semantic),
    semanticStage: semantic?.stage ?? null,
    semanticDomain: request?.domain ?? null,
    semanticIntent: request?.intent ?? null,
    semanticMetric: request?.metric ?? null,
    semanticConfidence: request?.confidence ?? null,
    confidenceOverride,
    resolverKind: semantic?.resolverKind ?? null,
    fallbackReason: fallbackReason ?? null,
    genericSemanticCandidate,
  };
}

// I5.2: this is intentionally an allow-list, not a confidence bypass. These are the only four
// closed, entity-free client-ranking combinations the resolver already maps to an existing
// read-only Insights capability. No lookup, reference, action, filter, or invented entity can
// satisfy every condition below.
const DETERMINISTIC_SAFE_LOW_CONFIDENCE_CLIENT_RANKING_METRICS = new Set([
  "quotation_value",
  "confirmed_value",
  "project_file_value",
  "quotation_count",
]);

function isDeterministicallySafeLowConfidenceDispatch(
  semantic: NoaSemanticRequestV2,
  resolution: Extract<NoaSemanticResolution, { kind: "dispatch" }>,
): boolean {
  return semantic.confidence === "low"
    && (semantic.domain === "Client" || semantic.domain === "Insights")
    && semantic.intent === "rank"
    && semantic.entityType === "client"
    && semantic.entityText === null
    && semantic.reference === "none"
    && semantic.needsClarification === false
    && semantic.clarificationReason === null
    && semantic.period === null
    && semantic.comparison === null
    && DETERMINISTIC_SAFE_LOW_CONFIDENCE_CLIENT_RANKING_METRICS.has(semantic.metric ?? "")
    && resolution.domain === "Insights";
}

// PART 8/9/18/20 + I3.1 PART 1/2: turns ONE validated V2 extraction into a deterministic runtime
// decision.
//   - any non-success stage                                 -> fallback (existing deterministic route)
//   - a previous_result reference, or current_page on a page_context route -> fallback (reference
//     binding is I5's job; the existing page-context/follow-up paths already own it)
//   - the PURE resolver is then run exactly once, regardless of confidence (I3.1: low confidence
//     no longer skips the resolver - it only restricts what a low-confidence result is ALLOWED to
//     become, so there is never a second/duplicate resolver call for the same request)
//   - HIGH confidence: resolver dispatch/clarify/unsupported/fallback -> mapped 1:1, except that a
//     page_context route is only overridden by a dispatch to a DIFFERENT domain (the page-bound
//     deterministic path keeps owning same-domain and clarify/unsupported cases)
//   - LOW confidence (I3.1): the model's own uncertainty is never enough to justify guessing a
//     business action. A `clarify` result is still safe to surface - it asks the user to resolve
//     the SAME missing slot the resolver would independently require even at high confidence,
//     produces zero DB access, and offers only I2's fixed deterministic choices - so it is
//     answered exactly like a high-confidence clarify (including the same page_context gating).
//     `unsupported` and `fallback` are rejected, as are all dispatches except I5.2's closed,
//     entity-free client-ranking allow-list below. That exception is independently proven by
//     application code and maps only to an existing read-only Insights capability; low confidence
//     otherwise never selects a capability or replaces an answer with an "unsupported" refusal.
//   - I4 generic_keyword route (only ever reached via isNoaGenericSemanticCandidate()): a real,
//     working deterministic capability already owns this message, so V2 may only REPLACE it with a
//     high-confidence dispatch - and a same-domain dispatch only when the model extracted no
//     entityText (the resolver's same-domain canonical phrases don't carry one, so the rewrite
//     would silently drop the user's filter; the keyword route keeps owning entity lookups).
//     clarify/unsupported fall back to the keyword route, with ONE exception mirroring I3's
//     client_ranking_cue bridge: the client-ranking clarification (rank + client), which no
//     keyword route can answer. Strictly narrower than I3.1 - never looser.
// The resolver never emits a model-supplied capability name or identifier - `domain` and
// `canonicalMessage` are always the resolver's own deterministic values.
export function decideNoaSemanticV2Outcome(
  extraction: { request: NoaSemanticRequestV2; stage: NoaSemanticV2ExtractionStage },
  classification: NoaRouteClassification,
): { decision: NoaSemanticV2Decision; diagnostics: NoaRouteDiagnostics } {
  // Only ever called for an eligible route, so a generic_keyword route here means the I4
  // candidate signal fired.
  const isGenericKeyword = classification.strength === "generic_keyword";
  const finish = (
    decision: NoaSemanticV2Decision,
    resolverKind: NoaSemanticResolution["kind"] | null,
    confidenceOverride: NoaRouteDiagnostics["confidenceOverride"] = null,
  ) => ({
    decision,
    diagnostics: buildNoaRouteDiagnostics(
      classification,
      { request: extraction.request, resolverKind, stage: extraction.stage },
      decision.kind === "fallback" ? decision.reason : null,
      isGenericKeyword,
      confidenceOverride,
    ),
  });

  if (extraction.stage !== "success") return finish({ kind: "fallback", reason: `semantic_${extraction.stage}` }, null);
  const semantic = extraction.request;
  const isHighConfidence = semantic.confidence === "high";
  const isPageContext = classification.strength === "page_context";
  // Reference binding is I5's job: a previous_result follow-up is never answered as a fresh
  // question, and on a page_context route "current_page" means the thing the deterministic
  // page-bound path already owns. On an unresolved route a current_page hint binds nothing the
  // resolver uses (I3 live smoke: the Attention paraphrase sometimes comes back current_page), so
  // it is not a reason to fall back there.
  if (semantic.reference === "previous_result" || (isPageContext && semantic.reference === "current_page")) {
    return finish({ kind: "fallback", reason: "semantic_reference_binding_deferred" }, null);
  }

  const resolution = resolveNoaSemanticCapabilityRequest(semantic);

  if (resolution.kind === "dispatch") {
    // I3.1 PART 2/5/6: low confidence never dispatches a capability, regardless of domain -
    // reported with its own reason so this is distinguishable in diagnostics from every other
    // low-confidence rejection (I3.1 PART 8).
    const deterministicConfidenceAccepted = isDeterministicallySafeLowConfidenceDispatch(semantic, resolution);
    if (!isHighConfidence && !deterministicConfidenceAccepted) return finish({ kind: "fallback", reason: "semantic_low_confidence_dispatch" }, resolution.kind);
    if (resolution.domain === "Help") return finish({ kind: "fallback", reason: "resolver_help_dispatch" }, resolution.kind);
    if (isPageContext && resolution.domain === classification.route) {
      return finish({ kind: "fallback", reason: "page_context_same_domain" }, resolution.kind);
    }
    if (isGenericKeyword && resolution.domain === classification.route && semantic.entityText !== null) {
      return finish({ kind: "fallback", reason: "generic_keyword_same_domain_entity" }, resolution.kind);
    }
    return finish(
      { canonicalMessage: resolution.canonicalMessage, domain: resolution.domain, kind: "dispatch" },
      resolution.kind,
      deterministicConfidenceAccepted ? "deterministic_safe_dispatch" : null,
    );
  }

  if (resolution.kind === "fallback") return finish({ kind: "fallback", reason: resolution.reason }, resolution.kind);

  // I3.1 PART 2: an "unsupported" answer is a semantically-produced refusal - only ever surfaced
  // at high confidence, exactly like today. At low confidence it defers to the existing
  // deterministic fallback instead of asserting something is unsupported on shaky footing.
  if (resolution.kind === "unsupported" && !isHighConfidence) {
    return finish({ kind: "fallback", reason: "semantic_low_confidence" }, resolution.kind);
  }

  if (isPageContext) return finish({ kind: "fallback", reason: `page_context_${resolution.kind}` }, resolution.kind);
  if (isGenericKeyword && !(resolution.kind === "clarify" && semantic.intent === "rank" && semantic.entityType === "client")) {
    return finish({ kind: "fallback", reason: `generic_keyword_${resolution.kind}` }, resolution.kind);
  }

  const answerDomain: NoaDomain = semantic.domain === "Unclear" ? "Help" : semantic.domain;
  if (resolution.kind === "clarify") {
    // I3.1 PART 1/4: a low-confidence `clarify` is allowed through unchanged - the resolver
    // independently re-derived the missing slot itself (e.g. "rank" with no metric), the choices
    // are I2's fixed deterministic set, and nothing here executes a capability or reads the
    // database, so asking the user is strictly safer than the old wrong deterministic fallback.
    return finish({
      domain: answerDomain,
      kind: "answer",
      text: resolution.text,
      ...(resolution.choices?.length ? { choices: resolution.choices.map((choice) => ({ ...choice })) } : {}),
    }, resolution.kind);
  }

  return finish({ domain: answerDomain, kind: "answer", text: resolution.text }, resolution.kind);
}

// Backward-compatible entry point for callers that only need the public, user-facing domain
// (e.g. the chat UI's pendingDomain/status text) - "context" and "unsupported_*" routes are
// internal-only and never shown as a domain badge, so they collapse to "Help" here.
export function classifyNoaIntent(message: string, context: NoaPageContext): NoaDomain {
  const route = classifyNoaRoute(message, context);
  return route === "Product" || route === "Quotation" || route === "Price" || route === "Project" || route === "Client" || route === "Procurement" || route === "UserActivity" || route === "Admin" || route === "Insights" || route === "Attention" || route === "Help"
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
  Attention: "Checking what needs attention...",
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
