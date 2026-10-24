import assert from "node:assert/strict";
import test from "node:test";
import { actionFields, actionHistoryLabel, canUseManagerMovements, fromChoices, movementPayload, movementRoute, previewMovement, previewText, toPickerProduct } from "./movement-form";
import { hasMovementFilters, movementsHref, parseMovementParams } from "./movement-history";
import { categoryNameError, categorySiblings } from "./category-form";
import { lookupText, requestSearchFilter } from "./filters";
import { withCategoryCounts } from "./mapping";
import { parseRequestParams } from "./request-presentation";
import { movementInput } from "./action-validation";
import { previewProduct, previewCategories } from "./preview-data";

const stock = { warehouse_quantity: 10, dubai_showroom_quantity: 1, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 5, quantity: 11, reserved_quantity: 3, available_quantity: 8 };
const run = (action: string, from: string, to: string, quantity: string) => previewMovement(stock, { action: action as never, from, to, quantity });
const id = "11111111-1111-4111-8111-111111111111";

test("only System Owner and Admin Manager can use manager movements", () => {
  for (const role of ["system_owner", "admin_manager"]) assert.equal(canUseManagerMovements(role), true);
  for (const role of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff", "unknown", "", null, undefined]) assert.equal(canUseManagerMovements(role), false);
});
test("preview math: receive stock adds to Warehouse", () => {
  const preview = run("receive_stock", "", "", "4");
  assert.equal(preview.error, null);
  assert.deepEqual(preview.rows, [{ location: "warehouse", label: "Warehouse", before: 10, after: 14 }]);
  assert.deepEqual([preview.totalBefore, preview.totalAfter], [11, 15]);
});
test("preview math: move between locations shows both ends", () => {
  const preview = run("internal_transfer", "warehouse", "dubai_showroom", "3");
  assert.equal(previewText(preview), "Warehouse 10 → 7, Dubai Showroom 1 → 4");
  assert.deepEqual([preview.totalBefore, preview.totalAfter], [11, 11]);
});
test("preview math: return to warehouse brings stock back from another location", () => {
  const preview = run("return_to_warehouse", "dubai_showroom", "", "1");
  assert.equal(previewText(preview), "Warehouse 10 → 11, Dubai Showroom 1 → 0");
  assert.deepEqual(fromChoices("return_to_warehouse").includes("warehouse" as never), false);
});
test("preview math: sale moves stock to Sold and lowers the live total", () => {
  const preview = run("sale", "warehouse", "", "2");
  assert.equal(previewText(preview), "Warehouse 10 → 8, Sold 5 → 7");
  assert.deepEqual([preview.totalBefore, preview.totalAfter], [11, 9]);
});
test("preview math: adjust sets Warehouse and clears the other live locations, as the database does", () => {
  const preview = run("adjustment", "", "", "6");
  assert.equal(previewText(preview), "Warehouse 10 → 6, Dubai Showroom 1 → 0");
  assert.deepEqual([preview.totalBefore, preview.totalAfter], [11, 6]);
  assert.equal(run("adjustment", "", "", "0").error, "Release reservations first.");
  assert.equal(run("adjustment", "", "", "3").error, null);
});
test("Save is blocked when the number is more than available or the form is incomplete", () => {
  const over = run("sale", "warehouse", "", "9");
  assert.equal(over.blocked, true); assert.equal(over.error, "Only 8 units are available; 3 are reserved.");
  assert.equal(run("internal_transfer", "warehouse", "dubai_showroom", "9").error, "Only 8 units are available; 3 are reserved.");
  assert.equal(run("internal_transfer", "mockup", "warehouse", "1").error, "Only 0 units are in Mockup.");
  assert.equal(run("internal_transfer", "warehouse", "warehouse", "1").blocked, true);
  for (const quantity of ["", "0", "-1", "1.5", "abc", "99999999999"]) assert.equal(run("sale", "warehouse", "", quantity).blocked, true, quantity);
  assert.equal(run("sale", "", "", "1").blocked, true);
  assert.equal(run("sale", "warehouse", "", "8").blocked, false);
});
test("the payload matches what the server action accepts for every action", () => {
  for (const [action, from, to] of [["receive_stock", "", ""], ["internal_transfer", "warehouse", "dubai_showroom"], ["return_to_warehouse", "dubai_showroom", ""], ["sale", "warehouse", ""], ["adjustment", "", ""]] as const) {
    const payload = movementPayload(id, { action, from, to, quantity: "2", note: "  hello " });
    const parsed = movementInput(payload);
    assert.equal(parsed.action_type, action); assert.equal(parsed.quantity, 2); assert.equal(parsed.note, "hello");
  }
  assert.deepEqual(actionFields("sale"), { from: true, to: false, fixedTo: "sold" });
  assert.equal(movementInput(movementPayload(id, { action: "adjustment", from: "", to: "", quantity: "0" })).quantity, 0);
});
test("product picker rows never carry costs or prices", () => {
  const picked = toPickerProduct({ ...previewProduct, costs: { price: 1, freight_cost: 1, c_and_f: 1, transport: 1, custom_duty: 1, labour: 1, vat: 1, total_cost: 7 } } as never);
  assert.equal("costs" in picked, false);
  assert.doesNotMatch(JSON.stringify(picked), /price|cost|vat|labour/i);
  assert.equal(picked.reserved_quantity, previewProduct.reserved_quantity);
});
test("history labels and routes are plain words", () => {
  assert.deepEqual(["receive_stock", "internal_transfer", "return_to_warehouse", "sale", "adjustment"].map(actionHistoryLabel), ["Received", "Moved", "Returned", "Sold", "Adjusted"]);
  assert.equal(movementRoute({ from_location: null, to_location: "warehouse" }), "— → Warehouse");
  assert.equal(movementRoute({ from_location: "warehouse", to_location: "sold" }), "Warehouse → Sold");
});
test("movement history filters come from the URL and unknown values are dropped", () => {
  const { state, filters, page } = parseMovementParams({ q: " chair ", action: "sale", location: "warehouse", from: "2026-10-01", to: "2026-10-31", person: "Alex", product: id.toUpperCase(), page: "3" });
  assert.deepEqual(state, { q: "chair", action: "sale", location: "warehouse", from: "2026-10-01", to: "2026-10-31", person: "Alex", product: id, page: 3 });
  assert.deepEqual(filters, { search: "chair", person: "Alex", action_type: "sale", location: "warehouse", product_id: id, from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z" });
  assert.equal(page, 3);
  const bad = parseMovementParams({ action: "steal", location: "moon", from: "2026-02-31", to: "nonsense", product: "x", page: "0" });
  assert.deepEqual([bad.state.action, bad.state.location, bad.state.from, bad.state.to, bad.state.product, bad.state.page], ["", "", "", "", "", 1]);
  assert.equal(hasMovementFilters(bad.state), false);
  assert.equal(parseMovementParams({ from: "2026-10-10", to: "2026-10-01" }).state.to, "");
  assert.equal(movementsHref(state), `/inventory/movements?q=chair&action=sale&location=warehouse&from=2026-10-01&to=2026-10-31&person=Alex&product=${id}&page=3`);
  assert.equal(movementsHref(state, { page: 1, product: "" }).includes("product"), false);
});
test("category names are validated and duplicates are caught per level", () => {
  const tree = withCategoryCounts(previewCategories, [{ category_id: previewCategories[0].id, subcategory_id: previewCategories[0].children[0].id }, { category_id: previewCategories[0].id, subcategory_id: null }]);
  assert.equal(categoryNameError("", tree), "Enter a name.");
  assert.equal(categoryNameError("   ", tree), "Enter a name.");
  assert.match(categoryNameError("x".repeat(201), tree)!, /under 200/);
  assert.match(categoryNameError(" chairs ", tree)!, /already exists/);
  assert.equal(categoryNameError("Chairs", tree, previewCategories[0].id), null);
  assert.equal(categoryNameError("Desks", tree), null);
  assert.equal(categoryNameError("Task chairs", categorySiblings(tree, null)), null);
  assert.match(categoryNameError("task chairs", categorySiblings(tree, previewCategories[0].id))!, /already exists/);
  assert.deepEqual([tree[0].item_count, tree[0].children[0].item_count], [2, 1]);
});
test("request search text is bounded and safe, and only managers get person matches", () => {
  assert.equal(lookupText("  a%b_c,d(e)f  "), "a b c d e f");
  assert.equal(lookupText("   "), null);
  assert.equal(lookupText("x".repeat(300))!.length, 100);
  assert.equal(requestSearchFilter(null, []), null);
  assert.equal(requestSearchFilter("item_name.ilike.x", []), "item_name.ilike.x");
  assert.equal(requestSearchFilter("item_name.ilike.x", ["u1", "u2"]), "item_name.ilike.x,submitted_by.in.(u1,u2)");
  assert.equal(requestSearchFilter(null, ["u1"]), "submitted_by.in.(u1)");
  assert.equal(parseRequestParams({ q: "  chair  ", tab: "movements", status: "all" }, true).q, "chair");
  assert.equal(parseRequestParams({ q: ["a", "b"] }, false).q, "a");
  assert.equal(parseRequestParams({ q: "x".repeat(300) }, false).q.length, 100);
});
