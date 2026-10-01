// Project + Procurement maturity audit Part 4: delivered-vs-received consistency Attention
// finding. noa-attention-capability.server.ts has "@/..." aliases and `import "server-only"`,
// neither resolvable by Node's plain ESM resolver outside the Next.js build - these are
// source-level wiring/safety checks, matching the convention already used throughout lib/noa's
// other *-safety.test.mts files (including noa-phase-n2a2-safety.test.mts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attentionSource = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

test("the delivered-vs-received Attention kind exists on the closed type", () => {
  assert.match(attentionSource, /type NoaAttentionKind = .*"procurement_delivered_not_received".*;/);
});

test("the delivered/installed step index is derived from the canonical step list, never hardcoded", () => {
  assert.ok(attentionSource.includes(
    'PROCUREMENT_DELIVERED_INSTALLED_STEP = VENDOR_STEP_LABELS.findIndex((step) => step.key === "delivered_installed");',
  ));
});

test("11/12. the finding fires when active_step is delivered_installed and receiving_status is not 'received'", () => {
  assert.ok(attentionSource.includes(
    'if (progress?.active_step === PROCUREMENT_DELIVERED_INSTALLED_STEP && progress.receiving_status !== "received") {',
  ));
  assert.ok(attentionSource.includes('kind: "procurement_delivered_not_received"'));
});

test("13. delivered_installed + received produces no finding (condition excludes 'received')", () => {
  assert.ok(attentionSource.includes('progress.receiving_status !== "received"'));
});

test("14. the finding requires active_step to equal the delivered_installed step exactly - an earlier step never matches", () => {
  assert.ok(attentionSource.includes("progress?.active_step === PROCUREMENT_DELIVERED_INSTALLED_STEP"));
  assert.ok(!attentionSource.includes("progress?.active_step >= PROCUREMENT_DELIVERED_INSTALLED_STEP"));
});

test("15. the existing ETA/ETD/confirmation findings are unchanged by this addition", () => {
  assert.ok(attentionSource.includes("if (!progress?.eta) {"));
  assert.ok(attentionSource.includes("if (!progress?.etd) {"));
  assert.ok(attentionSource.includes('kind: "procurement_missing_eta"'));
  assert.ok(attentionSource.includes('kind: "procurement_missing_etd"'));
  assert.ok(attentionSource.includes('kind: "procurement_missing_confirmation"'));
  assert.ok(attentionSource.includes("PROCUREMENT_PO_ISSUED_STEP = VENDOR_STEP_LABELS.findIndex((step) => step.key === \"po_issued\");"));
});

test("the finding is advisory only - it never writes to active_step or receiving_status", () => {
  const findingStart = attentionSource.indexOf("key: `procurement_delivered_not_received:");
  const findingBlock = attentionSource.slice(findingStart, attentionSource.indexOf("});", findingStart));
  assert.ok(!/\.upsert\(|\.update\(/.test(findingBlock));
});

test("the receiving_status column is now selected alongside the other vendor-progress fields", () => {
  assert.ok(attentionSource.includes(
    '.select("order_no,vendor_key,eta,etd,active_step,supplier_confirmed_at,receiving_status")',
  ));
});

test("no severity/priority/rank/score field was introduced by this finding", () => {
  const findingStart = attentionSource.indexOf("key: `procurement_delivered_not_received:");
  const findingBlock = attentionSource.slice(findingStart, attentionSource.indexOf("});", findingStart));
  assert.ok(!/severity|priority|\brank\b|\bscore\b/i.test(findingBlock));
});

test("no UUID is surfaced in the finding's display fields", () => {
  const findingStart = attentionSource.indexOf("key: `procurement_delivered_not_received:");
  const findingBlock = attentionSource.slice(findingStart, attentionSource.indexOf("});", findingStart));
  assert.ok(findingBlock.includes("entityLabel: group.displayLabel,"));
  assert.ok(findingBlock.includes("entityIdentifier: order.orderNo,"));
});
