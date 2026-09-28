import { appendNoaResultSet, isNoaConversationState, type NoaConversationState } from "./noa-conversation-state";
import { createNoaResultSetHandle, isNoaResultSet, isNoaStateRecord, MAX_NOA_RESULT_SET_ITEMS, type NoaResultSet, type NoaQuotationScopeStatus } from "./noa-result-set";
import { noaSessionId, type NoaSessionAnswer, type NoaSessionChatRequest } from "./noa-turn-state";
import type { NoaDecisionTrace, runNoaOrchestrator } from "./noa-orchestrator";
import type { loadOrCreateNoaSession, saveNoaSession, NoaSession } from "./noa-session.server";
import type { NoaDomain } from "./noa-types";

export type NoaShadowTrace = {
  sessionMode: "shadow_loaded" | "shadow_created" | "shadow_replaced" | "shadow_unavailable";
  shadowResultKind: "entity" | "list" | "aggregate" | "none";
  shadowResultEntityType: "quotation" | "project_file" | "none";
  shadowSave: "saved" | "version_conflict" | "skipped" | "error";
};
export type NoaShadowTurnTrace = NoaDecisionTrace & NoaShadowTrace;
export type NoaShadowDependencies = {
  load: typeof loadOrCreateNoaSession;
  save: typeof saveNoaSession;
  run: typeof runNoaOrchestrator;
};

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
// Neither a session nor any ResultSet is ever supplied to authoritative routing.
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

  let result: NoaResultSet | null = null;
  let decision: NoaDecisionTrace | undefined;
  try {
    const answer = await dependencies.run(authoritativeRequest, (trace) => { decision = { ...trace }; }, (domain, data) => {
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
      try { collect?.(Object.freeze({ ...decision, ...shadow })); } catch { /* diagnostics cannot fail a turn */ }
    }
  }
}
