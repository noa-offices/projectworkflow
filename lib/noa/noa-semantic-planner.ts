import type { NoaConversationState } from "./noa-conversation-state";
import { prerouteNoaConversation } from "./noa-conversation-prerouter";
import { NOA_RELATIONS, validateNoaRelationSource, type NoaRelationId } from "./noa-relation-registry";
import {
  NOA_QUOTATION_SCOPE_STATUSES, type NoaQuotationScopeStatus, type NoaResultEntityType, type NoaResultSet,
  type NoaResultSetHandle,
} from "./noa-result-set";

// Phase 2 Core: provider-neutral Semantic Planner contract for the Quotations pilot. The model only
// interprets language into this closed shape; TypeScript validation below decides whether a plan
// may execute, and deterministic executors (noa-relation.server.ts) re-authorize and re-fetch.
// No provider name, prompt, database access or business value lives in this file.
export const NOA_PLANNER_ACTIONS = ["passthrough", "select", "relation", "aggregate_drilldown", "clarify", "project_fact", "quotation_lookup"] as const;
export type NoaPlannerAction = typeof NOA_PLANNER_ACTIONS[number];
// Phase 2 References: closed 1-based display positions ("the second one") plus "last". The model
// never sends an item identifier; TypeScript resolves the position against stored display order.
export const NOA_PLANNER_ORDINALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "last"] as const;

export type NoaSemanticPlan =
  | { kind: "project_fact"; sourceResultSetHandle: NoaResultSetHandle | null; fact: "total_value" }
  | { kind: "quotation_lookup"; lookupText: string }
  | { kind: "passthrough" }
  // Reference-only: re-show an existing entity/list ResultSet, or one displayed item of it.
  | { kind: "select"; sourceResultSetHandle: NoaResultSetHandle; itemIndex: number | null }
  | { kind: "relation"; sourceResultSetHandle: NoaResultSetHandle; relation: NoaRelationId; itemIndex: number | null }
  | { kind: "aggregate_drilldown"; sourceResultSetHandle: NoaResultSetHandle; status: NoaQuotationScopeStatus }
  | { kind: "clarify" };

// Closed, trace-safe metadata only: never handles, identifiers, prompts, model output or prose.
export type NoaPlannerTrace = {
  plannerMode: "skipped" | "planned" | "invalid" | "unavailable";
  plannerAction: NoaPlannerAction | "none";
  plannerSourceType: NoaResultEntityType | "none";
  plannerValidation: "valid" | "invalid_handle" | "incompatible_type" | "unsupported_operation" | "out_of_range" | "unavailable" | "none";
  // Whether the validated plan was executed deterministically or handed back to legacy routing.
  plannerExecution: "executed" | "legacy" | "none";
  referenceBinding: "focused_result" | "older_result" | "ordinal" | "none";
  resultSetRecency: "focused" | "older" | "none";
  ordinalResolution: "valid" | "out_of_range" | "not_applicable";
};
export const NOA_PLANNER_TRACE_SKIPPED: NoaPlannerTrace = {
  plannerMode: "skipped", plannerAction: "none", plannerSourceType: "none", plannerValidation: "none", plannerExecution: "none",
  referenceBinding: "none", resultSetRecency: "none", ordinalResolution: "not_applicable",
};

// Pilot operations: exactly the registry relations whose source is a quotation, plus quotation
// aggregate drill-down. Anything else is unsupported for Phase 2 even if registered later.
export const NOA_PLANNER_PILOT_RELATIONS: readonly NoaRelationId[] = (Object.keys(NOA_RELATIONS) as NoaRelationId[])
  .filter((id) => NOA_RELATIONS[id].sourceType === "quotation");

// Structural business identifiers keep their existing deterministic route; never an NL phrase list.
const EXACT_BUSINESS_IDENTIFIER = /\b(?:CO|QN)-\d{3,}(?:-\d+)*\b/i;

// Phase 3A: the CLOSED set of ResultSet entity types the planner may act on - the single opt-in
// extension point for new domains, never an open "all domains" switch. Project Files join the
// Phase 2 quotation pilot here; every other domain stays legacy-routed until it explicitly opts in.
export const NOA_PLANNER_SUPPORTED_ENTITY_TYPES: readonly NoaResultEntityType[] = ["quotation", "project_file"];

// Context-only callers retain the existing gate. With the Phase 4 discovery executor wired,
// an empty session can also plan a lookup or a no-context fact clarification. Existing social,
// exact-identifier and Product Configuration paths still bypass the semantic boundary.
export function shouldRunNoaSemanticPlanner(
  state: NoaConversationState | undefined,
  request: { message: string; productConfigurationReference?: unknown },
  discoveryAvailable = false,
): boolean {
  if (request.productConfigurationReference !== undefined) return false;
  if (discoveryAvailable && prerouteNoaConversation(request.message).kind !== "business_passthrough") return false;
  if (EXACT_BUSINESS_IDENTIFIER.test(request.message)) return false;
  return discoveryAvailable || Boolean(state?.focus && state.resultSets.some((result) => NOA_PLANNER_SUPPORTED_ENTITY_TYPES.includes(result.entityType)));
}

export type NoaPlannerResultSetSummary = {
  handle: NoaResultSetHandle;
  focused: boolean;
  recency: number; // 0 = newest; older sets count up. Stack order only, never business data.
  kind: NoaResultSet["kind"];
  entityType: NoaResultEntityType;
  count: number;
  // Fix for the live UAT bug where the planner chose an aggregate (status summary) handle for
  // "select"/"relation" over an older, correctly-typed entity/list handle: a deterministic,
  // TypeScript-derived hint (never model-reported) so the model does not have to infer selectability
  // from `kind` on its own. Always `kind !== "aggregate"`; validateNoaSemanticPlan() re-derives and
  // enforces this independently and never trusts a model's own notion of which handle is selectable.
  selectable: boolean;
  statusFilter: NoaQuotationScopeStatus | null;
  statusGroups: Array<{ status: NoaQuotationScopeStatus; count: number }> | null;
};
export type NoaPlannerInput = {
  message: string;
  recentUserMessages: string[];
  resultSets: NoaPlannerResultSetSummary[];
  supportedOperations: {
    relations: Array<{ relation: NoaRelationId; sourceType: NoaResultEntityType; targetType: NoaResultEntityType; sourceKinds: string[] }>;
    aggregateDrilldownStatuses: NoaQuotationScopeStatus[];
  };
};

const MAX_PLANNER_RECENT_USER_MESSAGES = 3;
const MAX_PLANNER_MESSAGE_LENGTH = 500;

// Privacy boundary: opaque handles, kinds, counts and closed status keys only. Stored item
// identifiers, assistant prose (which may carry names/prices), and full session JSON never leave.
export function buildNoaPlannerInput(
  state: NoaConversationState,
  request: { message: string; recentMessages?: Array<{ role: string; text: string }> },
): NoaPlannerInput {
  const recentUserMessages = (request.recentMessages ?? [])
    .filter((message) => message.role === "user")
    .slice(-MAX_PLANNER_RECENT_USER_MESSAGES)
    .map((message) => message.text.slice(0, MAX_PLANNER_MESSAGE_LENGTH));
  return {
    message: request.message.slice(0, MAX_PLANNER_MESSAGE_LENGTH),
    recentUserMessages,
    resultSets: state.resultSets.map((result, index) => ({
      handle: result.handle,
      focused: state.focus?.resultSetHandle === result.handle,
      recency: state.resultSets.length - 1 - index,
      kind: result.kind,
      entityType: result.entityType,
      count: result.count,
      selectable: result.kind !== "aggregate",
      statusFilter: result.kind !== "entity" && result.querySpec?.capability === "quotation" ? result.querySpec.filters.status ?? null : null,
      statusGroups: result.kind === "aggregate" ? result.groups.map(({ status, count }) => ({ status, count })) : null,
    })),
    supportedOperations: {
      relations: NOA_PLANNER_PILOT_RELATIONS.map((id) => ({
        relation: id, sourceType: NOA_RELATIONS[id].sourceType, targetType: NOA_RELATIONS[id].targetType,
        sourceKinds: [...NOA_RELATIONS[id].allowedSourceKinds],
      })),
      aggregateDrilldownStatuses: [...NOA_QUOTATION_SCOPE_STATUSES],
    },
  };
}

// Strict structured-output schema, identical for every provider. Handles are a closed enum of the
// handles present in THIS session's state, so a compliant provider cannot even express another one.
export function buildNoaPlannerSchema(input: NoaPlannerInput): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "sourceResultSetHandle", "relation", "status", "ordinal", "fact", "lookupText"],
    properties: {
      kind: { type: "string", enum: [...NOA_PLANNER_ACTIONS] },
      fact: { type: ["string", "null"], enum: ["total_value", null] },
      lookupText: { type: ["string", "null"], maxLength: 120 },
      sourceResultSetHandle: { type: ["string", "null"], enum: [...input.resultSets.map((result) => result.handle), null] },
      relation: { type: ["string", "null"], enum: [...NOA_PLANNER_PILOT_RELATIONS, null] },
      status: { type: ["string", "null"], enum: [...NOA_QUOTATION_SCOPE_STATUSES, null] },
      ordinal: { type: ["integer", "string", "null"], enum: [...NOA_PLANNER_ORDINALS, null] },
    },
  };
}

export type NoaPlannerValidation =
  | { ok: true; plan: NoaSemanticPlan; sourceType: NoaResultEntityType | "none" }
  | { ok: false; reason: Exclude<NoaPlannerTrace["plannerValidation"], "valid" | "unavailable" | "none">; action: NoaPlannerAction | "none" };

const PLAN_KEYS = ["kind", "sourceResultSetHandle", "relation", "status", "ordinal", "fact", "lookupText"];

// Ordinal -> 0-based index into the STORED display order (array position). Only stored, visible
// references are addressable; a count beyond the stored 50 is never guessed.
function resolveOrdinal(source: NoaResultSet, ordinal: unknown): { ok: true; itemIndex: number | null } | { ok: false; reason: "unsupported_operation" | "out_of_range" | "incompatible_type" } {
  if (ordinal === null) return { ok: true, itemIndex: null };
  if (!NOA_PLANNER_ORDINALS.some((value) => value === ordinal)) return { ok: false, reason: "unsupported_operation" };
  if (source.kind === "aggregate") return { ok: false, reason: "incompatible_type" };
  const itemIndex = ordinal === "last" ? source.items.length - 1 : (ordinal as number) - 1;
  return itemIndex >= 0 && itemIndex < source.items.length ? { ok: true, itemIndex } : { ok: false, reason: "out_of_range" };
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Never trusted: shape, handle membership in this session, source type/kind, registry membership,
// pilot enablement and closed status are all re-checked here. No confidence field is consulted.
export function validateNoaSemanticPlan(raw: unknown, state: NoaConversationState, message = ""): NoaPlannerValidation {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !PLAN_KEYS.includes(key))
    || !NOA_PLANNER_ACTIONS.some((action) => action === raw.kind)) return { ok: false, reason: "unsupported_operation", action: "none" };
  const action = raw.kind as NoaPlannerAction;
  const handle = raw.sourceResultSetHandle ?? null;
  const relation = raw.relation ?? null;
  const status = raw.status ?? null;
  const ordinal = raw.ordinal ?? null;
  const unsupported = { ok: false as const, reason: "unsupported_operation" as const, action };

  const fact = raw.fact ?? null;
  const lookupText = raw.lookupText ?? null;
  if (action === "quotation_lookup") {
    if (handle !== null || relation !== null || status !== null || ordinal !== null || fact !== null
      || typeof lookupText !== "string" || lookupText.trim().length < 2 || lookupText.length > 120
      || !message.slice(0, 500).toLowerCase().includes(lookupText.toLowerCase())
      || !/[\p{L}\p{N}]/u.test(lookupText)) return unsupported;
    return { ok: true, plan: { kind: action, lookupText: lookupText.trim() }, sourceType: "none" };
  }
  if (action === "project_fact") {
    if (fact !== "total_value" || lookupText !== null || relation !== null || status !== null || ordinal !== null) return unsupported;
    if (handle === null) return { ok: true, plan: { kind: action, fact, sourceResultSetHandle: null }, sourceType: "none" };
    const source = state.resultSets.find((result) => result.handle === handle);
    if (!source) return { ok: false, reason: "invalid_handle", action };
    if (source.entityType !== "project_file" || source.kind !== "entity") return { ok: false, reason: "incompatible_type", action };
    return { ok: true, plan: { kind: action, fact, sourceResultSetHandle: source.handle }, sourceType: "project_file" };
  }
  if (fact !== null || lookupText !== null) return unsupported;

  if (action === "passthrough" || action === "clarify") {
    return handle === null && relation === null && status === null && ordinal === null
      ? { ok: true, plan: { kind: action }, sourceType: "none" } : unsupported;
  }
  // Handle must be in THIS session's current bounded stack: forged, foreign and evicted handles fail.
  const source = typeof handle === "string" ? state.resultSets.find((result) => result.handle === handle) : undefined;
  if (!source) return { ok: false, reason: "invalid_handle", action };

  if (action === "select") {
    if (relation !== null || status !== null) return unsupported;
    if (source.kind === "aggregate") return { ok: false, reason: "incompatible_type", action };
    const position = resolveOrdinal(source, ordinal);
    if (!position.ok) return { ok: false, reason: position.reason, action };
    return { ok: true, plan: { kind: "select", sourceResultSetHandle: source.handle, itemIndex: position.itemIndex }, sourceType: source.entityType };
  }

  if (action === "relation") {
    if (status !== null || !NOA_PLANNER_PILOT_RELATIONS.some((id) => id === relation)) return unsupported;
    const validated = validateNoaRelationSource(state, source.handle, relation as NoaRelationId);
    if (!validated.ok) {
      return { ok: false, reason: validated.reason === "unsupported_relation" ? "unsupported_operation" : "incompatible_type", action };
    }
    const position = resolveOrdinal(source, ordinal);
    if (!position.ok) return { ok: false, reason: position.reason, action };
    return {
      ok: true, plan: { kind: "relation", sourceResultSetHandle: source.handle, relation: validated.relation.id, itemIndex: position.itemIndex },
      sourceType: source.entityType,
    };
  }

  if (relation !== null || ordinal !== null || !NOA_QUOTATION_SCOPE_STATUSES.some((value) => value === status)) return unsupported;
  if (source.kind !== "aggregate" || source.entityType !== "quotation") return { ok: false, reason: "incompatible_type", action };
  if (!source.groups.some((group) => group.status === status)) return { ok: false, reason: "incompatible_type", action };
  return {
    ok: true, plan: { kind: "aggregate_drilldown", sourceResultSetHandle: source.handle, status: status as NoaQuotationScopeStatus },
    sourceType: "quotation",
  };
}

// Phase 2 References ambiguity rule: deterministic choices generated from state metadata only
// (kind/entity type/count, newest first) - never model text and never business names.
const ENTITY_LABELS: Record<NoaResultEntityType, [string, string]> = { quotation: ["quotation", "quotations"], project_file: ["Project File", "Project Files"] };
export function describeNoaResultSetChoice(result: NoaResultSet): string {
  if (result.kind === "aggregate") return `the ${ENTITY_LABELS[result.entityType][0]} status summary`;
  const [singular, plural] = ENTITY_LABELS[result.entityType];
  return result.count === 1 ? `that ${singular}` : `the ${result.count} ${plural}`;
}
export function buildNoaPlannerClarification(state: NoaConversationState): string {
  const choices = [...new Set([...state.resultSets].reverse().map(describeNoaResultSetChoice))].slice(0, 3);
  if (choices.length < 2) return "Which of the earlier results do you mean?";
  const list = choices.length === 2 ? choices.join(" or ") : `${choices.slice(0, -1).join(", ")} or ${choices.at(-1)}`;
  return `I could use more than one recent result: ${list}. Which do you mean?`;
}
