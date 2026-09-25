// NOA 2.0A-3.3: Attention Center - human-readable Project context in Procurement findings
// (presentation only; the N2A-3.2 audit proved the bounded Project File object already carries
// orderNo/reference/clientName at zero extra query cost). noa-attention-capability.server.ts has
// "@/..." aliases and/or `import "server-only"`, neither resolvable by Node's plain ESM resolver
// outside the Next.js build - these are source-level wiring/safety checks, matching the
// convention already used throughout lib/noa/'s other *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const attentionSource = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

function sliceFunctionBody(source: string, startIndex: number): string {
  const rest = source.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// 1. Procurement finding still contains orderNo
test("1. procurement finding detail still contains order.orderNo", () => {
  assert.ok(attentionSource.includes("const detail = `${order.orderNo} · ${order.reference}`;"));
});

// 2. Procurement finding now contains order.reference
test("2. procurement finding detail now also contains order.reference (Project File title)", () => {
  const procurementStart = attentionSource.indexOf("async function procurementFindings(");
  const procurementBody = sliceFunctionBody(attentionSource, procurementStart);
  assert.ok(procurementBody.includes("order.reference"));
});

// 3/4/5/6. no new Supabase query added - no clients/quotations/projects query for presentation
test("3/4/5/6. no new Supabase query was introduced - no clients/projects query, and quotations are read only via the existing shared allProjectFiles()/activeOrders path", () => {
  assert.equal((attentionSource.match(/\.from\("/g) ?? []).length, 8);
  assert.ok(!attentionSource.includes('.from("clients")'));
  assert.ok(!attentionSource.includes('.from("projects")'));
  // procurementFindings() legitimately still reads quotation_items/procurement_vendor_progress
  // (unchanged from N2A1) - this phase adds no THIRD/new .from() call to that function.
  const procurementStart = attentionSource.indexOf("async function procurementFindings(");
  const procurementBody = sliceFunctionBody(attentionSource, procurementStart);
  assert.equal((procurementBody.match(/\.from\("/g) ?? []).length, 2);
});

// 7. same vendor on different Project Files remains separate
test("7. procurement findings are still keyed per orderNo+vendorKey+kind - no display-text dedupe", () => {
  assert.ok(attentionSource.includes("key: `procurement_missing_eta:${order.orderNo}:${group.dedupeKey}`,"));
  assert.ok(attentionSource.includes("key: `procurement_missing_etd:${order.orderNo}:${group.dedupeKey}`,"));
  assert.ok(!/\.filter\([^)]*title/.test(attentionSource));
});

// 8. ETA and ETD remain separate
test("8. missing ETA and missing ETD remain two independent findings, never merged", () => {
  assert.ok(attentionSource.includes("if (!progress?.eta) {"));
  assert.ok(attentionSource.includes("if (!progress?.etd) {"));
  assert.ok(!attentionSource.includes("ETA/ETD"));
});

// 9. no UUID displayed
test("9. no UUID is surfaced in the new title/detail wording", () => {
  const findingsStart = attentionSource.indexOf("const findings: NoaAttentionItem[] = [];", attentionSource.indexOf("async function procurementFindings("));
  const findingsBlock = sliceFunctionBody(attentionSource, findingsStart);
  assert.ok(!/title:.*\bid\b|detail:.*quotationId/.test(findingsBlock));
  assert.ok(findingsBlock.includes("entityIdentifier: order.orderNo,"));
});

// 10. no HTML entities introduced
test("10. no HTML entity/tag artifacts were introduced by the new wording", () => {
  assert.ok(!attentionSource.includes("&#x20;"));
  assert.ok(!attentionSource.includes("&nbsp;"));
  assert.ok(!/<br\s*\/?>/i.test(attentionSource));
});

// 11. Product Price behavior unchanged
test("11. Product Price title/detail construction is byte-for-byte unchanged", () => {
  assert.ok(attentionSource.includes('title: status.key === "due" ? `${name} is due for a price check` : `${name} needs a price check`,'));
  assert.ok(attentionSource.includes("detail: status.detail,"));
});

// 12. Client Payment behavior unchanged
test("12. Client Payment title/detail construction is byte-for-byte unchanged", () => {
  assert.ok(attentionSource.includes("title: `${installment.title} is overdue`,"));
  assert.ok(attentionSource.includes("detail: `${order.orderNo} · ${formatPaymentMoney(order.currency, moneyToFils(installment.expected_amount))} · Due ${clientPaymentDueLabel(installment)}`,"));
});

// 13. auth helpers unchanged
test("13. auth helpers/gates are unchanged", () => {
  assert.equal((attentionSource.match(/await require(ActiveUser|ProductLibraryManager|ProcurementManager)\(\)/g) ?? []).length, 3);
  assert.equal((attentionSource.match(/canViewClientPayments\(profileRole\)/g) ?? []).length, 1);
});

// 14. no salesperson/owner filter introduced
test("14. no salesperson/owner/created_by filtering was introduced", () => {
  assert.ok(!/salesperson|salesperson_id|created_by|owner_id|assigned_to/i.test(attentionSource));
});

// 15. no severity/ranking wording introduced
test("15. no severity/priority/rank/score field, and no late/stalled/urgent/critical/delayed wording, was introduced into Procurement's title/detail", () => {
  assert.ok(!/\b(severity|priority|rank|score)\s*:/i.test(attentionSource));
  // Checked against the Procurement finding's own title/detail STRING LITERALS only (never
  // "overdue" here - that word IS legitimately used elsewhere by the unrelated, pre-existing
  // Client Payment finding, which this test must not flag). Comments explaining why these words
  // are avoided are expected and fine; only a real user-facing string would be a violation.
  const procurementStart = attentionSource.indexOf("async function procurementFindings(");
  const procurementBody = sliceFunctionBody(attentionSource, procurementStart);
  const titleLiterals = procurementBody.match(/title:\s*`[^`]*`/g) ?? [];
  const detailLiterals = procurementBody.match(/detail:\s*[a-zA-Z`][^,]*/g) ?? [];
  assert.ok(titleLiterals.length >= 2);
  for (const literal of [...titleLiterals, ...detailLiterals]) {
    assert.ok(!/\b(late|stalled|urgent|critical|delayed)\b/i.test(literal), literal);
  }
});

// 16. Attention count behavior unchanged
test("16. count is still items.length after the same MAX_ATTENTION_ITEMS bound, unaffected by display text", () => {
  assert.ok(attentionSource.includes("const items = [...priceItems, ...procurementItems, ...paymentItems].slice(0, MAX_ATTENTION_ITEMS);"));
  assert.ok(attentionSource.includes("const count = items.length;"));
});

// wording: title uses the preferred "— ETA/ETD missing" phrasing
test("wording: procurement titles use the preferred em-dash phrasing, never invented urgency", () => {
  assert.ok(attentionSource.includes("title: `${group.displayLabel} — ETA missing`,"));
  assert.ok(attentionSource.includes("title: `${group.displayLabel} — ETD missing`,"));
  assert.ok(!attentionSource.includes("has no ETA"));
  assert.ok(!attentionSource.includes("has no ETD"));
});

// client name decision: deliberately NOT added to the visible bullet (Part 3 of the task) - only
// orderNo + reference are used for the Procurement bullet prefix.
test("client-name decision: clientName is not appended to the Procurement bullet prefix", () => {
  const procurementStart = attentionSource.indexOf("async function procurementFindings(");
  const procurementBody = sliceFunctionBody(attentionSource, procurementStart);
  assert.ok(!procurementBody.includes("order.clientName"));
});
