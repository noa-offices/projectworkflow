import {
  appendNoaResultSet, clearNoaPendingChoice, focusNoaResultSet, isNoaConversationState, setNoaPendingChoice,
  type NoaConversationState, type NoaPendingChoice, type NoaPendingChoiceAction,
} from "./noa-conversation-state";
import { createNoaResultSetHandle, isNoaResultSet, isNoaStateRecord, MAX_NOA_RESULT_SET_ITEMS, type NoaResultSet, type NoaQuotationScopeStatus } from "./noa-result-set";
import { noaSessionId, type NoaSessionAnswer, type NoaSessionChatRequest } from "./noa-turn-state";
import type { NoaDecisionTrace, runNoaOrchestrator } from "./noa-orchestrator";
import type { loadOrCreateNoaSession, saveNoaSession, NoaSession } from "./noa-session.server";
import type { NoaAnswer, NoaDomain } from "./noa-types";
import { isNoaConversationReference } from "./noa-conversation-reference";
import { NOA_DAILY_STATUS_OPTIONS, NOA_DAILY_STATUS_ORDER } from "./noa-conversation-prerouter";
import {
  buildNoaPlannerClarification, buildNoaPlannerInput, NOA_PLANNER_TRACE_SKIPPED, shouldRunNoaSemanticPlanner, validateNoaSemanticPlan,
  type NoaPlannerInput, type NoaPlannerTrace,
} from "./noa-semantic-planner";
import type { NoaRelationResult } from "./noa-relation.server";
import type { NoaRelationId } from "./noa-relation-registry";

// Phase 3B: daily-status pendingChoice is session-backed real state, not free-text re-matching.
// Exact closed-token resolution only (Part 3 rule 2/3) - a small case/punctuation-insensitive
// compare against THIS pendingChoice's own known label/value strings, never a growing regex list.
function matchNoaPendingChoice(pendingChoice: NoaPendingChoice, message: string): NoaPendingChoiceAction | null {
  const normalized = message.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!normalized) return null;
  for (const action of pendingChoice.options) {
    const option = NOA_DAILY_STATUS_OPTIONS[action];
    if (normalized === option.label.toLowerCase() || normalized === option.value.toLowerCase()) return action;
  }
  return null;
}

// Structural detection only (never parses free text): true iff this answer is exactly the
// daily-status clarification's own 4 closed {label, value} choices, in order - the ONLY clarify
// this shadow layer tracks as a pendingChoice. Any other clarify (Project active/completed,
// quotation pending/list/analytics, etc.) is left entirely to existing legacy handling.
function isNoaDailyStatusClarifyAnswer(answer: NoaAnswer): boolean {
  if (!Array.isArray(answer.choices) || answer.choices.length !== NOA_DAILY_STATUS_ORDER.length) return false;
  return NOA_DAILY_STATUS_ORDER.every((action, index) => {
    const choice = answer.choices![index];
    const option = NOA_DAILY_STATUS_OPTIONS[action];
    return choice?.label === option.label && choice.value === option.value;
  });
}

export type NoaShadowTrace = {
  sessionMode: "shadow_loaded" | "shadow_created" | "shadow_replaced" | "shadow_unavailable";
  shadowResultKind: "entity" | "list" | "aggregate" | "none";
  shadowResultEntityType: "quotation" | "project_file" | "none";
  shadowSave: "saved" | "version_conflict" | "skipped" | "error";
};
export type NoaShadowTurnTrace = NoaDecisionTrace & NoaShadowTrace & NoaPlannerTrace;
// Phase 2 Core: the planner's provider boundary (`plan`) plus the deterministic, authorized
// executors/renderers it may reach. Production wires noa-semantic-planner.server.ts and
// noa-relation.server.ts; offline tests replace only `plan`. Absent planner = unavailable.
export type NoaPlannerDependencies = {
  projectFact?: (orderNo: string, context: NoaSessionChatRequest["context"]) => Promise<NoaAnswer>;
  lookupQuotations?: (text: string) => Promise<{ ids: string[]; message?: string }>;
  plan: (input: NoaPlannerInput) => Promise<unknown | null>;
  relate: (state: NoaConversationState, sourceHandle: NoaResultSet["handle"], relation: NoaRelationId) => Promise<NoaRelationResult>;
  drillDown: (state: NoaConversationState, sourceHandle: NoaResultSet["handle"], status: NoaQuotationScopeStatus) => Promise<NoaRelationResult>;
  describeProjectFiles: (orderNos: string[], context: NoaSessionChatRequest["context"], framing?: "related" | "selected") => Promise<NoaAnswer>;
  describeQuotations: (ids: string[], context: NoaSessionChatRequest["context"]) => Promise<NoaAnswer>;
};
export type NoaShadowDependencies = {
  load: typeof loadOrCreateNoaSession;
  save: typeof saveNoaSession;
  run: typeof runNoaOrchestrator;
  planner?: NoaPlannerDependencies;
};

// `nextState` null = the stack/focus is unchanged by this turn; `produced` feeds shadow trace only.
type NoaPlannerOutcome = { answer: NoaAnswer; decision: NoaDecisionTrace; nextState: NoaConversationState | null; produced: NoaResultSet | null };
type NoaItemResultSet = Extract<NoaResultSet, { kind: "entity" | "list" }>;

// One displayed item as its own entity scope ("the second one" -> "what project is it for?").
function itemResultSet(source: NoaItemResultSet, itemIndex: number): NoaItemResultSet {
  const candidate: unknown = { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString(), kind: "entity",
    entityType: source.entityType, count: 1, items: [structuredClone(source.items[itemIndex])] };
  if (!isNoaResultSet(candidate) || candidate.kind === "aggregate") throw new TypeError("Invalid NOA item ResultSet");
  return candidate;
}

// Phase 2 Quotations pilot - the only consumer allowed to let ResultSet state decide a turn.
// Returns null whenever legacy routing must answer (gate closed, planner unavailable/invalid,
// passthrough, or an executor refusal). Every identifier is resolved here from validated state.
async function runNoaPlannerStage(
  request: NoaSessionChatRequest, state: NoaConversationState, planner: NoaPlannerDependencies | undefined,
  trace: NoaPlannerTrace,
): Promise<NoaPlannerOutcome | null> {
  if (!shouldRunNoaSemanticPlanner(state, request, Boolean(planner?.lookupQuotations))) return null;
  const started = performance.now();
  let raw: unknown = null;
  try {
    raw = planner ? await planner.plan(buildNoaPlannerInput(state, request)) : null;
  } catch { raw = null; }
  if (raw === null || raw === undefined || !planner) {
    Object.assign(trace, { plannerMode: "unavailable", plannerValidation: "unavailable", plannerExecution: "legacy" });
    return null;
  }
  const reference = isNoaConversationReference(request.conversationReference) ? request.conversationReference : undefined;
  const decision = (fields: Partial<NoaDecisionTrace>): NoaDecisionTrace => ({
    routeDecision: null, semanticUsed: false, referenceAvailable: Boolean(reference), referenceDomain: reference?.domain ?? null,
    referenceBindingKind: "not_applicable", scopeSource: "result_set", capabilitySelected: null, resultCount: null,
    clarifyReason: null, errorCode: null, durationMs: Math.round(performance.now() - started), ...fields,
  });
  // Bounded, deterministic clarification: state and both client references stay untouched.
  const clarify = (text: string): NoaPlannerOutcome => {
    trace.plannerExecution = "executed";
    return {
      answer: { domain: "Help", sources: [], text, voiceText: text, conversationReference: reference },
      decision: decision({ routeDecision: "Help", scopeSource: "clarification", clarifyReason: "semantic_clarification" }),
      nextState: null, produced: null,
    };
  };

  const validated = validateNoaSemanticPlan(raw, state, request.message);
  if (!validated.ok) {
    Object.assign(trace, { plannerMode: "invalid", plannerAction: validated.action, plannerValidation: validated.reason, plannerExecution: "legacy" });
    if (validated.reason !== "out_of_range") return null;
    // A position the user was never shown is answered with a bounded question, never a guess.
    trace.ordinalResolution = "out_of_range";
    const source = state.resultSets.find((result) => isNoaStateRecord(raw) && result.handle === raw.sourceResultSetHandle);
    const shown = source && source.kind !== "aggregate" ? source.items.length : 0;
    return clarify(`That list only has ${shown} item${shown === 1 ? "" : "s"}. Which one do you mean?`);
  }
  const { plan } = validated;
  Object.assign(trace, { plannerMode: "planned", plannerAction: plan.kind, plannerSourceType: validated.sourceType, plannerValidation: "valid", plannerExecution: "legacy" });
  if (plan.kind === "passthrough") return null;
  if (plan.kind === "clarify") return clarify(buildNoaPlannerClarification(state));

  if (plan.kind === "quotation_lookup") {
    if (!planner.lookupQuotations) return null;
    try {
      const found = await planner.lookupQuotations(plan.lookupText);
      if (found.message) return clarify(found.message);
      if (!found.ids.length) return clarify("No matching quotation found.");
      const candidate = { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString(),
        kind: found.ids.length === 1 ? "entity" : "list", entityType: "quotation", count: found.ids.length,
        items: found.ids.map((id) => ({ id })) };
      if (!isNoaResultSet(candidate)) return null;
      const answer = await planner.describeQuotations(found.ids, request.context);
      trace.plannerExecution = "executed";
      return { answer, decision: decision({ routeDecision: "Quotation", capabilitySelected: "Quotation", resultCount: found.ids.length }),
        nextState: appendNoaResultSet(state, candidate), produced: candidate };
    } catch { return null; }
  }
  if (plan.kind === "project_fact") {
    if (!plan.sourceResultSetHandle) return clarify("Which Project File do you mean? Select a Project File first.");
    const source = state.resultSets.find((result) => result.handle === plan.sourceResultSetHandle);
    if (!planner.projectFact || source?.entityType !== "project_file" || source.kind !== "entity") return null;
    try {
      const answer = await planner.projectFact(source.items[0].orderNo, request.context);
      const focused = state.focus?.resultSetHandle === source.handle;
      Object.assign(trace, { plannerExecution: "executed", referenceBinding: focused ? "focused_result" : "older_result", resultSetRecency: focused ? "focused" : "older" });
      return { answer, decision: decision({ routeDecision: "Project", capabilitySelected: "Project", resultCount: 1 }),
        nextState: focused ? null : focusNoaResultSet(state, source.handle), produced: null };
    } catch { return null; }
  }
  const source = state.resultSets.find((result) => result.handle === plan.sourceResultSetHandle)!;
  const focused = state.focus?.resultSetHandle === source.handle;
  const itemIndex = plan.kind === "aggregate_drilldown" ? null : plan.itemIndex;
  Object.assign(trace, {
    resultSetRecency: focused ? "focused" : "older",
    referenceBinding: itemIndex !== null ? "ordinal" : focused ? "focused_result" : "older_result",
    ordinalResolution: itemIndex !== null ? "valid" : "not_applicable",
  });
  const describe = (result: NoaItemResultSet, framing: "related" | "selected") => result.entityType === "quotation"
    ? planner.describeQuotations(result.items.map((item) => item.id), request.context)
    : planner.describeProjectFiles(result.items.map((item) => item.orderNo), request.context, framing);
  const executed = async (answer: NoaAnswer, resultCount: number, nextState: NoaConversationState | null, produced: NoaResultSet | null) => {
    trace.plannerExecution = "executed";
    const capability = answer.domain === "Quotation" || answer.domain === "Project" ? answer.domain : null;
    return { answer, decision: decision({ routeDecision: answer.domain, capabilitySelected: capability, resultCount }), nextState, produced };
  };

  try {
    if (plan.kind === "select") {
      if (source.kind === "aggregate") return null; // validator already refuses; defense in depth
      // Whole set, or the sole item of an entity set: re-show and move focus - never duplicate it.
      if (itemIndex === null || source.kind === "entity") {
        const answer = await describe(source, "selected");
        return executed(answer, source.items.length, focused ? null : focusNoaResultSet(state, source.handle), null);
      }
      const item = itemResultSet(source, itemIndex);
      return executed(await describe(item, "selected"), 1, appendNoaResultSet(state, item), item);
    }

    if (plan.kind === "relation") {
      if (source.kind === "aggregate") return null;
      // An ordinal relates only that displayed item; the item becomes scope below the result.
      const item = itemIndex !== null && source.kind === "list" ? itemResultSet(source, itemIndex) : null;
      const base = item ? appendNoaResultSet(state, item) : state;
      const related = await planner.relate(base, item?.handle ?? source.handle, plan.relation);
      if (!related.ok || related.resultSet.kind === "aggregate") return null; // unauthorized/storage: legacy decides
      const answer = await describe(related.resultSet, "related");
      // An empty relation answers truthfully but pushes nothing: an empty list is not new scope.
      return related.resultCount > 0
        ? executed(answer, related.resultCount, appendNoaResultSet(base, related.resultSet), related.resultSet)
        : executed(answer, 0, null, null);
    }

    // Native aggregate drill-down: authoritative rows re-fetched by drillDownNoaAggregate, never
    // the natural-language legacy status-list route.
    const drilled = await planner.drillDown(state, source.handle, plan.status);
    if (!drilled.ok || drilled.resultSet.kind === "aggregate") return null;
    const answer = await describe(drilled.resultSet, "selected");
    return drilled.resultCount > 0
      ? executed(answer, drilled.resultCount, appendNoaResultSet(state, drilled.resultSet), drilled.resultSet)
      : executed(answer, 0, null, null);
  } catch {
    trace.plannerExecution = "legacy";
    return null;
  }
}

// Maps persisted status keys, not natural-language input. Unknown statuses reject the aggregate
// rather than dropping a group or inventing an incomplete scope.
function scopeStatus(value: unknown): NoaQuotationScopeStatus | undefined {
  if (typeof value !== "string" || value.length > 32) return undefined;
  const key = value.toLowerCase().replace(/[\s_-]+/g, "");
  return key === "draft" ? "draft" : key === "senttoclient" ? "sent_to_client" : key === "clientconfirmed" ? "client_confirmed" : undefined;
}

// Pure projection of existing authorized capability shapes. It never accepts or examines NoaAnswer
// text/voiceText. The caller supplies random identity/time; no business values are copied wholesale.
export function buildNoaShadowResultSet(
  domain: NoaDomain, data: unknown, identity: { handle: NoaResultSet["handle"]; createdAt: string },
): NoaResultSet | null {
  if (!isNoaStateRecord(data)) return null;
  let candidate: unknown;
  if (domain === "Project" && data.kind === "project_file_detail" && isNoaStateRecord(data.projectFile)) {
    candidate = { ...identity, kind: "entity", entityType: "project_file", count: 1, items: [{ orderNo: data.projectFile.orderNo }] };
  } else if (domain === "Project" && data.kind === "project_order_list" && Array.isArray(data.rows)) {
    candidate = { ...identity, kind: "list", entityType: "project_file", count: data.totalMatching,
      items: data.rows.slice(0, MAX_NOA_RESULT_SET_ITEMS).map((row: unknown) => ({ orderNo: isNoaStateRecord(row) ? row.orderNo : undefined })) };
  } else if (domain === "Quotation" && data.kind === undefined && ["detail", "total", "status"].includes(data.requestedField as string)) {
    candidate = { ...identity, kind: "entity", entityType: "quotation", count: 1, items: [{ id: data.id }] };
  } else if (domain === "Quotation" && data.kind === "quotation_status_list" && Array.isArray(data.rows)) {
    const status = scopeStatus(data.requestedStatus);
    if (data.requestedStatus != null && !status) return null;
    candidate = { ...identity, kind: "list", entityType: "quotation", count: data.totalMatching,
      items: data.rows.slice(0, MAX_NOA_RESULT_SET_ITEMS).map((row: unknown) => ({ id: isNoaStateRecord(row) ? row.id : undefined })),
      querySpec: { capability: "quotation", operation: "status_list", filters: status ? { status } : {} } };
  } else if (domain === "Quotation" && data.kind === "quotation_status_count" && Array.isArray(data.counts)) {
    if (data.counts.length > 3) return null;
    const groups = data.counts.map((group: unknown) => ({ status: isNoaStateRecord(group) ? scopeStatus(group.persistedStatus) : undefined,
      count: isNoaStateRecord(group) ? group.count : undefined }));
    // Phase 1D PART 9: a single requested status ("how many pending") narrows the querySpec's own
    // filter to that status - a structural fact already present in the capability's own counts
    // array (exactly one group), never parsed from the answer text. Multiple/omitted statuses
    // keep the existing empty-filter whole-aggregate shape.
    const singleStatus = groups.length === 1 ? groups[0].status : undefined;
    candidate = { ...identity, kind: "aggregate", entityType: "quotation", count: data.totalCount,
      querySpec: { capability: "quotation", operation: "status_summary", filters: singleStatus ? { status: singleStatus } : {} },
      groups };
  } else return null;
  return isNoaResultSet(candidate) ? candidate : null;
}

// The route and offline golden harness share this exact lifecycle. Dependencies are existing
// authorized repository/orchestrator functions in production, and offline fixtures in tests.
// Legacy routing never receives the session or a ResultSet. Phase 2 Core: a validated Quotations
// pilot plan may preempt legacy routing (runNoaPlannerStage); its result is pushed/saved below
// through the same optimistic append/save path, and a version conflict is traced, never retried.
export async function runNoaShadowTurn(
  request: NoaSessionChatRequest, dependencies: NoaShadowDependencies,
  collect?: (trace: Readonly<NoaShadowTurnTrace>) => void,
): Promise<NoaSessionAnswer> {
  const { sessionId: suppliedId, ...authoritativeRequest } = request;
  const incomingId = noaSessionId(suppliedId);
  const shadow: NoaShadowTrace = { sessionMode: "shadow_unavailable", shadowResultKind: "none", shadowResultEntityType: "none", shadowSave: "skipped" };
  let session: NoaSession | undefined;
  try {
    const loaded = await dependencies.load(incomingId);
    if (loaded.ok && noaSessionId(loaded.session.sessionId) && isNoaConversationState(loaded.session.state)) {
      session = loaded.session;
      shadow.sessionMode = !incomingId ? "shadow_created" : incomingId === session.sessionId ? "shadow_loaded" : "shadow_replaced";
    }
  } catch { /* Availability/identity details never replace the authoritative answer. */ }

  // Phase 3B: an active pendingChoice is resolved (or expired) BEFORE the planner or legacy
  // routing sees this turn - deterministic state resolution takes priority, per Part 8, over both.
  // A resolved choice replaces the outgoing message with its own closed canonical value (typed and
  // clicked behave identically because both ultimately route through this exact same substitution).
  // An unmatched turn still clears the pendingChoice (Part 3 rules 4/5: it never traps the user)
  // and proceeds with the user's OWN original message, unchanged.
  let effectiveRequest = authoritativeRequest;
  let pendingChoiceNextState: NoaConversationState | null = null;
  // A RESOLVED choice skips the planner entirely for this turn - the action is already closed and
  // known (Part 8), so the planner never gets a chance to reinterpret the stale original wording
  // against an unrelated focused ResultSet. An EXPIRED (unmatched) choice does not skip it: the
  // user's own original message still deserves normal planner/legacy routing.
  let skipPlannerForResolvedChoice = false;
  if (session?.state.pendingChoice) {
    const resolvedAction = matchNoaPendingChoice(session.state.pendingChoice, request.message);
    session = { ...session, state: clearNoaPendingChoice(session.state) };
    pendingChoiceNextState = session.state;
    if (resolvedAction) {
      effectiveRequest = { ...authoritativeRequest, message: NOA_DAILY_STATUS_OPTIONS[resolvedAction].value };
      skipPlannerForResolvedChoice = true;
    }
  }

  const planner: NoaPlannerTrace = { ...NOA_PLANNER_TRACE_SKIPPED };
  let result: NoaResultSet | null = null;
  let decision: NoaDecisionTrace | undefined;
  try {
    const planned = session && !skipPlannerForResolvedChoice ? await runNoaPlannerStage(request, session.state, dependencies.planner, planner) : null;
    if (planned) decision = planned.decision;
    const answer = planned ? planned.answer : await dependencies.run(effectiveRequest, (trace) => { decision = { ...trace }; }, (domain, data) => {
      try {
        result = buildNoaShadowResultSet(domain, data, { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString() });
      } catch { shadow.shadowSave = "error"; }
    });
    // A fresh daily-status clarification (no pendingChoice was active this turn) starts one now.
    // Never a ResultSet: Part 7 - asking the question sets pendingChoice only.
    if (!planned && session && !pendingChoiceNextState && isNoaDailyStatusClarifyAnswer(answer)) {
      pendingChoiceNextState = setNoaPendingChoice(session.state, [...NOA_DAILY_STATUS_ORDER]);
    }
    if (planned) {
      if (planned.produced) {
        shadow.shadowResultKind = planned.produced.kind;
        shadow.shadowResultEntityType = planned.produced.entityType;
      }
      // Planner turns persist their own validated next state (push/focus) through the same
      // optimistic save; a version conflict is traced and never retried or overwritten.
      if (session && planned.nextState) {
        try {
          const saved = await dependencies.save(session.sessionId, session.version, planned.nextState);
          shadow.shadowSave = saved.ok ? "saved" : saved.reason === "version_conflict" ? "version_conflict" : "error";
        } catch { shadow.shadowSave = "error"; }
      }
    } else if (result !== null) {
      // Assignment occurs inside the synchronous observer; no result data enters diagnostics.
      const captured = result as NoaResultSet;
      shadow.shadowResultKind = captured.kind;
      shadow.shadowResultEntityType = captured.entityType;
      if (session && shadow.shadowSave !== "error") {
        try {
          const state: NoaConversationState = appendNoaResultSet(session.state, captured);
          const saved = await dependencies.save(session.sessionId, session.version, state);
          shadow.shadowSave = saved.ok ? "saved" : saved.reason === "version_conflict" ? "version_conflict" : "error";
        } catch { shadow.shadowSave = "error"; }
      }
    } else if (session && pendingChoiceNextState) {
      // pendingChoice was set or cleared/expired this turn, with no ResultSet either way.
      try {
        const saved = await dependencies.save(session.sessionId, session.version, pendingChoiceNextState);
        shadow.shadowSave = saved.ok ? "saved" : saved.reason === "version_conflict" ? "version_conflict" : "error";
      } catch { shadow.shadowSave = "error"; }
    }
    // Unsupported/social/clarification results leave the existing stack/focus/pending state intact.
    // Omission on load failure clears the client's stale id on a successful answer.
    return session ? { ...answer, sessionId: session.sessionId } : answer;
  } finally {
    if (decision) {
      try { collect?.(Object.freeze({ ...decision, ...shadow, ...planner })); } catch { /* diagnostics cannot fail a turn */ }
    }
  }
}
