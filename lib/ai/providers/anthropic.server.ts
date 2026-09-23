import "server-only";

import { ANTHROPIC_MESSAGES_API_ENDPOINT } from "../provider-config";
import { AiProviderError, type AiProviderRequest, type AiProviderResponse } from "../types";

function messageContent(request: AiProviderRequest): string | Array<Record<string, unknown>> {
  const schemaInstruction = `Return only JSON matching this schema: ${JSON.stringify(request.responseSchema.schema)}`;
  if (!request.content) return `${typeof request.userContent === "string" ? request.userContent : JSON.stringify(request.userContent)}\n${schemaInstruction}`;
  if (!request.content.length) throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  const parts = request.content.map((part) => {
    if (part.type === "text" && part.text) return { type: "text", text: part.text };
    if (part.type === "file" && part.mimeType.trim() && part.data.trim()) return { type: "document", source: { type: "base64", media_type: part.mimeType, data: part.data }, ...(part.filename ? { title: part.filename } : {}) };
    throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  });
  parts.push({ type: "text", text: schemaInstruction });
  return parts;
}

function validJson(text: string, schema: unknown): boolean {
  try {
    const value = JSON.parse(text);
    const definition = schema as { additionalProperties?: boolean; properties?: Record<string, unknown>; required?: unknown };
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (Array.isArray(definition.required) && definition.required.some((key) => typeof key !== "string" || !(key in value))) return false;
    if (definition.additionalProperties === false && definition.properties && Object.keys(value).some((key) => !(key in definition.properties!))) return false;
    return true;
  } catch { return false; }
}

export async function runAnthropicProvider(request: AiProviderRequest): Promise<AiProviderResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new AiProviderError("Anthropic is not configured.", "not_configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);
  try {
    const response = await fetch(ANTHROPIC_MESSAGES_API_ENDPOINT, { method: "POST", signal: controller.signal, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: request.model, max_tokens: 4096, system: request.systemInstructions, messages: [{ role: "user", content: messageContent(request) }] }) });
    if (!response.ok) throw new AiProviderError("Anthropic request failed.", "provider_failed");
    const json = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    const text = json.content?.find((item) => item.type === "text")?.text;
    if (!text || !validJson(text, request.responseSchema.schema)) throw new AiProviderError("Anthropic returned invalid structured output.", "provider_failed");
    return { text };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("Anthropic request timed out.", "timeout");
    throw new AiProviderError("Anthropic request failed.", "provider_failed");
  } finally { clearTimeout(timeout); }
}
