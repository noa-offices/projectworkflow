export const CLIENT_PAYMENT_CALCULATION_TYPES = ["percentage", "fixed"] as const;
export type ClientPaymentCalculationType = (typeof CLIENT_PAYMENT_CALCULATION_TYPES)[number];

export const CLIENT_PAYMENT_DUE_TYPES = [
  "fixed_date",
  "project_confirmation",
  "before_order",
  "before_delivery",
  "on_delivery",
  "before_installation",
  "after_installation",
  "handover",
  "custom",
] as const;
export type ClientPaymentDueType = (typeof CLIENT_PAYMENT_DUE_TYPES)[number];

export const CLIENT_PAYMENT_METHODS = [
  "bank_transfer",
  "cheque",
  "cash",
  "card",
  "online_payment",
  "other",
] as const;
export type ClientPaymentMethod = (typeof CLIENT_PAYMENT_METHODS)[number];

export type ClientPaymentScheduleRow = {
  id: string;
  quotation_id: string;
  order_no: string;
};

export type ClientPaymentInstallmentRow = {
  id: string;
  schedule_id: string;
  sequence_no: number;
  title: string;
  calculation_type: ClientPaymentCalculationType;
  percentage: string | number | null;
  expected_amount: string | number;
  due_type: ClientPaymentDueType;
  due_date: string | null;
  custom_due_description: string | null;
  due_triggered_at: string | null;
  status_override: "waived" | "cancelled" | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientPaymentReceiptRow = {
  id: string;
  schedule_id: string;
  installment_id: string | null;
  amount_received: string | number;
  received_on: string;
  payment_method: ClientPaymentMethod;
  reference_number: string | null;
  bank_account_note: string | null;
  comment: string | null;
  recorded_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

export type ClientPaymentAttachmentRow = {
  id: string;
  receipt_id: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  created_by: string;
  created_at: string;
  uploader_label: string;
};

export type ClientPaymentStatus = "Planned" | "Due" | "Partially paid" | "Paid" | "Overdue" | "Waived" | "Cancelled";

export type ClientPaymentSummary = {
  contract: bigint;
  scheduled: bigint;
  received: bigint;
  overdue: bigint;
  outstanding: bigint;
  unscheduled: bigint;
  receivedByInstallment: Map<string, bigint>;
};

const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_HUNDRED = BigInt(100);

export function moneyToFils(value: string | number): bigint {
  const normalized = String(value).trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return BIGINT_ZERO;
  const sign = match[1] === "-" ? -BIGINT_ONE : BIGINT_ONE;
  const whole = BigInt(match[2]);
  const decimals = (match[3] ?? "").padEnd(3, "0");
  const roundedFils = BigInt(decimals.slice(0, 2) || "0") + (decimals[2] >= "5" ? BIGINT_ONE : BIGINT_ZERO);
  return sign * (whole * BIGINT_HUNDRED + roundedFils);
}

export function filsToDecimalString(value: bigint): string {
  const negative = value < BIGINT_ZERO;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BIGINT_HUNDRED}.${String(absolute % BIGINT_HUNDRED).padStart(2, "0")}`;
}

export function formatPaymentMoney(currency: string, value: bigint): string {
  const negative = value < BIGINT_ZERO;
  const absolute = negative ? -value : value;
  const grouped = (absolute / BIGINT_HUNDRED).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currency} ${grouped}.${String(absolute % BIGINT_HUNDRED).padStart(2, "0")}`;
}

export function clientPaymentDueLabel(installment: ClientPaymentInstallmentRow): string {
  if (installment.due_type === "fixed_date") return installment.due_date ?? "Date not set";
  if (installment.due_type === "custom") return installment.custom_due_description ?? "Custom trigger";
  return ({
    project_confirmation: "Project confirmation",
    before_order: "Before order",
    before_delivery: "Before delivery",
    on_delivery: "On delivery",
    before_installation: "Before installation",
    after_installation: "After installation",
    handover: "Handover",
  } as const)[installment.due_type];
}

export function deriveClientPaymentStatus(
  installment: ClientPaymentInstallmentRow,
  receivedFils: bigint,
  todayIso: string,
): ClientPaymentStatus {
  if (installment.status_override === "waived") return "Waived";
  if (installment.status_override === "cancelled") return "Cancelled";
  const expectedFils = moneyToFils(installment.expected_amount);
  if (receivedFils >= expectedFils) return "Paid";
  if (installment.due_type === "fixed_date" && installment.due_date && installment.due_date < todayIso) return "Overdue";
  if (receivedFils > BIGINT_ZERO) return "Partially paid";
  if (
    installment.due_triggered_at
    || installment.due_type === "project_confirmation"
    || (installment.due_type === "fixed_date" && installment.due_date === todayIso)
  ) return "Due";
  return "Planned";
}

export function calculateClientPaymentSummary(
  contractTotal: string | number,
  installments: ClientPaymentInstallmentRow[],
  receipts: ClientPaymentReceiptRow[],
  todayIso: string,
): ClientPaymentSummary {
  const receivedByInstallment = new Map<string, bigint>();
  let received = BIGINT_ZERO;
  for (const receipt of receipts) {
    if (receipt.voided_at || !receipt.installment_id) continue;
    const amount = moneyToFils(receipt.amount_received);
    received += amount;
    receivedByInstallment.set(
      receipt.installment_id,
      (receivedByInstallment.get(receipt.installment_id) ?? BIGINT_ZERO) + amount,
    );
  }

  let scheduled = BIGINT_ZERO;
  let waived = BIGINT_ZERO;
  let overdue = BIGINT_ZERO;
  for (const installment of installments) {
    const expected = moneyToFils(installment.expected_amount);
    if (installment.status_override !== "cancelled") scheduled += expected;
    if (installment.status_override === "waived") waived += expected;
    const installmentReceived = receivedByInstallment.get(installment.id) ?? BIGINT_ZERO;
    if (deriveClientPaymentStatus(installment, installmentReceived, todayIso) === "Overdue") {
      overdue += expected > installmentReceived ? expected - installmentReceived : BIGINT_ZERO;
    }
  }

  const contract = moneyToFils(contractTotal);
  return {
    contract,
    scheduled,
    received,
    overdue,
    outstanding: contract > received + waived ? contract - received - waived : BIGINT_ZERO,
    unscheduled: contract > scheduled ? contract - scheduled : BIGINT_ZERO,
    receivedByInstallment,
  };
}
