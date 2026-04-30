import Link from "next/link";
import { login } from "@/app/auth/actions";

type LoginPageProps = {
  searchParams?: Promise<{
    message?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const message = (await searchParams)?.message;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12 text-zinc-900">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-emerald-900">ProjectWorkflow</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950">
          Sign in
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Use your approved account to access the workspace.
        </p>
        {message ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {message}
          </p>
        ) : null}
        <form action={login} className="mt-6 space-y-4">
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
              autoComplete="current-password"
              required
              className="mt-1 h-11 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Sign in
          </button>
        </form>
        <p className="mt-5 text-sm text-zinc-500">
          Need access?{" "}
          <Link href="/signup" className="font-medium text-emerald-900">
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
