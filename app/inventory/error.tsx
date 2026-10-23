"use client";
import Link from "next/link";
export default function InventoryError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <section role="alert" className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold text-zinc-950">Inventory could not be loaded</h2><p className="mt-2 text-sm text-zinc-600">Please try again in a moment.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => unstable_retry()} className="min-h-11 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white">Try again</button><Link href="/inventory" className="inline-flex min-h-11 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700">Overview</Link></div></section>;
}
