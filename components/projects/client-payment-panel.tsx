"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, ChevronDown, ChevronUp, Download, Eye, Paperclip, Pencil, Plus, ReceiptText, Trash2, X } from "lucide-react";
import {
  deleteClientPaymentInstallment,
  moveClientPaymentInstallment,
  recordClientPaymentReceipt,
  saveClientPaymentInstallment,
  voidClientPaymentReceipt,
} from "@/lib/projects/client-payment-actions";
import {
  getClientPaymentReceiptAttachmentUrl,
  removeClientPaymentReceiptAttachment,
  uploadClientPaymentReceiptAttachment,
} from "@/lib/projects/client-payment-attachment-actions";
import {
  CLIENT_PAYMENT_DUE_TYPES,
  CLIENT_PAYMENT_METHODS,
  calculateClientPaymentSummary,
  clientPaymentDueLabel,
  deriveClientPaymentStatus,
  filsToDecimalString,
  formatPaymentMoney,
  moneyToFils,
  type ClientPaymentCalculationType,
  type ClientPaymentAttachmentRow,
  type ClientPaymentDueType,
  type ClientPaymentInstallmentRow,
  type ClientPaymentMethod,
  type ClientPaymentReceiptRow,
  type ClientPaymentScheduleRow,
} from "@/lib/projects/client-payment-model";

const DUE_LABELS: Record<ClientPaymentDueType, string> = {
  fixed_date: "Fixed date",
  project_confirmation: "Project confirmation",
  before_order: "Before order",
  before_delivery: "Before delivery",
  on_delivery: "On delivery",
  before_installation: "Before installation",
  after_installation: "After installation",
  handover: "Handover",
  custom: "Custom",
};

const METHOD_LABELS: Record<ClientPaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  cash: "Cash",
  card: "Card",
  online_payment: "Online payment",
  other: "Other",
};

const REFERENCE_RECOMMENDED_METHODS = new Set<ClientPaymentMethod>([
  "bank_transfer",
  "cheque",
  "card",
  "online_payment",
]);

type FormState = {
  title: string;
  calculationType: ClientPaymentCalculationType;
  percentage: string;
  fixedAmount: string;
  dueType: ClientPaymentDueType;
  dueDate: string;
  customDueDescription: string;
  note: string;
  statusOverride: "" | "waived" | "cancelled";
};

type ReceiptFormState = {
  amountReceived: string;
  receivedOn: string;
  paymentMethod: ClientPaymentMethod;
  referenceNumber: string;
  bankAccountNote: string;
  comment: string;
  idempotencyKey: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  calculationType: "percentage",
  percentage: "",
  fixedAmount: "",
  dueType: "project_confirmation",
  dueDate: "",
  customDueDescription: "",
  note: "",
  statusOverride: "",
};

const BIGINT_ZERO = BigInt(0);

function formatAuditTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

function formForInstallment(installment: ClientPaymentInstallmentRow): FormState {
  return {
    title: installment.title,
    calculationType: installment.calculation_type,
    percentage: installment.percentage === null ? "" : String(installment.percentage),
    fixedAmount: installment.calculation_type === "fixed" ? String(installment.expected_amount) : "",
    dueType: installment.due_type,
    dueDate: installment.due_date ?? "",
    customDueDescription: installment.custom_due_description ?? "",
    note: installment.note ?? "",
    statusOverride: installment.status_override ?? "",
  };
}

export function ClientPaymentNoAccess() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-zinc-950">Client payments</h2>
      <p className="mt-2 text-sm text-zinc-600">You do not have access to client payment schedules or receipt information.</p>
    </section>
  );
}

export function ClientPaymentPanel({
  schedule,
  installments,
  receipts,
  attachments,
  quotationId,
  orderNo,
  contractTotal,
  currency,
  paymentTerms,
  scheduleReadOnly,
  receiptsAllowed,
  canVoid,
  canManageAttachments,
}: {
  schedule: ClientPaymentScheduleRow | null;
  installments: ClientPaymentInstallmentRow[];
  receipts: ClientPaymentReceiptRow[];
  attachments: ClientPaymentAttachmentRow[];
  quotationId: string;
  orderNo: string;
  contractTotal: string;
  currency: string;
  paymentTerms: string | null;
  scheduleReadOnly: boolean;
  receiptsAllowed: boolean;
  canVoid: boolean;
  canManageAttachments: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ClientPaymentInstallmentRow | null | undefined>(undefined);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [receiptInstallment, setReceiptInstallment] = useState<ClientPaymentInstallmentRow | null>(null);
  const [receiptForm, setReceiptForm] = useState<ReceiptFormState | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [attachmentBusyId, setAttachmentBusyId] = useState<string | null>(null);
  const [attachmentErrors, setAttachmentErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const todayIso = new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => {
    return calculateClientPaymentSummary(contractTotal, installments, receipts, todayIso);
  }, [contractTotal, installments, receipts, todayIso]);

  const receiptExpected = receiptInstallment ? moneyToFils(receiptInstallment.expected_amount) : BIGINT_ZERO;
  const receiptAlreadyReceived = receiptInstallment
    ? summary.receivedByInstallment.get(receiptInstallment.id) ?? BIGINT_ZERO
    : BIGINT_ZERO;
  const receiptRemaining = receiptExpected > receiptAlreadyReceived
    ? receiptExpected - receiptAlreadyReceived
    : BIGINT_ZERO;
  const enteredReceiptAmount = receiptForm?.amountReceived
    ? moneyToFils(receiptForm.amountReceived)
    : BIGINT_ZERO;
  const receiptIsOverpayment = enteredReceiptAmount > receiptRemaining;
  const referenceRecommended = receiptForm
    ? REFERENCE_RECOMMENDED_METHODS.has(receiptForm.paymentMethod)
    : false;

  function openForm(installment: ClientPaymentInstallmentRow | null) {
    setEditing(installment);
    setForm(installment ? formForInstallment(installment) : EMPTY_FORM);
    setError(null);
  }

  function closeForm(force = false) {
    const initialForm = editing ? formForInstallment(editing) : EMPTY_FORM;
    if (!force && JSON.stringify(form) !== JSON.stringify(initialForm) && !window.confirm("Discard unsaved instalment changes?")) return;
    setEditing(undefined);
    setError(null);
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveClientPaymentInstallment({
        installmentId: editing?.id,
        quotationId,
        orderNo,
        contractTotal,
        title: form.title,
        calculationType: form.calculationType,
        percentage: form.percentage || null,
        fixedAmount: form.fixedAmount || null,
        dueType: form.dueType,
        dueDate: form.dueDate || null,
        customDueDescription: form.customDueDescription || null,
        note: form.note || null,
        statusOverride: form.statusOverride || null,
      });
      if (!result.ok) {
        if (result.staleContractTotal) {
          setError("Project File data was refreshed. Review the updated contract total, then submit again.");
          router.refresh();
        } else {
          setError(result.error);
        }
      } else {
        closeForm(true);
      }
    });
  }

  function runDelete(installment: ClientPaymentInstallmentRow) {
    if (!window.confirm(`Delete instalment "${installment.title}"?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteClientPaymentInstallment(installment.id, quotationId, orderNo, contractTotal);
      if (!result.ok) setError(result.error);
    });
  }

  function runMove(installment: ClientPaymentInstallmentRow, direction: -1 | 1) {
    setError(null);
    startTransition(async () => {
      const result = await moveClientPaymentInstallment(installment.id, quotationId, orderNo, contractTotal, direction);
      if (!result.ok) setError(result.error);
    });
  }

  function openReceiptForm(installment: ClientPaymentInstallmentRow) {
    setReceiptInstallment(installment);
    setReceiptForm({
      amountReceived: "",
      receivedOn: new Date().toISOString().slice(0, 10),
      paymentMethod: "bank_transfer",
      referenceNumber: "",
      bankAccountNote: "",
      comment: "",
      idempotencyKey: crypto.randomUUID(),
    });
    setError(null);
  }

  function closeReceiptForm(force = false) {
    if (
      !force
      && receiptForm
      && (receiptForm.amountReceived || receiptForm.referenceNumber || receiptForm.bankAccountNote || receiptForm.comment)
      && !window.confirm("Discard this unrecorded payment?")
    ) return;
    setReceiptInstallment(null);
    setReceiptForm(null);
    setError(null);
  }

  async function performReceiptSave(confirmOverpayment: boolean) {
    if (!receiptInstallment || !receiptForm) return;
    const result = await recordClientPaymentReceipt({
      installmentId: receiptInstallment.id,
      quotationId,
      orderNo,
      contractTotal,
      amountReceived: receiptForm.amountReceived,
      receivedOn: receiptForm.receivedOn,
      paymentMethod: receiptForm.paymentMethod,
      referenceNumber: receiptForm.referenceNumber || null,
      bankAccountNote: receiptForm.bankAccountNote || null,
      comment: receiptForm.comment || null,
      idempotencyKey: receiptForm.idempotencyKey,
      confirmOverpayment,
    });
    if (!result.ok && result.requiresOverpaymentConfirmation) {
      if (window.confirm("This receipt exceeds the remaining instalment balance. Record the overpayment?")) {
        await performReceiptSave(true);
      } else {
        setError("The receipt was not recorded.");
      }
    } else if (!result.ok) {
      setError(result.error);
    } else {
      closeReceiptForm(true);
      router.refresh();
    }
  }

  function submitReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(() => performReceiptSave(false));
  }

  function runVoid(receipt: ClientPaymentReceiptRow) {
    const reason = window.prompt("Reason for voiding this receipt:")?.trim();
    if (!reason) return;
    setError(null);
    startTransition(async () => {
      const result = await voidClientPaymentReceipt(receipt.id, quotationId, orderNo, contractTotal, reason);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function setAttachmentError(receiptId: string, message: string | null) {
    setAttachmentErrors((current) => {
      const next = { ...current };
      if (message) next[receiptId] = message;
      else delete next[receiptId];
      return next;
    });
  }

  function uploadAttachment(receipt: ClientPaymentReceiptRow, file: File | undefined) {
    if (!file) return;
    const allowedTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
    if (!allowedTypes.has(file.type)) {
      setAttachmentError(receipt.id, "Use a PDF, PNG, JPEG, or WebP file.");
      return;
    }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
      setAttachmentError(receipt.id, file.size <= 0 ? "Empty files cannot be uploaded." : "Receipt attachments must be 10 MB or smaller.");
      return;
    }
    setAttachmentBusyId(receipt.id);
    setAttachmentError(receipt.id, null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("receiptId", receipt.id);
      formData.set("quotationId", quotationId);
      formData.set("orderNo", orderNo);
      formData.set("file", file);
      const result = await uploadClientPaymentReceiptAttachment(formData);
      setAttachmentBusyId(null);
      if (!result.ok) setAttachmentError(receipt.id, result.error);
      else router.refresh();
    });
  }

  function openAttachment(receipt: ClientPaymentReceiptRow, attachment: ClientPaymentAttachmentRow, downloadFile: boolean) {
    setAttachmentBusyId(attachment.id);
    setAttachmentError(receipt.id, null);
    startTransition(async () => {
      const result = await getClientPaymentReceiptAttachmentUrl(attachment.id, receipt.id, quotationId, orderNo, downloadFile);
      setAttachmentBusyId(null);
      if (!result.ok) {
        setAttachmentError(receipt.id, result.error);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.rel = "noopener noreferrer";
      if (downloadFile) anchor.download = result.fileName;
      else anchor.target = "_blank";
      anchor.click();
    });
  }

  function removeAttachment(receipt: ClientPaymentReceiptRow, attachment: ClientPaymentAttachmentRow) {
    if (!window.confirm(`Remove attachment "${attachment.file_name}"?`)) return;
    setAttachmentBusyId(attachment.id);
    setAttachmentError(receipt.id, null);
    startTransition(async () => {
      const result = await removeClientPaymentReceiptAttachment(attachment.id, receipt.id, quotationId, orderNo);
      setAttachmentBusyId(null);
      if (!result.ok) setAttachmentError(receipt.id, result.error);
      else router.refresh();
    });
  }

  const tiles: Array<[string, bigint]> = [
    ["Contract total", summary.contract],
    ["Scheduled", summary.scheduled],
    ["Received", summary.received],
    ["Outstanding", summary.outstanding],
    ["Overdue", summary.overdue],
  ];

  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Client payments</p>
          <h2 className="mt-1 text-base font-semibold text-zinc-950">Payment schedule</h2>
        </div>
        {!scheduleReadOnly ? (
          <button type="button" onClick={() => openForm(null)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add instalment
          </button>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-zinc-950">{formatPaymentMoney(currency, value)}</dd>
          </div>
        ))}
      </dl>
      {summary.unscheduled > BIGINT_ZERO ? <p className="mt-2 text-xs font-medium text-amber-800">{formatPaymentMoney(currency, summary.unscheduled)} remains unscheduled.</p> : null}
      {scheduleReadOnly ? <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">This project schedule is read-only. Authorised late receipts remain available for completed projects.</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}

      <div className="mt-4 space-y-2">
        {installments.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">No instalments have been added.</p>
        ) : installments.map((installment, index) => {
          const received = summary.receivedByInstallment.get(installment.id) ?? BIGINT_ZERO;
          const expected = moneyToFils(installment.expected_amount);
          const balance = expected > received ? expected - received : BIGINT_ZERO;
          const status = deriveClientPaymentStatus(installment, received, todayIso);
          const installmentReceipts = receipts.filter((receipt) => receipt.installment_id === installment.id);
          return (
            <article key={installment.id} className="min-w-0 rounded-md border border-zinc-200 p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-950"><span className="mr-2 text-zinc-400">{installment.sequence_no}.</span>{installment.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {installment.calculation_type === "percentage" ? `${installment.percentage}% · ` : ""}{formatPaymentMoney(currency, expected)} · Due: {clientPaymentDueLabel(installment)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700">{status}</span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <div><dt className="text-zinc-500">Received</dt><dd className="mt-0.5 font-semibold text-zinc-900">{formatPaymentMoney(currency, received)}</dd></div>
                <div><dt className="text-zinc-500">Balance</dt><dd className="mt-0.5 font-semibold text-zinc-900">{formatPaymentMoney(currency, balance)}</dd></div>
                <div className="col-span-2 sm:col-span-1"><dt className="text-zinc-500">Receipts</dt><dd className="mt-0.5 font-semibold text-zinc-900">{installmentReceipts.length}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {receiptsAllowed && installment.status_override === null ? <button type="button" onClick={() => openReceiptForm(installment)} className="inline-flex min-h-10 items-center gap-1 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white"><ReceiptText className="h-3.5 w-3.5" aria-hidden="true" /> Add receipt</button> : null}
                {installmentReceipts.length > 0 ? <button type="button" onClick={() => setExpandedHistory(expandedHistory === installment.id ? null : installment.id)} className="inline-flex min-h-10 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700">{expandedHistory === installment.id ? "Hide history" : "View history"}</button> : null}
                {!scheduleReadOnly ? <>
                  <button type="button" onClick={() => openForm(installment)} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700"><Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit</button>
                  <button type="button" disabled={index === 0 || isPending} onClick={() => runMove(installment, -1)} aria-label={`Move ${installment.title} up`} className="inline-flex min-h-10 items-center rounded-md border border-zinc-200 px-3 text-zinc-700 disabled:opacity-40"><ChevronUp className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" disabled={index === installments.length - 1 || isPending} onClick={() => runMove(installment, 1)} aria-label={`Move ${installment.title} down`} className="inline-flex min-h-10 items-center rounded-md border border-zinc-200 px-3 text-zinc-700 disabled:opacity-40"><ChevronDown className="h-4 w-4" aria-hidden="true" /></button>
                  <button type="button" disabled={receipts.some((receipt) => receipt.installment_id === installment.id) || isPending} onClick={() => runDelete(installment)} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete</button>
                </> : null}
              </div>
              {expandedHistory === installment.id ? (
                <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
                  {installmentReceipts.map((receipt) => (
                    <div key={receipt.id} className={`rounded-md border p-3 text-xs ${receipt.voided_at ? "border-red-200 bg-red-50" : "border-zinc-200 bg-zinc-50"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="font-semibold text-zinc-900">{formatPaymentMoney(currency, moneyToFils(receipt.amount_received))}</p><p className="mt-1 text-zinc-500">{receipt.received_on} · {METHOD_LABELS[receipt.payment_method]}</p></div>
                        {receipt.voided_at ? <span className="rounded-full bg-red-100 px-2 py-1 font-bold text-red-700">Voided</span> : canVoid ? <button type="button" disabled={isPending} onClick={() => runVoid(receipt)} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-red-200 px-3 font-semibold text-red-700"><Ban className="h-3.5 w-3.5" aria-hidden="true" /> Void</button> : null}
                      </div>
                      {receipt.reference_number ? <p className="mt-2 text-zinc-600"><span className="font-semibold">Reference:</span> {receipt.reference_number}</p> : null}
                      {receipt.bank_account_note ? <p className="mt-1 text-zinc-600"><span className="font-semibold">Bank or account details:</span> {receipt.bank_account_note}</p> : null}
                      {receipt.comment ? <p className="mt-1 text-zinc-600">{receipt.comment}</p> : null}
                      {receipt.void_reason ? <p className="mt-2 font-medium text-red-700">Void reason: {receipt.void_reason}</p> : null}
                      <p className="mt-2 break-all text-[10px] text-zinc-400">Recorded {formatAuditTimestamp(receipt.created_at)} · Actor {receipt.recorded_by}{receipt.voided_at ? ` · Voided ${formatAuditTimestamp(receipt.voided_at)}${receipt.voided_by ? ` by ${receipt.voided_by}` : ""}` : ""}</p>
                      <div className="mt-3 border-t border-zinc-200/80 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-zinc-800">Attachments</p>
                          {canManageAttachments && !receipt.voided_at ? (
                            <label className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 font-semibold text-zinc-700">
                              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                              {attachmentBusyId === receipt.id ? "Uploading..." : "Add attachment"}
                              <input
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                                disabled={attachmentBusyId !== null || isPending}
                                className="sr-only"
                                onChange={(event) => {
                                  uploadAttachment(receipt, event.target.files?.[0]);
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-2">
                          {attachments.filter((attachment) => attachment.receipt_id === receipt.id).map((attachment) => (
                            <div key={attachment.id} className="min-w-0 rounded-md border border-zinc-200 bg-white p-2.5">
                              <p className="truncate font-semibold text-zinc-900" title={attachment.file_name}>{attachment.file_name}</p>
                              <p className="mt-1 text-[10px] text-zinc-500">
                                {attachment.file_size_bytes === null ? "Size unavailable" : `${Math.max(1, Math.ceil(attachment.file_size_bytes / 1024)).toLocaleString("en-GB")} KB`}
                                {` · Uploaded by ${attachment.uploader_label} · ${formatAuditTimestamp(attachment.created_at)}`}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button type="button" disabled={attachmentBusyId !== null} onClick={() => openAttachment(receipt, attachment, false)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-zinc-200 px-2.5 font-semibold text-zinc-700"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> View</button>
                                <button type="button" disabled={attachmentBusyId !== null} onClick={() => openAttachment(receipt, attachment, true)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-zinc-200 px-2.5 font-semibold text-zinc-700"><Download className="h-3.5 w-3.5" aria-hidden="true" /> Download</button>
                                {canManageAttachments ? <button type="button" disabled={attachmentBusyId !== null} onClick={() => removeAttachment(receipt, attachment)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-red-200 px-2.5 font-semibold text-red-700"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove</button> : null}
                              </div>
                            </div>
                          ))}
                          {attachments.every((attachment) => attachment.receipt_id !== receipt.id) ? <p className="text-zinc-500">No attachments.</p> : null}
                        </div>
                        {attachmentErrors[receipt.id] ? <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-red-800">{attachmentErrors[receipt.id]}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <details className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-zinc-700">Existing quotation payment terms</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{paymentTerms?.trim() || "No payment terms recorded."}</p>
      </details>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-100 bg-violet-50 p-3 text-xs text-violet-900">
        <span>Vendor payment amounts remain separate and are not stored in the current Procurement ledger.</span>
        <Link href={`/procurement/orders/${encodeURIComponent(orderNo)}`} className="font-semibold underline">Open Procurement</Link>
      </div>

      {editing !== undefined ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="installment-form-title">
          <form onSubmit={submitForm} className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 shadow-xl sm:max-w-xl sm:rounded-xl sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 id="installment-form-title" className="text-base font-semibold text-zinc-950">{editing ? "Edit instalment" : "Add instalment"}</h3>
              <button type="button" onClick={() => closeForm()} aria-label="Close instalment form" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"><X className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label>
              <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-1 text-xs font-semibold text-zinc-700">Calculation</legend>{(["percentage", "fixed"] as const).map((type) => <label key={type} className="flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 px-3 text-sm"><input type="radio" checked={form.calculationType === type} onChange={() => setForm({ ...form, calculationType: type })} />{type === "percentage" ? "Percentage" : "Fixed amount"}</label>)}</fieldset>
              {form.calculationType === "percentage" ? <label className="grid gap-1 text-xs font-semibold text-zinc-700">Percentage<input required type="number" min="0.0001" max="100" step="0.0001" inputMode="decimal" value={form.percentage} onChange={(event) => setForm({ ...form, percentage: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label> : <label className="grid gap-1 text-xs font-semibold text-zinc-700">Expected amount ({currency})<input required type="number" min="0" step="0.01" inputMode="decimal" value={form.fixedAmount} onChange={(event) => setForm({ ...form, fixedAmount: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label>}
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Due trigger<select value={form.dueType} onChange={(event) => setForm({ ...form, dueType: event.target.value as ClientPaymentDueType })} className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal">{CLIENT_PAYMENT_DUE_TYPES.map((type) => <option key={type} value={type}>{DUE_LABELS[type]}</option>)}</select></label>
              {form.dueType === "fixed_date" ? <label className="grid gap-1 text-xs font-semibold text-zinc-700">Due date<input required type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label> : null}
              {form.dueType === "custom" ? <label className="grid gap-1 text-xs font-semibold text-zinc-700">Custom due description<input required value={form.customDueDescription} onChange={(event) => setForm({ ...form, customDueDescription: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label> : null}
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Status override<select value={form.statusOverride} onChange={(event) => setForm({ ...form, statusOverride: event.target.value as FormState["statusOverride"] })} className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal"><option value="">Automatic</option><option value="waived">Waived</option><option value="cancelled">Cancelled</option></select></label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Note<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-normal" /></label>
            </div>
            {error ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => closeForm()} className="min-h-11 rounded-md border border-zinc-300 text-sm font-semibold text-zinc-700">Cancel</button><button disabled={isPending} className="min-h-11 rounded-md bg-emerald-900 text-sm font-semibold text-white disabled:opacity-60">{isPending ? "Saving..." : "Save instalment"}</button></div>
          </form>
        </div>
      ) : null}
      {receiptInstallment && receiptForm ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-form-title">
          <form onSubmit={submitReceipt} className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 shadow-xl sm:max-w-xl sm:rounded-xl sm:p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Record payment</p><h3 id="receipt-form-title" className="mt-1 text-base font-semibold text-zinc-950">{receiptInstallment.title}</h3></div><button type="button" onClick={() => closeReceiptForm()} aria-label="Close receipt form" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100"><X className="h-5 w-5" aria-hidden="true" /></button></div>
            <div className="mt-4 grid gap-4">
              <dl className="grid grid-cols-3 gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs">
                <div className="min-w-0"><dt className="text-zinc-500">Expected</dt><dd className="mt-1 break-words font-semibold text-zinc-900">{formatPaymentMoney(currency, receiptExpected)}</dd></div>
                <div className="min-w-0"><dt className="text-zinc-500">Already received</dt><dd className="mt-1 break-words font-semibold text-zinc-900">{formatPaymentMoney(currency, receiptAlreadyReceived)}</dd></div>
                <div className="min-w-0"><dt className="text-zinc-500">Remaining</dt><dd className="mt-1 break-words font-semibold text-zinc-900">{formatPaymentMoney(currency, receiptRemaining)}</dd></div>
              </dl>
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Received amount ({currency})<input required type="number" min="0.01" step="0.01" inputMode="decimal" value={receiptForm.amountReceived} onChange={(event) => setReceiptForm({ ...receiptForm, amountReceived: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label>
              <button type="button" disabled={receiptRemaining <= BIGINT_ZERO} onClick={() => setReceiptForm({ ...receiptForm, amountReceived: filsToDecimalString(receiptRemaining) })} className="min-h-10 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 disabled:opacity-50">Use remaining balance</button>
              {receiptIsOverpayment ? <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Entered amount exceeds the remaining balance by {formatPaymentMoney(currency, enteredReceiptAmount - receiptRemaining)}. Explicit confirmation will be required.</p> : null}
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Received date<input required type="date" value={receiptForm.receivedOn} onChange={(event) => setReceiptForm({ ...receiptForm, receivedOn: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Payment method<select value={receiptForm.paymentMethod} onChange={(event) => setReceiptForm({ ...receiptForm, paymentMethod: event.target.value as ClientPaymentMethod })} className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm font-normal">{CLIENT_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{METHOD_LABELS[method]}</option>)}</select></label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Reference number{referenceRecommended ? <span className="font-normal text-amber-700">Recommended for {METHOD_LABELS[receiptForm.paymentMethod].toLowerCase()}.</span> : null}<input value={receiptForm.referenceNumber} onChange={(event) => setReceiptForm({ ...receiptForm, referenceNumber: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Bank or account details<input value={receiptForm.bankAccountNote} onChange={(event) => setReceiptForm({ ...receiptForm, bankAccountNote: event.target.value })} className="h-11 rounded-md border border-zinc-300 px-3 text-sm font-normal" /></label>
              <label className="grid gap-1 text-xs font-semibold text-zinc-700">Comment<textarea rows={3} value={receiptForm.comment} onChange={(event) => setReceiptForm({ ...receiptForm, comment: event.target.value })} className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-normal" /></label>
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">Record the payment first, then add receipt evidence from its expandable history.</p>
            </div>
            {error ? <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => closeReceiptForm()} className="min-h-11 rounded-md border border-zinc-300 text-sm font-semibold text-zinc-700">Cancel</button><button disabled={isPending} className="min-h-11 rounded-md bg-emerald-900 text-sm font-semibold text-white disabled:opacity-60">{isPending ? "Recording..." : "Record payment"}</button></div>
          </form>
        </div>
      ) : null}
      <span className="sr-only">Schedule reference: {schedule?.id ?? "not created"}</span>
    </section>
  );
}
