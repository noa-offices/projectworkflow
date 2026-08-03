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
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-3 py-4 sm:px-8 sm:py-6">
        {params.message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {params.message}
          </p>
        ) : null}

        <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm md:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Approved Quotations</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {approvedQuotations.length} {approvedQuotations.length === 1 ? "quotation" : "quotations"} marked {quotationStatusLabel("client_confirmed")}.
              </p>
            </div>
          </div>

          {approvedQuotations.length ? (
            <>
              <div className="mt-4 grid min-w-0 gap-3 md:hidden">
                {approvedQuotations.map((quotation) => (
                  <article key={quotation.id} className="min-w-0 rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="[overflow-wrap:anywhere] text-base font-bold leading-5 text-zinc-950">
                          {quotation.quotation_no ?? quotation.title ?? "Quotation"}
                        </p>
                        <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-zinc-700">
                          {quotation.clientName}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-900">
                        {quotationStatusLabel(quotation.status)}
                      </span>
                    </div>

                    <dl className="mt-3 grid min-w-0 gap-2 text-xs">
                      <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="font-semibold text-zinc-500">Folder</dt>
                        <dd className="[overflow-wrap:anywhere] font-medium text-zinc-800">{quotation.folderNo ?? "-"}</dd>
                      </div>
                      <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="font-semibold text-zinc-500">Reference</dt>
                        <dd className="line-clamp-2 break-words text-zinc-700">{quotation.reference}</dd>
                      </div>
                      <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="font-semibold text-zinc-500">Approved</dt>
                        <dd className="text-zinc-700">{formatDate(quotation.status_updated_at ?? quotation.updated_at ?? quotation.quotation_date)}</dd>
                      </div>
                      <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="font-semibold text-zinc-500">Value</dt>
                        <dd className="font-semibold text-zinc-950">{formatQuotationMoney(quotation.currency, quotation.grand_total ?? 0)}</dd>
                      </div>
                      <div className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2">
                        <dt className="font-semibold text-zinc-500">Project</dt>
                        <dd className="[overflow-wrap:anywhere] font-medium text-zinc-800">{quotation.projectFile?.orderNo ?? "Not created"}</dd>
                      </div>
                    </dl>

                    <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-zinc-100 pt-3">
                      <Link
                        href={`/quotations/${quotation.id}`}
                        className="inline-flex h-10 min-w-0 items-center justify-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Open
                      </Link>
                      <details className="relative min-w-0">
                        <summary className="flex h-10 cursor-pointer list-none items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700">
                          More
                        </summary>
                        <div className="absolute right-0 z-10 mt-2 grid w-56 max-w-[calc(100vw-2.5rem)] gap-2 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
                          {quotation.projectFile ? (
                            <Link
                              href={`/projects/orders/${quotation.projectFile.orderNo}`}
                              className="inline-flex h-10 min-w-0 items-center px-3 text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                            >
                              Open Project File
                            </Link>
                          ) : (
                            <form action={createProjectFileFromQuotation}>
                              <input type="hidden" name="quotation_id" value={quotation.id} />
                              <input type="hidden" name="return_to" value="/sales/approvals" />
                              <button
                                type="submit"
                                className="h-10 w-full min-w-0 px-3 text-left text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                              >
                                Create Project File
                              </button>
                            </form>
                          )}
                        </div>
                      </details>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-4 hidden overflow-x-auto md:block">
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
            </>
          ) : (
            <>
              <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-5 text-center md:hidden">
                <p className="text-sm font-semibold text-zinc-950">No approved quotations yet.</p>
                <p className="mt-1 text-sm leading-5 text-zinc-500">
                  Quotations marked {quotationStatusLabel("client_confirmed")} will appear here.
                </p>
              </div>
              <div className="mt-4 hidden rounded-md border border-dashed border-zinc-200 p-6 text-center md:block">
                <p className="text-sm font-semibold text-zinc-950">No Client Approved quotations yet.</p>
                <p className="mt-1 text-sm text-zinc-500">
                  Mark a quotation as Client Approved from the quotation folder to show it here.
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </ErpAppShell>
  );
}
