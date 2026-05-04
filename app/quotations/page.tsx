import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, formatMoney, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createQuotation } from "./actions";

export const dynamic = "force-dynamic";

type QuotationsPageProps = {
  searchParams?: Promise<{
    client?: string;
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
  project_code: string | null;
  project_year: number | null;
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
  grand_total: number;
  is_active: boolean;
};

const quotationStatuses = [
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["revised", "Revised"],
  ["approved", "Approved"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["cancelled", "Cancelled"],
] as const;

const quotationStatusLabels = new Map<string, string>(quotationStatuses);

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

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600">
      {quotationStatusLabels.get(status) ?? status}
    </span>
  );
}

function matchesSearch(values: Array<string | number | null | undefined>, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
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

function QuotationForm({ clients, projects }: { clients: Client[]; projects: Project[] }) {
  const clientMap = new Map(clients.map((client) => [client.id, client.company_name]));

  return (
    <form action={createQuotation} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Project</span>
        <select
          name="project_id"
          required
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">Select project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {clientMap.get(project.client_id) ?? "Unknown client"} - {project.project_name}
            </option>
          ))}
        </select>
      </label>
      <Field name="title" label="Title" required />
      <Field name="quotation_no" label="Quotation no" />
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
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
        <button type="submit" className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">
          Add quotation
        </button>
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
    .select("id,client_id,project_name,project_code,project_year")
    .order("project_name", { ascending: true })
    .returns<Project[]>();

  const { data: quotations, error: quotationsError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,title,quotation_date,status,layout_mode,currency,grand_total,is_active")
    .order("created_at", { ascending: false })
    .returns<Quotation[]>();

  if (clientsError) console.error("QUOTATION CLIENTS LIST ERROR", clientsError.message);
  if (projectsError) console.error("QUOTATION PROJECTS LIST ERROR", projectsError.message);
  if (quotationsError) console.error("QUOTATIONS LIST ERROR", quotationsError.message);

  const clientList = clients ?? [];
  const projectList = projects ?? [];
  const quotationList = quotations ?? [];
  const clientMap = new Map(clientList.map((client) => [client.id, client.company_name]));
  const projectMap = new Map(projectList.map((project) => [project.id, project]));
  const projectYears = Array.from(
    new Set(projectList.map((project) => project.project_year).filter((year): year is number => year !== null)),
  ).sort((a, b) => b - a);

  const filteredQuotations = quotationList.filter((quotation) => {
    const project = projectMap.get(quotation.project_id);
    const clientName = clientMap.get(quotation.client_id);

    return (
      (!selectedStatus || quotation.status === selectedStatus) &&
      (!selectedClientId || quotation.client_id === selectedClientId) &&
      (!selectedProjectId || quotation.project_id === selectedProjectId) &&
      (!selectedYear || String(project?.project_year ?? "") === selectedYear) &&
      matchesSearch(
        [
          quotation.quotation_no,
          quotation.title,
          clientName,
          project?.project_name,
          project?.project_code,
          project?.project_year,
        ],
        query,
      )
    );
  });

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Quotations"
          description="All quotations across projects. Project folders are the main workflow."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              Use this as a global search page. Project-specific quotation work now lives inside each project folder.
            </p>
            {message ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {message}
              </p>
            ) : null}
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <form method="get" className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto_auto]">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search quotation no, title, client, project..."
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Status</span>
                <select name="status" defaultValue={selectedStatus} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="">All statuses</option>
                  {quotationStatuses.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
                <select name="client" defaultValue={selectedClientId} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="">All clients</option>
                  {clientList.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.company_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Project</span>
                <select name="project" defaultValue={selectedProjectId} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="">All projects</option>
                  {projectList.map((project) => (
                    <option key={project.id} value={project.id}>
                      {clientMap.get(project.client_id) ?? "Unknown client"} - {project.project_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Year</span>
                <select name="year" defaultValue={selectedYear} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="">All years</option>
                  {projectYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button type="submit" className="h-10 w-full rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">
                  Apply
                </button>
              </div>
              <div className="flex items-end">
                <Link href="/quotations" className="flex h-10 w-full items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 transition hover:border-emerald-900/25 hover:text-emerald-900">
                  Reset filters
                </Link>
              </div>
            </form>
          </section>

          {canManageRecords ? (
            <details open={!quotationList.length} className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer text-lg font-semibold text-zinc-950">
                Create new quotation
              </summary>
              <p className="mt-1 text-sm text-zinc-500">
                Start with a client and project, then add sections and custom lines.
              </p>
              <div className="mt-5">
                <QuotationForm clients={clientList} projects={projectList} />
              </div>
            </details>
          ) : null}

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-950">Quotation list</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                    <th className="py-3 pr-4">Quotation No</th>
                    <th className="py-3 pr-4">Title</th>
                    <th className="py-3 pr-4">Client</th>
                    <th className="py-3 pr-4">Project</th>
                    <th className="py-3 pr-4">Year</th>
                    <th className="py-3 pr-4">Date</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Grand Total</th>
                    <th className="py-3">Open/Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuotations.map((quotation) => {
                    const project = projectMap.get(quotation.project_id);

                    return (
                      <tr key={quotation.id} className="border-b border-zinc-100 align-top">
                        <td className="py-3 pr-4 text-zinc-600">{quotation.quotation_no ?? "-"}</td>
                        <td className="py-3 pr-4 font-medium text-zinc-950">{quotation.title}</td>
                        <td className="py-3 pr-4 text-zinc-600">{clientMap.get(quotation.client_id) ?? "Unknown client"}</td>
                        <td className="py-3 pr-4 text-zinc-600">{project?.project_name ?? "Unknown project"}</td>
                        <td className="py-3 pr-4 text-zinc-600">{project?.project_year ?? "No year"}</td>
                        <td className="py-3 pr-4 text-zinc-600">{quotation.quotation_date}</td>
                        <td className="py-3 pr-4"><StatusBadge status={quotation.status} /></td>
                        <td className="py-3 pr-4 font-medium text-zinc-950">{formatMoney(quotation.currency, quotation.grand_total)}</td>
                        <td className="py-3">
                          <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800">
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredQuotations.length ? (
                <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                  No quotations match filters.
                </p>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
