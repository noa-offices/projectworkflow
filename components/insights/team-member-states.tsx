export function TeamMemberSkeleton() {
  return (
    <div role="status" aria-label="Loading member numbers" className="motion-safe:animate-pulse space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="h-2.5 w-24 rounded bg-zinc-200" />
            <div className="mt-3 h-6 w-16 rounded bg-zinc-200" />
          </div>
        ))}
      </div>
      <div className="h-48 rounded-xl border border-zinc-200 bg-white" />
      <div className="h-32 rounded-xl border border-zinc-200 bg-white" />
    </div>
  );
}

export function TeamMemberEmptyState() {
  return (
    <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
      <p className="mt-3 text-sm font-semibold text-zinc-700">No data in this period</p>
      <p className="mt-1 text-xs text-zinc-400">Try a longer date range to see this member&apos;s activity.</p>
    </div>
  );
}
