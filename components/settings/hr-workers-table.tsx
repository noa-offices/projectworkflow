"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { LeaveBalanceSummaryDisplay } from "@/components/settings/leave-balance-summary";
import { VacationHistoryModal } from "@/components/settings/vacation-history-modal";
import { AddWorkerForm } from "@/components/settings/workers-table";
import {
  createWorkerLeave,
  upsertWorkerHrDetails,
  type WorkerHrRow,
} from "@/app/hr/actions";
import type { LeaveBalanceSummary, LeaveRequestRow } from "@/lib/hr/leave-requests";

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
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
      <p className="text-[10px] font-semibold uppercase leading-4 tracking-[0.12em] text-zinc-500 sm:text-xs sm:tracking-[0.16em]">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight sm:mt-3 sm:text-3xl ${tone}`}>
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

function WorkerHrItem({
  leaveBalanceSummary,
  leaveRequests,
  worker,
}: {
  leaveBalanceSummary?: LeaveBalanceSummary;
  leaveRequests: LeaveRequestRow[];
  worker: WorkerHrRow;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showVacationModal, setShowVacationModal] = useState(false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(worker.annual_leave_days);
  const leaveTaken = worker.leave_taken_this_year;
  const leaveBalance = leaveBalanceSummary?.available_to_plan ?? annualLeaveDays - leaveTaken;
  const displayBalance: LeaveBalanceSummary = leaveBalanceSummary ?? {
    entitlement: annualLeaveDays,
    requested: 0,
    planned: 0,
    active: 0,
    taken: leaveTaken,
    remaining_entitlement: annualLeaveDays - leaveTaken,
    available_to_plan: leaveBalance,
    approval_risk: false,
  };
  const initials = workerInitials(worker.full_name);

  function markDirty() {
    setIsDirty(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setIsDirty(false);
    setAnnualLeaveDays(worker.annual_leave_days);
  }

  if (isEditing) {
    return (
      <tr className="block rounded-lg border border-emerald-100 bg-emerald-50/40 lg:table-row lg:border-0">
        <td colSpan={5} className="block px-4 py-4 lg:table-cell lg:px-5">
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
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Legacy leave counter
                  </span>
                  <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-100 px-3 text-sm text-zinc-700">{leaveTaken} days</div>
                  <p className="text-xs text-zinc-500">Read-only compatibility value. Structured vacation dates determine the authoritative summary.</p>
                </div>
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Leave availability
                  </span>
                  <LeaveBalanceSummaryDisplay balance={displayBalance} className="min-h-10 rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm" />
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

            {/* Structured vacation */}
            <div className="border-t border-zinc-200 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Add approved vacation</p>
              <form action={createWorkerLeave.bind(null, worker.id)} className="grid gap-2 md:grid-cols-3">
                <input type="hidden" name="leave_type" value="annual_leave" />
                <input type="hidden" name="duration_type" value="full_day" />
                <input required name="start_date" type="date" aria-label="Vacation start date" className="h-9 rounded-md border border-zinc-200 px-2 text-sm" />
                <input required name="end_date" type="date" aria-label="Vacation end date" className="h-9 rounded-md border border-zinc-200 px-2 text-sm" />
                <input name="administrative_note" placeholder="Administrative note" className="h-9 rounded-md border border-zinc-200 px-2 text-sm" />
                <input name="reason" placeholder="Reason (optional)" className="h-9 rounded-md border border-zinc-200 px-2 text-sm md:col-span-2" />
                <PendingSubmitButton className="h-9 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white" pendingLabel="Saving...">Add Vacation</PendingSubmitButton>
              </form>
              <p className="mt-2 text-xs text-zinc-500">Legacy JSON vacation dates remain preserved and read-only.</p>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  // ── Default compact row ────────────────────────────────────────────────────

  return (
    <>
    <tr className="grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg border border-zinc-200 hover:bg-zinc-50 lg:table-row lg:border-0">
      {/* Worker */}
      <td className="min-w-0 px-3 py-3 lg:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700">
            {initials}
          </span>
          <p className="truncate font-medium text-zinc-950">{worker.full_name}</p>
        </div>
      </td>

      {/* Leave Balance */}
      <td className="px-3 py-3 text-right text-sm lg:px-5 lg:text-left">
        <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Availability</span>
        <LeaveBalanceSummaryDisplay balance={displayBalance} className="max-w-56 lg:max-w-72" />
      </td>

      {/* Emirates ID Expiry */}
      <td className={`hidden whitespace-nowrap px-5 py-3 text-sm lg:table-cell ${expiryColorClass(worker.emirates_id_expiry)}`}>
        {formatDateDisplay(worker.emirates_id_expiry)}
      </td>

      {/* Passport Expiry */}
      <td className={`hidden whitespace-nowrap px-5 py-3 text-sm lg:table-cell ${expiryColorClass(worker.passport_expiry)}`}>
        {formatDateDisplay(worker.passport_expiry)}
      </td>

      {/* Actions */}
      <td className="col-span-2 px-3 pb-3 text-left lg:table-cell lg:px-5 lg:py-3 lg:text-right">
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
        balance={leaveBalanceSummary}
        leaveRequests={leaveRequests}
        personName={worker.full_name}
        vacationDates={worker.vacation_dates}
        onClose={() => setShowVacationModal(false)}
      />
    ) : null}
    </>
  );
}

// ─── HrWorkersTable ─────────────────────────────────────────────────────────────

export function HrWorkersTable({
  leaveBalances,
  leaveRequests,
  workers,
}: {
  leaveBalances: Record<string, LeaveBalanceSummary>;
  leaveRequests: LeaveRequestRow[];
  workers: WorkerHrRow[];
}) {
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
    const lowLeave = workers.filter((worker) => (leaveBalances[worker.id]?.available_to_plan ?? worker.annual_leave_days - worker.leave_taken_this_year) <= 5).length;

    return { emiratesExpiring, passportExpiring, lowLeave };
  }, [leaveBalances, workers]);

  const filteredWorkers = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return workers.filter(
      (w) => normalized.length === 0 || w.full_name.toLowerCase().includes(normalized),
    );
  }, [deferredSearch, workers]);

  return (
    <div className="grid gap-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
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
        <div className="border-b border-zinc-200 px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Field Workers</h2>
              <p className="mt-1 hidden text-sm text-zinc-500 lg:block">
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

        <div className="lg:overflow-x-auto">
          <table className="block w-full text-left text-sm lg:table lg:min-w-[760px]">
            <thead className="hidden bg-zinc-50 text-xs uppercase tracking-[0.16em] text-zinc-500 lg:table-header-group">
              <tr>
                <th className="px-5 py-3 font-semibold">Worker</th>
                <th className="px-5 py-3 font-semibold">Leave Availability</th>
                <th className="px-5 py-3 font-semibold">Emirates ID</th>
                <th className="px-5 py-3 font-semibold">Passport</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="grid gap-3 p-3 lg:table-row-group lg:p-0">
              {filteredWorkers.map((worker) => (
                <WorkerHrItem key={worker.id} worker={worker} leaveBalanceSummary={leaveBalances[worker.id]} leaveRequests={leaveRequests.filter((request) => request.worker_id === worker.id)} />
              ))}
              {!filteredWorkers.length ? (
                <tr className="block lg:table-row">
                  <td colSpan={5} className="block px-5 py-10 text-center text-zinc-500 lg:table-cell">
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
