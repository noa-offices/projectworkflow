import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { OpportunityQuotationPrefill } from "@/components/quotations/opportunity-quotation-prefill";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { QuotationListLiveFilter } from "@/components/quotations/quotation-list-live-filter";
import { ProjectSelectByClient } from "@/components/quotations/project-select-by-client";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createQuotation } from "./actions";

export const dynamic = "force-dynamic";

type QuotationsPageProps = {
  searchParams?: Promise<{
    client?: string;
    fromOpportunity?: string;
    message?: string;
    project?: string;
    q?: string;
    status?: string;
    year?: string;
  }>;
};

type Client = { id: string; company_name: string };

type Project = {
  id: string;
  client_id: string;
  project_name: string;
  project_number: string | null;
  project_code: string | null;
  project_year: number | null;
};

type Quotation = {
  id: string;
  client_id: string;
  project_id: string | null;
  legacy_reference: string | null;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
  status: string;
  layout_mode: string;
  currency: string;
  grand_total: number;
  is_active: boolean;
};

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
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
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

function ClientSelect({ clients }: { clients: Client[] }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
      <select
        name="client_id"
        required
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">Select client</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.company_name}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuotationForm({
  clients,
  fromOpportunity,
  fromOpportunityId,
  projects,
}: {
  clients: Client[];
  fromOpportunity: boolean;
  fromOpportunityId: string;
  projects: Project[];
}) {
  return (
    <form action={createQuotation} data-quotation-create-form className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {fromOpportunity ? (
        <>
          <ClientSelect clients={clients} />
          <Field name="legacy_reference" label="Project / Reference Name" required />
          <input type="hidden" name="from_opportunity" value="1" />
          <input type="hidden" name="from_opportunity_id" value={fromOpportunityId} />
          <input type="hidden" name="from_opportunity_no" value="" />
          <input type="hidden" name="project_id" value="" />
        </>
      ) : (
        <ProjectSelectByClient clients={clients} projects={projects} />
      )}
      <Field name="title" label="Title" required />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Project / Quote No.</span>
        <input
          value={fromOpportunity ? "Confirmed Order / Project will be created only after the client approves this quotation" : "Generated automatically from the selected project"}
          readOnly
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 outline-none"
        />
      </label>
      <Field name="quotation_date" label="Quotation date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
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
      <TextArea name="notes" label="Notes" />
      <input type="hidden" name="status" value="draft" />
      <input type="hidden" name="is_active" value="on" />
      {fromOpportunity ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 md:col-span-2 xl:col-span-3">
          This quotation will use the opportunity reference. Confirmed Order / Project will be created only after the client approves this quotation.
        </p>
      ) : null}
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
        <PendingSubmitButton
          className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          pendingLabel="Creating quotation..."
        >
          Add quotation
        </PendingSubmitButton>
      </div>
    </form>
  );
}

export default async function QuotationsPage({ searchParams }: QuotationsPageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const resolvedSearchParams = await searchParams;
  const message = resolvedSearchParams?.message;
  const query = resolvedSearchParams?.q?.trim() ?? "";
  const selectedStatus = resolvedSearchParams?.status ?? "";
  const selectedClientId = resolvedSearchParams?.client ?? "";
  const selectedProjectId = resolvedSearchParams?.project ?? "";
  const selectedYear = resolvedSearchParams?.year ?? "";
  const fromOpportunity = Boolean(resolvedSearchParams?.fromOpportunity?.trim());
  const fromOpportunityId = resolvedSearchParams?.fromOpportunity?.trim() ?? "";
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const supabase = await createSupabaseClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id,company_name")
    .order("company_name", { ascending: true })
    .returns<Client[]>();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id,client_id,project_name,project_number,project_code,project_year")
    .order("project_name", { ascending: true })
    .returns<Project[]>();

  const { data: quotations, error: quotationsError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,legacy_reference,quotation_no,title,quotation_date,status,layout_mode,currency,grand_total,is_active")
    .order("created_at", { ascending: false })
    .returns<Quotation[]>();

  if (clientsError) console.error("QUOTATION CLIENTS LIST ERROR", clientsError.message);
  if (projectsError) console.error("QUOTATION PROJECTS LIST ERROR", projectsError.message);
  if (quotationsError) console.error("QUOTATIONS LIST ERROR", quotationsError.message);

  const clientList = clients ?? [];
  const projectList = projects ?? [];
  const quotationList = quotations ?? [];
  const projectYears = Array.from(
    new Set([
      ...projectList.map((project) => project.project_year).filter((year): year is number => year !== null),
      ...quotationList
        .filter((quotation) => !quotation.project_id)
        .map((quotation) => new Date(quotation.quotation_date).getFullYear())
        .filter((year) => Number.isFinite(year)),
    ]),
  ).sort((a, b) => b - a);

  return (
    <ErpAppShell
      title="Quotations"
      description="Quotation folders across opportunities, clients, revisions, and options."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-500">
            Open a folder to review numbers, documents, revisions, options, and builder actions.
          </p>
          {message ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              {message}
            </p>
          ) : null}
        </div>

        <QuotationListLiveFilter
          clients={clientList}
          initialFilters={{
            client: selectedClientId,
            project: selectedProjectId,
            q: query,
            status: selectedStatus,
            year: selectedYear,
          }}
          projectYears={projectYears}
          projects={projectList}
          quotations={quotationList}
        >
          {canManageRecords ? (
            <details open={fromOpportunity || !quotationList.length} className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer text-lg font-semibold text-zinc-950">
                Create new quotation
              </summary>
              <p className="mt-1 text-sm text-zinc-500">
                {fromOpportunity
                  ? "Start from the confirmed client and opportunity reference. Confirmed Order / Project creation happens only after the client approves the submitted quotation."
                  : "Start with a client and project, then add sections and custom lines."}
              </p>
              <div className="mt-5">
                <OpportunityQuotationPrefill clients={clientList} projects={projectList} />
                          <QuotationForm
                            clients={clientList}
                            fromOpportunity={fromOpportunity}
                            fromOpportunityId={fromOpportunityId}
                            projects={projectList}
                          />
              </div>
            </details>
          ) : null}
        </QuotationListLiveFilter>
      </div>
    </ErpAppShell>
  );
}
