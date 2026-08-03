import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_PAYMENT_ATTACHMENT_MAX_SIZE,
  clientPaymentAttachmentHasExpectedSignature,
  safeClientPaymentAttachmentFilename,
} from "./client-payment-attachment-model.ts";

test("allows only matching receipt evidence extensions and keeps original names out of object paths", () => {
  assert.equal(safeClientPaymentAttachmentFilename("Bank transfer advice.pdf", "application/pdf"), "receipt-evidence.pdf");
  assert.equal(safeClientPaymentAttachmentFilename("cheque.JPG", "image/jpeg"), "receipt-evidence.jpg");
  assert.equal(safeClientPaymentAttachmentFilename("evidence.svg", "image/svg+xml"), null);
  assert.equal(safeClientPaymentAttachmentFilename("fake.jpg", "application/pdf"), null);
});

test("checks PDF, PNG, JPEG and WebP signatures", () => {
  assert.equal(clientPaymentAttachmentHasExpectedSignature(new TextEncoder().encode("%PDF-1.7"), "application/pdf"), true);
  assert.equal(clientPaymentAttachmentHasExpectedSignature(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"), true);
  assert.equal(clientPaymentAttachmentHasExpectedSignature(Uint8Array.from([255, 216, 255]), "image/jpeg"), true);
  assert.equal(clientPaymentAttachmentHasExpectedSignature(new TextEncoder().encode("RIFF0000WEBP"), "image/webp"), true);
  assert.equal(clientPaymentAttachmentHasExpectedSignature(new TextEncoder().encode("<html>"), "application/pdf"), false);
});

test("uses the approved ten megabyte application limit", () => {
  assert.equal(CLIENT_PAYMENT_ATTACHMENT_MAX_SIZE, 10 * 1024 * 1024);
});
