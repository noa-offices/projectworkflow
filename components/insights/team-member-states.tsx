export function TeamMemberSkeleton() {
  return (
    <div role="status" aria-label="Loading member numbers" className="animate-pulse space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="rounded-lg border border-zinc-200 bg-white p-3">
            <div className="h-2.5 w-24 rounded bg-zinc-200" />
            <div className="mt-3 h-6 w-16 rounded bg-zinc-200" />
          </div>
        ))}
      </div>
      <div className="h-48 rounded-lg border border-zinc-200 bg-white" />
      <div className="h-32 rounded-lg border border-zinc-200 bg-white" />
    </div>
  );
}

export function TeamMemberEmptyState() {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-10 text-center">
      <p className="text-sm font-semibold text-zinc-700">No data in this period</p>
      <p className="mt-1 text-xs text-zinc-400">Try a longer date range to see this member&apos;s activity.</p>
    </div>
  );
}
