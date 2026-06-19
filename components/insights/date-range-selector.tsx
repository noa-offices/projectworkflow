"use client";

import { usePathname, useRouter } from "next/navigation";

const OPTIONS = [
  { value: "30d", label: "Last 30 days" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "Last 1 year" },
];

export function DateRangeSelector({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      value={current}
      onChange={(e) => router.push(`${pathname}?range=${e.target.value}`)}
      className="h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 shadow-sm focus:border-emerald-600 focus:outline-none"
    >
      {OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
