import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/094_leave_lifecycle.sql", import.meta.url),
  "utf8",
);
const userPage = readFileSync(
  new URL("../../app/settings/profile/vacation-requests/page.tsx", import.meta.url),
  "utf8",
);
const workerTable = readFileSync(
  new URL("../../components/settings/hr-workers-table.tsx", import.meta.url),
  "utf8",
);
const staffTable = readFileSync(
  new URL("../../components/settings/hr-management-table.tsx", import.meta.url),
  "utf8",
);
const hrActions = readFileSync(
  new URL("../../app/hr/actions.ts", import.meta.url),
  "utf8",
);
const balanceSummaryComponent = readFileSync(
  new URL("../../components/settings/leave-balance-summary.tsx", import.meta.url),
  "utf8",
);
const adminTable = readFileSync(
  new URL("../../components/settings/leave-requests-admin-table.tsx", import.meta.url),
  "utf8",
);
const leaveHelpers = readFileSync(
  new URL("../../lib/hr/leave-requests.ts", import.meta.url),
  "utf8",
);

function balance({ active = 0, entitlement = 30, planned = 0, requested = 0, taken = 0 }) {
  return {
    active,
    available: entitlement - taken - planned - active,
    remaining: entitlement - taken,
    requested,
    risk: taken + planned + active + requested > entitlement,
    taken,
  };
}

test("pending leave is requested but does not reduce official availability", () => {
  assert.deepEqual(balance({ requested: 15 }), {
    active: 0, available: 30, remaining: 30, requested: 15, risk: false, taken: 0,
  });
  assert.equal(balance({ planned: 20, requested: 15 }).risk, true);
});

test("planned, completed, active and early-return examples use the required formulas", () => {
  assert.deepEqual(balance({ planned: 15 }), {
    active: 0, available: 15, remaining: 30, requested: 0, risk: false, taken: 0,
  });
  assert.deepEqual(balance({ taken: 15 }), {
    active: 0, available: 15, remaining: 15, requested: 0, risk: false, taken: 15,
  });
  assert.equal(balance({ active: 15 }).available, 15);
  assert.equal(balance({ active: 15 }).remaining, 30);
  assert.equal(balance({ taken: 9 }).available, 21);
  assert.match(migration, /v_entitlement - v_baseline - s\.structured_taken - s\.planned - s\.active/i);
});

test("migration normalizes subjects and imports worker JSON idempotently without deleting it", () => {
  assert.match(migration, /alter column profile_id drop not null/i);
  assert.match(migration, /worker_id uuid references public\.workers\(id\) on delete restrict/i);
  assert.match(migration, /num_nonnulls\(profile_id, worker_id\) = 1/i);
  assert.match(migration, /on conflict \(legacy_reference\).*do nothing/is);
  assert.match(migration, /leave_requests_legacy_reference_uidx/i);
  assert.match(migration, /leave_worker_legacy_import_report/i);
  assert.match(migration, /duplicate_entries/i);
  assert.match(migration, /invalid_entries/i);
  assert.doesNotMatch(migration, /update public\.workers set\s+vacation_dates/i);
  assert.doesNotMatch(migration, /update public\.profiles_hr set\s+vacation_dates/i);
  assert.doesNotMatch(migration, /delete from public\.leave_requests/i);
});

test("the supplied one-entry worker JSON imports exactly once", () => {
  const supplied = [{ id: "legacy-1", start_date: "2026-08-01", end_date: "2026-08-15" }];
  const references = new Set(supplied.map((entry) => `worker-vacation:worker-1:${entry.id}`));
  assert.equal(references.size, 1);
  assert.match(migration, /'worker-vacation:' \|\| entry\.worker_id::text \|\| ':' \|\| \(entry\.value->>'id'\)/i);
});

test("management RPCs authorize exactly System Owner and Admin Manager and block self approval", () => {
  assert.match(migration, /role::text in \('system_owner', 'admin_manager'\)/i);
  assert.match(migration, /if v_request\.profile_id = auth\.uid\(\) then raise exception 'Self-approval is not permitted\.'/i);
  for (const fn of [
    "approve_leave_request",
    "reject_leave_request",
    "return_leave_request",
    "cancel_approved_leave_request",
    "record_leave_early_return",
    "correct_leave_actual_dates",
    "create_worker_leave",
  ]) assert.match(migration, new RegExp(`function public\\.${fn}`));
  assert.match(migration, /leave_requests_select_hr_queue[\s\S]*leave_actor_can_manage/i);
  assert.match(migration, /revoke insert, update, delete on public\.leave_requests from authenticated/i);
});

test("balance access preserves profile ownership and restricts worker balances to managers", () => {
  const getBalance = migration.match(/create or replace function public\.get_leave_balance[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(getBalance, /p_profile_id = auth\.uid\(\) and public\.leave_actor_is_active\(\)/i);
  assert.match(getBalance, /if num_nonnulls\(p_profile_id, p_worker_id\) <> 1/i);
  assert.match(migration, /using \(profile_id = auth\.uid\(\)/i);
  assert.match(migration, /using \(public\.leave_actor_can_manage\(\)\)/i);
});

test("approval reserves leave without new JSON or taken-counter effects", () => {
  const approval = migration.match(/create or replace function public\.approve_leave_request[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(approval, /approved_start_date = start_date/i);
  assert.match(approval, /balance_deducted = 0/i);
  assert.doesNotMatch(approval, /vacation_dates\s*=/i);
  assert.doesNotMatch(approval, /leave_taken_this_year\s*=/i);
});

test("half-day and cross-year calculation helpers remain explicit", () => {
  assert.match(migration, /p_duration_type in \('first_half', 'second_half'\)[\s\S]*return case[\s\S]*0\.5/i);
  assert.match(migration, /leave_request_days_in_year/i);
  assert.match(migration, /available_to_plan/i);
});

test("early return, future cancellation and active cancellation use actual dates safely", () => {
  const earlyReturn = migration.match(/create or replace function public\.record_leave_early_return[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  const futureCancellation = migration.match(/create or replace function public\.cancel_approved_leave_request[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  const activeCancellation = migration.match(/create or replace function public\.cancel_active_leave_request[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(earlyReturn, /p_actual_end_date > current_date/i);
  assert.match(earlyReturn, /status = 'returned_early'[\s\S]*actual_days = v_days/i);
  assert.match(futureCancellation, /v_request\.start_date <= current_date[\s\S]*actual-date handling/i);
  assert.doesNotMatch(futureCancellation, /actual_days =/i);
  assert.match(activeCancellation, /current_date < v_start or current_date > v_approved_end/i);
  assert.match(activeCancellation, /status = 'cancelled'[\s\S]*actual_days = v_days/i);
});

test("legacy counters become baselines and existing approval effects are not double deducted", () => {
  assert.match(migration, /hr\.leave_taken_this_year::numeric - coalesce\(\([\s\S]*sum\(lr\.balance_deducted\)/i);
  assert.match(migration, /v_baseline \+ s\.structured_taken/i);
  assert.match(migration, /approved_vacation_entry_id = null, balance_deducted = 0/i);
});

test("legacy JSON mutation and hard-delete actions are absent", () => {
  assert.doesNotMatch(hrActions, /addStaffVacationEntry|removeStaffVacationEntry|editStaffVacationEntry/);
  assert.doesNotMatch(hrActions, /addWorkerVacationEntry|removeWorkerVacationEntry|editWorkerVacationEntry/);
  assert.doesNotMatch(hrActions, /\.update\(\{\s*vacation_dates\s*:/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.leave_requests/i);
});

test("compact summaries match the three confirmed balance examples", () => {
  assert.deepEqual(balance({ entitlement: 30, taken: 15, planned: 13 }), {
    active: 0, available: 2, remaining: 15, requested: 0, risk: false, taken: 15,
  });
  assert.deepEqual(balance({ entitlement: 30, active: 15 }), {
    active: 15, available: 15, remaining: 30, requested: 0, risk: false, taken: 0,
  });
  assert.equal(balance({ entitlement: 30, active: 16 }).available, 14);
  assert.match(balanceSummaryComponent, /Available \{formatLeaveDays\(balance\.available_to_plan\)\}/);
  assert.match(balanceSummaryComponent, /\.filter\(\(item\) => item\.value > 0\)/);
  assert.match(balanceSummaryComponent, /label: "Requested"/);
});

test("low leave counts use available-to-plan", () => {
  assert.match(staffTable, /lowLeave[\s\S]*available_to_plan/);
  assert.match(workerTable, /lowLeave[\s\S]*available_to_plan/);
});

test("request table uses one clear available-after column", () => {
  assert.match(adminTable, />Available After</);
  assert.doesNotMatch(adminTable, />Balance</);
  assert.doesNotMatch(adminTable, />Projected</);
  assert.match(adminTable, /isPendingAnnual[\s\S]*request\.available_to_plan - Number\(request\.requested_days\)/);
  assert.match(adminTable, /Available now:[\s\S]*If approved:/);
  assert.match(adminTable, /lg:min-w-\[1024px\]/);
  assert.match(adminTable, /grid grid-cols-1[\s\S]*lg:table-row/);
});

test("approved and active display states remain user-facing", () => {
  assert.match(leaveHelpers, /pending_approval"\) return "Requested"/);
  assert.match(leaveHelpers, /returned"\) return "Returned for Changes"/);
  assert.match(leaveHelpers, /if \(end >= today\) return "On Leave"/);
  assert.match(leaveHelpers, /return "Completed"/);
});

test("interfaces preserve expanded details and collapsed previous history", () => {
  assert.match(userPage, /Remaining entitlement[\s\S]*Requested[\s\S]*Planned[\s\S]*On Leave[\s\S]*Taken/);
  assert.match(userPage, /Previous Requests/);
  assert.match(adminTable, /filters\.showPrevious \?/);
  assert.match(workerTable, /LeaveBalanceSummaryDisplay/);
  assert.match(staffTable, /LeaveBalanceSummaryDisplay/);
  assert.match(workerTable, /Legacy JSON vacation dates remain preserved and read-only/);
});
