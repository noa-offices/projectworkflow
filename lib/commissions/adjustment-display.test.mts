import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedAdjustmentTotal, commissionSummaryTotals, loadCommissionAdjustments, type CommissionAdjustmentRow } from "./adjustments";

test("net uses only approved and paid signed adjustments; original is never changed", () => {
  const rows = [
    {status:"draft",adjustment_amount:500}, {status:"pending_approval",adjustment_amount:-200},
    {status:"approved",adjustment_amount:50}, {status:"paid",adjustment_amount:-20},
    {status:"cancelled",adjustment_amount:100}, {status:"reversed",adjustment_amount:100},
    {status:"requires_review",adjustment_amount:null},
  ] as CommissionAdjustmentRow[];
  assert.equal(approvedAdjustmentTotal(rows),30);
  assert.equal(approvedAdjustmentTotal([]),0);
});
test("profile amounts follow each ledger status, preserve currencies and exclude draft credits from earned", () => {
  const originals = [{currency:"AED",status:"paid" as const,final_commission_amount:100}];
  const adjustments = [{currency:"AED",status:"draft",adjustment_amount:-50},{currency:"AED",status:"approved",adjustment_amount:-20},{currency:"AED",status:"paid",adjustment_amount:5},{currency:"EUR",status:"paid",adjustment_amount:10}] as CommissionAdjustmentRow[];
  assert.deepEqual([...commissionSummaryTotals(originals,adjustments,"earned")],[["AED",85],["EUR",10]]);
  assert.deepEqual([...commissionSummaryTotals(originals,adjustments,"paid")],[["AED",105],["EUR",10]]);
  assert.deepEqual([...commissionSummaryTotals(originals,adjustments,"approved")],[["AED",-20]]);
});
test("loader batches exact parent IDs, uses caller RLS, and reports unavailable schema", async () => {
  const calls: string[][] = [];
  const client = { from: () => ({ select: () => ({ in: (_key: string,ids: string[]) => ({ order: async () => {
    calls.push(ids); return {data:[],error:null};
  } }) }) }) };
  assert.deepEqual(await loadCommissionAdjustments(client,[]),{rows:[],unavailable:false});
  assert.equal(calls.length,0);
  const ids = Array.from({length:115},(_,n) => String(n));
  await loadCommissionAdjustments(client,[...ids,"1"]);
  assert.deepEqual(calls.map((call) => call.length),[50,50,15]);
  const missing = {from: () => ({select: () => ({in: () => ({order: async () => ({data:null,error:{code:"PGRST205"}})})})})};
  assert.deepEqual(await loadCommissionAdjustments(missing,["a"]),{rows:[],unavailable:true});
});
