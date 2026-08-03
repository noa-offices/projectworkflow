import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClientPaymentAttachmentManager } from "./client-payment-attachment-permissions.ts";

test("only System Owner and Admin Manager can manage receipt attachments", () => {
  assert.equal(isClientPaymentAttachmentManager("system_owner"), true);
  assert.equal(isClientPaymentAttachmentManager("admin_manager"), true);
  assert.equal(isClientPaymentAttachmentManager("viewer"), false);
  assert.equal(isClientPaymentAttachmentManager("procurement_manager"), false);
  assert.equal(isClientPaymentAttachmentManager("sales_designer"), false);
  assert.equal(isClientPaymentAttachmentManager("sales_person"), false);
  assert.equal(isClientPaymentAttachmentManager("sales_coordinator"), false);
  assert.equal(isClientPaymentAttachmentManager("designer"), false);
  assert.equal(isClientPaymentAttachmentManager(null), false);
});

test("the correction keeps attachment removal scoped and leaves receipts and Storage policies unchanged", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/093_admin_manager_client_payment_attachment_removal.sql", import.meta.url),
    "utf8",
  );
  const bucketMigration = readFileSync(
    new URL("../../supabase/migrations/091_client_payment_receipt_attachments.sql", import.meta.url),
    "utf8",
  );
  const action = readFileSync(new URL("./client-payment-attachment-actions.ts", import.meta.url), "utf8");
  const panel = readFileSync(
    new URL("../../components/projects/client-payment-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(migration, /current_user_role\(\) in \('system_owner', 'admin_manager'\)/);
  assert.match(migration, /current_account_status\(\) = 'active'/);
  assert.match(migration, /delete from public\.client_payment_receipt_attachments a/);
  assert.match(migration, /a\.id = p_attachment_id/);
  assert.match(migration, /a\.receipt_id = p_receipt_id/);
  assert.match(migration, /r\.id = a\.receipt_id/);
  assert.match(migration, /i\.id = r\.installment_id/);
  assert.match(migration, /s\.quotation_id = p_quotation_id/);
  assert.match(migration, /s\.order_no = btrim\(p_order_no\)/);
  assert.doesNotMatch(migration, /delete from public\.client_payment_receipts/);
  assert.doesNotMatch(migration, /update public\.client_payment_receipts/);
  assert.doesNotMatch(migration, /delete from public\.client_payment_installments/);
  assert.doesNotMatch(migration, /update public\.client_payment_installments/);
  assert.doesNotMatch(migration, /amount_received/);
  assert.doesNotMatch(migration, /storage\.objects/);
  assert.doesNotMatch(migration, /voided_at/);
  assert.match(bucketMigration, /No storage\.objects policies are created for this bucket/);
  assert.doesNotMatch(bucketMigration, /create policy[\s\S]*on storage\.objects/i);
  assert.match(action, /remove\(\[attachment\.storage_path\]\)/);
  assert.match(action, /Storage object was not removed; metadata was preserved/);
  assert.match(action, /Storage object was removed, but its recoverable metadata record remains/);
  assert.match(panel, /window\.confirm\(`Remove attachment/);
});
