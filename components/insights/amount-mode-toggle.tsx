"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { amountModeQuery, parseAmountMode, type AmountMode } from "@/lib/insights/sales-report-money";

export function AmountModeToggle({ preserveScroll }: { preserveScroll?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlMode = parseAmountMode(searchParams.get("amount"));
  const [mode, setMode] = useOptimistic(urlMode);
  const [, startTransition] = useTransition();

  function choose(next: AmountMode) {
    if (next === mode) return;
    startTransition(() => {
      setMode(next);
      const query = amountModeQuery(searchParams.toString(), next);
      router.replace(query ? `${pathname}?${query}` : pathname, preserveScroll ? { scroll: false } : undefined);
    });
  }

  const segment = (value: AmountMode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      onClick={() => choose(value)}
      className={`h-7 rounded-full px-3 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-600 ${
        mode === value ? "bg-emerald-900 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div role="radiogroup" aria-label="Amount display" data-amount-toggle className="inline-flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white p-0.5 shadow-sm">
      {segment("millions", "Millions")}
      {segment("full", "Full AED")}
    </div>
  );
}
