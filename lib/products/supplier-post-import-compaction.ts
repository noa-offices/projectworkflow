export const RAW_CLEANUP_NOTE = "Import succeeded. Some raw rows may remain because automatic cleanup did not finish.";
export async function compactAfterSupplierImport(
  progress: { done: boolean; status?: string; identity_count?: number }, sourceId: string,
  step: () => Promise<{ data: unknown; error: unknown }>, now: () => number = Date.now,
): Promise<string | undefined> {
  if (!progress.done || progress.status !== "imported") return;
  if (!progress.identity_count || progress.identity_count < 1) return RAW_CLEANUP_NOTE;
  const deadline = now() + 20_000;
  try {
    // Bound both calls and elapsed time. Each DB call independently commits a safe batch.
    for (let i = 0; i < 32 && now() < deadline; i++) {
      const { data, error } = await step();
      const result = data as { source_id?: string; done?: boolean; rows_compacted_at?: string } | null;
      if (error || result?.source_id !== sourceId || typeof result.done !== "boolean") return RAW_CLEANUP_NOTE;
      if (result.done) return typeof result.rows_compacted_at === "string" && Number.isFinite(Date.parse(result.rows_compacted_at)) ? undefined : RAW_CLEANUP_NOTE;
    }
  } catch { /* Compaction failure never turns a successful import into a failed import. */ }
  return RAW_CLEANUP_NOTE;
}
