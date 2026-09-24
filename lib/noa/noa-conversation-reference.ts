// C3: a small, bounded, ephemeral reference to the immediately previous NOA result - never
// long-term memory, never server-persisted (round-tripped with the next request exactly like
// recentMessages already is), and never built from assistant prose. Pure, alias-free (only
// type-only imports from ./noa-types and ./noa-semantic-request, both themselves pure) so it
// stays unit-testable with the plain Node test runner, same convention as every other pure NOA
// helper module.

import type { NoaDomain } from "./noa-types";
import type { NoaSemanticPeriod, NoaSemanticSubject } from "./noa-semantic-request";

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
};

const KNOWN_DOMAINS: ReadonlySet<string> = new Set<NoaDomain>([
  "Product", "Quotation", "Price", "Project", "Client", "Procurement",
  "UserActivity", "Admin", "Insights", "Help",
]);

const KNOWN_PERIODS: ReadonlySet<string> = new Set<NoaSemanticPeriod>([
  "today", "yesterday", "this_week", "last_7_days", "this_month",
]);

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

  return true;
}

// Bounds an entities list to the hard cap regardless of source - never trust a caller (internal
// or external) to have already bounded it before this is the last line of defense.
export function boundConversationReferenceEntities(
  entities: NoaConversationReferenceEntity[],
): NoaConversationReferenceEntity[] {
  return entities.slice(0, MAX_CONVERSATION_REFERENCE_ENTITIES);
}
