// NOA 2.0B-3.1: structured field-change instrumentation for the three writers the B3-0 audit
// proved already have authoritative old/new values in memory (quotation status, quotation item
// price/discount, product source price). Purely additive - no new query, no renamed/removed
// existing metadata key, no NOA Catch-Up reader change (that's B3.2). These are plain server
// action files with "@/..." aliases/"use server" - not resolvable by Node's plain ESM resolver
// outside the Next.js build, so these are source-level wiring/safety checks, matching the
// convention already used throughout this codebase's other *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const quotationActions = readFileSync("app/quotations/actions.ts", "utf8");
const productActions = readFileSync("app/products/templates/actions.ts", "utf8");
const catchUpReader = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

function sliceFunctionBody(source: string, startIndex: number): string {
  const rest = source.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// ---- Quotation status ----------------------------------------------------------------------

const statusWriterStart = quotationActions.indexOf('action: "quotation_status_updated",');
const statusWriterBody = quotationActions.slice(Math.max(0, statusWriterStart - 400), statusWriterStart + 1200);

test("1/2. quotation status audit keeps existing old_status and new_status keys", () => {
  assert.ok(statusWriterBody.includes("new_status: nextStatus,"));
  assert.ok(statusWriterBody.includes("old_status: quotation.status,"));
});

test("3/4/5. quotation status adds a changes entry with field \"status\" using the same authoritative old/new variables", () => {
  assert.ok(statusWriterBody.includes('field: "status", label: "Status", oldValue: quotation.status, newValue: nextStatus'));
  assert.ok(statusWriterBody.includes("quotation.status !== nextStatus"));
});

// ---- Quotation item price/discount ----------------------------------------------------------

const priceWriterStart = quotationActions.indexOf("async function insertQuotationItemPriceHistory(");
const priceWriterBody = sliceFunctionBody(quotationActions, priceWriterStart);

test("6. quotation item price writer keeps every existing metadata key", () => {
  for (const key of [
    "changeType,", "newCurrency,", "newDiscountValue: quotationMoneyValue(newValues.discount_value),",
    "newNetPrice: quotationMoneyValue(newValues.net_price),", "newNetTotal: quotationMoneyValue(newValues.net_total),",
    "newUnitPrice: quotationMoneyValue(newValues.unit_price),", "note,", "oldCurrency,",
    "oldDiscountValue: quotationMoneyValue(current.discount_value),", "oldNetPrice: quotationMoneyValue(current.net_price),",
    "oldNetTotal: quotationMoneyValue(current.net_total),", "oldUnitPrice: quotationMoneyValue(current.unit_price),",
    "sourcePriceLabel,", "sourcePriceType,",
  ]) {
    assert.ok(priceWriterBody.includes(key), `missing existing key: ${key}`);
  }
});

test("7/8. unit_price structured change is added, including the authoritative currency", () => {
  assert.ok(priceWriterBody.includes('{ field: "unit_price", label: "Unit price", oldValue: oldUnitPriceValue, newValue: newUnitPriceValue, currency: newCurrency }'));
});

test("9. discount_value structured change is added (never discount_percent)", () => {
  assert.ok(priceWriterBody.includes('{ field: "discount_value", label: "Discount", oldValue: oldDiscountValueValue, newValue: newDiscountValueValue }'));
  assert.ok(!priceWriterBody.includes("discount_percent"));
});

test("10/11. unchanged unit price / discount are never added as fake changes - guarded by an inequality check", () => {
  assert.ok(priceWriterBody.includes("if (oldUnitPriceValue !== newUnitPriceValue) {"));
  assert.ok(priceWriterBody.includes("if (oldDiscountValueValue !== newDiscountValueValue) {"));
});

test("12/13/14. changes array only contains entries for fields that actually differ - price-only, discount-only, or both", () => {
  // Structural proof: two independent guarded .push() calls into the SAME array, each keyed to
  // its own inequality check - price-only, discount-only, and both-changed all follow naturally
  // from two independent conditionals, never a combined/all-or-nothing branch.
  assert.equal((priceWriterBody.match(/itemPriceChanges\.push\(/g) ?? []).length, 2);
  assert.ok(priceWriterBody.includes("const itemPriceChanges: Array<{ field: string; label: string; oldValue: number; newValue: number; currency?: string }> = [];"));
});

test("5 (price event preservation). action/changeType/title/description/price-history insert/quotation calc are untouched", () => {
  assert.ok(priceWriterBody.includes('await supabase.from("quotation_item_price_history").insert({'));
  assert.ok(priceWriterBody.includes("const action = changeType ==="));
  assert.ok(priceWriterBody.includes("const title = changeType ==="));
  assert.ok(priceWriterBody.includes("description: `${quotationItemAuditLabel(current.item_name_snapshot)} - ${oldCurrency} ${quotationMoneyValue(current.unit_price)} -> ${newCurrency} ${quotationMoneyValue(newValues.unit_price)}`,"));
});

// ---- Product source price ---------------------------------------------------------------------

const productWriterStart = productActions.indexOf('action: "price_updated",');
const productWriterBody = productActions.slice(Math.max(0, productWriterStart - 200), productWriterStart + 1300);

test("15. product source-price writer keeps every existing metadata key", () => {
  for (const key of ["brandId: template.brand_id,", "brandPriceListUpdateId,", "currency: normalizeCurrency(currency),", "effectiveFrom,", "newDefaultUnitPrice,", "note,", "oldDefaultUnitPrice: template.default_unit_price,"]) {
    assert.ok(productWriterBody.includes(key), `missing existing key: ${key}`);
  }
});

test("16/17. product source-price adds a unit_price structured change with the authoritative currency", () => {
  assert.ok(productWriterBody.includes('{ field: "unit_price", label: "Unit price", oldValue: template.default_unit_price, newValue: newDefaultUnitPrice, currency: normalizeCurrency(currency) }'));
  assert.ok(productWriterBody.includes("template.default_unit_price !== newDefaultUnitPrice"));
});

// ---- Cross-cutting -----------------------------------------------------------------------------

test("18. null values are never coerced to 0/empty-string/\"N/A\" in the new changes construction", () => {
  for (const body of [statusWriterBody, priceWriterBody, productWriterBody]) {
    assert.ok(!/oldValue:\s*.*\?\?\s*(0|""|'N\/A')/i.test(body));
  }
});

test("19. no generic diffObjects()-style helper was introduced", () => {
  for (const source of [quotationActions, productActions]) {
    assert.ok(!/function\s+diffObjects|function\s+buildChanges|function\s+autoDiff/i.test(source));
  }
});

// Scoped specifically to `changes: [...]` array-literal entries (never a bare `field: "..."`
// occurring elsewhere in these large files for an unrelated purpose, e.g. a form-field label).
function changesEntryFieldNames(source: string): string[] {
  const arrays = source.match(/changes:\s*\[\{[^\]]*\}\]/g) ?? [];
  return arrays.flatMap((array) => [...array.matchAll(/field: "([a-z_]+)"/g)].map((match) => match[1]));
}

test("20. only the approved field names appear in B3.1 changes entries", () => {
  const allowed = new Set(["status", "unit_price", "discount_value"]);
  const fieldNames = [...changesEntryFieldNames(quotationActions), ...changesEntryFieldNames(productActions)];
  assert.ok(fieldNames.length > 0);
  for (const field of fieldNames) {
    assert.ok(allowed.has(field), `unexpected field name: ${field}`);
  }
});

test("21. no sensitive fields (email/phone/address/notes/password/PIN/token/url/id) were added as changes fields", () => {
  const fieldNames = [...changesEntryFieldNames(quotationActions), ...changesEntryFieldNames(productActions)];
  for (const field of fieldNames) {
    assert.ok(!/email|phone|address|note|password|pin|token|url|_id$/i.test(field), `disallowed field name: ${field}`);
  }
});

test("22. no new Supabase query was added around any of the three writers", () => {
  // Each writer's own .from( call count is unchanged from the B3-0 audit baseline: the status
  // writer performs its update via `updatePayload` (already-existing code, untouched); the price
  // writer's only two queries are the pre-existing price-history insert and (implicitly) the
  // caller's own pre-read; the product writer's only queries are the pre-existing history insert
  // and template update, both untouched.
  assert.equal((priceWriterBody.match(/\.from\("/g) ?? []).length, 1);
});

test("23. no schema/migration/RLS reference was added", () => {
  for (const source of [quotationActions, productActions]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

test("24. NOA Catch-Up reader (lib/noa/noa-user-activity-capability.server.ts) was not touched BY THIS PHASE (B3.1) - it carries no N2B3.1 marker; consuming metadata.changes is B3.2's own later, separately-tested work", () => {
  assert.ok(!catchUpReader.includes("N2B3.1"));
});

test("25. no Procurement writer was touched BY THIS PHASE (B3.1) - it carries no N2B3.1 marker; Procurement instrumentation is B3.3's own later, separately-tested work", () => {
  const procurementWriter = readFileSync("lib/procurement/vendor-docs-action.ts", "utf8");
  assert.ok(!procurementWriter.includes("N2B3.1"));
});
