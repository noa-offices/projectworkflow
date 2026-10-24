/** Same shape as the real page: action row, tabs, search row, then two-up photo cards. */
export function InventorySkeleton() {
  return <div role="status" aria-label="Loading inventory" aria-busy="true" className="animate-pulse space-y-3 motion-reduce:animate-none">
    <span className="sr-only">Loading inventory…</span>
    <div className="flex gap-2"><div className="h-11 flex-1 rounded-lg bg-zinc-200" /><div className="h-11 flex-1 rounded-lg bg-zinc-100" /><div className="h-11 w-11 rounded-lg bg-zinc-100" /></div>
    <div className="h-14 rounded-lg border border-zinc-200 bg-white" />
    <div className="flex gap-2"><div className="h-11 flex-1 rounded-lg border border-zinc-200 bg-white" /><div className="h-11 w-28 rounded-lg border border-zinc-200 bg-white" /></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="aspect-[4/3] bg-zinc-100" /><div className="space-y-2 p-3"><div className="h-4 w-3/4 rounded bg-zinc-200" /><div className="h-4 w-1/3 rounded bg-zinc-100" /><div className="h-4 w-1/2 rounded bg-zinc-100" /></div>
    </div>)}</div>
  </div>;
}
