// Phase 0 (NOA test/observability foundation): a reusable multi-turn conversation acceptance
// harness that drives the REAL runNoaOrchestrator() entry point - real imports, real routing, real
// conversation-reference plumbing, fixture capabilities and an explicitly disabled AI runtime.
// See TEST-MODE.md. Module replacement uses node:test mock.module().
//
// Usage (from a *.test.mts file, run via `npm run test:noa`, which passes
// --experimental-test-module-mocks):
//
//   import { mock } from "node:test";
//   import { installNoaGoldenFixtures, createNoaGoldenSession } from "./testing/noa-golden-harness.ts";
//   installNoaGoldenFixtures(mock);
//   const session = createNoaGoldenSession();
//   const turn1 = await session.send("What is quotation status?");
//   const turn2 = await session.send("Which are the two client confirmed?");
//
// `session.send()` automatically carries the previous turn's conversationReference /
// productConfigurationReference forward, exactly like the real client does.

import type { MockTracker } from "node:test";
import type { NoaAnswer, NoaChatRequest, NoaMessageRole } from "@/lib/noa/noa-types";
import {
  NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS,
  NOA_GOLDEN_PROJECT_FILES,
  NOA_GOLDEN_QUOTATIONS,
  type NoaFixtureProjectFile,
} from "./noa-golden-fixtures";

// See TEST-MODE.md for the precise offline boundary and limitations.
import type { NoaDecisionTrace } from "../noa-orchestrator";
import { applyNoaConversationTurnState, noaRecentMessages, noaTurnErrorText, NOA_GREETING_TEXT, type NoaSessionAnswer, type NoaTurnState } from "../noa-turn-state";
import { runNoaShadowTurn, type NoaShadowDependencies, type NoaShadowTrace } from "../noa-shadow-turn";
import type { NoaPlannerTrace } from "../noa-semantic-planner";
import { createEmptyNoaConversationState, parseNoaConversationState, type NoaConversationState } from "../noa-conversation-state";
// Shadow fields are present on the default (real shadow lifecycle) path, absent under `execute`.
export type NoaTurnTrace = NoaDecisionTrace & Partial<NoaShadowTrace & NoaPlannerTrace> & { turnId: number };
export type NoaGoldenTurnResult = { answer: NoaSessionAnswer | null; trace: NoaTurnTrace };

// Mirrors the real quotation capability's quotationQuestionKind(): count wording or a bare
// "status" question (no show/list/which) is a status summary, not a list.
function isQuotationStatusSummary(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(how many|count|number of)\b/.test(normalized)
    || (!/\b(show|list|which)\b/.test(normalized) && /\bstatus(?:es)?\b/.test(normalized));
}

function quotationStatusCountData() {
  const statuses = [...new Set(NOA_GOLDEN_QUOTATIONS.map((q) => q.status))];
  const counts = statuses.map((status) => ({ displayLabel: status, persistedStatus: status, count: NOA_GOLDEN_QUOTATIONS.filter((q) => q.status === status).length }));
  return {
    kind: "quotation_status_count",
    totalCount: NOA_GOLDEN_QUOTATIONS.length,
    counts,
    emptyMessage: null,
    deterministicOnly: true,
    deterministicText: `There are ${NOA_GOLDEN_QUOTATIONS.length} quotations: ${counts.map((c) => `${c.count} ${c.displayLabel}`).join(" and ")}.`,
  };
}

function quotationStatusListData(statuses: Array<NoaFixtureQuotationStatus> | null) {
  const rows = NOA_GOLDEN_QUOTATIONS.filter((q) => !statuses || statuses.includes(q.status)).map((q) => ({
    id: q.id,
    quotationNo: q.quotationNo,
    status: q.status,
    displayLabel: q.status,
    persistedStatus: q.status,
    client: q.client,
    project: q.projectOrderNo ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  return {
    kind: "quotation_status_list",
    requestedStatus: statuses?.length === 1 ? statuses[0] : null,
    requestedDisplayLabel: statuses?.length === 1 ? statuses[0] : null,
    totalMatching: rows.length,
    rows,
    truncatedCount: 0,
    emptyMessage: rows.length === 0 ? "No quotations were found." : null,
    // Test-only: forces the orchestrator's already-existing deterministic-only short-circuit
    // (see noa-orchestrator.ts's `deterministicData?.deterministicOnly === true` check) so this
    // golden harness never depends on the AI provider being reachable in a test process.
    deterministicOnly: true,
    deterministicText: rows.length === 0
      ? "No quotations were found."
      : `${rows.length} quotation${rows.length === 1 ? "" : "s"}: ${rows.map((r) => r.quotationNo).join(", ")}.`,
  };
}

type NoaFixtureQuotationStatus = "draft" | "sent_to_client" | "client_confirmed";

function projectOrderListData(status: "active" | "completed") {
  const rows = NOA_GOLDEN_PROJECT_FILES.filter((p) => p.status === status);
  return {
    kind: "project_order_list",
    returnedCount: rows.length,
    rows,
    totalMatching: rows.length,
    truncatedCount: 0,
    deterministicOnly: true,
    deterministicText: `I found ${rows.length} ${status} Project File${rows.length === 1 ? "" : "s"}. Showing ${rows.length}.`,
  };
}

function projectFileDetailData(order: NoaFixtureProjectFile) {
  return {
    kind: "project_file_detail",
    projectFile: order,
    deterministicOnly: true,
    deterministicText: `${order.orderNo} (${order.reference}) for ${order.clientName} is ${order.status}.`,
  };
}

// Observation only: every fixture Project capability call, so golden cases can prove which scope
// (exact entity lookups vs the generic active list) a turn actually executed.
export const noaGoldenProjectCapabilityCalls: Array<{ message: string; entity: string | null }> = [];
export const noaGoldenQuotationCapabilityCalls: Array<{ message: string; quotationNo: string | null }> = [];

// Installs the fixture-backed capability modules used by the golden conversation suite. Must be
// called (once per test file, before importing noa-orchestrator.ts / the harness's own
// createNoaGoldenSession) with the `mock` tracker from `node:test`, and the process must be run
// with `--experimental-test-module-mocks` (already wired into `npm run test:noa`).
export function installNoaGoldenFixtures(mock: MockTracker, options: { mockDatabase?: boolean } = {}): void {
  // Explicitly disabled semantic mode; exercise the real extractor's disabled fallback.
  process.env.NOA_SEMANTIC_V2 = "false";
  process.env.NOA_AGENTS_V1 = "false";
  mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: {
    resolveAiAgentRuntimeConfig: async () => ({ enabled: false, apiKeyConfigured: false }),
  } });
  mock.module("@/lib/ai/provider-router.server", { namedExports: {
    runAiProvider: async () => { throw new Error("Unexpected live provider boundary"); },
  } });
  // Real orchestrator/capability source imports "server-only" (see noa-orchestrator.ts), which
  // Next.js turns into a no-op for server bundles but which throws unconditionally under plain
  // Node - stubbed out here exactly the way Next's own webpack config does for a server build.
  mock.module("server-only", { defaultExport: {} });

  mock.module("@/lib/noa/noa-product-capability.server", { namedExports: {
    resolveNoaProductCandidate: async () => ({ kind: "not_found" }),
    fetchNoaProductCapability: async () => { throw new Error("Unseeded Product capability"); },
  } });
  if (options.mockDatabase !== false) mock.module("@/lib/supabase/server", { namedExports: {
    createClient: async () => { throw new Error("Unseeded database access"); },
  } });
  mock.module("@/lib/noa/noa-quotation-capability.server", {
    namedExports: {
      quotationIdentifierCount: (message: string) => [...message.matchAll(/\bQN-\d{3,}(?:-\d+)*\b/gi)].length,
      quotationStructuredRequest: () => undefined,
      // Mirrors the real persisted-status display labels used by the planner's quotation renderer.
      quotationStatusDisplayLabel: (status: string) => ({ draft: "Pending", client_confirmed: "Client Confirmed" } as Record<string, string>)[status] ?? status,
      fetchNoaQuotationCapability: async (message: string, _context: unknown, options?: { quotation?: { quotationNo: string } }) => {
        noaGoldenQuotationCapabilityCalls.push({ message, quotationNo: options?.quotation?.quotationNo ?? null });
        const exact = options?.quotation && NOA_GOLDEN_QUOTATIONS.find((q) => q.quotationNo === options.quotation!.quotationNo);
        if (exact) {
          return { ok: true, sources: [{ label: `Checked quotation ${exact.quotationNo}`, type: "quotation" }], data: {
            id: exact.id, quotationNo: exact.quotationNo, requestedField: "detail", reference: exact.projectOrderNo ?? exact.quotationNo,
            client: exact.client, status: exact.status } };
        }
        const normalized = message.toLowerCase();
        if (isQuotationStatusSummary(message) && !/confirmed|pending/.test(normalized)) {
          return { data: quotationStatusCountData(), ok: true, sources: [{ label: "Checked quotations", type: "quotation" }] };
        }
        if (/client[\s-]?confirmed|confirmed/.test(normalized)) {
          return { data: quotationStatusListData(["client_confirmed"]), ok: true, sources: [{ label: "Checked client confirmed quotations", type: "quotation" }] };
        }
        if (/pending/.test(normalized)) {
          return { data: quotationStatusListData(["draft"]), ok: true, sources: [{ label: "Checked pending quotations", type: "quotation" }] };
        }
        return { data: quotationStatusListData(null), ok: true, sources: [{ label: "Checked quotations", type: "quotation" }] };
      },
    },
  });

  mock.module("@/lib/noa/noa-project-capability.server", {
    namedExports: {
      projectFileIdentifierCount: (message: string) => [...message.matchAll(/\bCO-\d{3,}(?:-\d+)*\b/gi)].length,
      projectFileIdentifierFromMessage: (message: string) => message.match(/\bCO-\d{3,}(?:-\d+)*\b/i)?.[0] ?? null,
      resolveNoaEntityCandidate: async (candidate: string) => {
        const match = NOA_GOLDEN_PROJECT_FILES.find((p) => p.orderNo.toLowerCase() === candidate.trim().toLowerCase());
        return match
          ? { domain: "Project" as const, entity: { type: "project_file" as const, text: match.orderNo } }
          : { domain: "not_found" as const };
      },
      fetchNoaProjectCapability: async (message: string, _context: unknown, options?: { entity?: { text: string } }) => {
        noaGoldenProjectCapabilityCalls.push({ message, entity: options?.entity?.text ?? null });
        const identifier = message.match(/\bCO-\d{3,}(?:-\d+)*\b/i)?.[0];
        if (identifier) {
          const match = NOA_GOLDEN_PROJECT_FILES.find((p) => p.orderNo.toLowerCase() === identifier.toLowerCase());
          if (!match) return { message: "I couldn't find that Project File.", ok: false, reason: "not_found" as const };
          return { data: projectFileDetailData(match), ok: true, sources: [{ label: "Project · Checked Project File", type: "project_file" }] };
        }
        const completed = /\bcompleted\b/.test(message.toLowerCase());
        return {
          data: projectOrderListData(completed ? "completed" : "active"),
          ok: true,
          sources: [{ label: "Project · Checked Project Files", type: "project_file" }],
        };
      },
    },
  });

  mock.module("@/lib/noa/noa-user-activity-capability.server", {
    namedExports: {
      fetchNoaUserActivityCapability: async () => ({
        data: {
          kind: "catch_up_changes",
          deterministicOnly: true,
          deterministicText: "There were no changes recorded today in this fixture.",
          items: [],
          returnedCount: 0,
          truncatedCount: 0,
          totalMatching: 0,
        },
        ok: true,
        sources: [{ label: "User Activity · Checked recent changes", type: "user_activity" }],
      }),
    },
  });
}

// ------------------------------------------------------------------------------------------------
// Multi-turn session: carries conversationReference / productConfigurationReference forward
// exactly like the real client (components/noa) does, so golden cases can express result
// continuity ("List them.") without re-deriving the orchestrator's internal state machine.
// ------------------------------------------------------------------------------------------------

// In-memory stand-in for noa-session.server.ts with the same contract: owned rows by id, a
// missing/expired id is replaced by a fresh session, CAS on version, and state validated with the
// shared Phase 1A parser before persistence. Failure switches exercise the shadow failure policy.
export type NoaGoldenSessionStore = {
  sessions: Map<string, { state: NoaConversationState; version: number; expired?: boolean }>;
  loadFailure?: "throw" | "invalid_state" | "storage_error";
  saveFailure?: "version_conflict" | "storage_error";
};
export function createNoaGoldenSessionStore(): NoaGoldenSessionStore {
  return { sessions: new Map() };
}
export function createNoaGoldenSessionRepository(store: NoaGoldenSessionStore): Pick<NoaShadowDependencies, "load" | "save"> {
  return {
    load: async (sessionId) => {
      if (store.loadFailure === "throw") throw new Error("raw storage detail");
      if (store.loadFailure) return { ok: false, reason: store.loadFailure };
      const row = sessionId ? store.sessions.get(sessionId) : undefined;
      if (sessionId && row && !row.expired) return { ok: true, session: { sessionId, state: structuredClone(row.state), version: row.version } };
      const id = globalThis.crypto.randomUUID();
      store.sessions.set(id, { state: createEmptyNoaConversationState(), version: 0 });
      return { ok: true, session: { sessionId: id, state: createEmptyNoaConversationState(), version: 0 } };
    },
    save: async (sessionId, expectedVersion, next) => {
      const parsed = parseNoaConversationState(JSON.stringify(next));
      if (!parsed) return { ok: false, reason: "invalid_state" };
      if (store.saveFailure) return { ok: false, reason: store.saveFailure };
      const row = store.sessions.get(sessionId);
      if (!row || row.expired || row.version !== expectedVersion) return { ok: false, reason: "version_conflict" };
      row.state = parsed;
      row.version += 1;
      return { ok: true, version: row.version };
    },
  };
}

export type NoaGoldenSessionOptions = {
  context?: NoaChatRequest["context"];
  displayName?: string;
  initialState?: NoaTurnState;
  store?: NoaGoldenSessionStore;
  // Phase 2 Core: replaces ONLY the Semantic Planner's provider boundary. Validation, relation
  // execution and rendering stay real. Default is the real boundary, which the disabled fixture
  // runtime turns into "unavailable" (legacy routing answers).
  plan?: NonNullable<NoaShadowDependencies["planner"]>["plan"];
  // Bypasses the shadow lifecycle entirely (direct orchestrator call); used by harness self-tests.
  execute?: (request: NoaChatRequest, collect: (trace: Readonly<NoaDecisionTrace>) => void) => Promise<NoaAnswer>;
};

export function createNoaGoldenSession(options: NoaGoldenSessionOptions = {}) {
  let state: NoaTurnState = options.initialState ?? {};
  const store = options.store ?? createNoaGoldenSessionStore();
  const recentMessages: Array<{ role: NoaMessageRole; text: string }> = [{ role: "assistant", text: NOA_GREETING_TEXT }];
  let turnId = 0;

  async function sendTurn(message: string): Promise<NoaGoldenTurnResult> {
    message = message.trim();
    turnId += 1;
    const request: NoaChatRequest = {
      context: options.context ?? { pathname: "/dashboard", section: "dashboard" },
      conversationReference: state.conversationReference,
      displayName: options.displayName,
      message,
      productConfigurationReference: state.productConfigurationReference,
      recentMessages: noaRecentMessages(recentMessages),
    };
    recentMessages.push({ role: "user", text: message });
    let trace: NoaTurnTrace | undefined;
    const collect = (decision: Readonly<NoaDecisionTrace & Partial<NoaShadowTrace & NoaPlannerTrace>>) => { trace = { ...decision, turnId }; };
    try {
      const { runNoaOrchestrator } = await import("@/lib/noa/noa-orchestrator");
      const { describeNoaQuotations, describeNoaRelatedProjectFiles, requestNoaSemanticPlan } = await import("@/lib/noa/noa-semantic-planner.server");
      const { drillDownNoaAggregate, resolveNoaRelation } = await import("@/lib/noa/noa-relation.server");
      const planner = { plan: options.plan ?? requestNoaSemanticPlan, relate: resolveNoaRelation, drillDown: drillDownNoaAggregate,
        describeProjectFiles: describeNoaRelatedProjectFiles, describeQuotations: describeNoaQuotations };
      const answer = options.execute
        ? await options.execute(request, collect)
        : await runNoaShadowTurn({ ...request, sessionId: state.sessionId }, { ...createNoaGoldenSessionRepository(store), run: runNoaOrchestrator, planner }, collect);
      state = applyNoaConversationTurnState(state, answer);
      recentMessages.push({ role: "assistant", text: answer.text });
      if (!trace) throw new Error("Missing internal decision trace");
      return { answer, trace };
    } catch (error) {
      state = applyNoaConversationTurnState(state);
      recentMessages.push({ role: "assistant", text: noaTurnErrorText(error) });
      if (!trace) throw error;
      return { answer: null, trace };
    }
  }

  let queue: Promise<unknown> = Promise.resolve();
  function send(message: string): Promise<NoaGoldenTurnResult> {
    const turn = queue.then(() => sendTurn(message));
    queue = turn.catch(() => undefined);
    return turn;
  }
  return {
    send,
    snapshot: () => ({ ...state, recentMessages: noaRecentMessages(recentMessages) }),
    // Persisted shadow state for the client's current session id - test observation only.
    shadow: () => (state.sessionId ? store.sessions.get(state.sessionId) : undefined),
    store,
  };
}

export { NOA_GOLDEN_CLIENT_CONFIRMED_QUOTATIONS, NOA_GOLDEN_PROJECT_FILES, NOA_GOLDEN_QUOTATIONS };
