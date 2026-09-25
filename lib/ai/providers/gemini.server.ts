import "server-only";

import { GEMINI_GENERATE_CONTENT_ENDPOINT } from "../provider-config";
import { AiProviderError, type AiProviderRequest, type AiProviderResponse } from "../types";
import { GeminiSchemaTranslationError, normalizeGeminiSemanticResponse, translateSchemaForGemini } from "./gemini-schema-translation";

// I7.1: the outgoing responseSchema is translated for Gemini's restricted, non-JSON-Schema wire
// format (see gemini-schema-translation.ts for the full rationale - verified live against the
// current API, not memory/docs) and the response is normalized back before anything else sees it.
// request.responseSchema.schema itself (the shared NOA_SEMANTIC_REQUEST_V2_SCHEMA) is never
// mutated - only this adapter's own wire request/response are affected. OpenAI and Anthropic never
// see this translation.

function contentParts(request: AiProviderRequest): Array<Record<string, unknown>> {
  if (!request.content) return [{ text: typeof request.userContent === "string" ? request.userContent : JSON.stringify(request.userContent) }];
  if (!request.content.length) throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  return request.content.map((part) => {
    if (part.type === "text" && part.text) return { text: part.text };
    if (part.type === "file" && part.mimeType.trim() && part.data.trim()) return { inlineData: { mimeType: part.mimeType, data: part.data } };
    throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  });
}

function validJson(value: unknown, schema: unknown): boolean {
  const definition = schema as { additionalProperties?: boolean; properties?: Record<string, unknown>; required?: unknown };
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (!Array.isArray(definition.required) || !definition.required.some((key) => typeof key !== "string" || !(key in value)))
    && !(definition.additionalProperties === false && definition.properties && Object.keys(value).some((key) => !(key in definition.properties!))));
}

export async function runGeminiProvider(request: AiProviderRequest): Promise<AiProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AiProviderError("Gemini is not configured.", "not_configured");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);
  try {
    // I7.1 PART 9: fail closed, as a normalized AiProviderError, if the shared schema uses a
    // construct this translator doesn't recognize - never silently drop/reinterpret it. Only the
    // OUTGOING wire schema is translated; request.responseSchema.schema itself (the shared,
    // provider-neutral NOA_SEMANTIC_REQUEST_V2_SCHEMA) is never mutated, and every post-response
    // check below (validJson, and the caller's own isNoaSemanticRequestV2()/grounding) still
    // validates against that ORIGINAL schema/shape.
    const geminiSchema = translateSchemaForGemini(request.responseSchema.schema);
    const response = await fetch(`${GEMINI_GENERATE_CONTENT_ENDPOINT}/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: request.systemInstructions }] }, contents: [{ role: "user", parts: contentParts(request) }], generationConfig: { responseMimeType: "application/json", responseSchema: geminiSchema } }) });
    if (!response.ok) throw new AiProviderError("Gemini request failed.", "provider_failed");
    const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new AiProviderError("Gemini returned invalid structured output.", "provider_failed");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new AiProviderError("Gemini returned invalid structured output.", "provider_failed"); }
    // Reverse the one wire-only conversion (ordinal) before validating/returning - the caller
    // (extractNoaSemanticRequestV2 -> isNoaSemanticRequestV2 -> validateNoaSemanticRequestV2AgainstMessage)
    // must see an ordinary, unmodified NOA semantic object, identical in shape to what OpenAI/
    // Anthropic already return.
    const normalized = normalizeGeminiSemanticResponse(parsed);
    if (!validJson(normalized, request.responseSchema.schema)) throw new AiProviderError("Gemini returned invalid structured output.", "provider_failed");
    return { text: JSON.stringify(normalized) };
  } catch (error) { if (error instanceof AiProviderError) throw error; if (error instanceof GeminiSchemaTranslationError) throw new AiProviderError(error.message, "provider_failed"); if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("Gemini request timed out.", "timeout"); throw new AiProviderError("Gemini request failed.", "provider_failed"); } finally { clearTimeout(timeout); }
}
