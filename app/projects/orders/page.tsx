import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default async function ActiveProjectsPage() {
  const { user, displayName } = await requireActiveUser();
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

  return (
    <ErpAppShell
      eyebrow="PROJECTS"
      title="Active Project Files"
      description="All confirmed project files created from approved quotations."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        {projectFiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              No project files yet. Create one from an approved quotation.
            </p>
          </div>
        ) : (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                      Project File No
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                      Client
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                      Reference
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">
                      Total
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                      Created
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {projectFiles.map((order) => (
                    <tr key={order.orderNo} className="border-b border-zinc-100 hover:bg-zinc-50">
                      <td className="px-4 py-3 font-semibold text-zinc-950">{order.orderNo}</td>
                      <td className="px-4 py-3 text-zinc-700">
                        {clientNameById.get(order.clientId) ?? order.clientName}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{order.reference || "-"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-950">
                        {formatQuotationMoney(order.currency, order.total)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{formatDate(order.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/projects/orders/${encodeURIComponent(order.orderNo)}`}
                          className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </ErpAppShell>
  );
}
