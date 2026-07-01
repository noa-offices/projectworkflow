"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  createWorker,
  deleteWorker,
  updateWorker,
  type WorkerRow,
} from "@/app/settings/workers/actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function workerInitials(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return initials ? initials.toUpperCase() : "?";
}

function daysUntilExpiry(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function formatDateDisplay(dateStr: string | null): string {
  if (!dateStr) return "—";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function expiryColorClass(dateStr: string | null): string {
  const days = daysUntilExpiry(dateStr);
  if (days === null) return "text-zinc-400";
  if (days <= 10) return "font-semibold text-red-700";
  if (days <= 30) return "font-semibold text-amber-700";
  if (days <= 60) return "text-yellow-700";
  return "text-zinc-600";
}

function statusPill(status: WorkerRow["status"]) {
  switch (status) {
    case "active":
      return { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800", label: "Active" };
    case "on_leave":
      return { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800", label: "On Leave" };
    case "offboarded":
      return { dot: "bg-zinc-400", pill: "bg-zinc-100 text-zinc-500", label: "Offboarded" };
  }
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  tone,
  value,
}: {
  label: string;
  tone: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${tone}`}>
        {value}
      </p>
    </div>
  );
}

// ─── Shared field components ──────────────────────────────────────────────────

function Field({
  defaultValue,
  label,
  name,
  onChange,
  required = false,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  onChange?: () => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        onChange={onChange}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function StatusSelect({
  defaultValue,
  onChange,
}: {
  defaultValue?: WorkerRow["status"];
  onChange?: () => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Status
      </span>
      <select
        name="status"
        defaultValue={defaultValue ?? "active"}
        onChange={onChange}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="active">Active</option>
        <option value="on_leave">On Leave</option>
      </select>
    </label>
  );
}

// ─── Worker form fields (shared between Add and Edit) ─────────────────────────

function WorkerFormFields({
  onAnyChange,
  worker,
}: {
  onAnyChange?: () => void;
  worker?: WorkerRow;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field
        name="full_name"
        label="Full name"
        defaultValue={worker?.full_name ?? ""}
        required
        onChange={onAnyChange}
      />
      <Field
        name="trade"
        label="Trade"
        defaultValue={worker?.trade ?? ""}
        onChange={onAnyChange}
      />
      <Field
        name="phone"
        label="Phone"
        defaultValue={worker?.phone ?? ""}
        onChange={onAnyChange}
      />
      <Field
        name="nationality"
        label="Nationality"
        defaultValue={worker?.nationality ?? ""}
        onChange={onAnyChange}
      />
      <Field
        name="daily_rate"
        label="Daily rate (AED)"
        type="number"
        defaultValue={worker?.daily_rate ?? ""}
        onChange={onAnyChange}
      />
      <StatusSelect defaultValue={worker?.status} onChange={onAnyChange} />
      <Field
        name="emirates_id_number"
        label="Emirates ID number"
        defaultValue={worker?.emirates_id_number ?? ""}
        onChange={onAnyChange}
      />
      <Field
        name="emirates_id_expiry"
        label="Emirates ID expiry"
        type="date"
        defaultValue={worker?.emirates_id_expiry ?? ""}
        onChange={onAnyChange}
      />
      <Field
        name="passport_number"
        label="Passport number"
        defaultValue={worker?.passport_number ?? ""}
        onChange={onAnyChange}
      />
      <Field
        name="passport_expiry"
        label="Passport expiry"
        type="date"
        defaultValue={worker?.passport_expiry ?? ""}
        onChange={onAnyChange}
      />
      <label className="grid gap-1 md:col-span-2">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Notes
        </span>
        <textarea
          name="notes"
          rows={2}
          defaultValue={worker?.notes ?? ""}
          onChange={onAnyChange}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
    </div>
  );
}

// ─── WorkerItem row component ─────────────────────────────────────────────────

function WorkerItem({ worker }: { worker: WorkerRow }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showOffboardConfirm, setShowOffboardConfirm] = useState(false);

  const pill = statusPill(worker.status);
  const initials = workerInitials(worker.full_name);

  function markDirty() {
    setIsDirty(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setIsDirty(false);
    setShowOffboardConfirm(false);
  }

  if (isEditing) {
    return (
      <tr className="bg-emerald-50/40">
        <td colSpan={6} className="px-5 py-4">
          <div className="space-y-4">
            {/* Identity header */}
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-950">{worker.full_name}</p>
                {worker.trade ? (
                  <p className="truncate text-xs text-zinc-500">{worker.trade}</p>
                ) : null}
              </div>
            </div>

            {/* Edit form */}
            <form action={updateWorker.bind(null, worker.id)}>
              <WorkerFormFields worker={worker} onAnyChange={markDirty} />
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3">
                <PendingSubmitButton
                  disabled={!isDirty}
                  className="h-10 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                  pendingLabel="Saving..."
                >
                  Save Changes
                </PendingSubmitButton>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  Cancel
                </button>

                {/* Offboard — only for active or on_leave workers */}
                {worker.status !== "offboarded" ? (
                  <div className="ml-auto">
                    {showOffboardConfirm ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-600">
                          This cannot be undone. Confirm?
                        </span>
                        <form action={deleteWorker.bind(null, worker.id)}>
                          <PendingSubmitButton
                            className="h-8 rounded-md bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-700"
                            pendingLabel="Offboarding..."
                          >
                            Yes, offboard
                          </PendingSubmitButton>
                        </form>
                        <button
                          type="button"
                          onClick={() => setShowOffboardConfirm(false)}
                          className="h-8 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowOffboardConfirm(true)}
                        className="h-8 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                      >
                        Offboard Worker
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </form>
          </div>
        </td>
      </tr>
    );
  }

  // ── Compact default row ────────────────────────────────────────────────────

  return (
    <tr className="hover:bg-zinc-50">
      {/* Worker */}
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-950">{worker.full_name}</p>
            {worker.phone ? (
              <p className="truncate text-xs text-zinc-500">{worker.phone}</p>
            ) : null}
          </div>
        </div>
      </td>

      {/* Trade */}
      <td className="px-5 py-3 text-sm text-zinc-600">
        {worker.trade ?? <span className="text-zinc-400">—</span>}
      </td>

      {/* Emirates ID */}
      <td className={`whitespace-nowrap px-5 py-3 text-sm ${expiryColorClass(worker.emirates_id_expiry)}`}>
        {formatDateDisplay(worker.emirates_id_expiry)}
      </td>

      {/* Passport */}
      <td className={`whitespace-nowrap px-5 py-3 text-sm ${expiryColorClass(worker.passport_expiry)}`}>
        {formatDateDisplay(worker.passport_expiry)}
      </td>

      {/* Status */}
      <td className="px-5 py-3">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${pill.pill}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>
      </td>

      {/* Actions */}
      <td className="px-5 py-3 text-right">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="h-8 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

// ─── Add New Worker form ───────────────────────────────────────────────────────

function AddWorkerForm({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-950">New Worker</p>
      <form action={createWorker}>
        <WorkerFormFields />
        <div className="mt-4 flex items-center gap-2 border-t border-zinc-200 pt-3">
          <PendingSubmitButton
            className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            pendingLabel="Adding worker..."
          >
            Add Worker
          </PendingSubmitButton>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── WorkersTable ─────────────────────────────────────────────────────────────

type StatusFilter = "active_plus" | "active" | "on_leave" | "offboarded" | "all";

export function WorkersTable({ workers }: { workers: WorkerRow[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active_plus");
  const [showAddForm, setShowAddForm] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const summary = useMemo(() => {
    const active = workers.filter((w) => w.status === "active").length;
    const emiratesExpiring = workers.filter((w) => {
      const days = daysUntilExpiry(w.emirates_id_expiry);
      return days !== null && days <= 60 && w.status !== "offboarded";
    }).length;
    const passportExpiring = workers.filter((w) => {
      const days = daysUntilExpiry(w.passport_expiry);
      return days !== null && days <= 60 && w.status !== "offboarded";
    }).length;

    return { active, emiratesExpiring, passportExpiring };
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return workers.filter((w) => {
      const matchesSearch =
        normalized.length === 0 ||
        w.full_name.toLowerCase().includes(normalized) ||
        (w.trade?.toLowerCase().includes(normalized) ?? false);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active_plus"
          ? w.status === "active" || w.status === "on_leave"
          : w.status === statusFilter);

      return matchesSearch && matchesStatus;
    });
  }, [deferredSearch, statusFilter, workers]);

  return (
    <div className="grid gap-5">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Workers" tone="text-zinc-950" value={workers.length} />
        <SummaryCard label="Active" tone="text-emerald-900" value={summary.active} />
        <SummaryCard
          label="Emirates ID Expiring"
          tone="text-amber-900"
          value={summary.emiratesExpiring}
        />
        <SummaryCard
          label="Passport Expiring"
          tone="text-amber-900"
          value={summary.passportExpiring}
        />
      </div>

      {/* Add new worker */}
      <div>
        {showAddForm ? (
          <AddWorkerForm onClose={() => setShowAddForm(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            + Add Worker
          </button>
        )}
      </div>

      {/* Table section */}
      <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Workers Directory</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Field staff records, document expiry dates, and employment status.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Search
                </span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or trade"
                  className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 lg:w-52"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Status
                </span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="active_plus">Active + On Leave</option>
                  <option value="active">Active only</option>
                  <option value="on_leave">On Leave only</option>
                  <option value="offboarded">Offboarded</option>
                  <option value="all">All</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Worker</th>
                <th className="px-5 py-3 font-semibold">Trade</th>
                <th className="px-5 py-3 font-semibold">Emirates ID</th>
                <th className="px-5 py-3 font-semibold">Passport</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredWorkers.map((worker) => (
                <WorkerItem key={worker.id} worker={worker} />
              ))}
              {!filteredWorkers.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                    {workers.length
                      ? "No workers match the current search or filter."
                      : "No workers yet. Add the first one above."}
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
