import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { quotationWriteLockReason, type QuotationLockClient } from "./quotation-write-lock.js";
import * as lock from "./quotation-lock.js";

const projectFile = { orderNo: "OR-2026-001", quotationId: "quote", quotationNo: "Q-001", clientId: "client", clientName: "Client", reference: "Office", total: 1468.95, currency: "AED", createdAt: "2026-11-04", createdBy: "user" };
const reason = lock.quotationLockReason({ layout_settings: { projectFile } })!;
export const protectedActions = [
  "updateQuotationItemImageSettings", "deactivateQuotation", "archiveFolderQuotation", "restoreQuotation", "permanentlyDeleteQuotation", "createClientApprovalDraft",
  "updateQuotation", "updateQuotationEnquiryDetails", "updateSpecificationSettings", "updateQuotationDocumentSetup", "updateQuotationExtraDiscount", "updateQuotationLayoutSettings", "updateQuotationColumnWidth", "updateQuotationItemRowHeight", "updateQuotationSectionRowHeight",
  "createQuotationSection", "updateQuotationSection", "deactivateQuotationSection", "createQuotationItem", "createBlankQuotationItem", "createBlankQuotationItemOptimistic", "addProductTemplateToQuotation", "updateQuotationItem", "applyManualCurrencyConversion", "updateQuotationItemInline", "useCurrentSourcePriceForQuotationItem", "copyQuotationItem", "duplicateQuotationItemBelow", "pasteCopiedQuotationItem", "autosaveQuotationItemInline", "moveQuotationItemUp", "moveQuotationItemDown", "deactivateQuotationItem", "restoreQuotationItem", "restoreQuotationSection", "saveQuotationItemToProductLibrary",
];

function harness(locked = true) {
  let mutations = 0;
  const client = { from(table: string) {
    let rowId = "";
    const query = {
      select() { return query; }, eq(key: string, value: string) { if (key === "id") rowId = value; return query; },
      maybeSingle: async () => ({ data: table === "quotations" ? { id: rowId, status: "client_confirmed", layout_settings: locked && rowId !== "unlocked" ? { projectFile } : {} } : { quotation_id: rowId.startsWith("unlocked") ? "unlocked" : "quote" }, error: null }),
      returns: async () => ({ data: [{ id: "quote", status: "client_confirmed", layout_settings: locked ? { projectFile } : {} }], error: null }),
      update() { mutations++; throw new Error("Unexpected mutation"); }, insert() { mutations++; throw new Error("Unexpected mutation"); }, delete() { mutations++; throw new Error("Unexpected mutation"); },
    };
    return query;
  } };
  const auth = async () => ({ user: { id: "user" }, profile: { role: "system_owner" }, displayName: "User" });
  const cjs = { exports: {} as Record<string, (input: FormData | string) => Promise<unknown>> };
  const source = readFileSync(new URL("../../app/quotations/actions.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const require = (id: string) => {
    if (id === "@/lib/auth") return { requireActiveUser: auth, requireQuotationActionUser: auth, requireQuotationManager: auth, requireProductLibraryManager: auth, redirectWarehouseStaff: async () => {} };
    if (id === "@/lib/supabase/server") return { createClient: async () => client };
    if (id === "@/lib/quotations/quotation-write-lock") return { quotationWriteLockReason };
    if (id === "@/lib/quotations/quotation-lock") return lock;
    if (id === "next/navigation") return { redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } };
    if (id === "@/lib/quotation-status") return { allowedQuotationStatuses: new Set(["draft", "cancelled", "client_confirmed"]) };
    if (id === "@/lib/quotations/client-approval-draft") return { clientApprovalDraftFromLayoutSettings: () => ({ approvalNo: "AP-1", approvalStatus: "Pending" }) };
    return {};
  };
  runInNewContext(code, { module: cjs, exports: cjs.exports, require, FormData, URLSearchParams, console });
  return { actions: cjs.exports, mutations: () => mutations, client: client as unknown as QuotationLockClient };
}

for (const action of protectedActions) test(`${action} refuses a locked quotation before mutation`, async () => {
  const { actions, mutations } = harness();
  const form = new FormData();
  for (const key of ["id", "quotation_id", "quotation_item_id", "destination_quotation_id", "section_id"]) form.set(key, "quote");
  let result: unknown;
  try { result = await actions[action](form); } catch (error) { result = String(error); }
  const output = typeof result === "string" ? decodeURIComponent(result.replace(/\+/g, " ")) : JSON.stringify(result);
  assert.ok(output.includes(reason), output);
  assert.equal(mutations(), 0);
});

test("recalculation refuses locked quotation before item reads or total writes", async () => {
  const { actions, mutations } = harness();
  await assert.rejects(actions.recalculateQuotationTotals("quote"), /Locked: Project/);
  assert.equal(mutations(), 0);
});

test("status changes and client revision requests cannot reopen a locked quotation", async () => {
  const { actions, mutations } = harness();
  const form = new FormData(); form.set("quotation_id", "quote"); form.set("status", "draft"); form.set("result_mode", "optimistic");
  assert.deepEqual(JSON.parse(JSON.stringify(await actions.updateQuotationStatus(form))), { ok: false, error: reason });
  const decision = new FormData(); decision.set("approval_no", "AP-1"); decision.set("decision", "revision");
  await assert.rejects(actions.recordClientApprovalDecision(decision), (error) => decodeURIComponent(String(error).replace(/\+/g, " ")).includes(reason));
  assert.equal(mutations(), 0);
});

test("ownership guard checks actual item parent and fails closed when it cannot be read", async () => {
  const { client } = harness();
  assert.equal(await quotationWriteLockReason(client, { quotationId: "unlocked", itemId: "actual" }), reason);
  assert.equal(await quotationWriteLockReason({ from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ error: {}, data: null }) }) } as unknown as QuotationLockClient, { quotationId: "quote" }), "Quotation lock could not be verified. Reload and try again.");
});

test("extra submitted ID aliases cannot hide the locked row actually targeted by an action", async () => {
  const { actions, mutations } = harness();
  for (const [action, values] of [
    ["updateQuotation", { id: "quote", quotation_id: "unlocked" }],
    ["applyManualCurrencyConversion", { id: "unlocked-item", quotation_id: "unlocked", quotation_item_id: "quote" }],
    ["restoreQuotationSection", { id: "unlocked-section", quotation_id: "unlocked", quotation_section_id: "quote" }],
  ] as const) {
    const form = new FormData(); for (const [key, value] of Object.entries(values)) form.set(key, value);
    await assert.rejects(actions[action](form), (error) => decodeURIComponent(String(error).replace(/\+/g, " ")).includes(reason));
  }
  assert.equal(mutations(), 0);
});
