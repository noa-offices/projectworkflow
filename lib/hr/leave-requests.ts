export const LEAVE_TYPE_OPTIONS = [
  "annual_leave",
  "sick_leave",
  "unpaid_leave",
  "emergency_leave",
  "other",
] as const;

export const LEAVE_DURATION_OPTIONS = ["full_day", "first_half", "second_half"] as const;

export type LeaveType = (typeof LEAVE_TYPE_OPTIONS)[number];
export type LeaveDuration = (typeof LEAVE_DURATION_OPTIONS)[number];
export type LeaveRequestStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "returned"
  | "cancelled"
  | "returned_early";

export type LeaveRequestRow = {
  id: string;
  profile_id: string | null;
  worker_id: string | null;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  duration_type: LeaveDuration;
  requested_days: number;
  reason: string | null;
  handover_note: string | null;
  status: LeaveRequestStatus;
  submitted_at: string | null;
  approved_at: string | null;
  approved_start_date: string | null;
  approved_end_date: string | null;
  decision_reason: string | null;
  returned_at: string | null;
  return_reason: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  last_reminder_at: string | null;
  approved_vacation_entry_id: string | null;
  balance_deducted: number;
  actual_start_date: string | null;
  actual_end_date: string | null;
  return_to_work_date: string | null;
  actual_days: number | null;
  administrative_note: string | null;
  early_return_reason: string | null;
  early_returned_by: string | null;
  early_returned_at: string | null;
  legacy_source: string | null;
  legacy_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type LeaveBalanceSummary = {
  entitlement: number;
  requested: number;
  planned: number;
  active: number;
  taken: number;
  remaining_entitlement: number;
  available_to_plan: number;
  approval_risk: boolean;
};

export const EMPTY_LEAVE_BALANCE: LeaveBalanceSummary = {
  entitlement: 0,
  requested: 0,
  planned: 0,
  active: 0,
  taken: 0,
  remaining_entitlement: 0,
  available_to_plan: 0,
  approval_risk: false,
};

export function normalizeLeaveBalance(value: Partial<Record<keyof LeaveBalanceSummary, unknown>> | null | undefined): LeaveBalanceSummary {
  return {
    entitlement: Number(value?.entitlement ?? 0),
    requested: Number(value?.requested ?? 0),
    planned: Number(value?.planned ?? 0),
    active: Number(value?.active ?? 0),
    taken: Number(value?.taken ?? 0),
    remaining_entitlement: Number(value?.remaining_entitlement ?? 0),
    available_to_plan: Number(value?.available_to_plan ?? 0),
    approval_risk: Boolean(value?.approval_risk),
  };
}

export function leaveDisplayStatus(request: Pick<LeaveRequestRow, "actual_end_date" | "actual_start_date" | "approved_end_date" | "approved_start_date" | "end_date" | "start_date" | "status">, today = new Date().toISOString().slice(0, 10)) {
  if (request.status === "pending_approval") return "Requested";
  if (request.status === "returned") return "Returned for Changes";
  if (request.status !== "approved") return leaveStatusLabel(request.status);
  const start = request.actual_start_date ?? request.start_date;
  const end = request.actual_end_date ?? request.end_date;
  if (start > today) return "Planned";
  if (end >= today) return "On Leave";
  return "Completed";
}

export type LeaveRequestGroup = "current" | "recent" | "previous";

export function leaveRequestDateBoundaries(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const recentCutoff = new Date(`${today}T00:00:00Z`);
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - 30);
  return { today, recentCutoff: recentCutoff.toISOString().slice(0, 10) };
}

export function leaveRequestGroup(
  request: Pick<LeaveRequestRow, "end_date" | "status" | "updated_at">,
  boundaries = leaveRequestDateBoundaries(),
): LeaveRequestGroup {
  if (request.status === "draft" || request.status === "pending_approval" || request.status === "returned") {
    return "current";
  }
  if (request.status === "approved" && request.end_date >= boundaries.today) {
    return "current";
  }

  const recentDate = request.status === "approved"
    ? request.end_date
    : request.updated_at.slice(0, 10);
  return recentDate >= boundaries.recentCutoff ? "recent" : "previous";
}

export function leaveTypeLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function leaveStatusLabel(value: string) {
  return leaveTypeLabel(value);
}

export function formatLeaveDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export function formatLeaveDays(value: number) {
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)} day${Number(value) === 1 ? "" : "s"}`;
}
