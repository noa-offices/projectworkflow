// Maturity audit Part 2: vendor document upload/delete audit logging. Real execution against a
// fake admin client + audit log, same mock.module() convention as vendor-progress-actions.test.mts.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("server-only", { defaultExport: {} });
let role: string | null = "procurement_manager";
const auditCalls: Array<Record<string, unknown>> = [];
let insertError: { message?: string } | null = null;
let storageRemoveError: { message?: string } | null = null;
let dbDeleteError: { message?: string } | null = null;
let docRow: Record<string, unknown> | null = null;
const storageRemovedPaths: string[] = [];

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role, account_status: "active" } }),
} });
mock.module("@/lib/audit-log", { namedExports: {
  createAuditLog: async (_client: unknown, input: Record<string, unknown>) => { auditCalls.push(input); return true; },
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({}) } });
mock.module("@/lib/supabase/admin", { namedExports: {
  createAdminClient: () => ({
    error: null,
    client: {
      storage: {
        from: () => ({
          remove: async (paths: string[]) => { storageRemovedPaths.push(...paths); return { error: storageRemoveError }; },
        }),
      },
      from: (table: string) => {
        assert.equal(table, "procurement_vendor_docs");
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          async maybeSingle() { return { data: docRow, error: null }; },
          insert: () => ({
            select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: "doc-1" }, error: null }) }),
          }),
          delete: () => builder,
          then: (resolve: (v: unknown) => void) => resolve({ error: dbDeleteError }),
        };
        return builder;
      },
    },
  }),
} });

const { saveVendorDocUrl, deleteVendorDoc, deleteVendorDocById } = await import("./vendor-docs-action");

function reset() {
  role = "procurement_manager";
  auditCalls.length = 0;
  insertError = null;
  storageRemoveError = null;
  dbDeleteError = null;
  docRow = { order_no: "CO-0001-001", vendor_key: "acme", slot_key: "pi", file_name: "invoice.pdf" };
  storageRemovedPaths.length = 0;
}

// UPLOAD ------------------------------------------------------------------------------------

test("4. successful document upload logs audit with safe fields only", async () => {
  reset();
  const result = await saveVendorDocUrl("CO-0001-001", "q-1", "acme", "pi", "invoice.pdf", "path/to/file", "https://example.com/signed?token=secret");
  assert.deepEqual(result, { ok: true, id: "doc-1" });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "vendor_document_uploaded");
  assert.deepEqual(auditCalls[0].metadata, { orderNo: "CO-0001-001", vendorKey: "acme", slotKey: "pi", fileName: "invoice.pdf" });
});

test("6. failed upload does not emit a success audit", async () => {
  reset();
  insertError = { message: "boom" };
  const result = await saveVendorDocUrl("CO-0001-001", "q-1", "acme", "pi", "invoice.pdf", "path/to/file", "https://example.com/signed?token=secret");
  assert.equal(result.ok, false);
  assert.equal(auditCalls.length, 0);
});

test("7. upload audit payload excludes storage URL / storage path", async () => {
  reset();
  await saveVendorDocUrl("CO-0001-001", "q-1", "acme", "pi", "invoice.pdf", "path/to/file", "https://example.com/signed?token=secret");
  const metadataJson = JSON.stringify(auditCalls[0].metadata);
  assert.ok(!metadataJson.includes("https://"));
  assert.ok(!metadataJson.includes("path/to/file"));
  assert.ok(!metadataJson.includes("token=secret"));
});

test("upload is still role-gated before any write or audit", async () => {
  reset();
  role = "sales_designer";
  const result = await saveVendorDocUrl("CO-0001-001", "q-1", "acme", "pi", "invoice.pdf", "path/to/file", "https://example.com/signed");
  assert.deepEqual(result, { ok: false, error: "Forbidden." });
  assert.equal(auditCalls.length, 0);
});

// DELETE BY ORDER/VENDOR/SLOT -----------------------------------------------------------------

test("5. document delete (by order/vendor/slot) logs audit", async () => {
  reset();
  const result = await deleteVendorDoc("CO-0001-001", "acme", "pi", "path/to/file");
  assert.deepEqual(result, { ok: true });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "vendor_document_deleted");
  assert.deepEqual(auditCalls[0].metadata, { orderNo: "CO-0001-001", vendorKey: "acme", slotKey: "pi" });
});

test("6b. a failed delete (storage or db) does not emit a success audit", async () => {
  reset();
  storageRemoveError = { message: "storage boom" };
  let result = await deleteVendorDoc("CO-0001-001", "acme", "pi", "path/to/file");
  assert.equal(result.ok, false);
  assert.equal(auditCalls.length, 0);

  reset();
  dbDeleteError = { message: "db boom" };
  result = await deleteVendorDoc("CO-0001-001", "acme", "pi", "path/to/file");
  assert.equal(result.ok, false);
  assert.equal(auditCalls.length, 0);
});

test("7b. delete audit payload excludes storage path", async () => {
  reset();
  await deleteVendorDoc("CO-0001-001", "acme", "pi", "path/to/file");
  assert.ok(!JSON.stringify(auditCalls[0].metadata).includes("path/to/file"));
});

// DELETE BY ID --------------------------------------------------------------------------------

test("5b. document delete-by-id (separate live path) also logs audit", async () => {
  reset();
  const result = await deleteVendorDocById("doc-1", "path/to/file");
  assert.deepEqual(result, { ok: true });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "vendor_document_deleted");
  assert.deepEqual(auditCalls[0].metadata, { orderNo: "CO-0001-001", vendorKey: "acme", slotKey: "pi", fileName: "invoice.pdf" });
});

test("6c. a failed delete-by-id does not emit a success audit", async () => {
  reset();
  storageRemoveError = { message: "storage boom" };
  const result = await deleteVendorDocById("doc-1", "path/to/file");
  assert.equal(result.ok, false);
  assert.equal(auditCalls.length, 0);
});

test("delete-by-id is role-gated before any pre-read or write", async () => {
  reset();
  role = "sales_designer";
  const result = await deleteVendorDocById("doc-1", "path/to/file");
  assert.deepEqual(result, { ok: false, error: "Forbidden." });
  assert.equal(auditCalls.length, 0);
});
