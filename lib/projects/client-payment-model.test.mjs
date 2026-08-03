import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateClientPaymentSummary,
  deriveClientPaymentStatus,
  moneyToFils,
} from "./client-payment-model.ts";

function installment(overrides = {}) {
  return {
    id: "installment-1",
    schedule_id: "schedule-1",
    sequence_no: 1,
    title: "Before delivery",
    calculation_type: "fixed",
    percentage: null,
    expected_amount: "22246.00",
    due_type: "before_delivery",
    due_date: null,
    custom_due_description: null,
    due_triggered_at: null,
    status_override: null,
    note: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function receipt(id, amount, overrides = {}) {
  return {
    id,
    schedule_id: "schedule-1",
    installment_id: "installment-1",
    amount_received: amount,
    received_on: "2026-09-02",
    payment_method: "bank_transfer",
    reference_number: null,
    bank_account_note: null,
    comment: null,
    recorded_by: "user-1",
    created_at: "2026-09-02T00:00:00Z",
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  };
}

test("multiple valid receipts remain separate and sum without floating-point arithmetic", () => {
  const receipts = [receipt("receipt-1", "10000.00"), receipt("receipt-2", "7000.00")];
  const summary = calculateClientPaymentSummary("30000.00", [installment()], receipts, "2026-09-10");

  assert.equal(receipts.length, 2);
  assert.equal(summary.receivedByInstallment.get("installment-1"), moneyToFils("17000.00"));
  assert.equal(summary.received, moneyToFils("17000.00"));
  assert.equal(summary.outstanding, moneyToFils("13000.00"));
  assert.equal(moneyToFils("22246.00") - summary.received, moneyToFils("5246.00"));
});

test("voided receipts remain in history but are excluded from totals", () => {
  const receipts = [
    receipt("receipt-1", "10000.00"),
    receipt("receipt-2", "7000.00", {
      voided_at: "2026-09-11T00:00:00Z",
      voided_by: "owner-1",
      void_reason: "Incorrect bank entry",
    }),
  ];
  const summary = calculateClientPaymentSummary("30000.00", [installment()], receipts, "2026-09-12");

  assert.equal(receipts.length, 2);
  assert.equal(summary.received, moneyToFils("10000.00"));
});

test("all client payment statuses derive correctly", () => {
  const today = "2026-09-10";
  assert.equal(deriveClientPaymentStatus(installment(), moneyToFils("0"), today), "Planned");
  assert.equal(deriveClientPaymentStatus(installment({ due_type: "project_confirmation" }), moneyToFils("0"), today), "Due");
  assert.equal(deriveClientPaymentStatus(installment(), moneyToFils("10000"), today), "Partially paid");
  assert.equal(deriveClientPaymentStatus(installment(), moneyToFils("22246"), today), "Paid");
  assert.equal(deriveClientPaymentStatus(installment({ due_type: "fixed_date", due_date: "2026-09-09" }), moneyToFils("0"), today), "Overdue");
  assert.equal(deriveClientPaymentStatus(installment({ status_override: "waived" }), moneyToFils("0"), today), "Waived");
  assert.equal(deriveClientPaymentStatus(installment({ status_override: "cancelled" }), moneyToFils("0"), today), "Cancelled");
});
