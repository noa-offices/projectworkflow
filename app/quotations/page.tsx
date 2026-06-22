import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { QuotationListLiveFilter } from "@/components/quotations/quotation-list-live-filter";
import { requireActiveUser } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createQuotation, createQuotationClient } from "./actions";

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

type SalespersonProfile = { id: string; full_name: string | null; email: string | null };

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
  salesperson_id: string | null;
  layout_settings: Record<string, unknown> | null;
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

function ClientSelect({ clients, selectedClientId }: { clients: Client[]; selectedClientId?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
      <select
        name="client_id"
        required
        defaultValue={selectedClientId ?? ""}
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

function CreateClientPanel() {
  return (
    <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3 md:col-span-2 xl:col-span-3">
      <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
        Create new client
      </summary>
      <form action={createQuotationClient} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <input type="hidden" name="return_to" value="/sales/quotations" />
        <Field name="company_name" label="Client / Company Name" required />
        <Field name="contact_person" label="Contact Person" />
        <Field name="phone" label="Phone / Mobile" />
        <Field name="email" label="Email" type="email" />
        <Field name="address" label="Address / Location" />
        <Field name="city" label="City" />
        <Field name="country" label="Country" defaultValue="UAE" />
        <TextArea name="notes" label="Notes" />
        <div className="flex justify-end md:col-span-2 xl:col-span-3">
          <PendingSubmitButton
            className="h-10 rounded-md border border-emerald-900 px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400"
            pendingLabel="Creating client..."
          >
            Create and select client
          </PendingSubmitButton>
        </div>
      </form>
    </details>
  );
}

function SalespersonSelect({
  profiles,
  currentUserId,
}: {
  profiles: SalespersonProfile[];
  currentUserId: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">Sales Person</span>
      <select
        name="salesperson_id"
        defaultValue={currentUserId}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">— Unassigned —</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name ?? p.email ?? p.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuotationForm({
  clients,
  selectedClientId,
  salespersonProfiles,
  currentUserId,
}: {
  clients: Client[];
  selectedClientId?: string;
  salespersonProfiles: SalespersonProfile[];
  currentUserId: string;
}) {
  return (
    <form action={createQuotation} data-quotation-create-form className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <input type="hidden" name="return_to" value="/sales/quotations" />
      <input type="hidden" name="project_id" value="" />
      <ClientSelect clients={clients} selectedClientId={selectedClientId} />
      <SalespersonSelect profiles={salespersonProfiles} currentUserId={currentUserId} />
      <Field name="legacy_reference" label="Reference / Project Name" required />
      <Field name="title" label="Title" required />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Quotation No.</span>
        <input
          value="Generated automatically"
          readOnly
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 outline-none"
        />
      </label>
      <Field name="contact_name" label="Attention / Contact" />
      <Field name="contact_phone" label="Phone / Mobile" />
      <Field name="contact_email" label="Email" type="email" />
      <Field name="telephone" label="Telephone" />
      <Field name="po_box" label="PO Box" />
      <Field name="location" label="Location" />
      <TextArea name="project_address" label="Project Address" />
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
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const canDeleteFolders =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  const supabase = await createSupabaseClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id,company_name")
    .order("company_name", { ascending: true })
    .returns<Client[]>();

  const adminResult = createAdminClient();
  if (!adminResult.client) throw new Error(adminResult.error ?? "Admin client unavailable");
  const { data: salespersonProfiles } = await adminResult.client
    .from("profiles")
    .select("id,full_name,email")
    .eq("role", "sales_designer")
    .eq("account_status", "active")
    .order("full_name", { ascending: true })
    .returns<SalespersonProfile[]>();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id,client_id,project_name,project_number,project_code,project_year")
    .order("project_name", { ascending: true })
    .returns<Project[]>();

  const { data: quotations, error: quotationsError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,legacy_reference,quotation_no,title,quotation_date,status,layout_mode,currency,grand_total,is_active,salesperson_id,layout_settings")
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
      description="Create quotations directly from client enquiries, then build revisions, options, and Project Files."
      role={profile?.role ?? null}
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
          canDeleteFolders={canDeleteFolders}
          canManageRecords={canManageRecords}
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
          salespersonProfiles={salespersonProfiles ?? []}
        >
          {canManageRecords ? (
            <details open={!quotationList.length || Boolean(selectedClientId)} className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer text-lg font-semibold text-zinc-950">
                Create new quotation
              </summary>
              <p className="mt-1 text-sm text-zinc-500">
                Start with a client and document details. Project File creation happens after the quotation is Client Approved.
              </p>
              <div className="mt-5">
                <div className="grid gap-4">
                  <CreateClientPanel />
                  <QuotationForm
                    clients={clientList}
                    selectedClientId={selectedClientId}
                    salespersonProfiles={salespersonProfiles ?? []}
                    currentUserId={user.id}
                  />
                </div>
              </div>
            </details>
          ) : null}
        </QuotationListLiveFilter>
      </div>
    </ErpAppShell>
  );
}
