import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { CompletedProjectsTable, type CompletedProjectFileItem } from "@/components/projects/completed-projects-table";
import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CompletedProjectsPage() {
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

  const projectFiles: CompletedProjectFileItem[] = (quotations ?? [])
    .flatMap((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt = typeof settings?.projectCompletedAt === "string"
        ? settings.projectCompletedAt
        : null;
      if (!completedAt) return [];

      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile) {
        return [{
          orderNo: projectFile.orderNo,
          clientId: projectFile.clientId,
          clientName: projectFile.clientName,
          resolvedClientName: clientNameById.get(projectFile.clientId) ?? projectFile.clientName,
          reference: projectFile.reference,
          currency: projectFile.currency,
          total: projectFile.total,
          createdAt: projectFile.createdAt,
          completedAt,
        }];
      }

      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      if (draft?.confirmedOrder) {
        const o = draft.confirmedOrder;
        return [{
          orderNo: o.orderNo,
          clientId: o.clientId,
          clientName: o.clientName,
          resolvedClientName: clientNameById.get(o.clientId) ?? o.clientName,
          reference: o.reference,
          currency: o.currency,
          total: o.total,
          createdAt: o.createdAt,
          completedAt,
        }];
      }

      return [];
    })
    .filter((order, index, all) => all.findIndex((o) => o.orderNo === order.orderNo) === index)
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

  return (
    <ErpAppShell
      eyebrow="PROJECTS"
      title="Completed Projects"
      description="Project files that have been marked as completed."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">
        {projectFiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              No completed projects yet. Use &ldquo;Mark as Completed&rdquo; on a Project Activity page.
            </p>
          </div>
        ) : (
          <CompletedProjectsTable projectFiles={projectFiles} />
        )}
      </div>
    </ErpAppShell>
  );
}
