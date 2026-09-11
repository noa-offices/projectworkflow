import type { ProductTemplateDraft, ProductTemplateDraftMatrixRow, ProductTemplateDraftPricedRow } from "./product-template-draft";

export type SourceQaPage = { pageNumber: number; text: string };
export type SourceQaFindingStatus = "matched" | "missing_candidate" | "conflict" | "intentionally_ignored";
export type SourceQaConfidence = "high" | "medium" | "low";
export type SourceQaFinding = { sourceId: string; pageNumber: number; section: string | null; sourceCode: string; normalizedCode: string; occurrenceCount: number; importedMatches: string[]; status: SourceQaFindingStatus; confidence: SourceQaConfidence; outOfScope: boolean; snippet: string; cropCandidates: [] };

export function normalizeSourceQaCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ").replace(/\s*-\s*/g, "-");
}

function codeFamily(value: string) {
  return value.match(/^[A-Z]+/)?.[0] ?? null;
}

function likelyCodes(text: string) {
  const matches = text.match(/\b(?:[A-Z]{2,5}\d{2,6}[A-Z]{0,3}|\d[A-Z]{1,4}\d{2,6}[A-Z]{0,3}|\d[A-Z]{1,3}\s+[A-Z]\d{2,6}|\d{2,4}\s+\d{2,6})\b/g) ?? [];
  const rejected = new Set(["OF", "AN", "AT", "WITH", "THE", "BLACK", "X", "MM", "CM", "GRS", "M2"]);
  return matches.map((value) => value.trim()).filter((value) => {
    const first = value.split(/[\s-]/)[0];
    return !rejected.has(first) && !/^(?:RJ45|M2)$/i.test(value) && !/^\d+\s*(?:MM|CM|GRS|DEGREES?)$/i.test(value);
  });
}

function rows(draft: ProductTemplateDraft): Array<{ location: string; row: ProductTemplateDraftPricedRow | ProductTemplateDraftMatrixRow }> {
  return [
    ...draft.pricing.workstationRows.map((row) => ({ location: `workstation:${row.id}`, row })),
    ...draft.pricing.baseModelRows.map((row) => ({ location: `base_model:${row.id}`, row })),
    ...draft.pricing.priceMatrices.flatMap((matrix) => matrix.rows.map((row) => ({ location: `matrix:${matrix.id}:${row.id}`, row }))),
    ...draft.pricing.modularGroups.flatMap((group) => group.matrix.rows.map((row) => ({ location: `modular:${group.id}:${row.id}`, row }))),
    ...draft.optionGroups.flatMap((group) => group.items.map((row) => ({ location: `option:${group.id}:${row.id}`, row }))),
  ];
}

export function collectImportedDraftCodes(draft: ProductTemplateDraft) {
  const result = new Map<string, string[]>();
  const add = (code: string, location: string) => { const normalized = normalizeSourceQaCode(code); if (!normalized) return; result.set(normalized, [...new Set([...(result.get(normalized) ?? []), location])]); };
  [...draft.template.supplierCodes, ...draft.template.referenceCodes].forEach((code) => add(code, "template"));
  rows(draft).forEach(({ location, row }) => [...row.supplierCodes, ...row.referenceCodes].forEach((code) => add(code, location)));
  draft.materialSuggestions.forEach((item) => [...item.supplierCodes, ...item.referenceCodes].forEach((code) => add(code, `material:${item.id}`)));
  draft.linkedFamilySuggestions.forEach((item) => [...item.supplierCodes, ...item.referenceCodes].forEach((code) => add(code, `linked:${item.id}`)));
  return result;
}

function heading(text: string, offset: number) {
  const before = text.slice(0, offset).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return before.slice(-5).reverse().find((line) => /\b(meeting|conference|bench|table|configuration|boardroom|article|art\.)\b/i.test(line)) ?? null;
}

export function analyzeSourcePdf(sourceId: string, pages: SourceQaPage[], draft: ProductTemplateDraft, ignoredCodes: ReadonlySet<string> = new Set()) {
  const imported = collectImportedDraftCodes(draft);
  const candidates = new Map<string, Array<{ pageNumber: number; sourceCode: string; section: string | null; snippet: string; priceEvidence: string | null }>>();
  pages.forEach((page) => { let nextIndex = 0; likelyCodes(page.text).forEach((sourceCode) => {
    const normalized = normalizeSourceQaCode(sourceCode); const index = page.text.indexOf(sourceCode, nextIndex); nextIndex = Math.max(nextIndex, index + sourceCode.length);
    const snippet = page.text.slice(Math.max(0, index - 90), index + sourceCode.length + 120).replace(/\s+/g, " ").trim();
    const priceEvidence = page.text.slice(index + sourceCode.length, index + sourceCode.length + 40).match(/^\s+(\d{2,6}(?:[.,]\d{2})?)\b/)?.[1] ?? null;
    candidates.set(normalized, [...(candidates.get(normalized) ?? []), { pageNumber: page.pageNumber, sourceCode, section: heading(page.text, index), snippet, priceEvidence }]);
  }); });
  return [...candidates.entries()].map(([normalizedCode, occurrences]) => {
    const first = occurrences[0]; const importedMatches = imported.get(normalizedCode) ?? []; const ignored = ignoredCodes.has(normalizedCode);
    const numericPair = /^\d{2,4}\s+\d{2,6}$/.test(normalizedCode);
    const family = codeFamily(normalizedCode);
    const knownFamily = !!family && [...imported.keys()].some((code) => codeFamily(code) === family);
    const alphaNumericShape = /^(?:[A-Z]{2,}\d{2,}[A-Z]*|\d[A-Z]{1,4}\d{2,}[A-Z]*|\d[A-Z]{1,3}\s+[A-Z]\d{2,})$/.test(normalizedCode);
    const explicitCodeEvidence = /\b(?:CODE|COD\.?|ART\.?|ARTICLE)\b/i.test(`${first.section ?? ""} ${first.snippet}`);
    const strongShape = alphaNumericShape || numericPair;
    const confidence: SourceQaConfidence = numericPair ? (imported.has(normalizedCode) || explicitCodeEvidence ? "high" : "medium") : alphaNumericShape && (knownFamily || explicitCodeEvidence || /\b(?:CONFIGURATION|TABLE)\b/i.test(`${first.section ?? ""} ${first.snippet}`)) ? "high" : strongShape ? "medium" : "low";
    const outOfScope = /\b(bench|executive|credenza|pedestal)\b/i.test(`${first.section ?? ""} ${first.snippet}`);
    const priceEvidence = new Set(occurrences.map((item) => item.priceEvidence).filter((value): value is string => !!value));
    return { sourceId, pageNumber: first.pageNumber, section: first.section, sourceCode: first.sourceCode, normalizedCode, occurrenceCount: occurrences.length, importedMatches, status: ignored ? "intentionally_ignored" : priceEvidence.size > 1 ? "conflict" : importedMatches.length ? "matched" : "missing_candidate", confidence, outOfScope, snippet: first.snippet.slice(0, 280), cropCandidates: [] } satisfies SourceQaFinding;
  });
}

export function primarySourceQaFindings(findings: SourceQaFinding[]) { return findings.filter((item) => item.status === "missing_candidate" && item.confidence === "high" && !item.outOfScope); }
export function sourceQaReviewStatus(findings: SourceQaFinding[]) { return primarySourceQaFindings(findings).length || findings.some((item) => item.status === "conflict") ? "review_needed" : "pass"; }
