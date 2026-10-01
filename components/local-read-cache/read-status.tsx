"use client";
import { useSyncExternalStore } from "react";
import { getHealth, getServerHealth, subscribeHealth } from "@/lib/local-read-cache/runtime";
export function ReadCacheStatus() {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getServerHealth);
  return <span role="status" title={health.detail} className="max-w-36 text-xs text-zinc-500">{health.status}</span>;
}
