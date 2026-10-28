"use server";
import { requireProductLibraryManager } from "@/lib/auth";
import { DIMENSION_CALL_MAX, validateDimensionResults, type DimensionSuggestion } from "@/lib/products/dimension-shortening";
import { DimensionShorteningProviderError, shortenDimensionsWithProvider } from "@/lib/products/dimension-shortening-provider.server";

export type DimensionShorteningActionResult =
  | { ok: true; suggestions: DimensionSuggestion[]; dropped: number }
  | { ok: false; code: "invalid_request" | "not_configured" | "provider_failed"; message: string };

/** One call per group (at most 20 rows). The AI answer is always re-checked in code; invalid or unchanged results are dropped. */
export async function runDimensionShortening(request: { items: { targetId: string; text: string }[] }): Promise<DimensionShorteningActionResult> {
  await requireProductLibraryManager();
  const items = request?.items;
  const valid = Array.isArray(items) && items.length > 0 && items.length <= DIMENSION_CALL_MAX
    && items.every((item) => item && typeof item.targetId === "string" && item.targetId.length > 0 && item.targetId.length <= 400 && typeof item.text === "string" && item.text.trim().length > 0 && item.text.length <= 2000)
    && new Set(items.map((item) => item.targetId)).size === items.length;
  if (!valid) return { ok: false, code: "invalid_request", message: "A valid list of dimensions is required." };
  try {
    const results = await shortenDimensionsWithProvider(items.map((item) => ({ targetId: item.targetId, text: item.text })));
    const suggestions = validateDimensionResults(items, results);
    return { ok: true, suggestions, dropped: results.filter((result) => result.dimension).length - suggestions.length };
  } catch (error) {
    if (!(error instanceof DimensionShorteningProviderError)) console.error("DIMENSION SHORTENING ACTION ERROR", error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown");
    const notConfigured = error instanceof DimensionShorteningProviderError && error.kind === "not_configured";
    return { ok: false, code: notConfigured ? "not_configured" : "provider_failed", message: error instanceof DimensionShorteningProviderError ? error.message : "Dimension shortening could not be completed." };
  }
}
