export function InventorySkeleton() {
  return <div role="status" aria-label="Loading inventory" aria-busy="true" className="animate-pulse space-y-5">
    <span className="sr-only">Loading inventory…</span>
    <div className="h-12 rounded-lg border border-zinc-200 bg-white" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-4 aspect-[4/3] rounded-md bg-zinc-100" /><div className="h-5 w-2/3 rounded bg-zinc-200" /><div className="mt-3 h-4 w-1/2 rounded bg-zinc-100" />
    </div>)}</div>
  </div>;
}
