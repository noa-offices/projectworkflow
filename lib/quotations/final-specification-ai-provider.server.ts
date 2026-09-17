import "server-only";

import { OPENAI_RESPONSES_API_ENDPOINT } from "../ai/provider-config";
import {
  parseFinalSpecificationResult,
  type FinalSpecificationRequest,
  type FinalSpecificationResult,
} from "./final-specification-ai-contract";

export const DEFAULT_FINAL_SPECIFICATION_AI_MODEL = "gpt-4.1-mini";
const TIMEOUT_MS = 45_000;

export class FinalSpecificationProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_configured" | "provider_failed" = "provider_failed",
  ) {
    super(message);
  }
}

const instructions = `Create a concise, professional, quotation-ready final product specification from the user's actual selected configuration. Use only supplied selected facts.

Preserve every selected technical fact. Include supplied selected finish/material, accessory, option, companion, and configuration facts. Do not invent, infer, remove, or replace selected features. Do not describe possible alternatives or unselected availability. Do not write "available with", "optional", "can be supplied with", or "without" unless the supplied selected configuration genuinely requires that fact.

FINAL SPECIFICATION STYLE: Return only the configured product-description/specification body. Do not repeat the product, template, or model name, and do not begin with it. Do not include dimensions, size, width, depth, height, diameter, or dimension formatting. The quotation/builder layout displays the product/model name and dimension line separately. Keep actually selected technical features, finishes, accessories, options, and configuration facts; do not remove important selected facts because name and dimensions are excluded. Avoid unnecessary repetition. Keep wording concise, professional, and quotation-ready.

Do not mention price, currency, discount, supplier codes, model codes, internal codes, AI, JSON, QA, or internal workflow. Do not add marketing claims or unsupported material properties. Return specificationSuggestion null when the selected context is insufficient for a safe improvement.

Write the resulting furniture product, not the internal configuration model: use natural furniture/quotation terminology instead of software-style phrasing. Consolidate repeated modules and repeated identical dimensions into concise composition wording instead of listing them again. Mention a selected accessory, option, or finish only when it is actually supplied as selected; never mention an unselected one. Do not include stock or commercial availability/status notes (for example wording about limited stock or supplies running out). Do not invent materials, finishes, dimensions, accessories, quantities, origin, or product features beyond the supplied selected facts; a supplied brand/origin fact may be preserved verbatim but never invented.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["specificationSuggestion"],
  properties: {
    specificationSuggestion: { type: ["string", "null"], maxLength: 1500 },
  },
} as const;

function outputText(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && (content as { type?: unknown }).type === "output_text" && typeof (content as { text?: unknown }).text === "string") {
        return (content as { text: string }).text;
      }
    }
  }
  return null;
}

export async function improveFinalSpecificationWithProvider(
  request: FinalSpecificationRequest,
): Promise<FinalSpecificationResult> {
  const apiKey = process.env.SOURCE_QA_AI_API_KEY?.trim();
  if (!apiKey) throw new FinalSpecificationProviderError("Final specification AI is not configured.", "not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_RESPONSES_API_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.FINAL_SPECIFICATION_AI_MODEL?.trim() || DEFAULT_FINAL_SPECIFICATION_AI_MODEL,
        store: false,
        instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(request) }] }],
        text: { format: { type: "json_schema", name: "final_specification", strict: true, schema } },
      }),
    });
    if (!response.ok) throw new FinalSpecificationProviderError("Final specification could not be improved.");
    const text = outputText(await response.json());
    const result = text ? parseFinalSpecificationResult(JSON.parse(text)) : null;
    if (!result) throw new FinalSpecificationProviderError("Final specification returned an invalid result.");
    return result;
  } catch (error) {
    if (error instanceof FinalSpecificationProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FinalSpecificationProviderError("Final specification request timed out.");
    }
    throw new FinalSpecificationProviderError("Final specification could not be improved.");
  } finally {
    clearTimeout(timeout);
  }
}
