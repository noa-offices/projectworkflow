import Link from "next/link";
import { DeleteProjectWithQuotationsDialog } from "@/components/clients/delete-project-with-quotations-dialog";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { TopBar } from "@/components/top-bar";
import { loadProjectQuotationDependencyCounts } from "@/lib/clients/project-dependencies";
import { requireActiveUser } from "@/lib/auth";
import { formatQuotationDisplayNo, quotationRootBaseNo } from "@/lib/quotation-options";
import {
  quotationStatusBadgeClassName,
  quotationStatusLabel,
} from "@/lib/quotation-status";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  createClient as createClientRecord,
  createProject,
  deactivateClient,
  deactivateProject,
  permanentlyDeleteClient,
  permanentlyDeleteProject,
  restoreClient,
  restoreProject,
  updateClient,
  updateProject,
} from "./actions";

export const dynamic = "force-dynamic";

type ClientsPageProps = {
  searchParams?: Promise<{
    active?: string;
    addClient?: string;
    addProject?: string;
    client?: string;
    message?: string;
    messageType?: string;
    project?: string;
    q?: string;
    status?: string;
    tab?: string;
    year?: string;
  }>;
};

type Client = {
  id: string;
  company_name: string;
  client_number: string | null;
  client_code: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string;
  trn: string | null;
  notes: string | null;
  is_active: boolean;
};

type Project = {
  id: string;
  client_id: string;
  project_number: string | null;
  project_sequence: number | null;
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
  created_at: string;
};

type ProjectQuotation = {
  id: string;
  project_id: string;
  quotation_no: string | null;
  option_no: number | null;
  revision_no: number | null;
  status: string;
  title: string;
  quotation_date: string | null;
  created_at: string;
  is_active: boolean;
};

type ArchivedProjectDependencyState = {
  linkedQuotationCount: number | null;
  error: string | null;
};

const projectStatusOptions = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const projectStatusLabels = new Map(
  projectStatusOptions.map((status) => [status.value, status.label]),
);

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-zinc-200 bg-zinc-100 text-zinc-600"
      }`}
    >
      {active ? "active" : "inactive"}
    </span>
  );
}

function ProjectStatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-600">
      {projectStatusLabels.get(status) ?? status}
    </span>
  );
}

function QuotationStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${quotationStatusBadgeClassName(status)}`}
    >
      {quotationStatusLabel(status)}
    </span>
  );
}

function matchesSearch(values: Array<string | null | undefined>, query: string) {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

type ClientsSearchParams = NonNullable<Awaited<ClientsPageProps["searchParams"]>>;

function clientsHref(
  params: ClientsSearchParams,
  updates: Partial<
    Record<
      | "active"
      | "addClient"
      | "addProject"
      | "client"
      | "project"
      | "q"
      | "status"
      | "tab"
      | "year",
      string | null
    >
  >,
) {
  const next = new URLSearchParams();

  for (const key of [
    "active",
    "addClient",
    "addProject",
    "client",
    "project",
    "q",
    "status",
    "tab",
    "year",
  ] as const) {
    const value = updates[key] === undefined ? params[key] : updates[key];

    if (value) {
      next.set(key, value);
    }
  }

  const query = next.toString();
  return `/clients${query ? `?${query}` : ""}`;
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

function quoteNoLabel(quotation?: ProjectQuotation) {
  if (!quotation) {
    return "-";
  }

  return quotation.quotation_no || quotation.title;
}

// TODO: Future phase: auto-generate project numbers by year/company sequence.
function projectNoLabel(project: Project) {
  return project.project_number ?? project.project_code ?? "-";
}

function TextInput({
  name,
  label,
  defaultValue,
  placeholder,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
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
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
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

function ActiveToggle({ defaultChecked = true }: { defaultChecked?: boolean }) {
  return (
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700">
      <input
        name="is_active"
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-zinc-300 text-emerald-900"
      />
      Active
    </label>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel?: string }) {
  return (
    <PendingSubmitButton
      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
      pendingLabel={pendingLabel}
    >
      {label}
    </PendingSubmitButton>
  );
}

function ClientForm({ client }: { client?: Client }) {
  return (
    <form
      action={client ? updateClient : createClientRecord}
      className="grid gap-3 md:grid-cols-2"
    >
      {client ? <input type="hidden" name="id" value={client.id} /> : null}
      <TextInput
        name="company_name"
        label="Company name"
        defaultValue={client?.company_name}
        required
      />
      <TextInput
        name="client_code"
        label="Legacy client code"
        defaultValue={client?.client_code}
      />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">
          Client No.
        </span>
        <input
          value={client?.client_number ?? "Generated automatically after save"}
          readOnly
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 outline-none"
        />
      </label>
      <TextInput
        name="contact_person"
        label="Contact person"
        defaultValue={client?.contact_person}
      />
      <TextInput name="email" label="Email" type="email" defaultValue={client?.email} />
      <TextInput name="phone" label="Phone" defaultValue={client?.phone} />
      <TextInput name="website" label="Website" defaultValue={client?.website} />
      <TextInput name="address" label="Address" defaultValue={client?.address} />
      <TextInput name="city" label="City" defaultValue={client?.city} />
      <TextInput name="country" label="Country" defaultValue={client?.country ?? "UAE"} />
      <TextInput name="trn" label="TRN" defaultValue={client?.trn} />
      <div className="flex items-end">
        <ActiveToggle defaultChecked={client?.is_active ?? true} />
      </div>
      <TextArea name="notes" label="Notes" defaultValue={client?.notes} />
      <div className="flex justify-end md:col-span-2">
        <SubmitButton
          label={client ? "Save client" : "Add client"}
          pendingLabel={client ? "Saving client..." : "Creating client..."}
        />
      </div>
    </form>
  );
}

function ProjectStatusSelect({ defaultValue = "active" }: { defaultValue?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        Project status
      </span>
      <select
        name="project_status"
        defaultValue={defaultValue}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        {projectStatusOptions.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ClientSelect({
  clients,
  defaultValue,
}: {
  clients: Client[];
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        Client
      </span>
      <select
        name="client_id"
        defaultValue={defaultValue ?? ""}
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

function ProjectForm({
  clientId,
  clients,
  project,
}: {
  clientId?: string;
  clients?: Client[];
  project?: Project;
}) {
  return (
    <form
      action={project ? updateProject : createProject}
      className="grid gap-3 md:grid-cols-2"
    >
      {project ? <input type="hidden" name="id" value={project.id} /> : null}
      {clientId ? (
        <input type="hidden" name="client_id" value={clientId} />
      ) : (
        <ClientSelect clients={clients ?? []} defaultValue={project?.client_id} />
      )}
      <TextInput
        name="project_name"
        label="Project name"
        defaultValue={project?.project_name}
        required
      />
      <TextInput
        name="project_year"
        label="Project Year"
        type="number"
        placeholder="2026"
        defaultValue={
          project?.project_year ? String(project.project_year) : undefined
        }
      />
      <TextInput
        name="project_code"
        label="Legacy project code"
        defaultValue={project?.project_code}
      />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">
          Project / Quote No.
        </span>
        <input
          value={project?.project_number ?? "Generated automatically after save"}
          readOnly
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-500 outline-none"
        />
      </label>
      <TextInput name="location" label="Location" defaultValue={project?.location} />
      <TextInput
        name="consultant"
        label="Consultant"
        defaultValue={project?.consultant}
      />
      <TextInput
        name="contractor"
        label="Contractor"
        defaultValue={project?.contractor}
      />
      <TextInput
        name="attention_to"
        label="Attention to"
        defaultValue={project?.attention_to}
      />
      <TextInput
        name="attention_mobile"
        label="Attention Mobile"
        defaultValue={project?.attention_mobile}
      />
      <TextInput
        name="attention_landline"
        label="Attention Landline / Tel"
        defaultValue={project?.attention_landline}
      />
      <TextInput
        name="attention_email"
        label="Attention Email"
        type="email"
        defaultValue={project?.attention_email}
      />
      <TextInput
        name="po_box"
        label="Project PO Box"
        defaultValue={project?.po_box}
      />
      <ProjectStatusSelect defaultValue={project?.project_status ?? "active"} />
      <div className="flex items-end">
        <ActiveToggle defaultChecked={project?.is_active ?? true} />
      </div>
      <TextArea
        name="project_address"
        label="Project Address"
        defaultValue={project?.project_address}
      />
      <TextArea name="notes" label="Notes" defaultValue={project?.notes} />
      <div className="flex justify-end md:col-span-2">
        <SubmitButton
          label={project ? "Save project" : "Add project"}
          pendingLabel={project ? "Saving project..." : "Creating project..."}
        />
      </div>
    </form>
  );
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const resolvedSearchParams = await searchParams;
  const pageParams = resolvedSearchParams ?? {};
  const message = resolvedSearchParams?.message;
  const messageType =
    resolvedSearchParams?.messageType === "error"
      ? "error"
      : resolvedSearchParams?.messageType === "warning"
        ? "warning"
        : "success";
  const query = resolvedSearchParams?.q?.trim() ?? "";
  const selectedStatus = resolvedSearchParams?.status ?? "";
  const selectedClientId = resolvedSearchParams?.client ?? "";
  const selectedActive = resolvedSearchParams?.active ?? "";
  const selectedYear = resolvedSearchParams?.year ?? "";
  const selectedProjectId = resolvedSearchParams?.project ?? "";
  const activeTab =
    resolvedSearchParams?.tab === "clients"
      ? "clients"
      : resolvedSearchParams?.tab === "archive"
        ? "archive"
        : "projects";
  const showAddClient = resolvedSearchParams?.addClient === "1";
  const showAddProject = resolvedSearchParams?.addProject === "1";
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const supabase = await createSupabaseClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select(
      "id,company_name,client_number,client_code,contact_person,email,phone,website,address,city,country,trn,notes,is_active",
    )
    .order("company_name", { ascending: true })
    .returns<Client[]>();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select(
      "id,client_id,project_name,project_number,project_sequence,project_year,project_code,location,consultant,contractor,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address,project_status,notes,is_active,created_at",
    )
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  const { data: quotations, error: quotationsError } = await supabase
    .from("quotations")
    .select("id,project_id,quotation_no,option_no,revision_no,status,title,quotation_date,created_at,is_active")
    .order("quotation_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ProjectQuotation[]>();

  if (clientsError) {
    console.error("CLIENTS LIST ERROR", clientsError.message);
  }

  if (projectsError) {
    console.error("PROJECTS LIST ERROR", projectsError.message);
  }

  if (quotationsError) {
    console.error("CLIENTS PROJECT QUOTATIONS LIST ERROR", quotationsError.message);
  }

  const clientList = clients ?? [];
  const projectList = projects ?? [];
  const activeClientList = clientList.filter((client) => client.is_active);
  const archivedClientList = clientList.filter((client) => !client.is_active);
  const activeProjectList = projectList.filter((project) => project.is_active);
  const archivedProjectList = projectList.filter((project) => !project.is_active);
  const quotationList = quotations ?? [];
  const clientNameById = new Map(
    clientList.map((client) => [client.id, client.company_name]),
  );
  const activeQuotationList = quotationList.filter((quotation) => quotation.is_active);
  const quotationsByProject = new Map<string, ProjectQuotation[]>();
  const allQuotationsByProject = new Map<string, ProjectQuotation[]>();

  for (const quotation of quotationList) {
    const allProjectQuotations = allQuotationsByProject.get(quotation.project_id) ?? [];
    allProjectQuotations.push(quotation);
    allQuotationsByProject.set(quotation.project_id, allProjectQuotations);
  }

  for (const quotation of activeQuotationList) {
    const projectQuotations = quotationsByProject.get(quotation.project_id) ?? [];
    projectQuotations.push(quotation);
    quotationsByProject.set(quotation.project_id, projectQuotations);
  }
  const optionCountByProjectRoot = new Map<string, number>();
  for (const quotation of activeQuotationList) {
    const rootBase = quotationRootBaseNo(quotation.quotation_no);
    if (!rootBase) continue;

    const projectRootKey = `${quotation.project_id}:${rootBase}`;
    optionCountByProjectRoot.set(
      projectRootKey,
      Math.max(optionCountByProjectRoot.get(projectRootKey) ?? 0, quotation.option_no ?? 1),
    );
  }
  const projectYears = Array.from(
    new Set(
      activeProjectList
        .map((project) => project.project_year)
        .filter((year): year is number => year !== null),
    ),
  ).sort((a, b) => b - a);
  const activeMatches = (active: boolean) => {
    if (selectedActive === "true") {
      return active;
    }

    if (selectedActive === "false") {
      return !active;
    }

    return true;
  };

  const archivedProjectDependencyById = new Map<string, ArchivedProjectDependencyState>();
  const archivedProjectIds = archivedProjectList.map((project) => project.id);

  if (canManageRecords && archivedProjectIds.length) {
    const dependencyResult = await loadProjectQuotationDependencyCounts(archivedProjectIds);

    if (dependencyResult.error) {
      archivedProjectIds.forEach((projectId) => {
        archivedProjectDependencyById.set(projectId, {
          linkedQuotationCount: null,
          error: dependencyResult.error,
        });
      });
    } else {
      archivedProjectIds.forEach((projectId) => {
        archivedProjectDependencyById.set(projectId, {
          linkedQuotationCount: dependencyResult.countsByProjectId.get(projectId) ?? 0,
          error: null,
        });
      });
    }
  }

  const filteredProjects = activeProjectList.filter((project) => {
    const clientName = clientNameById.get(project.client_id);

    return (
      (!selectedStatus || project.project_status === selectedStatus) &&
      (!selectedClientId || project.client_id === selectedClientId) &&
      (!selectedYear || String(project.project_year ?? "") === selectedYear) &&
      activeMatches(project.is_active) &&
      matchesSearch(
        [
          project.project_name,
          project.project_number,
          project.project_year ? String(project.project_year) : null,
          project.project_code,
          project.location,
          project.attention_to,
          project.attention_mobile,
          project.attention_landline,
          project.attention_email,
          project.po_box,
          project.project_address,
          project.consultant,
          project.contractor,
          project.notes,
          clientName,
        ],
        query,
      )
    );
  });

  const filteredProjectIdsByClient = new Map<string, Project[]>();

  for (const project of filteredProjects) {
    const clientProjects = filteredProjectIdsByClient.get(project.client_id) ?? [];
    clientProjects.push(project);
    filteredProjectIdsByClient.set(project.client_id, clientProjects);
  }

  const filteredClients = activeClientList.filter((client) => {
    const clientProjects = activeProjectList.filter((project) => project.client_id === client.id);
    const hasMatchingStatus =
      !selectedStatus ||
      clientProjects.some((project) => project.project_status === selectedStatus);
    const hasMatchingYear =
      !selectedYear ||
      clientProjects.some(
        (project) => String(project.project_year ?? "") === selectedYear,
      );
    const hasSearchMatch =
      matchesSearch(
        [
          client.company_name,
          client.client_code,
          client.client_number,
          client.contact_person,
          client.email,
          client.phone,
          client.city,
          client.country,
          client.notes,
        ],
        query,
      ) || (filteredProjectIdsByClient.get(client.id)?.length ?? 0) > 0;

    return (
      (!selectedClientId || client.id === selectedClientId) &&
      activeMatches(client.is_active) &&
      hasMatchingStatus &&
      hasMatchingYear &&
      hasSearchMatch
    );
  });

  const allProjectsByClient = new Map<string, Project[]>();
  for (const project of activeProjectList) {
    const clientProjects = allProjectsByClient.get(project.client_id) ?? [];
    clientProjects.push(project);
    allProjectsByClient.set(project.client_id, clientProjects);
  }
  const selectedProject = selectedProjectId
    ? activeProjectList.find((project) => project.id === selectedProjectId) ?? null
    : null;
  const selectedProjectQuotations = selectedProject
    ? quotationsByProject.get(selectedProject.id) ?? []
    : [];
  const selectedClient = selectedClientId
    ? activeClientList.find((client) => client.id === selectedClientId) ?? null
    : null;

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Clients & Projects"
          description="Manage client profiles, project details, and contact references."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              Coming next: quotations will be linked to projects.
            </p>
            {message ? (
              <p
                className={`rounded-md border px-3 py-2 text-sm ${
                  messageType === "error"
                    ? "border-red-200 bg-red-50 text-red-900"
                    : messageType === "warning"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-950"
                }`}
              >
                {message}
              </p>
            ) : null}
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <form
              method="get"
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto_auto]"
            >
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Search
                </span>
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Search clients, projects, codes, locations..."
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Status
                </span>
                <select
                  name="status"
                  defaultValue={selectedStatus}
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All statuses</option>
                  {projectStatusOptions.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Client
                </span>
                <select
                  name="client"
                  defaultValue={selectedClientId}
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All clients</option>
                  {clientList.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.company_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Year
                </span>
                <select
                  name="year"
                  defaultValue={selectedYear}
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All years</option>
                  {projectYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Active
                </span>
                <select
                  name="active"
                  defaultValue={selectedActive}
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All</option>
                  <option value="true">Active only</option>
                  <option value="false">Inactive only</option>
                </select>
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="h-10 w-full rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                  Apply
                </button>
              </div>
              <div className="flex items-end">
                <Link
                  href="/clients"
                  className="flex h-10 w-full items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 transition hover:border-emerald-900/25 hover:text-emerald-900"
                >
                  Reset filters
                </Link>
              </div>
            </form>
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 p-1">
                <Link
                  href={clientsHref(pageParams, {
                    tab: "projects",
                    addClient: null,
                    client: null,
                  })}
                  className={`rounded px-4 py-2 text-sm font-semibold ${
                    activeTab === "projects"
                      ? "bg-white text-emerald-900 shadow-sm"
                      : "text-zinc-600"
                  }`}
                >
                  Projects
                </Link>
                <Link
                  href={clientsHref(pageParams, {
                    tab: "clients",
                    addProject: null,
                    project: null,
                  })}
                  className={`rounded px-4 py-2 text-sm font-semibold ${
                    activeTab === "clients"
                      ? "bg-white text-emerald-900 shadow-sm"
                      : "text-zinc-600"
                  }`}
                >
                  Clients
                </Link>
                <Link
                  href={clientsHref(pageParams, {
                    tab: "archive",
                    addClient: null,
                    addProject: null,
                    client: null,
                    project: null,
                  })}
                  className={`rounded px-4 py-2 text-sm font-semibold ${
                    activeTab === "archive"
                      ? "bg-white text-emerald-900 shadow-sm"
                      : "text-zinc-600"
                  }`}
                >
                  Archive
                </Link>
              </div>

              {canManageRecords ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={clientsHref(pageParams, {
                      addProject: "1",
                      addClient: null,
                      tab: "projects",
                    })}
                    className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  >
                    + Add Project
                  </Link>
                  <Link
                    href={clientsHref(pageParams, {
                      addClient: "1",
                      addProject: null,
                      tab: "clients",
                    })}
                    className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    + Add Client
                  </Link>
                </div>
              ) : null}
            </div>

            {canManageRecords && showAddProject ? (
              <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-zinc-950">Add project</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Link the project to an existing client.
                    </p>
                  </div>
                  <Link
                    href={clientsHref(pageParams, { addProject: null })}
                    className="text-sm font-semibold text-zinc-500 transition hover:text-zinc-950"
                  >
                    Cancel
                  </Link>
                </div>
                {clientList.length ? (
                  <ProjectForm clients={clientList} />
                ) : (
                  <p className="rounded-md border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                    Create a client before adding a project.
                  </p>
                )}
              </div>
            ) : null}

            {canManageRecords && showAddClient ? (
              <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-zinc-950">Add client</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Create a client record for projects and quotations.
                    </p>
                  </div>
                  <Link
                    href={clientsHref(pageParams, { addClient: null })}
                    className="text-sm font-semibold text-zinc-500 transition hover:text-zinc-950"
                  >
                    Cancel
                  </Link>
                </div>
                <ClientForm />
              </div>
            ) : null}
          </section>

          {activeTab === "projects" ? (
            <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 p-4">
                  <h2 className="font-semibold text-zinc-950">Projects</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    {filteredProjects.length} of {activeProjectList.length} projects shown
                  </p>
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Project No.</th>
                        <th className="px-4 py-3 font-semibold">Project Name</th>
                        <th className="px-4 py-3 font-semibold">Client</th>
                        <th className="px-4 py-3 font-semibold">Year</th>
                        <th className="px-4 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredProjects.map((project) => {
                        return (
                          <tr
                            key={project.id}
                            className={project.id === selectedProject?.id ? "bg-emerald-50/60" : ""}
                          >
                            <td className="px-4 py-3 text-zinc-600">
                              <span className="font-medium text-zinc-800">
                                {projectNoLabel(project)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-zinc-950">
                              {project.project_name}
                            </td>
                            <td className="px-4 py-3 text-zinc-600">
                              {clientNameById.get(project.client_id) ?? "Unknown client"}
                            </td>
                            <td className="px-4 py-3 text-zinc-600">
                              {project.project_year ?? "-"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <Link
                                  href={clientsHref(pageParams, {
                                    tab: "projects",
                                    project: project.id,
                                    client: null,
                                    addProject: null,
                                  })}
                                  className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                                >
                                  Open
                                </Link>
                                {canManageRecords ? (
                                  <>
                                    <Link
                                      href={clientsHref(pageParams, {
                                        tab: "projects",
                                        project: project.id,
                                        addProject: null,
                                      })}
                                      className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                                    >
                                      Edit
                                    </Link>
                                    <form action={deactivateProject}>
                                      <input type="hidden" name="id" value={project.id} />
                                      <ConfirmSubmitButton
                                        message="Move this project to Archive? Linked quotations will not be deleted."
                                        className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                                      >
                                        Delete
                                      </ConfirmSubmitButton>
                                    </form>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 p-4 md:hidden">
                  {filteredProjects.map((project) => {
                    return (
                      <article key={project.id} className="rounded-md border border-zinc-200 p-3">
                        <p className="text-xs font-semibold uppercase text-zinc-400">
                          Project No. {projectNoLabel(project)}
                        </p>
                        <h3 className="mt-1 font-semibold text-zinc-950">
                          {project.project_name}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-500">
                          {clientNameById.get(project.client_id) ?? "Unknown client"} / {project.project_year ?? "No year"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link
                            href={clientsHref(pageParams, {
                              tab: "projects",
                              project: project.id,
                              client: null,
                              addProject: null,
                            })}
                            className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white"
                          >
                            Open
                          </Link>
                          {canManageRecords ? (
                            <>
                              <Link
                                href={clientsHref(pageParams, {
                                  tab: "projects",
                                  project: project.id,
                                  addProject: null,
                                })}
                                className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700"
                              >
                                Edit
                              </Link>
                              <form action={deactivateProject}>
                                <input type="hidden" name="id" value={project.id} />
                                <ConfirmSubmitButton
                                  message="Move this project to Archive? Linked quotations will not be deleted."
                                  className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700"
                                >
                                  Delete
                                </ConfirmSubmitButton>
                              </form>
                            </>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {!filteredProjects.length ? (
                  <div className="p-8 text-center text-sm text-zinc-500">
                    <p>No projects yet.</p>
                    {canManageRecords ? (
                      <Link
                        href={clientsHref(pageParams, {
                          addProject: "1",
                          tab: "projects",
                        })}
                        className="mt-3 inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white"
                      >
                        + Add Project
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                {selectedProject ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-zinc-950">
                        {selectedProject.project_name}
                      </h2>
                      <ProjectStatusBadge status={selectedProject.project_status} />
                      <StatusBadge active={selectedProject.is_active} />
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-zinc-600">
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Client</dt>
                        <dd>{clientNameById.get(selectedProject.client_id) ?? "Unknown client"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Code / Year</dt>
                        <dd>{selectedProject.project_number ?? selectedProject.project_code ?? "-"} / {selectedProject.project_year ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Location</dt>
                        <dd>{selectedProject.location ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Attention</dt>
                        <dd>{projectContactLine(selectedProject) || "-"}</dd>
                      </div>
                    </dl>
                    {selectedProject.project_address ? (
                      <p className="mt-3 text-sm text-zinc-500">
                        {selectedProject.project_address}
                      </p>
                    ) : null}
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold uppercase text-zinc-500">
                        Linked quotations
                      </h3>
                      <div className="mt-2 grid gap-2">
                        {selectedProjectQuotations.map((quotation) => {
                          const rootBase = quotationRootBaseNo(quotation.quotation_no);
                          const showOptionNumber = Boolean(
                            rootBase &&
                              (optionCountByProjectRoot.get(
                                `${quotation.project_id}:${rootBase}`,
                              ) ?? 1) > 1,
                          );
                          const displayQuotationNo =
                            formatQuotationDisplayNo({
                              optionNo: quotation.option_no,
                              quotationNo: quotation.quotation_no,
                              showOptionNumber,
                            }) ?? quoteNoLabel(quotation);

                          return (
                            <Link
                              key={quotation.id}
                              href={`/quotations/${quotation.id}`}
                              className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 transition hover:border-emerald-900/25 hover:text-emerald-900"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <span className="font-semibold text-zinc-950">
                                    {displayQuotationNo}
                                  </span>
                                  <span className="ml-2">{quotation.title}</span>
                                </div>
                                <QuotationStatusBadge status={quotation.status} />
                              </div>
                            </Link>
                          );
                        })}
                        {!selectedProjectQuotations.length ? (
                          <p className="text-sm text-zinc-500">
                            No linked quotations yet.
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href={`/clients/projects/${selectedProject.id}`}
                        className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white"
                      >
                        Open project
                      </Link>
                    </div>
                    {canManageRecords ? (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                          Edit project
                        </summary>
                        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                          <ProjectForm clients={clientList} project={selectedProject} />
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">Open a project to view details.</p>
                )}
              </aside>
            </section>
          ) : activeTab === "clients" ? (
            <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 p-4">
                  <h2 className="font-semibold text-zinc-950">Clients</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    {filteredClients.length} of {activeClientList.length} clients shown
                  </p>
                </div>
                <div className="divide-y divide-zinc-100">
                  {filteredClients.map((client) => {
                    const clientProjects = allProjectsByClient.get(client.id) ?? [];

                    return (
                      <div
                        key={client.id}
                        className={`grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center ${
                          client.id === selectedClient?.id ? "bg-emerald-50/60" : ""
                        }`}
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-zinc-950">
                              {client.company_name}
                            </h3>
                            <StatusBadge active={client.is_active} />
                          </div>
                          <p className="mt-1 text-sm text-zinc-500">
                            {[client.contact_person, client.email, client.phone].filter(Boolean).join(" / ") || "No contact summary"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {[client.city, client.country].filter(Boolean).join(" / ") || "No location"} / {clientProjects.length} {clientProjects.length === 1 ? "project" : "projects"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <Link
                            href={clientsHref(pageParams, {
                              tab: "clients",
                              client: client.id,
                              project: null,
                              addClient: null,
                            })}
                            className="text-sm font-semibold text-emerald-900"
                          >
                            Open
                          </Link>
                          {canManageRecords ? (
                            <>
                              <Link
                                href={clientsHref(pageParams, {
                                  tab: "clients",
                                  client: client.id,
                                  addClient: null,
                                })}
                                className="text-sm font-semibold text-zinc-600"
                              >
                                Edit
                              </Link>
                              <form action={deactivateClient}>
                                <input type="hidden" name="id" value={client.id} />
                                <ConfirmSubmitButton
                                  message="Move this client to Archive? Linked projects and quotations will not be deleted."
                                  className="text-sm font-semibold text-red-700"
                                >
                                  Delete
                                </ConfirmSubmitButton>
                              </form>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!filteredClients.length ? (
                  <div className="p-8 text-center text-sm text-zinc-500">
                    <p>No clients yet.</p>
                    {canManageRecords ? (
                      <Link
                        href={clientsHref(pageParams, {
                          addClient: "1",
                          tab: "clients",
                        })}
                        className="mt-3 inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white"
                      >
                        + Add Client
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                {selectedClient ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-zinc-950">
                        {selectedClient.company_name}
                      </h2>
                      <StatusBadge active={selectedClient.is_active} />
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-zinc-600">
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Contact</dt>
                        <dd>{selectedClient.contact_person ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Email / Phone</dt>
                        <dd>{[selectedClient.email, selectedClient.phone].filter(Boolean).join(" / ") || "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Location</dt>
                        <dd>{[selectedClient.city, selectedClient.country].filter(Boolean).join(" / ") || "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase text-zinc-400">Projects</dt>
                        <dd>{(allProjectsByClient.get(selectedClient.id) ?? []).length}</dd>
                      </div>
                    </dl>
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold uppercase text-zinc-500">
                        Linked projects
                      </h3>
                      <div className="mt-2 grid gap-2">
                        {(allProjectsByClient.get(selectedClient.id) ?? []).map((project) => (
                          <Link
                            key={project.id}
                            href={`/clients/projects/${project.id}`}
                            className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600"
                          >
                            <span className="font-semibold text-zinc-950">{project.project_name}</span>
                            <span className="ml-2">{project.project_year ?? "No year"}</span>
                          </Link>
                        ))}
                        {!(allProjectsByClient.get(selectedClient.id) ?? []).length ? (
                          <p className="text-sm text-zinc-500">No linked projects yet.</p>
                        ) : null}
                      </div>
                    </div>
                    {canManageRecords ? (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                          Edit client
                        </summary>
                        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                          <ClientForm client={selectedClient} />
                        </div>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">Open a client to view details.</p>
                )}
              </aside>
            </section>
          ) : (
            <section className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 p-4">
                  <h2 className="font-semibold text-zinc-950">Archived Projects</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Restore projects or permanently delete records with no linked quotations.
                  </p>
                </div>
                <div className="divide-y divide-zinc-100">
                  {archivedProjectList.map((project) => {
                    const dependencyState = archivedProjectDependencyById.get(project.id) ?? {
                      linkedQuotationCount: null,
                      error: null,
                    };
                    const linkedQuotationCount = dependencyState.linkedQuotationCount ?? 0;

                    return (
                      <div
                        key={project.id}
                        className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                      >
                        <div>
                          <h3 className="font-semibold text-zinc-950">
                            {project.project_name}
                          </h3>
                          <p className="mt-1 text-sm text-zinc-500">
                            {clientNameById.get(project.client_id) ?? "Unknown client"} / {project.project_year ?? "No year"}
                          </p>
                          {dependencyState.error ? (
                            <p className="mt-1 text-xs font-semibold text-red-700">
                              {dependencyState.error}
                            </p>
                          ) : linkedQuotationCount ? (
                            <p className="mt-1 text-xs font-semibold text-zinc-500">
                              This project has linked quotations.
                            </p>
                          ) : null}
                        </div>
                        {canManageRecords ? (
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <form action={restoreProject}>
                              <input type="hidden" name="id" value={project.id} />
                              <PendingSubmitButton
                                className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                              >
                                Restore
                              </PendingSubmitButton>
                            </form>
                            {dependencyState.error ? null : linkedQuotationCount ? (
                              <DeleteProjectWithQuotationsDialog
                                projectId={project.id}
                                projectName={project.project_name}
                                quotationCount={linkedQuotationCount}
                              />
                            ) : (
                              <form action={permanentlyDeleteProject}>
                                <input type="hidden" name="id" value={project.id} />
                                <ConfirmSubmitButton
                                  message="Permanently delete this project? This cannot be undone."
                                  className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                                >
                                  Delete permanently
                                </ConfirmSubmitButton>
                              </form>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!archivedProjectList.length ? (
                    <p className="p-6 text-sm text-zinc-500">No archived projects.</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 p-4">
                  <h2 className="font-semibold text-zinc-950">Archived Clients</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Restore clients or permanently delete records with no linked projects or quotations.
                  </p>
                </div>
                <div className="divide-y divide-zinc-100">
                  {archivedClientList.map((client) => (
                    <div
                      key={client.id}
                      className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div>
                        <h3 className="font-semibold text-zinc-950">
                          {client.company_name}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-500">
                          {[client.contact_person, client.email, client.phone].filter(Boolean).join(" / ") || "No contact summary"}
                        </p>
                      </div>
                      {canManageRecords ? (
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <form action={restoreClient}>
                            <input type="hidden" name="id" value={client.id} />
                            <PendingSubmitButton
                              className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                            >
                              Restore
                            </PendingSubmitButton>
                          </form>
                          <form action={permanentlyDeleteClient}>
                            <input type="hidden" name="id" value={client.id} />
                            <ConfirmSubmitButton
                              message="Permanently delete this client? This cannot be undone."
                              className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                            >
                              Delete permanently
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!archivedClientList.length ? (
                    <p className="p-6 text-sm text-zinc-500">No archived clients.</p>
                  ) : null}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
