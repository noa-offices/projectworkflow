import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12 text-zinc-900">
      <section className="w-full max-w-4xl rounded-lg border border-zinc-200 bg-white px-6 py-12 shadow-sm sm:px-10 lg:px-14">
        <div className="mb-8 inline-flex rounded-full border border-emerald-900/10 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-900">
          Project workflow system
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
          ProjectWorkflow
        </h1>
        <p className="mt-5 max-w-2xl text-xl leading-8 text-zinc-600">
          Quote. Specify. Order. Deliver.
        </p>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-500">
          A clean workspace for product-based projects, from early quotation
          through specifications, updates, and order readiness.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-900 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/quotations"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-200 px-5 text-sm font-semibold text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            View Quotations
          </Link>
        </div>
      </section>
    </main>
  );
}
