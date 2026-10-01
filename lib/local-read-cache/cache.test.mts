import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { ReadCacheDb, activateUser, clearReadBoundary, readSnapshot, rememberDraftAccess, storeSnapshot } from "./db";
import { fetchReadProjection, ReadFailure, getHealth, setReadHealth } from "./runtime";
import { minimizedRows, readEntity, retentionMs, type ReadRow } from "./types";
import { quotationWorkspaceDb, getWorkspaceDocument, saveWorkspaceDocument } from "../local/quotation-db";
import { oldWorkspace } from "../local/quotation-publication-fixture.mjs";
const db = new ReadCacheDb();
const row: ReadRow = { id: "1", title: "Company", code: "CL-1", subtitle: "", status: "Active", href: "/sales/clients" };
beforeEach(async () => { await clearReadBoundary(db); });
after(() => { db.close(); quotationWorkspaceDb().close(); });
for (const key of ["products:management", "brands:list", "materials:library"] as const) {
  test(key + " reuses durable isolated leases; refresh succeeds, failure preserves, logout revokes", async () => {
    const owner = await activateUser("A", db);
    await storeSnapshot(owner, key, [row], Date.now() - 1, db);
    db.close(); await db.open();
    assert.equal((await readSnapshot(owner, key, db))?.data[0].title, "Company");
    assert.equal(await readSnapshot({ ...owner, userId: "B" }, key, db), undefined);
    const send: typeof fetch = async () => Response.json({ ok: true, userId: "A", entity: key, data: [{ ...row, title: "Fresh" }], fetchedAt: Date.now() });
    assert.equal((await fetchReadProjection(owner, key, send, db))?.data[0].title, "Fresh");
    await assert.rejects(fetchReadProjection(owner, key, async () => Response.json({}, { status: 503 }), db));
    assert.equal((await readSnapshot(owner, key, db))?.data[0].title, "Fresh");
    await clearReadBoundary(db);
    assert.equal(await readSnapshot(owner, key, db), undefined);
    assert.equal(await storeSnapshot(owner, key, [row], Date.now(), db), false);
  });
}
test("separate cache contract; Builder DB/version/key remain unchanged", () => {
  assert.equal(db.name, "projectworkflow-read-cache"); assert.equal(db.verno, 1);
  assert.equal(db.snapshots.schema.primKey.name, "[userId+key]");
  const builder = quotationWorkspaceDb();
  assert.equal(builder.name, "projectworkflow-quotation-workspaces"); assert.equal(builder.verno, 1);
  assert.equal(builder.quotationWorkspaces.schema.primKey.name, "local_id");
});
test("User B cannot read A cache; account switch clears old projections", async () => {
  const a = await activateUser("A", db); await storeSnapshot(a, "clients", [row], Date.now(), db);
  assert.equal((await readSnapshot(a, "clients", db))?.data.length, 1);
  assert.equal(await readSnapshot({ ...a, userId: "B" }, "clients", db), undefined);
  const b = await activateUser("B", db);
  assert.equal(await readSnapshot(a, "clients", db), undefined);
  assert.equal(await readSnapshot(b, "clients", db), undefined);
  assert.equal(await db.snapshots.count(), 0);
});
test("snapshot survives DB close/reopen with the same user boundary", async () => {
  const owner = await activateUser("A", db); await storeSnapshot(owner, "clients", [row], Date.now(), db);
  db.close(); await db.open();
  assert.deepEqual(await activateUser("A", db), owner);
  assert.deepEqual((await readSnapshot(owner, "clients", db))?.data, [row]);
});
test("successful refresh replaces snapshot, and successful empty result stores empty", async () => {
  const owner = await activateUser("A", db); await storeSnapshot(owner, "clients", [row], Date.now() - 1, db);
  const send: typeof fetch = async () => Response.json({ ok: true, userId: "A", entity: "clients", data: [], fetchedAt: Date.now() });
  assert.deepEqual((await fetchReadProjection(owner, "clients", send, db))?.data, []);
});
for (const kind of ["network", "timeout", "service", "malformed"]) {
  test(kind + " failure preserves previous snapshot", async () => {
    const owner = await activateUser("A", db); await storeSnapshot(owner, "clients", [row], Date.now(), db);
    const before = await readSnapshot(owner, "clients", db);
    const send: typeof fetch = async () => {
      if (kind === "network") throw new TypeError("Network failed");
      if (kind === "timeout") throw new DOMException("Timeout", "TimeoutError");
      return kind === "service" ? Response.json({}, { status: 503 }) : Response.json({ ok: true });
    };
    await assert.rejects(fetchReadProjection(owner, "clients", send, db));
    assert.deepEqual(await readSnapshot(owner, "clients", db), before);
  });
}
test("expiry evicts saved reads", async () => {
  const owner = await activateUser("A", db);
  await storeSnapshot(owner, "clients", [row], Date.now() - retentionMs - 1, db);
  assert.equal(await readSnapshot(owner, "clients", db), undefined); assert.equal(await db.snapshots.count(), 0);
});
test("bounded whitelist excludes heavy pricing, tokens, and sensitive Client fields", async () => {
  const owner = await activateUser("A", db);
  const dirty = { ...row, email: "private", phone: "private", notes: "private", trn: "private", address: "private", token: "secret", pricing: { huge: true }, layout_settings: { internal: true } };
  await storeSnapshot(owner, "clients", Array.from({ length: 900 }, (_, i) => ({ ...dirty, id: String(i) })), Date.now(), db);
  const stored = await readSnapshot(owner, "clients", db);
  assert.equal(stored?.data.length, 500);
  for (const value of ["private", "secret", "huge", "layout_settings"]) assert.ok(!JSON.stringify(stored).includes(value));
});
test("signed/token thumbnail URLs and script URLs are not persisted", () => {
  for (const thumbnail of ["https://storage.test/object/sign/image?token=secret", "javascript:alert(1)"]) {
    assert.equal(minimizedRows("products", [{ ...row, thumbnail }])[0].thumbnail, undefined);
  }
});
test("out-of-order responses cannot replace newer multi-tab snapshot", async () => {
  const owner = await activateUser("A", db); const now = Date.now();
  await storeSnapshot(owner, "clients", [{ ...row, title: "New" }], now, db);
  await storeSnapshot(owner, "clients", [row], now - 1, db);
  assert.equal((await readSnapshot(owner, "clients", db))?.data[0].title, "New");
});
test("logout revokes lease; late response cannot repopulate cache", async () => {
  const owner = await activateUser("A", db);
  let complete!: (response: Response) => void;
  const pending = fetchReadProjection(owner, "clients", async () => new Promise<Response>(resolve => { complete = resolve; }), db);
  await clearReadBoundary(db);
  complete(Response.json({ ok: true, userId: "A", entity: "clients", data: [row], fetchedAt: Date.now() }));
  await assert.rejects(pending, /session has changed/); assert.equal(await db.snapshots.count(), 0);
});
test("logout/generic eviction preserve unsynced Builder document; clear access hints", async () => {
  const workspace = oldWorkspace(); await saveWorkspaceDocument(workspace);
  const owner = await activateUser("A", db); await rememberDraftAccess(owner, workspace.server_quotation_id, db);
  await storeSnapshot(owner, "products", [row], Date.now(), db); await clearReadBoundary(db);
  assert.equal(await db.draftAccess.count(), 0);
  assert.deepEqual(await getWorkspaceDocument(workspace.server_quotation_id), workspace);
});
test("401/403 clear read cache without authorizing cached mutations", async () => {
  for (const status of [401, 403]) {
    const owner = await activateUser("A", db); await storeSnapshot(owner, "clients", [row], Date.now(), db);
    await assert.rejects(fetchReadProjection(owner, "clients", async () => Response.json({}, { status }), db), ReadFailure);
    assert.equal(await db.snapshots.count(), 0); assert.equal(await db.boundary.count(), 0);
  }
});
test("server account mismatch cannot persist another user's payload", async () => {
  const owner = await activateUser("A", db);
  await assert.rejects(fetchReadProjection(owner, "clients", async () => Response.json({ ok: true, userId: "B", entity: "clients", data: [row], fetchedAt: Date.now() }), db));
  assert.equal(await db.snapshots.count(), 0);
});
test("only target list routes use fast read surface, never editors or financial routes", () => {
  assert.equal(readEntity("/products"), "products");
  assert.equal(readEntity("/products/templates", "?manage=1"), "products:management");
  assert.equal(readEntity("/products/templates", "?template=1"), null);
  assert.equal(readEntity("/sales/quotations"), "quotations");
  assert.equal(readEntity("/projects/orders"), "projects");
  assert.equal(readEntity("/projects/completed"), "completed");
  assert.equal(readEntity("/sales/clients"), "clients");
  assert.equal(readEntity("/dashboard"), null); assert.equal(readEntity("/procurement/orders"), null);
});
test("reachability statuses distinguish service unavailable, offline and refresh failed", () => {
  for (const status of ["Service unavailable", "Offline — saved data", "Refresh failed", "Refreshing", "Online"] as const) {
    setReadHealth(status); assert.equal(getHealth().status, status);
  }
});
