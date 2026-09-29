import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { appendNoaResultSet, createEmptyNoaConversationState } from "./noa-conversation-state";
import { createNoaResultSetHandle, isNoaResultSet, type NoaResultSet } from "./noa-result-set";
import { buildNoaPlannerInput, validateNoaSemanticPlan } from "./noa-semantic-planner";
import { runNoaShadowTurn, buildNoaShadowResultSet, type NoaPlannerDependencies, type NoaShadowTurnTrace } from "./noa-shadow-turn";
import { createNoaGoldenSessionStore, createNoaGoldenSessionRepository } from "./testing/noa-golden-harness";

mock.module("server-only", { defaultExport: {} });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { pathname: "/", section: "dashboard" } as const;
const privateText = "PRIVATE-CONTACT-SENTINEL";
const clients = [
  { id: id(1), company_name: "Apex Luxury Retail", client_number: "CL-001", client_code: "APEX", is_active: true },
  { id: id(2), company_name: "TechCorp Solutions", client_number: "CL-002", client_code: "TECH", is_active: true },
  { id: id(3), company_name: "Apex Luxury Retail North", client_number: "CL-003", client_code: "NORTH", is_active: false },
].map((row) => ({ ...row, email: privateText, phone: privateText, contact_person: privateText, address: privateText, notes: privateText }));
function order(n: number) { return { projectFile: { orderNo: `CO-000${n}-001`, quotationId: id(n + 10), quotationNo: `QN-000${n}`,
  clientId: id(1), clientName: "Apex Luxury Retail", reference: `Project ${n}`, total: 200, currency: "AED", createdAt: "2026-01-01", createdBy: id(1) } }; }
const quotations = [
  { id: id(11), client_id: id(1), created_at: "2026-01-03", layout_settings: order(1) },
  { id: id(12), client_id: id(1), created_at: "2026-01-02", layout_settings: order(2) },
  { id: id(13), client_id: id(1), created_at: "2026-01-01", layout_settings: order(1) },
  { id: id(14), client_id: id(2), created_at: "2026-01-04", layout_settings: order(4) },
];
let allowed = true;
const visible = new Set(clients.map((row) => row.id));
let calls: Array<{ table: string; columns: string }> = [];
const authorize = async () => { if (!allowed) throw Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;" }); };
mock.module("@/lib/auth", { namedExports: { requireActiveUser: authorize, requireQuotationActionUser: authorize } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({ from(table: string) {
  assert.ok(["clients", "quotations"].includes(table));
  let data: Record<string, unknown>[] = table === "clients" ? clients.filter((row) => visible.has(row.id)) : [...quotations];
  let columns = "";
  let limit = Infinity;
  const ordering: Array<{ key: string; ascending: boolean }> = [];
  const builder = {
    select(value: string) { columns = value; calls.push({ table, columns }); return builder; },
    eq(key: string, value: unknown) { data = data.filter((row) => row[key] === value); return builder; },
    in(key: string, values: unknown[]) { data = data.filter((row) => values.includes(row[key])); return builder; },
    ilike(key: string, pattern: string) {
      const needle = pattern.slice(1, -1).replace(/\\([\\%_])/g, "$1").toLowerCase();
      data = data.filter((row) => String(row[key] ?? "").toLowerCase().includes(needle)); return builder;
    },
    order(key: string, opts: { ascending: boolean }) { ordering.push({ key, ascending: opts.ascending }); return builder; },
    limit(value: number) { limit = value; return builder; },
    async returns() {
      data.sort((a, b) => { for (const { key, ascending } of ordering) { const x = String(a[key]), y = String(b[key]); if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1); } return 0; });
      return { error: null, data: data.slice(0, limit).map((row) => Object.fromEntries(columns.split(",").map((key) => [key, row[key]]))) };
    },
  };
  return builder;
} }) } });
const { readNoaClients } = await import("./noa-client-capability.server");
const { describeNoaClients, lookupNoaClients } = await import("./noa-semantic-planner.server");
const { resolveNoaRelation } = await import("./noa-relation.server");
const set = (ids: string[]): NoaResultSet => ids.length === 1
  ? { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString(), kind: "entity", entityType: "client", count: 1, items: [{ id: ids[0] }] }
  : { handle: createNoaResultSetHandle(), createdAt: new Date().toISOString(), kind: "list", entityType: "client", count: ids.length, items: ids.map((id) => ({ id })) };
const lookup = (lookupText: string | null) => ({ kind: "client_lookup", lookupText });
const select = (handle: string, ordinal: number | null = null) => ({ kind: "select", sourceResultSetHandle: handle, ordinal });
const relation = (handle: string, target: "project_file" | "quotation") => ({ kind: "relation", sourceResultSetHandle: handle, relation: `client.${target}` });

test("capability C1/C8/C9/C10: active list and name/number/code lookup preserve 0/1/many", async () => {
  assert.deepEqual((await readNoaClients({ lookupText: null })).rows.map((row) => row.id), [id(1), id(2)]);
  for (const lookupText of ["TechCorp Solutions", "CL-002", "TECH"]) assert.deepEqual((await readNoaClients({ lookupText })).rows.map((row) => row.id), [id(2)]);
  assert.deepEqual((await readNoaClients({ lookupText: "Apex Luxury Retail" })).rows.map((row) => row.id), [id(1), id(3)]);
  assert.equal((await readNoaClients({ lookupText: "Missing" })).rows.length, 0);
  assert.equal((await readNoaClients({ lookupText: "%_" })).rows.length, 0);
});
test("capability C11: safe re-fetch preserves requested order and never selects or renders contacts", async () => {
  calls = [];
  assert.deepEqual((await readNoaClients({ ids: [id(2), id(1)] })).rows.map((row) => row.id), [id(2), id(1)]);
  const answer = await describeNoaClients([id(2), id(1)]);
  assert.match(answer.text, /TechCorp Solutions.*CL-002/);
  assert.equal(JSON.stringify(answer).includes(privateText), false);
  assert.ok(calls.every((call) => call.columns === "id,company_name,client_number,client_code,is_active"));
});
test("capability authorization and current visibility precede all Client display", async () => {
  allowed = false; calls = [];
  try { assert.match((await readNoaClients({ lookupText: null })).message!, /access/); assert.equal(calls.length, 0); }
  finally { allowed = true; }
  visible.delete(id(1));
  try { assert.equal((await readNoaClients({ ids: [id(1)] })).rows.length, 0); }
  finally { visible.add(id(1)); }
});
test("relation C5/C6: direct client IDs, source order, Project deduplication, and unrelated exclusion", async () => {
  const source = set([id(1)]), state = appendNoaResultSet(createEmptyNoaConversationState(), source);
  const project = await resolveNoaRelation(state, source.handle, "client.project_file");
  assert.ok(project.ok); assert.equal(project.resultSet.entityType, "project_file");
  assert.deepEqual(project.resultSet.items, [{ orderNo: "CO-0001-001" }, { orderNo: "CO-0002-001" }]);
  const quotes = await resolveNoaRelation(state, source.handle, "client.quotation");
  assert.ok(quotes.ok); assert.deepEqual(quotes.resultSet.kind !== "aggregate" && quotes.resultSet.items, [11, 12, 13].map((n) => ({ id: id(n) })));
  const multiple = set([id(2), id(1)]);
  const related = await resolveNoaRelation(appendNoaResultSet(createEmptyNoaConversationState(), multiple), multiple.handle, "client.quotation");
  assert.ok(related.ok); assert.deepEqual(related.resultSet.kind !== "aggregate" && related.resultSet.items, [14, 11, 12, 13].map((n) => ({ id: id(n) })));
});
test("relation re-authorizes sources; stale/tampered Client UUIDs cannot authorize targets", async () => {
  const source = set([id(1)]), state = appendNoaResultSet(createEmptyNoaConversationState(), source);
  visible.delete(id(1)); calls = [];
  try { const result = await resolveNoaRelation(state, source.handle, "client.quotation"); assert.ok(result.ok); assert.equal(result.resultCount, 0); assert.ok(calls.every((call) => call.table === "clients")); }
  finally { visible.add(id(1)); }
  allowed = false;
  try { assert.deepEqual(await resolveNoaRelation(state, source.handle, "client.project_file"), { ok: false, reason: "unauthorized" }); }
  finally { allowed = true; }
});
test("planner C12: strict Client handles, kind, grounded arguments, and identifier-only capture", () => {
  const source = set([id(1)]), state = appendNoaResultSet(createEmptyNoaConversationState(), source);
  assert.ok(validateNoaSemanticPlan(select(source.handle), state).ok);
  assert.equal(validateNoaSemanticPlan(select(createNoaResultSetHandle()), state).ok, false);
  const evicted = Array.from({ length: 5 }, () => set([id(2)])).reduce(appendNoaResultSet, state);
  assert.equal(validateNoaSemanticPlan(select(source.handle), evicted).ok, false);
  for (const raw of [{ ...lookup("Invented") }, { ...lookup("Apex"), sql: "x" }, { ...lookup("Apex"), ordinal: 1 }]) assert.equal(validateNoaSemanticPlan(raw, state, "Show Apex").ok, false);
  assert.ok(validateNoaSemanticPlan(lookup("Apex"), state, "Show Apex").ok);
  assert.equal(isNoaResultSet({ ...source, items: [{ id: id(1), email: privateText }] }), false);
  assert.equal(isNoaResultSet({ ...source, kind: "aggregate" }), false);
  const captured = buildNoaShadowResultSet("Client", { kind: "client_record_detail", client: clients[0] }, { handle: source.handle, createdAt: source.createdAt });
  assert.deepEqual(captured, source);
  assert.equal(JSON.stringify(buildNoaPlannerInput(state, { message: "List them" })).includes(privateText), false);
});
function conversation() {
  const store = createNoaGoldenSessionStore(), sessionId = globalThis.crypto.randomUUID();
  store.sessions.set(sessionId, { state: createEmptyNoaConversationState(), version: 1 });
  let raw: unknown;
  const traces: NoaShadowTurnTrace[] = [];
  const planner: NoaPlannerDependencies = {
    plan: async () => raw, lookupClients: lookupNoaClients, describeClients: describeNoaClients, relate: resolveNoaRelation,
    drillDown: async () => { throw new Error("unexpected drilldown"); },
    describeProjectFiles: async (ids) => ({ domain: "Project", sources: [], text: ids.join(", ") }),
    describeQuotations: async (ids) => ({ domain: "Quotation", sources: [], text: ids.join(", ") }),
  };
  return { traces, state: () => store.sessions.get(sessionId)!.state,
    async send(message: string, plan: unknown) {
      raw = plan;
      return runNoaShadowTurn({ message, context, sessionId }, { ...createNoaGoldenSessionRepository(store), planner,
        run: async () => { throw new Error("unexpected legacy fallback"); } }, (trace) => traces.push({ ...trace }));
    } };
}
test("golden A: natural Client -> Projects -> them -> older Client -> quotations", async () => {
  // The archived near-match is hidden by this fixture's authorization scope, making Apex unique.
  visible.delete(id(3));
  try {
    const h = conversation();
    assert.match((await h.send("Show Apex Luxury Retail.", lookup("Apex Luxury Retail"))).text, /Apex Luxury Retail/);
    const client = h.state().focus!.resultSetHandle;
    await h.send("What projects do they have?", relation(client, "project_file"));
    const project = h.state().focus!.resultSetHandle, before = structuredClone(h.state());
    await h.send("List them.", select(project)); assert.deepEqual(h.state(), before);
    await h.send("Go back to the client.", select(client)); assert.equal(h.state().focus!.resultSetHandle, client);
    await h.send("What quotations are for this client?", relation(client, "quotation"));
    assert.equal(h.state().resultSets.at(-1)!.entityType, "quotation");
    assert.equal(JSON.stringify([h.state(), h.traces]).includes(privateText), false);
    assert.equal(h.traces.at(-1)!.plannerAction, "relation");
  } finally { visible.add(id(3)); }
});
test("golden B/C: C1-C4/C7 list, them, second, it, older Client rebound from quotation scope", async () => {
  const h = conversation();
  await h.send("List the clients.", lookup(null));
  const list = h.state().focus!.resultSetHandle, original = structuredClone(h.state());
  await h.send("List them.", select(list)); assert.deepEqual(h.state(), original);
  assert.match((await h.send("Tell me about the second one.", select(list, 2))).text, /TechCorp Solutions/);
  const entity = h.state().focus!.resultSetHandle, selected = structuredClone(h.state());
  await h.send("Tell me about it.", select(entity)); assert.deepEqual(h.state(), selected);
  await h.send("What quotations are for this client?", relation(entity, "quotation"));
  await h.send("Go back to the clients.", select(list)); assert.equal(h.state().focus!.resultSetHandle, list);
  assert.equal(h.traces.at(-1)!.referenceBinding, "older_result");
});
test("golden lookup ambiguity/no match preserves safe scope", async () => {
  const h = conversation();
  await h.send("Show Apex Luxury Retail.", lookup("Apex Luxury Retail"));
  assert.equal(h.state().resultSets[0].kind, "list");
  const before = structuredClone(h.state());
  assert.match((await h.send("Find Missing.", lookup("Missing"))).text, /No matching client/);
  assert.deepEqual(h.state(), before);
});
