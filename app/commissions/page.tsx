import Link from "next/link";
import { transitionCommission } from "@/app/commissions/actions";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireCommissionViewer } from "@/lib/auth";
import {
  commissionBasisLabel,
  commissionFormulaLabel,
  commissionStatusLabel,
  type CommissionStatus,
  type SalesCommissionRow,
  type SalesManagerOption,
} from "@/lib/commissions/types";
import { formatMoney, supportedCurrencies } from "@/lib/currencies";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const commissionSelect =
  "id,approval_snapshot_id,quotation_id,quotation_folder_key,salesperson_id,rule_id,source_type,formula_type_snapshot,basis_type_snapshot,formula_configuration_snapshot,percentage_rate_snapshot,fixed_amount_snapshot,fixed_amount_currency_snapshot,tier_configuration_snapshot,tier_method_snapshot,matched_tier_snapshot,approved_total_including_vat,vat_amount,approved_total_excluding_vat,commissionable_base,commissionable_base_override,percentage_rate_override,fixed_amount_override,percentage_component,fixed_component,original_calculated_amount,final_commission_amount,currency,earned_at,status,review_reason,override_reason,overridden_by,overridden_at,submitted_by,submitted_at,approved_at,paid_by,paid_at,cancelled_at,cancellation_reason,reversed_at,reversal_reason,management_notes,created_at,updated_at";

type PageProps = {
  searchParams?: Promise<{
    currency?: string;
    formula?: string;
    from?: string;
    salesperson?: string;
    status?: string;
    to?: string;
  }>;
};

const statuses: CommissionStatus[] = [
  "requires_review",
  "draft",
  "pending_approval",
  "approved",
  "paid",
  "cancelled",
  "reversed",
];

function dateOnly(value: string) {
  return new Intl.DateTimeFormat("en-AE", { dateStyle: "medium" }).format(new Date(value));
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

export default async function CommissionsPage({ searchParams }: PageProps) {
  const { user, profile, displayName } = await requireCommissionViewer();
  const params = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("sales_commissions")
    .select(commissionSelect)
    .order("earned_at", { ascending: false });

  if (params?.status && statuses.includes(params.status as CommissionStatus)) {
    query = query.eq("status", params.status);
  }
  if (params?.salesperson && profile?.role !== "sales_designer") {
    query = query.eq("salesperson_id", params.salesperson);
  }
  if (params?.formula) query = query.eq("formula_type_snapshot", params.formula);
  if (params?.currency) query = query.eq("currency", params.currency);
  if (params?.from) query = query.gte("earned_at", `${params.from}T00:00:00.000Z`);
  if (params?.to) query = query.lt("earned_at", `${params.to}T23:59:59.999Z`);

  const [{ data: commissions, error }, { data: managerRows }] = await Promise.all([
    query.returns<SalesCommissionRow[]>(),
    profile?.role === "sales_designer"
      ? Promise.resolve({ data: [] as SalesManagerOption[] })
      : supabase.rpc("list_commission_sales_managers"),
  ]);
  const rows = commissions ?? [];
  const managers = (managerRows ?? []) as SalesManagerOption[];
  const managerName = new Map(managers.map((manager) => [manager.id, manager.display_name]));
  if (profile?.role === "sales_designer" && profile.id) {
    managerName.set(profile.id, displayName);
  }
  const counts = new Map<CommissionStatus, number>();
  for (const status of statuses) counts.set(status, rows.filter((row) => row.status === status).length);

  const isPersonal = profile?.role === "sales_designer";
  const isSystemOwner = profile?.role === "system_owner";
  const { count: activeOwnerCount } = isSystemOwner
    ? await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "system_owner")
        .eq("account_status", "active")
    : { count: 0 };
  const personalTotals = isPersonal
    ? [
        {
          label: "Total earned",
          rows: rows.filter((row) => !["cancelled", "reversed"].includes(row.status)),
        },
        { label: "Pending approval", rows: rows.filter((row) => row.status === "pending_approval") },
        { label: "Approved", rows: rows.filter((row) => row.status === "approved") },
        { label: "Paid", rows: rows.filter((row) => row.status === "paid") },
        { label: "Reversed", rows: rows.filter((row) => row.status === "reversed") },
      ].map((entry) => ({
        label: entry.label,
        totals: entry.rows.reduce<Map<string, number>>((totals, row) => {
          totals.set(row.currency, (totals.get(row.currency) ?? 0) + Number(row.final_commission_amount));
          return totals;
        }, new Map()),
      }))
    : [];

  return (
    <ErpAppShell
      eyebrow={isPersonal ? "MY SALES" : "FINANCIAL CONTROL"}
      title={isPersonal ? "My Commission" : "Commissions"}
      description={isPersonal
        ? "Review your own earned, pending, approved, paid, and reversed commission records."
        : "Review calculated commissions, resolve setup issues, and control approval and payment status."}
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="grid gap-6 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {profile?.role !== "sales_designer" ? (
            <Link href="/settings/commissions" className="text-sm font-semibold text-emerald-900">
              Commission Settings
            </Link>
          ) : <span />}
          {isPersonal ? (
            <p className="text-sm text-zinc-500">Pending values are provisional and are not guaranteed payments.</p>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error.message}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Requires Review" value={counts.get("requires_review") ?? 0} />
          <SummaryCard label="Draft" value={counts.get("draft") ?? 0} />
          <SummaryCard label="Pending Approval" value={counts.get("pending_approval") ?? 0} />
          <SummaryCard label="Approved" value={counts.get("approved") ?? 0} />
          <SummaryCard label="Paid" value={counts.get("paid") ?? 0} />
          <SummaryCard label="Cancelled / Reversed" value={(counts.get("cancelled") ?? 0) + (counts.get("reversed") ?? 0)} />
        </div>

        {isPersonal ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {personalTotals.map((entry) => (
              <div key={entry.label} className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{entry.label}</p>
                <p className="mt-1 text-sm font-semibold text-zinc-950">
                  {entry.totals.size
                    ? Array.from(entry.totals).map(([currency, total]) => formatMoney(currency, total)).join(" · ")
                    : "—"}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <form className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm md:grid-cols-3 xl:grid-cols-6">
          <input name="from" type="date" defaultValue={params?.from} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          <input name="to" type="date" defaultValue={params?.to} className="rounded-md border border-zinc-300 px-3 py-2 text-sm" />
          {!isPersonal ? (
            <select name="salesperson" defaultValue={params?.salesperson} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
              <option value="">All Sales Managers</option>
              {managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.display_name}</option>)}
            </select>
          ) : null}
          <select name="status" defaultValue={params?.status} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{commissionStatusLabel(status)}</option>)}
          </select>
          <select name="formula" defaultValue={params?.formula} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
            <option value="">All formulas</option>
            <option value="percentage">Percentage</option>
            <option value="fixed_amount">Fixed amount</option>
            <option value="tiered_percentage">Tiered percentage</option>
            <option value="percentage_plus_fixed">Percentage + fixed</option>
            <option value="none">None</option>
          </select>
          <select name="currency" defaultValue={params?.currency} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
            <option value="">All currencies</option>
            {supportedCurrencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
          </select>
          <button className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white">Apply filters</button>
        </form>

        {!isPersonal && rows.some((row) => row.status === "requires_review") ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h2 className="font-semibold text-amber-950">Pending Commission Setup</h2>
            <div className="mt-3 grid gap-2">
              {rows.filter((row) => row.status === "requires_review").map((row) => (
                <Link key={row.id} href={`/commissions/${row.id}`} className="flex justify-between gap-4 rounded-md bg-white px-3 py-2 text-sm">
                  <span className="font-medium text-zinc-900">{row.quotation_folder_key} · {managerName.get(row.salesperson_id) ?? row.salesperson_id}</span>
                  <span className="text-amber-800">{row.review_reason}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Sales Manager</th>
                  <th className="px-4 py-3">Quotation / order</th>
                  <th className="px-4 py-3">Approved value</th>
                  <th className="px-4 py-3">Basis</th>
                  <th className="px-4 py-3">Formula</th>
                  <th className="px-4 py-3">Calculated</th>
                  <th className="px-4 py-3">Final</th>
                  <th className="px-4 py-3">Earned</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-900">{managerName.get(row.salesperson_id) ?? row.salesperson_id}</td>
                    <td className="px-4 py-3"><Link href={`/commissions/${row.id}`} className="font-semibold text-emerald-900">{row.quotation_folder_key}</Link></td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatMoney(row.currency, Number(row.approved_total_including_vat))}</td>
                    <td className="px-4 py-3">{commissionBasisLabel(row.basis_type_snapshot)}</td>
                    <td className="px-4 py-3">{commissionFormulaLabel(row.formula_type_snapshot)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatMoney(row.currency, Number(row.original_calculated_amount))}</td>
                    <td className="px-4 py-3 whitespace-nowrap font-semibold">{formatMoney(row.currency, Number(row.final_commission_amount))}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateOnly(row.earned_at)}</td>
                    <td className="px-4 py-3">{commissionStatusLabel(row.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/commissions/${row.id}`} className="font-semibold text-emerald-900">
                          View
                        </Link>
                        {row.status === "draft" && row.overridden_by !== user.id ? (
                          <form action={transitionCommission}>
                            <input type="hidden" name="commission_id" value={row.id} />
                            <input type="hidden" name="target_status" value="pending_approval" />
                            <button className="font-semibold text-emerald-900">Send</button>
                          </form>
                        ) : null}
                        {isSystemOwner
                          && row.status === "pending_approval"
                          && (activeOwnerCount ?? 0) > 1
                          && row.submitted_by !== user.id
                          && row.overridden_by !== user.id ? (
                            <form action={transitionCommission}>
                              <input type="hidden" name="commission_id" value={row.id} />
                              <input type="hidden" name="target_status" value="approved" />
                              <button className="font-semibold text-emerald-900">Approve</button>
                            </form>
                          ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-zinc-500">No commission records match these filters.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ErpAppShell>
  );
}
