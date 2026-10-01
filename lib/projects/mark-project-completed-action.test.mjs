import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as readiness from "./procurement-readiness.ts";

let role = "system_owner";
let saved = null;
let tables = [];
let refreshed = 0;
let paths = [];
let auditCalls = [];
let updateError = null;
mock.module("@/lib/auth", { namedExports: { requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role } }) } });
mock.module("next/cache", { namedExports: { revalidatePath: (path) => paths.push(path) } });
mock.module("@/lib/audit-log", { namedExports: { createAuditLog: async (_client, input) => { auditCalls.push(input); return true; } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({ from(table) {
  tables.push(table); assert.equal(table, "quotations");
  const builder = { select: () => builder, eq: () => builder,
    maybeSingle: async () => ({ data: { id: "q", layout_settings: { keep: "snapshot" } }, error: null }),
    update: (value) => { saved = value; return builder; },
    then: (resolve) => resolve({ error: updateError }) };
  return builder;
} }) } });
const { markProjectCompletedAction } = await import("./mark-project-completed-action.ts");
function buttonHarness() {
  const state = [];
  let index = 0;
  const code = ts.transpileModule(readFileSync(new URL("../../components/projects/mark-completed-button.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "react") return { useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value) => { state[slot] = value; }]; } };
    if (name === "next/navigation") return { useRouter: () => ({ refresh: () => refreshed++ }) };
    if (name.endsWith("mark-project-completed-action")) return { markProjectCompletedAction };
    if (name.endsWith("procurement-readiness")) return readiness;
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return (props) => { index = 0; return exports.MarkCompletedButton({ quotationId: "q", orderNo: "CO-0001", completedAt: null, ...props }); };
}
function findButton(element, label) {
  if (!element || typeof element !== "object") return null;
  if (element.type === "button" && element.props.children === label) return element;
  for (const child of [element.props?.children].flat(Infinity)) { const found = findButton(child, label); if (found) return found; }
  return null;
}
const notReady = readiness.computeProcurementReadiness([{ vendor_key: "a", supplier_confirmed_at: null, receiving_status: "pending" }]);
test("completion warns before and during confirmation but remains possible", async () => {
  role = "system_owner"; tables = []; saved = null; refreshed = 0; paths = []; auditCalls = [];
  const render = buttonHarness(), props = { procurementReadiness: notReady };
  let element = render(props);
  assert.match(renderToStaticMarkup(element), /1 vendor not confirmed/);
  findButton(element, "Mark as Completed").props.onClick();
  element = render(props);
  assert.match(renderToStaticMarkup(element), /1 vendor not received/);
  const confirm = findButton(element, "Confirm"); assert.equal(confirm.props.disabled, false);
  await confirm.props.onClick();
  assert.equal(saved.layout_settings.keep, "snapshot");
  assert.ok(Number.isFinite(Date.parse(saved.layout_settings.projectCompletedAt)));
  assert.equal(refreshed, 1); assert.deepEqual(tables, ["quotations", "quotations"]);
  assert.deepEqual(paths, ["/projects/orders", "/projects/orders/CO-0001", "/projects/completed", "/procurement/orders"]);
});
test("8. successful completion logs an audit entry", async () => {
  role = "system_owner"; tables = []; saved = null; auditCalls = [];
  const result = await markProjectCompletedAction("q", "CO-0001");
  assert.deepEqual(result, { ok: true });
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "project_completed");
  assert.deepEqual(auditCalls[0].metadata.orderNo, "CO-0001");
  assert.deepEqual(auditCalls[0].metadata.quotationId, "q");
  assert.equal(auditCalls[0].createdBy, "user-1");
});
test("9. unauthorized completion remains rejected without database reads", async () => {
  for (const denied of ["procurement_manager", "sales_designer", null]) {
    role = denied; tables = []; saved = null; auditCalls = [];
    assert.deepEqual(await markProjectCompletedAction("q", "CO-0001"), { ok: false, error: "Forbidden." });
    assert.deepEqual(tables, []); assert.equal(saved, null);
    assert.equal(auditCalls.length, 0);
  }
});
test("admin manager completion remains allowed", async () => { role = "admin_manager"; auditCalls = []; assert.deepEqual(await markProjectCompletedAction("q", "CO-0001"), { ok: true }); });
test("10. a failed completion update does not log a success audit", async () => {
  role = "system_owner"; auditCalls = []; updateError = { message: "db boom" };
  const result = await markProjectCompletedAction("q", "CO-0001");
  assert.deepEqual(result, { ok: false, error: "Failed to mark project as completed." });
  assert.equal(auditCalls.length, 0);
  updateError = null;
});
test("completed Project remains a dated badge, without warning or completion button", () => {
  const element = buttonHarness()({ completedAt: "2026-01-02T00:00:00Z", procurementReadiness: notReady });
  const html = renderToStaticMarkup(element);
  assert.match(html, /Completed/); assert.match(html, /02 Jan 2026/); assert.doesNotMatch(html, /not ready|<button/);
});
test("zero vendors and ready procurement show no completion warning", () => {
  for (const rows of [[], [{ vendor_key: "a", supplier_confirmed_at: "2026-01-01", receiving_status: "received" }]]) {
    const html = renderToStaticMarkup(buttonHarness()({ procurementReadiness: readiness.computeProcurementReadiness(rows) }));
    assert.match(html, /Mark as Completed/); assert.doesNotMatch(html, /not ready|not confirmed|not received/);
  }
});
