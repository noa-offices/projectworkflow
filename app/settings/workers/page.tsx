import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { WorkersTable } from "@/components/settings/workers-table";
import { requireSettingsManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkerRow } from "@/app/settings/workers/actions";

export const dynamic = "force-dynamic";

type WorkersPageProps = {
  searchParams?: Promise<{
    message?: string;
    messageType?: string;
  }>;
};

export default async function WorkersPage({ searchParams }: WorkersPageProps) {
  const { user, profile, displayName } = await requireSettingsManager();
  const params = (await searchParams) ?? {};
  const message = params.message;
  const messageType = params.messageType;

  const adminResult = createAdminClient();
  if (!adminResult.client) {
    throw new Error(adminResult.error ?? "Admin client unavailable");
  }
  const adminClient = adminResult.client;

  const { data: workers, error: workersError } = await adminClient
    .from("workers")
    .select("*")
    .order("full_name", { ascending: true })
    .returns<WorkerRow[]>();

  if (workersError) {
    console.error("WORKERS PAGE ERROR", workersError.message);
  }

  const messageClassName =
    messageType === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-950";

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title="Workers Directory"
      description="Manage field staff records and document expiry."
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Link
            href="/settings"
            className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
          >
            Back to settings
          </Link>
          {message ? (
            <p className={`rounded-md border px-3 py-2 text-sm ${messageClassName}`}>
              {message}
            </p>
          ) : null}
        </div>
        <WorkersTable workers={workers ?? []} />
      </div>
    </ErpAppShell>
  );
}
