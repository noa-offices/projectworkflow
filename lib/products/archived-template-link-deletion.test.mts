import assert from "node:assert/strict";
import { test } from "node:test";
import { removeArchivedTemplateLink, type ArchivedLinkInput } from "./archived-template-link-deletion";

const input: ArchivedLinkInput = { templateId: "10000000-0000-4000-8000-000000000001", relationshipId: "20000000-0000-4000-8000-000000000001" };
const acknowledgement = { ok: true, code: "deleted", ...input, deletedCount: 1 };
test("authorization is required before invoking the RPC", async () => {
  let calls = 0;
  const result = await removeArchivedTemplateLink(input, { authorize: async () => { throw Error("No access"); }, rpc: async () => { calls++; return { data: acknowledgement, error: null }; }, refresh: () => assert.fail("Must not refresh") });
  assert.equal(result.code, "forbidden"); assert.equal(calls, 0);
});
test("invalid input never reaches the database", async () => {
  const result = await removeArchivedTemplateLink({ ...input, templateId: "invalid" }, { authorize: async () => {}, rpc: async () => assert.fail("Must not call"), refresh: () => {} });
  assert.equal(result.code, "invalid_input");
});
test("only an exact one-row acknowledgement confirms success and refreshes", async () => {
  let refreshes = 0;
  const deps = { authorize: async () => {}, rpc: async () => ({ data: acknowledgement, error: null }), refresh: () => { refreshes++; } };
  assert.equal((await removeArchivedTemplateLink(input, deps)).ok, true);
  for (const data of [null, {}, { ...acknowledgement, deletedCount: 0 }, { ...acknowledgement, deletedCount: 2 }, { ...acknowledgement, relationshipId: input.templateId }, { ...acknowledgement, templateId: input.relationshipId }]) {
    assert.equal((await removeArchivedTemplateLink(input, { ...deps, rpc: async () => ({ data, error: null }) })).ok, false);
  }
  assert.equal(refreshes, 1);
});
test("normal rejections, RLS errors, missing migration and transport loss never claim success", async () => {
  for (const code of ["active_link", "not_archived", "wrong_relationship", "not_found", "stale", "brand_unavailable", "endpoint_unavailable"]) {
    const result = await removeArchivedTemplateLink(input, { authorize: async () => {}, rpc: async () => ({ data: { ok: false, code }, error: null }), refresh: () => assert.fail("Must not refresh") });
    assert.equal(result.ok, false); assert.equal(result.code, code);
  }
  for (const code of ["42501", "PGRST202", "P0001"]) {
    const result = await removeArchivedTemplateLink(input, { authorize: async () => {}, rpc: async () => ({ data: acknowledgement, error: { code } }), refresh: () => assert.fail("Must not refresh") });
    assert.equal(result.ok, false);
  }
  assert.equal((await removeArchivedTemplateLink(input, { authorize: async () => {}, rpc: async () => { throw Error("lost response"); }, refresh: () => {} })).ok, false);
});
test("cache invalidation failure cannot turn a confirmed deletion into an uncertain result", async () => {
  const result = await removeArchivedTemplateLink(input, { authorize: async () => {}, rpc: async () => ({ data: acknowledgement, error: null }), refresh: () => { throw Error("Cache unavailable"); } });
  assert.equal(result.ok, true); assert.match(result.message, /Refresh/);
});
