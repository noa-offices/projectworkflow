import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { appendNoaResultSet, createEmptyNoaConversationState, type NoaConversationState } from "./noa-conversation-state";
import { createNoaResultSetHandle, type NoaResultSet } from "./noa-result-set";
import { buildNoaPlannerInput, shouldRunNoaSemanticPlanner, validateNoaSemanticPlan } from "./noa-semantic-planner";
import { runNoaShadowTurn, type NoaPlannerDependencies } from "./noa-shadow-turn";
import { createNoaGoldenSessionRepository, createNoaGoldenSessionStore } from "./testing/noa-golden-harness";

mock.module("server-only", { defaultExport: {} });
let authorized = true;
let reads = 0;
let rows: Record<string, unknown>[] = [];
const authorize = async () => { if (!authorized) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }); };
mock.module("@/lib/auth", { namedExports: { requireActiveUser: authorize, requireQuotationActionUser: authorize } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  from: (table: string) => {
    reads++;
    assert.equal(table, "quotations");
    const builder = { select: () => builder, order: () => builder, limit: () => builder,
      returns: async () => ({ data: rows, error: null }) };
    return builder;
  },
}) } });
const { describeNoaProjectTotal } = await import("./noa-semantic-planner.server");
const { lookupNoaQuotationsByContext } = await import("./noa-quotation-capability.server");
const context = { pathname: "/", section: "dashboard" } as const;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "2026-01-01T00:00:00.000Z";
const projects = (): NoaResultSet => ({ handle: createNoaResultSetHandle(), createdAt: T, kind: "list", entityType: "project_file",
  count: 2, items: [{ orderNo: "CO-0001-001" }, { orderNo: "CO-0002-001" }] });
const entity = (): NoaResultSet => ({ handle: createNoaResultSetHandle(), createdAt: T, kind: "entity", entityType: "project_file",
  count: 1, items: [{ orderNo: "CO-0002-001" }] });
const quote = (n: number, name = "Galleria Mall") => ({ id: uuid(n), quotation_no: `QN-000${n}`, title: name,
  legacy_reference: null, layout_settings: {}, clients: null, projects: null });
function seedProject() {
  rows = [{ id: uuid(2), layout_settings: { projectFile: { orderNo: "CO-0002-001", quotationId: uuid(2), quotationNo: "QN-0002",
    clientId: uuid(9), clientName: "Fixture Client", reference: "Galleria Mall", total: 185000, currency: "AED", createdAt: T, createdBy: uuid(8) } } }];
}
function harness(state: NoaConversationState) {
  const store = createNoaGoldenSessionStore();
  const sessionId = globalThis.crypto.randomUUID();
  store.sessions.set(sessionId, { state, version: 1 });
  let plan: unknown;
  let legacy = 0;
  const described: string[][] = [];
  const planner: NoaPlannerDependencies = {
    plan: async () => plan,
    projectFact: describeNoaProjectTotal, lookupQuotations: lookupNoaQuotationsByContext,
    describeProjectFiles: async (ids) => ({ domain: "Project", sources: [], text: ids.join(", ") }),
    describeQuotations: async (ids) => { described.push(ids); return { domain: "Quotation", sources: [], text: ids.join(", ") }; },
    relate: async () => { throw new Error("unexpected relation"); }, drillDown: async () => { throw new Error("unexpected drilldown"); },
  };
  return { described, current: () => store.sessions.get(sessionId)!.state, legacy: () => legacy,
    send: async (message: string, nextPlan: unknown) => {
      plan = nextPlan;
      return runNoaShadowTurn({ message, context, sessionId }, { ...createNoaGoldenSessionRepository(store), planner,
        run: async () => { legacy++; return { domain: "Help", sources: [], text: "legacy" }; } });
    } };
}
const fact = (handle: string | null) => ({ kind: "project_fact", sourceResultSetHandle: handle, fact: "total_value" });
const lookup = { kind: "quotation_lookup", lookupText: "Galleria Mall" };

test("Project P4A1: second Project -> total uses confirmed snapshot and preserves focus without values in state", async () => {
  authorized = true; seedProject();
  const list = projects();
  const h = harness(appendNoaResultSet(createEmptyNoaConversationState(), list));
  await h.send("Tell me about the second one.", { kind: "select", sourceResultSetHandle: list.handle, ordinal: 2 });
  const before = structuredClone(h.current());
  const answer = await h.send("What is the total value of this project?", fact(before.focus!.resultSetHandle));
  assert.equal(answer.text, "This Project File has a total value of AED 185,000.");
  assert.deepEqual(h.current(), before);
  assert.equal(h.legacy(), 0);
  assert.equal(JSON.stringify(buildNoaPlannerInput(before, { message: "its value?" })).includes("185000"), false);
});
test("Project P4A2: no focused Project safely clarifies without reads", async () => {
  reads = 0;
  const h = harness(createEmptyNoaConversationState());
  const answer = await h.send("What is the total value of this project?", fact(null));
  assert.match(answer.text, /Which Project File/); assert.equal(reads, 0); assert.equal(h.legacy(), 0);
});
test("Project P4A3: older compatible entity refocuses without duplication; quotation cannot supply total", async () => {
  seedProject(); const project = entity();
  const quotation: NoaResultSet = { handle: createNoaResultSetHandle(), createdAt: T, kind: "entity", entityType: "quotation", count: 1, items: [{ id: uuid(1) }] };
  const initial = [project, quotation].reduce(appendNoaResultSet, createEmptyNoaConversationState());
  const h = harness(initial);
  assert.equal(validateNoaSemanticPlan(fact(quotation.handle), initial).ok, false);
  const answer = await h.send("What is the total value of this project?", fact(project.handle));
  assert.match(answer.text, /AED 185,000/); assert.equal(h.current().focus!.resultSetHandle, project.handle);
  assert.equal(h.current().resultSets.length, 2);
});
test("Project authorization, stale identity and unsupported fact remain safe", async () => {
  authorized = false; reads = 0;
  assert.doesNotMatch((await describeNoaProjectTotal("CO-0002-001", context)).text, /185,000/);
  assert.equal(reads, 0); authorized = true; seedProject();
  assert.doesNotMatch((await describeNoaProjectTotal("CO-9999-001", context)).text, /185,000/);
  const p = entity(); const state = appendNoaResultSet(createEmptyNoaConversationState(), p);
  assert.equal(validateNoaSemanticPlan({ ...fact(p.handle), fact: "profit" }, state).ok, false);
  assert.equal(validateNoaSemanticPlan({ ...fact(p.handle), lookupText: "injection" }, state).ok, false);
});

test("quotation Q4B1: supplied phrasings accept grounded context and create an entity", async () => {
  authorized = true; rows = [quote(1)];
  for (const message of ["Can you check Galleria Mall quotation?", "Show the Galleria Mall quotation.", "Find the quotation for Galleria Mall.", "Which quotation is for Galleria Mall?"]) {
    const h = harness(createEmptyNoaConversationState());
    const answer = await h.send(message, lookup);
    assert.equal(answer.text, uuid(1)); assert.equal(h.current().resultSets[0].kind, "entity"); assert.equal(h.legacy(), 0);
  }
});
test("quotation Q4B2/Q4B5: revisions/options preserve displayed order and existing second/last/them selection", async () => {
  rows = [quote(2), quote(1), quote(3)];
  const h = harness(createEmptyNoaConversationState());
  await h.send("Find the quotation for Galleria Mall.", lookup);
  const list = h.current().resultSets[0];
  assert.equal(list.kind, "list"); assert.deepEqual(h.described[0], [uuid(2), uuid(1), uuid(3)]);
  await h.send("Tell me about the second one.", { kind: "select", sourceResultSetHandle: list.handle, ordinal: 2 });
  assert.deepEqual(h.described.at(-1), [uuid(1)]);
  await h.send("The last one", { kind: "select", sourceResultSetHandle: list.handle, ordinal: "last" });
  assert.deepEqual(h.described.at(-1), [uuid(3)]);
  await h.send("Show them", { kind: "select", sourceResultSetHandle: list.handle });
  assert.deepEqual(h.described.at(-1), [uuid(2), uuid(1), uuid(3)]);
});
test("quotation Q4B3: no match produces deterministic not-found and preserves scope", async () => {
  rows = [quote(1, "Elsewhere")]; const h = harness(createEmptyNoaConversationState());
  assert.equal((await h.send("Galleria Mall quotation", lookup)).text, "No matching quotation found.");
  assert.equal(h.current().resultSets.length, 0);
});
test("quotation Q4B4: client/project collision and partial matches never silently choose", async () => {
  rows = [{ ...quote(1, "Other"), projects: { project_name: "Galleria Mall" } },
    { ...quote(2, "Other"), clients: { company_name: "Galleria Mall Holdings" } }];
  assert.deepEqual((await lookupNoaQuotationsByContext("galleria mall")).ids, [uuid(1), uuid(2)]);
  assert.deepEqual((await lookupNoaQuotationsByContext("Galleria%Mall")).ids, []);
});
test("quotation lookup rejects invented context and extra arguments; gate keeps IDs/social/config", () => {
  const state = createEmptyNoaConversationState();
  for (const raw of [{ ...lookup, lookupText: "Invented" }, { ...lookup, sql: "x" }, { ...lookup, fact: "total_value" }, { ...lookup, ordinal: 1 }]) {
    assert.equal(validateNoaSemanticPlan(raw, state, "Galleria Mall quotation").ok, false);
  }
  for (const message of ["Hi", "Tell me about QN-0001", "CO-0002-001"]) assert.equal(shouldRunNoaSemanticPlanner(state, { message }, true), false);
  assert.equal(shouldRunNoaSemanticPlanner(state, { message: "Galleria Mall quotation", productConfigurationReference: {} }, true), false);
  assert.equal(shouldRunNoaSemanticPlanner(state, { message: "Galleria Mall quotation" }, true), true);
});
test("quotation authorization precedes reads; incomplete and oversized matches clarify", async () => {
  authorized = false; reads = 0;
  assert.match((await lookupNoaQuotationsByContext("Galleria Mall")).message!, /access/);
  assert.equal(reads, 0); authorized = true;
  rows = Array.from({ length: 201 }, (_, i) => quote(i));
  assert.match((await lookupNoaQuotationsByContext("Galleria Mall")).message!, /limit/);
  rows = rows.slice(0, 11);
  assert.match((await lookupNoaQuotationsByContext("Galleria Mall")).message!, /ten/);
});
