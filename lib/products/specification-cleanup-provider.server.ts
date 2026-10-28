import "server-only";
import { runAiProvider } from "@/lib/ai/provider-router.server";
import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";
import { AiProviderError } from "@/lib/ai/types";
import { parseSpecificationCleanupResult, SPECIFICATION_CLEANUP_BATCH_SIZE, type SpecificationMode } from "./specification-cleanup";

const TIMEOUT_MS = 90_000; // this feature only: Gemini can be slow
export class SpecificationCleanupProviderError extends Error { constructor(message: string, public readonly kind: "not_configured" | "provider_failed" = "provider_failed") { super(message); } }
const instructions = `You clean product specifications. Every input row has a mode. Use only the supplied accessory list (accessory names and codes) to decide what is covered by an accessory.
Mode "seating": keep only product type, backrest type/height, seat finish and mechanism, in at most 2 short sentences. Remove anything covered by an item in the accessory list (for example black plastic parts, column, castors, armrests, headrest, base, feet), colours, "included", anything "optional", and delivery or packing text. If the accessory list is empty, still remove colours, "included", optional and delivery text, but keep every equipment item.
Mode "accessory_only": remove ONLY the phrases that are covered by an item in the accessory list (for example a cable tray, a modesty panel or a pedestal that is also an accessory item). Keep every other fact, including facts marked as included. Do not shorten or rephrase anything else. If nothing matches, return null.
In both modes use ONLY words that are in the original text. Do not add, translate or rephrase into new words; only delete words and parts of sentences. If nothing can be safely removed, return null. Return exactly one result for every supplied targetId, with the targetId unchanged and in the same order.`;
const schema = { type: "object", additionalProperties: false, required: ["results"], properties: { results: { type: "array", items: { type: "object", additionalProperties: false, required: ["targetId", "specification"], properties: { targetId: { type: "string" }, specification: { type: ["string", "null"] } } } } } } as const;

/** One call for up to 6 rows plus one accessory name list. Returns the raw AI answer; the caller must still validate every result in code. */
export async function cleanSpecificationsWithProvider(items: { targetId: string; text: string; mode: SpecificationMode }[], accessoryNames: string[]): Promise<{ targetId: string; specification: string | null }[]> {
  if (!items.length || items.length > SPECIFICATION_CLEANUP_BATCH_SIZE) throw new SpecificationCleanupProviderError("Specification cleanup request is invalid.");
  // Reuses the existing Specification Enrichment agent settings (provider, model, on/off, key): no new agent or setting.
  const runtime = await resolveAiAgentRuntimeConfig("specification_enrichment");
  if (!runtime.enabled || !runtime.apiKeyConfigured) throw new SpecificationCleanupProviderError("Specification cleanup is not configured.", "not_configured");
  let text: string;
  try {
    text = (await runAiProvider({ provider: runtime.provider, model: runtime.model, responseSchema: { name: "specification_cleanup", schema }, systemInstructions: instructions, timeoutMs: TIMEOUT_MS, userContent: { accessoryNames, items } })).text;
  } catch (error) { throw failure(error); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (error) { throw failure(error, true); }
  const results = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parseSpecificationCleanupResult((parsed as { results?: unknown }).results, items.map((item) => item.targetId)) : null;
  if (!results) throw failure(new Error("result did not match the schema"), true);
  return results;
}

// Plain-language message for the screen; the real reason goes to the server log (never the request text or the key).
function failure(error: unknown, unreadable = false) {
  console.error("SPECIFICATION CLEANUP ERROR", { kind: error instanceof AiProviderError ? error.kind : "other", reason: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown" });
  if (error instanceof AiProviderError && error.kind === "not_configured") return new SpecificationCleanupProviderError("Specification cleanup is not configured.", "not_configured");
  if (error instanceof AiProviderError && error.kind === "timeout") return new SpecificationCleanupProviderError("AI timed out. Try again.");
  if (unreadable) return new SpecificationCleanupProviderError("AI returned an answer I could not read.");
  const status = error instanceof AiProviderError ? /status (\d{3})/.exec(error.message)?.[1] : undefined;
  if (status) return new SpecificationCleanupProviderError(`AI service error ${status}.`);
  if (error instanceof AiProviderError && /no usable output/i.test(error.message)) return new SpecificationCleanupProviderError("AI returned an empty answer.");
  return new SpecificationCleanupProviderError("Specification cleanup could not be completed.");
}
