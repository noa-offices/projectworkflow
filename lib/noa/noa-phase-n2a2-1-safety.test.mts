// NOA 2.0A-2.1: Attention Center - Procurement finding identity fix (presentation only, UAT
// proven: the same vendor can legitimately recur across different ERP Project Files, but the
// bullet-list text didn't show which one, making distinct findings look duplicated).
// noa-attention-capability.server.ts has "@/..." aliases and/or `import "server-only"`, neither
// resolvable by Node's plain ESM resolver outside the Next.js build - these are source-level
// wiring/safety checks, matching the convention already used throughout lib/noa/'s other
// *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attentionSource = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

// 1. same vendor on two different order numbers remains two findings
test("1. procurement findings are still keyed per orderNo+vendorKey+kind - no display-text dedupe", () => {
  assert.ok(attentionSource.includes("key: `procurement_missing_eta:${order.orderNo}:${group.dedupeKey}`,"));
  assert.ok(attentionSource.includes("key: `procurement_missing_etd:${order.orderNo}:${group.dedupeKey}`,"));
  // The bullet-rendering helper only changes display text - it is never used to decide whether a
  // finding is pushed, and nothing filters/collapses `findings` by title or vendor label alone.
  assert.ok(!/\.filter\([^)]*title/.test(attentionSource));
  assert.ok(!/new Set\([^)]*title/.test(attentionSource));
});

// N2A3.3: the bullet prefix moved from bare entityIdentifier (orderNo alone) to the existing
// `detail` field (`${order.orderNo} · ${order.reference}`), so the Project File name is visible
// too - see noa-phase-n2a3-3-safety.test.mts for the full N2A3.3 checklist. This test is updated
// to match, still proving Project context is present for both ETA and ETD findings.
// 2/3/4. deterministic text includes orderNo (via `detail`) for procurement (ETA + ETD) findings
test("2/3/4. the deterministicText bullet line for procurement findings (ETA and ETD) includes Project File context (orderNo + reference)", () => {
  assert.ok(attentionSource.includes('const attentionBulletText = (item: NoaAttentionItem) => item.sourceDomain === "Procurement" && item.detail'));
  assert.ok(attentionSource.includes("`${item.detail} · ${item.title}`"));
  assert.ok(attentionSource.includes("...items.map((item) => `• ${attentionBulletText(item)}.`),"));
  // ETA, ETD (procurement) and the overdue-payment finding all still carry entityIdentifier:
  // order.orderNo (unchanged from N2A1/N2A2) - it's just no longer what the Procurement bullet
  // prefix itself reads from (that's `detail` now).
  assert.equal((attentionSource.match(/entityIdentifier: order\.orderNo,/g) ?? []).length, 3);
});

// 5. Product Price wording unchanged
test("5. Product Price title/detail construction is byte-for-byte unchanged", () => {
  assert.ok(attentionSource.includes('title: status.key === "due" ? `${name} is due for a price check` : `${name} needs a price check`,'));
  assert.ok(attentionSource.includes("detail: status.detail,"));
});

// 6. Client Payment wording unchanged
test("6. Client Payment title/detail construction is byte-for-byte unchanged", () => {
  assert.ok(attentionSource.includes("title: `${installment.title} is overdue`,"));
  assert.ok(attentionSource.includes("detail: `${order.orderNo} · ${formatPaymentMoney(order.currency, moneyToFils(installment.expected_amount))} · Due ${clientPaymentDueLabel(installment)}`,"));
});

// 7. no new query added
test("7. no new Supabase query was introduced", () => {
  // N2A1 (product_templates, brands, brand_price_list_updates, quotation_items,
  // procurement_vendor_progress) + N2A2 (client_payment_schedules, client_payment_installments,
  // client_payment_receipts) = 8 total Supabase .from("...") call sites in this file, unchanged
  // by this presentation-only phase. (Array.from(...) is unrelated JS, deliberately excluded by
  // requiring a quote right after the opening paren.)
  assert.equal((attentionSource.match(/\.from\("/g) ?? []).length, 8);
});

// 8. no new auth logic added
test("8. no new auth gate/helper was introduced", () => {
  assert.equal((attentionSource.match(/await require(ActiveUser|ProductLibraryManager|ProcurementManager)\(\)/g) ?? []).length, 3);
  assert.equal((attentionSource.match(/canViewClientPayments\(profileRole\)/g) ?? []).length, 1);
});

// 9. no severity/ranking added
test("9. no severity/priority/rank/score field was introduced", () => {
  assert.ok(!/\b(severity|priority|rank|score)\s*:/i.test(attentionSource));
});

// 10. count behavior unchanged
test("10. count is still items.length after the same MAX_ATTENTION_ITEMS bound, unaffected by display text", () => {
  assert.ok(attentionSource.includes("const items = [...priceItems, ...procurementItems, ...paymentItems].slice(0, MAX_ATTENTION_ITEMS);"));
  assert.ok(attentionSource.includes("const count = items.length;"));
});
