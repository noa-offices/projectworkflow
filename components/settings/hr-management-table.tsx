"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { upsertUserHrDetails, type HrRow } from "@/app/settings/hr/actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type HrProfile = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  account_status: string | null;
};

type HrManagementTableProps = {
  profiles: HrProfile[];
  hrData: HrRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userInitials(fullName: string | null, email: string | null): string {
  const trimmedName = fullName?.trim();

  if (trimmedName) {
    const initials = trimmedName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("");

    if (initials) return initials.toUpperCase();
  }

  const trimmedEmail = email?.trim();
  return trimmedEmail ? trimmedEmail.slice(0, 2).toUpperCase() : "?";
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
  readOnly = false,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  onChange?: () => void;
  readOnly?: boolean;
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
        readOnly={readOnly}
        onChange={onChange}
        className={`h-10 rounded-md border px-3 text-sm outline-none transition ${
          readOnly
            ? "border-zinc-200 bg-zinc-100 text-zinc-500"
            : "border-zinc-200 bg-white text-zinc-800 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        }`}
      />
    </label>
  );
}

// ─── HrRow component ──────────────────────────────────────────────────────────

function HrRow({
  hr,
  profile,
}: {
  hr: HrRow | undefined;
  profile: HrProfile;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [annualLeaveDays, setAnnualLeaveDays] = useState(hr?.annual_leave_days ?? 30);
  const [leaveTaken, setLeaveTaken] = useState(hr?.leave_taken_this_year ?? 0);
  const leaveBalance = annualLeaveDays - leaveTaken;
  const initials = userInitials(profile.full_name, profile.email);

  function markDirty() {
    setIsDirty(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setIsDirty(false);
    setAnnualLeaveDays(hr?.annual_leave_days ?? 30);
    setLeaveTaken(hr?.leave_taken_this_year ?? 0);
  }

  if (isEditing) {
    return (
      <tr className="bg-emerald-50/40">
        <td colSpan={5} className="px-5 py-4">
          <form
            action={upsertUserHrDetails.bind(null, profile.id)}
            className="space-y-4"
          >
            {/* Identity header */}
            <div className="flex items-center gap-3">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-900">
                  {initials}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-950">
                  {profile.full_name?.trim() || "Unnamed user"}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {profile.email?.trim() || "No email"}
                </p>
              </div>
            </div>

            {/* Form fields */}
            <div className="grid gap-3 md:grid-cols-2">
              {/* Row 1 */}
              <Field
                name="date_of_joining"
                label="Date of joining"
                type="date"
                defaultValue={hr?.date_of_joining ?? ""}
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
                defaultValue={hr?.emirates_id_expiry ?? ""}
                onChange={markDirty}
              />
              <Field
                name="passport_expiry"
                label="Passport expiry"
                type="date"
                defaultValue={hr?.passport_expiry ?? ""}
                onChange={markDirty}
              />

              {/* Row 4 */}
              <Field
                name="emergency_contact_name"
                label="Emergency contact name"
                defaultValue={hr?.emergency_contact_name ?? ""}
                onChange={markDirty}
              />
              <Field
                name="emergency_contact_phone"
                label="Emergency contact phone"
                defaultValue={hr?.emergency_contact_phone ?? ""}
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
                  defaultValue={hr?.hr_notes ?? ""}
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
        </td>
      </tr>
    );
  }

  // ── Default compact row ────────────────────────────────────────────────────

  const balance = hr ? leaveBalance : null;

  return (
    <tr className="hover:bg-zinc-50">
      {/* Staff Member */}
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-900">
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-950">
              {profile.full_name?.trim() || "Unnamed user"}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {profile.email?.trim() || "No email"}
            </p>
          </div>
        </div>
      </td>

      {/* Leave Balance */}
      <td className="px-5 py-3 text-sm">
        {balance === null ? (
          <span className="text-zinc-400">—</span>
        ) : (
          <span className={leaveBalanceColorClass(balance)}>
            {balance} days
          </span>
        )}
      </td>

      {/* Emirates ID Expiry */}
      <td className={`whitespace-nowrap px-5 py-3 text-sm ${expiryColorClass(hr?.emirates_id_expiry ?? null)}`}>
        {formatDateDisplay(hr?.emirates_id_expiry ?? null)}
      </td>

      {/* Passport Expiry */}
      <td className={`whitespace-nowrap px-5 py-3 text-sm ${expiryColorClass(hr?.passport_expiry ?? null)}`}>
        {formatDateDisplay(hr?.passport_expiry ?? null)}
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

// ─── HrManagementTable ────────────────────────────────────────────────────────

export function HrManagementTable({ hrData, profiles }: HrManagementTableProps) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const hrByProfileId = useMemo(
    () => new Map(hrData.map((row) => [row.profile_id, row])),
    [hrData],
  );

  const summary = useMemo(() => {
    const emiratesExpiring = hrData.filter((row) => {
      const days = daysUntilExpiry(row.emirates_id_expiry);
      return days !== null && days <= 60;
    }).length;
    const passportExpiring = hrData.filter((row) => {
      const days = daysUntilExpiry(row.passport_expiry);
      return days !== null && days <= 60;
    }).length;
    const lowLeave = hrData.filter(
      (row) => row.annual_leave_days - row.leave_taken_this_year <= 5,
    ).length;

    return { emiratesExpiring, passportExpiring, lowLeave };
  }, [hrData]);

  const filteredProfiles = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();

    return profiles.filter(
      (p) =>
        normalized.length === 0 ||
        p.full_name?.toLowerCase().includes(normalized) ||
        p.email?.toLowerCase().includes(normalized),
    );
  }, [deferredSearch, profiles]);

  return (
    <div className="grid gap-5">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Staff" tone="text-zinc-950" value={profiles.length} />
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

      {/* Table section */}
      <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Staff HR Records</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Manage leave balances, document expiry dates, and emergency contacts.
              </p>
            </div>
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Search
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email"
                className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 lg:w-60"
              />
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Staff Member</th>
                <th className="px-5 py-3 font-semibold">Leave Balance</th>
                <th className="px-5 py-3 font-semibold">Emirates ID</th>
                <th className="px-5 py-3 font-semibold">Passport</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredProfiles.map((profile) => (
                <HrRow
                  key={profile.id}
                  profile={profile}
                  hr={hrByProfileId.get(profile.id)}
                />
              ))}
              {!filteredProfiles.length ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                    No staff members match the current search.
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
