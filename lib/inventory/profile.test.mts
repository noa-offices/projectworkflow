import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activeUserRedirect } from "../auth-access";
import { isInventoryPath, notificationsHref, profileDisplayName, profileHref, profileRoleLabel, showFullProfileLink, validatePasswordChange, validateProfileInput } from "./profile";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("name and phone validation", () => {
  assert.deepEqual(validateProfileInput({ fullName: "  Amal   Khan ", phone: " +971 50 123 4567 " }), { ok: true, value: { fullName: "Amal Khan", phone: "+971 50 123 4567" } });
  assert.deepEqual(validateProfileInput({ fullName: "Amal", phone: "" }), { ok: true, value: { fullName: "Amal", phone: null } });
  for (const fullName of ["", "   ", "a@b.com", "x".repeat(101), null, 5]) assert.ok(validateProfileInput({ fullName, phone: "" }).ok === false, String(fullName));
  for (const phone of ["12345", "abc", "+971 50 123 4567 ext 9", "1".repeat(16), "+".repeat(31), "<script>"]) {
    const result = validateProfileInput({ fullName: "Amal", phone });
    assert.ok(!result.ok && result.errors.phone, phone);
  }
});

test("password validation uses the reset-password rules: required, 8 characters, must match", () => {
  assert.deepEqual(validatePasswordChange({ password: "longenough", confirmPassword: "longenough" }), { ok: true });
  const tooShort = validatePasswordChange({ password: "short", confirmPassword: "short" });
  assert.ok(!tooShort.ok && tooShort.errors.password && !tooShort.errors.confirmPassword);
  const mismatch = validatePasswordChange({ password: "longenough", confirmPassword: "different1" });
  assert.ok(!mismatch.ok && mismatch.errors.confirmPassword && !mismatch.errors.password);
  const empty = validatePasswordChange({ password: "", confirmPassword: "" });
  assert.ok(!empty.ok && empty.errors.password && empty.errors.confirmPassword);
  for (const bad of [undefined, null, 12345678]) assert.ok(!validatePasswordChange({ password: bad, confirmPassword: bad }).ok);
  assert.doesNotMatch(JSON.stringify(mismatch), /longenough|different1/, "messages never echo passwords");
});

test("names and roles follow the Task 12 rules", () => {
  assert.equal(profileDisplayName("Junais KP"), "Junais KP");
  for (const name of [null, undefined, "", "  ", "me@example.com", "Unknown"]) assert.equal(profileDisplayName(name), "Team member");
  assert.equal(profileRoleLabel("warehouse_staff"), "Warehouse Staff");
  assert.equal(profileRoleLabel("sales_designer"), "Sales Manager");
});

test("profile and notification links stay inside Inventory, and only non-warehouse roles get the full profile link", () => {
  assert.equal(profileHref("/inventory"), "/inventory/profile");
  assert.equal(profileHref("/inventory/products/1"), "/inventory/profile");
  assert.equal(profileHref("/dashboard"), "/settings/profile");
  assert.equal(profileHref("/inventoryx"), "/settings/profile");
  assert.equal(notificationsHref("/inventory/profile"), "/inventory/notifications");
  assert.equal(notificationsHref("/projects"), "/notifications");
  assert.equal(isInventoryPath(null), false);
  assert.equal(showFullProfileLink("warehouse_staff"), false);
  for (const role of ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer"] as const) assert.equal(showFullProfileLink(role), true, role);
});

test("access lock: warehouse staff reach /inventory/** pages only; everything else still redirects them", () => {
  const warehouse = { role: "warehouse_staff", account_status: "active" } as const;
  // The Inventory guard allows them; the normal guard sends them back to /inventory.
  assert.equal(activeUserRedirect(warehouse, true), null);
  assert.equal(activeUserRedirect(warehouse), "/inventory");
  for (const status of ["pending", "disabled"] as const) assert.notEqual(activeUserRedirect({ role: "warehouse_staff", account_status: status }, true), null);

  const guardOf = (path: string) => /requireInventoryUser\(\)/.test(source(path)) && !/requireActiveUser\(\)/.test(source(path)) ? "inventory" : /requireActiveUser\(\)/.test(source(path)) ? "active" : "none";
  assert.equal(guardOf("app/inventory/profile/page.tsx"), "inventory");
  assert.equal(guardOf("app/inventory/notifications/page.tsx"), "inventory");
  assert.match(source("app/inventory/layout.tsx"), /requireInventoryUser\(\)/);
  for (const path of ["app/settings/profile/page.tsx", "app/dashboard/page.tsx", "app/notifications/page.tsx"]) assert.equal(guardOf(path), "active", `${path} must keep redirecting warehouse staff`);

  // Profile server actions use the Inventory guard and touch only the caller's own row.
  const actions = source("lib/inventory/profile-actions.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(actions, /requireActiveUser/);
  assert.match(actions, /\.eq\("id", user\.id\)/);
  assert.doesNotMatch(actions, /\brole\b\s*:|account_status|permissions/, "role, status and permissions are never written");
  assert.doesNotMatch(actions, /console\.|logServerActionError\([^)]*password/i);

  // The warehouse menu lists only Inventory pages.
  const menu = source("components/layout/erp-sidebar.tsx").match(/role === "warehouse_staff"\) \{\s*return \[\{[\s\S]*?items: \[([\s\S]*?)\],\s*\}\];/)?.[1] ?? "";
  assert.ok(menu.includes("INVENTORY_PROFILE_PATH") && menu.includes("INVENTORY_NOTIFICATIONS_PATH"));
  assert.doesNotMatch(menu, /"\/(?!inventory)[a-z]/, "warehouse menu must not link outside Inventory");
});
