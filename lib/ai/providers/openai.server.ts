import "server-only";

import { OPENAI_RESPONSES_API_ENDPOINT } from "../provider-config";
import { AiProviderError, type AiProviderRequest, type AiProviderResponse } from "../types";

const DEFAULT_TIMEOUT_MS = 30_000;

function inputContent(request: AiProviderRequest): Array<Record<string, unknown>> {
  if (!request.content) return [{ type: "input_text", text: typeof request.userContent === "string" ? request.userContent : JSON.stringify(request.userContent) }];
  if (!request.content.length) throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  return request.content.map((part) => {
    if (part.type === "text" && part.text) return { type: "input_text", text: part.text };
    if (part.type === "file" && part.mimeType.trim() && part.data.trim()) return { type: "input_file", file_data: `data:${part.mimeType};base64,${part.data}`, ...(part.filename ? { filename: part.filename } : {}) };
    throw new AiProviderError("AI provider content is invalid.", "provider_failed");
  });
}

// Preferred-first credential precedence per the audit: OPENAI_API_KEY if set, otherwise the
// existing SOURCE_QA_AI_API_KEY every current agent already reuses - zero env migration required
// for Phase 2A-1.
function resolveOpenAiApiKey(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim() || null;
}

// Unchanged from the OpenAI Responses API output-walking logic every current agent duplicates:
// output[].content[] entries of type "output_text" carry the structured JSON text.
function outputText(value: unknown): string | null {
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

// The single OpenAI-specific adapter: translates the shared AiProviderRequest contract into the
// exact OpenAI Responses API request shape every current agent already sends (store:false,
// instructions, a single user-role input part, strict json_schema structured output), and
// normalizes every failure into AiProviderError. Never called directly by an agent/capability -
// only lib/ai/provider-router.server.ts calls this.
export async function runOpenAiProvider(request: AiProviderRequest): Promise<AiProviderResponse> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    throw new AiProviderError("OpenAI is not configured.", "not_configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_API_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        store: false,
        instructions: request.systemInstructions,
        input: [
          {
            role: "user",
            content: inputContent(request),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.responseSchema.name,
            strict: true,
            schema: request.responseSchema.schema,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new AiProviderError("OpenAI request failed.", "provider_failed");
    }

    const text = outputText(await response.json());
    if (!text) {
      throw new AiProviderError("OpenAI returned no usable output.", "provider_failed");
    }

    return { text };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiProviderError("OpenAI request timed out.", "timeout");
    }
    throw new AiProviderError("OpenAI request failed.", "provider_failed");
  } finally {
    clearTimeout(timeout);
  }
}
