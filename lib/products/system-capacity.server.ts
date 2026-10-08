import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupplierPriceListLifecycleState, supplierBusinessDate } from "./supplier-price-repository";
import { configuredCapacity, type CapacitySources, type SystemCapacityReport } from "./system-capacity";
import { analyzeProductSourceCleanup } from "./product-source-cleanup.server";

type SourceMetadata = { id: string; brand_id: string; definition_id: string | null; status: string; effective_from: string | null; created_at: string; rows_compacted_at: string | null };
type ReviewMetadata = { source_id: string; status: string; completed_at: string | null };
type RawReport = Omit<SystemCapacityReport, "sources" | "database_limit" | "storage_limit" | "database_setting" | "storage_setting" | "storage_cleanup"> & { source_metadata: SourceMetadata[]; review_metadata: ReviewMetadata[] };
export type SystemCapacitySettings = { database_capacity_bytes: number | null; storage_capacity_bytes: number | null; updated_at: string | null; updated_by: string | null };

export async function systemCapacityReport(client: SupabaseClient): Promise<SystemCapacityReport> {
  const [{ data, error }, settingsResult] = await Promise.all([
    client.rpc("system_capacity_report"),
    client.rpc("system_capacity_settings_read"),
  ]);
  if (error) throw Error(error.code === "42883" || error.code === "PGRST202" ? "Database health requires the system_capacity_snapshots migration." : error.message);
  if (settingsResult.error) throw Error(settingsResult.error.code === "42883" || settingsResult.error.code === "PGRST202" ? "Database health requires the system_capacity_settings migration." : settingsResult.error.message);
  const { source_metadata, review_metadata, ...metrics } = data as RawReport;
  const settings = settingsResult.data as SystemCapacitySettings;
  const sources: CapacitySources = { current: 0, previous: 0, archived: 0, compacted: 0, upcoming: 0, unfinished: 0, update_in_progress: 0 };
  const groups = new Map<string, SourceMetadata[]>();
  const reviews = new Map<string, ReviewMetadata[]>();
  for (const source of source_metadata) {
    const key = `${source.brand_id}:${source.definition_id ?? "legacy"}`;
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  const groupForSource = new Map(source_metadata.map((source) => [source.id, `${source.brand_id}:${source.definition_id ?? "legacy"}`]));
  for (const review of review_metadata) {
    const key = groupForSource.get(review.source_id);
    if (key) reviews.set(key, [...(reviews.get(key) ?? []), review]);
  }
  const businessDate = supplierBusinessDate(new Date(metrics.generated_at));
  for (const [key, versions] of groups) for (const version of versions) {
    sources[resolveSupplierPriceListLifecycleState(version, versions, reviews.get(key) ?? [], businessDate)]++;
    if (version.rows_compacted_at) sources.compacted++;
  }
  const databaseSetting = settings.database_capacity_bytes ?? null;
  const storageSetting = settings.storage_capacity_bytes ?? null;
  return {
    ...metrics,
    sources,
    database_setting: databaseSetting,
    storage_setting: storageSetting,
    database_limit: databaseSetting ?? configuredCapacity(process.env.SYSTEM_DATABASE_CAPACITY_BYTES),
    storage_limit: storageSetting ?? configuredCapacity(process.env.SYSTEM_STORAGE_CAPACITY_BYTES),
  };
}

/** Owner-gated dashboard payload: live database metrics plus Storage cleanup analysis. */
export async function systemCapacityReportWithStorageCleanup(client: SupabaseClient): Promise<SystemCapacityReport> {
  const [report, storage_cleanup] = await Promise.all([systemCapacityReport(client), analyzeProductSourceCleanup()]);
  return { ...report, storage_cleanup };
}

export async function saveSystemCapacitySettings(client: SupabaseClient, databaseBytes: number | null, storageBytes: number | null): Promise<SystemCapacitySettings> {
  const { data, error } = await client.rpc("system_capacity_settings_save", { p_database_capacity_bytes: databaseBytes, p_storage_capacity_bytes: storageBytes });
  if (error) throw Error(error.message);
  return data as SystemCapacitySettings;
}

/** The RPC samples on the server; callers cannot supply or forge recorded metrics. */
export async function captureSystemCapacitySnapshot(client: SupabaseClient): Promise<void> {
  const { error } = await client.rpc("capture_system_capacity_snapshot");
  if (error) throw Error(error.message);
}
