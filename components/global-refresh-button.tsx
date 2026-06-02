"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startGlobalLoading, stopGlobalLoading } from "@/lib/global-loading";

type RefreshStatus = "idle" | "updated";

export function GlobalRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<RefreshStatus>("idle");
  const resetTimerRef = useRef<number | null>(null);
  const wasPendingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPending) {
      wasPendingRef.current = true;
      return;
    }

    if (!wasPendingRef.current) {
      return;
    }

    wasPendingRef.current = false;
    stopGlobalLoading();
    setStatus("updated");
    resetTimerRef.current = window.setTimeout(() => {
      setStatus("idle");
      resetTimerRef.current = null;
    }, 1500);
  }, [isPending]);

  const label = isPending
    ? "Refreshing..."
    : status === "updated"
      ? "Updated"
      : "Refresh data";

  return (
    <button
      type="button"
      disabled={isPending}
      aria-disabled={isPending}
      onClick={() => {
        if (resetTimerRef.current !== null) {
          window.clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }

        setStatus("idle");
        startGlobalLoading("action");
        startTransition(() => {
          router.refresh();
        });
      }}
      className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {label}
    </button>
  );
}
