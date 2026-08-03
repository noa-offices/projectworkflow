"use server";

import { revalidatePath } from "next/cache";
import {
  canManageClientPaymentInstallments,
  canRecordClientPaymentReceipts,
  canVoidClientPaymentReceipts,
  requireActiveUser,
} from "@/lib/auth";
import { extractActionError, formatSafeActionError, logServerActionError } from "@/lib/action-errors";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { ClientPaymentCalculationType, ClientPaymentDueType, ClientPaymentMethod } from "@/lib/projects/client-payment-model";

type PaymentActionResult = { ok: true } | { ok: false; error: string; staleContractTotal?: boolean };
type ReceiptActionResult = { ok: true } | { ok: false; error: string; requiresOverpaymentConfirmation?: boolean };

export type ClientPaymentInstallmentInput = {
  installmentId?: string;
  quotationId: string;
  orderNo: string;
  contractTotal: string;
  title: string;
  calculationType: ClientPaymentCalculationType;
  percentage: string | null;
  fixedAmount: string | null;
  dueType: ClientPaymentDueType;
  dueDate: string | null;
  customDueDescription: string | null;
  note: string | null;
  statusOverride: "waived" | "cancelled" | null;
};

export type ClientPaymentReceiptInput = {
  installmentId: string;
  quotationId: string;
  orderNo: string;
  contractTotal: string;
  amountReceived: string;
  receivedOn: string;
  paymentMethod: ClientPaymentMethod;
  referenceNumber: string | null;
  bankAccountNote: string | null;
  comment: string | null;
  idempotencyKey: string;
  confirmOverpayment: boolean;
};

function refreshProject(orderNo: string) {
  revalidatePath(`/projects/orders/${encodeURIComponent(orderNo)}`);
  revalidatePath("/projects/completed");
}

function rpcArgs(input: ClientPaymentInstallmentInput) {
  return {
    p_quotation_id: input.quotationId,
    p_order_no: input.orderNo,
    p_contract_total: input.contractTotal,
    p_title: input.title,
    p_calculation_type: input.calculationType,
    p_percentage: input.calculationType === "percentage" ? input.percentage : null,
    p_fixed_amount: input.calculationType === "fixed" ? input.fixedAmount : null,
    p_due_type: input.dueType,
    p_due_date: input.dueType === "fixed_date" ? input.dueDate : null,
    p_custom_due_description: input.dueType === "custom" ? input.customDueDescription : null,
    p_note: input.note,
    p_status_override: input.statusOverride,
  };
}

export async function saveClientPaymentInstallment(input: ClientPaymentInstallmentInput): Promise<PaymentActionResult> {
  const { profile } = await requireActiveUser();
  if (!canManageClientPaymentInstallments(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const rpcName = input.installmentId ? "update_client_payment_installment" : "add_client_payment_installment";
  const args = input.installmentId
    ? { p_installment_id: input.installmentId, ...rpcArgs(input) }
    : rpcArgs(input);
  const { error } = await supabase.rpc(rpcName, args);
  if (error) {
    logServerActionError("SAVE CLIENT PAYMENT INSTALLMENT ERROR", error, { action: rpcName, recordId: input.installmentId ?? input.orderNo });
    const extracted = extractActionError(error);
    return {
      ok: false,
      error: formatSafeActionError("Could not save instalment", error),
      staleContractTotal:
        extracted.code === "P0001" &&
        extracted.message === "Project File contract total has changed. Reload before continuing.",
    };
  }
  refreshProject(input.orderNo);
  return { ok: true };
}

export async function deleteClientPaymentInstallment(
  installmentId: string,
  quotationId: string,
  orderNo: string,
  contractTotal: string,
): Promise<PaymentActionResult> {
  const { profile } = await requireActiveUser();
  if (!canManageClientPaymentInstallments(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("delete_client_payment_installment", {
    p_installment_id: installmentId, p_quotation_id: quotationId, p_order_no: orderNo, p_contract_total: contractTotal,
  });
  if (error) return { ok: false, error: formatSafeActionError("Could not delete instalment", error) };
  refreshProject(orderNo);
  return { ok: true };
}

export async function moveClientPaymentInstallment(
  installmentId: string,
  quotationId: string,
  orderNo: string,
  contractTotal: string,
  direction: -1 | 1,
): Promise<PaymentActionResult> {
  const { profile } = await requireActiveUser();
  if (!canManageClientPaymentInstallments(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("move_client_payment_installment", {
    p_installment_id: installmentId, p_quotation_id: quotationId, p_order_no: orderNo,
    p_contract_total: contractTotal, p_direction: direction,
  });
  if (error) return { ok: false, error: formatSafeActionError("Could not reorder instalment", error) };
  refreshProject(orderNo);
  return { ok: true };
}

export async function recordClientPaymentReceipt(input: ClientPaymentReceiptInput): Promise<ReceiptActionResult> {
  const { profile } = await requireActiveUser();
  if (!canRecordClientPaymentReceipts(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("record_client_payment_receipt", {
    p_installment_id: input.installmentId,
    p_quotation_id: input.quotationId,
    p_order_no: input.orderNo,
    p_contract_total: input.contractTotal,
    p_amount_received: input.amountReceived,
    p_received_on: input.receivedOn,
    p_payment_method: input.paymentMethod,
    p_reference_number: input.referenceNumber,
    p_bank_account_note: input.bankAccountNote,
    p_comment: input.comment,
    p_idempotency_key: input.idempotencyKey,
    p_confirm_overpayment: input.confirmOverpayment,
  });
  if (error) {
    logServerActionError("RECORD CLIENT PAYMENT RECEIPT ERROR", error, { action: "recordClientPaymentReceipt", recordId: input.installmentId });
    const message = formatSafeActionError("Could not record receipt", error);
    return {
      ok: false,
      error: message,
      requiresOverpaymentConfirmation: message.includes("Confirm the overpayment"),
    };
  }
  refreshProject(input.orderNo);
  return { ok: true };
}

export async function voidClientPaymentReceipt(
  receiptId: string,
  quotationId: string,
  orderNo: string,
  contractTotal: string,
  reason: string,
): Promise<PaymentActionResult> {
  const { profile } = await requireActiveUser();
  if (!canVoidClientPaymentReceipts(profile?.role)) return { ok: false, error: "Forbidden." };
  const supabase = await createSupabaseClient();
  const { error } = await supabase.rpc("void_client_payment_receipt", {
    p_receipt_id: receiptId,
    p_quotation_id: quotationId,
    p_order_no: orderNo,
    p_contract_total: contractTotal,
    p_reason: reason,
  });
  if (error) {
    logServerActionError("VOID CLIENT PAYMENT RECEIPT ERROR", error, { action: "voidClientPaymentReceipt", recordId: receiptId });
    return { ok: false, error: formatSafeActionError("Could not void receipt", error) };
  }
  refreshProject(orderNo);
  return { ok: true };
}
