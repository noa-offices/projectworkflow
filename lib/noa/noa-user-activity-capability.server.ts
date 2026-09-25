import "server-only";

import { requireActiveUser, requireQuotationActionUser, requireSettingsManager, requireSystemOwner } from "@/lib/auth";
import { resolveDateRange, type DateRangeKey } from "@/lib/insights/date-ranges";
import { createClient } from "@/lib/supabase/server";
import { readActivityTimeForUser, readRecentActivityTimeUsers, resolveActivityTimeProfile } from "@/lib/noa/noa-activity-time-reads.server";
// N2B2: reuses the exact authoritative QN resolver/identifier-count helper the Quotation
// capability itself already exports - never a second QN regex/resolver.
import { quotationForIdentifier, quotationIdentifierCount, quotationStructuredRequest } from "@/lib/noa/noa-quotation-capability.server";
// N2B2: reuses the exact authoritative ERP Project File resolver (allProjectFiles(), already
// exported for N2A1/N2A2's Attention reuse) plus the CO identifier helpers - never a second
// Project File parser, never standalone `projects`.
import { allProjectFiles, projectFileIdentifierCount, projectFileIdentifierFromMessage } from "@/lib/noa/noa-project-capability.server";
import { MAX_CONVERSATION_REFERENCE_ENTITIES, type NoaConversationReference } from "./noa-conversation-reference";
import type { NoaSemanticRequest } from "./noa-semantic-request";
import type { NoaCapabilityResult, NoaPageContext } from "./noa-types";

// UA-1A: OWN activity, gated by requireActiveUser() only.
// UA-1B (added below): TEAM / other-user activity, gated by requireSettingsManager() - and, for
// resolving a SPECIFIC named other user, additionally requireSystemOwner() - since current
// `profiles` RLS only lets a system_owner read arbitrary other profile rows (an admin_manager
// cannot, confirmed by the UA read-only audit). Never bypassed with a privileged database client
// or a custom role comparison - both gates reuse the existing lib/auth.ts helpers exactly.

const MAX_ACTIVITY_LOG_ROWS = 50;
const MAX_RECENT_ACTIVITY_ROWS = 20;
const MAX_TEAM_AUDIT_ROWS = 100;
const MAX_TEAM_USER_ROWS = 20;

const AUDIT_LOG_SELECT = "id,entity_type,action,title,description,created_at";

type AuditLogRow = {
  action: string;
  created_at: string;
  description: string | null;
  entity_type: string;
  id: string;
  title: string;
};

const UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I couldn't access your ProjectWorkflow activity for this account.",
  ok: false,
  reason: "unauthorized",
};

// UA-1B result constants ---------------------------------------------------------

const TEAM_UNAUTHORIZED_RESULT: NoaCapabilityResult = {
  message: "I can only show your own recorded ProjectWorkflow activity with your current permissions.",
  ok: false,
  reason: "unauthorized",
};

// PART 3: admin_manager passes requireSettingsManager() (team-capable) but cannot reliably
// resolve an arbitrary named other user, since profiles RLS restricts that to system_owner - this
// is a distinct, softer limitation from TEAM_UNAUTHORIZED_RESULT (the caller IS authorized for
// team activity, just not for this specific named-user lookup).
const OTHER_USER_NAME_LIMITATION_RESULT: NoaCapabilityResult = {
  message: "I can access team activity summaries with your current permissions, but I can't reliably resolve another user's profile name for this request.",
  ok: false,
  reason: "ambiguous",
};

const OTHER_USER_NOT_FOUND_RESULT: NoaCapabilityResult = {
  message: "I couldn't find a matching ProjectWorkflow user for that name.",
  ok: false,
  reason: "not_found",
};

const OTHER_USER_AMBIGUOUS_RESULT: NoaCapabilityResult = {
  message: "More than one ProjectWorkflow user matches that name - please provide a more specific name.",
  ok: false,
  reason: "ambiguous",
};

// PART 8: joining recorded activity against quotations.status = 'client_confirmed' is explicitly
// left unsupported in UA-1B (would broaden scope into the Quotation capability's own status
// logic) - this is an honest refusal, not a silent drop of the "confirmed" qualifier.
const TEAM_CONFIRMED_QUOTATION_LIMITATION_TEXT =
  "I can show recorded quotation activity for the team, but I can't yet safely filter that to only confirmed quotations.";

// ProjectWorkflow has no verified attendance/presence/login-history source (confirmed by the
// UA read-only audit) - this is the fixed, deterministic answer for any question that implies
// working hours, clock-in/out, or online/presence status. No query is ever run for this kind.
const ATTENDANCE_LIMITATION_TEXT =
  "ProjectWorkflow tracks recorded application activity, not verified attendance or working hours. I can show your recent recorded ProjectWorkflow activity instead.";
const PRESENCE_LIMITATION_TEXT =
  "ProjectWorkflow doesn't track verified attendance or online presence. I can show your recent ProjectWorkflow activity instead.";

function isNextRedirectError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

type UserActivityQuestionKind =
  // UA-1A own-scope kinds (unchanged)
  | "attendance_boundary"
  | "presence_boundary"
  | "last_activity"
  | "price_activity"
  | "quotation_activity"
  | "recent"
  | "summary"
  // UA-1B team/other-user kinds
  | "other_user_activity"
  | "other_user_last_activity"
  | "team_confirmed_quotation_unsupported"
  | "team_quotation_activity"
  | "team_recent_activity"
  | "team_summary"
  | "activity_time_own"
  | "activity_time_attendance"
  | "activity_time_intervals"
  | "activity_time_recent"
  | "activity_time_other"
  | "activity_time_other_intervals"
  | "activity_time_team_recent"
  // C3: quotation entity follow-up ("which quotation?") - answered only from the client-provided
  // conversationReference's own already-safe labels, never a fresh generic quotation query.
  | "quotation_follow_up"
  // N2B1: Catch Me Up - own-scope, date-ranged event list (reuses activityDateRangeKey()'s same
  // range keys "summary" already uses, never a second date parser). "catch_up_needs_reference" is
  // a fixed, no-query deferral for "while I was away"-style phrasing - there is no authoritative
  // last-login/last-session reference point today (proven by the B0 audit), so this NEVER guesses
  // a time window; it only asks a deterministic clarifying question, exactly like
  // ATTENDANCE_LIMITATION_TEXT/PRESENCE_LIMITATION_TEXT already do for their own unsupported cases.
  | "catch_up"
  | "catch_up_needs_reference"
  // N2B2: entity-scoped Catch-Up - same historical phrasing, but a QN/CO identifier in the
  // message narrows it to that one quotation/ERP Project File's own recorded history, never the
  // caller's own-activity timeline.
  | "catch_up_quotation"
  | "catch_up_project_file";

function activityTimeTargetName(message: string): string | null {
  const patterns = [
    /(?:show|what is|how much|how long)\s+([a-z][a-z'-]*)(?:'s)?\s+(?:projectworkflow\s+)?(?:active|activity)\s+time/i,
    /show\s+([a-z][a-z'-]*)(?:'s)?\s+(?:projectworkflow\s+)?activity intervals?/i,
    /^([a-z][a-z'-]*)(?:'s)?\s+(?:projectworkflow\s+)?(?:active|activity)\s+time/i,
  ];
  const excluded = new Set(["i", "me", "my", "mine", "the", "team", "today", "who", "projectworkflow", "active", "activity", "interval"]);
  for (const pattern of patterns) {
    const name = message.match(pattern)?.[1]?.trim();
    if (name && !excluded.has(name.toLowerCase())) return name;
  }
  return null;
}

function hasFirstPersonReference(message: string) {
  return /\b(?:i|me|my|mine)\b/i.test(message);
}

function isActivityIntervalCountQuestion(normalized: string) {
  return /\b(?:how many|count)\b[^?]*\b(?:activity|active)?\s*intervals?\b|\bmy interval count\b/.test(normalized);
}

function isPresenceBoundaryQuestion(normalized: string) {
  return /\bwho is (?:currently )?(?:working|online|at work)\b|\bwho is working now\b|\bis [a-z][a-z'-]* online\b|\bam i online\b|\bam i (?:currently )?(?:working|at work)\b/.test(normalized);
}

function activityTimeKind(message: string): UserActivityQuestionKind | null {
  const normalized = message.toLowerCase();
  if (hasFirstPersonReference(message)) {
    if (/\bhow many hours? did i work\b/.test(normalized)) return "activity_time_attendance";
    if (/\bwas i active recently\b|\bmy recent projectworkflow activity\b/.test(normalized)) return "activity_time_recent";
    if (/\b(?:show )?my (?:projectworkflow )?activity intervals?\b/.test(normalized)) return "activity_time_intervals";
    if (isActivityIntervalCountQuestion(normalized)) return "activity_time_own";
    if (/\b(?:projectworkflow )?active time\b|\bactivity time\b|\bhow active (?:was|am) i\b|\bhow (?:much|long) (?:time )?(?:am|i) active\b|\bfirst (?:recorded |projectworkflow )?activity today\b|\b(?:latest activity|last activity today)\b/.test(normalized)) return "activity_time_own";
  }
  if (/\bwho (?:has|had) (?:recent )?(?:projectworkflow )?activity\b|\bwho is working now\b|\bshow today'?s user activity time\b/.test(normalized)) return "activity_time_team_recent";
  const target = activityTimeTargetName(message);
  if (target) return /\bintervals?\b/.test(normalized) ? "activity_time_other_intervals" : "activity_time_other";
  if (/\bhow many hours? did i work\b/.test(normalized)) return "activity_time_attendance";
  if (isActivityIntervalCountQuestion(normalized)) return "activity_time_own";
  if (/\b(?:activity|active) intervals? today\b|\bhow many active intervals?\b/.test(normalized)) return "activity_time_intervals";
  if (/\bwas i active recently\b|\bmy recent projectworkflow activity\b/.test(normalized)) return "activity_time_recent";
  if (/\b(?:projectworkflow )?active time\b|\bactivity time\b|\bhow active (?:was|am) i\b|\bhow (?:much|long) (?:time )?(?:am|i) active\b|\bfirst (?:recorded |projectworkflow )?activity today\b|\b(?:latest activity|last activity today)\b/.test(normalized)) return "activity_time_own";
  return null;
}

function nameActivityTimeText(text: string, name: string) {
  return text
    .replace(/^You have\b/, `${name} has`)
    .replace(/^You don't have\b/, `${name} doesn't have`)
    .replace(/^Your\b/, `${name}'s`);
}

// PART 13 support: team-ish phrasing ("the team", "who worked on/edited/is ...") - deliberately
// narrow (requires "team" or a "who <verb>" construction), so "show users" (no activity verb)
// never matches.
function isTeamActivityRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\bteam\b/.test(normalized) || /\bwho (?:worked on|edited|is)\b/.test(normalized);
}

// PART 3: extracts a candidate other-user name from explicit "what did X work on"/"show X('s)
// activity"/"what quotations did X work on"/"what was X's last activity" phrasing only. Returns
// null (not a name) for "i"/"my"/"the"/"team"/"recent" captures, so UA-1A's own phrasing
// ("show my activity") and UA-1B's team phrasing ("show team activity") are never misread as a
// named-user request - this function only decides WHETHER a name was given; permission to resolve
// that name into a user id is checked separately (System Owner only, see PART 3 in the entry
// point).
function otherUserNameTarget(message: string): string | null {
  const patterns = [
    /what did ([a-z][a-z'-]*) work on/i,
    /what did ([a-z][a-z'-]*) do today/i,
    /what ([a-z][a-z'-]*) did today/i,
    /what has ([a-z][a-z'-]*) done today/i,
    /show ([a-z][a-z'-]*)(?:'s)? activity/i,
    /what quotations did ([a-z][a-z'-]*) work on/i,
    /what was ([a-z][a-z'-]*)'s last (?:recorded )?(?:projectworkflow )?activity/i,
  ];
  const excluded = new Set(["i", "my", "the", "team", "recent"]);
  for (const pattern of patterns) {
    const raw = message.match(pattern)?.[1]?.trim();
    if (!raw || excluded.has(raw.toLowerCase())) continue;
    return raw;
  }
  return null;
}

function quotationIdentifierFromAuditTitle(title: string) {
  return title.match(/\b(?:QN|Q|QT|QUO)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/i)?.[0] ?? null;
}

async function recordedQuotationFollowUpAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  previousMessage: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(previousMessage);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const rows = await auditLogRowsForUser(supabase, userId, from.toISOString(), to.toISOString(), MAX_ACTIVITY_LOG_ROWS);
  const quotationRows = rows.filter(
    (row) => row.entity_type === "quotation" || row.entity_type === "quotation_item" || row.entity_type === "quotation_section",
  );
  const identifiers = Array.from(new Set(
    quotationRows
      .map((row) => quotationIdentifierFromAuditTitle(row.title))
      .filter((identifier): identifier is string => Boolean(identifier)),
  )).slice(0, MAX_ACTIVITY_LOG_ROWS);
  const label = rangeLabel(rangeKey);
  const deterministicText = quotationRows.length === 0
    ? `I couldn't find any recorded quotation activity for you ${label}.`
    : identifiers.length === 0
      ? `I found recorded quotation activity for you ${label}, but no safe quotation identifier is available from those records.`
      : `Your recorded quotation activity ${label} was on ${identifiers.join(", ")}.`;
  return {
    data: { deterministicOnly: true, deterministicText, kind: "user_activity_recorded_quotation_follow_up", quotationIdentifiers: identifiers },
    ok: true,
    sources: [{ label: "User Activity · Checked your recorded quotation activity", type: "user_activity" }],
  };
}

// C2: maps a C1 semantic request (already subject/period-resolved by the orchestrator) onto one
// of the existing kind values below - never a new execution path, never new auth logic. This is
// the ONLY place a semantic request influences this capability: everything downstream (auth
// gates, data reads, deterministic text) is the exact same code every other kind already runs
// through. Returns null for any combination C2 doesn't wire (per the reviewed scope: only
// self/named_user for activity_time, self/named_user/team for recorded_activity, self/team for
// recent_presence) - the caller falls back to the existing regex classifier unchanged.
function semanticActivityOverride(
  semanticRequest: NoaSemanticRequest | undefined,
): { kind: UserActivityQuestionKind; targetName?: string } | null {
  if (!semanticRequest || semanticRequest.domain !== "UserActivity") return null;
  const subject = semanticRequest.subject;

  if (semanticRequest.intent === "activity_time") {
    if (subject?.type === "self") return { kind: "activity_time_own" };
    if (subject?.type === "named_user" && subject.name.trim()) return { kind: "activity_time_other", targetName: subject.name.trim() };
    return null;
  }

  if (semanticRequest.intent === "recorded_activity") {
    if (subject?.type === "self") return { kind: "summary" };
    if (subject?.type === "named_user" && subject.name.trim()) return { kind: "other_user_activity", targetName: subject.name.trim() };
    if (subject?.type === "team") return { kind: "team_summary" };
    return null;
  }

  // recent_presence: interpreted as recent ProjectWorkflow activity within the configured idle
  // window (PART 7 product semantics) - reuses the existing activity_time_recent/
  // activity_time_team_recent kinds and their real data reads, deliberately bypassing the
  // deterministic presence-refusal kind below for a message the extractor/resolver has
  // confidently classified as self or team recent-presence.
  if (semanticRequest.intent === "recent_presence") {
    if (subject?.type === "self") return { kind: "activity_time_recent" };
    if (subject?.type === "team") return { kind: "activity_time_team_recent" };
    return null;
  }

  // C3: follow_up is only ever wired here for the one supported shape - a quotation entity recall
  // resolved entirely from the caller's own conversationReference.entities (see the
  // "quotation_follow_up" dispatch branch below), never a fresh generic quotation query.
  if (semanticRequest.intent === "follow_up") {
    if (semanticRequest.entityReference?.type === "quotation" && semanticRequest.entityReference.fromPreviousResult) {
      return { kind: "quotation_follow_up" };
    }
    return null;
  }

  return null;
}

// N2B1: narrow, historical/event-oriented phrasing only - "what changed"/"what happened"/"catch
// me up" - never a bare "changed"/"happened" substring elsewhere in a longer unrelated sentence
// (each pattern anchors to the actual verb phrase). Checked ahead of the existing
// last_activity/quotation_activity/price_activity/recent checks below so a Catch-Up phrasing never
// falls through to the generic "summary" default, which only returns category counts, not an
// event list.
const CATCH_UP_PATTERNS = [/\bwhat changed\b/, /\bwhat happened\b/, /\bcatch me up\b/];
// N2B1: "while I was away" has no authoritative reference point (B0 audit) - detected BEFORE
// CATCH_UP_PATTERNS below (which also matches "what happened") so it is never silently answered
// with a guessed "today" window.
const CATCH_UP_AWAY_PATTERN = /\bwhile i(?:'ve| have)? (?:was |been )?away\b|\bwhile i was gone\b/;

// PART 1/3: deterministic classification only, checked in this exact priority order - attendance
// phrasing first (so "how many hours did i work" / "who is working currently" never fall into a
// quotation/team kind just because they contain "work"/"who"), then named-other-user phrasing,
// then team phrasing, then the existing UA-1A own-scope kinds unchanged, "recent" as the generic
// own-scope catch-all, and "summary" as the final default.
function userActivityQuestionKind(message: string): UserActivityQuestionKind {
  const normalized = message.toLowerCase();
  if (isPresenceBoundaryQuestion(normalized)) return "presence_boundary";
  const timeKind = activityTimeKind(message);
  if (timeKind) return timeKind;
  if (/\b(hours?|clock|start work|online|currently working|working currently|at work)\b/.test(normalized)) {
    return "attendance_boundary";
  }
  if (CATCH_UP_AWAY_PATTERN.test(normalized)) return "catch_up_needs_reference";
  if (CATCH_UP_PATTERNS.some((pattern) => pattern.test(normalized))) {
    // N2B2 PART 2: a QN/CO identifier present alongside historical phrasing narrows Catch-Up to
    // that one entity's own recorded history - reuses the exact same identifier-count helpers
    // the Quotation/Project capabilities already export, never a new regex. Checked QN before CO
    // since the two prefixes are mutually exclusive in practice; either can be present.
    if (quotationIdentifierCount(message) > 0) return "catch_up_quotation";
    if (projectFileIdentifierCount(message) > 0) return "catch_up_project_file";
    return "catch_up";
  }

  const targetName = otherUserNameTarget(message);
  if (targetName) {
    return /\blast\b[\s\S]*\bactivity\b/.test(normalized) ? "other_user_last_activity" : "other_user_activity";
  }

  if (isTeamActivityRequest(message)) {
    if (/\bconfirmed\b/.test(normalized) && /\b(quotations?|quote)\b/.test(normalized)) {
      return "team_confirmed_quotation_unsupported";
    }
    if (/\b(quotations?|quote)\b/.test(normalized) && /\b(work|worked|edited)\b/.test(normalized)) {
      return "team_quotation_activity";
    }
    if (/\brecent(?:ly)?\b/.test(normalized)) {
      return "team_recent_activity";
    }
    return "team_summary";
  }

  if (/\blast\b[\s\S]*\b(activity|work)\b/.test(normalized)) {
    return "last_activity";
  }
  if (/\b(quotations?|quote)\b/.test(normalized) && /\bwork/.test(normalized)) {
    return "quotation_activity";
  }
  if (/\bprice/.test(normalized) && /\bcheck/.test(normalized)) {
    return "price_activity";
  }
  if (/\brecent\b/.test(normalized)) {
    return "recent";
  }
  return "summary";
}

// PART 4: reuses the existing Insights date-range helper rather than inventing new range/timezone
// logic. Preserves its existing convention (server-process local time, no explicit IANA timezone
// conversion) - a known, documented gap, not something this capability tries to fix.
function activityDateRangeKey(message: string): DateRangeKey {
  const normalized = message.toLowerCase();
  if (/\byesterday\b/.test(normalized)) return "yesterday";
  // N2B1: "since Monday" maps directly onto the existing "this_week" range - resolveDateRange()
  // already computes the current week's Monday as that range's start (PART 6), so no new date
  // math is added here, only a phrase-detection addition shared by every existing caller of this
  // function (summary/quotation/price/team answers too - a strict improvement, since "monday" was
  // previously unmatched and fell to the "today" default).
  if (/\bmonday\b/.test(normalized)) return "this_week";
  if (/\bthis week\b/.test(normalized)) return "this_week";
  if (/\blast 7 days?\b/.test(normalized)) return "7d";
  if (/\bthis month\b/.test(normalized)) return "this_month";
  return "today";
}

function rangeLabel(range: DateRangeKey) {
  switch (range) {
    case "yesterday": return "yesterday";
    case "this_week": return "this week";
    case "7d": return "in the last 7 days";
    case "this_month": return "this month";
    default: return "today";
  }
}

type ActivityCategory = "other" | "procurement" | "product_template" | "project" | "quotation";

// PART 6/8: one authoritative categorization of an audit_activity_log row for aggregation -
// entity_type values proven by the UA read-only audit (quotation/quotation_item/quotation_section,
// product_template, procurement_vendor, project_activity). audit_activity_log is the single
// source used for this aggregation; procurement_vendor_progress/docs row fields are intentionally
// NOT also queried here, to avoid double-counting the same real-world event from two sources.
function activityCategory(entityType: string): ActivityCategory {
  if (entityType.startsWith("quotation")) return "quotation";
  if (entityType === "product_template") return "product_template";
  if (entityType === "procurement_vendor") return "procurement";
  if (entityType === "project_activity") return "project";
  return "other";
}

const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  other: "other",
  procurement: "procurement",
  product_template: "product template",
  project: "project",
  quotation: "quotation",
};

// Shared by own-activity (UA-1A) and other-user activity (UA-1B, System Owner only) - the only
// difference is which user id is passed in, both callers already authorized independently.
async function auditLogRowsForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  fromIso: string,
  toIso: string,
  limit: number,
): Promise<AuditLogRow[]> {
  const { data } = await supabase
    .from("audit_activity_log")
    .select(AUDIT_LOG_SELECT)
    .eq("created_by", userId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AuditLogRow[]>();
  return data ?? [];
}

// PART 4: metadata.actorName is an optional, already-captured display label - present on many but
// not all audit_activity_log rows (confirmed by the UA read-only audit). Never resolved from a
// raw created_by uuid here - team aggregation never queries `profiles` at all (see module header),
// so an actor with no captured name is grouped under a single shared, honest label instead of
// being silently dropped or shown by uuid.
const UNRESOLVED_ACTOR_LABEL = "Unresolved user";

function actorLabelFor(row: { metadata: Record<string, unknown> | null }): string {
  const actorName = row.metadata && typeof row.metadata.actorName === "string" ? row.metadata.actorName.trim() : "";
  return actorName || UNRESOLVED_ACTOR_LABEL;
}

async function summaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const rows = await auditLogRowsForUser(supabase, userId, from.toISOString(), to.toISOString(), MAX_ACTIVITY_LOG_ROWS);

  const counts = new Map<ActivityCategory, number>();
  for (const row of rows) {
    const category = activityCategory(row.entity_type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const label = rangeLabel(rangeKey);
  const parts = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${count} ${CATEGORY_LABEL[category]}-related recorded activit${count === 1 ? "y" : "ies"}`);

  const deterministicText = parts.length === 0
    ? `I couldn't find any recorded ProjectWorkflow actions for you ${label}.`
    : `${label === "today" ? "Today" : label[0].toUpperCase() + label.slice(1)} you had ${parts.join(", ")}.`;

  // C3: safe quotation labels from the SAME already-fetched rows - no extra query - so the
  // orchestrator can build a bounded conversationReference for an immediate "which quotation?"
  // follow-up (PART 2). Never a raw internal id, only the human-facing identifier already parsed
  // out of the audit log's own title text by quotationIdentifierFromAuditTitle().
  const quotationIdentifiers = Array.from(new Set(
    rows
      .filter((row) => row.entity_type === "quotation" || row.entity_type === "quotation_item" || row.entity_type === "quotation_section")
      .map((row) => quotationIdentifierFromAuditTitle(row.title))
      .filter((identifier): identifier is string => Boolean(identifier)),
  )).slice(0, MAX_ACTIVITY_LOG_ROWS);

  return {
    data: {
      byCategory: Object.fromEntries(counts),
      kind: "user_activity_summary",
      quotationIdentifiers,
      range: rangeKey,
      returnedCount: rows.length,
      truncatedCount: rows.length >= MAX_ACTIVITY_LOG_ROWS ? 1 : 0,
      deterministicText,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
  };
}

// N2B1: same bounded scan as summaryAnswer() (MAX_ACTIVITY_LOG_ROWS), but returns an event LIST
// instead of category counts - "what changed"/"catch me up" needs to name the actual events, not
// just tally them. `metadata`/`entity_id` are the two extra columns this query needs beyond
// AUDIT_LOG_SELECT (metadata for actorLabelFor(), entity_id ONLY for the grouping-identity check
// below - never rendered) - kept as its own local select/type rather than widening the shared
// AUDIT_LOG_SELECT/AuditLogRow every other own-scope answer already uses unchanged.
const CATCH_UP_SELECT = `${AUDIT_LOG_SELECT},metadata,entity_id`;
// N2B1.2: the display limit now applies to consolidated GROUPS, not raw rows (PART 14) - 4
// repeated saves should consume one visible slot, not four.
const MAX_CATCH_UP_DISPLAY_GROUPS = 10;
type CatchUpAuditRow = AuditLogRow & { entity_id: string | null; metadata: Record<string, unknown> | null };

// N2B3.2 PART 1: local structured-change shape, matching the B3.1 writer contract exactly - never
// a new shared application-wide type file, since only this capability reads/renders it.
type NoaStructuredChange = {
  field: string;
  label?: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  currency?: string;
};

// PART 9: the small, local, deterministic Catch-Up item shape - entityLabel/entityIdentifier are
// deliberately left undefined in B1 (safely deriving them per entity_type is B2's ERP Project
// File/Quotation-scoped work, not this phase's). `key` is the audit row's own internal id, used
// for dedupe only - never rendered. N2B1.2 PART 15: `occurrenceCount` is the one additive field -
// this type is internal/local to Catch-Up only (no other caller consumes it), so a grouped
// presentation item is safe here; every other field still describes the group's own latest
// (representative) row exactly as before, never a mutated/reinterpreted meaning. N2B3.2 PART 14:
// `changes` is the validated (never raw) structured metadata for that representative row - only
// populated when at least one allow-listed entry survives validateStructuredChanges().
type NoaCatchUpItem = {
  key: string;
  occurredAt: string;
  action: string;
  title: string;
  detail?: string;
  actorLabel?: string;
  entityType: string;
  occurrenceCount?: number;
  changes?: NoaStructuredChange[];
};

// N2B3.2 PART 3/4: the ONLY fields this phase renders structurally - anything else in
// metadata.changes is silently ignored (never surfaced), regardless of any `label` the row itself
// carries. This is deliberately narrower than what B3.1 could theoretically write in the future -
// each new field needs its own explicit allow-list entry here before Catch-Up will ever display it.
// N2B3.3 PART 11: extended with the three Procurement vendor-progress fields the B3.3 writer now
// instruments - nothing else Procurement-related is allow-listed.
const CATCH_UP_CHANGE_FIELD_LABELS: Record<string, string> = {
  status: "Status",
  unit_price: "Unit price",
  discount_value: "Discount",
  active_step: "Procurement step",
  eta: "ETA",
  etd: "ETD",
};

// N2B3.3 PART 12: a small, explicit local mirror of components/procurement/vendor-controls-panel
// .tsx's own VENDOR_STEPS array (index 0 = "RFQ" .. index 7 = "Delivered & Installed") - that
// array lives inside a "use client" component and is not exported, so it is not cleanly
// importable into this server-only capability; this is the smallest explicit mapping from the
// actual supported step index -> label, deliberately NOT generic Title Case (which would turn
// "rfq" into "Rfq"). Keep in sync with VENDOR_STEPS if that array's order/labels ever change.
const PROCUREMENT_STEP_LABELS: readonly string[] = [
  "RFQ",
  "PO Issued",
  "Deposit Paid",
  "In Production",
  "Quality Check",
  "Ready for Shipment",
  "In Transit",
  "Delivered & Installed",
];

// N2B3.3 PART 13: canonical "YYYY-MM-DD" only - parsed from the string's own digits, never via
// `new Date(string)` (which risks a local-timezone shift for a date-only string). Anything that
// isn't exactly this shape is displayed as-is, never reinterpreted/guessed.
const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCanonicalDate(value: string): string {
  const match = value.match(CANONICAL_DATE_PATTERN);
  if (!match) return value;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${Number(match[3])} ${MONTH_LABELS[monthIndex]} ${match[1]}`;
}

const MAX_STRUCTURED_CHANGES = 5;

function isStructuredChangeScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

// PART 2/3: defensive parsing of untrusted `metadata.changes` - malformed entries are dropped
// individually (never throws, never rejects the whole row), and the field allow-list is enforced
// here as the single authoritative gate, before any caller-supplied `label` is ever considered.
function validateStructuredChanges(metadata: Record<string, unknown> | null): NoaStructuredChange[] {
  const raw = metadata && Array.isArray(metadata.changes) ? metadata.changes : null;
  if (!raw) return [];
  const validated: NoaStructuredChange[] = [];
  for (const entry of raw.slice(0, MAX_STRUCTURED_CHANGES)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const field = candidate.field;
    if (typeof field !== "string" || field.trim().length === 0) continue;
    if (!Object.prototype.hasOwnProperty.call(CATCH_UP_CHANGE_FIELD_LABELS, field)) continue;
    if (!isStructuredChangeScalar(candidate.oldValue) || !isStructuredChangeScalar(candidate.newValue)) continue;
    const label = typeof candidate.label === "string" && candidate.label.trim().length > 0 ? candidate.label : undefined;
    const currency = typeof candidate.currency === "string" && candidate.currency.trim().length > 0 ? candidate.currency : undefined;
    validated.push({
      field,
      ...(label ? { label } : {}),
      oldValue: candidate.oldValue,
      newValue: candidate.newValue,
      ...(currency ? { currency } : {}),
    });
  }
  return validated;
}

// PART 5: tiny deterministic enum-label formatter - snake_case/kebab-case -> Title Case. Never
// reuses noa-quotation-capability.server.ts's quotationStatusDisplayLabel(), which applies a
// business-specific override ("draft" -> "Pending") that would contradict this phase's own
// "Status: Draft -> Client Confirmed" example - this is a generic display humanizer only, with no
// invented meaning for the underlying value.
function humanizeEnumValue(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// PART 6/7/10: one scalar -> display-string mapping, shared by both sides of a change (old/new)
// and by the null-endpoint cases below. Numbers never get an invented "%"; money only gets a
// currency prefix when the writer's own metadata already supplied one (never guessed).
function formatStructuredScalar(field: string, value: string | number | boolean | null, currency?: string): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  // N2B3.3 PART 12: active_step is a numeric index into the authoritative step list, never a
  // thousands-formatted quantity - checked before the generic number branch below.
  if (field === "active_step" && typeof value === "number") {
    return PROCUREMENT_STEP_LABELS[value] ?? String(value);
  }
  if (typeof value === "number") {
    const formatted = new Intl.NumberFormat("en-US").format(value);
    return currency ? `${currency} ${formatted}` : formatted;
  }
  // N2B3.3 PART 13: eta/etd get deterministic date formatting only for a recognized canonical
  // date string; anything else (including a non-canonical string) falls through unchanged.
  if ((field === "eta" || field === "etd") && typeof value === "string") {
    return formatCanonicalDate(value);
  }
  return field === "status" ? humanizeEnumValue(value) : value;
}

// PART 8/9/11: one deterministic line per validated change - null->value / value->null get their
// own honest phrasing (never "null" or a coerced 0 shown to the user), everything else is the
// plain "<Label>: <old> -> <new>" line.
function structuredChangeLine(change: NoaStructuredChange): string | null {
  const label = change.label ?? CATCH_UP_CHANGE_FIELD_LABELS[change.field];
  if (!label) return null;
  if (change.oldValue === null && change.newValue === null) return null;
  if (change.oldValue === null) {
    const formattedNew = formatStructuredScalar(change.field, change.newValue, change.currency);
    return formattedNew === null ? null : `${label} added: ${formattedNew}`;
  }
  if (change.newValue === null) {
    const formattedOld = formatStructuredScalar(change.field, change.oldValue, change.currency);
    return formattedOld === null ? null : `${label} cleared (was ${formattedOld})`;
  }
  const formattedOld = formatStructuredScalar(change.field, change.oldValue, change.currency);
  const formattedNew = formatStructuredScalar(change.field, change.newValue, change.currency);
  return formattedOld === null || formattedNew === null ? null : `${label}: ${formattedOld} → ${formattedNew}`;
}

// PART 11: preserves the writer's own array order - never sorted/reordered here.
function structuredChangeLines(changes: NoaStructuredChange[]): string[] {
  return changes.map(structuredChangeLine).filter((line): line is string => line !== null);
}

// N2B1.2 PART 1/6: presentation-only cleanup of already-stored title/description text - decodes
// the specific HTML-entity leak proven by live UAT (`&#x20;`, defensively also `&nbsp;`/stray
// tags) back to plain characters. This never touches the database row, never parses text for
// hidden business fields (PART 6) - it only strips display artifacts from the SAME opaque string
// before it's shown.
function sanitizeCatchUpText(value: string): string {
  return value
    .replace(/&#x20;/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// PART 5: a bare business identifier (e.g. "QN-0004-001", "CO-0003-001") already sitting in the
// description as opaque text - used only to decide inline-vs-own-line display (PART 2), never a
// new entity resolver. Conservative by construction: anything that isn't already exactly this
// shape is treated as ordinary descriptive text, never forced into an identifier slot.
const CATCH_UP_BARE_IDENTIFIER_PATTERN = /^[A-Za-z]{1,6}-\d{3,}(?:-\d+)*$/;

function catchUpIdentifierFromRow(row: CatchUpAuditRow): string | null {
  if (!row.description) return null;
  const sanitized = sanitizeCatchUpText(row.description);
  return CATCH_UP_BARE_IDENTIFIER_PATTERN.test(sanitized) ? sanitized : null;
}

// PART 2/12: a "meaningful" description is one that isn't ALREADY just the bare identifier shown
// inline (avoids the redundant own-line "QN-0004-001" that caused the reported entity-leak
// symptom in the first place) - never dropped/altered otherwise, so distinct descriptions
// (PART 12/18, e.g. two different old->new price strings) always stay visibly different.
function catchUpMeaningfulDetail(row: CatchUpAuditRow): string | null {
  if (!row.description) return null;
  const sanitized = sanitizeCatchUpText(row.description);
  return sanitized && !CATCH_UP_BARE_IDENTIFIER_PATTERN.test(sanitized) ? sanitized : null;
}

// N2B1.2 PART 4/5/6/11/12: the grouping-equality key - same entity (entity_type + entity_id,
// internal-only, never displayed; entity_id is null for rows that never had one, e.g.
// procurement_vendor/project_activity per the B0 audit, so those fall back to the text fields
// alone), same action, same normalized title, same normalized raw description (opaque string
// equality only - PART 6, never parsed for old/new values), same actor label. ANY difference in
// any of these breaks the key and the rows are never grouped (PART 18: two different old->new
// price description strings always produce different keys).
// N2B3.2 PART 15/16: extended with a stable serialization of the row's VALIDATED structured
// changes (never the raw untrusted metadata, never a re-sorted copy - B3.1 already guarantees
// stable order) - two rows whose structured values differ can never share a group key, even if
// every other identity field matches.
function catchUpGroupKey(row: CatchUpAuditRow): string {
  const title = row.title.trim().toLowerCase();
  const description = (row.description ?? "").trim().toLowerCase();
  const actor = actorLabelFor(row);
  const changesKey = JSON.stringify(validateStructuredChanges(row.metadata));
  return [row.entity_type, row.entity_id ?? "", row.action, title, description, actor, changesKey].join("\u0000");
}

// PART 9/10: adjacent-only consolidation over the already newest-first rows - A A A B A becomes
// [A,A,A] [B] [A], never a global merge of every "A" regardless of what happened in between. This
// preserves timeline meaning (an interruption by a different event is never hidden) and is the
// only grouping this phase performs - no ranking, no cross-timestamp reordering.
function groupAdjacentCatchUpRows(rows: CatchUpAuditRow[]): CatchUpAuditRow[][] {
  const groups: CatchUpAuditRow[][] = [];
  for (const row of rows) {
    const currentGroup = groups.at(-1);
    if (currentGroup && catchUpGroupKey(currentGroup[0]) === catchUpGroupKey(row)) {
      currentGroup.push(row);
    } else {
      groups.push([row]);
    }
  }
  return groups;
}

// PART 7/8: for a single-row group, the plain original line. For a consolidated group, the SAME
// shape with a "×N" count appended and only the latest (rows are newest-first, so group[0]) event's
// own timestamp shown - deliberately not an earliest->latest range (PART 8: "keep implementation
// small... do not build a new date library/helper"). PART 12: the identifier/detail split from
// catchUpIdentifierFromRow()/catchUpMeaningfulDetail() above is computed off the group's own
// representative (latest) row, so it is fully sanitized display text, never raw HTML-entity leakage.
function catchUpGroupLine(group: CatchUpAuditRow[]): string {
  const latest = group[0];
  const count = group.length;
  const actor = actorLabelFor(latest);
  const actorSuffix = actor === UNRESOLVED_ACTOR_LABEL ? "" : ` — by ${actor}`;
  const title = sanitizeCatchUpText(latest.title);
  const identifier = catchUpIdentifierFromRow(latest);
  const countSuffix = count > 1 ? ` ×${count}` : "";
  const identifierSuffix = identifier ? ` · ${identifier}` : "";
  const headline = `• ${formatTimestamp(latest.created_at)} — ${title}${countSuffix}${identifierSuffix}${actorSuffix}`;
  // N2B3.2 PART 13: when the row carries valid structured changes, they replace the legacy
  // description entirely (never both - the description would just restate the same delta). PART
  // 12: any row with no/empty/malformed/unsupported-only changes falls back to the untouched
  // legacy detail rendering below - old rows keep working exactly as before.
  const structuredLines = structuredChangeLines(validateStructuredChanges(latest.metadata));
  if (structuredLines.length > 0) {
    return `${headline}\n${structuredLines.join("\n")}`;
  }
  const detail = catchUpMeaningfulDetail(latest);
  // N2B1.3 PART 2: no leading-space indent on the description line - a leading run of spaces
  // immediately after a newline is exactly the pattern that was being corrupted into `&#x20;`
  // downstream (confirmed by live UAT even after the description text itself was already fully
  // sanitized). A bare newline with no indentation is correct, readable plain text; getting rid
  // of the artifact matters more than the cosmetic indent (task's own explicit instruction).
  return detail ? `${headline}\n${detail}` : headline;
}

// N2B2 PART 13: the ONE shared presentation pipeline every Catch-Up mode (own-scope time-window,
// quotation-scoped, Project-File-scoped) now funnels through - consolidation, ×N, sanitizer,
// identifier formatting, singular/plural group wording, and the 10-group display limit are all
// defined exactly once here, never duplicated per mode. Callers supply only their own already-
// fetched/deduped/sorted rows plus their own heading/empty-state text and any extra safe response
// fields (e.g. `range` for the time-window mode, `entityIdentifier` for scoped modes).
function buildCatchUpResult(
  rows: CatchUpAuditRow[],
  heading: string,
  emptyText: string,
  extraData: Record<string, unknown> = {},
): NoaCapabilityResult {
  // PART 13/19: scoped, honest empty-state wording - "no recorded activity", never "nothing
  // changed" (several areas, e.g. client payments/commission/client edits, are not audited at
  // all per the B0 audit, so an unqualified "nothing changed" would be a false claim).
  if (rows.length === 0) {
    return {
      data: {
        ...extraData,
        deterministicOnly: true,
        items: [] as NoaCatchUpItem[],
        kind: "user_activity_catch_up",
        returnedCount: 0,
        totalMatching: 0,
        truncatedCount: 0,
        deterministicText: emptyText,
      },
      ok: true,
      sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
    };
  }

  // PART 14: consolidate BEFORE applying the display limit, and apply that limit to GROUPS.
  const groups = groupAdjacentCatchUpRows(rows);
  const displayedGroups = groups.slice(0, MAX_CATCH_UP_DISPLAY_GROUPS);
  const items: NoaCatchUpItem[] = displayedGroups.map((group) => {
    const latest = group[0];
    const validatedChanges = validateStructuredChanges(latest.metadata);
    // N2B3.2 PART 13/14: same "structured replaces legacy detail" rule as catchUpGroupLine() -
    // never both for the same row. `changes` is always the VALIDATED array, never raw metadata,
    // so no unknown key/UUID/sensitive field can ever reach this item.
    const detail = validatedChanges.length > 0 ? undefined : catchUpMeaningfulDetail(latest);
    return {
      key: latest.id,
      occurredAt: latest.created_at,
      action: latest.action,
      title: sanitizeCatchUpText(latest.title),
      ...(detail ? { detail } : {}),
      ...(validatedChanges.length > 0 ? { changes: validatedChanges } : {}),
      actorLabel: actorLabelFor(latest),
      entityType: latest.entity_type,
      ...(group.length > 1 ? { occurrenceCount: group.length } : {}),
    };
  });

  // PART 13: truncation/consolidation wording only ever describes what's actually true - never
  // "Showing 10 of 11 events" when only 6 GROUPS are shown.
  const truncatedGroupCount = Math.max(0, groups.length - displayedGroups.length);
  const groupNoun = groups.length === 1 ? "activity group" : "activity groups";
  let capNote = "";
  if (truncatedGroupCount > 0) {
    capNote = ` ${rows.length} recorded events, shown as ${groups.length} ${groupNoun} (showing the ${displayedGroups.length} most recent).`;
  } else if (groups.length !== rows.length) {
    capNote = ` ${rows.length} recorded events, shown as ${groups.length} ${groupNoun}.`;
  }

  return {
    data: {
      ...extraData,
      deterministicOnly: true,
      items,
      kind: "user_activity_catch_up",
      returnedCount: displayedGroups.length,
      totalMatching: rows.length,
      truncatedCount: truncatedGroupCount,
      deterministicText: `${heading}${capNote}\n\n${displayedGroups.map(catchUpGroupLine).join("\n")}`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
  };
}

async function catchUpAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const { data } = await supabase
    .from("audit_activity_log")
    .select(CATCH_UP_SELECT)
    .eq("created_by", userId)
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ACTIVITY_LOG_ROWS)
    .returns<CatchUpAuditRow[]>();

  const rows = data ?? [];
  const label = rangeLabel(rangeKey);
  return buildCatchUpResult(
    rows,
    `Here's what changed ${label}.`,
    `I couldn't find any recorded activity for you ${label}.`,
    { range: rangeKey },
  );
}

// N2B2 PART 15/16: internal-id dedupe (never by title/timestamp/actor) + newest-first sort, for
// the two bounded reads (top-level + child, or child + orderNo-linked) every scoped Catch-Up
// query below combines. Adjacent-equivalent consolidation (groupAdjacentCatchUpRows(), inside
// buildCatchUpResult()) still runs AFTER this, unchanged.
function dedupeAndSortCatchUpRows(rows: CatchUpAuditRow[]): CatchUpAuditRow[] {
  const byId = new Map<string, CatchUpAuditRow>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// N2B2 PART 4/20: the exact proven production pattern from app/quotations/[id]/page.tsx - a
// top-level `entity_type="quotation"` read (bound 10) plus a child `parent_entity_type="quotation"`
// read (bound 20), reused verbatim rather than re-derived.
const CATCH_UP_QUOTATION_TOP_LIMIT = 10;
const CATCH_UP_QUOTATION_CHILD_LIMIT = 20;
// N2B2 PART 8/20: the exact proven production bound from app/projects/orders/[orderNo]/page.tsx's
// combined parent_entity_id/metadata->>orderNo read.
const CATCH_UP_PROJECT_FILE_LIMIT = 50;

async function catchUpQuotationRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quotationId: string,
): Promise<CatchUpAuditRow[]> {
  const [{ data: topRows }, { data: childRows }] = await Promise.all([
    supabase
      .from("audit_activity_log")
      .select(CATCH_UP_SELECT)
      .eq("entity_type", "quotation")
      .eq("entity_id", quotationId)
      .order("created_at", { ascending: false })
      .limit(CATCH_UP_QUOTATION_TOP_LIMIT)
      .returns<CatchUpAuditRow[]>(),
    supabase
      .from("audit_activity_log")
      .select(CATCH_UP_SELECT)
      .eq("parent_entity_type", "quotation")
      .eq("parent_entity_id", quotationId)
      .order("created_at", { ascending: false })
      .limit(CATCH_UP_QUOTATION_CHILD_LIMIT)
      .returns<CatchUpAuditRow[]>(),
  ]);
  return dedupeAndSortCatchUpRows([...(topRows ?? []), ...(childRows ?? [])]);
}

// N2B2 PART 3/6: resolves the exact same authoritative quotation row the Quotation capability
// itself resolves (quotationForIdentifier(), reused verbatim), then reads that quotation's own
// bounded audit history. Never falls through to the generic own-activity Catch-Up on a miss -
// returns a scoped, deterministic not-found result instead.
async function catchUpQuotationAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const structured = quotationStructuredRequest(message);
  if (!structured) {
    return { message: "Please specify the quotation number, e.g. \"what changed on QN-0005-001\".", ok: false, reason: "ambiguous" };
  }

  const quotation = await quotationForIdentifier(supabase, structured.quotationNo);
  if (!quotation) {
    return { message: `I couldn't find a quotation matching "${structured.quotationNo}".`, ok: false, reason: "not_found" };
  }

  const label = quotation.quotation_no ?? structured.quotationNo;
  const rows = await catchUpQuotationRows(supabase, quotation.id);
  return buildCatchUpResult(
    rows,
    `Here's what changed on ${label}.`,
    `I couldn't find any recorded activity for ${label}.`,
    { entityIdentifier: label },
  );
}

// N2B2 PART 8: the proven combined `.or(parent_entity_id.eq.<quotationId>,metadata->>orderNo.eq.<orderNo>)`
// query from the real Project File page, plus the top-level owning-quotation leg as its own
// bounded read (Part 8: "may be a separate bounded query if that is cleaner").
async function catchUpProjectFileRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  quotationId: string,
  orderNo: string,
): Promise<CatchUpAuditRow[]> {
  const [{ data: topRows }, { data: linkedRows }] = await Promise.all([
    supabase
      .from("audit_activity_log")
      .select(CATCH_UP_SELECT)
      .eq("entity_type", "quotation")
      .eq("entity_id", quotationId)
      .order("created_at", { ascending: false })
      .limit(CATCH_UP_QUOTATION_TOP_LIMIT)
      .returns<CatchUpAuditRow[]>(),
    supabase
      .from("audit_activity_log")
      .select(CATCH_UP_SELECT)
      .or(`parent_entity_id.eq.${quotationId},metadata->>orderNo.eq.${orderNo}`)
      .order("created_at", { ascending: false })
      .limit(CATCH_UP_PROJECT_FILE_LIMIT)
      .returns<CatchUpAuditRow[]>(),
  ]);
  return dedupeAndSortCatchUpRows([...(topRows ?? []), ...(linkedRows ?? [])]);
}

// N2B2 PART 7/9/11: resolves the CO identifier against the exact authoritative ERP Project File
// set (allProjectFiles() - the same helper Attention's Procurement/Client Payment subsections
// already reuse), never standalone `projects`, never a re-derived layout_settings parser. A miss
// returns a scoped, deterministic not-found result - never a fallback to generic own-activity
// Catch-Up. Client payment changes are never claimed here (they are not audited at all, per the
// B0 audit) - the response simply reflects whatever the proven query pattern actually returns.
async function catchUpProjectFileAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const identifier = projectFileIdentifierFromMessage(message);
  if (!identifier) {
    return { message: "Please specify the Project File number, e.g. \"what changed on CO-0003-001\".", ok: false, reason: "ambiguous" };
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  const orders = await allProjectFiles(supabase);
  const order = orders.find((candidate) => candidate.orderNo.toLowerCase() === normalizedIdentifier);
  if (!order) {
    return { message: `I couldn't find a Project File matching "${identifier}".`, ok: false, reason: "not_found" };
  }

  const rows = await catchUpProjectFileRows(supabase, order.quotationId, order.orderNo);
  return buildCatchUpResult(
    rows,
    `Here's what changed on ${order.orderNo}.`,
    `I couldn't find any recorded activity for ${order.orderNo}.`,
    { entityIdentifier: order.orderNo },
  );
}

// PART 6: distinct quotation-family entities touched, never derived from an ownership/assignment
// column - this counts only entities that appear in the user's OWN recorded audit_activity_log
// activity.
async function quotationActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const { data } = await supabase
    .from("audit_activity_log")
    .select("entity_type,entity_id,parent_entity_id")
    .eq("created_by", userId)
    .in("entity_type", ["quotation", "quotation_item", "quotation_section"])
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_ACTIVITY_LOG_ROWS)
    .returns<Array<{ entity_type: string; entity_id: string | null; parent_entity_id: string | null }>>();

  const rows = data ?? [];
  const distinctQuotationIds = new Set(
    rows.map((row) => (row.entity_type === "quotation" ? row.entity_id : row.parent_entity_id)).filter((id): id is string => Boolean(id)),
  );
  const label = rangeLabel(rangeKey);
  const count = distinctQuotationIds.size;

  return {
    data: {
      kind: "user_activity_quotation",
      quotationCount: count,
      range: rangeKey,
      truncatedCount: rows.length >= MAX_ACTIVITY_LOG_ROWS ? 1 : 0,
      deterministicText: count === 0
        ? `I didn't find any recorded quotation activity for you ${label}.`
        : `You had recorded activity on ${count} quotation${count === 1 ? "" : "s"} ${label}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your quotation activity", type: "user_activity" }],
  };
}

// PART 7: "price checked" and "price changed" are two separate real-world events with two
// separate authoritative sources each - never merged into one count.
async function priceActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const [
    { count: templatesChecked },
    { count: componentsChecked },
    { count: templatePriceChanges },
    { count: quotationItemPriceChanges },
  ] = await Promise.all([
    supabase.from("product_templates").select("id", { count: "exact", head: true })
      .eq("last_price_checked_by", userId).gte("last_price_checked_at", fromIso).lte("last_price_checked_at", toIso),
    supabase.from("product_components").select("id", { count: "exact", head: true })
      .eq("last_price_checked_by", userId).gte("last_price_checked_at", fromIso).lte("last_price_checked_at", toIso),
    supabase.from("product_template_price_history").select("id", { count: "exact", head: true })
      .eq("changed_by", userId).gte("changed_at", fromIso).lte("changed_at", toIso),
    supabase.from("quotation_item_price_history").select("id", { count: "exact", head: true })
      .eq("changed_by", userId).gte("changed_at", fromIso).lte("changed_at", toIso),
  ]);

  const checked = (templatesChecked ?? 0) + (componentsChecked ?? 0);
  const changed = (templatePriceChanges ?? 0) + (quotationItemPriceChanges ?? 0);
  const label = rangeLabel(rangeKey);

  const sentenceParts: string[] = [];
  if (checked > 0) sentenceParts.push(`checked ${checked} product price${checked === 1 ? "" : "s"}`);
  if (changed > 0) sentenceParts.push(`recorded ${changed} price change${changed === 1 ? "" : "s"}`);

  return {
    data: {
      kind: "user_activity_price",
      priceChangedCount: changed,
      priceCheckedCount: checked,
      range: rangeKey,
      deterministicText: sentenceParts.length === 0
        ? `I didn't find any recorded price-check or price-change activity for you ${label}.`
        : `You ${sentenceParts.join(" and ")} ${label}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your price-check activity", type: "user_activity" }],
  };
}

// PART 10: overall most recent own event, no date filter (any time) - deterministic, no inferred
// "session".
async function lastActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<NoaCapabilityResult> {
  const { data } = await supabase
    .from("audit_activity_log")
    .select(AUDIT_LOG_SELECT)
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<AuditLogRow[]>();

  const last = (data ?? [])[0];
  if (!last) {
    return {
      data: {
        kind: "user_activity_last",
        deterministicText: "I couldn't find any recorded ProjectWorkflow activity for you yet.",
      },
      ok: true,
      sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
    };
  }

  return {
    data: {
      activity: { action: last.action, category: activityCategory(last.entity_type), timestamp: last.created_at, title: last.title },
      kind: "user_activity_last",
      deterministicText: `Your last recorded ProjectWorkflow activity was "${last.title}" on ${formatTimestamp(last.created_at)}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
  };
}

// PART 11: bounded recent own activity, no date filter unless the message names one - never
// called "online activity"/presence/current session.
async function recentActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  message: string,
): Promise<NoaCapabilityResult> {
  const normalized = message.toLowerCase();
  const hasExplicitRange = /\byesterday\b|\bthis week\b|\blast 7 days?\b|\bthis month\b|\btoday\b/.test(normalized);

  let query = supabase
    .from("audit_activity_log")
    .select(AUDIT_LOG_SELECT)
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_RECENT_ACTIVITY_ROWS);

  if (hasExplicitRange) {
    const rangeKey = activityDateRangeKey(message);
    const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
    query = query.gte("created_at", from.toISOString()).lte("created_at", to.toISOString());
  }

  const { data } = await query.returns<AuditLogRow[]>();
  const rows = data ?? [];

  return {
    data: {
      kind: "user_activity_recent",
      returnedCount: rows.length,
      rows: rows.map((row) => ({
        action: row.action,
        category: activityCategory(row.entity_type),
        timestamp: row.created_at,
        title: row.title,
      })),
      deterministicText: rows.length === 0
        ? "I didn't find any recent recorded ProjectWorkflow activity for you."
        : `You have ${rows.length} recent recorded ProjectWorkflow activit${rows.length === 1 ? "y" : "ies"}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
  };
}

// ================================================================================
// UA-1B: TEAM activity (requireSettingsManager()) - never queries `profiles`. Actor display
// labels come only from audit_activity_log.metadata.actorName where present, otherwise the
// shared UNRESOLVED_ACTOR_LABEL bucket (PART 4) - this keeps team aggregation usable for both
// system_owner and admin_manager without needing a profiles join at all.
// ================================================================================

type TeamAuditRow = { created_at: string; entity_type: string; metadata: Record<string, unknown> | null };

async function teamSummaryAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const { data } = await supabase
    .from("audit_activity_log")
    .select("entity_type,created_at,metadata")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_TEAM_AUDIT_ROWS)
    .returns<TeamAuditRow[]>();

  const rows = data ?? [];
  const byActor = new Map<string, Map<ActivityCategory, number>>();
  for (const row of rows) {
    const actorLabel = actorLabelFor(row);
    const category = activityCategory(row.entity_type);
    const categories = byActor.get(actorLabel) ?? new Map<ActivityCategory, number>();
    categories.set(category, (categories.get(category) ?? 0) + 1);
    byActor.set(actorLabel, categories);
  }

  const actorRows = Array.from(byActor.entries())
    .map(([actorLabel, categories]) => ({
      actorLabel,
      categories: Object.fromEntries(categories),
      totalCount: Array.from(categories.values()).reduce((sum, count) => sum + count, 0),
    }))
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, MAX_TEAM_USER_ROWS);

  const label = rangeLabel(rangeKey);
  const sentenceParts = actorRows.map((actor) => {
    const categoryText = Object.entries(actor.categories)
      .map(([category, count]) => `${count} ${CATEGORY_LABEL[category as ActivityCategory]} activit${count === 1 ? "y" : "ies"}`)
      .join(", ");
    return `${actor.actorLabel} — ${categoryText}`;
  });

  return {
    data: {
      kind: "user_activity_team_summary",
      range: rangeKey,
      returnedUserCount: actorRows.length,
      rows: actorRows,
      truncatedRows: rows.length >= MAX_TEAM_AUDIT_ROWS ? 1 : 0,
      deterministicText: actorRows.length === 0
        ? `I didn't find any recorded team ProjectWorkflow activity ${label}.`
        : `${label === "today" ? "Today" : label[0].toUpperCase() + label.slice(1)}: ${sentenceParts.join("; ")}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked team ProjectWorkflow activity", type: "user_activity_team" }],
  };
}

// PART 6/7: distinct quotation entity IDs per actor from recorded activity only - never event
// counts, never derived from an ownership/assignment column. Wording deliberately says "recorded
// quotation activity", not
// "definitely edited", since audit_activity_log does not capture every possible edit.
async function teamQuotationActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const { data } = await supabase
    .from("audit_activity_log")
    .select("entity_type,entity_id,parent_entity_id,metadata")
    .in("entity_type", ["quotation", "quotation_item", "quotation_section"])
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_TEAM_AUDIT_ROWS)
    .returns<Array<{ entity_id: string | null; entity_type: string; metadata: Record<string, unknown> | null; parent_entity_id: string | null }>>();

  const rows = data ?? [];
  const byActor = new Map<string, Set<string>>();
  for (const row of rows) {
    const quotationId = row.entity_type === "quotation" ? row.entity_id : row.parent_entity_id;
    if (!quotationId) continue;
    const actorLabel = actorLabelFor(row);
    const set = byActor.get(actorLabel) ?? new Set<string>();
    set.add(quotationId);
    byActor.set(actorLabel, set);
  }

  const actorRows = Array.from(byActor.entries())
    .map(([actorLabel, ids]) => ({ actorLabel, quotationCount: ids.size }))
    .sort((a, b) => b.quotationCount - a.quotationCount)
    .slice(0, MAX_TEAM_USER_ROWS);

  const label = rangeLabel(rangeKey);
  const userCount = actorRows.length;

  return {
    data: {
      kind: "user_activity_team_quotation",
      range: rangeKey,
      rows: actorRows,
      truncatedRows: rows.length >= MAX_TEAM_AUDIT_ROWS ? 1 : 0,
      userCount,
      deterministicText: userCount === 0
        ? `I didn't find any recorded quotation activity from any user ${label}.`
        : `I found recorded quotation activity from ${userCount} user${userCount === 1 ? "" : "s"} ${label}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked recorded quotation activity", type: "user_activity_team" }],
  };
}

// PART 9: recorded-activity wording only, never "online"/"currently working"/"at work". Defaults
// to the last-7-days range for bare "recently" phrasing with no other explicit range word, since
// "recently" reads oddly narrowed to "today only" - still one of resolveDateRange's existing
// DateRangeKey values, not a new range concept.
async function teamRecentActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
): Promise<NoaCapabilityResult> {
  const normalized = message.toLowerCase();
  const hasExplicitRange = /\byesterday\b|\bthis week\b|\blast 7 days?\b|\bthis month\b|\btoday\b/.test(normalized);
  const rangeKey = hasExplicitRange ? activityDateRangeKey(message) : "7d";
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const { data } = await supabase
    .from("audit_activity_log")
    .select("created_at,metadata")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_TEAM_AUDIT_ROWS)
    .returns<Array<{ created_at: string; metadata: Record<string, unknown> | null }>>();

  const rows = data ?? [];
  const distinctActors = new Set(rows.map((row) => actorLabelFor(row)));
  const label = rangeLabel(rangeKey);
  const count = distinctActors.size;

  return {
    data: {
      kind: "user_activity_team_recent",
      range: rangeKey,
      truncatedRows: rows.length >= MAX_TEAM_AUDIT_ROWS ? 1 : 0,
      userCount: count,
      deterministicText: count === 0
        ? `I didn't find any recent recorded ProjectWorkflow activity ${label}.`
        : `${count} user${count === 1 ? "" : "s"} have recorded activity in ProjectWorkflow ${label}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked team ProjectWorkflow activity", type: "user_activity_team" }],
  };
}

// ================================================================================
// UA-1B: SPECIFIC other-user activity (System Owner only - see PART 3 in the entry point).
// Resolves a name to a user id via a minimal `profiles` select (id, full_name only - never
// contact details), then reuses the same own-activity query helpers with the resolved id.
// ================================================================================

type ProfileMatchRow = { full_name: string | null; id: string };
type ResolvedProfile =
  | { fullName: string; id: string; kind: "found" }
  | { kind: "ambiguous" }
  | { kind: "not_found" };

async function resolveTargetProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rawName: string,
): Promise<ResolvedProfile> {
  const safeName = rawName.replace(/[%_,().?!]/g, " ").trim();
  if (!safeName) return { kind: "not_found" };

  const { data } = await supabase
    .from("profiles")
    .select("id,full_name")
    .ilike("full_name", `%${safeName}%`)
    .limit(2)
    .returns<ProfileMatchRow[]>();

  const rows = data ?? [];
  if (rows.length === 0) return { kind: "not_found" };
  if (rows.length > 1) return { kind: "ambiguous" };
  return { fullName: rows[0].full_name?.trim() || rawName, id: rows[0].id, kind: "found" };
}

async function otherUserActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targetId: string,
  targetName: string,
  message: string,
): Promise<NoaCapabilityResult> {
  const rangeKey = activityDateRangeKey(message);
  const { from, to } = resolveDateRange(rangeKey, undefined, undefined);
  const rows = await auditLogRowsForUser(supabase, targetId, from.toISOString(), to.toISOString(), MAX_ACTIVITY_LOG_ROWS);

  const counts = new Map<ActivityCategory, number>();
  for (const row of rows) {
    const category = activityCategory(row.entity_type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  const label = rangeLabel(rangeKey);
  const parts = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${count} ${CATEGORY_LABEL[category]}-related recorded activit${count === 1 ? "y" : "ies"}`);

  return {
    data: {
      actorLabel: targetName,
      byCategory: Object.fromEntries(counts),
      kind: "user_activity_other_user",
      range: rangeKey,
      deterministicText: parts.length === 0
        ? `I didn't find any recorded ProjectWorkflow activity for ${targetName} ${label}.`
        : `${targetName} had ${parts.join(", ")} ${label}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked another user's ProjectWorkflow activity", type: "user_activity_team" }],
  };
}

async function otherUserLastActivityAnswer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targetId: string,
  targetName: string,
): Promise<NoaCapabilityResult> {
  const { data } = await supabase
    .from("audit_activity_log")
    .select(AUDIT_LOG_SELECT)
    .eq("created_by", targetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<AuditLogRow[]>();

  const last = (data ?? [])[0];
  if (!last) {
    return {
      data: {
        actorLabel: targetName,
        kind: "user_activity_other_user_last",
        deterministicText: `I couldn't find any recorded ProjectWorkflow activity for ${targetName} yet.`,
      },
      ok: true,
      sources: [{ label: "User Activity · Checked another user's ProjectWorkflow activity", type: "user_activity_team" }],
    };
  }

  return {
    data: {
      activity: { action: last.action, category: activityCategory(last.entity_type), timestamp: last.created_at, title: last.title },
      actorLabel: targetName,
      kind: "user_activity_other_user_last",
      deterministicText: `${targetName}'s last recorded ProjectWorkflow activity was "${last.title}" on ${formatTimestamp(last.created_at)}.`,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked another user's ProjectWorkflow activity", type: "user_activity_team" }],
  };
}

// PART 2 entry point: deterministic classification first (pure, no auth needed to classify), then
// exactly one of two auth paths - requireActiveUser() for own-scope kinds (UA-1A, unchanged),
// requireSettingsManager() for team/other-user kinds (UA-1B) with an additional
// requireSystemOwner() check before ever resolving a named other user's profile. No writes
// anywhere in this file.
export async function fetchNoaUserActivityCapability(
  message: string,
  _context: NoaPageContext,
  options: {
    conversationReference?: NoaConversationReference;
    recordedQuotationFollowUpFrom?: string;
    semanticRequest?: NoaSemanticRequest;
  } = {},
): Promise<NoaCapabilityResult> {
  if (options.recordedQuotationFollowUpFrom) {
    try {
      const { user } = await requireActiveUser();
      const supabase = await createClient();
      return recordedQuotationFollowUpAnswer(supabase, user.id, options.recordedQuotationFollowUpFrom);
    } catch (error) {
      if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
      throw error;
    }
  }

  // C2: a resolved semantic request (subject/period already refined by the orchestrator) picks
  // the kind directly, bypassing the fragile regex classifier below for THIS request only - the
  // classifier itself is untouched and still runs for every message without a usable semantic
  // result (PART 9: extractor/semantic failure always preserves the existing deterministic path).
  const semanticOverride = semanticActivityOverride(options.semanticRequest);
  const kind = semanticOverride?.kind ?? userActivityQuestionKind(message);

  // C3: "which quotation?" answered ONLY from the caller's own conversationReference.entities -
  // never a fresh/generic quotation query (PART 8/9). Still requires requireActiveUser(): the
  // reference never grants access on its own (PART 11), and since only the SELF recorded_activity
  // path (summaryAnswer()) ever populates entities, this is always the caller's own data.
  if (kind === "quotation_follow_up") {
    try {
      await requireActiveUser();
    } catch (error) {
      if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
      throw error;
    }
    const labels = (options.conversationReference?.entities ?? [])
      .filter((entity) => entity.type === "quotation" && typeof entity.label === "string" && entity.label.trim())
      .map((entity) => entity.label!.trim())
      .slice(0, MAX_CONVERSATION_REFERENCE_ENTITIES);
    const deterministicText = labels.length === 0
      ? "I found recorded quotation activity, but no safe quotation identifier is available from that activity record."
      : labels.length === 1
        ? `The quotation was ${labels[0]}.`
        : `The quotations were ${labels.join(", ")}.`;
    return {
      data: { deterministicOnly: true, deterministicText, kind: "user_activity_quotation_follow_up", quotationIdentifiers: labels },
      ok: true,
      sources: [{ label: "User Activity · Checked your recorded quotation activity", type: "user_activity" }],
    };
  }

  if (kind === "presence_boundary") {
    let userId: string;
    try {
      const { user } = await requireActiveUser();
      userId = user.id;
    } catch (error) {
      if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
      throw error;
    }

    if (/\bam i online\b/i.test(message)) {
      const supabase = await createClient();
      const { data } = await supabase
        .from("audit_activity_log")
        .select("created_at")
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .returns<Array<{ created_at: string }>>();
      const latest = (data ?? [])[0]?.created_at;
      return {
        data: {
          deterministicOnly: true,
          deterministicText: latest
            ? `ProjectWorkflow doesn't track verified online presence. Your latest recorded ProjectWorkflow activity was at ${formatTimestamp(latest)}.`
            : "ProjectWorkflow doesn't track verified online presence.",
          kind: "user_activity_presence_boundary",
        },
        ok: true,
        sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
      };
    }

    return {
      data: { deterministicOnly: true, deterministicText: PRESENCE_LIMITATION_TEXT, kind: "user_activity_presence_boundary" },
      ok: true,
      sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
    };
  }

  const isActivityTimeOther = kind === "activity_time_other" || kind === "activity_time_other_intervals";
  if (kind === "activity_time_team_recent" || isActivityTimeOther) {
    try {
      await requireSystemOwner();
    } catch (error) {
      if (isNextRedirectError(error)) return TEAM_UNAUTHORIZED_RESULT;
      throw error;
    }
    const supabase = await createClient();
    if (kind === "activity_time_team_recent") {
      const result = await readRecentActivityTimeUsers(supabase, message, {
        forceRecent: semanticOverride?.kind === "activity_time_team_recent",
      });
      return { data: result, ok: true, sources: [{ label: "User Activity · Checked ProjectWorkflow activity time", type: "user_activity_time" }] };
    }
    const targetName = semanticOverride?.targetName ?? activityTimeTargetName(message);
    if (!targetName) return OTHER_USER_NOT_FOUND_RESULT;
    const resolved = await resolveActivityTimeProfile(supabase, targetName);
    if (resolved.kind === "not_found") return OTHER_USER_NOT_FOUND_RESULT;
    if (resolved.kind === "ambiguous") return OTHER_USER_AMBIGUOUS_RESULT;
    const result = await readActivityTimeForUser(supabase, resolved.id, message, { intervals: kind === "activity_time_other_intervals" });
    return {
      data: { ...result, displayName: resolved.fullName, deterministicText: nameActivityTimeText(result.deterministicText, resolved.fullName) },
      ok: true,
      sources: [{ label: "User Activity · Checked ProjectWorkflow activity time", type: "user_activity_time" }],
    };
  }

  if (kind === "activity_time_own" || kind === "activity_time_attendance" || kind === "activity_time_intervals" || kind === "activity_time_recent") {
    let userId: string;
    try {
      const { user } = await requireActiveUser();
      userId = user.id;
    } catch (error) {
      if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
      throw error;
    }
    const supabase = await createClient();
    const result = await readActivityTimeForUser(supabase, userId, message, {
      attendanceBoundary: kind === "activity_time_attendance",
      intervals: kind === "activity_time_intervals",
      recent: kind === "activity_time_recent",
    });
    return { data: { ...result, deterministicOnly: true }, ok: true, sources: [{ label: "User Activity · Checked your ProjectWorkflow active time", type: "user_activity_time" }] };
  }

  const isTeamKind = kind === "team_summary" || kind === "team_quotation_activity" ||
    kind === "team_recent_activity" || kind === "team_confirmed_quotation_unsupported";
  const isOtherUserKind = kind === "other_user_activity" || kind === "other_user_last_activity";

  if (isTeamKind || isOtherUserKind) {
    try {
      await requireSettingsManager();
    } catch (error) {
      if (isNextRedirectError(error)) return TEAM_UNAUTHORIZED_RESULT;
      throw error;
    }

    const supabase = await createClient();

    if (isOtherUserKind) {
      let isSystemOwner = true;
      try {
        await requireSystemOwner();
      } catch (error) {
        if (!isNextRedirectError(error)) throw error;
        isSystemOwner = false;
      }
      if (!isSystemOwner) return OTHER_USER_NAME_LIMITATION_RESULT;

      const targetName = semanticOverride?.targetName ?? otherUserNameTarget(message);
      if (!targetName) return OTHER_USER_NAME_LIMITATION_RESULT;

      const resolved = await resolveTargetProfile(supabase, targetName);
      if (resolved.kind === "not_found") return OTHER_USER_NOT_FOUND_RESULT;
      if (resolved.kind === "ambiguous") return OTHER_USER_AMBIGUOUS_RESULT;

      return kind === "other_user_last_activity"
        ? otherUserLastActivityAnswer(supabase, resolved.id, resolved.fullName)
        : otherUserActivityAnswer(supabase, resolved.id, resolved.fullName, message);
    }

    if (kind === "team_confirmed_quotation_unsupported") {
      return {
        data: { deterministicText: TEAM_CONFIRMED_QUOTATION_LIMITATION_TEXT, kind: "user_activity_team_confirmed_unsupported" },
        ok: true,
        sources: [{ label: "User Activity · Checked team ProjectWorkflow activity", type: "user_activity_team" }],
      };
    }
    if (kind === "team_quotation_activity") return teamQuotationActivityAnswer(supabase, message);
    if (kind === "team_recent_activity") return teamRecentActivityAnswer(supabase, message);
    return teamSummaryAnswer(supabase, message);
  }

  // Own-scope kinds (UA-1A, unchanged): requireActiveUser() only.
  let userId: string;
  try {
    const { user } = await requireActiveUser();
    userId = user.id;
  } catch (error) {
    if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
    throw error;
  }

  // PART 12: fixed limitation text, no query at all - never computed from last/first activity.
  if (kind === "attendance_boundary") {
    return {
      data: { deterministicText: ATTENDANCE_LIMITATION_TEXT, kind: "user_activity_attendance_boundary" },
      ok: true,
      sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
    };
  }

  // N2B1 PART 20: "while I was away" - fixed deterministic clarification, no query, no state/
  // reference persisted. There is no authoritative last-login/last-session timestamp today
  // (B0 audit), so this never guesses a time window - the exact same "honest, fixed refusal"
  // shape as the attendance/presence limitation texts above.
  if (kind === "catch_up_needs_reference") {
    return {
      data: {
        deterministicOnly: true,
        deterministicText: "Since when? I can check today, yesterday, this week, or since Monday.",
        kind: "user_activity_catch_up_needs_reference",
      },
      ok: true,
      sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
    };
  }

  const supabase = await createClient();

  // N2B2 PART 19: quotation-scoped Catch-Up reuses the EXACT gate the Quotation capability itself
  // requires for every quotation question (requireQuotationActionUser()) - a user who can't ask
  // "what is QN-0005-001 worth" also can't ask "what changed on QN-0005-001". Project-File-scoped
  // Catch-Up needs no additional gate beyond the base requireActiveUser() already checked above,
  // matching fetchNoaProjectCapability()'s own gate exactly.
  if (kind === "catch_up_quotation") {
    try {
      await requireQuotationActionUser();
    } catch (error) {
      if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;
      throw error;
    }
    return catchUpQuotationAnswer(supabase, message);
  }
  if (kind === "catch_up_project_file") return catchUpProjectFileAnswer(supabase, message);
  if (kind === "catch_up") return catchUpAnswer(supabase, userId, message);
  if (kind === "last_activity") return lastActivityAnswer(supabase, userId);
  if (kind === "quotation_activity") return quotationActivityAnswer(supabase, userId, message);
  if (kind === "price_activity") return priceActivityAnswer(supabase, userId, message);
  if (kind === "recent") return recentActivityAnswer(supabase, userId, message);
  return summaryAnswer(supabase, userId, message);
}
