import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runPreSendChecks, type PreSendDocument, type PreSendInput, type PreSendRow } from "./pre-send-checks";

const goodDocument: PreSendDocument = { clientName: "Acme Trading", contactEmail: "buyer@acme.test", paymentTerms: "50% advance", validity: "30 days", deliveryTerms: "8 weeks" };
const row = (patch: Partial<PreSendRow> = {}): PreSendRow => ({
  id: "r1", rowNumber: 1, name: "Buddy", itemType: "product", countsInTotals: true, qty: 2, unitPrice: 500, discountType: "amount", discountValue: 0,
  hasImage: true, hasSpecification: true, ...patch,
});
const input = (patch: Partial<PreSendInput> = {}): PreSendInput => ({
  rows: [row()], sections: [{ id: "s1", title: "Ground floor", itemCount: 1 }], finalTotal: 1000, document: goodDocument, ...patch,
});
const codes = (checks: ReturnType<typeof runPreSendChecks>) => checks.map((check) => check.code);

test("a fine quotation has no reminders", () => {
  assert.deepEqual(runPreSendChecks(input()), []);
});

test("errors: unit price 0, quantity 0 or empty, final total 0, a discount larger than the price; messages name the row and the item", () => {
  const price = runPreSendChecks(input({ rows: [row({ rowNumber: 3, name: "Buddy", unitPrice: 0 })] }));
  assert.deepEqual(price.map((check) => [check.severity, check.code, check.message, check.target]), [["error", "unit_price_missing", "Row 3 (Buddy): unit price is 0.", { kind: "row", id: "r1" }]]);
  assert.equal(runPreSendChecks(input({ rows: [row({ qty: 0 })] }))[0].message, "Row 1 (Buddy): quantity is 0.");
  assert.deepEqual(codes(runPreSendChecks(input({ rows: [row({ qty: Number.NaN })] }))), ["quantity_missing"]);
  assert.deepEqual(runPreSendChecks(input({ finalTotal: 0 })).map((check) => [check.code, check.message, check.target]), [["final_total_zero", "The final total is 0.", undefined]]);
  assert.equal(runPreSendChecks(input({ rows: [row({ discountType: "amount", discountValue: 600 })] }))[0].message, "Row 1 (Buddy): the discount is larger than the price.");
  assert.deepEqual(codes(runPreSendChecks(input({ rows: [row({ discountType: "percent", discountValue: 120 })] }))), ["discount_too_large"]);
  assert.deepEqual(runPreSendChecks(input({ rows: [row({ discountType: "percent", discountValue: 100 })] })), [], "a 100% or equal discount is not larger than the price");
  assert.deepEqual(runPreSendChecks(input({ rows: [row({ discountType: "amount", discountValue: 500 })] })), []);
});

test("warnings: missing image, empty specification (product rows), empty section, terms and client fields", () => {
  const rows = runPreSendChecks(input({ rows: [row({ hasImage: false, hasSpecification: false })] }));
  assert.deepEqual(rows.map((check) => [check.severity, check.message]), [["warning", "Row 1 (Buddy): no proposed item image."], ["warning", "Row 1 (Buddy): the specification is empty."]]);
  assert.deepEqual(codes(runPreSendChecks(input({ rows: [row({ itemType: "custom", hasImage: false, hasSpecification: false })] }))), [], "image and specification are only asked of product rows");
  const section = runPreSendChecks(input({ sections: [{ id: "s2", title: "Reception", itemCount: 0 }] }));
  assert.deepEqual(section.map((check) => [check.message, check.target]), [['Section "Reception" has no rows.', { kind: "section", id: "s2" }]]);
  const document = runPreSendChecks(input({ document: { clientName: "", contactEmail: " ", paymentTerms: "", validity: "", deliveryTerms: "" } }));
  assert.deepEqual(document.map((check) => check.message), ["The client name is missing.", "The client email is missing.", "Payment terms are empty.", "Validity is empty.", "Delivery terms are empty."]);
  assert.ok(document.every((check) => check.severity === "warning" && check.target?.kind === "document"));
  assert.deepEqual(runPreSendChecks(input({ document: { ...goodDocument, clientName: "-" } })).map((check) => check.code), ["client_name_missing"]);
  assert.deepEqual(runPreSendChecks(input({ document: null })), [], "no document facts: those checks are skipped");
  assert.deepEqual(runPreSendChecks(input({ document: undefined })), []);
});

test("rows that are notes, blank, headings, subtotals, optional-not-included or rate-only are skipped", () => {
  const bad = { unitPrice: 0, qty: 0, hasImage: false, hasSpecification: false };
  for (const itemType of ["note", "blank", "heading", "subtotal"]) assert.deepEqual(runPreSendChecks(input({ rows: [row({ itemType, ...bad })] })), [], itemType);
  assert.deepEqual(runPreSendChecks(input({ rows: [row({ countsInTotals: false, ...bad })] })), [], "optional rows that are not in the total");
});

test("errors come first, then warnings, each in row order; every message is short plain English", () => {
  const checks = runPreSendChecks({
    rows: [row({ id: "a", rowNumber: 1, name: "Alpha", hasImage: false }), row({ id: "b", rowNumber: 2, name: "", unitPrice: 0 })],
    sections: [{ id: "s", title: "", itemCount: 0 }],
    finalTotal: 0,
    document: { ...goodDocument, validity: "" },
  });
  assert.deepEqual(checks.map((check) => check.severity), ["error", "error", "warning", "warning", "warning"]);
  assert.deepEqual(checks.map((check) => check.message), [
    "Row 2 (unnamed item): unit price is 0.",
    "The final total is 0.",
    "Row 1 (Alpha): no proposed item image.",
    "Validity is empty.",
    'Section "Untitled" has no rows.',
  ]);
  assert.equal(new Set(checks.map((check) => check.id)).size, checks.length, "stable unique ids");
  for (const check of checks) assert.ok(check.message.length < 70 && !/[{}_]/.test(check.message), check.message);
});

test("the function is pure and read-only: no imports, no prices recomputed, nothing mutated", () => {
  const source = readFileSync(new URL("./pre-send-checks.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /^import |localStorage|sessionStorage|fetch\(|quotation-pricing|workspaceTotals|itemLinePricing/m);
  const frozen = Object.freeze(input({ rows: Object.freeze([Object.freeze(row({ unitPrice: 0 }))]) as never }));
  assert.doesNotThrow(() => runPreSendChecks(frozen));
});
