import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSupplierCleanup, cleanupCurrentSources, type CleanupBatch, type CleanupVerdict, type CleanupVersion, type SupplierCleanup } from "./supplier-cleanup";
import { supplierBusinessDate, supplierCoverageOverview, supplierPreviousSources, supplierRows } from "./supplier-price-repository";

/**
 * Read-only: the Brand's price lists, reviews and definitions, plus the database's own safety check for the older lists of each Supplier
 * source (the same check the delete uses). Nothing is changed here.
 */
export async function loadSupplierCleanup(client: SupabaseClient, brandId: string): Promise<SupplierCleanup> {
  const [versions, batches, coverage] = await Promise.all([
    supplierRows<CleanupVersion>(client, "supplier_source_versions", "id,definition_id,title,filename,status,effective_from,created_at,stored_rows", { brand_id: brandId }, "created_at"),
    supplierRows<CleanupBatch>(client, "supplier_price_batches", "id,source_id,status,completed_at", { brand_id: brandId }, "created_at"),
    supplierCoverageOverview(client, brandId),
  ]);
  const businessDate = supplierBusinessDate();
  const verdicts = new Map<string, CleanupVerdict[]>();
  for (const [definitionId, current] of cleanupCurrentSources(versions, businessDate)) {
    if (!definitionId) continue; // lists with no Supplier source cannot be checked by the database function
    verdicts.set(current.id, await supplierPreviousSources(client, current.id));
  }
  return buildSupplierCleanup({ versions, batches, definitions: coverage.definitions.map((item) => ({ id: item.id, name: item.name, isActive: item.isActive, canDelete: item.canDelete, familyCount: item.families.length })), verdicts, businessDate });
}
