import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  createClient as createClientRecord,
  createProject,
  updateClient,
  updateProject,
} from "./actions";

export const dynamic = "force-dynamic";

type ClientsPageProps = {
  searchParams?: Promise<{
    active?: string;
    client?: string;
    message?: string;
    q?: string;
    status?: string;
    year?: string;
  }>;
};

type Client = {
  id: string;
  company_name: string;
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

function matchesSearch(values: Array<string | null | undefined>, query: string) {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
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
        label="Client code"
        defaultValue={client?.client_code}
      />
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
        <SubmitButton label={client ? "Save client" : "Add client"} />
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
        label="Project code"
        defaultValue={project?.project_code}
      />
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
        <SubmitButton label={project ? "Save project" : "Add project"} />
      </div>
    </form>
  );
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const resolvedSearchParams = await searchParams;
  const message = resolvedSearchParams?.message;
  const query = resolvedSearchParams?.q?.trim() ?? "";
  const selectedStatus = resolvedSearchParams?.status ?? "";
  const selectedClientId = resolvedSearchParams?.client ?? "";
  const selectedActive = resolvedSearchParams?.active ?? "";
  const selectedYear = resolvedSearchParams?.year ?? "";
  const canManageRecords =
    profile?.role === "system_owner" ||
    profile?.role === "admin_manager" ||
    profile?.role === "sales_designer";
  const supabase = await createSupabaseClient();

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select(
      "id,company_name,client_code,contact_person,email,phone,website,address,city,country,trn,notes,is_active",
    )
    .order("company_name", { ascending: true })
    .returns<Client[]>();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select(
      "id,client_id,project_name,project_year,project_code,location,consultant,contractor,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address,project_status,notes,is_active,created_at",
    )
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  if (clientsError) {
    console.error("CLIENTS LIST ERROR", clientsError.message);
  }

  if (projectsError) {
    console.error("PROJECTS LIST ERROR", projectsError.message);
  }

  const clientList = clients ?? [];
  const projectList = projects ?? [];
  const clientNameById = new Map(
    clientList.map((client) => [client.id, client.company_name]),
  );
  const projectYears = Array.from(
    new Set(
      projectList
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

  const filteredProjects = projectList.filter((project) => {
    const clientName = clientNameById.get(project.client_id);

    return (
      (!selectedStatus || project.project_status === selectedStatus) &&
      (!selectedClientId || project.client_id === selectedClientId) &&
      (!selectedYear || String(project.project_year ?? "") === selectedYear) &&
      activeMatches(project.is_active) &&
      matchesSearch(
        [
          project.project_name,
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

  const filteredClients = clientList.filter((client) => {
    const clientProjects = projectList.filter((project) => project.client_id === client.id);
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

  const projectsByClient = new Map<string, Project[]>();
  for (const project of filteredProjects) {
    const clientProjects = projectsByClient.get(project.client_id) ?? [];
    clientProjects.push(project);
    projectsByClient.set(project.client_id, clientProjects);
  }

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
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
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

          {canManageRecords ? (
            <section className="mt-6 grid gap-5 xl:grid-cols-2">
              <details
                open={!clientList.length}
                className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <summary className="cursor-pointer text-lg font-semibold text-zinc-950">
                  Add client
                </summary>
                <p className="mt-1 text-sm text-zinc-500">
                  Create and maintain client records independently from projects.
                </p>
                <div className="mt-5">
                  <ClientForm />
                </div>
              </details>

              <details
                open={clientList.length > 0 && !projectList.length}
                className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
              >
                <summary className="cursor-pointer text-lg font-semibold text-zinc-950">
                  Add project
                </summary>
                <p className="mt-1 text-sm text-zinc-500">
                  Tip: include year in project code or project name for now, e.g.
                  HCT Commercial Proposal 2026.
                </p>
                <div className="mt-5">
                  {clientList.length ? (
                    <ProjectForm clients={clientList} />
                  ) : (
                    <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                      Create a client before adding a project.
                    </p>
                  )}
                </div>
              </details>
            </section>
          ) : null}

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-950">Projects</h2>
            <p className="mt-1 text-sm text-zinc-500">
              All project records, labelled by linked client.
            </p>

            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                    <th className="py-3 pr-4">Project</th>
                    <th className="py-3 pr-4">Client</th>
                    <th className="py-3 pr-4">Year</th>
                    <th className="py-3 pr-4">Code</th>
                    <th className="py-3 pr-4">Location</th>
                    <th className="py-3 pr-4">Attention</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Active</th>
                    <th className="py-3 pr-4">Open</th>
                    {canManageRecords ? <th className="py-3">Edit</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project) => (
                    <tr key={project.id} className="border-b border-zinc-100 align-top">
                      <td className="py-3 pr-4 font-medium text-zinc-950">
                        {project.project_name}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">
                        {clientNameById.get(project.client_id) ?? "Unknown client"}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">
                        {project.project_year ?? "No year"}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">
                        {project.project_code ?? "-"}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">
                        {project.location ?? "-"}
                      </td>
                      <td className="py-3 pr-4 text-zinc-600">
                        <div>{project.attention_to ?? "-"}</div>
                        {projectContactLine(project) ? (
                          <div className="mt-1 text-xs text-zinc-500">
                            {projectContactLine(project)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <ProjectStatusBadge status={project.project_status} />
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge active={project.is_active} />
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/clients/projects/${project.id}`}
                          className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                        >
                          Open project
                        </Link>
                      </td>
                      {canManageRecords ? (
                        <td className="py-3">
                          <details>
                            <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                              Edit
                            </summary>
                            <div className="mt-3 w-[520px] rounded-md border border-zinc-200 bg-zinc-50 p-4">
                              <ProjectForm clients={clientList} project={project} />
                            </div>
                          </details>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredProjects.length ? (
                <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                  No projects match filters.
                </p>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 md:hidden">
              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-md border border-zinc-200 bg-zinc-50 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-zinc-950">
                      {project.project_name}
                    </h3>
                    <StatusBadge active={project.is_active} />
                    <ProjectStatusBadge status={project.project_status} />
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    {clientNameById.get(project.client_id) ?? "Unknown client"}
                    {" - "}
                    {project.project_year ?? "No year"}
                    {project.project_code ? ` - ${project.project_code}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {[
                      project.location,
                      projectContactLine(project),
                    ]
                      .filter(Boolean)
                      .join(" - ") || "No location or attention contact yet."}
                  </p>
                  {project.project_address ? (
                    <p className="mt-1 text-sm text-zinc-500">
                      {project.project_address}
                    </p>
                  ) : null}
                  {canManageRecords ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                        Edit project
                      </summary>
                      <div className="mt-3">
                        <ProjectForm clients={clientList} project={project} />
                      </div>
                    </details>
                  ) : null}
                  <Link
                    href={`/clients/projects/${project.id}`}
                    className="mt-3 inline-flex h-10 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-emerald-900 transition hover:border-emerald-900/25"
                  >
                    Open project
                  </Link>
                </div>
              ))}
              {!filteredProjects.length ? (
                <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                  No projects match filters.
                </p>
              ) : null}
            </div>
          </section>

          <section className="mt-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Clients</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Client records with linked project history.
              </p>
            </div>
            {filteredClients.map((client) => {
              const clientProjects = projectsByClient.get(client.id) ?? [];

              return (
                <article
                  key={client.id}
                  className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
                >
                  <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold text-zinc-950">
                          {client.company_name}
                        </h2>
                        <StatusBadge active={client.is_active} />
                      </div>
                      <p className="mt-1 text-sm text-zinc-500">
                        {client.client_code ? `${client.client_code} - ` : ""}
                        {client.contact_person ?? "No contact person yet."}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {[client.email, client.phone, client.city, client.country]
                          .filter(Boolean)
                          .join(" - ") || "No contact details yet."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-2 xl:justify-end">
                      <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600">
                        {clientProjects.length}{" "}
                        {clientProjects.length === 1 ? "project" : "projects"}
                      </span>
                      {client.trn ? (
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600">
                          TRN {client.trn}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-sm font-semibold uppercase text-zinc-500">
                      Linked projects
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {clientProjects.map((project) => (
                        <Link
                          key={project.id}
                          href={`/clients/projects/${project.id}`}
                          className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600"
                        >
                          <span className="font-medium text-zinc-800">
                            {project.project_name}
                          </span>
                          <span>{project.project_year ?? "No year"}</span>
                          {projectContactLine(project) ? (
                            <span>{projectContactLine(project)}</span>
                          ) : null}
                          <ProjectStatusBadge status={project.project_status} />
                        </Link>
                      ))}
                      {!clientProjects.length ? (
                        <span className="text-sm text-zinc-500">
                          No linked projects match filters.
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {canManageRecords ? (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                        Edit client
                      </summary>
                      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                        <ClientForm client={client} />
                      </div>
                    </details>
                  ) : null}
                </article>
              );
            })}

            {!filteredClients.length ? (
              <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                No clients match filters.
              </section>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
