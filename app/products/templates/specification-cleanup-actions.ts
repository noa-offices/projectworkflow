"use server";
import { requireProductLibraryManager } from "@/lib/auth";
import { DIMENSION_CALL_MAX } from "@/lib/products/dimension-shortening";
import { validateSpecificationResults, type SpecificationMode, type SpecificationSuggestion } from "@/lib/products/specification-cleanup";
import { cleanSpecificationsWithProvider, SpecificationCleanupProviderError } from "@/lib/products/specification-cleanup-provider.server";

export type SpecificationCleanupActionResult =
  | { ok: true; suggestions: SpecificationSuggestion[] }
  | { ok: false; code: "invalid_request" | "not_configured" | "provider_failed"; message: string };

/** One call per group (at most 20 rows, one accessory name list). The AI answer is always re-checked in code; invalid, equal or empty results are dropped. */
export async function runSpecificationCleanup(request: { items: { targetId: string; text: string; mode: SpecificationMode }[]; accessoryNames: string[] }): Promise<SpecificationCleanupActionResult> {
  await requireProductLibraryManager();
  const { items, accessoryNames } = request ?? {};
  const valid = Array.isArray(items) && items.length > 0 && items.length <= DIMENSION_CALL_MAX
    && items.every((item) => item && typeof item.targetId === "string" && item.targetId.length > 0 && item.targetId.length <= 400 && typeof item.text === "string" && item.text.trim().length > 0 && item.text.length <= 5000 && (item.mode === "seating" || item.mode === "accessory_only"))
    && new Set(items.map((item) => item.targetId)).size === items.length
    && Array.isArray(accessoryNames) && accessoryNames.length <= 60 && accessoryNames.every((name) => typeof name === "string" && name.length <= 80);
  if (!valid) return { ok: false, code: "invalid_request", message: "A valid list of specifications is required." };
  try {
    const results = await cleanSpecificationsWithProvider(items.map((item) => ({ targetId: item.targetId, text: item.text, mode: item.mode })), accessoryNames);
    return { ok: true, suggestions: validateSpecificationResults(items, results) };
  } catch (error) {
    if (!(error instanceof SpecificationCleanupProviderError)) console.error("SPECIFICATION CLEANUP ACTION ERROR", error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown");
    const notConfigured = error instanceof SpecificationCleanupProviderError && error.kind === "not_configured";
    return { ok: false, code: notConfigured ? "not_configured" : "provider_failed", message: error instanceof SpecificationCleanupProviderError ? error.message : "Specification cleanup could not be completed." };
  }
}
