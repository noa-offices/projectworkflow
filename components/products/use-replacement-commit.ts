"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Reports when a section replacement has actually committed to the section's own state (and therefore to its form
 * inputs). Call it BEFORE the replacement effect: the returned `markApplied(version)` is invoked from that effect,
 * and `onCommitted(version)` fires after the NEXT commit, i.e. the render that contains the replaced state.
 * The commit counter (not a frame/timer count) is what makes the signal deterministic.
 */
export function useReplacementCommitSignal(onCommitted?: (version: number) => void) {
  const commits = useRef(0);
  const pending = useRef<{ version: number; appliedAtCommit: number } | null>(null);
  useEffect(() => {
    commits.current += 1;
    const current = pending.current;
    if (!current || commits.current <= current.appliedAtCommit) return;
    pending.current = null;
    onCommitted?.(current.version);
  });
  return useCallback((version: number | undefined) => {
    if (version !== undefined) pending.current = { version, appliedAtCommit: commits.current };
  }, []);
}
