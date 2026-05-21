"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  USER_ROLE_OPTIONS,
  USER_STATUS_OPTIONS,
  userRoleLabel,
  userStatusBadgeClass,
  userStatusLabel,
} from "@/lib/user-management";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";
import { updateUserAccess } from "@/app/settings/users/actions";

export type UserManagementProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
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
  const isSelf = profile.id === currentUserId;
  const isDirty = role !== profile.role || accountStatus !== profile.account_status;
  const formId = `user-access-${profile.id}`;
  const rowChanged = isDirty;

  return (
    <tr className={rowChanged ? "bg-emerald-50/40 align-top" : "align-top"}>
      <td className="px-5 py-4">
        <p className="font-medium text-zinc-950">
          {profile.full_name?.trim() || "Unnamed user"}
        </p>
        <p className="mt-1 break-all text-zinc-500">
          {profile.email?.trim() || "No email"}
        </p>
      </td>
      <td className="px-5 py-4">
        <label className="grid gap-2">
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
      </td>
      <td className="px-5 py-4">
        <div className="grid gap-3">
          <span
            className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${userStatusBadgeClass(accountStatus)}`}
          >
            {userStatusLabel(accountStatus)}
          </span>
          <label className="grid gap-2">
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
          {isSelf ? (
            <p className="text-xs leading-5 text-zinc-500">
              Your own row stays active and keeps the System Owner role.
            </p>
          ) : null}
        </div>
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-zinc-500">
        {formatDate(profile.created_at)}
      </td>
      <td className="whitespace-nowrap px-5 py-4 text-zinc-500">
        {formatDate(profile.updated_at)}
      </td>
      <td className="px-5 py-4">
        <form id={formId} action={updateUserAccess.bind(null, profile.id)} className="grid gap-3">
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="account_status" value={accountStatus} />
          <div className="text-xs text-zinc-500">
            {isDirty ? "Unsaved changes" : "No changes"}
          </div>
          <PendingSubmitButton
            disabled={!isDirty}
            className="h-10 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
            pendingLabel="Saving changes..."
          >
            Save Changes
          </PendingSubmitButton>
        </form>
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
          <table className="min-w-[980px] divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-[0.16em] text-zinc-500">
              <tr>
                <th className="px-5 py-3 font-semibold">User</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Created</th>
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
                  <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
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
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-950">System Owner</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Full access including settings, approvals, and high-risk admin actions.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-950">Admin Manager</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Manage company settings, products, clients, and quotations without owner-only danger actions.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-950">Sales User</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Create and edit quotations, clients, and project records as part of the sales workflow.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <h3 className="text-sm font-semibold text-zinc-950">Viewer</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Read-only access for review and coordination without editing business records.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
