import Link from "next/link";
import { redirect } from "next/navigation";
import { CommissionRuleEditor } from "@/components/commissions/commission-rule-editor";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireCommissionViewer } from "@/lib/auth";
import {
  commissionBasisLabel,
  commissionFormulaLabel,
  type CommissionRuleRow,
  type SalesManagerOption,
} from "@/lib/commissions/types";
import { formatMoney } from "@/lib/currencies";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ error?: string; success?: string }>;
};

function dateTime(value: string | null) {
  if (!value) return "Open-ended";
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ruleValue(rule: CommissionRuleRow) {
  if (rule.formula_type === "percentage") return `${rule.percentage_rate}%`;
  if (rule.formula_type === "fixed_amount") {
    return formatMoney(rule.fixed_amount_currency, Number(rule.fixed_amount ?? 0));
  }
  if (rule.formula_type === "percentage_plus_fixed") {
    return `${rule.percentage_rate}% + ${formatMoney(rule.fixed_amount_currency, Number(rule.fixed_amount ?? 0))}`;
  }
  if (rule.formula_type === "tiered_percentage") {
    return `${rule.tier_configuration?.length ?? 0} slab tiers`;
  }
  return "Zero commission";
}

export default async function CommissionSettingsPage({ searchParams }: PageProps) {
  const { user, profile, displayName } = await requireCommissionViewer();
  if (profile?.role === "sales_designer") {
    redirect("/commissions");
  }

  const params = await searchParams;
  const supabase = await createClient();
  const [{ data: rules, error: rulesError }, { data: managerRows, error: managersError }] = await Promise.all([
    supabase
      .from("sales_commission_rules")
      .select("id,salesperson_id,formula_type,basis_type,percentage_rate,fixed_amount,fixed_amount_currency,tier_configuration,tier_method,effective_from,effective_to,is_enabled,notes,created_at")
      .order("effective_from", { ascending: false })
      .returns<CommissionRuleRow[]>(),
    supabase.rpc("list_commission_sales_managers"),
  ]);

  const managers = (managerRows ?? []) as SalesManagerOption[];
  const managerName = new Map(managers.map((manager) => [manager.id, manager.display_name]));
  const canManage = profile?.role === "system_owner";

  return (
    <ErpAppShell
      eyebrow="FINANCIAL CONTROL"
      title="Commission Settings"
      description="Review effective-dated Sales Manager commission rules and schedule immutable versions."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="grid gap-6 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/settings" className="text-sm font-semibold text-emerald-900">Back to settings</Link>
          <Link href="/commissions" className="text-sm font-semibold text-emerald-900">View commission ledger</Link>
        </div>

        {params?.success ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{params.success}</p>
        ) : null}
        {params?.error || rulesError || managersError ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {params?.error || rulesError?.message || managersError?.message}
          </p>
        ) : null}

        {canManage ? <CommissionRuleEditor salesManagers={managers} /> : (
          <p className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Admin Manager access is read-only. Only the System Owner can schedule commission rules.
          </p>
        )}

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-5 py-4">
            <h2 className="font-semibold text-zinc-950">Rule version history</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Sales Manager</th>
                  <th className="px-4 py-3">Formula</th>
                  <th className="px-4 py-3">Basis</th>
                  <th className="px-4 py-3">Rate / amount</th>
                  <th className="px-4 py-3">Effective from</th>
                  <th className="px-4 py-3">Effective to</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {(rules ?? []).map((rule) => (
                  <tr key={rule.id}>
                    <td className="px-4 py-3 font-medium text-zinc-900">{managerName.get(rule.salesperson_id) ?? rule.salesperson_id}</td>
                    <td className="px-4 py-3">{commissionFormulaLabel(rule.formula_type)}</td>
                    <td className="px-4 py-3">{commissionBasisLabel(rule.basis_type)}</td>
                    <td className="px-4 py-3">{ruleValue(rule)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateTime(rule.effective_from)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{dateTime(rule.effective_to)}</td>
                    <td className="px-4 py-3">{rule.is_enabled ? "Enabled" : "Disabled"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/commissions?salesperson=${rule.salesperson_id}`} className="font-semibold text-emerald-900">
                        Related commissions
                      </Link>
                    </td>
                  </tr>
                ))}
                {!rules?.length ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">No commission rules configured.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ErpAppShell>
  );
}
