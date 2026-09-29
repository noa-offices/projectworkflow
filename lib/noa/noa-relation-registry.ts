import { isNoaStateRecord, type NoaResultEntityType, type NoaResultSet, type NoaResultSetHandle } from "./noa-result-set";
import type { NoaConversationState } from "./noa-conversation-state";

// Phase 1D PART 1: a small CLOSED registry - never a generic graph/traversal framework. Exactly
// one relation exists today (quotation -> project_file, matching the NoaResultRelation contract
// noa-result-set.ts already reserved in Phase 1A). No NL message may invoke this yet (PART 12) -
// only Phase 2's Semantic Planner becomes a conversational consumer.
export type NoaRelationId = "quotation.project_file" | "client.project_file" | "client.quotation";

export type NoaRelationDefinition = {
  id: NoaRelationId;
  sourceType: NoaResultEntityType;
  targetType: NoaResultEntityType;
  // Which source ResultSet `kind`s this relation may be executed against. "aggregate" is
  // deliberately never allowed here - an aggregate carries no item identifiers to relate from
  // (see drillDownNoaAggregate in noa-relation.server.ts for the aggregate-specific operation).
  allowedSourceKinds: ReadonlyArray<"entity" | "list">;
};

export const NOA_RELATIONS: Readonly<Record<NoaRelationId, NoaRelationDefinition>> = {
  "client.project_file": { id: "client.project_file", sourceType: "client", targetType: "project_file", allowedSourceKinds: ["entity", "list"] },
  "client.quotation": { id: "client.quotation", sourceType: "client", targetType: "quotation", allowedSourceKinds: ["entity", "list"] },
  "quotation.project_file": {
    id: "quotation.project_file",
    sourceType: "quotation",
    targetType: "project_file",
    allowedSourceKinds: ["entity", "list"],
  },
};

// PART 2/9 (error categories): closed and narrow - only what this registry/validator can safely
// distinguish without an extra authorized read. `unauthorized`/`storage_error` are reserved for
// the executor (noa-relation.server.ts), never produced here.
export type NoaRelationValidationErrorReason =
  | "result_set_not_found"
  | "unsupported_relation"
  | "incompatible_source_type"
  | "empty_source"
  | "invalid_source_state";

export type NoaRelationSourceResultSet = Extract<NoaResultSet, { kind: "entity" } | { kind: "list" }>;
export type NoaRelationValidationResult =
  | { ok: true; relation: NoaRelationDefinition; source: NoaRelationSourceResultSet }
  | { ok: false; reason: NoaRelationValidationErrorReason };

function isValidQuotationItem(value: unknown): value is { id: string } {
  return isNoaStateRecord(value) && typeof value.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id);
}

// PART 2: pure, structural pre-flight - never touches the database. The executor still re-fetches
// everything authoritatively (PART 6); this only decides whether that attempt is even well-formed.
export function validateNoaRelationSource(
  state: NoaConversationState,
  sourceHandle: NoaResultSetHandle,
  relationId: NoaRelationId,
): NoaRelationValidationResult {
  const relation = NOA_RELATIONS[relationId];
  if (!relation) return { ok: false, reason: "unsupported_relation" };

  const source = state.resultSets.find((candidate) => candidate.handle === sourceHandle);
  if (!source) return { ok: false, reason: "result_set_not_found" };

  if (source.kind !== "entity" && source.kind !== "list") return { ok: false, reason: "incompatible_source_type" };
  if (source.entityType !== relation.sourceType || !relation.allowedSourceKinds.includes(source.kind)) {
    return { ok: false, reason: "incompatible_source_type" };
  }
  // Already validated by isNoaConversationState when the state was loaded/parsed, but re-checked
  // here as defense in depth against a hand-constructed/tampered state object reaching this path.
  if (!Array.isArray(source.items) || !source.items.every(isValidQuotationItem)) {
    return { ok: false, reason: "invalid_source_state" };
  }
  if (source.items.length === 0) return { ok: false, reason: "empty_source" };

  return { ok: true, relation, source };
}
