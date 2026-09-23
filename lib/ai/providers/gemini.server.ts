import "server-only";

import { GEMINI_GENERATE_CONTENT_ENDPOINT } from "../provider-config";
import { AiProviderError, type AiProviderRequest, type AiProviderResponse } from "../types";

function contentParts(request: AiProviderRequest): Array<Record<string, unknown>> {
  if (!request.content) return [{ text: typeof request.userContent === "string" ? request.userContent : JSON.stringify(request.userContent) }];
  if (!request.content.length) throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  return request.content.map((part) => {
    if (part.type === "text" && part.text) return { text: part.text };
    if (part.type === "file" && part.mimeType.trim() && part.data.trim()) return { inlineData: { mimeType: part.mimeType, data: part.data } };
    throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  });
}

function validJson(text: string, schema: unknown): boolean {
  try { const value = JSON.parse(text); const definition = schema as { additionalProperties?: boolean; properties?: Record<string, unknown>; required?: unknown }; return Boolean(value && typeof value === "object" && !Array.isArray(value) && (!Array.isArray(definition.required) || !definition.required.some((key) => typeof key !== "string" || !(key in value))) && !(definition.additionalProperties === false && definition.properties && Object.keys(value).some((key) => !(key in definition.properties!)))); } catch { return false; }
}

export async function runGeminiProvider(request: AiProviderRequest): Promise<AiProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AiProviderError("Gemini is not configured.", "not_configured");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);
  try {
    const response = await fetch(`${GEMINI_GENERATE_CONTENT_ENDPOINT}/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: request.systemInstructions }] }, contents: [{ role: "user", parts: contentParts(request) }], generationConfig: { responseMimeType: "application/json", responseSchema: request.responseSchema.schema } }) });
    if (!response.ok) throw new AiProviderError("Gemini request failed.", "provider_failed");
    const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || !validJson(text, request.responseSchema.schema)) throw new AiProviderError("Gemini returned invalid structured output.", "provider_failed");
    return { text };
  } catch (error) { if (error instanceof AiProviderError) throw error; if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("Gemini request timed out.", "timeout"); throw new AiProviderError("Gemini request failed.", "provider_failed"); } finally { clearTimeout(timeout); }
}
