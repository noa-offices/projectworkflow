"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "ytd", label: "Year to date" },
  { value: "1y", label: "Last 1 year" },
  { value: "custom", label: "Custom range" },
];

export function DateRangeSelector({
  current,
  customFrom,
  customTo,
}: {
  current: string;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState(current);
  const [from, setFrom] = useState(customFrom ?? "");
  const [to, setTo] = useState(customTo ?? "");

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
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={mode}
        onChange={(event) => {
          const nextMode = event.target.value;
          setMode(nextMode);
          if (nextMode !== "custom") navigate(nextMode);
        }}
        className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm focus:border-emerald-600 focus:outline-none"
      >
        {OPTIONS.map((opt) => (
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
