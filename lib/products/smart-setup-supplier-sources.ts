import type { SupabaseClient } from "@supabase/supabase-js";
import { canReviewBrandPrices } from "./brand-price-permissions";
import type { SourceVersion } from "./supplier-price-contracts";
import { resolveApplicableSupplierSourceVersion, supplierBusinessDate, supplierRows } from "./supplier-price-repository";

export type SmartSetupSupplierSourceOption = { definitionId: string; name: string; versionId: string; versionTitle: string; effectiveFrom: string | null; receivedAt: string | null; currency: string; basis: string };
export type SmartSetupSupplierSourceList = { status: "unauthorized" } | { status: "ok"; sources: SmartSetupSupplierSourceOption[] };
export type SmartSetupSupplierSourceDeps = { getProfile: () => Promise<{ role?: string | null; account_status?: string | null } | null>; getClient: () => Promise<SupabaseClient> };

/**
 * Read-only: each active Supplier source definition of the Brand with its single currently applicable version (never archived, future or superseded).
 * A non-reviewer gets "unauthorized" and nothing is read. Versions without an explicit list/net basis are not offered because the check would reject them.
 */
export async function listSmartSetupSupplierSources(deps: SmartSetupSupplierSourceDeps, brandId: unknown): Promise<SmartSetupSupplierSourceList> {
  const profile = await deps.getProfile();
  if (!canReviewBrandPrices(profile?.role as never, profile?.account_status as never)) return { status: "unauthorized" };
  if (typeof brandId !== "string" || !brandId.trim() || brandId.length > 100) return { status: "ok", sources: [] };
  const client = await deps.getClient();
  if (!(await supplierRows<{ id: string }>(client, "brands", "id", { id: brandId })).length) return { status: "ok", sources: [] };
  const definitions = await supplierRows<{ id: string; name: string }>(client, "supplier_source_definitions", "id,name", { brand_id: brandId, is_active: true }, "name");
  const versions = await supplierRows<SourceVersion & { created_at: string }>(client, "supplier_source_versions", "*", { brand_id: brandId, status: "imported" }, "created_at");
  const today = supplierBusinessDate(); const sources: SmartSetupSupplierSourceOption[] = [];
  for (const definition of definitions) {
    const current = resolveApplicableSupplierSourceVersion(versions.filter((v) => v.definition_id === definition.id), today);
    if (current && ["list", "net"].includes(current.basis)) sources.push({ definitionId: definition.id, name: definition.name, versionId: current.id, versionTitle: current.title, effectiveFrom: current.effective_from, receivedAt: current.received_at, currency: current.currency, basis: current.basis });
  }
  return { status: "ok", sources };
}
