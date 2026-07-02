"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { VacationDatesEditor } from "@/components/settings/vacation-dates-editor";
import { VacationHistoryModal } from "@/components/settings/vacation-history-modal";
import { AddWorkerForm } from "@/components/settings/workers-table";
import {
  addWorkerVacationEntry,
  editWorkerVacationEntry,
  removeWorkerVacationEntry,
  upsertWorkerHrDetails,
  type WorkerHrRow,
} from "@/app/hr/actions";

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

function leaveBalanceColorClass(balance: number): string {
  if (balance <= 5) return "font-semibold text-red-700";
  if (balance <= 10) return "text-amber-700";
  return "text-emerald-700";
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

// ─── Field component (editing form) ──────────────────────────────────────────

function Field({
  defaultValue,
  label,
  name,
  onChange,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  onChange?: () => void;
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
        step={type === "number" ? "1" : undefined}
        defaultValue={defaultValue ?? ""}
        onChange={onChange}
        className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

// ─── WorkerHrItem row component ────────────────────────────────────────────────

function WorkerHrItem({ worker }: { worker: WorkerHrRow }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showVacationModal, setShowVacationModal] = useState(false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(worker.annual_leave_days);
  const [leaveTaken, setLeaveTaken] = useState(worker.leave_taken_this_year);
  const leaveBalance = annualLeaveDays - leaveTaken;
  const initials = workerInitials(worker.full_name);

  function markDirty() {
    setIsDirty(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setIsDirty(false);
    setAnnualLeaveDays(worker.annual_leave_days);
    setLeaveTaken(worker.leave_taken_this_year);
  }

  if (isEditing) {
    return (
      <tr className="bg-emerald-50/40">
        <td colSpan={5} className="px-5 py-4">
          <div className="space-y-4">
            {/* Identity header */}
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
                {initials}
              </span>
              <p className="truncate font-medium text-zinc-950">{worker.full_name}</p>
            </div>

            {/* Form fields */}
            <form
              action={upsertWorkerHrDetails.bind(null, worker.id)}
              className="space-y-4"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {/* Row 1 */}
                <Field
                  name="date_of_joining"
                  label="Date of joining"
                  type="date"
                  defaultValue={worker.date_of_joining ?? ""}
                  onChange={markDirty}
                />
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Annual leave days
                  </span>
                  <input
                    name="annual_leave_days"
                    type="number"
                    step="1"
                    min={0}
                    value={annualLeaveDays}
                    onChange={(e) => {
                      setAnnualLeaveDays(Math.max(0, Number.parseInt(e.target.value, 10) || 0));
                      markDirty();
                    }}
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  />
                </label>

                {/* Row 2 */}
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Leave taken this year
                  </span>
                  <input
                    name="leave_taken_this_year"
                    type="number"
                    step="1"
                    min={0}
                    value={leaveTaken}
                    onChange={(e) => {
                      setLeaveTaken(Math.max(0, Number.parseInt(e.target.value, 10) || 0));
                      markDirty();
                    }}
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  />
                </label>
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Leave balance
                  </span>
                  <div
                    className={`flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm ${leaveBalanceColorClass(leaveBalance)}`}
                  >
                    {leaveBalance} days remaining
                  </div>
                </div>

                {/* Row 3 */}
                <Field
                  name="emirates_id_expiry"
                  label="Emirates ID expiry"
                  type="date"
                  defaultValue={worker.emirates_id_expiry ?? ""}
                  onChange={markDirty}
                />
                <Field
                  name="passport_expiry"
                  label="Passport expiry"
                  type="date"
                  defaultValue={worker.passport_expiry ?? ""}
                  onChange={markDirty}
                />

                {/* Row 4 */}
                <Field
                  name="emergency_contact_name"
                  label="Emergency contact name"
                  defaultValue={worker.emergency_contact_name ?? ""}
                  onChange={markDirty}
                />
                <Field
                  name="emergency_contact_phone"
                  label="Emergency contact phone"
                  defaultValue={worker.emergency_contact_phone ?? ""}
                  onChange={markDirty}
                />

                {/* Row 5 — full width */}
                <label className="grid gap-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    HR notes
                  </span>
                  <textarea
                    name="hr_notes"
                    rows={3}
                    defaultValue={worker.hr_notes ?? ""}
                    onChange={markDirty}
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  />
                </label>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-2 border-t border-zinc-200 pt-3">
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
              </div>
            </form>

            {/* Vacation dates */}
            <div className="border-t border-zinc-200 pt-3">
              <VacationDatesEditor
                vacationDates={worker.vacation_dates ?? []}
                addVacationAction={addWorkerVacationEntry.bind(null, worker.id)}
                editVacationAction={editWorkerVacationEntry.bind(null, worker.id)}
                removeVacationAction={removeWorkerVacationEntry.bind(null, worker.id)}
              />
            </div>
          </div>
        </td>
      </tr>
    );
  }

  // ── Default compact row ────────────────────────────────────────────────────

  return (
    <>
    <tr className="hover:bg-zinc-50">
      {/* Worker */}
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
            {initials}
          </span>
          <p className="truncate font-medium text-zinc-950">{worker.full_name}</p>
        </div>
      </td>

      {/* Leave Balance */}
      <td className="px-5 py-3 text-sm">
        <span className={leaveBalanceColorClass(leaveBalance)}>
          {leaveBalance} days
        </span>
      </td>

      {/* Emirates ID Expiry */}
      <td className={`whitespace-nowrap px-5 py-3 text-sm ${expiryColorClass(worker.emirates_id_expiry)}`}>
        {formatDateDisplay(worker.emirates_id_expiry)}
      </td>

      {/* Passport Expiry */}
      <td className={`whitespace-nowrap px-5 py-3 text-sm ${expiryColorClass(worker.passport_expiry)}`}>
        {formatDateDisplay(worker.passport_expiry)}
      </td>

      {/* Actions */}
      <td className="px-5 py-3 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowVacationModal(true)}
            className="h-8 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Vacation
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="h-8 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            Edit
          </button>
        </div>
      </td>
    </tr>
    {showVacationModal ? (
      <VacationHistoryModal
        personName={worker.full_name}
        vacationDates={worker.vacation_dates ?? []}
        onClose={() => setShowVacationModal(false)}
      />
    ) : null}
    </>
  );
}

// ─── HrWorkersTable ─────────────────────────────────────────────────────────────

export function HrWorkersTable({ workers }: { workers: WorkerHrRow[] }) {
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const summary = useMemo(() => {
    const emiratesExpiring = workers.filter((w) => {
      const days = daysUntilExpiry(w.emirates_id_expiry);
      return days !== null && days <= 60;
    }).length;
    const passportExpiring = workers.filter((w) => {
      const days = daysUntilExpiry(w.passport_expiry);
      return days !== null && days <= 60;
    }).length;
    const lowLeave = workers.filter(
      (w) => w.annual_leave_days - w.leave_taken_this_year <= 5,
    ).length;

    return { emiratesExpiring, passportExpiring, lowLeave };
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return workers.filter(
      (w) => normalized.length === 0 || w.full_name.toLowerCase().includes(normalized),
    );
  }, [deferredSearch, workers]);

  return (
    <div className="grid gap-5">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Workers" tone="text-zinc-950" value={workers.length} />
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
        <SummaryCard
          label="Low Leave Balance"
          tone="text-red-800"
          value={summary.lowLeave}
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
              <h2 className="text-lg font-semibold text-zinc-950">Field Workers</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Manage leave balances, document expiry dates, and emergency contacts for field workers.
              </p>
            </div>
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Search
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search worker name"
                className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 lg:w-60"
              />
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Worker</th>
                <th className="px-5 py-3 font-semibold">Leave Balance</th>
                <th className="px-5 py-3 font-semibold">Emirates ID</th>
                <th className="px-5 py-3 font-semibold">Passport</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredWorkers.map((worker) => (
                <WorkerHrItem key={worker.id} worker={worker} />
              ))}
              {!filteredWorkers.length ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                    No field workers match the current search.
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
