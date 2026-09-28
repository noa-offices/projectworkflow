import { appendNoaResultSet, isNoaConversationState, type NoaConversationState } from "./noa-conversation-state";
import { createNoaResultSetHandle, isNoaResultSet, isNoaStateRecord, MAX_NOA_RESULT_SET_ITEMS, type NoaResultSet, type NoaQuotationScopeStatus } from "./noa-result-set";
import { noaSessionId, type NoaSessionAnswer, type NoaSessionChatRequest } from "./noa-turn-state";
import type { NoaDecisionTrace, runNoaOrchestrator } from "./noa-orchestrator";
import type { loadOrCreateNoaSession, saveNoaSession, NoaSession } from "./noa-session.server";
import type { NoaAnswer, NoaDomain } from "./noa-types";
import { isNoaConversationReference } from "./noa-conversation-reference";
import {
  buildNoaPlannerInput, NOA_PLANNER_TRACE_SKIPPED, shouldRunNoaSemanticPlanner, validateNoaSemanticPlan,
  type NoaPlannerInput, type NoaPlannerTrace,
} from "./noa-semantic-planner";
import type { NoaRelationResult } from "./noa-relation.server";
import type { NoaRelationId } from "./noa-relation-registry";

export type NoaShadowTrace = {
  sessionMode: "shadow_loaded" | "shadow_created" | "shadow_replaced" | "shadow_unavailable";
  shadowResultKind: "entity" | "list" | "aggregate" | "none";
  shadowResultEntityType: "quotation" | "project_file" | "none";
  shadowSave: "saved" | "version_conflict" | "skipped" | "error";
};
export type NoaShadowTurnTrace = NoaDecisionTrace & NoaShadowTrace & NoaPlannerTrace;
// Phase 2 Core: the planner's provider boundary (`plan`) plus the deterministic, authorized
// executors it may reach. Production wires noa-semantic-planner.server.ts/noa-relation.server.ts;
// offline tests replace only `plan`. Absent planner = unavailable, and legacy routing answers.
export type NoaPlannerDependencies = {
  plan: (input: NoaPlannerInput) => Promise<unknown | null>;
  relate: (state: NoaConversationState, sourceHandle: NoaResultSet["handle"], relation: NoaRelationId) => Promise<NoaRelationResult>;
  describeProjectFiles: (orderNos: string[], context: NoaSessionChatRequest["context"]) => Promise<NoaAnswer>;
};
export type NoaShadowDependencies = {
  load: typeof loadOrCreateNoaSession;
  save: typeof saveNoaSession;
  run: typeof runNoaOrchestrator;
  planner?: NoaPlannerDependencies;
};

const NOA_PLANNER_CLARIFY_TEXT = "Which of the earlier results do you mean? Please ask again naming the quotations or Project Files you want.";

type NoaPlannerOutcome = { answer: NoaAnswer; decision: NoaDecisionTrace; result: NoaResultSet | null };

// Phase 2 Core Quotations pilot - the FIRST consumer allowed to let ResultSet state decide a turn.
// Returns null whenever legacy routing must answer (gate closed, planner unavailable/invalid,
// passthrough, drill-down delegated to the existing status-list capability, or executor refusal).
async function runNoaPlannerStage(
  request: NoaSessionChatRequest, state: NoaConversationState, planner: NoaPlannerDependencies | undefined,
  trace: NoaPlannerTrace,
): Promise<NoaPlannerOutcome | null> {
  if (!shouldRunNoaSemanticPlanner(state, request)) return null;
  const started = performance.now();
  let raw: unknown = null;
  try {
    raw = planner ? await planner.plan(buildNoaPlannerInput(state, request)) : null;
  } catch { raw = null; }
  if (raw === null || raw === undefined || !planner) {
    Object.assign(trace, { plannerMode: "unavailable", plannerValidation: "unavailable", plannerExecution: "legacy" });
    return null;
  }
  const validated = validateNoaSemanticPlan(raw, state);
  if (!validated.ok) {
    Object.assign(trace, { plannerMode: "invalid", plannerAction: validated.action, plannerValidation: validated.reason, plannerExecution: "legacy" });
    return null;
  }
  const { plan } = validated;
  Object.assign(trace, { plannerMode: "planned", plannerAction: plan.kind, plannerSourceType: validated.sourceType, plannerValidation: "valid", plannerExecution: "legacy" });
  const reference = isNoaConversationReference(request.conversationReference) ? request.conversationReference : undefined;
  const decision = (fields: Partial<NoaDecisionTrace>): NoaDecisionTrace => ({
    routeDecision: null, semanticUsed: false, referenceAvailable: Boolean(reference), referenceDomain: reference?.domain ?? null,
    referenceBindingKind: "not_applicable", scopeSource: "result_set", capabilitySelected: null, resultCount: null,
    clarifyReason: null, errorCode: null, durationMs: Math.round(performance.now() - started), ...fields,
  });

  if (plan.kind === "clarify") {
    trace.plannerExecution = "executed";
    // Clarification keeps the existing stack/focus and both client references untouched.
    return {
      answer: { domain: "Help", sources: [], text: NOA_PLANNER_CLARIFY_TEXT, voiceText: NOA_PLANNER_CLARIFY_TEXT, conversationReference: reference },
      decision: decision({ routeDecision: "Help", scopeSource: "clarification", clarifyReason: "semantic_clarification" }),
      result: null,
    };
  }
  if (plan.kind !== "relation") return null;

  try {
    const related = await planner.relate(state, plan.sourceResultSetHandle, plan.relation);
    if (!related.ok) return null; // unauthorized/storage/empty source: legacy decides, nothing guessed
    const orderNos = related.resultSet.entityType === "project_file" ? related.resultSet.items.map((item) => item.orderNo) : [];
    const answer = await planner.describeProjectFiles(orderNos, request.context);
    trace.plannerExecution = "executed";
    return {
      answer,
      decision: decision({ routeDecision: answer.domain, capabilitySelected: "Project", resultCount: related.resultCount }),
      // An empty relation answers truthfully but pushes nothing: an empty list is not new scope.
      result: related.resultCount > 0 ? related.resultSet : null,
    };
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

  const planner: NoaPlannerTrace = { ...NOA_PLANNER_TRACE_SKIPPED };
  let result: NoaResultSet | null = null;
  let decision: NoaDecisionTrace | undefined;
  try {
    const planned = session ? await runNoaPlannerStage(request, session.state, dependencies.planner, planner) : null;
    if (planned) {
      decision = planned.decision;
      result = planned.result;
    }
    const answer = planned ? planned.answer : await dependencies.run(authoritativeRequest, (trace) => { decision = { ...trace }; }, (domain, data) => {
      try {
        result = buildNoaShadowResultSet(domain, data, { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString() });
      } catch { shadow.shadowSave = "error"; }
    });
    if (result !== null) {
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
