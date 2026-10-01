// Maturity audit Parts 1 & 5: PO generation audit logging + race/duplicate hardening. Real
// execution against a fake supabase client + audit log (same mock.module() convention already
// established in vendor-progress-actions.test.mts).
import assert from "node:assert/strict";
import test, { mock } from "node:test";

let role: string | null = "procurement_manager";
let poCount = 0;
let insertedRows: Array<Record<string, unknown>> = [];
const auditCalls: Array<Record<string, unknown>> = [];
let insertErrorQueue: Array<{ code?: string; message?: string } | null> = [];

mock.module("@/lib/audit-log", { namedExports: {
  createAuditLog: async (_client: unknown, input: Record<string, unknown>) => { auditCalls.push(input); return true; },
} });
mock.module("@/lib/supabase/server", { namedExports: {
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role, account_status: "active" } }) }) }),
        };
      }
      assert.equal(table, "project_purchase_orders");
      return {
        select: () => ({ eq: () => ({ then: (resolve: (v: unknown) => void) => resolve({ count: poCount, error: null }) }) }),
        insert: (payload: Record<string, unknown>) => {
          const error = insertErrorQueue.shift() ?? null;
          if (!error) { insertedRows.push(payload); poCount += 1; }
          return { then: (resolve: (v: unknown) => void) => resolve({ error }) };
        },
      };
    },
  }),
} });

const { generatePoAction } = await import("./generate-po-action");

function reset() {
  role = "procurement_manager";
  poCount = 0;
  insertedRows = [];
  insertErrorQueue = [];
  auditCalls.length = 0;
}

const itemsSnapshot = [{ id: "i1", item_name_snapshot: "Item", item_code_snapshot: "C1", brand_name_snapshot: "B", size_snapshot: null, finish_snapshot: null, qty: 1, net_total: 100 }];

test("1. successful PO generation logs an audit entry", async () => {
  reset();
  const result = await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  assert.deepEqual(result, { ok: true, poNumber: "PO-0001-001" });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "po_generated");
  assert.deepEqual(auditCalls[0].metadata, { orderNo: "CO-0001-001", vendorKey: "acme", vendorLabel: "Acme Co", poNumber: "PO-0001-001" });
});

test("2. a failed (non-conflict) insert does not emit a success audit", async () => {
  reset();
  insertErrorQueue = [{ code: "42P01", message: "boom" }];
  const result = await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  assert.equal(result.ok, false);
  assert.equal(auditCalls.length, 0);
  assert.equal(insertedRows.length, 0);
});

test("3. audit payload never includes items_snapshot or prices", async () => {
  reset();
  await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  const metadataJson = JSON.stringify(auditCalls[0].metadata);
  assert.ok(!metadataJson.includes("items_snapshot"));
  assert.ok(!metadataJson.includes("net_total"));
  assert.ok(!metadataJson.includes("100"));
});

test("16. a single unique-constraint (23505) conflict is retried and still succeeds with no duplicate audit", async () => {
  reset();
  insertErrorQueue = [{ code: "23505", message: "duplicate key" }];
  const result = await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  assert.equal(result.ok, true);
  assert.equal(insertedRows.length, 1);
  assert.equal(auditCalls.length, 1);
});

test("17. repeated unique-constraint conflicts return a clear deterministic message, no audit", async () => {
  reset();
  insertErrorQueue = [{ code: "23505" }, { code: "23505" }, { code: "23505" }];
  const result = await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  assert.deepEqual(result, { ok: false, error: "Another PO was generated for this order at the same time. Please try again." });
  assert.equal(auditCalls.length, 0);
});

test("18. existing valid single-call PO generation is unchanged (format, authorization)", async () => {
  reset();
  poCount = 2;
  const result = await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  assert.deepEqual(result, { ok: true, poNumber: "PO-0001-003" });

  reset();
  role = "sales_designer";
  const forbidden = await generatePoAction("CO-0001-001", "q-1", "acme", "Acme Co", itemsSnapshot);
  assert.deepEqual(forbidden, { ok: false, error: "Forbidden." });
  assert.equal(auditCalls.length, 0);
});
