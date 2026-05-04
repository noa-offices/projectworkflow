import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type PendingProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  account_status: AccountStatus | null;
};

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,account_status")
    .eq("id", user.id)
    .single<PendingProfile>();

  if (profileError) {
    console.error("AUTH PROFILE ERROR", profileError.message);
  }

  if (profile?.account_status === "active") {
    redirect("/dashboard");
  }

  const isDisabled = profile?.account_status === "disabled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 py-12 text-zinc-900">
      <section className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <p className="text-sm font-medium text-emerald-900">ProjectWorkflow</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950">
          {isDisabled
            ? "Your account is disabled"
            : "Your account is waiting for approval"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          {isDisabled
            ? "Please contact an administrator if you believe this is a mistake."
            : "You will be able to access the workspace after an administrator activates your account."}
        </p>
        <form action={signOut} className="mt-6">
          <button
            type="submit"
            className="h-11 rounded-md border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
