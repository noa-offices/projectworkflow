import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { deactivateArchivedLink, type DeactivationLink } from "./archived-link-deactivation";

const parent = "10000000-0000-4000-8000-000000000001", child = "10000000-0000-4000-8000-000000000002";
const id = "20000000-0000-4000-8000-000000000001";
const link: DeactivationLink = { id, parent_template_id: parent, linked_template_id: child, is_active: true, updated_at: "2026-10-22T00:00:00Z" };
const input = { templateId: parent, relationshipId: id };
function setup() {
  let writes = 0, refreshes = 0;
  const deps = {
    authorize: async () => {},
    template: async () => ({ data: { is_active: false, lifecycle_status: "archived" }, error: null }),
    relationship: async () => ({ data: link, error: null }),
    update: async (observed: DeactivationLink) => { writes++; assert.deepEqual(observed, link); return { data: [{ ...link, is_active: false }], error: null }; },
    refresh: () => { refreshes++; },
  };
  return { deps, writes: () => writes, refreshes: () => refreshes };
}

test("active link deactivates from either endpoint with confirmed returned row", async () => {
  for (const templateId of [parent, child]) {
    const fixture = setup();
    const result = await deactivateArchivedLink({ ...input, templateId }, fixture.deps);
    assert.equal(result.ok, true); assert.equal(result.code, "deactivated");
    assert.equal(fixture.writes(), 1); assert.equal(fixture.refreshes(), 1);
    assert.match(result.message, /separate confirmation/);
  }
});
test("unauthorized and invalid input never read or write", async () => {
  const fixture = setup();
  const denied = await deactivateArchivedLink(input, { ...fixture.deps, authorize: async () => { throw Error("Unauthorized"); }, template: async () => assert.fail("No read") });
  assert.equal(denied.code, "forbidden");
  assert.equal((await deactivateArchivedLink({ ...input, relationshipId: "bad" }, fixture.deps)).code, "invalid_input");
  assert.equal(fixture.writes(), 0);
});
test("archive requirement, membership, missing and inactive relationships fail without writes", async () => {
  const fixture = setup();
  assert.equal((await deactivateArchivedLink(input, { ...fixture.deps, template: async () => ({ data: { is_active: true, lifecycle_status: "active" }, error: null }) })).code, "not_archived");
  assert.equal((await deactivateArchivedLink({ ...input, templateId: id }, fixture.deps)).code, "wrong_relationship");
  assert.equal((await deactivateArchivedLink(input, { ...fixture.deps, relationship: async () => ({ data: null, error: null }) })).code, "not_found");
  assert.equal((await deactivateArchivedLink(input, { ...fixture.deps, relationship: async () => ({ data: { ...link, is_active: false }, error: null }) })).code, "stale");
  assert.equal(fixture.writes(), 0);
});
test("concurrent change or RLS no-op, malformed acknowledgement and transport errors never succeed", async () => {
  const fixture = setup();
  for (const data of [[], null, [{ ...link }], [{ ...link, id: parent, is_active: false }], [{ ...link, linked_template_id: id, is_active: false }], [{ ...link, is_active: false }, { ...link, is_active: false }]]) {
    assert.equal((await deactivateArchivedLink(input, { ...fixture.deps, update: async () => ({ data, error: null }) })).ok, false);
  }
  assert.equal((await deactivateArchivedLink(input, { ...fixture.deps, update: async () => ({ data: null, error: { code: "42501" } }) })).code, "forbidden");
  assert.equal((await deactivateArchivedLink(input, { ...fixture.deps, update: async () => { throw Error("Lost response"); } })).ok, false);
  assert.equal(fixture.refreshes(), 0);
});
test("cache refresh failure preserves confirmed result", async () => {
  const fixture = setup();
  const result = await deactivateArchivedLink(input, { ...fixture.deps, refresh: () => { throw Error("Cache unavailable"); } });
  assert.equal(result.ok, true); assert.match(result.message, /Refresh the archive/);
});
test("server adapter changes only active flag and conditions on observed version and both endpoints", () => {
  const source = readFileSync(new URL("../../app/products/templates/archived-link-actions.ts", import.meta.url), "utf8");
  assert.match(source, /update\(\{ is_active: false \}\)/);
  for (const column of ["id", "parent_template_id", "linked_template_id", "updated_at"]) assert.ok(source.includes(`.eq("${column}", link.${column})`));
  assert.match(source, /\.eq\("is_active", true\)/);
  assert.match(source, /canRemoveArchiveLinks\(profile\?\.role, profile\?\.account_status\)/);
  assert.doesNotMatch(source, /service_role|quotation_items|supplier_prices|\.delete\(/);
});
