import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { ContextBackLink } from "@/components/navigation/context-back-link";
import { PendingLinkButton } from "@/components/pending-link-button";
import { LocalDraftLink } from "@/components/quotations/local-draft-link";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import {
  formatQuotationDisplayNo,
  quotationOptionLabel,
  quotationRootBaseNo,
} from "@/lib/quotation-options";
import {
  quotationStatusBadgeClassName,
  quotationStatusLabel,
  quotationStatuses,
} from "@/lib/quotation-status";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { profileDisplayName } from "@/lib/user-display";
import {
  updateQuotation,
  updateQuotationExtraDiscount,
  updateQuotationStatus,
} from "../actions";

export const dynamic = "force-dynamic";

type QuotationDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string }>;
};

type Client = {
  id: string;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string;
  project_year: number | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

type Quotation = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  option_no: number;
  title: string;
  quotation_date: string;
  status: string;
  layout_mode: string;
  currency: string;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  grand_total: number;
  payment_terms: string | null;
  validity: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  notes: string | null;
  status_note: string | null;
  status_updated_at: string | null;
  status_updated_by: string | null;
  is_active: boolean;
};

const layoutModes = [
  ["simple_proposal", "Simple Proposal"],
  ["standard_proposal", "Standard Proposal"],
  ["comparison", "Comparison"],
  ["boq_schedule", "BOQ / Schedule"],
  ["internal_costing", "Internal Costing"],
] as const;

type QuotationSection = {
  id: string;
  quotation_id: string;
  section_title: string;
  section_notes: string | null;
  section_type: string;
  title_align: string;
  title_bold: boolean;
  title_bg: string;
  title_size: string;
  row_height: number | null;
  sort_order: number;
  is_active: boolean;
};

type QuotationItem = {
  id: string;
  quotation_id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  discount_type: string;
  discount_value: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  is_optional: boolean;
  internal_cost: number;
  margin_type: string;
  margin_value: number;
  is_rate_only: boolean;
  line_style: string;
  row_height: number | null;
  cell_layout: CellLayout | null;
  is_active: boolean;
  notes: string | null;
};

type CellLayout = {
  mergeMode?: string;
};

type AuditActivityEntry = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  parent_entity_type: string | null;
  parent_entity_id: string | null;
  action: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type GroupedActivityEntry = {
  actorName: string;
  action: string;
  count: number;
  dayKey: string;
  entries: AuditActivityEntry[];
  latestAt: string;
  summary: string;
};

function Field({
  name,
  label,
  defaultValue,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
}) {
  return (
    <label className="block md:col-span-2">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <PendingSubmitButton
      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </PendingSubmitButton>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${quotationStatusBadgeClassName(status)}`}>
      {quotationStatusLabel(status)}
    </span>
  );
}

function OptionBadge({ optionNo }: { optionNo: number }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700">
      {quotationOptionLabel(optionNo)}
    </span>
  );
}

function InfoValue({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-800">{value || "-"}</p>
    </div>
  );
}

function SecondaryActionLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      {label}
    </Link>
  );
}

function SecondaryPendingActionLink({
  href,
  label,
  pendingLabel,
}: {
  href: string;
  label: string;
  pendingLabel: string;
}) {
  return (
    <PendingLinkButton
      href={href}
      pendingLabel={pendingLabel}
      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      {label}
    </PendingLinkButton>
  );
}

function DocumentActionRow({
  title,
  description,
  previewHref,
  previewLabel,
  downloadHref,
  downloadLabel,
  pendingLabel,
}: {
  title: string;
  description: string;
  previewHref: string;
  previewLabel: string;
  downloadHref: string;
  downloadLabel: string;
  pendingLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
        <p className="mt-1 text-sm text-zinc-500">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <SecondaryActionLink href={previewHref} label={previewLabel} />
        <SecondaryPendingActionLink
          href={downloadHref}
          label={downloadLabel}
          pendingLabel={pendingLabel}
        />
      </div>
    </div>
  );
}

function CurrencySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">Currency</span>
      <select
        name="currency"
        defaultValue={normalizeCurrency(defaultValue ?? defaultCurrency)}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        {supportedCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusUpdateForm({
  quotation,
}: {
  quotation: Pick<Quotation, "id" | "status" | "status_note">;
}) {
  return (
    <form action={updateQuotationStatus} className="grid gap-3">
      <input type="hidden" name="quotation_id" value={quotation.id} />
      <input type="hidden" name="return_to" value={`/quotations/${quotation.id}`} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Change status</span>
        <select
          name="status"
          defaultValue={quotation.status}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {quotationStatuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Status note</span>
        <textarea
          name="status_note"
          defaultValue={quotation.status_note ?? ""}
          rows={2}
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <div className="flex justify-end">
        <SubmitButton label="Update status" />
      </div>
    </form>
  );
}

function projectContactLine(project?: Project | null) {
  return [
    project?.attention_mobile ? `Mob: ${project.attention_mobile}` : null,
    project?.attention_landline ? `Tel: ${project.attention_landline}` : null,
    project?.attention_email ? `Email: ${project.attention_email}` : null,
    project?.po_box ? `PO Box: ${project.po_box}` : null,
    project?.project_address,
  ]
    .filter(Boolean)
    .join(" - ");
}

function overallDiscountAmount(quotation: Quotation) {
  const itemNetTotal = Math.max(quotation.subtotal - quotation.discount_total, 0);

  if (quotation.overall_discount_type === "percent") {
    return (itemNetTotal * quotation.overall_discount_value) / 100;
  }

  return quotation.overall_discount_value;
}

function money(currency: string, value: number) {
  return formatQuotationMoney(currency, value);
}

function auditMetadataActorName(metadata: Record<string, unknown> | null | undefined) {
  const actorName = metadata?.actorName;

  return typeof actorName === "string" && actorName.trim() ? actorName : null;
}

function activityActorName(actorNameById: Map<string, string>, entry: AuditActivityEntry) {
  if (entry.created_by) {
    return actorNameById.get(entry.created_by) ?? auditMetadataActorName(entry.metadata) ?? "Unknown user";
  }

  return auditMetadataActorName(entry.metadata) ?? "Unknown user";
}

function activityDayKey(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function activityDayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();

  if (activityDayKey(date.toISOString()) === activityDayKey(today.toISOString())) {
    return "Today";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

function groupedActivitySummary({
  action,
  actorName,
  count,
}: {
  action: string;
  actorName: string;
  count: number;
}) {
  if (action === "row_price_updated" && count > 1) {
    return `${actorName} updated ${count} row prices`;
  }

  if (action === "quotation_item_added" && count > 1) {
    return `${actorName} added ${count} products to the quotation`;
  }

  if (action === "deleted" && count > 1) {
    return `${actorName} removed ${count} quotation rows`;
  }

  return null;
}

function groupActivityEntries(
  entries: AuditActivityEntry[],
  actorNameById: Map<string, string>,
) {
  const groups = new Map<string, GroupedActivityEntry>();

  for (const entry of entries) {
    const actorName = activityActorName(actorNameById, entry);
    const dayKey = activityDayKey(entry.created_at);
    const canGroup =
      entry.action === "row_price_updated" ||
      entry.action === "quotation_item_added" ||
      entry.action === "deleted";
    const groupKey = canGroup
      ? `${entry.action}:${actorName}:${dayKey}`
      : `single:${entry.id}`;
    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.count += 1;
      existingGroup.entries.push(entry);
      if (new Date(entry.created_at).getTime() > new Date(existingGroup.latestAt).getTime()) {
        existingGroup.latestAt = entry.created_at;
      }
      existingGroup.summary = groupedActivitySummary({
        action: existingGroup.action,
        actorName: existingGroup.actorName,
        count: existingGroup.count,
      }) ?? `${entry.title} by ${actorName}`;
      continue;
    }

    groups.set(groupKey, {
      actorName,
      action: entry.action,
      count: 1,
      dayKey,
      entries: [entry],
      latestAt: entry.created_at,
      summary: `${entry.title} by ${actorName}`,
    });
  }

  return Array.from(groups.values())
    .sort((left, right) => new Date(right.latestAt).getTime() - new Date(left.latestAt).getTime());
}

function entriesByDay<T extends { created_at?: string; latestAt?: string }>(
  entries: T[],
  getDateValue: (entry: T) => string,
) {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const dayKey = activityDayKey(getDateValue(entry));
    groups.set(dayKey, [...(groups.get(dayKey) ?? []), entry]);
  }

  return Array.from(groups.entries()).sort((left, right) => right[0].localeCompare(left[0]));
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
}

async function signedImageUrl(value: string | null, supabase: Awaited<ReturnType<typeof createSupabaseClient>>) {
  if (!value) return null;
  if (isDirectImageUrl(value)) return value;

  const bucket = value.startsWith("product-images:") ? "product-images" : "quote-images";
  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value.startsWith("quote-images:")
      ? value.slice("quote-images:".length)
      : value;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("QUOTATION DETAIL IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
}

function ExtraDiscountForm({
  quotation,
  returnTo,
  compact = false,
}: {
  quotation: Quotation;
  returnTo: string;
  compact?: boolean;
}) {
  return (
    <form action={updateQuotationExtraDiscount} className={compact ? "grid gap-2" : "grid gap-3 md:grid-cols-[180px_1fr_auto]"}>
      <input type="hidden" name="id" value={quotation.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Type</span>
        <select name="overall_discount_type" defaultValue={quotation.overall_discount_type} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
          <option value="amount">Amount</option>
          <option value="percent">Percent</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Value</span>
        <div className="mt-1 flex h-10 overflow-hidden rounded-md border border-zinc-200 bg-white focus-within:border-emerald-800 focus-within:ring-2 focus-within:ring-emerald-900/10">
          <input
            name="overall_discount_value"
            type="number"
            step="0.01"
            min="0"
            defaultValue={quotation.overall_discount_value}
            className="min-w-0 flex-1 px-3 text-sm outline-none"
          />
          <span className="flex items-center border-l border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-500">
            {quotation.overall_discount_type === "percent" ? "%" : quotation.currency}
          </span>
        </div>
      </label>
      <div className={compact ? "" : "flex items-end"}>
        <SubmitButton label="Save extra discount" />
      </div>
    </form>
  );
}

function QuotationTermsForm({ quotation, mode }: { quotation: Quotation; mode: "details" | "terms" }) {
  const isDetails = mode === "details";

  return (
    <form action={updateQuotation} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="id" value={quotation.id} />
      <input type="hidden" name="client_id" value={quotation.client_id} />
      <input type="hidden" name="project_id" value={quotation.project_id} />
      <input type="hidden" name="is_active" value={quotation.is_active ? "on" : ""} />
      <input type="hidden" name="audit_scope" value={isDetails ? "details" : "terms"} />
      {isDetails ? (
        <>
          <input type="hidden" name="currency" value={quotation.currency} />
          <input type="hidden" name="vat_percent" value={quotation.vat_percent} />
          <input type="hidden" name="overall_discount_type" value={quotation.overall_discount_type} />
          <input type="hidden" name="overall_discount_value" value={quotation.overall_discount_value} />
          <input type="hidden" name="payment_terms" value={quotation.payment_terms ?? ""} />
          <input type="hidden" name="validity" value={quotation.validity ?? ""} />
          <input type="hidden" name="delivery_terms" value={quotation.delivery_terms ?? ""} />
          <input type="hidden" name="warranty_terms" value={quotation.warranty_terms ?? ""} />
          <input type="hidden" name="notes" value={quotation.notes ?? ""} />
          <Field name="title" label="Title" defaultValue={quotation.title} required />
          <Field name="quotation_no" label="Quotation no" defaultValue={quotation.quotation_no} />
          <Field name="quotation_date" label="Quotation date" type="date" defaultValue={quotation.quotation_date} />
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Status</span>
            <select name="status" defaultValue={quotation.status} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
              {["draft", "sent", "revised", "approved", "won", "lost", "cancelled"].map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Layout Mode</span>
            <select name="layout_mode" defaultValue={quotation.layout_mode} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
              {layoutModes.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="title" value={quotation.title} />
          <input type="hidden" name="quotation_no" value={quotation.quotation_no ?? ""} />
          <input type="hidden" name="quotation_date" value={quotation.quotation_date} />
          <input type="hidden" name="status" value={quotation.status} />
          <input type="hidden" name="layout_mode" value={quotation.layout_mode} />
          <Field name="payment_terms" label="Payment terms" defaultValue={quotation.payment_terms} />
          <Field name="validity" label="Validity" defaultValue={quotation.validity} />
          <Field name="delivery_terms" label="Delivery terms" defaultValue={quotation.delivery_terms} />
          <Field name="warranty_terms" label="Warranty terms" defaultValue={quotation.warranty_terms} />
          <CurrencySelect defaultValue={quotation.currency} />
          <Field name="vat_percent" label="VAT %" type="number" defaultValue={quotation.vat_percent} />
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Extra Discount Type</span>
            <select name="overall_discount_type" defaultValue={quotation.overall_discount_type} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
              <option value="amount">Amount</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <Field
            name="overall_discount_value"
            label="Extra Discount Value"
            type="number"
            defaultValue={quotation.overall_discount_value}
          />
          <TextArea name="notes" label="Notes" defaultValue={quotation.notes} />
        </>
      )}
      <div className="flex justify-end md:col-span-2">
        <SubmitButton label={isDetails ? "Save quote details" : "Save commercial terms"} />
      </div>
    </form>
  );
}

function ImageCell({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-xs text-zinc-400">No image</span>;
  }

  return (
    <a href={value} target="_blank" className="block">
      <span
        aria-label="Open image"
        className="block h-14 w-14 rounded-md border border-zinc-200 bg-cover bg-center"
        style={{ backgroundImage: `url(${value})` }}
      />
    </a>
  );
}

export default async function QuotationDetailPage({
  params,
  searchParams,
}: QuotationDetailPageProps) {
  const { id } = await params;
  const { user, profile, displayName } = await requireActiveUser();
  const message = (await searchParams)?.message;
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id,company_name")
    .eq("id", quotation.client_id)
    .single<Client>();

  const { data: project } = await supabase
    .from("projects")
    .select("id,project_name,project_year,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
    .eq("id", quotation.project_id)
    .single<Project>();

  const { data: projectQuotations, error: projectQuotationsError } = await supabase
    .from("quotations")
    .select("id,quotation_no,option_no")
    .eq("project_id", quotation.project_id)
    .returns<Array<{ id: string; quotation_no: string | null; option_no: number }>>();

  const { data: sections, error: sectionsError } = await supabase
    .from("quotation_sections")
    .select("id,quotation_id,section_title,section_notes,section_type,title_align,title_bold,title_bg,title_size,row_height,sort_order,is_active")
    .eq("quotation_id", id)
    .order("sort_order", { ascending: true })
    .order("section_title", { ascending: true })
    .returns<QuotationSection[]>();

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select(
      "id,quotation_id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,is_active,notes",
    )
    .eq("quotation_id", id)
    .order("section_id", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true })
    .returns<QuotationItem[]>();

  const { data: quotationEvents, error: quotationEventsError } = await supabase
    .from("audit_activity_log")
    .select("id,entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by,created_at")
    .eq("entity_type", "quotation")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<AuditActivityEntry[]>();

  const { data: quotationChildEvents, error: quotationChildEventsError } = await supabase
    .from("audit_activity_log")
    .select("id,entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by,created_at")
    .eq("parent_entity_type", "quotation")
    .eq("parent_entity_id", id)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<AuditActivityEntry[]>();

  if (sectionsError) console.error("QUOTATION SECTIONS LIST ERROR", sectionsError.message);
  if (itemsError) console.error("QUOTATION ITEMS LIST ERROR", itemsError.message);
  if (projectQuotationsError) console.error("PROJECT QUOTATIONS OPTION LIST ERROR", projectQuotationsError.message);
  if (quotationEventsError) console.error("QUOTATION ACTIVITY LOG ERROR", quotationEventsError.message);
  if (quotationChildEventsError) console.error("QUOTATION CHILD ACTIVITY LOG ERROR", quotationChildEventsError.message);

  const rootBaseNo = quotationRootBaseNo(quotation.quotation_no);
  const optionCountForRootBase = rootBaseNo
    ? Math.max(
        1,
        ...(projectQuotations ?? [])
          .filter((candidate) => quotationRootBaseNo(candidate.quotation_no) === rootBaseNo)
          .map((candidate) => candidate.option_no ?? 1),
      )
    : 1;
  const showOptionNumber = optionCountForRootBase > 1;
  const displayQuotationNo = formatQuotationDisplayNo({
    optionNo: quotation.option_no,
    quotationNo: quotation.quotation_no,
    showOptionNumber,
  });

  const activityEntries = Array.from(
    new Map(
      [...(quotationEvents ?? []), ...(quotationChildEvents ?? [])].map((entry) => [entry.id, entry]),
    ).values(),
  )
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 20);
  const activityActorIds = Array.from(new Set(
    [quotation.status_updated_by, ...activityEntries.map((entry) => entry.created_by)]
      .filter((value): value is string => Boolean(value)),
  ));
  const activityActorNameById = new Map<string, string>();

  if (activityActorIds.length) {
    const { data: activityProfiles, error: activityProfilesError } = await supabase
      .from("profiles")
      .select("id,name,full_name,email")
      .in("id", activityActorIds)
      .returns<Array<{ id: string; name: string | null; full_name: string | null; email: string | null }>>();

    if (activityProfilesError) {
      console.error("QUOTATION ACTIVITY PROFILES ERROR", activityProfilesError.message);
    } else {
      for (const profile of activityProfiles ?? []) {
        activityActorNameById.set(profile.id, profileDisplayName(profile));
      }
    }
  }

  const groupedActivityEntries = groupActivityEntries(activityEntries, activityActorNameById).slice(0, 5);
  const groupedActivityByDay = entriesByDay(groupedActivityEntries, (entry) => entry.latestAt);
  const fullActivityByDay = entriesByDay(activityEntries, (entry) => entry.created_at);

  const itemsBySection = new Map<string, QuotationItem[]>();

  for (const item of items ?? []) {
    const key = item.section_id ?? "unsectioned";
    const sectionItems = itemsBySection.get(key) ?? [];
    sectionItems.push(item);
    itemsBySection.set(key, sectionItems);
  }
  const itemCurrencies = new Set(
    (items ?? [])
      .filter((item) => item.is_active)
      .map((item) => normalizeCurrency(item.currency)),
  );
  const hasMixedCurrencies =
    itemCurrencies.size > 1 ||
    (itemCurrencies.size === 1 && !itemCurrencies.has(normalizeCurrency(quotation.currency)));
  const activeItems = (items ?? []).filter((item) => item.is_active);
  const specifiedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const proposedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot, supabase),
    ] as const),
  );
  const specifiedImageUrlByItemId = new Map(specifiedImageEntries);
  const proposedImageUrlByItemId = new Map(proposedImageEntries);

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Quotation Detail"
          description="Review quotation details, totals, terms, and line-item snapshots."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ContextBackLink
              fallbackHref={`/clients/projects/${quotation.project_id}`}
              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Back
            </ContextBackLink>
            {message ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {message}
              </p>
            ) : null}
          </div>

          <section className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-500">
                    {displayQuotationNo ?? quotation.quotation_no ?? "Draft quotation"}
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold text-zinc-950">
                    {quotation.title}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {showOptionNumber ? <OptionBadge optionNo={quotation.option_no} /> : null}
                    <StatusBadge status={quotation.status} />
                    <LocalDraftLink quotationId={quotation.id} showLink={false} />
                  </div>
                </div>
                <div className="flex flex-col gap-3 xl:items-end">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/quotations/${quotation.id}/local-builder`}
                      className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                      Open Builder
                    </Link>
                    <SecondaryActionLink href={`/quotations/${quotation.id}/pdf`} label="Preview Quotation" />
                    <SecondaryPendingActionLink
                      href={`/quotations/${quotation.id}/download-pdf`}
                      label="Download Quotation PDF"
                      pendingLabel="Preparing PDF..."
                    />
                  </div>
                  <p className="text-xs text-zinc-500">Builder now opens the local workflow by default.</p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoValue label="Date" value={quotation.quotation_date} />
                <InfoValue label="Client" value={client?.company_name ?? "Unknown client"} />
                <InfoValue label="Project" value={project?.project_name ?? "Unknown project"} />
                <InfoValue label="Project year" value={project?.project_year ?? "No year"} />
                <InfoValue label="Layout" value={layoutModes.find(([value]) => value === quotation.layout_mode)?.[1] ?? quotation.layout_mode} />
                <InfoValue label="Attention to" value={project?.attention_to} />
                <InfoValue label="Location" value={project?.location} />
              </div>
              {projectContactLine(project) ? (
                <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                  {projectContactLine(project)}
                </p>
              ) : null}

              <section className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-950">Documents & Exports</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Preview, edit, and download quotation documents from one place.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <DocumentActionRow
                    title="Quotation"
                    description="Client-facing commercial quotation."
                    previewHref={`/quotations/${quotation.id}/pdf`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-pdf`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing PDF..."
                  />
                  <DocumentActionRow
                    title="Specification Sheet"
                    description="Technical product specification."
                    previewHref={`/quotations/${id}/specification`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-specification`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing Specification..."
                  />
                  <DocumentActionRow
                    title="Presentation"
                    description="Visual client presentation."
                    previewHref={`/quotations/${quotation.id}/presentation`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-presentation`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing Presentation..."
                  />
                  <DocumentActionRow
                    title="Procurement RFQ"
                    description="Supplier request for quotation."
                    previewHref={`/quotations/${quotation.id}/procurement-rfq`}
                    previewLabel="Preview / Edit"
                    downloadHref={`/quotations/${quotation.id}/download-procurement-rfq`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing RFQ..."
                  />
                  <DocumentActionRow
                    title="Purchase Order"
                    description="Supplier purchase order."
                    previewHref={`/quotations/${quotation.id}/purchase-order`}
                    previewLabel="Preview / Edit"
                    downloadHref={`/quotations/${quotation.id}/download-purchase-order`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing PO..."
                  />
                  <DocumentActionRow
                    title="Order Confirmation"
                    description="Client order confirmation document."
                    previewHref={`/quotations/${quotation.id}/order-confirmation`}
                    previewLabel="Preview"
                    downloadHref={`/quotations/${quotation.id}/download-order-confirmation`}
                    downloadLabel="Download PDF"
                    pendingLabel="Preparing Confirmation..."
                  />
                </div>
              </section>

              {canManageRecords ? (
                <details className="mt-5" data-state-key={`quotation-details-${quotation.id}`}>
                  <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                    Edit quote details
                  </summary>
                  <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                    <QuotationTermsForm quotation={quotation} mode="details" />
                  </div>
                </details>
              ) : null}
            </div>

            <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold uppercase text-zinc-500">Totals</h2>
              {hasMixedCurrencies ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  Currency conversion is not enabled yet. Mixed-currency totals should be reviewed manually.
                </p>
              ) : null}
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Total Price</span>
                  <span className="font-medium text-zinc-950">{money(quotation.currency, quotation.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Item Discount</span>
                  <span className="font-medium text-zinc-950">{money(quotation.currency, quotation.discount_total)}</span>
                </div>
                {Number(overallDiscountAmount(quotation) || 0) > 0 ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Extra Discount</span>
                    <span className="font-medium text-zinc-950">{money(quotation.currency, overallDiscountAmount(quotation))}</span>
                  </div>
                ) : null}
                {canManageRecords ? (
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <ExtraDiscountForm quotation={quotation} returnTo={`/quotations/${quotation.id}`} compact />
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">VAT {quotation.vat_percent}%</span>
                  <span className="font-medium text-zinc-950">{money(quotation.currency, quotation.vat_amount)}</span>
                </div>
                <div className="border-t border-zinc-200 pt-3">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Final Total</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-950">
                    {money(quotation.currency, quotation.grand_total)}
                  </p>
                </div>
              </div>
            </aside>
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Quotation Status</h2>
                <div className="mt-3 flex items-center gap-3">
                  <StatusBadge status={quotation.status} />
                  <span className="text-sm text-zinc-600">
                    Current: {quotationStatusLabel(quotation.status)}
                  </span>
                </div>
                {quotation.status_updated_at ? (
                  <p className="mt-3 text-sm text-zinc-500">
                    Updated by {quotation.status_updated_by
                      ? (activityActorName(activityActorNameById, {
                          id: "status-meta",
                          entity_type: "quotation",
                          entity_id: quotation.id,
                          parent_entity_type: null,
                          parent_entity_id: null,
                          action: "quotation_status_updated",
                          title: "Quotation status updated",
                          description: null,
                          metadata: null,
                          created_by: quotation.status_updated_by,
                          created_at: quotation.status_updated_at,
                        }))
                      : "Unknown user"} on{" "}
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(quotation.status_updated_at))}
                  </p>
                ) : null}
                {quotation.status_note ? (
                  <p className="mt-2 text-sm text-zinc-600">
                    Note: {quotation.status_note}
                  </p>
                ) : null}
              </div>
            </div>
            {canManageRecords ? (
              <details className="mt-5" data-state-key={`quotation-status-${quotation.id}`}>
                <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                  Change status
                </summary>
                <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                  <StatusUpdateForm quotation={quotation} />
                </div>
              </details>
            ) : null}
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Commercial Terms</h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <InfoValue label="Payment Terms" value={quotation.payment_terms} />
                  <InfoValue label="Validity" value={quotation.validity} />
                  <InfoValue label="Delivery Terms" value={quotation.delivery_terms} />
                  <InfoValue label="Warranty" value={quotation.warranty_terms} />
                  <InfoValue label="Currency" value={quotation.currency} />
                  <InfoValue label="VAT %" value={`${quotation.vat_percent}%`} />
                  <InfoValue
                    label="Extra Discount"
                    value={
                      quotation.overall_discount_type === "percent"
                        ? `${quotation.overall_discount_value}%`
                        : money(quotation.currency, quotation.overall_discount_value)
                    }
                  />
                </div>
                {quotation.notes ? (
                  <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-600">{quotation.notes}</p>
                ) : null}
              </div>
            </div>
            {canManageRecords ? (
              <details className="mt-5" data-state-key={`quotation-terms-${quotation.id}`}>
                <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                  Edit commercial terms
                </summary>
                <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                  <QuotationTermsForm quotation={quotation} mode="terms" />
                </div>
              </details>
            ) : null}
          </section>

          {canManageRecords ? (
            <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Quotation Activity</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Latest internal quotation history.
                  </p>
                </div>
              </div>
              {groupedActivityEntries.length ? (
                <div className="mt-4 space-y-4">
                  {groupedActivityByDay.map(([dayKey, entries]) => (
                    <div key={dayKey}>
                      <p className="text-xs font-semibold uppercase text-zinc-500">
                        {activityDayLabel(entries[0].latestAt)}
                      </p>
                      <ul className="mt-2 space-y-2">
                        {entries.map((entry) => (
                          <li key={`${entry.action}-${entry.latestAt}`} className="text-sm text-zinc-700">
                            <span className="mr-2 text-zinc-400">•</span>
                            {entry.summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <details
                    className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2"
                    data-state-key={`quotation-activity-log-${quotation.id}`}
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                      View full activity log
                    </summary>
                    <div className="mt-3 space-y-4">
                      {fullActivityByDay.map(([dayKey, entries]) => (
                        <div key={dayKey}>
                          <p className="text-xs font-semibold uppercase text-zinc-500">
                            {activityDayLabel(entries[0].created_at)}
                          </p>
                          <ul className="mt-2 space-y-2">
                            {entries.map((entry) => (
                              <li key={entry.id} className="text-sm text-zinc-700">
                                <span className="mr-2 text-zinc-400">•</span>
                                <span className="font-medium text-zinc-950">
                                  {entry.title} by {activityActorName(activityActorNameById, entry)}
                                </span>
                                <span className="ml-2 text-xs text-zinc-500">
                                  {new Intl.DateTimeFormat("en-US", {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  }).format(new Date(entry.created_at))}
                                </span>
                                {entry.description ? (
                                  <span className="block pl-4 text-xs text-zinc-500">{entry.description}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">No activity recorded yet.</p>
              )}
            </section>
          ) : null}

          <section className="mt-6 space-y-5">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Sections & Line Items</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Read-only line summary. To edit items, open the quotation builder.
                  </p>
                </div>
                <Link
                  href={`/quotations/${quotation.id}/local-builder`}
                  className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                  Open Builder
                </Link>
              </div>
            </div>
            {(sections ?? []).map((section) => {
              const sectionItems = itemsBySection.get(section.id) ?? [];

              return (
                <article
                  key={section.id}
                  className="rounded-lg border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="border-b border-zinc-200 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-zinc-950">
                          {section.section_title}
                        </h2>
                        <p className="mt-1 text-xs font-medium text-zinc-500">
                          Sort {section.sort_order}
                        </p>
                        {section.section_notes ? (
                          <p className="mt-1 text-sm text-zinc-500">
                            {section.section_notes}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto p-5">
                    <table className="w-full min-w-[1180px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                          <th className="py-3 pr-3">S. No.</th>
                          <th className="py-3 pr-3">Item Code</th>
                          <th className="py-3 pr-3">Specified Image</th>
                          <th className="py-3 pr-3">Proposed Image</th>
                          <th className="py-3 pr-3">Specification</th>
                          <th className="py-3 pr-3">Qty</th>
                          <th className="py-3 pr-3">U.Price</th>
                          <th className="py-3 pr-3">Discount</th>
                          <th className="py-3 pr-3">Net Price</th>
                          <th className="py-3 pr-3">Net Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sectionItems.map((item, index) => (
                          <tr key={item.id} className="border-b border-zinc-100 align-top">
                            <td className="py-3 pr-3 text-zinc-600">{index + 1}</td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {item.item_code_snapshot ?? "-"}
                            </td>
                            <td className="py-3 pr-3">
                              <ImageCell value={specifiedImageUrlByItemId.get(item.id) ?? null} />
                            </td>
                            <td className="py-3 pr-3">
                              <ImageCell value={proposedImageUrlByItemId.get(item.id) ?? null} />
                            </td>
                            <td className="py-3 pr-3 text-zinc-700">
                              <p className="font-medium text-zinc-950">
                                {item.item_name_snapshot ?? "Custom item"}
                              </p>
                              <p className="mt-1 max-w-sm whitespace-pre-wrap">
                                {item.specification_snapshot ?? "-"}
                              </p>
                            </td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {item.qty} {item.unit_label}
                            </td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {money(item.currency, item.unit_price)}
                            </td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {item.discount_type === "percent"
                                ? `${item.discount_value}%`
                                : money(item.currency, item.discount_value)}
                            </td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {money(item.currency, item.net_price)}
                            </td>
                            <td className="py-3 pr-3 font-semibold text-zinc-950">
                              {money(item.currency, item.net_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!sectionItems.length ? (
                      <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                        No line items yet.
                      </p>
                    ) : null}
                  </div>

                </article>
              );
            })}

            {!sections?.length ? (
              <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                No sections yet. Open the builder to add quotation sections and items.
              </section>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
