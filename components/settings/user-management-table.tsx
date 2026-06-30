"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  USER_ROLE_OPTIONS,
  USER_STATUS_OPTIONS,
  userRoleLabel,
  userStatusLabel,
} from "@/lib/user-management";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";
import { updateUserAccess } from "@/app/settings/users/actions";

export type UserManagementProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: AppRole;
  account_status: AccountStatus;
  created_at: string;
  updated_at: string;
};

type UserManagementTableProps = {
  currentUserId: string;
  profiles: UserManagementProfileRow[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function userInitials(fullName: string | null, email: string | null) {
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

function statusPillTone(status: AccountStatus) {
  switch (status) {
    case "active":
      return { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800" };
    case "pending":
      return { dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800" };
    case "disabled":
      return { dot: "bg-red-500", pill: "bg-red-50 text-red-800" };
    default:
      return { dot: "bg-zinc-400", pill: "bg-zinc-100 text-zinc-600" };
  }
}

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

function UserRow({
  currentUserId,
  profile,
}: {
  currentUserId: string;
  profile: UserManagementProfileRow;
}) {
  const [role, setRole] = useState<AppRole>(profile.role);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>(profile.account_status);
  const [isEditing, setIsEditing] = useState(false);
  const isSelf = profile.id === currentUserId;
  const isDirty = role !== profile.role || accountStatus !== profile.account_status;
  const formId = `user-access-${profile.id}`;
  const initials = userInitials(profile.full_name, profile.email);

  function handleCancel() {
    setRole(profile.role);
    setAccountStatus(profile.account_status);
    setIsEditing(false);
  }

  if (isEditing) {
    const tone = statusPillTone(accountStatus);

    return (
      <tr className="bg-emerald-50/40">
        <td colSpan={5} className="px-5 py-4">
          <form
            id={formId}
            action={updateUserAccess.bind(null, profile.id)}
            className="flex flex-wrap items-end gap-4"
          >
            <input type="hidden" name="role" value={role} />
            <input type="hidden" name="account_status" value={accountStatus} />

            <div className="flex items-center gap-3">
              {profile.avatar_url ? (
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

            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Role
              </span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as AppRole)}
                className="h-10 min-w-44 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                {USER_ROLE_OPTIONS.map((option) => (
                  <option
                    key={option}
                    value={option}
                    disabled={isSelf && option !== "system_owner"}
                  >
                    {userRoleLabel(option)}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Access
              </span>
              <select
                value={accountStatus}
                onChange={(event) => setAccountStatus(event.target.value as AccountStatus)}
                className="h-10 min-w-44 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              >
                {USER_STATUS_OPTIONS.map((option) => (
                  <option
                    key={option}
                    value={option}
                    disabled={isSelf && option !== "active"}
                  >
                    {userStatusLabel(option)}
                  </option>
                ))}
              </select>
            </label>

            <span
              className={`inline-flex h-10 w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${tone.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {userStatusLabel(accountStatus)}
            </span>

            <div className="flex items-center gap-2">
              <PendingSubmitButton
                disabled={!isDirty}
                className="h-10 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                pendingLabel="Saving changes..."
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

            {isSelf ? (
              <p className="w-full text-xs leading-5 text-zinc-500">
                Your own row stays active and keeps the System Owner role.
              </p>
            ) : null}
          </form>
        </td>
      </tr>
    );
  }

  const tone = statusPillTone(profile.account_status);

  return (
    <tr className="hover:bg-zinc-50">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          {profile.avatar_url ? (
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
      <td className="px-5 py-3 text-zinc-700">{userRoleLabel(profile.role)}</td>
      <td className="px-5 py-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.pill}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {userStatusLabel(profile.account_status)}
        </span>
      </td>
      <td className="whitespace-nowrap px-5 py-3 text-xs text-zinc-500">
        {formatDate(profile.updated_at)}
      </td>
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

export function UserManagementTable({
  currentUserId,
  profiles,
}: UserManagementTableProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountStatus>("all");
  const deferredSearch = useDeferredValue(search);

  const summary = useMemo(() => {
    return profiles.reduce(
      (counts, profile) => {
        counts.total += 1;
        if (profile.account_status === "active") counts.active += 1;
        if (profile.account_status === "pending") counts.pending += 1;
        if (profile.account_status === "disabled") counts.suspended += 1;
        return counts;
      },
      { total: 0, active: 0, pending: 0, suspended: 0 },
    );
  }, [profiles]);

  const filteredProfiles = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();

    return profiles.filter((profile) => {
      const matchesSearch =
        normalizedSearch.length === 0
        || profile.full_name?.toLowerCase().includes(normalizedSearch)
        || profile.email?.toLowerCase().includes(normalizedSearch);
      const matchesRole = roleFilter === "all" || profile.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" || profile.account_status === statusFilter;

      return Boolean(matchesSearch && matchesRole && matchesStatus);
    });
  }, [deferredSearch, profiles, roleFilter, statusFilter]);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Users" tone="text-zinc-950" value={summary.total} />
        <SummaryCard label="Active" tone="text-emerald-900" value={summary.active} />
        <SummaryCard label="Pending" tone="text-amber-900" value={summary.pending} />
        <SummaryCard label="Suspended" tone="text-red-800" value={summary.suspended} />
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Users</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Review signups, update access, and save role or status changes one row at a time.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Search
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or email"
                  className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Role
                </span>
                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as "all" | AppRole)}
                  className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="all">All roles</option>
                  {USER_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {userRoleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Status
                </span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "all" | AccountStatus)}
                  className="h-10 min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="all">All statuses</option>
                  {USER_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {userStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">User</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredProfiles.map((profile) => (
                <UserRow
                  key={profile.id}
                  currentUserId={currentUserId}
                  profile={profile}
                />
              ))}
              {!filteredProfiles.length ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                    No users match the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-950">Role Guide</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Permission matrix across all roles.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Role</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">Quotations</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">Product Library</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">Company Settings</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">Procurement</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">Team Overview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              <tr className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">System Owner</td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
              </tr>
              <tr className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">Admin Manager</td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
              </tr>
              <tr className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">Procurement Manager</td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
              </tr>
              <tr className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">Sales User</td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
              </tr>
              <tr className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">Designer</td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-emerald-600 font-semibold">✓</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
              </tr>
              <tr className="hover:bg-zinc-50">
                <td className="px-4 py-3 font-medium text-zinc-950">Viewer</td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
                <td className="px-4 py-3 text-center"><span className="text-zinc-300 font-semibold">✕</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
