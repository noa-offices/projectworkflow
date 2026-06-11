import Link from "next/link";
import { notFound } from "next/navigation";
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
import {
  createConfirmedOrderFromApproval,
  recordClientApprovalDecision,
} from "../../../quotations/actions";

export const dynamic = "force-dynamic";

type ApprovalDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string }>;
};

type ApprovalQuotationRow = {
  id: string;
  quotation_no: string | null;
  title: string | null;
  layout_settings: unknown;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-zinc-950">{value}</dd>
    </div>
  );
}

function DecisionForm({
  approvalNo,
  decision,
  description,
  label,
  message,
  noteLabel,
  returnTo,
}: {
  approvalNo: string;
  decision: "approve" | "reject" | "revision" | "cancel";
  description: string;
  label: string;
  message: string;
  noteLabel?: string;
  returnTo: string;
}) {
  return (
    <form action={recordClientApprovalDecision} className="flex h-full min-h-[250px] flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <input type="hidden" name="approval_no" value={approvalNo} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="return_to" value={returnTo} />
      <div>
        <p className="text-sm font-semibold text-zinc-950">{label}</p>
        <p className="mt-1 min-h-[42px] text-xs leading-5 text-zinc-500">{description}</p>
      </div>
      {noteLabel ? (
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">{noteLabel}</span>
          <textarea
            name="decision_note"
            rows={3}
            className="mt-1 h-24 w-full resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
      ) : (
        <div className="h-[116px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs leading-5 text-zinc-500">
          No note is required to approve. You can proceed after confirming the selected quotation is the accepted client version.
        </div>
      )}
      <ConfirmSubmitButton
        className="mt-auto inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        message={message}
        pendingLabel="Recording..."
      >
        {label}
      </ConfirmSubmitButton>
    </form>
  );
}

function CreateConfirmedOrderForm({
  approvalNo,
  orderNo,
  returnTo,
}: {
  approvalNo: string;
  orderNo: string;
  returnTo: string;
}) {
  return (
    <form action={createConfirmedOrderFromApproval}>
      <input type="hidden" name="approval_no" value={approvalNo} />
      <input type="hidden" name="return_to" value={returnTo} />
      <ConfirmSubmitButton
        className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        message={`Create Confirmed Order / Project\n\nThis will create ${orderNo} from the approved quotation. Procurement documents will be added later.`}
        pendingLabel="Creating..."
      >
        Create Confirmed Order / Project
      </ConfirmSubmitButton>
    </form>
  );
}

function coNumberFromApprovalNo(approvalNo: string) {
  const match = approvalNo.trim().match(/^CP-(\d{4})-(\d{3})$/i);
  return match ? `CO-${match[1]}-${match[2]}` : "CO pending";
}

export default async function ApprovalDetailPage({ params, searchParams }: ApprovalDetailPageProps) {
  const [{ user, displayName }, { id }, query] = await Promise.all([
    requireActiveUser(),
    params,
    searchParams ?? Promise.resolve({} as { message?: string }),
  ]);
  const approvalNo = decodeURIComponent(id);
  const supabase = await createSupabaseClient();
  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,quotation_no,title,layout_settings")
    .returns<ApprovalQuotationRow[]>();

  if (error) {
    console.error("CLIENT APPROVAL DETAIL ERROR", error.message);
    notFound();
  }

  const approval = (quotations ?? [])
    .map((quotation) => {
      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      return draft?.approvalNo === approvalNo ? { draft, quotation } : null;
    })
    .find((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (!approval) {
    notFound();
  }
  const approvalCancelled = isCancelledClientApprovalStatus(approval.draft.approvalStatus);
  const approvalWaiting = isActiveClientApprovalStatus(approval.draft.approvalStatus);
  const returnTo = `/sales/approvals/${encodeURIComponent(approval.draft.approvalNo)}`;
  const expectedOrderNo = approval.draft.confirmedOrder?.orderNo ?? coNumberFromApprovalNo(approval.draft.approvalNo);

  return (
    <ErpAppShell
      eyebrow="SALES"
      title={`Client Approval / Decision ${approval.draft.approvalNo}`}
      description="Record the client decision, then create the Confirmed Order / Project after approval."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        {query.message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            {query.message}
          </p>
        ) : null}

        <div className="mb-5 flex flex-wrap gap-2">
          <Link
            href="/sales/approvals"
            className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
          >
            Back to Approvals
          </Link>
          <Link
            href={`/quotations/${approval.quotation.id}`}
            className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Open Quotation
          </Link>
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">{approval.draft.approvalNo}</h2>
              <p className="mt-1 text-sm text-zinc-500">{approval.draft.reference}</p>
            </div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
              approvalCancelled
                ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}>
              {clientApprovalStatusDisplayLabel(approval.draft.approvalStatus)}
            </span>
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailValue label="Quotation no" value={approval.draft.quotationNo} />
            <DetailValue label="Folder no" value={approval.draft.folderNo} />
            <DetailValue label="Client" value={approval.draft.clientName} />
            <DetailValue label="Opportunity no" value={approval.draft.opportunityNo ?? "Not linked"} />
            <DetailValue label="Reference" value={approval.draft.reference} />
            <DetailValue label="Total" value={formatQuotationMoney(approval.draft.currency, approval.draft.total)} />
            <DetailValue label="Created" value={formatDate(approval.draft.createdAt)} />
            <DetailValue label="Source" value="Selected quotation" />
            <DetailValue label="Document prep" value={approval.draft.documentSetupReference ? "Reference stored" : "Quotation metadata"} />
            <DetailValue label="Status" value={clientApprovalStatusDisplayLabel(approval.draft.approvalStatus)} />
            {approval.draft.confirmedOrder ? (
              <DetailValue label="Confirmed order" value={approval.draft.confirmedOrder.orderNo} />
            ) : null}
          </dl>

          {approvalCancelled ? (
            <p className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              This client decision record was cancelled because the linked quotation was cancelled.
            </p>
          ) : (
            <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Confirmed Order / Project will be created only after the client approves this quotation.
            </p>
          )}
        </section>

        <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Client Decision</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Submitted to Client - Waiting Decision - Approved / Rejected / Revision Requested - Confirmed Order
              </p>
            </div>
            <Link
              href={`/quotations/${approval.quotation.id}`}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Open Quotation Folder
            </Link>
          </div>

          {approvalWaiting ? (
            <div className="mt-4 grid gap-3 xl:grid-cols-4">
              <DecisionForm
                approvalNo={approval.draft.approvalNo}
                decision="approve"
                description="Record that the client accepted this exact quotation. CO creation appears after approval."
                label="Approve"
                message="This will mark the selected quotation as Approved by Client. Confirmed Order / Project can be created after approval."
                returnTo={returnTo}
              />
              <DecisionForm
                approvalNo={approval.draft.approvalNo}
                decision="reject"
                description="Record that the client rejected this quotation. The folder remains available for history."
                label="Reject"
                message="This will mark the selected quotation as Rejected by Client. No Confirmed Order / Project will be created."
                noteLabel="Rejection note"
                returnTo={returnTo}
              />
              <DecisionForm
                approvalNo={approval.draft.approvalNo}
                decision="revision"
                description="Record that the client requested changes. Create a revision from the quotation folder."
                label="Request Revision"
                message="This will mark the selected quotation as Revision Requested. No new revision will be created automatically."
                noteLabel="Revision requested reason / client comments"
                returnTo={returnTo}
              />
              <DecisionForm
                approvalNo={approval.draft.approvalNo}
                decision="cancel"
                description="Withdraw this client decision record without deleting approval history."
                label="Cancel / Withdraw"
                message="This will cancel this client decision record and mark the linked quotation Cancelled. No records will be deleted."
                noteLabel="Cancellation note"
                returnTo={returnTo}
              />
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm font-semibold text-zinc-950">
                {clientApprovalStatusDisplayLabel(approval.draft.approvalStatus)}
              </p>
              {approval.draft.approvalStatus === "Approved by Client" ? (
                <p className="mt-2 text-sm text-zinc-600">
                  Next step: Create Confirmed Order / Project from the approved quotation.
                </p>
              ) : null}
              {approval.draft.approvalStatus === "Rejected by Client" ? (
                <p className="mt-2 text-sm text-zinc-600">
                  This quotation was rejected by the client. The quotation folder remains available for history.
                </p>
              ) : null}
              {approval.draft.approvalStatus === "Revision Requested" ? (
                <p className="mt-2 text-sm text-zinc-600">
                  Client requested changes. Return to the quotation folder and create a new revision from the submitted quotation.
                </p>
              ) : null}
              {approvalCancelled ? (
                <p className="mt-2 text-sm text-zinc-600">
                  This client decision record was cancelled.
                </p>
              ) : null}
              {approval.draft.decisionNote ? (
                <p className="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
                  Note: {approval.draft.decisionNote}
                </p>
              ) : null}
              <p className="mt-3 text-xs font-medium text-zinc-500">
                Decision has already been recorded. Reopening/changing decisions will be handled in a future phase.
              </p>
            </div>
          )}
        </section>

        {approval.draft.approvalStatus === "Approved by Client" ? (
          <section className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Create Confirmed Order / Project</h2>
                <p className="mt-1 text-sm text-emerald-950">
                  This will create the confirmed project/order file from the approved quotation. Procurement documents will be added later.
                </p>
              </div>
              {approval.draft.confirmedOrder ? (
                <Link
                  href={`/projects/orders/${approval.draft.confirmedOrder.orderNo}`}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                  Open Confirmed Order / Project
                </Link>
              ) : (
                <CreateConfirmedOrderForm
                  approvalNo={approval.draft.approvalNo}
                  orderNo={expectedOrderNo}
                  returnTo={returnTo}
                />
              )}
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DetailValue label="Confirmed Order No" value={expectedOrderNo} />
              <DetailValue label="Approval No" value={approval.draft.approvalNo} />
              <DetailValue label="Quotation No" value={approval.draft.quotationNo} />
              <DetailValue label="Client" value={approval.draft.clientName} />
              <DetailValue label="Reference / Project" value={approval.draft.reference} />
              <DetailValue label="Total" value={formatQuotationMoney(approval.draft.currency, approval.draft.total)} />
              <DetailValue label="Status" value={approval.draft.confirmedOrder ? "Confirmed" : "Ready to create"} />
            </dl>
            {approval.draft.confirmedOrder ? (
              <p className="mt-4 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-950">
                Confirmed Order / Project {approval.draft.confirmedOrder.orderNo} already exists for this approval.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </ErpAppShell>
  );
}
