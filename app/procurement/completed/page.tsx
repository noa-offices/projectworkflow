import Link from "next/link";
import { redirect } from "next/navigation";
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

export default async function CompletedProcurementPage() {
  const { user, profile, displayName } = await requireActiveUser();

  const role = profile?.role ?? null;
  const canAccessProcurement =
    role === "system_owner" ||
    role === "admin_manager" ||
    role === "procurement_manager";

  if (!canAccessProcurement) {
    redirect(
      "/dashboard?message=You+do+not+have+permission+to+access+the+Procurement+Workspace.",
    );
  }

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

  type CompletedProcurementItem = {
    orderNo: string;
    clientId: string;
    clientName: string;
    reference: string;
    currency: string;
    total: number;
    completedAt: string;
  };

  const completedOrders: CompletedProcurementItem[] = (quotations ?? [])
    .flatMap((quotation) => {
      const settings = quotation.layout_settings as Record<string, unknown> | null;
      const completedAt =
        typeof settings?.projectCompletedAt === "string"
          ? settings.projectCompletedAt
          : null;
      if (!completedAt) return [];

      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile) {
        return [{
          orderNo: projectFile.orderNo,
          clientId: projectFile.clientId,
          clientName: projectFile.clientName,
          reference: projectFile.reference,
          currency: projectFile.currency,
          total: projectFile.total,
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
          reference: o.reference,
          currency: o.currency,
          total: o.total,
          completedAt,
        }];
      }

      return [];
    })
    .filter((o, i, all) => all.findIndex((x) => x.orderNo === o.orderNo) === i)
    .sort(
      (a, b) =>
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
    );

  return (
    <ErpAppShell
      eyebrow="PROCUREMENT"
      title="Completed Procurement"
      description="Read-only procurement folders for completed project files."
      role={role}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">
        {completedOrders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-6 py-16 text-center">
            <p className="text-sm text-zinc-500">
              No completed procurement folders yet. Use &ldquo;Mark as Completed&rdquo; on a Project Activity
              page to move an order here.
            </p>
          </div>
        ) : (
          <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-lg font-semibold text-zinc-950">Completed Procurement Folders</h2>
              <p className="text-xs font-semibold uppercase text-zinc-500">
                {completedOrders.length}{" "}
                {completedOrders.length === 1 ? "order" : "orders"}
              </p>
            </div>
            <div className="overflow-x-auto border-t border-zinc-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50">
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
                      Completed On
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {completedOrders.map((order) => (
                    <tr
                      key={order.orderNo}
                      className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50"
                    >
                      <td className="px-4 py-3 font-semibold text-zinc-950">
                        {order.orderNo}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {clientNameById.get(order.clientId) ?? order.clientName}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {order.reference || "-"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-950">
                        {formatQuotationMoney(order.currency, order.total)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {formatDate(order.completedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/procurement/completed/${encodeURIComponent(order.orderNo)}`}
                          className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
                        >
                          View
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
