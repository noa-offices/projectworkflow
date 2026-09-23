import "server-only";

import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { AiProviderError, type AiProviderContentPart, type AiProviderId } from "@/lib/ai/types";
import type { ProductTemplateDraft } from "./product-template-draft";
import { validateOriginalImportedJsonSources, type OriginalImportedJsonSource } from "./original-imported-json-sources";
import { parseSourceQaAiReport, type SourceQaAiReport } from "./source-qa-ai-contract";

export type SourceQaAiProviderInput = { sourcePdf: { fileName: string; bytes: ArrayBuffer }; originalImportedJsonSources: OriginalImportedJsonSource[]; draft: ProductTemplateDraft };
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
export class SourceQaAiProviderError extends Error {}

/**
 * Conservative INPUT text-token budget for the AI Source QA request. Kept well below the
 * provider's 30,000 TPM ceiling to leave explicit headroom for the PDF's own (uncontrollable
 * from here) token cost, the model's structured JSON output tokens, and provider
 * token-accounting variance. This only governs the text we assemble (fixed instructions +
 * original JSON sources + reviewed draft JSON); it is not a full tokenizer, just a safe,
 * conservative character-based estimate.
 */
export const SOURCE_QA_AI_INPUT_TOKEN_BUDGET = 19_000;
const CHARS_PER_TOKEN_ESTIMATE = 3.5;

export function estimateSourceQaTokens(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/** Re-serializes valid JSON without insignificant whitespace; leaves unparsable text untouched. */
function compactJsonText(rawJson: string) {
  try {
    return JSON.stringify(JSON.parse(rawJson));
  } catch {
    return rawJson.trim();
  }
}

function joinOriginalSources(sources: string[]) {
  return sources.map((text, index) => `Original Imported JSON Source ${index + 1}:\n${text}`).join("\n\n");
}

export type SourceQaPayloadBudgetResult = {
  originalJsonText: string;
  /** Empty string means the reviewed draft was dropped from this request entirely. */
  draftJson: string;
  estimatedTokens: number;
  trimmed: boolean;
  droppedDraft: boolean;
  droppedSourceCount: number;
};

/**
 * Keeps the AI Source QA text payload within budget using the safest available step first:
 * 1. Compact JSON (drop insignificant whitespace) — never loses data.
 * 2. Drop the reviewed draft JSON — it is explicitly secondary context that duplicates the
 *    same commercial rows already present in the original JSON sources (the PDF is compared
 *    primarily against those sources; the draft only helps flag Smart Setup transformation
 *    differences), so it is the safest large duplicate to remove first.
 * 3. Only as a last resort, drop whole lowest-priority (last) original source batches rather
 *    than slicing text mid-JSON, which would corrupt/lose data unpredictably.
 */
export function buildSourceQaTextPayload({
  fixedInstructionsText,
  sources,
  draftJson,
  budgetTokens = SOURCE_QA_AI_INPUT_TOKEN_BUDGET,
}: {
  fixedInstructionsText: string;
  sources: string[];
  draftJson: string;
  budgetTokens?: number;
}): SourceQaPayloadBudgetResult {
  const fixedTokens = estimateSourceQaTokens(fixedInstructionsText);

  let compactSources = sources.map(compactJsonText);
  let compactDraft = draftJson ? compactJsonText(draftJson) : "";
  let trimmed = compactSources.some((text, index) => text !== sources[index]) || compactDraft !== draftJson;

  let originalJsonText = joinOriginalSources(compactSources);
  let total = fixedTokens + estimateSourceQaTokens(originalJsonText) + (compactDraft ? estimateSourceQaTokens(compactDraft) : 0);
  let droppedDraft = false;

  if (total > budgetTokens && compactDraft) {
    compactDraft = "";
    droppedDraft = true;
    trimmed = true;
    total = fixedTokens + estimateSourceQaTokens(originalJsonText);
  }

  let droppedSourceCount = 0;
  while (total > budgetTokens && compactSources.length > 1) {
    compactSources = compactSources.slice(0, -1);
    droppedSourceCount += 1;
    trimmed = true;
    originalJsonText = joinOriginalSources(compactSources);
    total = fixedTokens + estimateSourceQaTokens(originalJsonText);
  }

  return { originalJsonText, draftJson: compactDraft, estimatedTokens: total, trimmed, droppedDraft, droppedSourceCount };
}

const schema = { type: "object", additionalProperties: false, required: ["version", "summary", "issues"], properties: { version: { type: "integer", const: 1 }, summary: { type: "object", additionalProperties: false, required: ["issueCount", "highSeverityCount", "reviewRequired"], properties: { issueCount: { type: "integer", minimum: 0 }, highSeverityCount: { type: "integer", minimum: 0 }, reviewRequired: { type: "boolean" } } }, issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "type", "severity", "confidence", "supplierModelCode", "sourcePage", "sourceEvidence", "sourceValue", "jsonLocation", "jsonValue", "explanation"], properties: { id: { type: "string", minLength: 1 }, type: { type: "string", enum: ["missing_source_row", "supplier_model_code_mismatch", "price_value_mismatch", "row_binding_mismatch", "classification_mismatch", "excluded_scope_import"] }, severity: { type: "string", enum: ["critical", "warning", "info"] }, confidence: { type: "string", enum: ["high", "medium", "low"] }, supplierModelCode: { type: ["string", "null"] }, sourcePage: { type: ["integer", "null"], minimum: 1 }, sourceEvidence: { type: ["string", "null"] }, sourceValue: { type: ["string", "number", "null"] }, jsonLocation: { type: ["string", "null"] }, jsonValue: { type: ["string", "number", "boolean", "null"] }, explanation: { type: "string", minLength: 1 } } } } } } as const;

const instructions = `You are a verification system, not an extractor and not an editor. The manufacturer PDF is the source of truth. Compare it primarily against every separately bounded Original Imported JSON source: this is the extracted representation being verified. The reviewed ProductTemplateDraft is secondary context only, used only to identify possible Smart Setup transformation/integrity differences. If original JSON differs from the PDF, report an extraction-fidelity issue. If original JSON matches the PDF but reviewedDraft differs, treat it only as a possible transformation/integrity concern. Do not trust extractionWarnings, confidence values, prior AI commentary, inferred manufacturer conventions, or naming patterns over literal PDF evidence. Literal printed source values and codes always outrank inference. Do not invent discrepancies. Internally complete every pass below before returning only evidence-supported discrepancies matching the supplied schema. Do not return the internal checklist.

PASS 1 — ENUMERATE JSON COMMERCIAL ROWS: Enumerate every JSON row/item containing supplier/model code, dimensions, price/value, currency-related value, applicability, or required/optional/included classification. Include Base / Model, Category / Matrix, Workstation, Modular, Accessory / Configuration, nested options/items, null prices, and explicit numeric zero prices. Do not skip rows because another mismatch was found.

PASS 2 — VERIFY EVERY ENUMERATED JSON ROW: For each row/item, locate matching PDF evidence and verify supplier/model code, model/description identity, dimensions, price/value, and applicability/classification where present. For every price-bearing row compare the exact source value against JSON. Printed 0 is a real zero; a blank source price is blank/null, never zero. For null JSON prices, confirm blank/unavailable/uncertain source evidence where possible. For numeric zero JSON prices, require explicit printed zero evidence. Do not infer unreadable prices. Continue until every enumerated price-bearing JSON row has been checked; a code-only report is incomplete while unchecked price-bearing rows remain.

DENSE-TABLE BINDING RULE: Never validate a price because the same number appears elsewhere in the PDF. Validate supplier/model code → model/row identity → dimension → price/value → applicability. A price is correct only when bound to the correct source row/model.

PASS 3 — SOURCE-SIDE COVERAGE: After JSON-row verification, enumerate commercially relevant PDF rows/items in the intended product scope and check each for a corresponding JSON row. Report missing rows only with clear evidence and respect explicit excluded scope.

PASS 4 — FINDING CONSOLIDATION: Consolidate duplicate findings. Do not return two findings for the same underlying discrepancy when JSON location/row, supplier/model code, and source row/page match. If one discrepancy fits two types, choose the most commercially precise type.

Do not rewrite the draft, invent data, report stylistic differences, or propose routing changes without direct source proof. If evidence is ambiguous, lower confidence or omit the mismatch; continue checking all other rows. sourceEvidence must be short and factual, and sourcePage must be an actual PDF page.

Severity: critical for commercially dangerous code/price/base-model/required-component errors; warning for likely non-critical or conditional/ambiguous errors; info for low-impact review items. Confidence: high for direct evidence, medium for strong contextual evidence, low for incomplete or ambiguous evidence.`;

const exactCodeRules = `

EXACT SUPPLIER/MODEL CODE VERIFICATION: Supplier/model codes are identifiers, not natural-language text. For every coded JSON row, independently of price verification, locate its source row, read the complete source code, and compare the identifier character-for-character. Report any mismatch even when dimensions and prices otherwise match. Do not normalize away suffixes, prefixes, letters, digits, hyphens, slashes, or meaningful spaces. Near matches are never equivalent: 9MU202a ≠ 9MU202; ABC-R ≠ ABC; ML18/1 ≠ ML18; X-20 ≠ X20.`;

async function requestReport(input: SourceQaAiProviderInput, provider: AiProviderId, model: string, originalJsonText: string, draftJson: string) {
  const content: AiProviderContentPart[] = [
    { type: "file", filename: input.sourcePdf.fileName, mimeType: "application/pdf", data: Buffer.from(input.sourcePdf.bytes).toString("base64") },
    { type: "text", text: originalJsonText },
  ];
  if (draftJson) content.push({ type: "text", text: `Reviewed ProductTemplateDraft JSON (secondary context only):\n${draftJson}` });
  const response = await runAiProvider({ provider, model, content, responseSchema: { name: "source_qa_ai_report", schema }, systemInstructions: instructions + exactCodeRules, timeoutMs: TIMEOUT_MS });
  try { return parseSourceQaAiReport(JSON.parse(response.text)); } catch { return null; }
}

export async function verifySourceQaWithProvider(input: SourceQaAiProviderInput): Promise<SourceQaAiReport> {
  const runtime = await resolveAiAgentRuntimeConfig("source_qa");
  if (!runtime.enabled || !runtime.apiKeyConfigured) throw new SourceQaAiProviderError("AI Source QA is not configured yet.");
  if (!input.sourcePdf.fileName.toLowerCase().endsWith(".pdf") || !input.sourcePdf.bytes.byteLength) throw new SourceQaAiProviderError("Source PDF is invalid.");
  if (input.sourcePdf.bytes.byteLength > MAX_PDF_BYTES) throw new SourceQaAiProviderError("Source PDF exceeds the Source QA V1 limit.");
  const originalSources = validateOriginalImportedJsonSources(input.originalImportedJsonSources);
  if (!originalSources.valid) throw new SourceQaAiProviderError(originalSources.message);
  const draftJson = JSON.stringify(input.draft);
  if (Buffer.byteLength(draftJson, "utf8") > MAX_DRAFT_BYTES) throw new SourceQaAiProviderError("Product draft exceeds the Source QA V1 limit.");
  try {
    const payload = buildSourceQaTextPayload({ fixedInstructionsText: instructions + exactCodeRules, sources: originalSources.sources.map((source) => source.rawJson), draftJson });
    if (payload.trimmed) console.info("Source QA AI provider payload trimmed to stay within the text token budget", { estimatedTokens: payload.estimatedTokens, budgetTokens: SOURCE_QA_AI_INPUT_TOKEN_BUDGET, droppedDraft: payload.droppedDraft, droppedSourceCount: payload.droppedSourceCount });
    for (let attempt = 0; attempt < 2; attempt += 1) { const report = await requestReport(input, runtime.provider, runtime.model, payload.originalJsonText, payload.draftJson); if (report) return report; }
    throw new SourceQaAiProviderError("AI Source QA returned an invalid report.");
  } catch (error) {
    if (error instanceof SourceQaAiProviderError) throw error;
    if (error instanceof AiProviderError && error.kind === "not_configured") throw new SourceQaAiProviderError("AI Source QA is not configured yet.");
    if (error instanceof AiProviderError && error.kind === "timeout") throw new SourceQaAiProviderError("AI Source QA request timed out.");
    console.error("Source QA AI provider exception", { name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) });
    throw new SourceQaAiProviderError("AI Source QA provider request failed.");
  }
}
