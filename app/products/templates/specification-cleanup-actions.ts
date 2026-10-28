"use server";
import { requireProductLibraryManager } from "@/lib/auth";
import { SPECIFICATION_CLEANUP_BATCH_SIZE, validateSpecificationResults, type SpecificationMode, type SpecificationSuggestion } from "@/lib/products/specification-cleanup";
import { cleanSpecificationsWithProvider, SpecificationCleanupProviderError } from "@/lib/products/specification-cleanup-provider.server";

export type SpecificationCleanupActionResult =
  | { ok: true; suggestions: SpecificationSuggestion[] }
  | { ok: false; code: "invalid_request" | "not_configured" | "provider_failed"; message: string };

/** One call per batch (at most 6 rows, one accessory name list). The AI answer is always re-checked in code; invalid, equal or empty results are dropped. */
export async function runSpecificationCleanup(request: { items: { targetId: string; text: string; mode: SpecificationMode }[]; accessoryNames: string[] }): Promise<SpecificationCleanupActionResult> {
  await requireProductLibraryManager();
  const { items, accessoryNames } = request ?? {};
  const valid = Array.isArray(items) && items.length > 0 && items.length <= SPECIFICATION_CLEANUP_BATCH_SIZE
    && items.every((item) => item && typeof item.targetId === "string" && item.targetId.length > 0 && item.targetId.length <= 400 && typeof item.text === "string" && item.text.trim().length > 0 && item.text.length <= 5000 && (item.mode === "seating" || item.mode === "accessory_only"))
    && new Set(items.map((item) => item.targetId)).size === items.length
    && Array.isArray(accessoryNames) && accessoryNames.length <= 60 && accessoryNames.every((name) => typeof name === "string" && name.length <= 80);
  if (!valid) return { ok: false, code: "invalid_request", message: "A valid list of specifications is required." };
  const started = Date.now();
  try {
    const results = await cleanSpecificationsWithProvider(items.map((item) => ({ targetId: item.targetId, text: item.text, mode: item.mode })), accessoryNames);
    console.info("SPECIFICATION CLEANUP BATCH", { rows: items.length, accessories: accessoryNames.length, ms: Date.now() - started, ok: true });
    return { ok: true, suggestions: validateSpecificationResults(items, results) };
  } catch (error) {
    console.info("SPECIFICATION CLEANUP BATCH", { rows: items.length, accessories: accessoryNames.length, ms: Date.now() - started, ok: false });
    if (!(error instanceof SpecificationCleanupProviderError)) console.error("SPECIFICATION CLEANUP ACTION ERROR", error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : "unknown");
    const notConfigured = error instanceof SpecificationCleanupProviderError && error.kind === "not_configured";
    return { ok: false, code: notConfigured ? "not_configured" : "provider_failed", message: error instanceof SpecificationCleanupProviderError ? error.message : "Specification cleanup could not be completed." };
  }
}
