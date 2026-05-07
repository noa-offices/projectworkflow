'use client'

import { useState } from "react";

type ClientOption = {
  id: string;
  company_name: string;
};

type ProjectOption = {
  id: string;
  client_id: string;
  project_name: string;
  project_code: string | null;
  project_year: number | null;
};

export function ProjectSelectByClient({
  clients,
  projects,
}: {
  clients: ClientOption[];
  projects: ProjectOption[];
}) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const visibleProjects = projects.filter(
    (project) => !selectedClientId || project.client_id === selectedClientId,
  );

  return (
    <>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
        <select
          name="client_id"
          required
          value={selectedClientId}
          onChange={(event) => setSelectedClientId(event.target.value)}
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
          disabled={!selectedClientId}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 disabled:bg-zinc-50 disabled:text-zinc-400"
        >
          <option value="">
            {selectedClientId ? "Select project" : "Select client first"}
          </option>
          {visibleProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.project_name}
              {project.project_code ? ` - ${project.project_code}` : ""}
              {project.project_year ? ` (${project.project_year})` : ""}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
