import "server-only";

import type { ProductTemplateDraft } from "./product-template-draft";
import { validateOriginalImportedJsonSources, type OriginalImportedJsonSource } from "./original-imported-json-sources";
import { parseSourceQaAiReport, type SourceQaAiReport } from "./source-qa-ai-contract";

export type SourceQaAiProviderInput = { sourcePdf: { fileName: string; bytes: ArrayBuffer }; originalImportedJsonSources: OriginalImportedJsonSource[]; draft: ProductTemplateDraft };
export const DEFAULT_SOURCE_QA_AI_MODEL = "gpt-4.1";
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
export class SourceQaAiProviderError extends Error {}

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

function outputText(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const response = value as { status?: unknown; output?: unknown };
  if (response.status !== "completed" || !Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) if (content && typeof content === "object" && (content as { type?: unknown }).type === "output_text" && typeof (content as { text?: unknown }).text === "string") return (content as { text: string }).text;
  }
  return null;
}

async function requestReport(input: SourceQaAiProviderInput, apiKey: string, originalJsonText: string, draftJson: string, signal: AbortSignal) {
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.SOURCE_QA_AI_MODEL?.trim() || DEFAULT_SOURCE_QA_AI_MODEL, store: false, instructions: instructions + exactCodeRules, input: [{ role: "user", content: [{ type: "input_file", filename: input.sourcePdf.fileName, file_data: `data:application/pdf;base64,${Buffer.from(input.sourcePdf.bytes).toString("base64")}` }, { type: "input_text", text: originalJsonText }, { type: "input_text", text: `Reviewed ProductTemplateDraft JSON (secondary context only):\n${draftJson}` }] }], text: { format: { type: "json_schema", name: "source_qa_ai_report", strict: true, schema } } }) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new SourceQaAiProviderError("AI Source QA provider authentication failed.");
    if (response.status === 429) throw new SourceQaAiProviderError("AI Source QA provider is temporarily unavailable.");
    throw new SourceQaAiProviderError("AI Source QA provider request failed.");
  }
  const text = outputText(await response.json());
  if (!text) throw new SourceQaAiProviderError("AI Source QA provider returned no usable report.");
  try { return parseSourceQaAiReport(JSON.parse(text)); } catch { return null; }
}

export async function verifySourceQaWithProvider(input: SourceQaAiProviderInput): Promise<SourceQaAiReport> {
  const apiKey = process.env.SOURCE_QA_AI_API_KEY?.trim();
  if (!apiKey) throw new SourceQaAiProviderError("AI Source QA is not configured yet.");
  if (!input.sourcePdf.fileName.toLowerCase().endsWith(".pdf") || !input.sourcePdf.bytes.byteLength) throw new SourceQaAiProviderError("Source PDF is invalid.");
  if (input.sourcePdf.bytes.byteLength > MAX_PDF_BYTES) throw new SourceQaAiProviderError("Source PDF exceeds the Source QA V1 limit.");
  const originalSources = validateOriginalImportedJsonSources(input.originalImportedJsonSources);
  if (!originalSources.valid) throw new SourceQaAiProviderError(originalSources.message);
  const draftJson = JSON.stringify(input.draft);
  if (Buffer.byteLength(draftJson, "utf8") > MAX_DRAFT_BYTES) throw new SourceQaAiProviderError("Product draft exceeds the Source QA V1 limit.");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const originalJsonText = originalSources.sources.map((source, index) => `Original Imported JSON Source ${index + 1}:\n${source.rawJson}`).join("\n\n");
    for (let attempt = 0; attempt < 2; attempt += 1) { const report = await requestReport(input, apiKey, originalJsonText, draftJson, controller.signal); if (report) return report; }
    throw new SourceQaAiProviderError("AI Source QA returned an invalid report.");
  } catch (error) {
    if (error instanceof SourceQaAiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new SourceQaAiProviderError("AI Source QA request timed out.");
    throw new SourceQaAiProviderError("AI Source QA provider request failed.");
  } finally { clearTimeout(timeout); }
}
