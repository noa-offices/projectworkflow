import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ActiveProjectsTable } from "@/components/projects/active-projects-table";
import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ActiveProjectsPage() {
  const { user, profile, displayName } = await requireActiveUser();
  const supabase = await createSupabaseClient();

  const [{ data: quotations }, { data: clients }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, layout_settings")
      .returns<Array<{ id: string; layout_settings: unknown }>>(),
    supabase
      .from("clients")
      .select("id,company_name")
      .returns<Array<{ id: string; company_name: string | null }>>(),
  ]);

  const clientNameById = new Map(
    (clients ?? []).map((c) => [c.id, c.company_name ?? "-"]),
  );

  const projectFiles = (quotations ?? [])
    .flatMap((quotation) => {
      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile) return [projectFile];
      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      return draft?.confirmedOrder ? [draft.confirmedOrder] : [];
    })
    .filter((order, index, all) => all.findIndex((o) => o.orderNo === order.orderNo) === index)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const projectFilesWithClient = projectFiles.map((order) => ({
    ...order,
    resolvedClientName: clientNameById.get(order.clientId) ?? order.clientName,
  }));

  return (
    <ErpAppShell
      eyebrow="PROJECTS"
      title="Active Project Files"
      description="All confirmed project files created from approved quotations."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        {projectFilesWithClient.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              No project files yet. Create one from an approved quotation.
            </p>
          </div>
        ) : (
          <ActiveProjectsTable projectFiles={projectFilesWithClient} />
        )}
      </div>
    </ErpAppShell>
  );
}
