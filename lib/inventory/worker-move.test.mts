import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { moveRequestAccess, WORKER_MOVE_PATH } from "./request-presentation";
import { defaultFromLocation, sendWorkerRequest, workerToLocation } from "./worker-move";
import type { MovementPickerProduct } from "./types";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const item: MovementPickerProduct = {
  id: "44444444-4444-4444-8444-444444444444", item_name: "Arlo chair", stock_ref: "02-0001", item_code: null, model_name: null,
  quantity: 8, reserved_quantity: 2, available_quantity: 6, main_image_url: null,
  warehouse_quantity: 5, dubai_showroom_quantity: 3, abudhabi_showroom_quantity: 0, mockup_quantity: 0, temporary_out_quantity: 0, sold_quantity: 0,
};
const draft = { kind: "take" as const, from: "warehouse", to: "dubai_showroom", quantity: "1", note: "" };

test("only Warehouse Staff use the worker page; managers go to Move stock; everyone else goes back to Inventory", () => {
  assert.equal(moveRequestAccess("warehouse_staff"), "worker");
  for (const role of ["system_owner", "admin_manager"]) assert.equal(moveRequestAccess(role), "manager", role);
  for (const role of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "unknown", "", null, undefined]) assert.equal(moveRequestAccess(role), "none", String(role));
  assert.equal(WORKER_MOVE_PATH, "/inventory/request-move");
});

test("the page and its search action keep the access lock and send other roles away without a loop", () => {
  const page = source("app/inventory/request-move/page.tsx");
  assert.match(page, /requireInventoryUser\(\)/);
  assert.doesNotMatch(page, /requireActiveUser/);
  assert.match(page, /access === "manager"\) redirect\(.*\/inventory\/move/);
  assert.match(page, /access === "none"\) redirect\("\/inventory"\)/);
  assert.doesNotMatch(page, /redirect\("\/inventory\/request-move/);
  const actions = source("lib/inventory/actions.ts");
  assert.match(actions, /export async function searchRequestProducts[\s\S]*?canSubmitAddTake\(profile\?\.role\)\) return denied\(\)/);
  // No costs or prices on the worker screens.
  for (const file of ["components/inventory/worker-move-request.tsx", "lib/inventory/worker-move.ts", "app/inventory/request-move/page.tsx"]) assert.doesNotMatch(source(file), /cost|price|freight|vat/i, file);
});

test("available stock excludes reserved units and a quantity over it is refused without calling the request function", async () => {
  let calls = 0;
  const submit = async () => { calls++; return { ok: true as const }; };
  // warehouse has 5 but only 6 are available overall; the location limit is min(5, 6) = 5.
  const over = await sendWorkerRequest(item, { ...draft, quantity: "6" }, submit);
  assert.deepEqual(over, { ok: false, error: "Only 5 units are available in Warehouse; 2 units are reserved across locations." });
  const reserved = { ...item, warehouse_quantity: 5, reserved_quantity: 4, available_quantity: 2 };
  assert.deepEqual(await sendWorkerRequest(reserved, { ...draft, quantity: "3" }, submit), { ok: false, error: "Only 2 units are available in Warehouse; 4 units are reserved across locations." });
  for (const quantity of ["", "0", "-1", "1.5", "abc"]) assert.equal((await sendWorkerRequest(item, { ...draft, quantity }, submit)).ok, false, quantity);
  assert.equal(calls, 0);
});

test("a valid take sends one pending request through the existing request function", async () => {
  const sent: unknown[] = [];
  const result = await sendWorkerRequest(item, { ...draft, quantity: "3", note: "For the Marina office" }, async payload => { sent.push(payload); return { ok: true }; });
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { productId: item.id, requestType: "take", actionType: "sale", quantity: 3, fromLocation: "warehouse", toLocation: "sold", note: "For the Marina office", projectId: null, referenceNote: null, expiresAt: null });
});

test("a move keeps From and To different, and the server's refusal is shown as is", async () => {
  const sent: Record<string, unknown>[] = [];
  await sendWorkerRequest(item, { ...draft, kind: "move", from: "warehouse", to: "warehouse", quantity: "2" }, async payload => { sent.push(payload); return { ok: true }; });
  assert.equal(sent[0].requestType, "move");
  assert.equal(sent[0].actionType, "internal_transfer");
  assert.notEqual(sent[0].toLocation, sent[0].fromLocation);
  assert.deepEqual(await sendWorkerRequest(item, draft, async () => ({ ok: false, error: "You do not have permission to do that." })), { ok: false, error: "You do not have permission to do that." });
  assert.equal(workerToLocation(item, "warehouse", "dubai_showroom"), "dubai_showroom");
});

test("the form starts on a location that has stock", () => {
  assert.equal(defaultFromLocation(item), "warehouse");
  assert.equal(defaultFromLocation({ ...item, warehouse_quantity: 0 }), "dubai_showroom");
  assert.equal(defaultFromLocation({ ...item, warehouse_quantity: 0, dubai_showroom_quantity: 0 }), "warehouse");
});
