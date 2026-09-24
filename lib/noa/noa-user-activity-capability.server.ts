import "server-only";

import { requireActiveUser, requireSettingsManager, requireSystemOwner } from "@/lib/auth";
import { resolveDateRange, type DateRangeKey } from "@/lib/insights/date-ranges";
import { createClient } from "@/lib/supabase/server";
import { readActivityTimeForUser, readRecentActivityTimeUsers, resolveActivityTimeProfile } from "@/lib/noa/noa-activity-time-reads.server";
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
  | "activity_time_team_recent";

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

  return {
    data: {
      byCategory: Object.fromEntries(counts),
      kind: "user_activity_summary",
      range: rangeKey,
      returnedCount: rows.length,
      truncatedCount: rows.length >= MAX_ACTIVITY_LOG_ROWS ? 1 : 0,
      deterministicText,
    },
    ok: true,
    sources: [{ label: "User Activity · Checked your ProjectWorkflow activity", type: "user_activity" }],
  };
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
  options: { recordedQuotationFollowUpFrom?: string } = {},
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

  const kind = userActivityQuestionKind(message);

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
      const result = await readRecentActivityTimeUsers(supabase, message);
      return { data: result, ok: true, sources: [{ label: "User Activity · Checked ProjectWorkflow activity time", type: "user_activity_time" }] };
    }
    const targetName = activityTimeTargetName(message);
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

      const targetName = otherUserNameTarget(message);
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

  const supabase = await createClient();

  if (kind === "last_activity") return lastActivityAnswer(supabase, userId);
  if (kind === "quotation_activity") return quotationActivityAnswer(supabase, userId, message);
  if (kind === "price_activity") return priceActivityAnswer(supabase, userId, message);
  if (kind === "recent") return recentActivityAnswer(supabase, userId, message);
  return summaryAnswer(supabase, userId, message);
}
