"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { formatQuotationMoney } from "@/lib/quotation-pricing";
import { quotationFolderNumberFromQuotationNumber } from "@/lib/projectworkflow-numbering";
import {
  quotationStatusLabel,
  quotationStatuses,
} from "@/lib/quotation-status";

type Client = { id: string; company_name: string };

type SalespersonProfile = { id: string; full_name: string | null };

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
  is_active: boolean;
  project_id: string | null;
  legacy_reference: string | null;
  quotation_date: string;
  quotation_no: string | null;
  salesperson_id: string | null;
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
  salespersonProfiles: SalespersonProfile[];
};

type QuotationFolder = {
  activeCount: number;
  archivedCount: number;
  clientName: string;
  folderNo: string | null;
  key: string;
  latestQuotation: Quotation;
  projectName: string;
  quotationCount: number;
  salespersonName: string | null;
  statusSummary: string;
};

function matchesSearch(values: Array<string | number | null | undefined>, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
}

function quotationFolderKey(quotation: Quotation) {
  const folderNo = quotationFolderNumberFromQuotationNumber(quotation.quotation_no);
  if (folderNo) return folderNo;
  if (quotation.project_id) return `project:${quotation.project_id}`;
  return `legacy:${quotation.id}`;
}

function isOriginalQuotation(quotation: Quotation) {
  return !quotation.quotation_no?.trim().match(/-(?:R|OPT)\d+/i);
}

function latestQuotation(left: Quotation, right: Quotation) {
  const leftTime = new Date(left.quotation_date).getTime();
  const rightTime = new Date(right.quotation_date).getTime();
  return rightTime > leftTime ? right : left;
}

function folderRepresentativeQuotation(quotations: Quotation[]) {
  const activeQuotations = quotations.filter((quotation) => quotation.is_active);
  const latestActive = activeQuotations.length ? activeQuotations.reduce(latestQuotation) : null;
  const originalQuotation = quotations.find(isOriginalQuotation) ?? null;
  const latestAny = quotations.reduce(latestQuotation);

  return latestActive ?? latestAny ?? originalQuotation ?? quotations[0];
}

function folderDisplayNo(quotations: Quotation[]) {
  return quotations
    .map((quotation) => quotationFolderNumberFromQuotationNumber(quotation.quotation_no))
    .find((value): value is string => Boolean(value)) ?? null;
}

function statusSummary(quotations: Quotation[]) {
  const counts = new Map<string, number>();
  for (const quotation of quotations) {
    const label = quotation.is_active ? quotationStatusLabel(quotation.status) : "Archived";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([label, count]) => (count > 1 ? `${label} x${count}` : label))
    .join(", ");
}

function formatListDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

export function QuotationListLiveFilter({
  children,
  clients,
  initialFilters,
  projectYears,
  projects,
  quotations,
  salespersonProfiles,
}: QuotationListLiveFilterProps) {
  const [query, setQuery] = useState(initialFilters?.q?.trim() ?? "");
  const [selectedStatus, setSelectedStatus] = useState(initialFilters?.status ?? "");
  const [selectedClientId, setSelectedClientId] = useState(initialFilters?.client ?? "");
  const [selectedProjectId, setSelectedProjectId] = useState(initialFilters?.project ?? "");
  const [selectedYear, setSelectedYear] = useState(initialFilters?.year ?? "");

  const clientMap = useMemo(() => new Map(clients.map((client) => [client.id, client.company_name])), [clients]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const salespersonMap = useMemo(
    () => new Map(salespersonProfiles.map((p) => [p.id, p.full_name])),
    [salespersonProfiles],
  );

  const folders = useMemo<QuotationFolder[]>(() => {
    const folderMap = new Map<string, Quotation[]>();
    for (const quotation of quotations) {
      const key = quotationFolderKey(quotation);
      folderMap.set(key, [...(folderMap.get(key) ?? []), quotation]);
    }

    return Array.from(folderMap.entries())
      .map(([key, folderQuotations]) => {
        const latest = folderRepresentativeQuotation(folderQuotations);
        const project = latest.project_id ? projectMap.get(latest.project_id) : undefined;
        const derivedFolderNo = folderDisplayNo(folderQuotations);
        const activeCount = folderQuotations.filter((quotation) => quotation.is_active).length;
        const archivedCount = folderQuotations.length - activeCount;

        return {
          activeCount,
          archivedCount,
          clientName: clientMap.get(latest.client_id) ?? "Unknown client",
          folderNo: derivedFolderNo,
          key,
          latestQuotation: latest,
          projectName: project?.project_name ?? latest.legacy_reference ?? "Opportunity reference",
          quotationCount: folderQuotations.length,
          salespersonName: latest.salesperson_id ? (salespersonMap.get(latest.salesperson_id) ?? null) : null,
          statusSummary: statusSummary(folderQuotations),
        };
      })
      .sort((left, right) => new Date(right.latestQuotation.quotation_date).getTime() - new Date(left.latestQuotation.quotation_date).getTime());
  }, [clientMap, projectMap, quotations, salespersonMap]);

  const filteredFolders = useMemo(
    () =>
      folders.filter((folder) => {
        const quotation = folder.latestQuotation;
        const project = quotation.project_id ? projectMap.get(quotation.project_id) : undefined;
        const displayYear = project?.project_year ?? new Date(quotation.quotation_date).getFullYear();

        return (
          (!selectedStatus ||
            quotation.status === selectedStatus ||
            (selectedStatus === "archived" && folder.archivedCount > 0)) &&
          (!selectedClientId || quotation.client_id === selectedClientId) &&
          (!selectedProjectId || quotation.project_id === selectedProjectId) &&
          (!selectedYear || String(displayYear) === selectedYear) &&
          matchesSearch(
            [
              quotation.quotation_no,
              folder.folderNo,
              quotation.title,
              quotation.status,
              quotationStatusLabel(quotation.status),
              folder.clientName,
              folder.projectName,
              quotation.legacy_reference,
              project?.project_number,
              project?.project_code,
              project?.project_year,
            ],
            query.trim(),
          )
        );
      }),
    [
      folders,
      projectMap,
      query,
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Quotation folders</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Folder-first view for originals, revisions, options, and builder access.
            </p>
          </div>
          <p className="text-xs font-semibold uppercase text-zinc-500">
            {filteredFolders.length} {filteredFolders.length === 1 ? "folder" : "folders"}
          </p>
        </div>

        {!filteredFolders.length ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
            No quotation folders match filters.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 lg:hidden">
          {filteredFolders.map((folder) => {
            const quotation = folder.latestQuotation;

            return (
              <article key={folder.key} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase text-zinc-500">Folder No</p>
                    <h3 className="mt-1 text-base font-semibold text-zinc-950">
                      {folder.folderNo ?? "Legacy"}
                    </h3>
                    <p className="mt-2 text-sm text-zinc-600">{folder.clientName}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{folder.projectName}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-semibold uppercase text-zinc-500">Total</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-950">
                      {formatQuotationMoney(quotation.currency, quotation.grand_total)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Latest quotation</p>
                    <p className="mt-1 font-medium text-zinc-950">{quotation.quotation_no ?? quotation.legacy_reference ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Status</p>
                    <p className="mt-1 text-zinc-700">{folder.statusSummary}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Quotes</p>
                    <p className="mt-1 text-zinc-700">
                      {folder.activeCount} active / {folder.archivedCount} archived
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-zinc-500">Last updated</p>
                    <p className="mt-1 text-zinc-700">{formatListDate(quotation.quotation_date)}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/quotations/${quotation.id}`} className="inline-flex h-9 items-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800">
                    Open Folder
                  </Link>
                  {folder.activeCount > 0 ? (
                    <Link href={`/quotations/${quotation.id}/local-builder`} className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                      Open Builder
                    </Link>
                  ) : (
                    <span className="inline-flex h-9 cursor-not-allowed items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm font-semibold text-zinc-400" title="Restore a quote before editing.">
                      Open Builder
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-4 hidden overflow-hidden rounded-lg border border-zinc-200 lg:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50">
              <tr className="border-b border-zinc-200 text-xs font-semibold uppercase text-zinc-500">
                <th className="px-4 py-3">Folder</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Sales Person</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Latest</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredFolders.map((folder) => {
                const quotation = folder.latestQuotation;

                return (
                  <tr key={folder.key} className="border-b border-zinc-100 align-top last:border-0">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-zinc-950">{folder.folderNo ?? "Legacy"}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {folder.activeCount} active / {folder.archivedCount} archived
                      </p>
                    </td>
                    <td className="px-4 py-4 text-zinc-700">{folder.clientName}</td>
                    <td className="px-4 py-4">
                      {folder.salespersonName ? (
                        <span className="text-zinc-700">{folder.salespersonName}</span>
                      ) : (
                        <span className="text-zinc-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-zinc-600">{folder.projectName}</td>
                    <td className="px-4 py-4 font-medium text-zinc-950">{quotation.quotation_no ?? quotation.legacy_reference ?? "-"}</td>
                    <td className="px-4 py-4 text-zinc-600">{folder.statusSummary}</td>
                    <td className="px-4 py-4 font-medium text-zinc-950">{formatQuotationMoney(quotation.currency, quotation.grand_total)}</td>
                    <td className="px-4 py-4 text-zinc-600">{formatListDate(quotation.quotation_date)}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <Link href={`/quotations/${quotation.id}`} className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800">
                          Open Folder
                        </Link>
                        {folder.activeCount > 0 ? (
                          <Link href={`/quotations/${quotation.id}/local-builder`} className="text-xs font-semibold text-zinc-500 transition hover:text-zinc-900">
                            Open Builder
                          </Link>
                        ) : (
                          <span className="text-xs font-semibold text-zinc-400" title="Restore a quote before editing.">
                            Open Builder
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
