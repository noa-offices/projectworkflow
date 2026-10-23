import assert from "node:assert/strict";
import test from "node:test";
import { activeUserRedirect } from "./auth-access.js";

test("active-user gate confines warehouse staff to inventory and preserves account-status checks", () => {
  assert.equal(activeUserRedirect({ role: "warehouse_staff", account_status: "active" }), "/inventory");
  assert.equal(activeUserRedirect({ role: "warehouse_staff", account_status: "active" }, true), null);
  for (const role of ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer"] as const) {
    assert.equal(activeUserRedirect({ role, account_status: "active" }), null);
    assert.equal(activeUserRedirect({ role, account_status: "active" }, true), null);
  }
  for (const inventoryAllowed of [false, true]) {
    assert.equal(activeUserRedirect({ role: "warehouse_staff", account_status: "pending" }, inventoryAllowed), "/pending-approval");
    assert.equal(activeUserRedirect({ role: "warehouse_staff", account_status: "disabled" }, inventoryAllowed), "/login?message=Your%20account%20has%20been%20disabled.");
    assert.equal(activeUserRedirect(null, inventoryAllowed), "/pending-approval");
  }
});
