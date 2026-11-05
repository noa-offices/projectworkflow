import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommissionAdjustmentRow } from "@/lib/commissions/adjustments";
import type { SalesCommissionRow } from "@/lib/commissions/types";
mock.module("@/app/commissions/adjustment-actions",{namedExports:{changeCommissionAdjustment:async () => {}}});
const { CommissionAdjustments } = await import("./commission-adjustments");
const parent = { id:"parent",currency:"AED",final_commission_amount:100,status:"paid" } as SalesCommissionRow;
const row = {id:"a",commission_id:"parent",variation_id:"v",variation_no:1,currency:"AED",status:"draft",adjustment_amount:-50,review_reason:null,recalculated_by:null,submitted_by:null} as CommissionAdjustmentRow;
const render = (rows: CommissionAdjustmentRow[], unavailable = false, userId = "owner", isOwner = true) => renderToStaticMarkup(createElement(CommissionAdjustments,{parent,rows,unavailable,userId,isOwner,otherOwnerCount:1}));
test("paid-parent credits show recovery amount and draft does not reduce net; approved credit does", () => {
  const draft = render([row]);
  assert.match(draft,/Amount to recover/); assert.match(draft,/subject to approval/);
  assert.match(draft,/Net commission/); assert.match(draft,/100/); assert.match(draft,/Submit for Approval/);
  assert.match(render([{...row,status:"approved"}]),/Mark paid/);
  assert.doesNotMatch(render([{...row,status:"pending_approval",submitted_by:"owner"}]),/>Approve</);
  assert.match(render([{...row,status:"pending_approval",submitted_by:"other"}]),/>Approve</);
  assert.doesNotMatch(render([{...row,status:"pending_approval",submitted_by:"other"}],false,"sales",false),/>Approve</);
});
test("old deployments show an explicit unavailable notice, and review rows have no editable financial fields", () => {
  assert.match(render([],true),/Net commission cannot be confirmed/);
  const html = render([{...row,status:"requires_review",adjustment_amount:null,review_reason:"Missing VAT"}]);
  assert.match(html,/Missing VAT/); assert.match(html,/Awaiting review/); assert.match(html,/Recheck copied rule/);
  assert.doesNotMatch(html,/name="(?:adjustment_amount|new_base|percentage_rate)"/);
});
