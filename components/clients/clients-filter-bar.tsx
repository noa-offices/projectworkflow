"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ClientsFilterBarProps = {
  active: string;
  client: string;
  clients: Array<{ id: string; name: string }>;
  query: string;
  status: string;
  tab: "projects" | "clients" | "archive";
  year: string;
  years: number[];
};

const searchDebounceMs = 300;

export function ClientsFilterBar({
  active,
  client,
  clients,
  query,
  status,
  tab,
  year,
  years,
}: ClientsFilterBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftStatus, setDraftStatus] = useState(status);
  const [draftClient, setDraftClient] = useState(client);
  const [draftYear, setDraftYear] = useState(year);
  const [draftActive, setDraftActive] = useState(active);

  function replaceWithFilters(nextValues: {
    active?: string;
    client?: string;
    query?: string;
    status?: string;
    year?: string;
  }) {
    const next = new URLSearchParams(searchParams.toString());

    const values = {
      active: nextValues.active ?? draftActive,
      client: nextValues.client ?? draftClient,
      query: nextValues.query ?? draftQuery,
      status: nextValues.status ?? draftStatus,
      year: nextValues.year ?? draftYear,
    };

    next.set("tab", tab);

    if (values.query.trim()) next.set("q", values.query.trim());
    else next.delete("q");

    if (values.status) next.set("status", values.status);
    else next.delete("status");

    if (values.client) next.set("clientFilter", values.client);
    else next.delete("clientFilter");

    if (values.year) next.set("year", values.year);
    else next.delete("year");

    if (values.active) next.set("active", values.active);
    else next.delete("active");

    next.delete("addClient");
    next.delete("addProject");
    next.delete("message");
    next.delete("messageType");

    if (tab === "clients") {
      next.delete("client");
      next.delete("project");
    } else if (tab === "projects") {
      next.delete("client");
      next.delete("project");
    } else {
      next.delete("client");
      next.delete("project");
    }

    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (draftQuery !== query) {
        const next = new URLSearchParams(searchParams.toString());

        next.set("tab", tab);

        if (draftQuery.trim()) next.set("q", draftQuery.trim());
        else next.delete("q");

        if (draftStatus) next.set("status", draftStatus);
        else next.delete("status");

        if (draftClient) next.set("clientFilter", draftClient);
        else next.delete("clientFilter");

        if (draftYear) next.set("year", draftYear);
        else next.delete("year");

        if (draftActive) next.set("active", draftActive);
        else next.delete("active");

        next.delete("addClient");
        next.delete("addProject");
        next.delete("message");
        next.delete("messageType");
        next.delete("client");
        next.delete("project");

        startTransition(() => {
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        });
      }
    }, searchDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [draftActive, draftClient, draftQuery, draftStatus, draftYear, pathname, query, router, searchParams, tab]);

  function resetFilters() {
    setDraftQuery("");
    setDraftStatus("");
    setDraftClient("");
    setDraftYear("");
    setDraftActive("");

    startTransition(() => {
      router.replace(`${pathname}?tab=${tab}`, { scroll: false });
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto]">
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">
          Search
        </span>
        <input
          name="q"
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
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
          value={draftStatus}
          onChange={(event) => {
            setDraftStatus(event.target.value);
            replaceWithFilters({ status: event.target.value });
          }}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On Hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">
          Client
        </span>
        <select
          name="client"
          value={draftClient}
          onChange={(event) => {
            setDraftClient(event.target.value);
            replaceWithFilters({ client: event.target.value });
          }}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">All clients</option>
          {clients.map((clientOption) => (
            <option key={clientOption.id} value={clientOption.id}>
              {clientOption.name}
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
          value={draftYear}
          onChange={(event) => {
            setDraftYear(event.target.value);
            replaceWithFilters({ year: event.target.value });
          }}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">All years</option>
          {years.map((yearOption) => (
            <option key={yearOption} value={yearOption}>
              {yearOption}
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
          value={draftActive}
          onChange={(event) => {
            setDraftActive(event.target.value);
            replaceWithFilters({ active: event.target.value });
          }}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">All</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </label>
      <div className="flex items-end">
        <button
          type="button"
          onClick={resetFilters}
          className="flex h-10 w-full items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 transition hover:border-emerald-900/25 hover:text-emerald-900"
        >
          {isPending ? "Updating..." : "Reset filters"}
        </button>
      </div>
    </div>
  );
}
