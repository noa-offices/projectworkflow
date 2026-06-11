import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import {
  clientApprovalStatusDisplayLabel,
  clientApprovalDraftFromLayoutSettings,
  isActiveClientApprovalStatus,
  isCancelledClientApprovalStatus,
} from "@/lib/quotations/client-approval-draft";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createConfirmedOrderFromApproval } from "../../quotations/actions";

export const dynamic = "force-dynamic";

type SalesApprovalPageProps = {
  searchParams?: Promise<{ message?: string }>;
};

type ApprovalQuotationRow = {
  id: string;
  quotation_no: string | null;
  title: string | null;
  quotation_date: string | null;
  status: string;
  is_active: boolean;
  grand_total: number | null;
  currency: string | null;
  layout_settings: unknown;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Not dated";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function coNumberFromApprovalNo(approvalNo: string) {
  const match = approvalNo.trim().match(/^CP-(\d{4})-(\d{3})$/i);
  return match ? `CO-${match[1]}-${match[2]}` : "CO pending";
}

function CreateCoListForm({ approvalNo }: { approvalNo: string }) {
  const orderNo = coNumberFromApprovalNo(approvalNo);

  return (
    <form action={createConfirmedOrderFromApproval}>
      <input type="hidden" name="approval_no" value={approvalNo} />
      <input type="hidden" name="return_to" value="/sales/approvals" />
      <ConfirmSubmitButton
        className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-700"
        message={`Create Confirmed Order / Project\n\nThis will create ${orderNo} from the approved quotation. Procurement documents will be added later.`}
        pendingLabel="Creating..."
      >
        Create CO
      </ConfirmSubmitButton>
    </form>
  );
}

export default async function SalesApprovalsPage({ searchParams }: SalesApprovalPageProps) {
  const [{ user, displayName }, params] = await Promise.all([
    requireActiveUser(),
    searchParams ?? Promise.resolve({} as { message?: string }),
  ]);
  const supabase = await createSupabaseClient();
  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,quotation_no,title,quotation_date,status,is_active,grand_total,currency,layout_settings")
    .order("quotation_date", { ascending: false })
    .returns<ApprovalQuotationRow[]>();

  if (error) {
    console.error("CLIENT APPROVAL LIST ERROR", error.message);
  }

  const approvals = (quotations ?? [])
    .map((quotation) => {
      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      return draft ? { draft, quotation } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => new Date(right.draft.createdAt).getTime() - new Date(left.draft.createdAt).getTime());
  const activeApprovals = approvals.filter(({ draft }) => isActiveClientApprovalStatus(draft.approvalStatus));
  const decidedApprovals = approvals.filter(({ draft }) => (
    !isActiveClientApprovalStatus(draft.approvalStatus) &&
    !isCancelledClientApprovalStatus(draft.approvalStatus)
  ));
  const cancelledApprovals = approvals.filter(({ draft }) => isCancelledClientApprovalStatus(draft.approvalStatus));

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Client Approvals"
      description="Track quotations submitted to clients and record client decisions. Confirmed orders/projects are created only after client approval."
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
              <h2 className="text-lg font-semibold text-zinc-950">Approval list</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Records are prepared from quotation metadata until a dedicated approval table is introduced.
              </p>
            </div>
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950">
              {activeApprovals.length} waiting
            </span>
          </div>

          {activeApprovals.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                    <th className="py-3 pr-4">Approval No.</th>
                    <th className="py-3 pr-4">Quotation No.</th>
                    <th className="py-3 pr-4">Folder No.</th>
                    <th className="py-3 pr-4">Client</th>
                    <th className="py-3 pr-4">Reference</th>
                    <th className="py-3 pr-4">Total</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">CO</th>
                    <th className="py-3 pr-4">Created</th>
                    <th className="py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeApprovals.map(({ draft, quotation }) => (
                    <tr key={`${draft.approvalNo}-${quotation.id}`} className="border-b border-zinc-100 align-top">
                      <td className="py-3 pr-4 font-semibold text-zinc-950">{draft.approvalNo}</td>
                      <td className="py-3 pr-4 text-zinc-700">{draft.quotationNo}</td>
                      <td className="py-3 pr-4 text-zinc-700">{draft.folderNo}</td>
                      <td className="py-3 pr-4 text-zinc-700">{draft.clientName}</td>
                      <td className="max-w-xs py-3 pr-4 text-zinc-600">{draft.reference}</td>
                      <td className="py-3 pr-4 font-medium text-zinc-950">
                        {formatQuotationMoney(draft.currency, draft.total)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900">
                          {clientApprovalStatusDisplayLabel(draft.approvalStatus)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-zinc-500">
                        {draft.confirmedOrder?.orderNo ?? "-"}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">{formatDate(draft.createdAt)}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/sales/approvals/${draft.approvalNo}`}
                            className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-700"
                          >
                            Open Approval
                          </Link>
                          <Link
                            href={`/quotations/${quotation.id}`}
                            className="text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                          >
                            Open Quotation
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-zinc-200 p-6 text-center">
              <p className="text-sm font-semibold text-zinc-950">No active Client Decisions waiting.</p>
              <p className="mt-1 text-sm text-zinc-500">
                Open an active numbered quotation, mark it Ready to Send, then submit it to the client from the folder.
              </p>
            </div>
          )}

          {decidedApprovals.length ? (
            <details open className="mt-5 rounded-lg border border-zinc-200 bg-white p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">Recorded client decisions</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Approved, rejected, and revision-requested decisions are not counted as waiting.
                    </p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {decidedApprovals.length} decided
                  </span>
                </div>
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                      <th className="py-3 pr-4">Approval No.</th>
                      <th className="py-3 pr-4">Quotation No.</th>
                      <th className="py-3 pr-4">Client</th>
                      <th className="py-3 pr-4">Reference</th>
                    <th className="py-3 pr-4">Total</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">CO</th>
                    <th className="py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decidedApprovals.map(({ draft, quotation }) => (
                      <tr key={`${draft.approvalNo}-${quotation.id}`} className="border-b border-zinc-100 align-top">
                        <td className="py-3 pr-4 font-semibold text-zinc-950">{draft.approvalNo}</td>
                        <td className="py-3 pr-4 text-zinc-700">{draft.quotationNo}</td>
                        <td className="py-3 pr-4 text-zinc-700">{draft.clientName}</td>
                        <td className="max-w-xs py-3 pr-4 text-zinc-600">{draft.reference}</td>
                        <td className="py-3 pr-4 font-medium text-zinc-950">
                          {formatQuotationMoney(draft.currency, draft.total)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                            {clientApprovalStatusDisplayLabel(draft.approvalStatus)}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-medium text-zinc-950">
                          {draft.confirmedOrder?.orderNo ?? (
                            draft.approvalStatus === "Approved by Client" ? "Not created" : "-"
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/sales/approvals/${draft.approvalNo}`}
                              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-700"
                            >
                              Open Approval
                            </Link>
                            <Link
                              href={`/quotations/${quotation.id}`}
                              className="text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                            >
                              Open Quotation
                            </Link>
                            {draft.confirmedOrder ? (
                              <Link
                                href={`/projects/orders/${draft.confirmedOrder.orderNo}`}
                                className="text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                              >
                                Open CO
                              </Link>
                            ) : draft.approvalStatus === "Approved by Client" ? (
                              <CreateCoListForm approvalNo={draft.approvalNo} />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {cancelledApprovals.length ? (
            <details className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">Cancelled / withdrawn approvals</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Cancelled approvals remain visible for history and are not counted as pending.
                    </p>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {cancelledApprovals.length} cancelled
                  </span>
                </div>
              </summary>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[840px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                      <th className="py-3 pr-4">Approval No.</th>
                      <th className="py-3 pr-4">Quotation No.</th>
                      <th className="py-3 pr-4">Client</th>
                      <th className="py-3 pr-4">Reference</th>
                      <th className="py-3 pr-4">Total</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancelledApprovals.map(({ draft, quotation }) => (
                      <tr key={`${draft.approvalNo}-${quotation.id}`} className="border-b border-zinc-100 align-top">
                        <td className="py-3 pr-4 font-semibold text-zinc-950">{draft.approvalNo}</td>
                        <td className="py-3 pr-4 text-zinc-700">{draft.quotationNo}</td>
                        <td className="py-3 pr-4 text-zinc-700">{draft.clientName}</td>
                        <td className="max-w-xs py-3 pr-4 text-zinc-600">{draft.reference}</td>
                        <td className="py-3 pr-4 font-medium text-zinc-950">
                          {formatQuotationMoney(draft.currency, draft.total)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="inline-flex rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                            {clientApprovalStatusDisplayLabel(draft.approvalStatus)}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/sales/approvals/${draft.approvalNo}`}
                              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-700"
                            >
                              Open Approval
                            </Link>
                            <Link
                              href={`/quotations/${quotation.id}`}
                              className="text-sm font-semibold text-zinc-700 transition hover:text-zinc-950"
                            >
                              Open Quotation
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>
      </div>
    </ErpAppShell>
  );
}
