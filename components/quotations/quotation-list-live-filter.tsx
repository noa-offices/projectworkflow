"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import {
  quotationStatusBadgeClassName,
  quotationStatusLabel,
  quotationStatuses,
} from "@/lib/quotation-status";

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
  client_id: string;
  currency: string;
  grand_total: number;
  id: string;
  project_id: string;
  quotation_date: string;
  quotation_no: string | null;
  status: string;
  title: string;
};

type QuotationListLiveFilterProps = {
  children?: ReactNode;
  clients: Client[];
  initialFilters?: {
    client?: string;
    project?: string;
    q?: string;
    status?: string;
    year?: string;
  };
  projectYears: number[];
  projects: Project[];
  quotations: Quotation[];
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${quotationStatusBadgeClassName(status)}`}>
      {quotationStatusLabel(status)}
    </span>
  );
}

function matchesSearch(values: Array<string | number | null | undefined>, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
}

export function QuotationListLiveFilter({
  children,
  clients,
  initialFilters,
  projectYears,
  projects,
  quotations,
}: QuotationListLiveFilterProps) {
  const [query, setQuery] = useState(initialFilters?.q?.trim() ?? "");
  const [selectedStatus, setSelectedStatus] = useState(initialFilters?.status ?? "");
  const [selectedClientId, setSelectedClientId] = useState(initialFilters?.client ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(initialFilters?.project ?? "");
  const [selectedYear, setSelectedYear] = useState(initialFilters?.year ?? "");

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client.company_name])), [clients]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const filteredQuotations = useMemo(
    () =>
      quotations.filter((quotation) => {
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
              quotation.status,
              quotationStatusLabel(quotation.status),
              clientName,
              project?.project_name,
              project?.project_number,
              project?.project_code,
              project?.project_year,
            ],
            query.trim(),
          )
        );
      }),
    [
      clientMap,
      projectMap,
      query,
      quotations,
      selectedClientId,
      selectedProjectId,
      selectedStatus,
      selectedYear,
    ],
  );

  function resetFilters() {
    setQuery("");
    setSelectedStatus("");
    setSelectedClientId("");
    setSelectedProjectId("");
    setSelectedYear("");
  }

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search quotation no, title, client, project..."
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Status</span>
            <select
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
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
            <select
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All clients</option>
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
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {clientMap.get(project.client_id) ?? "Unknown client"} - {project.project_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Year</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
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
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetFilters}
              className="h-10 w-full rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 transition hover:border-emerald-900/25 hover:text-emerald-900"
            >
              Reset filters
            </button>
          </div>
        </div>
      </section>

      {children}

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-950">Quotation list</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                <th className="py-3 pr-4">Project / Quote No</th>
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
                    <td className="py-3 pr-4 font-medium text-zinc-950">{formatQuotationMoney(quotation.currency, quotation.grand_total)}</td>
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
    </>
  );
}
