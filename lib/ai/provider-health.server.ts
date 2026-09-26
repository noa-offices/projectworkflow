import "server-only";
import type { AiProviderId } from "./types";
import type { ProviderHealth } from "./provider-operations";
import { isApprovedAiModel } from "./provider-config";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function classifyProviderFailure(provider: AiProviderId, status: number, body: unknown): ProviderHealth["message"] {
  const error = record(record(body).error);
  const reasons = Array.isArray(error.details) ? error.details.map((detail) => record(detail).reason) : [];
  if (status === 401 || (provider === "gemini" && reasons.includes("API_KEY_INVALID"))) return "invalid_credential";
  if (status === 402 || (provider === "anthropic" && error.type === "billing_error")) return "billing_blocked";
  if (provider === "openai" && error.code === "insufficient_quota") return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "unknown_provider_error";
}

// Bounded parsing even if an upstream/proxy returns an oversized error page.
async function readBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode()); } catch { return null; }
  } finally { reader.releaseLock(); }
}

// Only documented metadata GETs. No prompts, completions, billing calls, retries or logs.
export async function checkProviderHealth(provider: AiProviderId, selectedModel: string | null): Promise<ProviderHealth> {
  const key = provider === "openai" ? process.env.OPENAI_API_KEY?.trim() || process.env.SOURCE_QA_AI_API_KEY?.trim()
    : provider === "anthropic" ? process.env.ANTHROPIC_API_KEY?.trim() : process.env.GEMINI_API_KEY?.trim();
  const model = selectedModel && isApprovedAiModel(provider, selectedModel) ? selectedModel : null;
  const result: ProviderHealth = { provider, credentialStatus: key ? "configured" : "missing", reachability: "unknown", authStatus: "unknown", quotaStatus: "unknown", model, modelStatus: "unknown", checkedAt: new Date().toISOString(), message: "credential_missing" };
  if (!key) return result;
  // With no configured provider model, inspect the list only; never invent an effective model.
  const suffix = model ? `/${encodeURIComponent(model)}` : "";
  const endpoint = provider === "openai" ? `https://api.openai.com/v1/models${suffix}`
    : provider === "anthropic" ? `https://api.anthropic.com/v1/models${suffix}` : `https://generativelanguage.googleapis.com/v1beta/models${suffix}`;
  const headers: Record<string, string> = provider === "openai" ? { Authorization: `Bearer ${key}` }
    : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { "x-goog-api-key": key };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, { method: "GET", headers, signal: controller.signal, cache: "no-store", redirect: "error" });
    result.reachability = response.status >= 500 ? "unavailable" : "available";
    // List responses can be large; HTTP success confirms endpoint access only.
    if (response.ok && !model) {
      await response.body?.cancel();
      return { ...result, authStatus: "valid", message: "metadata_available" };
    }
    const body = await readBody(response);
    if (response.ok) {
      const metadata = record(body);
      if (typeof (provider === "gemini" ? metadata.name : metadata.id) !== "string") return { ...result, message: "unknown_provider_error" };
      return { ...result, authStatus: "valid", modelStatus: "metadata_available", message: "metadata_available" };
    }
    const message = classifyProviderFailure(provider, response.status, body);
    return { ...result, message, authStatus: message === "invalid_credential" ? "invalid" : "unknown",
      modelStatus: response.status === 404 && model ? "unavailable" : "unknown",
      quotaStatus: message === "rate_limited" || message === "quota_exhausted" || message === "billing_blocked" ? message : "unknown" };
  } catch {
    return { ...result, reachability: "unavailable", message: controller.signal.aborted ? "timeout" : "provider_unavailable" };
  } finally { clearTimeout(timer); }
}
