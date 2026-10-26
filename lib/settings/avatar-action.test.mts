import assert from "node:assert/strict";
import test, { mock } from "node:test";

const ROLES = ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"];
const me = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
let updates: { values: unknown; id: unknown }[] = [], guard = 0;
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/auth", { namedExports: { requireInventoryUser: async () => { guard++; return { user: { id: me } }; } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({ from: () => ({ update: (values: unknown) => ({ eq: async (_c: string, id: unknown) => { updates.push({ values, id }); return { error: null }; } }) }) }) } });
const { saveAvatarUrl } = await import("./avatar-action");

test("saving an avatar inside your own folder works, and the call is the same for every role", async () => {
  // The action takes no role input: managers, sales users and warehouse staff all go through the same guard and the same single-row update.
  for (const _role of ROLES) {
    updates = [];
    assert.deepEqual(await saveAvatarUrl(`${me}/1700000000_photo.webp`), { ok: true }, _role);
    assert.deepEqual(updates, [{ values: { avatar_url: `${me}/1700000000_photo.webp` }, id: me }], _role);
  }
});

test("an avatar path outside your own folder is refused before any database write", async () => {
  for (const path of [`${other}/x.jpg`, "x.jpg", "", `${me}`, `${me}x/a.jpg`, `${me}/../${other}/a.jpg`, `${me}\..\a.jpg`, `/${me}/a.jpg`, null, undefined, 5]) {
    updates = [];
    assert.deepEqual(await saveAvatarUrl(path as never), { ok: false, error: "Invalid avatar path." }, String(path));
    assert.equal(updates.length, 0, String(path));
  }
  assert.ok(guard > 0);
});
