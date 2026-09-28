import {
  hasNoaStateKeys,
  isNoaResultSet,
  isNoaResultSetHandle,
  isNoaStateRecord,
  isNoaStateTimestamp,
  MAX_NOA_RESULT_SETS,
  MAX_NOA_STATE_JSON_LENGTH,
  type NoaResultSet,
  type NoaResultSetHandle,
} from "./noa-result-set";

// Independent of noa_sessions.version (the future database compare-and-swap counter).
export const NOA_CONVERSATION_STATE_SCHEMA_VERSION = 1;
export const MAX_NOA_PENDING_CHOICES = 4;
export const NOA_PENDING_CHOICE_ACTIONS = ["attention", "changes_today", "my_activity", "project_status"] as const;
export type NoaPendingChoiceAction = typeof NOA_PENDING_CHOICE_ACTIONS[number];

export type NoaPendingChoice = {
  id: string; // random UUID for this choice; never a business or user identifier
  // Each closed token is both the option identity and action. Labels belong to a future renderer.
  options: NoaPendingChoiceAction[];
  createdAt: string;
};
export type NoaPendingSlot = {
  createdAt: string;
} & (
  | { tool: "quotation"; field: "quotation_id" }
  | { tool: "project"; field: "project_file_number" }
);

export type NoaConversationState = {
  schemaVersion: typeof NOA_CONVERSATION_STATE_SCHEMA_VERSION;
  resultSets: NoaResultSet[]; // oldest to newest; capped, never an unbounded history
  focus: { resultSetHandle: NoaResultSetHandle } | null;
  pendingChoice?: NoaPendingChoice;
  // Future Phase 1B/turn integration must expire this after one unanswered turn. No turn engine here.
  pendingSlot?: NoaPendingSlot;
  // Reservation only. Existing ProductConfigurationReference remains authoritative and separate.
  activeTask?: { kind: "product_configuration" };
};

export function createEmptyNoaConversationState(): NoaConversationState {
  return { schemaVersion: NOA_CONVERSATION_STATE_SCHEMA_VERSION, resultSets: [], focus: null };
}

export function isNoaPendingChoice(value: unknown): value is NoaPendingChoice {
  if (!isNoaStateRecord(value) || !hasNoaStateKeys(value, ["id", "options", "createdAt"])
    || typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    || !isNoaStateTimestamp(value.createdAt) || !Array.isArray(value.options)
    || value.options.length < 1 || value.options.length > MAX_NOA_PENDING_CHOICES) return false;
  return Array.from(value.options).every((option) => NOA_PENDING_CHOICE_ACTIONS.some((action) => action === option))
    && new Set(value.options).size === value.options.length;
}

export function isNoaPendingSlot(value: unknown): value is NoaPendingSlot {
  return isNoaStateRecord(value) && hasNoaStateKeys(value, ["tool", "field", "createdAt"])
    && isNoaStateTimestamp(value.createdAt)
    && ((value.tool === "quotation" && value.field === "quotation_id")
      || (value.tool === "project" && value.field === "project_file_number"));
}

// Strict JSONB boundary: reject unsupported versions, extra properties and invalid cross-references.
// Validation is structural only. A valid UUID/order number/handle does NOT authorize any read.
export function isNoaConversationState(value: unknown): value is NoaConversationState {
  if (!isNoaStateRecord(value) || !hasNoaStateKeys(value, ["schemaVersion", "resultSets", "focus"], ["pendingChoice", "pendingSlot", "activeTask"])
    || value.schemaVersion !== NOA_CONVERSATION_STATE_SCHEMA_VERSION || !Array.isArray(value.resultSets)
    || value.resultSets.length > MAX_NOA_RESULT_SETS || !Array.from(value.resultSets).every(isNoaResultSet)) return false;
  const handles = new Set(value.resultSets.map((result) => result.handle));
  if (handles.size !== value.resultSets.length) return false;
  if (value.focus !== null && (!isNoaStateRecord(value.focus) || !hasNoaStateKeys(value.focus, ["resultSetHandle"])
    || !isNoaResultSetHandle(value.focus.resultSetHandle) || !handles.has(value.focus.resultSetHandle))) return false;
  if (Object.hasOwn(value, "pendingChoice") && !isNoaPendingChoice(value.pendingChoice)) return false;
  if (Object.hasOwn(value, "pendingSlot") && !isNoaPendingSlot(value.pendingSlot)) return false;
  if (Object.hasOwn(value, "activeTask") && (!isNoaStateRecord(value.activeTask)
    || !hasNoaStateKeys(value.activeTask, ["kind"]) || value.activeTask.kind !== "product_configuration")) return false;
  return true;
}

// Reject rather than silently repair an unsupported schema. A future caller can explicitly choose
// createEmptyNoaConversationState() after a null result; no database load/save policy is hidden here.
export function parseNoaConversationState(json: string): NoaConversationState | null {
  if (typeof json !== "string" || json.length > MAX_NOA_STATE_JSON_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(json);
    return isNoaConversationState(value) ? value : null;
  } catch {
    return null;
  }
}

// Minimal stack operation only: append a new handle, evict oldest, focus newest. No routing,
// relationship execution, task migration, version increments or pending-turn expiry. This is also
// Phase 1D PART 7's "push relation/drill-down result into state" operation - a relation executor
// (noa-relation.server.ts) returns a plain NoaResultSet and the caller pushes it with this same
// existing function; no separate push helper is duplicated for that purpose.
export function appendNoaResultSet(state: NoaConversationState, resultSet: NoaResultSet): NoaConversationState {
  if (!isNoaConversationState(state) || !isNoaResultSet(resultSet)) throw new TypeError("Invalid NOA conversation state");
  if (state.resultSets.some((result) => result.handle === resultSet.handle)) throw new TypeError("Duplicate NOA ResultSet handle");
  return structuredClone({
    ...state,
    resultSets: [...state.resultSets, resultSet].slice(-MAX_NOA_RESULT_SETS),
    focus: { resultSetHandle: resultSet.handle },
  });
}

// ================================================================================================
// Phase 1D PART 10/11: pure pendingChoice/pendingSlot lifecycle helpers. Not wired to any current
// clarification flow (daily-status choices, Project identifier slot) yet - callers pass/resolve
// only exact closed UI action tokens, never interpreted natural-language text.
// ================================================================================================

export function setNoaPendingChoice(state: NoaConversationState, options: NoaPendingChoiceAction[]): NoaConversationState {
  const pendingChoice: NoaPendingChoice = { id: globalThis.crypto.randomUUID(), options, createdAt: new Date().toISOString() };
  if (!isNoaConversationState(state) || !isNoaPendingChoice(pendingChoice)) throw new TypeError("Invalid NOA pending choice");
  return structuredClone({ ...state, pendingChoice });
}

export function clearNoaPendingChoice(state: NoaConversationState): NoaConversationState {
  if (!isNoaConversationState(state)) throw new TypeError("Invalid NOA conversation state");
  const next = structuredClone(state);
  delete next.pendingChoice;
  return next;
}

// Exact closed-token resolution only: `choice` must equal one of THIS pendingChoice's own current
// options - never a fuzzy/partial/label match, and never resolved against a stale/absent choice.
export function resolveNoaPendingChoice(state: NoaConversationState, choice: unknown): NoaPendingChoiceAction | null {
  if (!state.pendingChoice || typeof choice !== "string") return null;
  return (state.pendingChoice.options as string[]).includes(choice) ? (choice as NoaPendingChoiceAction) : null;
}

export function setNoaPendingSlot(
  state: NoaConversationState,
  slot: { tool: "quotation"; field: "quotation_id" } | { tool: "project"; field: "project_file_number" },
): NoaConversationState {
  const pendingSlot = { ...slot, createdAt: new Date().toISOString() } as NoaPendingSlot;
  if (!isNoaConversationState(state) || !isNoaPendingSlot(pendingSlot)) throw new TypeError("Invalid NOA pending slot");
  return structuredClone({ ...state, pendingSlot });
}

// The SAME pure removal serves two callers' distinct intents (PART 11): consuming a pendingSlot
// that this turn explicitly fulfilled, or expiring one that went unanswered for one whole turn.
// The mechanics (drop the field) are identical either way - only the caller's timing differs, and
// no natural-language fulfillment detection is implemented here.
export function clearNoaPendingSlot(state: NoaConversationState): NoaConversationState {
  if (!isNoaConversationState(state)) throw new TypeError("Invalid NOA conversation state");
  const next = structuredClone(state);
  delete next.pendingSlot;
  return next;
}
