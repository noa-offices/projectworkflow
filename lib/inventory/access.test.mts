import assert from "node:assert/strict";
import test from "node:test";
import { canViewInventory, canManageInventory, canSeeCosts, canSubmitHoldBook, canSubmitAddTake } from "./access";

test("all eight roles have the specified inventory capabilities", () => {
  const matrix = [
    ["system_owner", true, true, false, false],
    ["admin_manager", true, true, false, false],
    ["procurement_manager", false, false, true, false],
    ["sales_designer", false, false, true, false],
    ["sales_coordinator", false, false, true, false],
    ["designer", false, false, true, false],
    ["warehouse_staff", false, false, false, true],
    ["viewer", false, false, false, false],
  ] as const;
  for (const [role, manage, costs, holdBook, addTake] of matrix) {
    assert.equal(canViewInventory(role), true, role);
    assert.equal(canManageInventory(role), manage, role);
    assert.equal(canSeeCosts(role), costs, role);
    assert.equal(canSubmitHoldBook(role), holdBook, role);
    assert.equal(canSubmitAddTake(role), addTake, role);
  }
});

test("unknown or missing roles have no capabilities", () => {
  for (const role of [null, undefined, "", "worker", "SYSTEM_OWNER"]) {
    for (const check of [canViewInventory, canManageInventory, canSeeCosts, canSubmitHoldBook, canSubmitAddTake]) {
      assert.equal(check(role), false);
    }
  }
});
