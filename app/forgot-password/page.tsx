import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/actions";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    message?: string;
    type?: string;
  }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = (await searchParams) ?? {};
  const message = params.message;
  const type = params.type;

  const messageClassName =
    type === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12 text-zinc-900">
      <section className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-emerald-900">ProjectWorkflow</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950">
          Reset your password
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Enter your email and we'll send you a reset link.
        </p>
        {message ? (
          <p className={`mt-4 rounded-md border px-3 py-2 text-sm ${messageClassName}`}>
            {message}
          </p>
        ) : null}
        <form action={requestPasswordReset} className="mt-6 space-y-4">
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
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Send reset link
          </button>
        </form>
        <p className="mt-5 text-sm text-zinc-500">
          <Link href="/login" className="font-medium text-emerald-900">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
