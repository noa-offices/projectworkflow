// Procurement Task 1: supplier confirmation + simple vendor-level receiving status. Real
// execution against a fake admin client/audit log (same mock.module() convention already
// established in lib/noa's own *.test.mts suite) for the actual behavioral rules, plus focused
// source-text checks for cross-page parity and untouched regression surfaces (pages/components
// aren't independently executable outside the Next.js build, matching every other *-safety.test.mts
// file's own documented limitation in this repo).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { nextVendorReceivedAt, isVendorReceivingStatus, RECEIVING_STATUSES, VENDOR_STEP_LABELS } from "./vendor-steps";

// ── PURE HELPERS (real execution, no mocking needed) ────────────────────────────────────────

test("nextVendorReceivedAt: only 'received' ever carries a timestamp; moving away always clears it", () => {
  const fixedNow = () => "2026-01-01T00:00:00.000Z";
  assert.equal(nextVendorReceivedAt("pending", null, fixedNow), null);
  assert.equal(nextVendorReceivedAt("partial", null, fixedNow), null);
  assert.equal(nextVendorReceivedAt("received", null, fixedNow), "2026-01-01T00:00:00.000Z");
  // Re-saving "received" preserves the original timestamp - never resets the clock.
  assert.equal(nextVendorReceivedAt("received", "2025-06-01T00:00:00.000Z", fixedNow), "2025-06-01T00:00:00.000Z");
  // Moving away from "received" (even with a prior timestamp) always clears it - never stale.
  assert.equal(nextVendorReceivedAt("partial", "2025-06-01T00:00:00.000Z", fixedNow), null);
  assert.equal(nextVendorReceivedAt("pending", "2025-06-01T00:00:00.000Z", fixedNow), null);
});

test("isVendorReceivingStatus: closed set only", () => {
  for (const status of RECEIVING_STATUSES) assert.equal(isVendorReceivingStatus(status), true);
  assert.equal(isVendorReceivingStatus("shipped"), false);
  assert.equal(isVendorReceivingStatus(""), false);
});

test("PO Issued step exists in the untouched 8-step sequence (regression 15)", () => {
  assert.deepEqual(VENDOR_STEP_LABELS.map((s) => s.key), [
    "rfq", "po_issued", "deposit_paid", "in_production", "quality_check", "ready_for_shipment", "in_transit", "delivered_installed",
  ]);
});

// ── ACTION EXECUTION (real, against a fake admin client + audit log) ───────────────────────

mock.module("server-only", { defaultExport: {} });
let role: string | null = "procurement_manager";
let row: Record<string, unknown> | null = null;
const upserts: Array<Record<string, unknown>> = [];
const auditCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role, account_status: "active" }, displayName: "Fixture User" }),
} });
mock.module("@/lib/audit-log", { namedExports: {
  createAuditLog: async (_client: unknown, input: Record<string, unknown>) => { auditCalls.push(input); },
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({}) } });
mock.module("@/lib/supabase/admin", { namedExports: {
  createAdminClient: () => ({
    error: null,
    client: {
      from: (table: string) => {
        assert.equal(table, "procurement_vendor_progress");
        const builder = {
          select: () => builder,
          eq: () => builder,
          async maybeSingle() { return { data: row, error: null }; },
          upsert: (payload: Record<string, unknown>) => {
            upserts.push(payload);
            row = { ...(row ?? {}), ...payload };
            return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
          },
        };
        return builder;
      },
    },
  }),
} });

const { saveVendorProgress, setVendorSupplierConfirmation, setVendorReceivingStatus } = await import("./vendor-docs-action");

function reset() {
  role = "procurement_manager";
  row = null;
  upserts.length = 0;
  auditCalls.length = 0;
}

test("ETA/ETD valid ISO values survive saves independently, and blanks/null clear", async () => {
  reset();
  for (const [etd, eta] of [["2026-10-01", "2026-10-15"], [null, "2026-10-15"], ["2026-10-01", null], ["", ""], [null, null]]) {
    assert.deepEqual(await saveVendorProgress("CO-0001-001", "acme", 2, etd, eta), { ok: true });
    assert.equal(upserts.at(-1)!.etd, etd || null);
    assert.equal(upserts.at(-1)!.eta, eta || null);
    assert.equal(upserts.at(-1)!.active_step, 2);
  }
  const audits = auditCalls.length;
  await saveVendorProgress("CO-0001-001", "acme", 2, null, null);
  assert.equal(auditCalls.length, audits); // unchanged no-op audit semantics
});

test("ETA/ETD invalid input rejects the entire save without writes or audit", async () => {
  for (const invalid of ["2026-02-30", "15/10/2026", "tomorrow", "2026-1-1"]) {
    for (const [etd, eta] of [[invalid, "2026-10-15"], ["2026-10-01", invalid]]) {
      reset();
      assert.deepEqual(await saveVendorProgress("CO-0001-001", "acme", 2, etd, eta), { ok: false, error: "ETA and ETD must be valid dates in YYYY-MM-DD format, or blank." });
      assert.equal(upserts.length, 0); assert.equal(auditCalls.length, 0);
    }
  }
});

test("ETA/ETD retain role authorization before validation", async () => {
  for (const allowed of ["system_owner", "admin_manager", "procurement_manager"]) {
    reset(); role = allowed;
    assert.deepEqual(await saveVendorProgress("CO-0001-001", "acme", 2, "", ""), { ok: true });
  }
  reset(); role = "sales_designer";
  assert.deepEqual(await saveVendorProgress("CO-0001-001", "acme", 2, "invalid", ""), { ok: false, error: "Forbidden." });
  assert.equal(upserts.length, 0);
});

// SUPPLIER CONFIRMATION -------------------------------------------------------------------

test("1. default/unset row has no confirmation", async () => {
  reset();
  assert.equal(row?.supplier_confirmed_at, undefined);
});

test("2. confirm action writes a timestamp and actor, independent of active_step", async () => {
  reset();
  const result = await setVendorSupplierConfirmation("CO-0001-001", "acme", true);
  assert.deepEqual(result, { ok: true });
  const payload = upserts.at(-1)!;
  assert.equal(typeof payload.supplier_confirmed_at, "string");
  assert.equal(payload.supplier_confirmed_by, "user-1");
  // 4. never reads/writes active_step - confirmation is a fully independent fact.
  assert.equal("active_step" in payload, false);
});

test("3. unauthorized write rejected before any upsert", async () => {
  reset();
  role = "sales_designer";
  const result = await setVendorSupplierConfirmation("CO-0001-001", "acme", true);
  assert.deepEqual(result, { ok: false, error: "Forbidden." });
  assert.equal(upserts.length, 0);
});

test("confirming twice preserves the original timestamp; clearing removes both fields", async () => {
  reset();
  await setVendorSupplierConfirmation("CO-0001-001", "acme", true);
  const firstConfirmedAt = upserts.at(-1)!.supplier_confirmed_at;
  await setVendorSupplierConfirmation("CO-0001-001", "acme", true);
  assert.equal(upserts.at(-1)!.supplier_confirmed_at, firstConfirmedAt);
  const cleared = await setVendorSupplierConfirmation("CO-0001-001", "acme", false);
  assert.deepEqual(cleared, { ok: true });
  assert.equal(upserts.at(-1)!.supplier_confirmed_at, null);
  assert.equal(upserts.at(-1)!.supplier_confirmed_by, null);
});

// RECEIVING STATUS --------------------------------------------------------------------------

test("5. default receiving status is pending (no-op audit when unchanged)", async () => {
  reset();
  const result = await setVendorReceivingStatus("CO-0001-001", "acme", "pending");
  assert.deepEqual(result, { ok: true });
  assert.equal(auditCalls.length, 0); // previous (fallback "pending") === next -> no-op, no audit noise
});

test("6. set partial: no received_at", async () => {
  reset();
  await setVendorReceivingStatus("CO-0001-001", "acme", "partial");
  const payload = upserts.at(-1)!;
  assert.equal(payload.receiving_status, "partial");
  assert.equal(payload.received_at, null);
});

test("7. set received: received_at populated", async () => {
  reset();
  await setVendorReceivingStatus("CO-0001-001", "acme", "received");
  const payload = upserts.at(-1)!;
  assert.equal(payload.receiving_status, "received");
  assert.equal(typeof payload.received_at, "string");
});

test("8. received timestamp is stable across repeated saves", async () => {
  reset();
  await setVendorReceivingStatus("CO-0001-001", "acme", "received");
  const first = upserts.at(-1)!.received_at;
  await setVendorReceivingStatus("CO-0001-001", "acme", "received");
  assert.equal(upserts.at(-1)!.received_at, first);
});

test("9. moving away from received clears the timestamp - never a stale leftover", async () => {
  reset();
  await setVendorReceivingStatus("CO-0001-001", "acme", "received");
  assert.ok(upserts.at(-1)!.received_at);
  await setVendorReceivingStatus("CO-0001-001", "acme", "partial");
  assert.equal(upserts.at(-1)!.received_at, null);
  await setVendorReceivingStatus("CO-0001-001", "acme", "received");
  await setVendorReceivingStatus("CO-0001-001", "acme", "pending");
  assert.equal(upserts.at(-1)!.received_at, null);
});

test("10. invalid status rejected before any upsert", async () => {
  reset();
  const result = await setVendorReceivingStatus("CO-0001-001", "acme", "shipped" as never);
  assert.deepEqual(result, { ok: false, error: "Invalid receiving status." });
  assert.equal(upserts.length, 0);
});

test("receiving status write is also role-gated", async () => {
  reset();
  role = "sales_designer";
  const result = await setVendorReceivingStatus("CO-0001-001", "acme", "received");
  assert.deepEqual(result, { ok: false, error: "Forbidden." });
  assert.equal(upserts.length, 0);
});

// ── UI/ACTION CONTRACT + REGRESSION (source-text; pages aren't independently executable) ───

const procurementPage = readFileSync("app/procurement/orders/[orderNo]/page.tsx", "utf8");
const projectPage = readFileSync("app/projects/orders/[orderNo]/page.tsx", "utf8");
const completedPage = readFileSync("app/procurement/completed/[orderNo]/page.tsx", "utf8");
const controlsPanel = readFileSync("components/procurement/vendor-controls-panel.tsx", "utf8");
const attentionSource = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const generatePoSource = readFileSync("lib/procurement/generate-po-action.ts", "utf8");
const vendorDocsSource = readFileSync("lib/procurement/vendor-docs-action.ts", "utf8");

test("11/12. Procurement and Project pages read the same procurement_vendor_progress columns - no second source of truth", () => {
  for (const source of [procurementPage, projectPage, completedPage]) {
    assert.ok(source.includes("supplier_confirmed_at"));
    assert.ok(source.includes("receiving_status"));
    assert.ok(source.includes("received_at"));
    assert.ok(source.includes('.from("procurement_vendor_progress")'));
  }
});

test("13. the missing-confirmation Attention rule is gated on the PO Issued step, never inferred elsewhere", () => {
  assert.ok(attentionSource.includes('PROCUREMENT_PO_ISSUED_STEP = VENDOR_STEP_LABELS.findIndex((step) => step.key === "po_issued")'));
  assert.ok(attentionSource.includes("(progress?.active_step ?? 0) >= PROCUREMENT_PO_ISSUED_STEP && !progress?.supplier_confirmed_at"));
  assert.ok(attentionSource.includes('kind: "procurement_missing_confirmation"'));
});

test("14. existing ETA/ETD Attention findings are unchanged", () => {
  assert.ok(attentionSource.includes('kind: "procurement_missing_eta"'));
  assert.ok(attentionSource.includes('kind: "procurement_missing_etd"'));
  assert.ok(attentionSource.includes("if (!progress?.eta) {"));
  assert.ok(attentionSource.includes("if (!progress?.etd) {"));
});

test("15/18. vendor-step sequence and ETD/ETA editing are untouched", () => {
  assert.ok(controlsPanel.includes('{ key: "rfq",                 label: "RFQ" }'));
  assert.ok(controlsPanel.includes('{ key: "delivered_installed", label: "Delivered & Installed" }'));
  assert.ok(controlsPanel.includes("async function handleSaveDates()"));
  assert.ok(controlsPanel.includes('type="date"'));
});

test("16. PO generation action is untouched by this task", () => {
  assert.ok(generatePoSource.includes("project_purchase_orders"));
  assert.ok(!generatePoSource.includes("supplier_confirmed_at"));
  assert.ok(!generatePoSource.includes("receiving_status"));
});

test("17. vendor document actions are untouched", () => {
  assert.ok(vendorDocsSource.includes("export async function saveVendorDocUrl("));
  assert.ok(vendorDocsSource.includes("export async function deleteVendorDoc("));
  assert.ok(vendorDocsSource.includes('.from("procurement_vendor_docs")'));
});
