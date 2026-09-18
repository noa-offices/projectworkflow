import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourcePdf, collectImportedDraftCodes, normalizeSourceQaCode, primarySourceQaFindings, sourceQaReviewStatus } from "./source-qa.js";
import type { ProductTemplateDraft } from "./product-template-draft.js";

const draft = (): ProductTemplateDraft => ({ version: 1, template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: null, pricing: { workstationRows: [], baseModelRows: [{ id: "base", label: null, displayName: null, dimensions: null, currency: null, price: 1, specification: null, supplierCodes: ["IN150", "9ALX201"], referenceCodes: [] }], priceMatrices: [{ id: "matrix", label: null, columns: [{ id: "a", label: "A" }], rows: [{ id: "matrix-row", label: null, displayName: null, dimensions: null, currency: null, specification: null, supplierCodes: ["IN152E"], referenceCodes: [], prices: { a: 0 } }] }], modularGroups: [{ id: "mod", label: null, defaultDimensions: null, defaultSpecification: null, matrix: { id: "m", label: null, columns: [{ id: "a", label: "A" }], rows: [{ id: "module", label: null, displayName: null, dimensions: null, currency: null, specification: null, supplierCodes: ["173 477"], referenceCodes: [], prices: { a: 1 } }] } }] }, optionGroups: [{ id: "option", label: null, selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [{ id: "accessory", label: null, displayName: null, dimensions: null, currency: null, price: null, specification: null, supplierCodes: ["IN150E"], referenceCodes: [] }] }], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [] });

test("normalizes conservative source codes", () => { assert.equal(normalizeSourceQaCode(" 9alx201 "), "9ALX201"); assert.equal(normalizeSourceQaCode("173   477"), "173 477"); assert.equal(normalizeSourceQaCode("IN - 150E"), "IN-150E"); });
test("compares pages with imported base, matrix, modular, and accessory codes without mutation", () => { const value = draft(); const before = structuredClone(value); const findings = analyzeSourcePdf("source", [{ pageNumber: 6, text: "DOUBLE MEETING TABLE CONFIGURATION\nIN150 IN152E IN190 IN190\n173 477" }], value); assert.deepEqual(value, before); assert.equal(findings.find((item) => item.normalizedCode === "IN150")?.status, "matched"); assert.equal(findings.find((item) => item.normalizedCode === "IN152E")?.status, "matched"); assert.equal(findings.find((item) => item.normalizedCode === "IN190")?.status, "missing_candidate"); assert.equal(findings.find((item) => item.normalizedCode === "IN190")?.occurrenceCount, 2); assert.equal(findings.find((item) => item.normalizedCode === "IN190")?.pageNumber, 6); assert.equal(findings.find((item) => item.normalizedCode === "IN190")?.section, "DOUBLE MEETING TABLE CONFIGURATION"); assert.ok(collectImportedDraftCodes(value).has("173 477")); });
test("missing candidates can be ignored in session", () => { const findings = analyzeSourcePdf("source", [{ pageNumber: 1, text: "ART. IN140" }], draft(), new Set(["IN140"])); assert.equal(findings[0].status, "intentionally_ignored"); });
test("treats imported-family codes as actionable high-confidence candidates", () => { const value = draft(); value.pricing.baseModelRows[0].supplierCodes = ["9ALX201"]; value.optionGroups[0].items[0].supplierCodes = []; const findings = analyzeSourcePdf("source", [{ pageNumber: 6, text: "DOUBLE MEETING TABLE CONFIGURATION\nIN150 IN150E" }], value); assert.deepEqual(primarySourceQaFindings(findings).map((item) => item.normalizedCode), ["IN150", "IN150E"]); assert.ok(primarySourceQaFindings(findings).every((item) => item.confidence === "high")); });
test("filters prose and measurement noise while surfacing high-confidence missing codes", () => { const findings = analyzeSourcePdf("source", [{ pageNumber: 6, text: "DOUBLE MEETING TABLE CONFIGURATION\nIN150E AUX9045 PAS7022 9ALX201 173 477 of 675 x 120 black 300 with 80 26 mm RJ45" }], draft()); const codes = findings.map((item) => item.normalizedCode); ["OF 675", "X 120", "BLACK 300", "WITH 80", "26 MM", "RJ45"].forEach((value) => assert.equal(codes.includes(value), false)); ["AUX9045", "PAS7022"].forEach((value) => assert.equal(primarySourceQaFindings(findings).some((item) => item.normalizedCode === value), true, value)); assert.equal(findings.find((item) => item.normalizedCode === "9ALX201")?.confidence, "high"); assert.ok(findings.every((item) => item.snippet.length <= 280)); });
test("keeps only high, unignored, in-scope missing codes in the primary list and refreshes when draft codes change", () => { const pages = [{ pageNumber: 6, text: "DOUBLE MEETING TABLE CONFIGURATION\nIN180" }, { pageNumber: 7, text: "BENCH TABLE\nIN181" }]; const value = draft(); const findings = analyzeSourcePdf("source", pages, value); assert.deepEqual(primarySourceQaFindings(findings).map((item) => item.normalizedCode), ["IN180"]); assert.equal(findings.find((item) => item.normalizedCode === "IN181")?.outOfScope, true); assert.equal(primarySourceQaFindings(analyzeSourcePdf("source", pages, value, new Set(["IN180"]))).length, 0); value.template.supplierCodes.push("IN180"); assert.equal(analyzeSourcePdf("source", pages, value).find((item) => item.normalizedCode === "IN180")?.status, "matched"); });
test("suppresses unsupported numeric pairs, accepts explicit article evidence, and flags only inconsistent source evidence", () => { const value = draft(); const findings = analyzeSourcePdf("source", [{ pageNumber: 1, text: "TABLE CONFIGURATION\n1250 2450 950 1850" }, { pageNumber: 2, text: "ART. 173 477" }, { pageNumber: 3, text: "CODE IN199 100\nCODE IN199 200" }], value); assert.equal(primarySourceQaFindings(findings).some((item) => item.normalizedCode === "1250 2450"), false); assert.equal(findings.find((item) => item.normalizedCode === "173 477")?.confidence, "high"); assert.equal(findings.find((item) => item.normalizedCode === "IN199")?.status, "conflict"); assert.equal(sourceQaReviewStatus(analyzeSourcePdf("source", [{ pageNumber: 1, text: "BENCH TABLE\nIN181" }], value)), "pass"); assert.equal(sourceQaReviewStatus(analyzeSourcePdf("source", [{ pageNumber: 1, text: "TABLE\nIN180" }], value)), "review_needed"); });

test("distinguishes supplied missing Sigma codes from referenced but unsupplied supplemental pages", () => {
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 28, text: "ART. M85 ART. M92 ART. N01 ART. N16 ART. P77 ART. P91. See pages 38–42 for companion details." }, { pageNumber: 37, text: "ART. M33" }], draft());
  ["M85", "M92", "N01", "N16", "P77", "P91"].forEach((code) => assert.equal(findings.find((finding) => finding.normalizedCode === code)?.status, "missing_candidate", code));
  const reference = findings.find((finding) => finding.status === "referenced_unsupplied_page");
  assert.equal(reference?.sourceCode, "pages 38–42");
  assert.equal(primarySourceQaFindings(findings).some((finding) => finding.status === "referenced_unsupplied_page"), false);
});

test("retains supported alpha-numeric and explicitly marked numeric codes while rejecting unmarked numeric noise", () => {
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 30, text: "ART. 1AJ P75 ART. 173 477. Dimensions 35 35 and 120 160." }], draft());
  assert.equal(findings.find((finding) => finding.normalizedCode === "1AJ P75")?.confidence, "high");
  assert.equal(findings.find((finding) => finding.normalizedCode === "173 477")?.confidence, "high");
  ["35 35", "120 160"].forEach((noise) => assert.equal(findings.some((finding) => finding.normalizedCode === noise), false, noise));
});

test("1: a bare terminal article code found on the PDF (M34) matches an imported full code (1AJ M34)", () => {
  const value = draft();
  value.pricing.baseModelRows[0].supplierCodes = ["1AJ M34"];
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 30, text: "ART. M34" }], value);
  assert.equal(findings.find((finding) => finding.normalizedCode === "M34")?.status, "matched");
});

test("2: a bare terminal article code found on the PDF (P75) matches an imported full code (1AJ P75)", () => {
  const value = draft();
  value.pricing.baseModelRows[0].supplierCodes = ["1AJ P75"];
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 30, text: "ART. P75" }], value);
  assert.equal(findings.find((finding) => finding.normalizedCode === "P75")?.status, "matched");
});

test("2b: a full prefixed code found on the PDF (1AJ M34) matches an imported bare terminal code (M34)", () => {
  const value = draft();
  value.pricing.baseModelRows[0].supplierCodes = ["M34"];
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 30, text: "ART. 1AJ M34" }], value);
  assert.equal(findings.find((finding) => finding.normalizedCode === "1AJ M34")?.status, "matched");
});

test("3: unrelated terminal codes do not become equivalent by prefix-aware matching", () => {
  const value = draft();
  value.pricing.baseModelRows[0].supplierCodes = ["1AJ M34"];
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 30, text: "ART. M35" }], value);
  assert.equal(findings.find((finding) => finding.normalizedCode === "M35")?.status, "missing_candidate");
});

test("4: numeric-pair noise suppression is unaffected by prefix-aware matching", () => {
  const value = draft();
  value.pricing.baseModelRows[0].supplierCodes = ["1AJ M34"];
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 1, text: "TABLE CONFIGURATION\n120 70 and 35 35" }], value);
  assert.equal(primarySourceQaFindings(findings).some((finding) => finding.normalizedCode === "120 70"), false);
  assert.equal(primarySourceQaFindings(findings).some((finding) => finding.normalizedCode === "35 35"), false);
});

test("5: existing exact full-code matches still work unchanged", () => {
  const value = draft();
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 30, text: "ART. IN150 ART. 9ALX201" }], value);
  assert.equal(findings.find((finding) => finding.normalizedCode === "IN150")?.status, "matched");
  assert.equal(findings.find((finding) => finding.normalizedCode === "9ALX201")?.status, "matched");
});

test("6: legitimate explicit-evidence numeric-code behavior remains unchanged", () => {
  const value = draft();
  const findings = analyzeSourcePdf("sigma", [{ pageNumber: 2, text: "ART. 173 477" }], value);
  assert.equal(findings.find((finding) => finding.normalizedCode === "173 477")?.confidence, "high");
  assert.equal(findings.find((finding) => finding.normalizedCode === "173 477")?.status, "matched");
});
