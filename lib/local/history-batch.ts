/**
 * Undo-history bookkeeping for the local quotation builder (no workspace data, no prices).
 *
 * Normal edits keep the existing rule: a "merge" commit with the same group key within the merge window joins the previous history entry.
 * A bulk action runs its commits inside one history batch: every commit in the batch uses the batch's own unique key, so the first commit
 * starts one new history entry (it can never join an earlier typing group) and the rest join it, regardless of time. One undo restores all.
 */
export type HistoryGroup = { key: string; timestamp: number } | null;
export type HistoryOptions = { groupKey?: string; mode?: "push" | "merge" | "skip" };

const BATCH_PREFIX = "history-batch:";
let batchCounter = 0;

export const isHistoryBatchKey = (key: string | null | undefined) => Boolean(key && key.startsWith(BATCH_PREFIX));

/** Inside a batch every non-skip commit merges into the batch's key; outside a batch the options are unchanged. */
export function withHistoryBatch(batchKey: string | null, options: HistoryOptions): HistoryOptions {
  if (!batchKey || options.mode === "skip") return options;
  return { groupKey: batchKey, mode: "merge" };
}

export function canMergeHistory(group: HistoryGroup, options: HistoryOptions, now: number, mergeWindowMs: number): boolean {
  return (
    options.mode === "merge" &&
    Boolean(options.groupKey) &&
    group !== null &&
    group.key === options.groupKey &&
    (isHistoryBatchKey(options.groupKey) || now - group.timestamp <= mergeWindowMs)
  );
}

export function nextHistoryGroup(group: HistoryGroup, options: HistoryOptions, canMerge: boolean, now: number): HistoryGroup {
  if (options.mode !== "merge" || !options.groupKey) return null;
  return canMerge ? group : { key: options.groupKey, timestamp: now };
}

/**
 * Runs `run` as one history step. The key is unique per batch and is always cleared (even if `run` throws). A call inside a running
 * batch joins it (no nesting).
 */
export function runInHistoryBatch<T>(ref: { current: string | null }, run: () => T): T {
  if (ref.current) return run();
  batchCounter += 1;
  ref.current = `${BATCH_PREFIX}${batchCounter}`;
  try {
    return run();
  } finally {
    ref.current = null;
  }
}
