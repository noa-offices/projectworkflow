import "server-only";
import { parseBatchSpecificationEnrichmentResult, parseSpecificationEnrichmentResult, type BatchSpecificationEnrichmentProviderItem, type BatchSpecificationEnrichmentResultItem, type SpecificationEnrichmentContext, type SpecificationEnrichmentResult, type SpecificationEnrichmentRow } from "./specification-enrichment-contract";

export const DEFAULT_SPEC_ENRICHMENT_AI_MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 45_000;
export class SpecificationEnrichmentProviderError extends Error { constructor(message: string, public readonly kind: "not_configured" | "provider_failed" = "provider_failed") { super(message); } }
const instructions = `You improve product wording only. Use only facts present in the supplied current row, template/group context, and matched source context. Never change product identity, supplier/model codes, or dimensions. Never change or mention price. Do not invent materials, features, mechanisms, configuration, marketing claims, unsupported adjectives, or facts from general furniture knowledge. Keep wording concise, commercial, and suitable for the furniture industry. Return null when evidence is insufficient. Do not mention JSON, extraction, AI, QA, or internal workflow.

DISPLAY NAME RULES: Return displayNameSuggestion null when the existing Display Name is already clear, concise, and commercially usable. Do not make cosmetic-only punctuation or spacing rewrites. Keep a suggested name short and practical; supported distinctions such as Standard, Electrified, or Left/Right may be retained only when directly supported.

SPECIFICATION RULES: Describe only stable base-product construction, material, form, or identity facts supported by the supplied context. Do not include dimensions, price, currency, supplier/model codes, or internal field names. Do not include optional, removable, configurable, user-selectable, accessory, option, or configuration-item features. Do not include negative option statements such as "without top access", "without accessory", or "not included". Features that may later be added by finishes, accessories, options, or configuration selections must be omitted. The final specification is assembled later from the base item and user-selected finishes, accessories, options, and configuration items. Return specificationSuggestion null if only optional or configurable facts are available. Specifications should be one to three short sentences.`;
const schema = { type: "object", additionalProperties: false, required: ["displayNameSuggestion", "specificationSuggestion"], properties: { displayNameSuggestion: { type: ["string", "null"], maxLength: 160 }, specificationSuggestion: { type: ["string", "null"], maxLength: 1000 } } } as const;
const batchInstructions = `${instructions}

BATCH MODE: Improve specification wording only; never suggest Display Names. Return a results array containing exactly one result for every supplied targetId, preserving each targetId exactly and in the same order. For accessory targets, describe only that accessory item's own stable facts. Return specificationSuggestion null when no safe material improvement exists.`;
const batchSchema = { type: "object", additionalProperties: false, required: ["results"], properties: { results: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["targetId", "specificationSuggestion"], properties: { targetId: { type: "string" }, specificationSuggestion: { type: ["string", "null"], maxLength: 1000 } } } } } } as const;
function outputText(value: unknown) { if (!value || typeof value !== "object") return null; const output = (value as { output?: unknown }).output; if (!Array.isArray(output)) return null; for (const item of output) if (item && typeof item === "object" && Array.isArray((item as { content?: unknown }).content)) for (const content of (item as { content: unknown[] }).content) if (content && typeof content === "object" && (content as { type?: unknown }).type === "output_text" && typeof (content as { text?: unknown }).text === "string") return (content as { text: string }).text; return null; }
export async function enrichSpecificationWithProvider(input: { row: SpecificationEnrichmentRow; context: SpecificationEnrichmentContext; sourceFragment: unknown }): Promise<SpecificationEnrichmentResult> {
  const apiKey = process.env.SOURCE_QA_AI_API_KEY?.trim(); if (!apiKey) throw new SpecificationEnrichmentProviderError("Specification enrichment is not configured.", "not_configured");
  const currentRow = { id: input.row.id, displayName: input.row.displayName, specification: input.row.specification, supplierCodes: input.row.supplierCodes, referenceCodes: input.row.referenceCodes, dimensions: input.row.dimensions };
  const context = { templateName: input.context.templateName, groupLabel: input.context.groupLabel, rowType: input.context.rowType };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.SPEC_ENRICHMENT_AI_MODEL?.trim() || DEFAULT_SPEC_ENRICHMENT_AI_MODEL, store: false, instructions, input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ currentRow, context, matchedSourceContext: input.sourceFragment }) }] }], text: { format: { type: "json_schema", name: "specification_enrichment", strict: true, schema } } }) }); if (!response.ok) throw new SpecificationEnrichmentProviderError("Specification enrichment could not be completed."); const text = outputText(await response.json()); const result = text ? parseSpecificationEnrichmentResult(JSON.parse(text)) : null; if (!result) throw new SpecificationEnrichmentProviderError("Specification enrichment returned an invalid result."); return result; }
  catch (error) { if (error instanceof SpecificationEnrichmentProviderError) throw error; if (error instanceof Error && error.name === "AbortError") throw new SpecificationEnrichmentProviderError("Specification enrichment timed out."); throw new SpecificationEnrichmentProviderError("Specification enrichment could not be completed."); } finally { clearTimeout(timeout); }
}

export async function enrichSpecificationBatchWithProvider(items: BatchSpecificationEnrichmentProviderItem[]): Promise<BatchSpecificationEnrichmentResultItem[]> {
  if (!items.length || items.length > 6) throw new SpecificationEnrichmentProviderError("Specification enrichment batch is invalid.");
  const apiKey = process.env.SOURCE_QA_AI_API_KEY?.trim(); if (!apiKey) throw new SpecificationEnrichmentProviderError("Specification enrichment is not configured.", "not_configured");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.SPEC_ENRICHMENT_AI_MODEL?.trim() || DEFAULT_SPEC_ENRICHMENT_AI_MODEL, store: false, instructions: batchInstructions, input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(items) }] }], text: { format: { type: "json_schema", name: "batch_specification_enrichment", strict: true, schema: batchSchema } } }) });
    if (!response.ok) throw new SpecificationEnrichmentProviderError("Specification enrichment could not be completed.");
    const text = outputText(await response.json());
    const parsed = text ? JSON.parse(text) as unknown : null;
    const result = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parseBatchSpecificationEnrichmentResult((parsed as { results?: unknown }).results, items.map((item) => item.targetId)) : null;
    if (!result) throw new SpecificationEnrichmentProviderError("Specification enrichment returned an invalid batch result.");
    return result;
  } catch (error) {
    if (error instanceof SpecificationEnrichmentProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new SpecificationEnrichmentProviderError("Specification enrichment timed out.");
    throw new SpecificationEnrichmentProviderError("Specification enrichment could not be completed.");
  } finally { clearTimeout(timeout); }
}
