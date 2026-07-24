import Link from "next/link";
import { notFound } from "next/navigation";
import { saveCommissionDraft, transitionCommission } from "@/app/commissions/actions";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireCommissionViewer } from "@/lib/auth";
import {
  commissionBasisLabel,
  commissionFormulaLabel,
  commissionStatusLabel,
  type CommissionRuleRow,
  type SalesCommissionRow,
  type SalesManagerOption,
} from "@/lib/commissions/types";
import { formatMoney } from "@/lib/currencies";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; success?: string }>;
};

type AuditRow = {
  action: string;
  created_at: string;
  created_by: string | null;
  description: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  title: string;
};

const detailSelect =
  "id,approval_snapshot_id,quotation_id,quotation_folder_key,salesperson_id,rule_id,source_type,formula_type_snapshot,basis_type_snapshot,formula_configuration_snapshot,percentage_rate_snapshot,fixed_amount_snapshot,fixed_amount_currency_snapshot,tier_configuration_snapshot,tier_method_snapshot,matched_tier_snapshot,approved_total_including_vat,vat_amount,approved_total_excluding_vat,commissionable_base,commissionable_base_override,percentage_rate_override,fixed_amount_override,percentage_component,fixed_component,original_calculated_amount,final_commission_amount,currency,earned_at,status,review_reason,override_reason,overridden_by,overridden_at,submitted_by,submitted_at,approved_at,paid_by,paid_at,cancelled_at,cancellation_reason,reversed_at,reversal_reason,management_notes,created_at,updated_at";

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-AE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{value}</dd>
    </div>
  );
}

function WorkflowAction({
  commissionId,
  label,
  notePlaceholder,
  reasonRequired = false,
  targetStatus,
}: {
  commissionId: string;
  label: string;
  notePlaceholder?: string;
  reasonRequired?: boolean;
  targetStatus: string;
}) {
  return (
    <form action={transitionCommission} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="commission_id" value={commissionId} />
      <input type="hidden" name="target_status" value={targetStatus} />
      {reasonRequired || notePlaceholder ? (
        <input
          name="reason"
          required={reasonRequired}
          placeholder={reasonRequired ? "Required reason" : notePlaceholder}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      ) : null}
      <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">{label}</button>
    </form>
  );
}

export default async function CommissionDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const messages = await searchParams;
  const { user, profile, displayName } = await requireCommissionViewer();
  const supabase = await createClient();
  const { data: commission, error } = await supabase
    .from("sales_commissions")
    .select(detailSelect)
    .eq("id", id)
    .maybeSingle<SalesCommissionRow>();

  if (error || !commission) notFound();

  const isSystemOwner = profile?.role === "system_owner";
  const isFinancialEditor = isSystemOwner || profile?.role === "admin_manager";
  const isManagementViewer = isSystemOwner || profile?.role === "admin_manager";
  const [{ data: managerRows }, { data: auditRows }, { data: rules }, { data: ownerRows }] = await Promise.all([
    isManagementViewer
      ? supabase.rpc("list_commission_sales_managers")
      : Promise.resolve({ data: [] as SalesManagerOption[] }),
    supabase
      .from("audit_activity_log")
      .select("id,action,title,description,metadata,created_by,created_at")
      .eq("entity_type", "sales_commission")
      .eq("entity_id", commission.id)
      .order("created_at", { ascending: false })
      .returns<AuditRow[]>(),
    isFinancialEditor
      ? supabase
          .from("sales_commission_rules")
          .select("id,salesperson_id,formula_type,basis_type,percentage_rate,fixed_amount,fixed_amount_currency,tier_configuration,tier_method,effective_from,effective_to,is_enabled,notes,created_at")
          .eq("salesperson_id", commission.salesperson_id)
          .lte("effective_from", commission.earned_at)
          .or(`effective_to.is.null,effective_to.gt.${commission.earned_at}`)
          .order("effective_from", { ascending: false })
          .returns<CommissionRuleRow[]>()
      : Promise.resolve({ data: [] as CommissionRuleRow[] }),
    isSystemOwner
      ? supabase
          .from("profiles")
          .select("id")
          .eq("role", "system_owner")
          .eq("account_status", "active")
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const managers = (managerRows ?? []) as SalesManagerOption[];
  const managerName = managers.find((manager) => manager.id === commission.salesperson_id)?.display_name
    ?? (profile?.role === "sales_designer" ? displayName : commission.salesperson_id);
  const effectiveBase = commission.commissionable_base_override ?? commission.commissionable_base;
  const effectiveRate = commission.percentage_rate_override ?? commission.percentage_rate_snapshot;
  const effectiveFixed = commission.fixed_amount_override ?? commission.fixed_amount_snapshot;
  const directFinalOverride =
    commission.override_reason &&
    Number(commission.final_commission_amount) !==
      Number(commission.percentage_component) + Number(commission.fixed_component)
      ? commission.final_commission_amount
      : null;
  const currentOwnerMadeRecord =
    commission.submitted_by === user.id || commission.overridden_by === user.id;
  const otherActiveOwnerCount = (ownerRows ?? []).filter((owner) => owner.id !== user.id).length;

  return (
    <ErpAppShell
      eyebrow="COMMISSION DETAIL"
      title={commission.quotation_folder_key}
      description="Immutable approval value, applied rule, calculation breakdown, and workflow history."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="grid gap-6 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/commissions" className="text-sm font-semibold text-emerald-900">Back to commissions</Link>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-semibold text-zinc-700">{commissionStatusLabel(commission.status)}</span>
        </div>
        {messages?.success ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{messages.success}</p> : null}
        {messages?.error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{messages.error}</p> : null}
        {commission.review_reason ? <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{commission.review_reason}</p> : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-zinc-950">Commercial approval</h2>
          <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Sales Manager" value={managerName} />
            <Detail label="Quotation folder" value={commission.quotation_folder_key} />
            <Detail label="Approval source" value={commission.source_type.replaceAll("_", " ")} />
            <Detail label="Earning date" value={dateTime(commission.earned_at)} />
            <Detail label="Approved incl. VAT" value={formatMoney(commission.currency, Number(commission.approved_total_including_vat))} />
            <Detail label="VAT" value={commission.vat_amount === null ? "Unavailable" : formatMoney(commission.currency, Number(commission.vat_amount))} />
            <Detail label="Approved excl. VAT" value={commission.approved_total_excluding_vat === null ? "Unavailable" : formatMoney(commission.currency, Number(commission.approved_total_excluding_vat))} />
            <Detail label="Basis" value={commissionBasisLabel(commission.basis_type_snapshot)} />
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-zinc-950">Calculation breakdown</h2>
          <dl className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Formula" value={commissionFormulaLabel(commission.formula_type_snapshot)} />
            <Detail label="Commissionable base" value={effectiveBase === null ? "Not available" : formatMoney(commission.currency, Number(effectiveBase))} />
            <Detail label="Percentage rate" value={effectiveRate === null ? "—" : `${effectiveRate}%`} />
            <Detail label="Fixed amount" value={effectiveFixed === null ? "—" : formatMoney(commission.fixed_amount_currency_snapshot ?? commission.currency, Number(effectiveFixed))} />
            <Detail label="Matched tier" value={commission.matched_tier_snapshot ? `${commission.matched_tier_snapshot.minimum}–${commission.matched_tier_snapshot.maximum ?? "above"} at ${commission.matched_tier_snapshot.rate}%` : "—"} />
            <Detail label="Percentage component" value={formatMoney(commission.currency, Number(commission.percentage_component))} />
            <Detail label="Fixed component" value={formatMoney(commission.currency, Number(commission.fixed_component))} />
            <Detail label="Original calculation" value={formatMoney(commission.currency, Number(commission.original_calculated_amount))} />
            <Detail label="Management override" value={commission.override_reason ?? "None"} />
            <Detail label="Final commission" value={formatMoney(commission.currency, Number(commission.final_commission_amount))} />
          </dl>
        </section>

        {isFinancialEditor && (commission.status === "draft" || commission.status === "requires_review") ? (
          <form action={saveCommissionDraft} className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">Recalculate or override Draft</h2>
            <input type="hidden" name="commission_id" value={commission.id} />
            <input type="hidden" name="currency" value={commission.currency} />
            <input type="hidden" name="current_basis" value={commission.commissionable_base ?? ""} />
            <input type="hidden" name="existing_rule_id" value={commission.rule_id ?? ""} />
            <input type="hidden" name="existing_base_override" value={commission.commissionable_base_override ?? ""} />
            <input type="hidden" name="existing_rate_override" value={commission.percentage_rate_override ?? ""} />
            <input type="hidden" name="existing_fixed_override" value={commission.fixed_amount_override ?? ""} />
            <input type="hidden" name="existing_final_override" value={directFinalOverride ?? ""} />
            <div className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              Normal calculated amount: <span className="font-semibold text-zinc-950">{formatMoney(commission.currency, Number(commission.original_calculated_amount))}</span>
              <p className="mt-1 text-xs text-zinc-500">Leave override fields blank to use the calculated commission.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                Effective rule
                <select name="rule_id" required defaultValue={commission.rule_id ?? ""} className="rounded-md border border-zinc-300 px-3 py-2">
                  <option value="">Select rule</option>
                  {(rules ?? []).map((rule) => (
                    <option key={rule.id} value={rule.id}>{commissionFormulaLabel(rule.formula_type)} · {dateTime(rule.effective_from)}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">Base override<input name="base_override" type="number" min="0" step="0.01" defaultValue={commission.commissionable_base_override ?? ""} className="rounded-md border border-zinc-300 px-3 py-2" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">Rate override %<input name="percentage_rate_override" type="number" min="0" max="100" step="0.0001" defaultValue={commission.percentage_rate_override ?? ""} className="rounded-md border border-zinc-300 px-3 py-2" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">Fixed override<input name="fixed_amount_override" type="number" min="0" step="0.01" defaultValue={commission.fixed_amount_override ?? ""} className="rounded-md border border-zinc-300 px-3 py-2" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">Final amount override<input name="final_commission_amount_override" type="number" min="0" step="0.01" defaultValue={directFinalOverride ?? ""} className="rounded-md border border-zinc-300 px-3 py-2" /></label>
              <label className="grid gap-1.5 text-sm font-medium text-zinc-700">Override reason<input name="override_reason" placeholder="Required only for financial changes" className="rounded-md border border-zinc-300 px-3 py-2" /></label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium text-zinc-700">Management notes<textarea name="management_notes" rows={3} defaultValue={commission.management_notes ?? ""} className="rounded-md border border-zinc-300 px-3 py-2" /></label>
            <button className="justify-self-start rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white">Recalculate Draft</button>
          </form>
        ) : null}

        {isManagementViewer && commission.management_notes ? (
          <section className="rounded-lg border border-zinc-200 bg-white p-5"><h2 className="font-semibold">Management notes</h2><p className="mt-2 text-sm text-zinc-700">{commission.management_notes}</p></section>
        ) : null}

        {isSystemOwner || (commission.status === "draft" && (profile?.role === "sales_designer" || profile?.role === "admin_manager")) ? (
          <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">Workflow actions</h2>
            <div className="flex flex-wrap gap-3">
              {commission.status === "draft" && commission.overridden_by !== user.id ? <WorkflowAction commissionId={commission.id} label="Send for Approval" notePlaceholder="Optional submission note" targetStatus="pending_approval" /> : null}
              {isSystemOwner && commission.status === "draft" ? <WorkflowAction commissionId={commission.id} label="Cancel" targetStatus="cancelled" reasonRequired /> : null}
              {isSystemOwner && commission.status === "pending_approval" ? <WorkflowAction commissionId={commission.id} label="Return to Draft" targetStatus="draft" reasonRequired /> : null}
              {isSystemOwner && commission.status === "pending_approval" && !currentOwnerMadeRecord && otherActiveOwnerCount > 0 ? <WorkflowAction commissionId={commission.id} label="Approve" targetStatus="approved" /> : null}
              {isSystemOwner && commission.status === "pending_approval" ? <WorkflowAction commissionId={commission.id} label="Cancel" targetStatus="cancelled" reasonRequired /> : null}
              {isSystemOwner && commission.status === "approved" ? <WorkflowAction commissionId={commission.id} label="Mark paid" targetStatus="paid" /> : null}
              {isSystemOwner && (commission.status === "approved" || commission.status === "paid") ? <WorkflowAction commissionId={commission.id} label="Reverse" targetStatus="reversed" reasonRequired /> : null}
            </div>
            {isSystemOwner && commission.status === "pending_approval" && currentOwnerMadeRecord ? (
              <p className="text-sm text-amber-800">
                Maker–checker control: you cannot approve a commission you submitted or financially edited.
                {otherActiveOwnerCount === 0 ? " Approval is blocked until another active System Owner is available." : " Another active System Owner must approve it."}
              </p>
            ) : null}
            {isSystemOwner && commission.status === "pending_approval" && !currentOwnerMadeRecord && otherActiveOwnerCount === 0 ? (
              <p className="text-sm text-amber-800">
                Maker–checker control: approval is blocked until another active System Owner is available.
              </p>
            ) : null}
            {commission.status === "draft" && commission.overridden_by === user.id ? (
              <p className="text-sm text-amber-800">
                Maker–checker control: the last financial editor cannot submit this commission. Another permitted user must send it for approval.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-zinc-950">Audit and status history</h2>
          <div className="mt-4 grid gap-3">
            {(auditRows ?? []).map((entry) => (
              <div key={entry.id} className="border-l-2 border-zinc-200 pl-4">
                <p className="text-sm font-medium text-zinc-900">{entry.title}</p>
                <p className="text-xs text-zinc-500">
                  {typeof entry.metadata?.actorName === "string" ? entry.metadata.actorName : entry.created_by ?? "System"}
                  {typeof entry.metadata?.actorRole === "string" ? ` (${entry.metadata.actorRole.replaceAll("_", " ")})` : ""}
                  {` · ${dateTime(entry.created_at)}`}
                  {entry.description ? ` · ${entry.description}` : ""}
                </p>
              </div>
            ))}
            {!auditRows?.length ? <p className="text-sm text-zinc-500">No commission audit events recorded.</p> : null}
          </div>
        </section>
      </div>
    </ErpAppShell>
  );
}
