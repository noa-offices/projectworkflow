import assert from "node:assert/strict";
import test from "node:test";
import type { SmartSetupSupplierCheckResult } from "./smart-setup-supplier-check";
import { decisionKey, type ReviewDecision, type SavedReviewDecision } from "./supplier-review-decisions";
import { buildReviewRows, countReviewStatuses, DEFAULT_REVIEW_STATUSES, filterReviewedRows, filterReviewRows, isReviewedRow, priceDifference, reviewRowsToCsv, sortReviewRows, toggleReviewStatus, type ReviewStatus } from "./smart-setup-supplier-review";

const result = (over: Partial<SmartSetupSupplierCheckResult>): SmartSetupSupplierCheckResult => ({ locator: "l", role: "main_product", code: "A1", priceField: "unit_price", dimension: "", status: "MATCHED", reason: "same_price", importedPrice: 100, importedCurrency: "EUR", referencePrice: 100, referenceCurrency: "EUR", source: { versionId: "v", definitionId: "d", title: "T", currency: "EUR", basis: "list" }, evidence: { identityKey: "k", sheet: "S1", rowNumber: 7, sourceRowCount: null }, ...over });
const rows = (list: Partial<SmartSetupSupplierCheckResult>[], labels: Record<string, string> = {}) => buildReviewRows(list.map((o, i) => result({ locator: `l${i}`, ...o })), Object.entries(labels).map(([locator, label]) => ({ locator, label, dimensionLabel: "" }) as never));

test("reviewed means a current saved final decision without an unsaved edit", () => {
  const row = rows([{ status: "MISMATCH", importedPrice: 120, referencePrice: 100 }])[0];
  const saved = (decision: ReviewDecision, status: SavedReviewDecision["status"] = "open") => ({ decision, status, supplier_price: 100, currency: "EUR" }) as SavedReviewDecision;
  assert.equal(isReviewedRow(row), false);
  for (const decision of ["use_supplier", "keep_imported", "set_custom", "ignore"] as const) assert.equal(isReviewedRow(row, saved(decision)), true, decision);
  assert.equal(isReviewedRow(row, saved("check_later")), false);
  assert.equal(isReviewedRow(row, saved("ignore", "cancelled")), false);
  assert.equal(isReviewedRow(row, saved("ignore", "applied")), false);
  assert.equal(isReviewedRow(row, saved("ignore"), true), false);
  assert.equal(isReviewedRow(row, { ...saved("ignore"), supplier_price: 90 }), false, "price-changed tag keeps the row visible");
  assert.equal(isReviewedRow(row, { ...saved("ignore"), currency: "USD" }), false);
});

test("reviewed filter keeps edits and check later visible; toggle shows all", () => {
  const reviewRows = rows([{ code: "A" }, { code: "B" }, { code: "C" }]);
  const saved = Object.fromEntries(reviewRows.map((row, i) => [decisionKey(row), { decision: i === 2 ? "check_later" : "ignore", status: "open", supplier_price: 100, currency: "EUR" } as SavedReviewDecision]));
  const edited = new Set([decisionKey(reviewRows[1])]);
  assert.deepEqual(filterReviewedRows(reviewRows, saved, edited, false).map((row) => row.result.code), ["B", "C"]);
  assert.deepEqual(filterReviewedRows(reviewRows, saved, edited, true).map((row) => row.result.code), ["A", "B", "C"]);
});

test("difference: higher, lower, equal, missing and zero supplier price", () => {
  assert.deepEqual(priceDifference(110, 100), { amount: 10, percent: 10 });
  assert.deepEqual(priceDifference(90, 100), { amount: -10, percent: -10 });
  assert.deepEqual(priceDifference(100, 100), { amount: 0, percent: 0 });
  assert.equal(priceDifference(null, 100), null); assert.equal(priceDifference(100, null), null);
  assert.deepEqual(priceDifference(5, 0), { amount: 5, percent: null });
  assert.deepEqual(priceDifference(0.3, 0.1), { amount: 0.2, percent: 200 }); // no float noise
});

test("a difference exists only where the service established a supplier price", () => {
  const r = rows([{ status: "MISMATCH", importedPrice: 120, referencePrice: 100 }, { status: "NEEDS_REVIEW", importedPrice: 10, referencePrice: 9 }, { status: "NOT_FOUND", referencePrice: null }]);
  assert.deepEqual(r.map((x) => x.difference?.amount ?? null), [20, null, null]);
});

test("chips: default is Needs review + Mismatch; toggling adds and removes; counts come from the rows", () => {
  const r = rows([{ status: "MATCHED" }, { status: "MISMATCH" }, { status: "NEEDS_REVIEW" }, { status: "NOT_FOUND" }, { status: "MISMATCH" }]);
  assert.deepEqual(countReviewStatuses(r), { NEEDS_REVIEW: 1, MISMATCH: 2, NOT_FOUND: 1, MATCHED: 1 });
  const active = new Set<ReviewStatus>(DEFAULT_REVIEW_STATUSES);
  assert.equal(filterReviewRows(r, active, "").length, 3);
  const withMatched = toggleReviewStatus(active, "MATCHED");
  assert.equal(filterReviewRows(r, withMatched, "").length, 4); assert.equal(active.has("MATCHED"), false, "input set is not mutated");
  assert.equal(filterReviewRows(r, toggleReviewStatus(withMatched, "MATCHED"), "").length, 3);
  assert.equal(filterReviewRows(r, new Set(), "").length, 0);
});

test("search covers model, code, category and price field, case-insensitively", () => {
  const all = new Set<ReviewStatus>(["MATCHED", "MISMATCH", "NEEDS_REVIEW", "NOT_FOUND"]);
  const r = rows([{ code: "ZX-9", dimension: "Cat B" }, { code: "Q1", priceField: "additional_price" }, { code: "Q2" }], { l2: "Oak Desk" });
  assert.equal(filterReviewRows(r, all, "zx-9").length, 1); assert.equal(filterReviewRows(r, all, "cat b").length, 1);
  assert.equal(filterReviewRows(r, all, "additional price").length, 1); assert.equal(filterReviewRows(r, all, "additional_price").length, 1);
  assert.equal(filterReviewRows(r, all, "oak").length, 1); assert.equal(filterReviewRows(r, all, "  ").length, 3); assert.equal(filterReviewRows(r, all, "nothing").length, 0);
});

test("sorting by status, model/code and difference size is stable", () => {
  const r = rows([{ code: "B2", status: "MATCHED" }, { code: "A10", status: "MISMATCH", importedPrice: 101 }, { code: "A2", status: "MISMATCH", importedPrice: 150 }, { code: "C1", status: "NEEDS_REVIEW", referencePrice: null }]);
  assert.deepEqual(sortReviewRows(r, "status").map((x) => x.result.code), ["A10", "A2", "C1", "B2"]); // Mismatch, Needs review, Matched; ties keep service order
  const named = rows([{ code: "x" }, { code: "y" }, { code: "z" }], { l0: "Model 10", l1: "Model 2", l2: "model 1" });
  assert.deepEqual(sortReviewRows(named, "model").map((x) => x.model), ["model 1", "Model 2", "Model 10"]);
  assert.deepEqual(sortReviewRows(r, "difference").map((x) => x.result.code), ["A2", "A10", "B2", "C1"]); // 50, 1, 0, none
});

test("CSV: BOM, numbers stay numbers, quoting, and formula guard", () => {
  const r = rows([{ code: "=SUM(A1)", status: "MISMATCH", importedPrice: 120, referencePrice: 100 }, { code: "-5", dimension: 'He said "hi", ok\nnext' }, { code: "@x" }, { code: "+1", dimension: "Cat" }], { l1: "Plain model" });
  const csv = reviewRowsToCsv(r);
  assert.ok(csv.startsWith("﻿Model,Supplier code"));
  const lines = csv.split("\r\n");
  assert.match(lines[1], /^l0,'=SUM\(A1\),unit_price,unit price,main_product,EUR,120,100,20,20,Mismatch,/);
  assert.ok(csv.includes('"He said ""hi"", ok\nnext"')); assert.ok(csv.includes("'-5")); assert.ok(csv.includes("'@x")); assert.ok(csv.includes("'+1"));
  assert.doesNotMatch(lines[1], /'120|'100/); // numbers are never guarded or quoted
  assert.ok(csv.endsWith("\r\n"));
  const missing = reviewRowsToCsv(rows([{ status: "NOT_FOUND", referencePrice: null, importedPrice: null }])).split("\r\n")[1];
  assert.match(missing, /,EUR,,,,,Not found,/);
});
