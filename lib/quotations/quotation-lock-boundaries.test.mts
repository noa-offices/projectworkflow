import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { baseVersion, oldWorkspace, quotationId, userId } from "../local/quotation-publication-fixture.mjs";

const projectFile = {
  orderNo: "CO-0001", quotationId, quotationNo: "QN-0001", clientId: "client-1",
  clientName: "Client", reference: "Project", total: 200, currency: "AED",
  createdAt: "2026-10-01T00:00:00Z", createdBy: userId,
};
let layout: Record<string, unknown>;
let readError: { message: string } | null;
let writes: Array<{ table: string; operation: string; patch?: unknown }>;
let rpcCalls: number;
let storageCalls: number;
let auditCalls: number;
let quotationCount: number;
let paymentStorageEnabled: boolean;
let rpcRequests: Array<{ name: string; args: Record<string, unknown> }>;
let uploadedFiles: Array<{ path: string; contents: Buffer }>;
function db() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from(table: string) {
      let operation = "select";
      const row = () => table === "profiles" ? { role: "system_owner", account_status: "active" }
        : table === "projects" ? { id: "project-1", project_name: "Project", is_active: false }
        : { id: quotationId, workspace_version: baseVersion, layout_settings: layout };
      const query = {
        select: (_fields?: string) => query,
        eq: (_key: string, _value: unknown) => query,
        in: (_key: string, _value: unknown) => query,
        limit: (_count: number) => query,
        returns: () => query,
        update(patch: unknown) { operation = "update"; writes.push({ table, operation, patch }); return query; },
        delete() { operation = "delete"; writes.push({ table, operation }); return query; },
        maybeSingle: async () => ({ data: readError && table === "quotations" ? null : row(), error: table === "quotations" ? readError : null }),
        then(resolve: (value: unknown) => void) {
          resolve({ data: operation === "select" ? [row()] : [], error: table === "quotations" ? readError : null, count: quotationCount });
        },
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls++; rpcRequests.push({ name, args });
      if (name === "client_payment_receipt_attachment_context") return { data: [{ receipt_voided: false }], error: null };
      return { data: { ok: true, version: baseVersion, mutationId: "mutation", savedAt: "2026-10-01" }, error: null };
    },
    storage: { from: () => {
      storageCalls++;
      if (!paymentStorageEnabled) throw new Error("Unexpected storage mutation");
      return { upload: async (path: string, contents: Buffer) => { uploadedFiles.push({ path, contents }); return { error: null }; } };
    } },
  };
}
mock.module("server-only", { namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", { namedExports: { redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } } });
mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => ({ user: { id: userId }, profile: { role: "system_owner" } }),
  requireRecordsManager: async () => ({}), requireQuotationActionUser: async () => ({}),
  canManageClientPaymentInstallments: (role: string) => role === "system_owner",
  canRecordClientPaymentReceipts: (role: string) => role === "system_owner",
  canVoidClientPaymentReceipts: (role: string) => role === "system_owner",
  canManageClientPaymentReceiptAttachments: (role: string) => role === "system_owner",
  canViewClientPayments: (role: string) => role === "system_owner",
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => db() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ({ client: db(), error: null }) } });
mock.module("@/lib/audit-log", { namedExports: { createAuditLog: async () => { auditCalls++; return true; } } });

const { GET, POST } = await import("../../app/api/quotations/[id]/local-workspace/route");
const { mergeClients } = await import("../../app/sales/clients/actions");
const { permanentlyDeleteProjectAndLinkedQuotations } = await import("../../app/clients/actions");
const { deleteFolderAction } = await import("./delete-folder-action");
const { archiveFolderAction } = await import("./archive-folder-action");
const { cancelProjectAction } = await import("../projects/cancel-project-action");
const { markProjectCompletedAction } = await import("../projects/mark-project-completed-action");
const { reopenProjectAction } = await import("../projects/reopen-project-action");
const { saveClientPaymentInstallment, recordClientPaymentReceipt } = await import("../projects/client-payment-actions");
const { uploadClientPaymentReceiptAttachment } = await import("../projects/client-payment-attachment-actions");
const context = () => ({ params: Promise.resolve({ id: quotationId }) });
const request = () => new Request(`http://localhost/api/quotations/${quotationId}/local-workspace`, {
  method: "POST", body: JSON.stringify({ workspace: oldWorkspace(), baseVersion, mutationId: crypto.randomUUID() }),
});
beforeEach(() => {
  layout = { projectFile, pricing_rule: "whole_aed_v1" }; readError = null; writes = [];
  rpcCalls = 0; storageCalls = 0; auditCalls = 0; quotationCount = 1;
  paymentStorageEnabled = false; rpcRequests = []; uploadedFiles = [];
});

test("publication and Keep My Version reject the authoritative Project File even with an unlocked local draft", async () => {
  for (const response of [(await GET(request(), context()))!, (await POST(request(), context()))!]) {
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "LOCKED");
    assert.equal(typeof body.lockReason, "string");
    assert.ok(body.lockReason.length > 0);
  }
  assert.equal(rpcCalls, 0);
  assert.equal(writes.length, 0);
});

test("publication fails closed when the authoritative lock read fails", async () => {
  readError = { message: "read unavailable" };
  assert.equal((await POST(request(), context()))!.status, 503);
  assert.equal(rpcCalls, 0);
});

test("unlocked and malformed Project File records remain publishable", async () => {
  for (const value of [{}, { projectFile: { orderNo: "incomplete" } }]) {
    layout = value;
    assert.equal((await GET(request(), context()))!.status, 200);
    assert.equal((await POST(request(), context()))!.status, 200);
  }
  assert.equal(rpcCalls, 2);
});

test("client merge refuses locked quotations before changing any client or project", async () => {
  const result = await mergeClients("primary", "duplicate");
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});

test("client merge fails closed on quotation read failure but allows unlocked quotations", async () => {
  readError = { message: "unavailable" };
  assert.equal((await mergeClients("primary", "duplicate")).ok, false);
  assert.equal(writes.length, 0);
  readError = null; layout = {};
  assert.equal((await mergeClients("primary", "duplicate")).ok, true);
  assert.deepEqual(writes.map((entry) => entry.table), ["quotations", "projects", "clients"]);
});

test("cancelled Project Files cannot be removed through folder or project cascade deletion", async () => {
  layout.projectCancelledAt = "2026-10-02T00:00:00Z";
  assert.equal((await deleteFolderAction([quotationId], "Project")).ok, false);
  const form = new FormData(); form.set("id", "project-1"); form.set("confirmation_text", "DELETE PROJECT");
  await assert.rejects(permanentlyDeleteProjectAndLinkedQuotations(form), /REDIRECT.*messageType=error/);
  assert.equal(writes.length, 0);
  assert.equal(storageCalls, 0);
  assert.equal(auditCalls, 0);
});

test("bulk writers refuse incomplete quotation scans before any side effect", async () => {
  layout = {}; quotationCount = 2;
  assert.equal((await mergeClients("primary", "duplicate")).ok, false);
  const form = new FormData(); form.set("id", "project-1"); form.set("confirmation_text", "DELETE PROJECT");
  await assert.rejects(permanentlyDeleteProjectAndLinkedQuotations(form), /REDIRECT.*messageType=error/);
  assert.equal((await deleteFolderAction([quotationId, "other-quotation"], "Project")).ok, false);
  assert.equal(writes.length, 0);
  assert.equal(storageCalls, 0);
  assert.equal(auditCalls, 0);
});

test("project operations preserve the frozen layout while changing their own lifecycle keys", async () => {
  assert.equal((await archiveFolderAction(quotationId, true)).ok, true);
  assert.equal((await cancelProjectAction(quotationId, "CO-0001")).ok, true);
  assert.equal((await markProjectCompletedAction(quotationId, "CO-0001")).ok, true);
  layout.projectCompletedAt = "2026-10-02T00:00:00Z";
  assert.equal((await reopenProjectAction(quotationId, "CO-0001")).ok, true);
  assert.equal(writes.length, 4);
  for (const entry of writes) {
    const saved = (entry.patch as { layout_settings: Record<string, unknown> }).layout_settings;
    assert.deepEqual(saved.projectFile, projectFile);
    assert.equal(saved.pricing_rule, "whole_aed_v1");
  }
  assert.equal(auditCalls, 1);
});

test("locked Project File still permits installment and receipt wrappers without commercial quotation writes", async () => {
  assert.deepEqual(await saveClientPaymentInstallment({
    quotationId, orderNo: "CO-0001", contractTotal: "200.00", title: "Deposit",
    calculationType: "fixed", fixedAmount: "100.00", percentage: null, dueType: "project_confirmation",
    dueDate: null, customDueDescription: null, note: "Deposit agreed", statusOverride: null,
  }), { ok: true });
  assert.deepEqual(await recordClientPaymentReceipt({
    installmentId: "installment-1", quotationId, orderNo: "CO-0001", contractTotal: "200.00",
    amountReceived: "100.00", receivedOn: "2026-11-04", paymentMethod: "bank_transfer",
    referenceNumber: "BANK-1", bankAccountNote: null, comment: "Deposit", idempotencyKey: "receipt-request-1", confirmOverpayment: false,
  }), { ok: true });
  assert.deepEqual(rpcRequests.map(({ name }) => name), ["add_client_payment_installment", "record_client_payment_receipt"]);
  assert.equal(rpcRequests[0].args.p_contract_total, "200.00");
  assert.equal(rpcRequests[1].args.p_amount_received, "100.00");
  assert.equal(writes.length, 0);
  assert.equal(layout.projectFile, projectFile);
});

test("locked Project File still permits authorized receipt attachment upload and metadata registration", async () => {
  paymentStorageEnabled = true;
  const form = new FormData();
  form.set("receiptId", "receipt-1"); form.set("quotationId", quotationId); form.set("orderNo", "CO-0001");
  form.set("file", new File(["%PDF-1.7\nReceipt evidence"], "deposit.pdf", { type: "application/pdf" }));
  assert.deepEqual(await uploadClientPaymentReceiptAttachment(form), { ok: true });
  assert.deepEqual(rpcRequests.map(({ name }) => name), ["client_payment_receipt_attachment_context", "add_client_payment_receipt_attachment_metadata"]);
  assert.equal(uploadedFiles.length, 1);
  assert.match(uploadedFiles[0].path, /^projects\/CO-0001\/receipts\/receipt-1\/.+-receipt-evidence\.pdf$/);
  assert.equal(uploadedFiles[0].contents.toString(), "%PDF-1.7\nReceipt evidence");
  assert.equal(rpcRequests[1].args.p_storage_path, uploadedFiles[0].path);
  assert.equal(writes.length, 0);
  assert.equal(layout.projectFile, projectFile);
});
