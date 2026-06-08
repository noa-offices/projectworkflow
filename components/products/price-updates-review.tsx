"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type PriceUpdatesReviewRow = {
  brandName: string;
  categoryName: string;
  editHref: string;
  id: string;
  lastPriceListDateLabel: string;
  priceStatusDetail: string;
  priceStatusKey: "current" | "needs_check" | "due" | "no_price_list_date" | "scheduled" | "checked";
  priceStatusLabel: string;
  priceStatusTone: "ok" | "notice" | "neutral" | "warning";
  searchText: string;
  sourceCurrency: string;
  sourcePriceLabel: string;
  templateCodeLabel: string;
  templateName: string;
  viewHref: string;
};

type PriceUpdatesReviewProps = {
  initialFilters: {
    brand: string;
    currency: string;
    query: string;
    status: string;
  };
  rows: PriceUpdatesReviewRow[];
};

const statusOptions = [
  { label: "All statuses", value: "" },
  { label: "Current", value: "current" },
  { label: "Checked", value: "checked" },
  { label: "Needs check", value: "needs_check" },
  { label: "Due", value: "due" },
  { label: "No price list date", value: "no_price_list_date" },
  { label: "Scheduled", value: "scheduled" },
];

function statusClassName(tone: PriceUpdatesReviewRow["priceStatusTone"]) {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (tone === "notice") return "border-sky-200 bg-sky-50 text-sky-900";
  if (tone === "neutral") return "border-zinc-200 bg-zinc-50 text-zinc-700";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function PriceUpdatesReview({ initialFilters, rows }: PriceUpdatesReviewProps) {
  const [query, setQuery] = useState(initialFilters.query);
  const [brand, setBrand] = useState(initialFilters.brand);
  const [status, setStatus] = useState(initialFilters.status);
  const [currency, setCurrency] = useState(initialFilters.currency);

  const brandOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.brandName))).sort(),
    [rows],
  );

  const currencyOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.sourceCurrency).filter(Boolean))).sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch = !normalizedQuery || row.searchText.includes(normalizedQuery);
      const matchesBrand = !brand || row.brandName === brand;
      const matchesStatus = !status || row.priceStatusKey === status;
      const matchesCurrency = !currency || row.sourceCurrency === currency;

      return matchesSearch && matchesBrand && matchesStatus && matchesCurrency;
    });
  }, [brand, currency, query, rows, status]);

  const filteredSummary = useMemo(
    () =>
      filteredRows.reduce(
        (acc, row) => {
          acc.total += 1;
          acc[row.priceStatusKey] += 1;
          return acc;
        },
        { checked: 0, current: 0, due: 0, needs_check: 0, no_price_list_date: 0, scheduled: 0, total: 0 } satisfies Record<PriceUpdatesReviewRow["priceStatusKey"] | "total", number>,
      ),
    [filteredRows],
  );

  return (
    <div className="px-5 py-6 sm:px-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total products/templates", filteredSummary.total, "border-zinc-200 bg-white text-zinc-950"],
          ["Current", filteredSummary.current + filteredSummary.checked, "border-emerald-200 bg-emerald-50 text-emerald-950"],
          ["Needs check", filteredSummary.needs_check, "border-amber-200 bg-amber-50 text-amber-950"],
          ["Due", filteredSummary.due, "border-red-200 bg-red-50 text-red-950"],
          ["No price list date", filteredSummary.no_price_list_date, "border-zinc-200 bg-zinc-50 text-zinc-800"],
        ].map(([label, value, className]) => (
          <div key={label} className={`rounded-lg border p-4 shadow-sm ${className}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
            <p className="mt-3 text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr_1fr_1fr_auto] xl:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Product, code, brand"
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Brand</span>
            <select
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All brands</option>
              {brandOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Price status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {statusOptions.map((option) => (
                <option key={option.value || option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-zinc-500">Source currency</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              <option value="">All currencies</option>
              {currencyOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setBrand("");
              setStatus("");
              setCurrency("");
            }}
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Reset
          </button>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-950">Price Review List</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Showing {filteredRows.length} of {rows.length} product templates.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Product / Template</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Source price</th>
                <th className="px-4 py-3">Last price list date</th>
                <th className="px-4 py-3">Price status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredRows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-950">{row.templateName}</p>
                    <p className="mt-1 text-xs text-zinc-500">{row.templateCodeLabel}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{row.brandName}</td>
                  <td className="px-4 py-3 text-zinc-700">{row.categoryName}</td>
                  <td className="px-4 py-3 font-medium text-zinc-950">{row.sourcePriceLabel}</td>
                  <td className="px-4 py-3 text-zinc-700">{row.lastPriceListDateLabel}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClassName(row.priceStatusTone)}`}>
                      {row.priceStatusLabel}
                    </span>
                    <p className="mt-1 max-w-xs text-xs text-zinc-500">{row.priceStatusDetail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={row.viewHref}
                        className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                      >
                        View
                      </Link>
                      <Link
                        href={row.editHref}
                        className="inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800"
                      >
                        Edit
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                    No product templates match the current price update filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
