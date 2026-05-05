import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { ContextBackLink } from "@/components/navigation/context-back-link";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, formatMoney, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  updateQuotation,
  updateQuotationExtraDiscount,
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
    <button
      type="submit"
      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600">
      {status}
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

  if (sectionsError) console.error("QUOTATION SECTIONS LIST ERROR", sectionsError.message);
  if (itemsError) console.error("QUOTATION ITEMS LIST ERROR", itemsError.message);

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
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-500">
                    {quotation.quotation_no ?? "Draft quotation"}
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold text-zinc-950">
                    {quotation.title}
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/quotations/${quotation.id}/pdf`}
                    className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    Preview PDF
                  </Link>
                  <Link
                    href={`/quotations/${quotation.id}/download-pdf`}
                    className="rounded-md border border-emerald-900 bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  >
                    Download PDF
                  </Link>
                  <Link
                    href={`/quotations/${quotation.id}/builder`}
                    className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  >
                    Open Builder
                  </Link>
                  <StatusBadge status={quotation.status} />
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

              {canManageRecords ? (
                <details className="mt-5">
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
                  <span className="font-medium text-zinc-950">{formatMoney(quotation.currency, quotation.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Item Discount</span>
                  <span className="font-medium text-zinc-950">{formatMoney(quotation.currency, quotation.discount_total)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">Extra Discount</span>
                  <span className="font-medium text-zinc-950">{formatMoney(quotation.currency, overallDiscountAmount(quotation))}</span>
                </div>
                {canManageRecords ? (
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <ExtraDiscountForm quotation={quotation} returnTo={`/quotations/${quotation.id}`} compact />
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-500">VAT {quotation.vat_percent}%</span>
                  <span className="font-medium text-zinc-950">{formatMoney(quotation.currency, quotation.vat_amount)}</span>
                </div>
                <div className="border-t border-zinc-200 pt-3">
                  <p className="text-xs font-semibold uppercase text-zinc-500">Final Total</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-950">
                    {formatMoney(quotation.currency, quotation.grand_total)}
                  </p>
                </div>
              </div>
            </aside>
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
                        : formatMoney(quotation.currency, quotation.overall_discount_value)
                    }
                  />
                </div>
                {quotation.notes ? (
                  <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-600">{quotation.notes}</p>
                ) : null}
              </div>
            </div>
            {canManageRecords ? (
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                  Edit commercial terms
                </summary>
                <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                  <QuotationTermsForm quotation={quotation} mode="terms" />
                </div>
              </details>
            ) : null}
          </section>

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
                  href={`/quotations/${quotation.id}/builder`}
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
                              <ImageCell value={item.specified_image_url_snapshot} />
                            </td>
                            <td className="py-3 pr-3">
                              <ImageCell value={item.proposed_image_url_snapshot} />
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
                              {formatMoney(item.currency, item.unit_price)}
                            </td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {item.discount_type === "percent"
                                ? `${item.discount_value}%`
                                : formatMoney(item.currency, item.discount_value)}
                            </td>
                            <td className="py-3 pr-3 text-zinc-600">
                              {formatMoney(item.currency, item.net_price)}
                            </td>
                            <td className="py-3 pr-3 font-semibold text-zinc-950">
                              {formatMoney(item.currency, item.net_total)}
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
