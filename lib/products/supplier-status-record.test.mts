import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { keepSupplierStatus, newRecordSupplierStatus } from "./supplier-status-record";
import { settleSupplierPresentations } from "./supplier-presentation-timeout";

const status = { supplier_family_price_presentation: { label: "Price update available", tone: "warning", detail: "LAS — list" }, supplier_family_price_load_state: "loaded", supplier_family_price_loading: false };

test("a saved template keeps the Supplier status the page computed (the old 'No current price list' text must not come back after a save)", () => {
  const before = { id: "every", price: 0, ...status };
  const savedByServer = { id: "every", price: 5 }; // the server's copy has no Supplier fields
  const merged = keepSupplierStatus(savedByServer, before);
  assert.deepEqual(merged, { id: "every", price: 5, ...status });
  assert.equal(merged.price, 5, "the fresh server data is kept");
  // A legacy-only brand (presentation null) stays legacy: null is kept, not turned into something else.
  assert.equal((keepSupplierStatus({ id: "x" }, { ...status, supplier_family_price_presentation: null }) as Record<string, unknown>).supplier_family_price_presentation, null);
  // Pages that never compute the status are unchanged.
  assert.deepEqual(keepSupplierStatus({ id: "x", n: 1 }, { id: "x" }), { id: "x", n: 1 });
  assert.deepEqual(keepSupplierStatus({ id: "x" }, undefined), { id: "x" });
});

test("a new template in a page that computes the status is marked unavailable, never shown with the old text", () => {
  assert.equal((newRecordSupplierStatus({ id: "new" }, [{ id: "a", ...status }]) as Record<string, unknown>).supplier_family_price_load_state, "unavailable");
  assert.deepEqual(newRecordSupplierStatus({ id: "new" }, [{ id: "a" }]), { id: "new" }, "pages without a computed status are unchanged");
  assert.deepEqual(newRecordSupplierStatus({ id: "new" }, []), { id: "new" });
});

test("the selector keeps the status on update and on add, and shows the neutral message before the old text", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /template\.id === nextTemplate\.id \? keepSupplierStatus\(nextTemplate, template\) : template/);
  assert.match(selector, /\[\.\.\.current, newRecordSupplierStatus\(newTemplate, current\)\]/);
  const unavailable = selector.indexOf('template.supplier_family_price_load_state === "unavailable"');
  const legacy = selector.indexOf("const legacyHealth = friendlyPriceHealth(");
  assert.ok(unavailable > 0 && unavailable < legacy, "a failed status load shows 'Supplier price status unavailable' before the old price check text");
  assert.match(selector, /Supplier price status unavailable/);
  // The list badge and the detail view are the same component reading the same fields.
  assert.ok((selector.match(/<PriceCheckBadge /g) ?? []).length >= 3);
});

test("a failed or slow Supplier status load is reported as unavailable and logged, not hidden", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.deepEqual(await settleSupplierPresentations(Promise.reject(new Error("statement timeout")), 50), { supplierPresentations: null, supplierLoadState: "unavailable" });
    assert.deepEqual(await settleSupplierPresentations(new Promise<never>(() => undefined), 5), { supplierPresentations: null, supplierLoadState: "unavailable" });
    assert.deepEqual(await settleSupplierPresentations(Promise.resolve({ a: null }), 50), { supplierPresentations: { a: null }, supplierLoadState: "loaded" });
  } finally { console.error = original; }
  assert.equal(logged.length, 2, "only the two failures are logged");
  assert.match(String(logged[0][1]), /statement timeout/);
  assert.match(String(logged[1][1]), /timed out/);
});
