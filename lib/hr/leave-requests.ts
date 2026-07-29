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
  | "cancelled";

export type LeaveRequestRow = {
  id: string;
  profile_id: string;
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
  decision_reason: string | null;
  returned_at: string | null;
  return_reason: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  last_reminder_at: string | null;
  approved_vacation_entry_id: string | null;
  balance_deducted: number;
  created_at: string;
  updated_at: string;
};

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
