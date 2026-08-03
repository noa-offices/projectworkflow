"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatQuotationMoney } from "@/lib/quotation-pricing";

export type ActiveProjectFileItem = {
  orderNo: string;
  clientId: string;
  clientName: string;
  resolvedClientName: string;
  reference: string;
  currency: string;
  total: number;
  createdAt: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function matchesSearch(values: Array<string | number | null | undefined>, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return values.some((v) => String(v ?? "").toLowerCase().includes(q));
}

export function ActiveProjectsTable({
  projectFiles,
}: {
  projectFiles: ActiveProjectFileItem[];
}) {
  const [query, setQuery] = useState("");
  const [selectedClientName, setSelectedClientName] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const clientNames = useMemo(
    () =>
      Array.from(new Set(projectFiles.map((p) => p.resolvedClientName))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [projectFiles],
  );

  const years = useMemo(
    () =>
      Array.from(
        new Set(projectFiles.map((p) => new Date(p.createdAt).getFullYear())),
      ).sort((a, b) => b - a),
    [projectFiles],
  );

  const filtered = useMemo(
    () =>
      projectFiles.filter((p) => {
        const year = String(new Date(p.createdAt).getFullYear());
        return (
          (!selectedClientName || p.resolvedClientName === selectedClientName) &&
          (!selectedYear || year === selectedYear) &&
          matchesSearch([p.orderNo, p.resolvedClientName, p.reference], query.trim())
        );
      }),
    [projectFiles, query, selectedClientName, selectedYear],
  );
  const activeFilterCount = Number(Boolean(selectedClientName)) + Number(Boolean(selectedYear));

  function resetFilters() {
    setQuery("");
    setSelectedClientName("");
    setSelectedYear("");
  }

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:hidden">
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search project file no, client, reference..."
            className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
        <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((current) => !current)}
            aria-expanded={mobileFiltersOpen}
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
          >
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
          <p className="shrink-0 text-xs font-semibold text-zinc-500">
            {filtered.length} {filtered.length === 1 ? "project file" : "project files"}
          </p>
        </div>
        {mobileFiltersOpen ? (
          <div className="mt-3 grid min-w-0 gap-3 border-t border-zinc-100 pt-3">
            <label className="block min-w-0">
              <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
              <select
                value={selectedClientName}
                onChange={(e) => setSelectedClientName(e.target.value)}
                className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                <option value="">All clients</option>
                {clientNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="block min-w-0">
              <span className="text-xs font-semibold uppercase text-zinc-500">Year</span>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="mt-1 h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                <option value="">All years</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <button type="button" onClick={resetFilters} className="h-10 w-full rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-600">
              Reset filters
            </button>
          </div>
        ) : null}
      </section>

      <section className="hidden rounded-lg border border-zinc-200 bg-white p-5 shadow-sm xl:block">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search project file no, client, reference..."
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Client</span>
            <select
              value={selectedClientName}
              onChange={(e) => setSelectedClientName(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All clients</option>
              {clientNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Year</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All years</option>
              {years.map((year) => (
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

      <section className="mt-4 min-w-0 overflow-visible rounded-lg border border-zinc-200 bg-white shadow-sm xl:hidden">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-500">
            {query.trim() || activeFilterCount ? "No project files match the current filters." : "No active project files found."}
          </p>
        ) : (
          filtered.map((order) => (
            <Link
              key={order.orderNo}
              href={`/projects/orders/${encodeURIComponent(order.orderNo)}`}
              className="grid min-h-16 min-w-0 grid-cols-[104px_minmax(0,1fr)_16px] items-center gap-2 border-b border-zinc-100 px-3 py-2 transition last:border-0 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
              aria-label={`Open project file ${order.orderNo}`}
            >
              <span className="truncate text-xs font-bold text-zinc-950" title={order.orderNo}>{order.orderNo}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-800" title={order.resolvedClientName}>{order.resolvedClientName}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500" title={order.reference || "No reference"}>{order.reference || "No reference"}</span>
              </span>
              <span aria-hidden="true" className="text-lg text-zinc-400">&gt;</span>
            </Link>
          ))
        )}
      </section>

      <section className="mt-6 hidden rounded-lg border border-zinc-200 bg-white shadow-sm xl:block">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">Active Project Files</h2>
          <p className="text-xs font-semibold uppercase text-zinc-500">
            {filtered.length} {filtered.length === 1 ? "project file" : "project files"}
          </p>
        </div>

        {filtered.length === 0 ? (
          <p className="mx-5 mb-5 rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
            No project files match filters.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-zinc-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                    Project File No
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                    Client
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                    Reference
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase text-zinc-500">
                    Total
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                    Created
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.orderNo} className="border-b border-zinc-100 hover:bg-zinc-50 last:border-0">
                    <td className="px-4 py-3 font-semibold text-zinc-950">{order.orderNo}</td>
                    <td className="px-4 py-3 text-zinc-700">{order.resolvedClientName}</td>
                    <td className="px-4 py-3 text-zinc-600">{order.reference || "-"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-950">
                      {formatQuotationMoney(order.currency, order.total)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{formatDate(order.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/orders/${encodeURIComponent(order.orderNo)}`}
                        className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
