import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { TopBar } from "@/components/top-bar";
import {
  createQuotation,
  createQuotationOption,
  createQuotationRevision,
  deactivateQuotation,
  duplicateQuotation,
  permanentlyDeleteQuotation,
  restoreQuotation,
} from "@/app/quotations/actions";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProjectPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ message?: string }>;
};

type Client = {
  id: string;
  company_name: string;
  client_code: string | null;
  email: string | null;
  phone: string | null;
};

type Project = {
  id: string;
  client_id: string;
  project_name: string;
  project_year: number | null;
  project_code: string | null;
  location: string | null;
  consultant: string | null;
  contractor: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
  project_status: string;
  notes: string | null;
  is_active: boolean;
};

type Quotation = {
  id: string;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  status: string;
  currency: string;
  grand_total: number;
  is_active: boolean;
};

type QuotationAction = (formData: FormData) => Promise<void>;

const quotationStatuses = new Map([
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["revised", "Revised"],
  ["approved", "Approved"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["cancelled", "Cancelled"],
]);

const projectStatuses = new Map([
  ["active", "Active"],
  ["on_hold", "On Hold"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
]);

const layoutModes = [
  ["simple_proposal", "Simple Proposal"],
  ["standard_proposal", "Standard Proposal"],
  ["comparison", "Comparison"],
  ["boq_schedule", "BOQ / Schedule"],
  ["internal_costing", "Internal Costing"],
] as const;

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
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
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

function TextArea({ name, label }: { name: string; label: string }) {
  return (
    <label className="block md:col-span-2">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600">
      {label}
    </span>
  );
}

function InfoValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-zinc-950">{value || "-"}</p>
    </div>
  );
}

function projectContactLine(project: Project) {
  return [
    project.attention_to ? `Attn: ${project.attention_to}` : null,
    project.attention_mobile ? `Mob: ${project.attention_mobile}` : null,
    project.attention_landline ? `Tel: ${project.attention_landline}` : null,
    project.attention_email ? `Email: ${project.attention_email}` : null,
    project.po_box ? `PO Box: ${project.po_box}` : null,
  ]
    .filter(Boolean)
    .join(" - ");
}

function baseQuotationNo(quotationNo: string | null) {
  return quotationNo?.replace(/(?:-R\d+)+$/i, "") ?? "";
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

function NewQuotationForm({
  client,
  project,
}: {
  client: Client;
  project: Project;
}) {
  return (
    <form action={createQuotation} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <input type="hidden" name="client_id" value={client.id} />
      <input type="hidden" name="project_id" value={project.id} />
      <input type="hidden" name="status" value="draft" />
      <input type="hidden" name="is_active" value="on" />
      <input type="hidden" name="return_to" value={`/clients/projects/${project.id}`} />
      <Field name="title" label="Title" required />
      <Field name="quotation_no" label="Quotation no" />
      <Field
        name="quotation_date"
        label="Quotation date"
        type="date"
        defaultValue={new Date().toISOString().slice(0, 10)}
      />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Layout Mode</span>
        <select
          name="layout_mode"
          defaultValue="standard_proposal"
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          {layoutModes.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <CurrencySelect />
      <Field name="vat_percent" label="VAT %" type="number" defaultValue={5} />
      <Field name="payment_terms" label="Payment terms" />
      <Field name="validity" label="Validity" />
      <Field name="delivery_terms" label="Delivery terms" />
      <Field name="warranty_terms" label="Warranty terms" />
      <TextArea name="notes" label="Terms / Notes" />
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
        <button
          type="submit"
          className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
        >
          Add quotation
        </button>
      </div>
    </form>
  );
}

function QuotationActionForm({
  action,
  label,
  quotationId,
  projectId,
  danger = false,
  confirm,
}: {
  action: QuotationAction;
  label: string;
  quotationId: string;
  projectId: string;
  danger?: boolean;
  confirm?: string;
}) {
  const className = `w-full rounded-md px-3 py-2 text-left text-sm font-semibold transition ${
    danger
      ? "text-red-700 hover:bg-red-50"
      : "text-zinc-700 hover:bg-zinc-50 hover:text-emerald-900"
  }`;

  return (
    <form action={action}>
      <input type="hidden" name="quotation_id" value={quotationId} />
      <input type="hidden" name="return_to" value={`/clients/projects/${projectId}`} />
      {confirm ? (
        <ConfirmSubmitButton message={confirm} className={className}>
          {label}
        </ConfirmSubmitButton>
      ) : (
        <button type="submit" className={className}>
          {label}
        </button>
      )}
    </form>
  );
}

export default async function ProjectFolderPage({ params, searchParams }: ProjectPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { user, profile, displayName } = await requireActiveUser();
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const supabase = await createSupabaseClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,client_id,project_name,project_year,project_code,location,consultant,contractor,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address,project_status,notes,is_active")
    .eq("id", id)
    .single<Project>();

  if (projectError || !project) {
    notFound();
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id,company_name,client_code,email,phone")
    .eq("id", project.client_id)
    .single<Client>();

  const { data: quotations, error: quotationsError } = await supabase
    .from("quotations")
    .select("id,quotation_no,revision_no,title,quotation_date,status,currency,grand_total,is_active")
    .eq("project_id", project.id)
    .order("quotation_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<Quotation[]>();

  if (clientError) console.error("PROJECT CLIENT READ ERROR", clientError.message);
  if (quotationsError) console.error("PROJECT QUOTATIONS LIST ERROR", quotationsError.message);

  const allQuotationList = [...(quotations ?? [])].sort((a, b) => {
    const baseCompare = baseQuotationNo(a.quotation_no).localeCompare(baseQuotationNo(b.quotation_no));
    if (baseCompare !== 0) return baseCompare;

    return (a.revision_no ?? 0) - (b.revision_no ?? 0);
  });
  const quotationList = allQuotationList.filter((quotation) => quotation.is_active);
  const archivedQuotationList = allQuotationList.filter((quotation) => !quotation.is_active);

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title={project.project_name}
          description={`${client?.company_name ?? "Unknown client"} project folder`}
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/clients"
              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Back to Clients & Projects
            </Link>
            {query?.message ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {query.message}
              </p>
            ) : null}
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-emerald-900">
                  {client?.company_name ?? "Unknown client"}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">
                  {project.project_name}
                </h1>
                <p className="mt-2 text-sm text-zinc-500">
                  {[project.project_code, project.project_year, project.location]
                    .filter(Boolean)
                    .join(" - ") || "Project folder"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge label={projectStatuses.get(project.project_status) ?? project.project_status} />
                <StatusBadge label={project.is_active ? "Active" : "Inactive"} />
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-950">Project Overview</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <InfoValue label="Client" value={client?.company_name} />
              <InfoValue label="Project year" value={project.project_year} />
              <InfoValue label="Project code" value={project.project_code} />
              <InfoValue label="Location" value={project.location} />
              <InfoValue label="Attention" value={project.attention_to} />
              <InfoValue label="Mobile" value={project.attention_mobile} />
              <InfoValue label="Landline" value={project.attention_landline} />
              <InfoValue label="Email" value={project.attention_email} />
              <InfoValue label="PO Box" value={project.po_box} />
              <InfoValue label="Consultant" value={project.consultant} />
              <InfoValue label="Contractor" value={project.contractor} />
              <InfoValue label="Client contact" value={[client?.email, client?.phone].filter(Boolean).join(" - ")} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <InfoValue label="Project address" value={project.project_address} />
              <InfoValue label="Contact line" value={projectContactLine(project)} />
            </div>
            {project.notes ? (
              <p className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                {project.notes}
              </p>
            ) : null}
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Quotations</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Revisions will appear under each quotation later.
                </p>
              </div>
              {canManageRecords ? (
                <details className="sm:min-w-[420px]">
                  <summary className="cursor-pointer rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white">
                    + New quotation for this project
                  </summary>
                  <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                    {client ? (
                      <NewQuotationForm client={client} project={project} />
                    ) : (
                      <p className="text-sm text-zinc-500">
                        Client record is required before creating a quotation.
                      </p>
                    )}
                  </div>
                </details>
              ) : null}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                    <th className="py-3 pr-4">Quotation No</th>
                    <th className="py-3 pr-4">Title</th>
                    <th className="py-3 pr-4">Date</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Final Total</th>
                    <th className="py-3 pr-4">Open summary</th>
                    <th className="py-3 pr-4">Open Builder</th>
                    {canManageRecords ? <th className="py-3">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {quotationList.map((quotation) => (
                    <tr key={quotation.id} className="border-b border-zinc-100 align-top">
                      <td className="py-3 pr-4 text-zinc-600">{quotation.quotation_no ?? "-"}</td>
                      <td className="py-3 pr-4 font-medium text-zinc-950">{quotation.title}</td>
                      <td className="py-3 pr-4 text-zinc-600">{quotation.quotation_date}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge label={quotationStatuses.get(quotation.status) ?? quotation.status} />
                      </td>
                      <td className="py-3 pr-4 font-medium text-zinc-950">
                        {formatQuotationMoney(quotation.currency, quotation.grand_total)}
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/quotations/${quotation.id}`}
                          className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                        >
                          Open summary
                        </Link>
                      </td>
                      <td className="py-3">
                        <Link
                          href={`/quotations/${quotation.id}/builder`}
                          className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                        >
                          Open Builder
                        </Link>
                      </td>
                      {canManageRecords ? (
                        <td className="py-3">
                          <details className="relative">
                            <summary className="cursor-pointer text-sm font-semibold text-emerald-900 transition hover:text-emerald-800">
                              More
                            </summary>
                            <div className="mt-2 w-56 rounded-md border border-zinc-200 bg-white p-1 shadow-sm">
                              <Link
                                href={`/quotations/${quotation.id}`}
                                className="block rounded-md px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 hover:text-emerald-900"
                              >
                                Open Summary
                              </Link>
                              <Link
                                href={`/quotations/${quotation.id}/builder`}
                                className="block rounded-md px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 hover:text-emerald-900"
                              >
                                Open Builder
                              </Link>
                              <QuotationActionForm
                                action={duplicateQuotation}
                                label="Duplicate"
                                quotationId={quotation.id}
                                projectId={project.id}
                              />
                              <QuotationActionForm
                                action={createQuotationRevision}
                                label="Create Revision"
                                quotationId={quotation.id}
                                projectId={project.id}
                              />
                              <QuotationActionForm
                                action={createQuotationOption}
                                label="Create Option"
                                quotationId={quotation.id}
                                projectId={project.id}
                              />
                              <details className="mt-1 border-t border-zinc-100 pt-1">
                                <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                                  Deactivate
                                </summary>
                                <p className="px-3 py-2 text-xs leading-5 text-zinc-500">
                                  Deactivate this quotation? This will hide it from active lists.
                                </p>
                              <QuotationActionForm
                                action={deactivateQuotation}
                                label="Move to Archive"
                                quotationId={quotation.id}
                                projectId={project.id}
                                confirm="Move this quotation to Archive? Quotation line items will not be changed."
                                danger
                              />
                              </details>
                            </div>
                          </details>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quotationList.length ? (
                <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                  No quotations are linked to this project yet.
                </p>
              ) : null}
            </div>
            {archivedQuotationList.length ? (
              <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <h3 className="font-semibold text-zinc-950">Archived Quotations</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Restore archived quotations, or permanently delete archived quotation records.
                </p>
                <div className="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
                  {archivedQuotationList.map((quotation) => (
                    <div
                      key={quotation.id}
                      className="grid gap-3 p-3 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div>
                        <p className="font-semibold text-zinc-950">
                          {quotation.quotation_no ?? "Draft quotation"} - {quotation.title}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {quotation.quotation_date} / {quotationStatuses.get(quotation.status) ?? quotation.status}
                        </p>
                      </div>
                      {canManageRecords ? (
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <div className="w-28">
                            <QuotationActionForm
                              action={restoreQuotation}
                              label="Restore"
                              quotationId={quotation.id}
                              projectId={project.id}
                            />
                          </div>
                          <div className="w-44">
                            <QuotationActionForm
                              action={permanentlyDeleteQuotation}
                              label="Delete permanently"
                              quotationId={quotation.id}
                              projectId={project.id}
                              confirm="Permanently delete this archived quotation? This will delete its sections and line items. This cannot be undone."
                              danger
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="mt-6 grid gap-5 xl:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-950">Specification Sheets</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Specification sheets will be generated from quotations later.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-950">Orders / OC / Delivery</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Orders, order confirmations, and delivery tracking will appear here later.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
