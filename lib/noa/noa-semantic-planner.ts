import type { NoaConversationState } from "./noa-conversation-state";
import { NOA_RELATIONS, validateNoaRelationSource, type NoaRelationId } from "./noa-relation-registry";
import {
  NOA_QUOTATION_SCOPE_STATUSES, type NoaQuotationScopeStatus, type NoaResultEntityType, type NoaResultSet,
  type NoaResultSetHandle,
} from "./noa-result-set";

// Phase 2 Core: provider-neutral Semantic Planner contract for the Quotations pilot. The model only
// interprets language into this closed shape; TypeScript validation below decides whether a plan
// may execute, and deterministic executors (noa-relation.server.ts) re-authorize and re-fetch.
// No provider name, prompt, database access or business value lives in this file.
export const NOA_PLANNER_ACTIONS = ["passthrough", "relation", "aggregate_drilldown", "clarify"] as const;
export type NoaPlannerAction = typeof NOA_PLANNER_ACTIONS[number];

export type NoaSemanticPlan =
  | { kind: "passthrough" }
  | { kind: "relation"; sourceResultSetHandle: NoaResultSetHandle; relation: NoaRelationId }
  | { kind: "aggregate_drilldown"; sourceResultSetHandle: NoaResultSetHandle; status: NoaQuotationScopeStatus }
  | { kind: "clarify" };

// Closed, trace-safe metadata only: never handles, identifiers, prompts, model output or prose.
export type NoaPlannerTrace = {
  plannerMode: "skipped" | "planned" | "invalid" | "unavailable";
  plannerAction: NoaPlannerAction | "none";
  plannerSourceType: NoaResultEntityType | "none";
  plannerValidation: "valid" | "invalid_handle" | "incompatible_type" | "unsupported_operation" | "unavailable" | "none";
  // Whether the validated plan was executed deterministically or handed back to legacy routing.
  plannerExecution: "executed" | "legacy" | "none";
};
export const NOA_PLANNER_TRACE_SKIPPED: NoaPlannerTrace = {
  plannerMode: "skipped", plannerAction: "none", plannerSourceType: "none", plannerValidation: "none", plannerExecution: "none",
};

// Pilot operations: exactly the registry relations whose source is a quotation, plus quotation
// aggregate drill-down. Anything else is unsupported for Phase 2 even if registered later.
export const NOA_PLANNER_PILOT_RELATIONS: readonly NoaRelationId[] = (Object.keys(NOA_RELATIONS) as NoaRelationId[])
  .filter((id) => NOA_RELATIONS[id].sourceType === "quotation");

// Structural business identifiers keep their existing deterministic route; never an NL phrase list.
const EXACT_BUSINESS_IDENTIFIER = /\b(?:CO|QN)-\d{3,}(?:-\d+)*\b/i;

// Checkpoint B gate. The planner runs only when the focused ResultSet is quotation scope, no exact
// business identifier is present, and no Product Configuration task is active. Whether the turn
// actually depends on that scope is the planner's decision (passthrough otherwise).
export function shouldRunNoaSemanticPlanner(
  state: NoaConversationState | undefined,
  request: { message: string; productConfigurationReference?: unknown },
): boolean {
  if (!state?.focus || request.productConfigurationReference !== undefined) return false;
  if (EXACT_BUSINESS_IDENTIFIER.test(request.message)) return false;
  const focused = state.resultSets.find((result) => result.handle === state.focus?.resultSetHandle);
  return focused?.entityType === "quotation";
}

export type NoaPlannerResultSetSummary = {
  handle: NoaResultSetHandle;
  focused: boolean;
  kind: NoaResultSet["kind"];
  entityType: NoaResultEntityType;
  count: number;
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
    resultSets: state.resultSets.map((result) => ({
      handle: result.handle,
      focused: state.focus?.resultSetHandle === result.handle,
      kind: result.kind,
      entityType: result.entityType,
      count: result.count,
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
    required: ["kind", "sourceResultSetHandle", "relation", "status"],
    properties: {
      kind: { type: "string", enum: [...NOA_PLANNER_ACTIONS] },
      sourceResultSetHandle: { type: ["string", "null"], enum: [...input.resultSets.map((result) => result.handle), null] },
      relation: { type: ["string", "null"], enum: [...NOA_PLANNER_PILOT_RELATIONS, null] },
      status: { type: ["string", "null"], enum: [...NOA_QUOTATION_SCOPE_STATUSES, null] },
    },
  };
}

export type NoaPlannerValidation =
  | { ok: true; plan: NoaSemanticPlan; sourceType: NoaResultEntityType | "none" }
  | { ok: false; reason: Exclude<NoaPlannerTrace["plannerValidation"], "valid" | "unavailable" | "none">; action: NoaPlannerAction | "none" };

const PLAN_KEYS = ["kind", "sourceResultSetHandle", "relation", "status"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Never trusted: shape, handle membership in this session, source type/kind, registry membership,
// pilot enablement and closed status are all re-checked here. No confidence field is consulted.
export function validateNoaSemanticPlan(raw: unknown, state: NoaConversationState): NoaPlannerValidation {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !PLAN_KEYS.includes(key))
    || !NOA_PLANNER_ACTIONS.some((action) => action === raw.kind)) return { ok: false, reason: "unsupported_operation", action: "none" };
  const action = raw.kind as NoaPlannerAction;
  const handle = raw.sourceResultSetHandle ?? null;
  const relation = raw.relation ?? null;
  const status = raw.status ?? null;
  const unsupported = { ok: false as const, reason: "unsupported_operation" as const, action };

  if (action === "passthrough" || action === "clarify") {
    return handle === null && relation === null && status === null ? { ok: true, plan: { kind: action }, sourceType: "none" } : unsupported;
  }
  const source = typeof handle === "string" ? state.resultSets.find((result) => result.handle === handle) : undefined;
  if (!source) return { ok: false, reason: "invalid_handle", action };

  if (action === "relation") {
    if (status !== null || !NOA_PLANNER_PILOT_RELATIONS.some((id) => id === relation)) return unsupported;
    const validated = validateNoaRelationSource(state, source.handle, relation as NoaRelationId);
    if (!validated.ok) {
      return { ok: false, reason: validated.reason === "unsupported_relation" ? "unsupported_operation" : "incompatible_type", action };
    }
    return { ok: true, plan: { kind: "relation", sourceResultSetHandle: source.handle, relation: validated.relation.id }, sourceType: source.entityType };
  }

  if (relation !== null || !NOA_QUOTATION_SCOPE_STATUSES.some((value) => value === status)) return unsupported;
  if (source.kind !== "aggregate" || source.entityType !== "quotation") return { ok: false, reason: "incompatible_type", action };
  if (!source.groups.some((group) => group.status === status)) return { ok: false, reason: "incompatible_type", action };
  return {
    ok: true, plan: { kind: "aggregate_drilldown", sourceResultSetHandle: source.handle, status: status as NoaQuotationScopeStatus },
    sourceType: "quotation",
  };
}
