"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DATE_RANGE_OPTIONS } from "@/lib/insights/date-ranges";

export function DateRangeSelector({
  current,
  customFrom,
  customTo,
  onPendingChange,
  preserveScroll,
}: {
  current: string;
  customFrom?: string;
  customTo?: string;
  onPendingChange?: (pending: boolean) => void;
  preserveScroll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState(current);
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  function navigate(range: string, nextFrom?: string, nextTo?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    if (range === "custom" && nextFrom && nextTo) {
      params.set("from", nextFrom);
      params.set("to", nextTo);
    } else {
      params.delete("from");
      params.delete("to");
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`, preserveScroll ? { scroll: false } : undefined));
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
      <select
        value={mode}
        onChange={(event) => {
          const nextMode = event.target.value;
          setMode(nextMode);
          if (nextMode !== "custom") navigate(nextMode);
        }}
        className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm focus:border-emerald-600 focus:outline-none"
      >
        {DATE_RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {mode === "custom" ? (
        <>
          <input
            aria-label="Start date"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
          />
          <span className="text-xs text-zinc-400">to</span>
          <input
            aria-label="End date"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
          />
          <button
            type="button"
            disabled={!from || !to || from > to}
            onClick={() => navigate("custom", from, to)}
            className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
          >
            Apply
          </button>
        </>
      ) : null}
    </div>
  );
}
