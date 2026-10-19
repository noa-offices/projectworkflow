import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFileSync } from "node:fs";
import { getWorkspaceDocument, quotationWorkspaceDb, saveWorkspaceDocument } from "./quotation-db";
import {
  adoptServerWorkspace, beginReplacementPublication, discardRejectedAttempt, hasDifferences,
  loadLatestWorkspace, reconcileOpenedWorkspace, summarizeDifferences,
} from "./quotation-conflict";
import { acknowledgePublication, beginPublication, publicationMetadata, withPublication } from "./quotation-publication";
import { fetchServerVersion, requestPublication } from "./quotation-publication-request";
import { baseVersion, oldWorkspace, quotationId } from "./quotation-publication-fixture.mjs";

after(() => quotationWorkspaceDb().close());
const newerVersion = "50000000-0000-4000-8000-0000000000aa";
const serverWorkspace = (version: string | null = newerVersion) =>
  withPublication({ ...oldWorkspace(), has_unsaved_changes: false, title: "Server title" }, version ? { baseVersion: version } : {});
const dirty = () => withPublication({ ...oldWorkspace(), title: "My local edit" }, { baseVersion });
const clean = () => withPublication({ ...oldWorkspace(), has_unsaved_changes: false }, { baseVersion });

test("1/2 a clean workspace adopts the latest server state and its baseVersion", () => {
  const { workspace, serverNewer } = reconcileOpenedWorkspace(clean(), serverWorkspace());
  assert.equal(serverNewer, false);
  assert.equal(workspace.title, "Server title");
  assert.equal(publicationMetadata(workspace).baseVersion, newerVersion);
  assert.equal(publicationMetadata(workspace).pending, undefined);
  assert.equal(workspace.has_unsaved_changes, false);
});

test("3 a dirty local draft is preserved and a newer server version is reported", () => {
  const existing = dirty();
  const { workspace, serverNewer } = reconcileOpenedWorkspace(existing, serverWorkspace());
  assert.equal(workspace, existing);
  assert.equal(workspace.title, "My local edit");
  assert.equal(serverNewer, true);
  assert.equal(reconcileOpenedWorkspace(existing, serverWorkspace(baseVersion)).serverNewer, false);
});

test("a pending attempt is never replaced or flagged: its retry may already have committed", () => {
  const w = withPublication(dirty(), { baseVersion, pending: beginPublication(dirty()) });
  const result = reconcileOpenedWorkspace(w, serverWorkspace());
  assert.equal(result.workspace, w);
  assert.equal(result.serverNewer, false);
});

test("clean adoption without a verified server baseline cannot invent one", () => {
  const { workspace } = reconcileOpenedWorkspace(clean(), serverWorkspace(null));
  assert.equal(publicationMetadata(workspace).baseVersion, undefined);
  assert.throws(() => beginPublication(workspace), /no verified server baseline/);
  assert.throws(() => loadLatestWorkspace(dirty(), serverWorkspace(null)), /could not be verified/);
});

test("5/6 acknowledgement refreshes baseVersion so a second save never reuses the stale one", () => {
  const first = beginPublication(dirty());
  const ackVersion = crypto.randomUUID();
  const after1 = acknowledgePublication(dirty(), first, { version: ackVersion, savedAt: new Date().toISOString() });
  const second = beginPublication({ ...after1, title: "Second edit" });
  assert.equal(second.baseVersion, ackVersion);
  assert.notEqual(second.baseVersion, first.baseVersion);
  assert.notEqual(second.mutationId, first.mutationId);
});

test("9 Load Latest clears the stale attempt and keeps local_id", async () => {
  const stale = withPublication(dirty(), { baseVersion, pending: beginPublication(dirty()) });
  const next = loadLatestWorkspace(stale, serverWorkspace());
  assert.equal(next.local_id, stale.local_id);
  assert.equal(next.title, "Server title");
  assert.equal(next.has_unsaved_changes, false);
  assert.deepEqual(publicationMetadata(next), { baseVersion: newerVersion });
  await saveWorkspaceDocument(stale);
  await saveWorkspaceDocument(next);
  const stored = (await getWorkspaceDocument(quotationId))!;
  assert.equal(publicationMetadata(stored).pending, undefined);
  assert.equal(stored.title, "Server title");
  assert.equal((await quotationWorkspaceDb().quotationWorkspaces.count()), 1);
  assert.throws(() => loadLatestWorkspace(stale, { ...serverWorkspace(), server_quotation_id: crypto.randomUUID() }), /different quotation/);
});

test("11/12 Keep My Version builds a NEW attempt on the fresh version with a fresh mutation ID", () => {
  const old = beginPublication(dirty());
  const local = withPublication({ ...dirty(), title: "Edited again after the old snapshot" }, { baseVersion, pending: old });
  const { attempt, pending } = beginReplacementPublication(local, newerVersion);
  assert.equal(attempt.baseVersion, newerVersion);
  assert.notEqual(attempt.mutationId, old.mutationId);
  assert.equal(attempt.snapshot.title, "Edited again after the old snapshot");
  assert.equal(publicationMetadata(attempt.snapshot).pending, undefined);
  assert.equal(publicationMetadata(pending).baseVersion, newerVersion);
  assert.deepEqual(publicationMetadata(pending).pending, attempt);
  assert.equal(publicationMetadata(local).pending, old);
  assert.throws(() => beginReplacementPublication(local, "not-a-version"), /could not be verified/);
});

test("20 a definitive conflict drops only the dead attempt; later edits survive", () => {
  const a = beginPublication(dirty());
  const edited = withPublication({ ...dirty(), items: dirty().items.map((i) => ({ ...i, qty: 9 })) }, { baseVersion, pending: a });
  const next = discardRejectedAttempt(edited);
  assert.equal(next.items[0].qty, 9);
  assert.equal(next.has_unsaved_changes, true);
  assert.equal(publicationMetadata(next).pending, undefined);
  assert.equal(publicationMetadata(next).baseVersion, baseVersion);
});

test("7 a genuine 409 is surfaced as conflict and is not retried against the stale version silently", async () => {
  const sent: string[] = [];
  const result = await requestPublication(quotationId, beginPublication(dirty()), async (_u, init) => {
    sent.push(String(init?.body));
    return Response.json({ ok: false, code: "CONFLICT", error: "x" }, { status: 409 });
  });
  assert.equal(result.ok === false && result.state, "conflict");
  assert.equal(sent.length, 1);
});

test("15 network failure while probing the version keeps the draft and gives retry guidance", async () => {
  const local = dirty();
  const before = structuredClone(local);
  await assert.rejects(fetchServerVersion(quotationId, async () => { throw new TypeError("offline"); }), /local draft is kept/);
  assert.deepEqual(local, before);
  await assert.rejects(fetchServerVersion(quotationId, async () => new Response("<html>", { status: 502 })), /local draft is kept/);
  assert.deepEqual(await fetchServerVersion(quotationId, async () => Response.json({ ok: false, error: "nope" }, { status: 403 })), { ok: false, error: "nope" });
  assert.deepEqual(await fetchServerVersion(quotationId, async () => Response.json({ ok: true, version: newerVersion })), { ok: true, version: newerVersion });
});

test("14 differences are reported, never merged", () => {
  const server = serverWorkspace();
  const local = { ...dirty(), items: dirty().items.map((i) => ({ ...i, qty: 5, unit_price: 250 })) };
  const base = adoptServerWorkspace(local, server);
  const summary = summarizeDifferences(local, { ...base, sections: [...base.sections, { ...base.sections[0], id: crypto.randomUUID(), section_title: "Only on server" }] });
  assert.equal(hasDifferences(summary), true);
  assert.deepEqual(summary.sectionsRemoved, ["Only on server"]);
  assert.ok(summary.header.some((row) => row.label === "Title" && row.local === "My local edit" && row.server === "Server title"));
  assert.ok(summary.itemChanges[0].changes.some((c) => c.startsWith("Quantity 2 → 5")));
  assert.ok(summary.itemChanges[0].changes.some((c) => c.startsWith("Unit price")));
  assert.equal(local.items[0].qty, 5);
  assert.equal(hasDifferences(summarizeDifferences(local, local)), false);
});

test("component wiring: confirmations, single flight, preflight and honest status", () => {
  const source = readFileSync("components/quotations/local-quotation-builder.tsx", "utf8");
  assert.match(source, /Discard your local draft and load the latest software version\?/);
  assert.match(source, /Replace the newer software version with my current Local Builder version\?/);
  assert.match(source, /onClick=\{\(\) => void confirmLoadLatest\(\)\}/);
  assert.match(source, /onClick=\{\(\) => void confirmKeepMine\(\)\}/);
  assert.match(source, /onClick=\{\(\) => void saveToSoftware\(\)\}/);
  // Single flight: every publication/conflict action shares the same busy guard.
  assert.equal((source.match(/if \(publicationBusyRef\.current \|\| !hydrated\) return;/g) ?? []).length >= 2, true);
  assert.match(source, /beginReplacementPublication\(workspace, latest\.version\)/);
  assert.match(source, /reconcileOpenedWorkspace\(existing, initialWorkspace\)/);
  assert.match(source, /A newer quotation version is available/);
  assert.match(source, /Local changes not yet saved/);
  assert.match(source, /Unable to save — try again/);
  assert.doesNotMatch(source, /Server conflict - local draft kept/);
  // "Saved to software" only after the acknowledged-result branch.
  assert.match(source, /setWorkspace\(\(current\) => acknowledgePublication\(current, attempt, result\)\);\s+setSaveState\("saved"\)/);
});

test("19 the version probe uses the same permission gate and RLS-scoped read as publication", () => {
  const route = readFileSync("app/api/quotations/[id]/local-workspace/route.ts", "utf8");
  assert.equal((route.match(/authorizePublisher\(supabase\)/g) ?? []).length, 2);
  assert.match(route, /export async function GET/);
  assert.match(route, /from\("quotations"\)\.select\("workspace_version"\)/);
  assert.doesNotMatch(route, /force|ignoreVersion|overwrite/i);
  assert.match(route, /publish_local_builder_workspace/);
});
