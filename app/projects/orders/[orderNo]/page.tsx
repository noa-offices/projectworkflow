import Link from "next/link";
import { notFound } from "next/navigation";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ConfirmedOrderPageProps = {
  params: Promise<{ orderNo: string }>;
  searchParams?: Promise<{ message?: string }>;
};

type ConfirmedOrderQuotationRow = {
  id: string;
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

export default async function ConfirmedOrderPage({ params, searchParams }: ConfirmedOrderPageProps) {
  const [{ user, displayName }, { orderNo }, query] = await Promise.all([
    requireActiveUser(),
    params,
    searchParams ?? Promise.resolve({} as { message?: string }),
  ]);
  const decodedOrderNo = decodeURIComponent(orderNo);
  const supabase = await createSupabaseClient();
  const { data: quotations, error } = await supabase
    .from("quotations")
    .select("id,layout_settings")
    .returns<ConfirmedOrderQuotationRow[]>();

  if (error) {
    console.error("CONFIRMED ORDER DETAIL ERROR", error.message);
    notFound();
  }

  const entry = (quotations ?? [])
    .map((quotation) => {
      const projectFile = projectFileFromLayoutSettings(quotation.layout_settings);
      if (projectFile?.orderNo === decodedOrderNo) {
        return { quotationId: quotation.id, draft: null, order: projectFile };
      }

      const draft = clientApprovalDraftFromLayoutSettings(quotation.layout_settings);
      return draft?.confirmedOrder?.orderNo === decodedOrderNo
        ? { quotationId: quotation.id, draft, order: draft.confirmedOrder }
        : null;
    })
    .find((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  if (!entry) {
    notFound();
  }

  return (
    <ErpAppShell
      eyebrow="PROJECTS"
      title={`Project File ${entry.order.orderNo}`}
      description="Project file from a client-approved quotation. Procurement documents come later."
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
          {entry.order.approvalNo ? (
            <Link
              href={`/sales/approvals/${entry.order.approvalNo}`}
              className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Open History
            </Link>
          ) : null}
          <Link
            href={`/quotations/${entry.quotationId}`}
            className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Open Quotation
          </Link>
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">{entry.order.orderNo}</h2>
              <p className="mt-1 text-sm text-zinc-500">{entry.order.reference}</p>
            </div>
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
              Confirmed
            </span>
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailValue label="CO no" value={entry.order.orderNo} />
            <DetailValue label="History record" value={entry.order.approvalNo ?? "-"} />
            <DetailValue label="Quotation no" value={entry.order.quotationNo} />
            <DetailValue label="Client" value={entry.order.clientName} />
            <DetailValue label="Reference" value={entry.order.reference} />
            <DetailValue label="Total" value={formatQuotationMoney(entry.order.currency, entry.order.total)} />
            <DetailValue label="Created" value={formatDate(entry.order.createdAt)} />
            <DetailValue label="Status" value={entry.order.status} />
          </dl>

          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Procurement, RFQ, PO, and Order Confirmation will be added in later phases.
          </p>
        </section>
      </div>
    </ErpAppShell>
  );
}
