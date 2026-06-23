import Link from "next/link";
import { createProjectFileFromQuotation } from "@/app/quotations/actions";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { quotationStatusLabel } from "@/lib/quotation-status";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { documentSetupRecord } from "@/lib/quotations/document-setup";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { quotationFolderNumberFromQuotationNumber } from "@/lib/projectworkflow-numbering";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SalesApprovalPageProps = {
  searchParams?: Promise<{ message?: string }>;
};

type ApprovedQuotationRow = {
  id: string;
  client_id: string | null;
  quotation_no: string | null;
  title: string | null;
  legacy_reference: string | null;
  quotation_date: string | null;
  status: string;
  grand_total: number | null;
  currency: string | null;
  layout_settings: unknown;
  status_updated_at: string | null;
  updated_at: string | null;
};

type ClientRow = {
  id: string;
  company_name: string | null;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not dated";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function textFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function SalesApprovalsPage({ searchParams }: SalesApprovalPageProps) {
  const [{ user, profile, displayName }, params] = await Promise.all([
    requireActiveUser(),
    searchParams ?? Promise.resolve({} as { message?: string }),
  ]);
  const supabase = await createSupabaseClient();
  const [{ data: quotations, error }, { data: clients, error: clientsError }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id,client_id,quotation_no,title,legacy_reference,quotation_date,status,grand_total,currency,layout_settings,status_updated_at,updated_at")
      .eq("status", "client_confirmed")
      .order("status_updated_at", { ascending: false })
      .limit(200)
      .returns<ApprovedQuotationRow[]>(),
    supabase
      .from("clients")
      .select("id,company_name")
      .returns<ClientRow[]>(),
  ]);

  if (error) {
    console.error("APPROVED QUOTATIONS LIST ERROR", error.message);
  }
  if (clientsError) {
    console.error("APPROVED QUOTATIONS CLIENT LIST ERROR", clientsError.message);
  }

  const clientNames = new Map((clients ?? []).map((client) => [client.id, client.company_name?.trim() || "Client"]));
  const approvedQuotations = (quotations ?? []).map((quotation) => {
    const setup = documentSetupRecord(quotation.layout_settings);
    const header = setup.header && typeof setup.header === "object" && !Array.isArray(setup.header)
      ? setup.header as Record<string, unknown>
      : {};
    const projectFile =
      projectFileFromLayoutSettings(quotation.layout_settings) ??
      clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder ??
      null;

    return {
      ...quotation,
      clientName: quotation.client_id ? clientNames.get(quotation.client_id) ?? "Client" : "Client",
      folderNo: projectFile?.folderNo ?? quotationFolderNumberFromQuotationNumber(quotation.quotation_no),
      projectFile,
      reference:
        textFromRecord(header, "reference") ??
        quotation.legacy_reference?.trim() ??
        quotation.title?.trim() ??
        quotation.quotation_no ??
        "Quotation reference",
    };
  });

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Approved Quotations"
      description="Quotations marked Client Approved. Project files can be opened or created from approved quotations."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        {params.message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {params.message}
          </p>
        ) : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Approved Quotations</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {approvedQuotations.length} {approvedQuotations.length === 1 ? "quotation" : "quotations"} marked {quotationStatusLabel("client_confirmed")}.
              </p>
            </div>
          </div>

          {approvedQuotations.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                    <th className="py-3 pr-4">Quotation No</th>
                    <th className="py-3 pr-4">Folder No</th>
                    <th className="py-3 pr-4">Client</th>
                    <th className="py-3 pr-4">Reference</th>
                    <th className="py-3 pr-4">Total</th>
                    <th className="py-3 pr-4">Approved Date</th>
                    <th className="py-3 pr-4">Project File</th>
                    <th className="py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedQuotations.map((quotation) => (
                    <tr key={quotation.id} className="border-b border-zinc-100 align-top">
                      <td className="py-3 pr-4 font-semibold text-zinc-950">{quotation.quotation_no ?? quotation.title ?? "Quotation"}</td>
                      <td className="py-3 pr-4 text-zinc-700">{quotation.folderNo ?? "-"}</td>
                      <td className="py-3 pr-4 text-zinc-700">{quotation.clientName}</td>
                      <td className="max-w-xs py-3 pr-4 text-zinc-600">{quotation.reference}</td>
                      <td className="py-3 pr-4 font-medium text-zinc-950">
                        {formatQuotationMoney(quotation.currency, quotation.grand_total ?? 0)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">{formatDate(quotation.status_updated_at ?? quotation.updated_at ?? quotation.quotation_date)}</td>
                      <td className="py-3 pr-4 font-medium text-zinc-950">
                        {quotation.projectFile?.orderNo ?? "Not created"}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/quotations/${quotation.id}`}
                            className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-700"
                          >
                            Open Quotation
                          </Link>
                          {quotation.projectFile ? (
                            <Link
                              href={`/projects/orders/${quotation.projectFile.orderNo}`}
                              className="text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                            >
                              Open Project File
                            </Link>
                          ) : (
                            <form action={createProjectFileFromQuotation}>
                              <input type="hidden" name="quotation_id" value={quotation.id} />
                              <input type="hidden" name="return_to" value="/sales/approvals" />
                              <button
                                type="submit"
                                className="text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                              >
                                Create Project File
                              </button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-center">
              <p className="text-sm font-semibold text-zinc-950">No Client Approved quotations yet.</p>
              <p className="mt-1 text-sm text-zinc-500">
                Mark a quotation as Client Approved from the quotation folder to show it here.
              </p>
            </div>
          )}
        </section>
      </div>
    </ErpAppShell>
  );
}
