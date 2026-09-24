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

export type NoaSemanticRequest = {
  domain: NoaDomain | "Unclear";
  intent: NoaSemanticIntent;
  subject?: NoaSemanticSubject;
  period?: NoaSemanticPeriod;
  entityReference?: NoaSemanticEntityReference;
  metric?: string;
  followUp?: boolean;
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

  return true;
}
