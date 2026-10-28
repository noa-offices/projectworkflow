import assert from "node:assert/strict";
import test from "node:test";
import { parseFinalSpecificationRequest } from "./final-specification-ai-contract";
import { checkFinalSpecificationSuggestion, finalSpecificationMode, keepDimensionLine } from "./final-specification-ai-check";

const base = { productName: "Chair", currentSpecification: null, selectedModel: null, selectedDimensions: null, selectedFinishLabels: [], selectedOptionLabels: [], selectedAccessoryLabels: [], selectedCompanionLabels: [], selectedRowFacts: [] };

test("the contract: mode is optional and means improve; shorten and improve are accepted; anything else is refused", () => {
  assert.equal(parseFinalSpecificationRequest(base)?.mode, undefined);
  assert.equal(finalSpecificationMode(parseFinalSpecificationRequest(base)!), "improve");
  assert.equal(parseFinalSpecificationRequest({ ...base, mode: "shorten" })?.mode, "shorten");
  assert.equal(finalSpecificationMode(parseFinalSpecificationRequest({ ...base, mode: "improve" })!), "improve");
  assert.equal(parseFinalSpecificationRequest({ ...base, mode: "fancy" }), null);
});

test("Use suggestion keeps the original Dimension line as the last line, unchanged", () => {
  const original = "Task chair, mesh back.\nDimension: W:520/680 D:615 H:1140 mm";
  assert.equal(keepDimensionLine(original, "Task chair, mesh back and castors."), "Task chair, mesh back and castors.\nDimension: W:520/680 D:615 H:1140 mm");
  assert.equal(keepDimensionLine("Task chair.\ndimension: W:1 mm\nExtra", "New text.\n"), "New text.\ndimension: W:1 mm", "the line is kept as it was written");
});
test("no Dimension line in the original means nothing is added", () => {
  assert.equal(keepDimensionLine("Task chair, mesh back.", "Task chair."), "Task chair.");
  assert.equal(keepDimensionLine(null, "Task chair."), "Task chair.");
});

const ctx = { brand: "Era", origin: "Germany", finishTerms: ["ER01", "Jet Black"], accessoryLabels: ["Black Plastic Parts", "Standard Column - Polyamide", "Castors"] };
const current = "Task chair with mesh back, black plastic parts, standard column polyamide and hard castors, adjustable armrests and a synchronous mechanism.";
const good = "Task chair, mesh back, adjustable armrests, synchronous mechanism, black plastic parts, standard column - polyamide and castors.";
const run = (mode: "improve" | "shorten", suggestion: string, extra: Partial<typeof ctx & { current: string }> = {}) => checkFinalSpecificationSuggestion({ mode, current, suggestion, ...ctx, ...extra });
const warningsOf = (result: ReturnType<typeof run>) => (result as { warnings: string[] }).warnings;

test("a clean suggestion is accepted with an empty warning list", () => {
  assert.deepEqual(run("improve", good), { ok: true, text: good, warnings: [] });
  const shorter = "Task chair, mesh back, armrests, synchronous mechanism, black plastic parts, polyamide column and castors.";
  assert.deepEqual(run("shorten", shorter), { ok: true, text: shorter, warnings: [] });
});

test("hard reject: the brand, the country, a finish name or a finish code (whole words only)", () => {
  for (const extra of ["By Era.", "Made in Germany.", "Finish ER01.", "In jet black.", "Era edition."]) assert.equal(run("improve", `${good} ${extra}`).ok, false, extra);
  assert.match((run("improve", `${good} By Era.`) as { message: string }).message, /brand or country.*The current text was kept\./);
  assert.equal(run("improve", `${good} Er01x is not a code.`).ok, true, "a longer word is not a match");
  assert.equal(run("improve", `${good} General purpose, with an operating lever.`).ok, true, "Era does not match inside normal words");
  assert.equal(run("improve", "   ").ok, false, "an empty suggestion is rejected");
});

test("a Dimension line in the suggestion is removed and the rest is accepted", () => {
  const result = run("improve", `${good}\nDimension: W:1 mm`);
  assert.deepEqual(result, { ok: true, text: good, warnings: [] });
  assert.deepEqual(run("improve", `  dimension : W:1 mm\n${good}`), { ok: true, text: good, warnings: [] });
  assert.equal(run("improve", "Dimension: W:1 mm").ok, false, "nothing left after removing it");
  assert.equal(run("improve", `${good}\nDimension: W:1 mm Era`).ok, true, "the removed line is not checked");
});

test("a missing accessory is a warning, not a reject (main word, colour-only labels skipped)", () => {
  const result = run("improve", "Task chair, mesh back, black plastic parts and castors.");
  assert.equal(result.ok, true);
  assert.deepEqual(warningsOf(result), ["Check: a selected accessory may be missing: Standard Column - Polyamide."]);
  assert.doesNotMatch(warningsOf(result).join(" "), /The current text was kept/);
  const base = { current: "Task chair with mesh back.", brand: null, origin: null, finishTerms: [] as string[], mode: "improve" as const };
  const w = (accessoryLabels: string[], suggestion: string) => warningsOf(checkFinalSpecificationSuggestion({ ...base, accessoryLabels, suggestion }) as never);
  assert.deepEqual(w(["Standard Column - Polyamide as col. finish"], "Task chair, mesh back, polyamide column."), []);
  assert.deepEqual(w(["Seat Depth, Inclination"], "Task chair, mesh back, seat depth and inclination adjustment."), []);
  assert.deepEqual(w(["Adjustable Lumbar Support"], "Task chair, mesh back, height and depth adjustable lumbar support."), []);
  assert.deepEqual(w(["Hard Castors"], "Task chair, mesh back, hard castor wheels."), []);
  assert.deepEqual(w(["Black Plastic Parts", "Matt Black Frame"], "Task chair, mesh back."), [], "colour-only labels never warn");
  assert.equal(w(["Black soft double castors"], "Task chair, mesh back.").length, 1, "a real feature label warns");
  assert.equal(w(["Black soft double castors"], "Task chair, mesh back, black soft double castors.").length, 0);
});

test("a missing number is a warning (both modes); Dimension line numbers and codes are ignored", () => {
  const text = "Task chair with 65 mm castors, 2D armrests, 3D headrest and 5 star base.";
  const r = (mode: "improve" | "shorten", cur: string, suggestion: string) => checkFinalSpecificationSuggestion({ mode, current: cur, suggestion, brand: null, origin: null, finishTerms: [], accessoryLabels: [] });
  assert.deepEqual(r("improve", text, "Task chair, 65 mm castors, 2D armrests, 3D headrest, 5 star base."), { ok: true, text: "Task chair, 65 mm castors, 2D armrests, 3D headrest, 5 star base.", warnings: [] });
  const missing = r("improve", text, "Task chair, castors, 2D armrests, 3D headrest, 5 star base.") as { ok: boolean; warnings: string[] };
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.warnings, ["Check: the number 65 from the current text is missing."]);
  assert.match((r("shorten", text, "Chair, 65 mm castors, armrests, 3D headrest, 5 star base.") as { warnings: string[] }).warnings[0], /2D/);
  assert.match((r("improve", text, "Task chair, 65 mm castors, 2D armrests, 3D headrest, star base.") as { warnings: string[] }).warnings[0], /number 5 /);
  assert.deepEqual((r("improve", "Task chair, mesh back.\nDimension: W:520/680 D:615 H:1140 mm", "Task chair, mesh back and castors.") as { warnings: string[] }).warnings, []);
  assert.deepEqual((r("improve", "Task chair, ER01 code, 65mm castors.", "Task chair, 65 mm castors.") as { warnings: string[] }).warnings, []);
});

test("shorten that is not shorter is a warning, not a reject", () => {
  const same = run("shorten", current) as { ok: boolean; warnings: string[] };
  assert.equal(same.ok, true);
  assert.deepEqual(same.warnings, ["Check: the suggestion is not shorter than the current text."]);
  assert.equal((run("shorten", `${current} Extra words here.`) as { warnings: string[] }).warnings.some((w) => /not shorter/.test(w)), true);
  assert.equal((run("improve", current) as { warnings: string[] }).warnings.some((w) => /not shorter/.test(w)), false, "improve does not need to be shorter");
});

test("several warnings are listed together", () => {
  const result = run("shorten", `${current} 99.`, { accessoryLabels: ["Castors"] }) as { ok: boolean; warnings: string[] };
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1, "only the not-shorter warning here");
  const many = checkFinalSpecificationSuggestion({ mode: "shorten", current: "Task chair, 65 mm, 2D armrests.", suggestion: "Task chair, 65 mm, 2D armrests, plus longer words here.", brand: null, origin: null, finishTerms: [], accessoryLabels: ["Castors"] }) as { warnings: string[] };
  assert.equal(many.warnings.length, 2, "not shorter + castors missing");
});
