import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import {
  clientApprovalStatusDisplayLabel,
  clientApprovalDraftFromLayoutSettings,
  isCancelledClientApprovalStatus,
} from "@/lib/quotations/client-approval-draft";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

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
    console.error("CLIENT RESPONSE DETAIL ERROR", error.message);
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

  const responseCancelled = isCancelledClientApprovalStatus(approval.draft.approvalStatus);

  return (
    <ErpAppShell
      eyebrow="SALES"
      title={`Client Response ${approval.draft.approvalNo}`}
      description="Historical client response record. New quotation workflow is handled directly from the quotation folder."
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
            Back to Client Responses
          </Link>
          <Link
            href={`/quotations/${approval.quotation.id}`}
            className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Open Quotation
          </Link>
          {approval.draft.confirmedOrder ? (
            <Link
              href={`/projects/orders/${approval.draft.confirmedOrder.orderNo}`}
              className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Open Project File
            </Link>
          ) : null}
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">{approval.draft.approvalNo}</h2>
              <p className="mt-1 text-sm text-zinc-500">{approval.draft.reference}</p>
            </div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
              responseCancelled
                ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}>
              {clientApprovalStatusDisplayLabel(approval.draft.approvalStatus)}
            </span>
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailValue label="CP no" value={approval.draft.approvalNo} />
            <DetailValue label="Quotation no" value={approval.draft.quotationNo} />
            <DetailValue label="Client" value={approval.draft.clientName} />
            <DetailValue label="Status" value={clientApprovalStatusDisplayLabel(approval.draft.approvalStatus)} />
            <DetailValue label="Folder no" value={approval.draft.folderNo} />
            <DetailValue label="Opportunity no" value={approval.draft.opportunityNo ?? "Not linked"} />
            <DetailValue label="Reference" value={approval.draft.reference} />
            <DetailValue label="Total" value={formatQuotationMoney(approval.draft.currency, approval.draft.total)} />
            <DetailValue label="Created" value={formatDate(approval.draft.createdAt)} />
            <DetailValue label="Source" value="Selected quotation" />
            <DetailValue label="CO no" value={approval.draft.confirmedOrder?.orderNo ?? "-"} />
            <DetailValue label="Project file" value={approval.draft.confirmedOrder ? "Created" : "Not created"} />
          </dl>

          {approval.draft.decisionNote ? (
            <p className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              Note: {approval.draft.decisionNote}
            </p>
          ) : null}

          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            New quotation workflow is handled directly from the quotation folder. This page is kept for history.
          </p>
        </section>
      </div>
    </ErpAppShell>
  );
}
