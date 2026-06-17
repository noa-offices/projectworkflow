"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatQuotationMoney } from "@/lib/quotation-pricing";

export type ProcurementOrderItem = {
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

export function ProcurementOrdersTable({
  orders,
}: {
  orders: ProcurementOrderItem[];
}) {
  const [query, setQuery] = useState("");
  const [selectedClientName, setSelectedClientName] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  const clientNames = useMemo(
    () =>
      Array.from(new Set(orders.map((o) => o.resolvedClientName))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [orders],
  );

  const years = useMemo(
    () =>
      Array.from(new Set(orders.map((o) => new Date(o.createdAt).getFullYear()))).sort(
        (a, b) => b - a,
      ),
    [orders],
  );

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        const year = String(new Date(o.createdAt).getFullYear());
        return (
          (!selectedClientName || o.resolvedClientName === selectedClientName) &&
          (!selectedYear || year === selectedYear) &&
          matchesSearch([o.orderNo, o.resolvedClientName, o.reference], query.trim())
        );
      }),
    [orders, query, selectedClientName, selectedYear],
  );

  function resetFilters() {
    setQuery("");
    setSelectedClientName("");
    setSelectedYear("");
  }

  return (
    <>
      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_auto]">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order no, client, reference..."
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

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">Procurement Folders</h2>
          <p className="text-xs font-semibold uppercase text-zinc-500">
            {filtered.length} {filtered.length === 1 ? "procurement folder" : "procurement folders"}
          </p>
        </div>

        {filtered.length === 0 ? (
          <p className="mx-5 mb-5 rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
            No procurement folders match filters.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-zinc-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase text-zinc-500">
                    Order No
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
                        href={`/procurement/orders/${encodeURIComponent(order.orderNo)}`}
                        className="inline-flex h-8 items-center rounded-md border border-emerald-700 px-3 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
                      >
                        📂 Open Procurement Folder
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
