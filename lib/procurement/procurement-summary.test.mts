// Reporting Task 2: cross-order Procurement aggregate summary. Real execution against a fake
// Supabase client (same mock.module() convention as vendor-progress-actions.test.mts) for the
// aggregation logic itself, plus source-text checks for the active-order scope contract with
// app/procurement/orders/page.tsx (a Server Component, not independently executable outside the
// Next.js build - matching every other *-safety.test.mts file's documented limitation here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

function makeThenable(result: unknown) {
  return { then: (resolve: (v: unknown) => void) => resolve(result) };
}

let poCountFixture = 0;
let progressRowsFixture: Array<{
  active_step: number;
  supplier_confirmed_at: string | null;
  receiving_status: string;
  eta: string | null;
  etd: string | null;
}> = [];
const DELIVERED_INSTALLED_STEP = 7;
const IN_TRANSIT_STEP_FIXTURE = 6;
const fromCalls: string[] = [];

mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    from: (table: string) => {
      fromCalls.push(table);
      if (table === "project_purchase_orders") {
        return { select: () => ({ in: () => makeThenable({ count: poCountFixture, error: null }) }) };
      }
      if (table === "procurement_vendor_progress") {
        return { select: () => ({ in: () => ({ returns: () => makeThenable({ data: progressRowsFixture, error: null }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
} });

const { loadProcurementSummary } = await import("./procurement-summary");

function reset() {
  poCountFixture = 0;
  progressRowsFixture = [];
  fromCalls.length = 0;
}

// ── FIXTURE-BASED AGGREGATION TESTS ──────────────────────────────────────────────────────────

test("1. no active orders -> all zero, no query issued (short-circuits before any fake table call)", async () => {
  reset();
  assert.deepEqual(await loadProcurementSummary([]), {
    openPoCount: 0,
    vendorCount: 0,
    awaitingConfirmationCount: 0,
    inTransitCount: 0,
    receiving: { pending: 0, partial: 0, received: 0 },
    missingEtaCount: 0,
    missingEtdCount: 0,
    deliveredNotReceivedCount: 0,
    awaitingConfirmationItems: [],
    missingEtaItems: [],
    missingEtdItems: [],
    deliveredNotReceivedItems: [],
  });
  assert.equal(fromCalls.length, 0);
});

test("2/3. open PO count reflects the actual PO-row count, not order-folder count", async () => {
  reset();
  poCountFixture = 7;
  const summary = await loadProcurementSummary(["CO-0001", "CO-0002"]);
  assert.equal(summary.openPoCount, 7);
});

test("4/5. awaiting confirmation counts only rows with a null supplier_confirmed_at", async () => {
  reset();
  progressRowsFixture = [
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
    { active_step: 1, supplier_confirmed_at: "2026-01-01T00:00:00Z", receiving_status: "pending", eta: null, etd: null },
    { active_step: 1, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
  ];
  const summary = await loadProcurementSummary(["CO-0001"]);
  assert.equal(summary.vendorCount, 3);
  assert.equal(summary.awaitingConfirmationCount, 2);
});

test("6. in_transit count uses the canonical step index (6), not ready_for_shipment (5)", async () => {
  reset();
  progressRowsFixture = [
    { active_step: 6, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
    { active_step: 5, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
    { active_step: 6, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
  ];
  const summary = await loadProcurementSummary(["CO-0001"]);
  assert.equal(summary.inTransitCount, 2);
});

test("7/8/9. receiving distribution counts pending/partial/received independently", async () => {
  reset();
  progressRowsFixture = [
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "partial", eta: null, etd: null },
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "received", eta: null, etd: null },
  ];
  const summary = await loadProcurementSummary(["CO-0001"]);
  assert.deepEqual(summary.receiving, { pending: 2, partial: 1, received: 1 });
});

test("10/11. missing ETA and missing ETD are counted independently", async () => {
  reset();
  progressRowsFixture = [
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: "2026-10-01" },
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: "2026-10-15", etd: null },
    { active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
  ];
  const summary = await loadProcurementSummary(["CO-0001"]);
  assert.equal(summary.missingEtaCount, 2);
  assert.equal(summary.missingEtdCount, 2);
});

test("17/18. delivered-not-received counts only delivered_installed vendors whose receiving isn't 'received', using the canonical step index", async () => {
  reset();
  progressRowsFixture = [
    { active_step: DELIVERED_INSTALLED_STEP, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
    { active_step: DELIVERED_INSTALLED_STEP, supplier_confirmed_at: null, receiving_status: "partial", eta: null, etd: null },
    { active_step: DELIVERED_INSTALLED_STEP, supplier_confirmed_at: null, receiving_status: "received", eta: null, etd: null },
    { active_step: IN_TRANSIT_STEP_FIXTURE, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null },
  ];
  const summary = await loadProcurementSummary(["CO-0001"]);
  assert.equal(summary.deliveredNotReceivedCount, 2);
});

test("19/20. attention item rows are bounded to 5 even when far more rows match, and carry orderNo/vendorKey only", async () => {
  reset();
  progressRowsFixture = Array.from({ length: 9 }, () => ({
    active_step: 0,
    supplier_confirmed_at: null,
    receiving_status: "pending",
    eta: null,
    etd: null,
  })) as never;
  // Attach order_no/vendor_key via a locally-typed fixture (the shared fixture type above omits
  // them to keep the existing count-only tests simple) - this is the one test that needs them.
  const rowsWithIdentity = progressRowsFixture.map((row, i) => ({ ...row, order_no: `CO-000${i}`, vendor_key: `vendor-${i}` }));
  progressRowsFixture = rowsWithIdentity as never;
  const summary = await loadProcurementSummary(["CO-0000"]);
  assert.equal(summary.awaitingConfirmationCount, 9);
  assert.equal(summary.awaitingConfirmationItems.length, 5);
  assert.deepEqual(summary.awaitingConfirmationItems[0], { orderNo: "CO-0000", vendorKey: "vendor-0" });
});

test("15. exactly two bounded queries (one per table) - no per-order loop", async () => {
  reset();
  poCountFixture = 1;
  progressRowsFixture = [{ active_step: 0, supplier_confirmed_at: null, receiving_status: "pending", eta: null, etd: null }];
  await loadProcurementSummary(["CO-0001", "CO-0002", "CO-0003"]);
  assert.deepEqual(fromCalls.sort(), ["procurement_vendor_progress", "project_purchase_orders"]);
});

// ── SOURCE-TEXT CONTRACT WITH THE PAGE (active-order scope, dedup, authorization) ──────────────

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const pageSource = normalize(readFileSync("app/procurement/orders/page.tsx", "utf8"));
const summarySource = normalize(readFileSync("lib/procurement/procurement-summary.ts", "utf8"));

test("12/13/14. summary consumes the already-filtered, deduped orders array - completed/cancelled excluded upstream, dedup preserved", () => {
  const completedFilterIndex = pageSource.indexOf('if (typeof settings?.projectCompletedAt === "string") return [];');
  const cancelledFilterIndex = pageSource.indexOf('if (typeof settings?.projectCancelledAt === "string") return [];');
  const dedupIndex = pageSource.indexOf("all.findIndex((o) => o.orderNo === order.orderNo) === index");
  const ordersBuiltIndex = pageSource.indexOf("const orders = projectFiles.map((order) => ({");
  const summaryCallIndex = pageSource.indexOf("loadProcurementSummary(orders.map((order) => order.orderNo))");

  assert.ok(completedFilterIndex !== -1 && completedFilterIndex < dedupIndex);
  assert.ok(cancelledFilterIndex !== -1 && cancelledFilterIndex < dedupIndex);
  assert.ok(dedupIndex !== -1 && dedupIndex < ordersBuiltIndex);
  assert.ok(ordersBuiltIndex !== -1 && ordersBuiltIndex < summaryCallIndex);
  assert.ok(summaryCallIndex !== -1, "summary must be derived from the already-filtered/deduped `orders` array");
});

test("16. authorization gate is unchanged and runs before the summary is computed", () => {
  const redirectIndex = pageSource.indexOf('redirect("/dashboard?message=You+do+not+have+permission+to+access+the+Procurement+Workspace.");');
  const summaryCallIndex = pageSource.indexOf("loadProcurementSummary(orders.map((order) => order.orderNo))");
  assert.ok(redirectIndex !== -1 && redirectIndex < summaryCallIndex);
  // The loader itself issues no auth check/redirect of its own - it is not a Server Action and
  // is only ever imported by this already-gated page, never by a client component.
  assert.ok(!summarySource.includes('"use server"'));
  assert.ok(!summarySource.includes("requireActiveUser"));
});
