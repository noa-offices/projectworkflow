// Light loading skeleton shown by loading.tsx while a list page renders on the server (title, filter row, card rows).
export function ListPageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="mx-auto w-full max-w-6xl animate-pulse px-4 py-6 sm:px-6">
      <div className="h-8 w-56 rounded-md bg-zinc-200" />
      <div className="mt-2 h-4 w-80 max-w-full rounded bg-zinc-100" />
      <div className="mt-6 flex flex-wrap gap-3">
        <div className="h-10 w-64 max-w-full rounded-md bg-zinc-200" />
        <div className="h-10 w-40 rounded-md bg-zinc-200" />
        <div className="h-10 w-32 rounded-md bg-zinc-200" />
      </div>
      <div className="mt-6 grid gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="h-3 w-24 rounded bg-zinc-100" />
            <div className="mt-3 h-5 w-2/5 rounded bg-zinc-200" />
            <div className="mt-3 h-3 w-3/5 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
