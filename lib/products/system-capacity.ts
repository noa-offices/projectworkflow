export type CapacityTable = { schema: string; name: string; table_bytes: number; index_bytes: number; total_bytes: number; rows: number | null };
export type CapacityIndex = { schema: string; name: string; table_name: string; bytes: number };
export type CapacityBucket = { name: string; objects: number; total_bytes: number; largest_bytes: number | null; unknown_sizes: number };
export type CapacitySnapshot = { id: string; captured_at: string; database_bytes: number; storage_bytes: number | null; supplier_bytes: number; product_image_bytes: number | null; quote_image_bytes: number | null; other_storage_bytes: number | null };
export type CapacitySources = { current: number; previous: number; archived: number; compacted: number; upcoming: number; unfinished: number; update_in_progress: number };
export type SystemCapacityReport = {
  generated_at: string; database_bytes: number; supplier_bytes: number; supplier_index_bytes: number;
  storage_bytes: number | null; tables: CapacityTable[]; indexes: CapacityIndex[]; buckets: CapacityBucket[];
  reclaimable: { bytes: number; items: number }; sources: CapacitySources;
  snapshots: CapacitySnapshot[]; baseline_30_day: CapacitySnapshot | null; monthly: CapacitySnapshot[];
  database_limit: number | null; storage_limit: number | null;
  database_setting: number | null; storage_setting: number | null;
  storage_cleanup?: import("./product-source-cleanup.server").ProductSourceCleanupAnalysis;
};

export type CapacityUnit = "MB" | "GB";
export type CapacitySettingsInput = { databaseValue: string; databaseUnit: CapacityUnit; storageValue: string; storageUnit: CapacityUnit };

/** Blank means clear the saved override and use the environment fallback. */
export function capacityInputBytes(value: unknown, unit: unknown): number | null {
  if (typeof value !== "string") throw Error("Capacity must be a positive number.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (unit !== "MB" && unit !== "GB") throw Error("Capacity unit must be MB or GB.");
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) throw Error("Capacity must be a positive number.");
  const amount = Number(trimmed);
  const bytes = Math.round(amount * (unit === "GB" ? 1_073_741_824 : 1_048_576));
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(bytes) || bytes <= 0) throw Error("Capacity must be a positive number within the supported range.");
  return bytes;
}

export function capacitySettingInput(bytes: number | null): { value: string; unit: CapacityUnit } {
  if (bytes === null) return { value: "", unit: "GB" };
  const unit: CapacityUnit = bytes >= 1_073_741_824 ? "GB" : "MB";
  const divisor = unit === "GB" ? 1_073_741_824 : 1_048_576;
  return { value: String(Number((bytes / divisor).toFixed(3))), unit };
}

/** Limits are manually configured server-side, never inferred from a subscription tier. */
export function configuredCapacity(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

export function capacityHealth(bytes: number | null, limit: number | null) {
  const used = bytes !== null && limit !== null && limit > 0 ? bytes / limit * 100 : null;
  return { used, status: used === null ? "Unknown" : used < 70 ? "Healthy" : used <= 85 ? "Watch" : "Action needed" };
}

export function capacityBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "Unknown";
  const unit = Math.abs(bytes) >= 1_073_741_824 ? "GB" : "MB";
  return `${(bytes / (unit === "GB" ? 1_073_741_824 : 1_048_576)).toFixed(1)} ${unit}`;
}

export function capacityChange(current: number | null, previous: number | null | undefined): string {
  if (current === null || previous === null || previous === undefined) return "Not enough history";
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${capacityBytes(delta)}`;
}

/** Comparing with an actual sample at/before 30 days avoids inventing interpolated history. */
export function capacityTrend(report: SystemCapacityReport) {
  const previous = report.snapshots[0] ?? null;
  const baseline = report.baseline_30_day;
  const change = baseline ? report.database_bytes - baseline.database_bytes : null;
  const fastGrowth = change !== null && change > 0 && baseline !== null && baseline.database_bytes > 0
    && change / baseline.database_bytes >= 0.2;
  return { previous, baseline, change, fastGrowth };
}

export type GrowthPoint = { at: string; database: number; storage: number | null };

/** Oldest-first series from recorded snapshots only; a trend needs at least two samples. */
export function growthSeries(report: Pick<SystemCapacityReport, "snapshots">): GrowthPoint[] {
  return [...report.snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id))
    .map((snapshot) => ({ at: snapshot.captured_at, database: snapshot.database_bytes, storage: snapshot.storage_bytes }));
}

/** Share of the Storage total; unknown when no denominator is measured. */
export function bucketShares(buckets: CapacityBucket[], storageBytes: number | null) {
  const known = buckets.reduce((sum, bucket) => sum + bucket.total_bytes, 0);
  const total = storageBytes ?? known;
  return [...buckets].sort((a, b) => b.total_bytes - a.total_bytes).map((bucket) => ({ ...bucket, share: total > 0 ? Math.min(100, bucket.total_bytes / total * 100) : null }));
}

export function meterPercent(used: number | null): number | null {
  return used === null ? null : Math.max(0, Math.min(100, used));
}

export type StorageForecast = { dailyBytes: number; monthlyBytes: number; daysTo70: number | null; daysTo85: number | null; sampleDays: number };

/** Forecasts only from recorded Storage snapshots spanning at least seven days. */
export function storageForecast(report: Pick<SystemCapacityReport, "snapshots" | "storage_bytes" | "storage_limit">): StorageForecast | null {
  if (report.storage_limit === null || report.storage_limit <= 0) return null;
  const samples = [...report.snapshots].filter((snapshot) => snapshot.storage_bytes !== null).sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  if (samples.length < 2) return null;
  const first = samples[0], last = samples[samples.length - 1];
  const sampleDays = (Date.parse(last.captured_at) - Date.parse(first.captured_at)) / 86_400_000;
  if (!Number.isFinite(sampleDays) || sampleDays < 7 || last.storage_bytes === null || first.storage_bytes === null) return null;
  const dailyBytes = (last.storage_bytes - first.storage_bytes) / sampleDays;
  if (!Number.isFinite(dailyBytes) || dailyBytes <= 0) return null;
  const latestBytes = last.storage_bytes;
  const daysTo = (ratio: number) => latestBytes >= report.storage_limit! * ratio ? 0 : Math.ceil((report.storage_limit! * ratio - latestBytes) / dailyBytes);
  return { dailyBytes, monthlyBytes: dailyBytes * 30.4375, daysTo70: daysTo(0.7), daysTo85: daysTo(0.85), sampleDays };
}
