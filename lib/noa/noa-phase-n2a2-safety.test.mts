// NOA 2.0A-2: Attention Center - overdue Client Payment findings, appended to the existing N2A1
// Attention capability. noa-attention-capability.server.ts has "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build - these are source-level wiring/safety checks, matching the convention already used
// throughout lib/noa/'s other *-safety.test.mts files (including noa-phase-n2a1-safety.test.mts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attentionSource = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const paymentModelSource = readFileSync("lib/projects/client-payment-model.ts", "utf8");
const authSource = readFileSync("lib/auth.ts", "utf8");

// 1. ClientPayment is NOT added to global NoaDomain
test("1. ClientPayment is not added to the global NoaDomain", () => {
  const domainLine = typesSource.match(/export type NoaDomain = .*;/)?.[0] ?? "";
  assert.ok(domainLine.includes('"Attention"'));
  assert.ok(!domainLine.includes('"ClientPayment"'));
});

// 2. Attention local sourceDomain supports ClientPayment
test("2. the Attention-local sourceDomain type supports ClientPayment", () => {
  assert.match(attentionSource, /type NoaAttentionSourceDomain = .*"ClientPayment".*;/);
  assert.match(attentionSource, /type NoaAttentionKind = .*"payment_overdue".*;/);
  assert.match(attentionSource, /type NoaAttentionEntityType = .*"installment".*;/);
});

// 3. canViewClientPayments(role) gates payment reads
test("3. canViewClientPayments(role) gates the Client Payment subsection", () => {
  assert.ok(attentionSource.includes('import { canViewClientPayments, requireActiveUser, requireProcurementManager, requireProductLibraryManager } from "@/lib/auth";'));
  assert.ok(attentionSource.includes("const clientPaymentsAvailable = canViewClientPayments(profileRole);"));
  assert.ok(!/function\s+requireClientPayments|await\s+requireClientPayments\(/.test(attentionSource));
});

// 4. unauthorized payment subsection performs no payment-table reads
test("4. the payment tables are only ever read when clientPaymentsAvailable is true", () => {
  assert.ok(attentionSource.includes("const paymentItems = clientPaymentsAvailable ? await clientPaymentFindings(supabase, activeOrders) : [];"));
});

// 5. payment denial does not remove Product findings
test("5. a Client Payment denial does not affect Product Price findings", () => {
  const priceIndex = attentionSource.indexOf("priceItems = await productPriceFindings(supabase);");
  const paymentGateIndex = attentionSource.indexOf("const clientPaymentsAvailable = canViewClientPayments(profileRole);");
  assert.ok(priceIndex > -1 && paymentGateIndex > -1);
  assert.ok(priceIndex < paymentGateIndex);
  assert.ok(attentionSource.includes("const items = [...priceItems, ...procurementItems, ...paymentItems]"));
});

// 6. payment denial does not remove Procurement findings
test("6. a Client Payment denial does not affect Procurement findings", () => {
  const procurementIndex = attentionSource.indexOf("procurementItems = await procurementFindings(supabase, activeOrders);");
  const paymentGateIndex = attentionSource.indexOf("const clientPaymentsAvailable = canViewClientPayments(profileRole);");
  assert.ok(procurementIndex > -1 && paymentGateIndex > -1);
  assert.ok(procurementIndex < paymentGateIndex);
});

// 7. ERP Project File bounded set is reused
test("7. the Client Payment subsection reuses the shared bounded active Project File set", () => {
  assert.ok(attentionSource.includes("async function boundedActiveProjectFiles("));
  assert.ok(attentionSource.includes("const activeOrders = await boundedActiveProjectFiles(supabase);"));
  assert.ok(attentionSource.includes("procurementFindings(supabase, activeOrders)"));
  assert.ok(attentionSource.includes("clientPaymentFindings(supabase, activeOrders)"));
  // Only ONE call to allProjectFiles() in the whole file - never a second independent scan.
  assert.equal((attentionSource.match(/allProjectFiles\(supabase\)/g) ?? []).length, 1);
});

// 8. standalone projects table is not queried
test("8. the standalone projects table is never queried", () => {
  assert.ok(!attentionSource.includes('.from("projects")'));
});

// 9. payment schedule query is scoped to bounded project/quotation ids
test("9. client_payment_schedules is queried scoped to the bounded quotation-id set", () => {
  assert.ok(attentionSource.includes('.from("client_payment_schedules")'));
  assert.ok(attentionSource.includes('.in("quotation_id", quotationIds)'));
});

// 10. installment query is scoped to schedule ids
test("10. client_payment_installments is queried scoped to the resulting schedule-id set", () => {
  assert.ok(attentionSource.includes('.from("client_payment_installments")'));
  assert.ok(attentionSource.includes('.in("schedule_id", scheduleIds)'));
});

// 11. receipt query is scoped to schedule/installment ids
test("11. client_payment_receipts is queried scoped to the same schedule-id set", () => {
  assert.ok(attentionSource.includes('.from("client_payment_receipts")'));
  const receiptsQueryStart = attentionSource.indexOf('.from("client_payment_receipts")');
  const nearby = attentionSource.slice(receiptsQueryStart, receiptsQueryStart + 400);
  assert.ok(nearby.includes('.in("schedule_id", scheduleIds)'));
});

// 12. deriveClientPaymentStatus() is reused
test("12. deriveClientPaymentStatus() is imported and called, never reimplemented", () => {
  assert.ok(attentionSource.includes('import {\n  calculateClientPaymentSummary,\n  clientPaymentDueLabel,\n  deriveClientPaymentStatus,\n  formatPaymentMoney,\n  moneyToFils,'));
  assert.ok(attentionSource.includes("deriveClientPaymentStatus(installment, receivedFils, todayIso)"));
  assert.ok(paymentModelSource.includes("export function deriveClientPaymentStatus("));
});

// 13. overdue calculation is not reimplemented locally
test("13. no local reimplementation of the overdue-status algorithm", () => {
  assert.ok(!/function\s+deriveClientPaymentStatus/.test(attentionSource));
  assert.ok(!/due_date\s*<\s*todayIso|status_override\s*===\s*"waived"/.test(attentionSource));
});

// 14. money/fils helper is reused where applicable
test("14. money/fils arithmetic reuses the existing helpers, never a new calculation", () => {
  assert.ok(attentionSource.includes("calculateClientPaymentSummary(order.total, installments, receipts, todayIso)"));
  assert.ok(attentionSource.includes("moneyToFils(installment.expected_amount)"));
  assert.ok(attentionSource.includes("formatPaymentMoney(order.currency"));
  assert.ok(!/function\s+moneyToFils|function\s+formatPaymentMoney|function\s+calculateClientPaymentSummary/.test(attentionSource));
  // No manual subtraction of expected vs received (Part 9's explicit prohibition).
  assert.ok(!/expected_amount\s*-\s*receiv|receiv\w*\s*-\s*expected/i.test(attentionSource));
});

// 15. only "Overdue" creates an Attention item
test('15. a finding is created only when status is exactly "Overdue"', () => {
  assert.ok(attentionSource.includes('if (status !== "Overdue") continue;'));
});

// 16. voided receipts are handled by existing helper semantics
test("16. voided receipts are handled entirely inside the reused summary helper", () => {
  assert.ok(paymentModelSource.includes("if (receipt.voided_at || !receipt.installment_id) continue;"));
  // The Attention capability only ever selects voided_at as a query column (so the row shape
  // matches ClientPaymentReceiptRow for calculateClientPaymentSummary) - it never itself branches
  // on receipt.voided_at.
  assert.ok(!/if\s*\(\s*\w+\.voided_at/.test(attentionSource));
});

// 17. no UUID is surfaced in title/detail/entityIdentifier
test("17. no installment/schedule UUID is surfaced in the payment finding's display fields", () => {
  const findingStart = attentionSource.indexOf("key: `payment_overdue:");
  const findingBlock = attentionSource.slice(findingStart, attentionSource.indexOf("});", findingStart));
  assert.ok(findingBlock.includes("title: `${installment.title} is overdue`,"));
  assert.ok(findingBlock.includes("entityLabel: installment.title,"));
  assert.ok(findingBlock.includes("entityIdentifier: order.orderNo,"));
  assert.ok(!/title:.*installment\.id|entityLabel:.*installment\.id|entityIdentifier:.*installment\.id/.test(findingBlock));
});

// 18. no severity/priority/ranking
test("18. no severity/priority/rank/score field exists on the item contract or any pushed finding", () => {
  const contractStart = attentionSource.indexOf("export type NoaAttentionItem = {");
  const contractBlock = attentionSource.slice(contractStart, attentionSource.indexOf("};", contractStart));
  assert.ok(!/severity|priority|\brank\b|\bscore\b/i.test(contractBlock));
  // No object-literal key of that name assigned anywhere (comments discussing the ABSENCE of
  // these fields, e.g. "never a severity ranking", are expected and fine - only an actual `key:`
  // assignment would be a real violation).
  assert.ok(!/\b(severity|priority|rank|score)\s*:/i.test(attentionSource));
});

// 19. deterministic response still exists
test("19. the deterministic response contract is unchanged - count/items/sections/deterministicText", () => {
  assert.ok(attentionSource.includes("const count = items.length;"));
  assert.ok(attentionSource.includes("sections: { clientPaymentsAvailable, procurementAvailable, productPriceAvailable },"));
  assert.ok(attentionSource.includes("deterministicOnly: true,"));
});

// 20. Product/Procurement behavior remains untouched
test("20. existing Product Price and Procurement finding logic is unchanged", () => {
  assert.ok(attentionSource.includes('if (status.key !== "needs_check" && status.key !== "due") continue;'));
  assert.ok(attentionSource.includes("const MAX_PRICE_SCAN = 200;"));
  assert.ok(attentionSource.includes("if (!progress?.eta) {"));
  assert.ok(attentionSource.includes("if (!progress?.etd) {"));
  assert.ok(attentionSource.includes("buildEffectiveDocumentGroups(items)"));
});

// 21. no provider call added
test("21. no provider/LLM call was introduced", () => {
  assert.ok(!attentionSource.includes("runNoaProvider"));
});

// 22. no schema/RLS change
test("22. canViewClientPayments already existed in lib/auth.ts before this phase - no new gate/RLS was added", () => {
  assert.ok(authSource.includes("export function canViewClientPayments(role: AppRole | null | undefined): boolean {"));
  assert.equal((authSource.match(/export function canViewClientPayments\(/g) ?? []).length, 1);
});
