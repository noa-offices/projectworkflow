import Link from "next/link";
import { signup } from "@/app/auth/actions";

type SignupPageProps = {
  searchParams?: Promise<{
    message?: string;
  }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const message = (await searchParams)?.message;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12 text-zinc-900">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-emerald-900">ProjectWorkflow</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950">
          Create account
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          New accounts wait for approval before workspace access is enabled.
        </p>
        {message ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {message}
          </p>
        ) : null}
        <form action={signup} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-zinc-800">Full name</span>
            <input
              name="full_name"
              type="text"
              autoComplete="name"
              required
              className="mt-1 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-800">Email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-800">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="mt-1 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Create account
          </button>
        </form>
        <p className="mt-5 text-sm text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-emerald-900">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
