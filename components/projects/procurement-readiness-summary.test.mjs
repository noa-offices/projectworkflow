import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { computeProcurementReadiness } from "../../lib/projects/procurement-readiness.ts";
const code = ts.transpileModule(readFileSync(new URL("./procurement-readiness-summary.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
new Function("require", "exports", code)((name) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports);
const render = (readiness) => renderToStaticMarkup(exports.ProcurementReadinessSummary({ readiness }));
test("Overview ready summary renders counts and positive state", () => {
  const html = render(computeProcurementReadiness([{ vendor_key: "a", supplier_confirmed_at: "2026-01-01", receiving_status: "received" }]));
  assert.match(html, /Supplier confirmed/); assert.match(html, /Received/); assert.match(html, /1 \/ 1/);
  assert.match(html, /Procurement ready for completion/); assert.match(html, /text-emerald-800/);
});
test("Overview incomplete summary renders correct counts and amber state", () => {
  const html = render(computeProcurementReadiness([{ vendor_key: "a", supplier_confirmed_at: null, receiving_status: "partial" }]));
  assert.match(html, /0 \/ 1/); assert.match(html, /Procurement not ready for completion/); assert.match(html, /text-amber-800/);
});
test("Overview zero vendors is not applicable; read failure is unavailable", () => {
  assert.match(render(computeProcurementReadiness([])), /Procurement not applicable/);
  assert.doesNotMatch(render(computeProcurementReadiness([])), /not ready|text-amber/);
  assert.match(render(null), /Procurement readiness unavailable/); assert.doesNotMatch(render(null), /not applicable/);
});
test("Project page integrates the same computed result into Overview and completion using the scoped read", () => {
  const page = readFileSync(new URL("../../app/projects/orders/[orderNo]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /from\("procurement_vendor_progress"\)[\s\S]*?\.eq\("order_no", decodedOrderNo\)/);
  assert.match(page, /computeProcurementReadiness\(rawVendorProgress\)/);
  assert.match(page, /<ProcurementReadinessSummary readiness=\{procurementReadiness\}/);
  assert.match(page, /<MarkCompletedButton[^>]*procurementReadiness=\{procurementReadiness\}/);
});
