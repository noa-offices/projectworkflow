import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { quotationWorkspaceDb, getWorkspaceDocument, saveWorkspaceDocument } from "./quotation-db";
import { acknowledgePublication, beginPublication, publicationContent, publicationMetadata, validateWorkspace, withPublication } from "./quotation-publication";
import { oldWorkspace, quotationId, baseVersion } from "./quotation-publication-fixture.mjs";
import { requestPublication } from "./quotation-publication-request";
import { preparePublication } from "./quotation-publication-payload";
import { recalculateWorkspace, syncWorkspaceWithServerSnapshot } from "./quotation-workspace";

after(() => quotationWorkspaceDb().close());
test("old current workspace round trips unchanged through actual IndexedDB", async () => {
  const old = oldWorkspace();
  await saveWorkspaceDocument(old);
  assert.deepEqual(await getWorkspaceDocument(quotationId), old);
});
test("refresh semantics retain existing draft key, DB version and both stores", async () => {
  const db = quotationWorkspaceDb();
  assert.equal(db.name, "projectworkflow-quotation-workspaces");
  assert.equal(db.verno, 1);
  assert.equal(db.quotationWorkspaces.schema.primKey.name, "local_id");
  assert.equal(db.quotationWorkspaceIndex.schema.primKey.name, "server_quotation_id");
  assert.deepEqual(db.tables.map((t) => t.name).sort(), ["quotationWorkspaceIndex", "quotationWorkspaces"]);
  db.close(); await db.open();
  assert.equal((await getWorkspaceDocument(quotationId))?.local_id, "quotation-" + quotationId);
});
test("autosave writes document and index together", async () => {
  const w = { ...oldWorkspace(), title: "Edited locally" };
  await saveWorkspaceDocument(w);
  assert.equal((await getWorkspaceDocument(quotationId))?.title, w.title);
  assert.equal((await quotationWorkspaceDb().quotationWorkspaceIndex.get(quotationId))?.has_unsaved_changes, true);
});
test("IndexedDB failure leaves previous stored document intact", async () => {
  const previous = await getWorkspaceDocument(quotationId);
  const table = quotationWorkspaceDb().quotationWorkspaceIndex;
  const original = table.put;
  table.put = (() => Promise.reject(new Error("Quota exceeded"))) as unknown as typeof table.put;
  try { await assert.rejects(saveWorkspaceDocument({ ...oldWorkspace(), title: "Must roll back" }), /Quota/); }
  finally { table.put = original; }
  assert.deepEqual(await getWorkspaceDocument(quotationId), previous);
});
test("old draft is readable but never assigned an invented server baseline", () => {
  const w = oldWorkspace();
  validateWorkspace(w, quotationId);
  assert.throws(() => beginPublication(w), /no verified server baseline/);
  assert.equal(publicationMetadata(w).baseVersion, undefined);
});
test("malformed hydration document is rejected without modifying it", () => {
  const corrupt = { ...oldWorkspace(), items: null };
  const before = JSON.stringify(corrupt);
  assert.throws(() => validateWorkspace(corrupt, quotationId), /malformed/);
  assert.equal(JSON.stringify(corrupt), before);
});
test("a pending immutable attempt survives refresh and is reused for retry", async () => {
  const w = withPublication(oldWorkspace(), { baseVersion });
  const attempt = beginPublication(w);
  await saveWorkspaceDocument(withPublication(w, { baseVersion, pending: attempt }));
  const refreshed = (await getWorkspaceDocument(quotationId))!;
  assert.deepEqual(beginPublication(refreshed), attempt);
  assert.equal(attempt.snapshot.metadata?.publication && publicationMetadata(attempt.snapshot).pending, undefined);
});
test("A starts publishing, B is edited, acknowledgement of A keeps B dirty", async () => {
  const a = withPublication(oldWorkspace(), { baseVersion });
  const attempt = beginPublication(a);
  let acknowledge!: (result: { version: string; savedAt: string }) => void;
  const pendingResponse = new Promise<{ version: string; savedAt: string }>((resolve) => { acknowledge = resolve; });
  const b = { ...a, items: a.items.map((item) => ({ ...item, qty: 3 })) };
  acknowledge({ version: crypto.randomUUID(), savedAt: new Date().toISOString() });
  const next = acknowledgePublication(b, attempt, await pendingResponse);
  assert.equal(next.items[0].qty, 3);
  assert.equal(next.has_unsaved_changes, true);
  assert.equal(publicationMetadata(next).pending, undefined);
  assert.notEqual(publicationMetadata(next).baseVersion, baseVersion);
  assert.equal(a.items[0].qty, 2);
});
test("no-new-edit acknowledgement marks current draft clean with returned base", () => {
  const w = withPublication(oldWorkspace(), { baseVersion });
  const attempt = beginPublication(w);
  const version = crypto.randomUUID();
  const next = acknowledgePublication(w, attempt, { version, savedAt: "2026-10-01T00:00:00Z" });
  assert.equal(next.has_unsaved_changes, false);
  assert.equal(publicationMetadata(next).baseVersion, version);
  assert.equal(publicationContent(next), publicationContent(w));
});
test("conflict/uncertain outcome keeps draft and original attempt unchanged", () => {
  const w = withPublication(oldWorkspace(), { baseVersion });
  const pending = withPublication(w, { baseVersion, pending: beginPublication(w) });
  const before = structuredClone(pending);
  assert.deepEqual(beginPublication(pending), before.metadata?.publication && publicationMetadata(before).pending);
  assert.deepEqual(pending, before);
});
test("JSON backup preserves old payload, row values and opaque metadata", () => {
  const w = { ...oldWorkspace(), metadata: { existingCustomKey: { value: 42 } } };
  const imported = JSON.parse(JSON.stringify(w));
  validateWorkspace(imported, quotationId);
  assert.deepEqual(imported, w);
});
test("component wires errors to alerts, keeps debounce and functional acknowledgement", () => {
  const source = readFileSync("components/quotations/local-quotation-builder.tsx", "utf8");
  assert.match(source, /Not saved locally/);
  assert.match(source, /Existing storage has not been replaced/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Retry local storage/);
  assert.match(source, /}, 200\)/);
  assert.match(source, /setWorkspace\(\(current\) => acknowledgePublication\(current, attempt, result\)\)/);
  assert.match(readFileSync("lib/local/quotation-publication-request.ts", "utf8"), /AbortSignal.timeout\(60000\)/);
  assert.match(source, /JSON.stringify\(workspace, null, 2\)/);
  assert.match(source, /existing.has_unsaved_changes \|\| publicationMetadata\(existing\).pending/);
});

test("network loss and timeout retain the same durable intent and all newer edits", async () => {
  const a = withPublication(oldWorkspace(), { baseVersion });
  const attempt = beginPublication(a);
  const b = withPublication({ ...a, title: "Newer local edit" }, { baseVersion, pending: attempt });
  await saveWorkspaceDocument(b);
  for (const error of [new TypeError("Network lost"), new DOMException("Timed out", "TimeoutError")]) {
    await assert.rejects(requestPublication(quotationId, attempt, async () => { throw error; }), (caught) => caught === error);
    assert.deepEqual(await getWorkspaceDocument(quotationId), b);
    assert.deepEqual(beginPublication(b), attempt);
  }
});

test("retry request uses identical payload, version and mutation ID", async () => {
  const attempt = beginPublication(withPublication(oldWorkspace(), { baseVersion }));
  const requests: string[] = [];
  const send: typeof fetch = async (_url, init) => {
    requests.push(String(init?.body));
    return Response.json({ ok: true, version: crypto.randomUUID(), savedAt: new Date().toISOString(), mutationId: attempt.mutationId });
  };
  assert.equal((await requestPublication(quotationId, attempt, send)).ok, true);
  assert.equal((await requestPublication(quotationId, attempt, send)).ok, true);
  assert.equal(requests[0], requests[1]);
});

test("conflict response is explicit and does not mutate the local draft", async () => {
  const w = withPublication(oldWorkspace(), { baseVersion });
  const before = structuredClone(w);
  const result = await requestPublication(quotationId, beginPublication(w), async () =>
    Response.json({ ok: false, code: "CONFLICT", error: "Server changed" }, { status: 409 }));
  assert.deepEqual(result, { ok: false, state: "conflict", error: "Server changed" });
  assert.deepEqual(w, before);
});

test("invalid or lost acknowledgement never marks a draft clean", async () => {
  const attempt = beginPublication(withPublication(oldWorkspace(), { baseVersion }));
  for (const body of [{ ok: true }, { ok: true, version: "browser-time", savedAt: "bad", mutationId: attempt.mutationId }]) {
    await assert.rejects(requestPublication(quotationId, attempt, async () => Response.json(body)), /acknowledgement/);
  }
  await assert.rejects(requestPublication(quotationId, attempt, async () => new Response("<html>error</html>")));
});

test("existing clean reconciliation keeps local rows and established header rules", () => {
  const existing = { ...oldWorkspace(), has_unsaved_changes: false };
  const server = { ...oldWorkspace(), title: "Server header" };
  const synced = syncWorkspaceWithServerSnapshot(existing, server);
  assert.equal(synced.title, "Server header");
  assert.equal(synced.local_id, existing.local_id);
  assert.deepEqual(synced.items.map((i) => i.id), existing.items.map((i) => i.id));
  assert.deepEqual(synced.sections, existing.sections);
});

test("publication retains existing quantity, discounts, VAT and totals calculation", () => {
  const workspace = oldWorkspace();
  const calculated = recalculateWorkspace(workspace);
  const payload = preparePublication(workspace, "40000000-0000-4000-8000-000000000001");
  assert.equal(payload.items[0].qty, 2);
  assert.equal(payload.items[0].unit_price, 100);
  assert.equal(payload.items[0].net_total, calculated.items[0].net_total);
  assert.equal(payload.quotation.subtotal, calculated.totals.subtotal);
  assert.equal(payload.quotation.vat_amount, calculated.totals.vat_amount);
  assert.equal(payload.quotation.grand_total, calculated.totals.grand_total);
  assert.equal(payload.quotation.discount_total, calculated.totals.discount_total + calculated.totals.overall_discount_amount);
});

test("corrupt persisted workspace is left intact for recovery, not replaced by server seed", async () => {
  const db = quotationWorkspaceDb();
  const previous = await getWorkspaceDocument(quotationId);
  const corrupt = { ...oldWorkspace(), items: null } as unknown as ReturnType<typeof oldWorkspace>;
  await db.quotationWorkspaces.put(corrupt);
  try {
    const read = await getWorkspaceDocument(quotationId);
    assert.throws(() => validateWorkspace(read, quotationId), /malformed/);
    assert.deepEqual(await db.quotationWorkspaces.get(corrupt.local_id), corrupt);
  } finally { if (previous) await saveWorkspaceDocument(previous); }
});

test("read failure rejects explicitly while the prior draft remains recoverable", async () => {
  const db = quotationWorkspaceDb();
  const previous = await getWorkspaceDocument(quotationId);
  const original = db.quotationWorkspaces.where;
  db.quotationWorkspaces.where = (() => { throw new Error("IndexedDB read unavailable"); }) as typeof original;
  try { await assert.rejects(getWorkspaceDocument(quotationId), /read unavailable/); }
  finally { db.quotationWorkspaces.where = original; }
  assert.deepEqual(await getWorkspaceDocument(quotationId), previous);
});
