import "server-only";
import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { AiProviderError } from "@/lib/ai/types";
import { DIMENSION_CALL_MAX, parseDimensionShorteningResult } from "./dimension-shortening";

const TIMEOUT_MS = 45_000;
export class DimensionShorteningProviderError extends Error { constructor(message: string, public readonly kind: "not_configured" | "provider_failed" = "provider_failed") { super(message); } }
const instructions = `You shorten product dimension text. For every supplied item return the OVERALL (total) size only, in this exact format: W:<w> D:<d> H:<h> mm
Order is always W, D, H. If the width has two values (without armrests / with armrests), write W:520/680. If a size is a range because the product is adjustable (for example height), write the range: H:1130-1250. Round products: write Ø<d> H:<h> mm. Never include seat size, backrest size or adjustment ranges (seat depth, etc.) or notes like "without armrests". Use only numbers that are present in the supplied text; never calculate or guess. If a value is missing, leave that part out. If the text has no overall size, return null. Return exactly one result for every supplied targetId, with the targetId unchanged and in the same order.`;
const schema = { type: "object", additionalProperties: false, required: ["results"], properties: { results: { type: "array", minItems: 1, maxItems: DIMENSION_CALL_MAX, items: { type: "object", additionalProperties: false, required: ["targetId", "dimension"], properties: { targetId: { type: "string" }, dimension: { type: ["string", "null"] } } } } } } as const;

/** One call for up to 20 rows. Returns the raw AI answer; the caller must still validate every result in code. */
export async function shortenDimensionsWithProvider(items: { targetId: string; text: string }[]): Promise<{ targetId: string; dimension: string | null }[]> {
  if (!items.length || items.length > DIMENSION_CALL_MAX) throw new DimensionShorteningProviderError("Dimension shortening request is invalid.");
  // Reuses the existing Specification Enrichment agent settings (provider, model, on/off, key): no new agent or setting.
  const runtime = await resolveAiAgentRuntimeConfig("specification_enrichment");
  if (!runtime.enabled || !runtime.apiKeyConfigured) throw new DimensionShorteningProviderError("Dimension shortening is not configured.", "not_configured");
  let text: string;
  try {
    text = (await runAiProvider({ provider: runtime.provider, model: runtime.model, responseSchema: { name: "dimension_shortening", schema }, systemInstructions: instructions, timeoutMs: TIMEOUT_MS, userContent: items })).text;
  } catch (error) {
    throw providerFailure(error);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { throw providerFailure(error, "AI returned an answer I could not read."); }
  const results = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parseDimensionShorteningResult((parsed as { results?: unknown }).results, items.map((item) => item.targetId)) : null;
  if (!results) throw providerFailure(new Error("result did not match the schema"), "AI returned an answer I could not read.");
  return results;
}

// Maps a failure to a short plain-language message and logs the real reason (never the request text or the key).
function providerFailure(error: unknown, readable?: string) {
  const reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown";
  console.error("DIMENSION SHORTENING ERROR", { kind: error instanceof AiProviderError ? error.kind : "other", reason });
  if (error instanceof AiProviderError && error.kind === "not_configured") return new DimensionShorteningProviderError("Dimension shortening is not configured.", "not_configured");
  if (error instanceof AiProviderError && error.kind === "timeout") return new DimensionShorteningProviderError("AI timed out. Try again.");
  if (readable) return new DimensionShorteningProviderError(readable);
  const status = error instanceof AiProviderError ? /status (\d{3})/.exec(error.message)?.[1] : undefined;
  if (status) return new DimensionShorteningProviderError(`AI service error ${status}.`);
  if (error instanceof AiProviderError && /no usable output/i.test(error.message)) return new DimensionShorteningProviderError("AI returned an empty answer.");
  return new DimensionShorteningProviderError("Dimension shortening could not be completed.");
}
