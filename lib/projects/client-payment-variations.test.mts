import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  calculateClientPaymentSummary,
  describeClientPaymentVariations,
  formatSignedPaymentMoney,
  variationWithoutInstalmentNote,
  type ClientPaymentInstallmentRow,
  type ClientPaymentReceiptRow,
} from "./client-payment-model";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migrationPath = "supabase/migrations/20261109100000_client_payment_variation_instalments.sql";
const migration = read(migrationPath);
const m089 = read("supabase/migrations/089_client_payment_schedule.sql");
const m090 = read("supabase/migrations/090_client_payment_receipt_workflow.sql");
const m092 = read("supabase/migrations/092_client_payment_contract_total_guard.sql");
const snapshotMigration = read("supabase/migrations/20261107100000_project_snapshots.sql");
const variationMigration = read("supabase/migrations/20261108100000_project_variations.sql");
const snapshotTest = read("lib/quotations/project-snapshot.test.mts");
const schema = snapshotTest.slice(snapshotTest.indexOf("const schema = `") + "const schema = `".length, snapshotTest.indexOf("`;\nbefore(async"));

// ---- Pure rules ----

const installment = (id: string, amount: string, extra: Partial<ClientPaymentInstallmentRow> = {}): ClientPaymentInstallmentRow => ({
  id, schedule_id: "s", sequence_no: 1, title: "T", calculation_type: "fixed", percentage: null, expected_amount: amount, due_type: "project_confirmation", due_date: null,
  custom_due_description: null, due_triggered_at: null, status_override: null, note: null, created_at: "2026-11-05", updated_at: "2026-11-05", ...extra,
});
const receipt = (installmentId: string, amount: string): ClientPaymentReceiptRow => ({
  id: `r-${installmentId}`, schedule_id: "s", installment_id: installmentId, amount_received: amount, received_on: "2026-11-05", payment_method: "cash", reference_number: null,
  bank_account_note: null, comment: null, recorded_by: "u", created_at: "2026-11-05", voided_at: null, voided_by: null, void_reason: null,
});

test("a Project without an applied variation: the summary is exactly what it was, and the variation view is off", () => {
  const rows = [installment("a", "300.00", { calculation_type: "percentage", percentage: 30 }), installment("b", "200.00")];
  const summary = calculateClientPaymentSummary("1000.00", rows, [receipt("a", "100.00")], "2026-11-05");
  assert.equal(summary.contract, BigInt(100000)); assert.equal(summary.scheduled, BigInt(50000)); assert.equal(summary.received, BigInt(10000));
  assert.equal(summary.outstanding, BigInt(90000)); assert.equal(summary.unscheduled, BigInt(50000)); assert.equal(summary.overdue, BigInt(0));
  assert.equal(describeClientPaymentVariations("1000.00", "1000.00", [], rows, summary.scheduled), null);
});

test("one applied variation: original, variations and revised add up; the balance uses the revised total", () => {
  const variation = { id: "v1", variation_no: 1, contract_delta: "157.50" };
  const rows = [installment("a", "63.00", { calculation_type: "percentage", percentage: 30 })];
  const summary = calculateClientPaymentSummary("367.50", rows, [receipt("a", "63.00")], "2026-11-05");
  const view = describeClientPaymentVariations("210", "367.50", [variation], rows, summary.scheduled)!;
  assert.deepEqual([view.original, view.variations, view.revised], [BigInt(21000), BigInt(15750), BigInt(36750)]);
  assert.equal(view.original + view.variations, view.revised);
  assert.deepEqual(view.lines, [{ id: "v1", variationNo: 1, delta: BigInt(15750), needsInstalment: true, canAddInstalment: true }]);
  assert.equal(summary.outstanding, BigInt(30450), "revised total minus received");
  assert.equal(summary.unscheduled, BigInt(30450));
  assert.equal(view.overScheduled, BigInt(0));
  assert.equal(formatSignedPaymentMoney("AED", view.variations), "+AED 157.50");
});

test("a variation that has an instalment no longer asks for one", () => {
  const rows = [installment("a", "157.50", { variation_id: "v1" })];
  const view = describeClientPaymentVariations("210", "367.50", [{ id: "v1", variation_no: 1, contract_delta: 157.5 }], rows, BigInt(15750))!;
  assert.equal(view.lines[0].needsInstalment, false);
});

test("two applied variations: the revised total is the latest, each variation is its own line, in order", () => {
  const view = describeClientPaymentVariations("210", "500", [{ id: "v2", variation_no: 2, contract_delta: "132.50" }, { id: "v1", variation_no: 1, contract_delta: "157.50" }], [installment("a", "157.50", { variation_id: "v1" })], BigInt(15750))!;
  assert.deepEqual(view.lines.map((line) => [line.variationNo, line.needsInstalment]), [[1, false], [2, true]]);
  assert.equal(view.variations, BigInt(29000));
  assert.equal(view.lines.reduce((sum, line) => sum + line.delta, BigInt(0)), view.variations, "the deltas add up to the variations figure");
});

test("a credit or zero variation gets no instalment, only a plain note", () => {
  const credit = describeClientPaymentVariations("210", "105", [{ id: "v1", variation_no: 1, contract_delta: "-105" }], [], BigInt(0))!;
  assert.equal(credit.lines[0].canAddInstalment, false);
  assert.equal(credit.variations, BigInt(-10500));
  assert.equal(formatSignedPaymentMoney("AED", credit.variations), "-AED 105.00");
  assert.equal(variationWithoutInstalmentNote("AED", 1, credit.lines[0].delta), "Variation V1 reduces the contract by AED 105.00. Adjust the remaining instalments by hand.");
  assert.equal(describeClientPaymentVariations("210", "210", [{ id: "v1", variation_no: 1, contract_delta: "0" }], [], BigInt(0))!.lines[0].canAddInstalment, false);
  assert.equal(variationWithoutInstalmentNote("AED", 3, BigInt(0)), "Variation V3 does not change the contract total. No instalment is needed.");
});

test("instalments above the revised total are reported by how much", () => {
  const view = describeClientPaymentVariations("210", "367.50", [{ id: "v1", variation_no: 1, contract_delta: "157.50" }], [], BigInt(37000))!;
  assert.equal(view.overScheduled, BigInt(250));
});

test("the Payments tab and the Project page: new rows only with a variation, the grey C2a note is gone", () => {
  const panel = read("components/projects/client-payment-panel.tsx");
  const page = read("app/projects/orders/[orderNo]/page.tsx");
  for (const label of ["Original contract", "Variations", "Revised contract total", "Balance", "Add instalment for Variation V"]) assert.ok(panel.includes(label), label);
  for (const label of ['"Contract total"', '"Outstanding"', '"Scheduled"', '"Received"', '"Overdue"']) assert.ok(panel.includes(label), label);
  assert.ok(panel.includes('["Contract total", formatPaymentMoney(currency, summary.contract)]') && panel.includes("lg:grid-cols-5"), "the five tiles of today remain the other branch");
  assert.ok(!page.includes("paymentsNote") && !page.includes("Updating it for variations comes in the next step"));
  assert.ok(page.includes('let clientPaymentContractTotal = String(entry.order.total);'), "no variation: the Project File total exactly as before");
  assert.ok(page.includes("originalContractTotal={clientPaymentOriginalTotal}"));
  const actions = read("lib/projects/client-payment-actions.ts");
  assert.ok(actions.includes('"add_client_payment_variation_instalment"') && actions.includes("staleContractTotal"));
});

// ---- The migration text ----

function cut(text: string, name: string) {
  const start = text.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  const end = text.indexOf("\n$$;\n", start) + "\n$$;\n".length;
  return text.slice(start, end);
}
/** Lines only in the old text and lines only in the new text (a function is only edited by replacing or inserting lines). */
function lineDiff(before: string, after: string) {
  const count = (text: string) => { const map = new Map<string, number>(); for (const line of text.split("\n")) map.set(line, (map.get(line) ?? 0) + 1); return map; };
  const a = count(before), b = count(after), removed: string[] = [], added: string[] = [];
  for (const [line, n] of a) for (let i = 0; i < n - (b.get(line) ?? 0); i += 1) removed.push(line);
  for (const [line, n] of b) for (let i = 0; i < n - (a.get(line) ?? 0); i += 1) added.push(line);
  return { removed, added };
}
const percentLine = (base: string) => `    v_expected := round(${base} * p_percentage / 100, 2);`;
const originalTotalCall = "public.client_payment_project_original_total(p_quotation_id, p_order_no)";

test("the migration changes the three existing functions only on the lines described", () => {
  const context = lineDiff(cut(m092, "client_payment_project_context"), cut(migration, "client_payment_project_context"));
  assert.deepEqual(context.removed, []);
  assert.deepEqual([...context.added].sort(), [...[
    "  v_revised_total numeric;",
    "  -- A Project with an applied variation is paid against its revised contract total: the latest applied variation's new_contract_total.",
    "  select v.new_contract_total into v_revised_total",
    "  from public.project_variations v",
    "  join public.project_snapshots s on s.id = v.snapshot_id",
    "  where s.quotation_id = p_quotation_id",
    "  order by v.variation_no desc",
    "  limit 1;",
    "  if v_revised_total is not null then",
    "    v_total := round(v_revised_total, 2)::numeric(14,2);",
    "  end if;",
  ]].sort());
  for (const name of ["add_client_payment_installment", "update_client_payment_installment"]) {
    const diff = lineDiff(cut(m089, name), cut(migration, name));
    assert.deepEqual(diff.removed, [percentLine("v_context.contract_total")], name);
    assert.deepEqual(diff.added, [percentLine(originalTotalCall)], name);
  }
  assert.ok(!cut(migration, "add_client_payment_installment").includes("original_total(p_quotation_id, p_order_no) > "), "the cap is untouched");
});

test("the migration keeps every old error message, the cap on the revised total, and the signature and security of the context", () => {
  const context = cut(migration, "client_payment_project_context");
  for (const message of ["Confirmed quotation not found.", "Project File does not belong to this quotation.", "Project File contract total is invalid.", "Project File contract total has changed. Reload before continuing."]) assert.ok(context.includes(message), message);
  assert.ok(context.includes("returns table (contract_total numeric, is_completed boolean, is_cancelled boolean, currency text)"));
  assert.ok(context.includes("security definer") && context.includes("set search_path = public"));
  for (const name of ["add_client_payment_installment", "update_client_payment_installment"]) {
    const body = cut(migration, name);
    assert.ok(body.includes("> v_context.contract_total then"), "the cap uses the context (revised) total");
    assert.ok(body.includes("Scheduled total cannot exceed the Project File contract total."));
  }
});

test("the migration grants: the context and the original-total helper are private; the new function is for signed-in users; the others keep theirs", () => {
  assert.ok(migration.includes("revoke all on function public.client_payment_project_context(uuid, text, numeric) from public, anon, authenticated;"));
  assert.ok(migration.includes("revoke all on function public.client_payment_project_original_total(uuid, text) from public, anon, authenticated;"));
  assert.ok(migration.includes("revoke all on function public.add_client_payment_variation_instalment(uuid, text, numeric, integer) from public, anon;"));
  assert.ok(migration.includes("grant execute on function public.add_client_payment_variation_instalment(uuid, text, numeric, integer) to authenticated;"));
  assert.ok(!/grant execute on function public\.client_payment_(project_context|project_original_total)/.test(migration));
  assert.deepEqual([...migration.matchAll(/grant execute on function public\.(\w+)\(/g)].map((match) => match[1]).sort(), ["add_client_payment_installment", "add_client_payment_variation_instalment", "update_client_payment_installment"]);
  for (const name of ["client_payment_project_original_total", "add_client_payment_variation_instalment"]) {
    const body = cut(migration, name);
    assert.ok(body.includes("security definer") && body.includes("set search_path = public"), name);
  }
  assert.ok(cut(migration, "add_client_payment_variation_instalment").includes("current_user_can_manage_client_payment_installments()"), "role-checked like add_client_payment_installment");
});

test("one instalment per variation is a database rule, and nothing outside the payment functions is touched", () => {
  assert.ok(migration.includes("unique (variation_id)") && migration.includes("references public.project_variations(id) on delete restrict"));
  assert.ok(migration.includes("add column if not exists variation_id uuid"));
  const code = migration.replace(/--.*\n/g, "\n");
  assert.ok(!/(function|table|policy|on) +public\.(record_client_payment|void_client_payment|delete_client_payment|move_client_payment|client_payment_receipt|client_payment_schedules)/.test(code), "receipts, voiding, attachments, delete and move are not defined or altered here");
  assert.ok(!/attachment/.test(code));
  assert.equal(code.match(/client_payment_receipts/g)?.length, 1, "receipts are only read, inside the unchanged update function");
  assert.ok(!/apply_project_variation|project_variation_(sections|items|match|state|preview)|alter table public\.project_(snapshots|variations)|create (or replace )?function public\.project_/.test(migration.replace(/--.*\n/g, "\n")));
  assert.ok(!/ \? ['(]|->>?\s*\?/.test(migration), "no ? operator; jsonb_exists is the safe form");
  assert.ok(migration.startsWith("begin;") && migration.trimEnd().endsWith("commit;"));
  assert.ok(!/insert into public[.]quotations|update public[.]quotations/.test(migration), "no Project File record is written");
});

// ---- Run in an in-memory test database (never the live one) ----

const ids = { owner: "00000000-0000-4000-8000-000000000001", designer: "00000000-0000-4000-8000-000000000002", viewer: "00000000-0000-4000-8000-000000000003", client: "00000000-0000-4000-8000-0000000000c1" };
const uuid = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const projectFileOf = (id: string, orderNo: string, total: number) => ({ orderNo, quotationId: id, quotationNo: `QN-${orderNo}`, clientId: ids.client, clientName: "Client", reference: "Office", total, currency: "AED", createdAt: "2026-11-04", createdBy: ids.owner });
const receiptSlice = m090.slice(0, m090.indexOf("drop policy if exists audit_activity_log_select_active_users"));
const toNumber = (value: unknown) => Number(value);

/** A fresh test database with the payment schema; `withC2b` adds this step's migration. */
async function makeDb(withC2b: boolean) {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec("alter table public.profiles add column full_name text; alter table public.audit_activity_log add column parent_entity_type text, add column parent_entity_id uuid;");
  await db.exec("create function public.current_account_status() returns text language sql stable security definer set search_path=public as $$ select account_status from public.profiles where id = auth.uid() $$;");
  await db.query("insert into public.profiles(id,role,account_status,full_name) values($1,'system_owner','active','Owner'),($2,'designer','active','Sara'),($3,'viewer','active','View')", [ids.owner, ids.designer, ids.viewer]);
  await db.query("insert into public.clients(id,company_name) values($1,'Client')", [ids.client]);
  await db.exec(snapshotMigration);
  await db.exec(variationMigration);
  await db.exec(m089);
  await db.exec(receiptSlice);
  await db.exec(m092);
  if (withC2b) await db.exec(migration);
  return db;
}

async function addQuotation(db: PGlite, n: number, layout: object, grand: number, vat: number, options: { no?: string; status?: string; lines?: Array<{ code: string; name: string; template: string; net: number }> } = {}) {
  const id = uuid(1, n);
  await db.query("insert into public.quotations(id,client_id,quotation_no,title,status,vat_amount,grand_total,layout_settings) values($1,$2,$3,'T',$4,$5,$6,$7)",
    [id, ids.client, options.no ?? `Q-${n}`, options.status ?? "client_confirmed", vat, grand, JSON.stringify({ pricing_rule: "whole_aed_v1", ...layout })]);
  await db.query("insert into public.quotation_sections(id,quotation_id,section_title) values($1,$2,'Main')", [uuid(2, n), id]);
  const lines = options.lines ?? [{ code: "A", name: "Chair", template: uuid(9, 1), net: 100 }, { code: "B", name: "Desk", template: uuid(9, 2), net: 100 }];
  for (const [index, line] of lines.entries()) {
    await db.query("insert into public.quotation_items(id,quotation_id,section_id,sort_order,item_code_snapshot,item_name_snapshot,source_template_id,qty,unit_price,net_price,net_total) values($1,$2,$3,$4,$5,$6,$7,1,$8,$8,$8)",
      [uuid(3, n * 10 + index), id, uuid(2, n), index, line.code, line.name, line.template, line.net]);
  }
  return id;
}
async function asUser<T>(db: PGlite, user: string, run: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await run(); } finally { await db.exec("reset role;"); }
}
/** A Project with a frozen copy: contract 210 (grand 210, VAT 10). */
async function project(db: PGlite, n: number, orderNo: string) {
  const id = uuid(1, n);
  await addQuotation(db, n, { projectFile: projectFileOf(id, orderNo, 210) }, 210, 10, { no: `QN-${n}` });
  const created = await asUser(db, ids.designer, async () => (await db.query<{ r: { id: string } }>("select public.create_project_snapshot($1) as r", [id])).rows[0].r);
  return { id, snapshotId: created.id, orderNo };
}
/** Applies variation `no`. The lines' net totals decide the contract total (VAT 5%): [300, 50] gives 367.50. */
async function applyVariation(db: PGlite, p: { id: string; snapshotId: string; orderNo: string }, no: number, nets: number[], n: number) {
  const sum = nets.reduce((total, net) => total + net, 0), grand = Math.round(sum * 1.05 * 100) / 100, vat = Math.round(sum * 0.05 * 100) / 100;
  const names = ["Chair", "Desk", "Lamp"];
  const lines = nets.map((net, index) => ({ code: String.fromCharCode(65 + index), name: names[index], template: uuid(9, index + 1), net }));
  const layout = { variationOf: { orderNo: p.orderNo, projectQuotationId: p.id, snapshotId: p.snapshotId, variationNo: no, baseRevisionNo: 0 } };
  const variation = await addQuotation(db, n, layout, grand, vat, { no: `QN-${p.orderNo}-V${no}`, lines });
  await asUser(db, ids.designer, () => db.query("select public.apply_project_variation($1)", [variation]));
}

type Outcome = { ok: true; value: unknown } | { ok: false; message: string };
async function attempt(db: PGlite, user: string, sql: string, params: unknown[]): Promise<Outcome> {
  try { return { ok: true, value: (await asUser(db, user, () => db.query<{ r: unknown }>(sql, params))).rows[0]?.r }; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
}
const ADD = "select public.add_client_payment_installment($1::uuid,$2,$3::numeric,$4,$5,$6::numeric,$7::numeric,$8,$9::date,$10,$11,$12) as r";
const UPDATE = "select public.update_client_payment_installment($1::uuid,$2::uuid,$3,$4::numeric,$5,$6,$7::numeric,$8::numeric,$9,$10::date,$11,$12,$13) as r";
const DELETE = "select public.delete_client_payment_installment($1::uuid,$2::uuid,$3,$4::numeric) as r";
const RECORD = "select public.record_client_payment_receipt($1::uuid,$2::uuid,$3,$4::numeric,$5::numeric,$6::date,$7,$8,$9,$10,$11::uuid,$12::boolean) as r";
const VOID = "select public.void_client_payment_receipt($1::uuid,$2::uuid,$3,$4::numeric,$5) as r";
const VARIATION = "select public.add_client_payment_variation_instalment($1::uuid,$2,$3::numeric,$4::integer) as r";
const addArgs = (p: { id: string; orderNo: string }, total: number, title: string, type: "percentage" | "fixed", percentage: number | null, fixed: number | null, note: string | null = null) =>
  [p.id, p.orderNo, total, title, type, percentage, fixed, "project_confirmation", null, null, note, null];
const rows = async (db: PGlite) => (await db.query<Record<string, unknown>>("select sequence_no, title, calculation_type, percentage, expected_amount, status_override, note from public.client_payment_installments order by schedule_id, sequence_no")).rows;

test("a Project without a variation gives the same results before and after this migration", async () => {
  const before = await makeDb(false), after = await makeDb(true);
  try {
    const trace = async (db: PGlite) => {
      const p = await project(db, 1, "CO-1");
      const log: unknown[] = [];
      const run = async (label: string, user: string, sql: string, params: unknown[]) => { const outcome = await attempt(db, user, sql, params); log.push([label, outcome.ok ? "ok" : outcome.message]); return outcome; };
      const one = await run("add 30%", ids.owner, ADD, addArgs(p, 210, "Deposit", "percentage", 30, null));
      await run("add fixed", ids.owner, ADD, addArgs(p, 210, "Delivery", "fixed", null, 100.5));
      await run("add over the cap", ids.owner, ADD, addArgs(p, 210, "Too much", "fixed", null, 46.6));
      await run("add 100% over the cap", ids.owner, ADD, addArgs(p, 210, "All", "percentage", 100, null));
      await run("stale total", ids.owner, ADD, addArgs(p, 200, "Stale", "fixed", null, 1));
      await run("viewer refused", ids.viewer, ADD, addArgs(p, 210, "No", "fixed", null, 1));
      await run("negative", ids.owner, ADD, addArgs(p, 210, "Neg", "fixed", null, -1));
      await run("both", ids.owner, ADD, addArgs(p, 210, "Both", "percentage", 10, 5));
      log.push(["rows", await rows(db)]);
      const first = (await db.query<{ id: string }>("select id from public.client_payment_installments order by sequence_no limit 1")).rows[0].id;
      await run("note-only update of the 30%", ids.owner, UPDATE, [first, p.id, p.orderNo, 210, "Deposit", "percentage", 30, null, "project_confirmation", null, null, "a note", null]);
      await run("update to 40%", ids.owner, UPDATE, [first, p.id, p.orderNo, 210, "Deposit", "percentage", 40, null, "project_confirmation", null, null, null, null]);
      await run("receipt", ids.owner, RECORD, [first, p.id, p.orderNo, 210, 80, "2026-11-05", "cash", null, null, null, uuid(7, 1), false]);
      await run("receipt over the balance", ids.owner, RECORD, [first, p.id, p.orderNo, 210, 10, "2026-11-05", "cash", null, null, null, uuid(7, 2), false]);
      await run("receipt stale", ids.owner, RECORD, [first, p.id, p.orderNo, 999, 1, "2026-11-05", "cash", null, null, null, uuid(7, 3), false]);
      await run("lower than receipts", ids.owner, UPDATE, [first, p.id, p.orderNo, 210, "Deposit", "percentage", 10, null, "project_confirmation", null, null, null, null]);
      const receiptId = (await db.query<{ id: string }>("select id from public.client_payment_receipts limit 1")).rows[0]?.id;
      await run("void", ids.owner, VOID, [receiptId, p.id, p.orderNo, 210, "mistake"]);
      await run("delete", ids.owner, DELETE, [first, p.id, p.orderNo, 210]);
      log.push(["rows after", await rows(db)]);
      log.push(["one", one.ok]);
      return log;
    };
    const oldTrace = await trace(before), newTrace = await trace(after);
    assert.deepEqual(newTrace, oldTrace);
    const messages = JSON.stringify(newTrace);
    assert.ok(messages.includes("Scheduled total cannot exceed the Project File contract total.") && messages.includes("Project File contract total has changed. Reload before continuing.") && messages.includes("Expected amount cannot be lower than valid receipts."));
    const deposit = (newTrace.find((entry) => (entry as unknown[])[0] === "rows") as unknown[])[1] as Array<Record<string, unknown>>;
    assert.equal(toNumber(deposit[0].expected_amount), 63, "30% of 210");
  } finally { await before.close(); await after.close(); }
});

let db: PGlite;
before(async () => { db = await makeDb(true); });
after(async () => { await db.close(); });

test("one applied variation: the 30% keeps its amount, a new percentage uses the original total, the cap uses the revised total", async () => {
  const p = await project(db, 11, "CO-11");
  await asUser(db, ids.owner, async () => {
    await db.query(ADD, addArgs(p, 210, "Deposit", "percentage", 30, null));
    await db.query(ADD, addArgs(p, 210, "Delivery", "fixed", null, 100));
  });
  await applyVariation(db, p, 1, [300, 50], 111);

  const stale = await attempt(db, ids.owner, ADD, addArgs(p, 210, "Stale", "fixed", null, 1));
  assert.deepEqual(stale, { ok: false, message: "Project File contract total has changed. Reload before continuing." }, "the old total is now stale");

  const deposit = (await db.query<{ id: string }>("select id from public.client_payment_installments where title = 'Deposit'")).rows[0].id;
  const noteOnly = await attempt(db, ids.owner, UPDATE, [deposit, p.id, p.orderNo, 367.5, "Deposit", "percentage", 30, null, "project_confirmation", null, null, "agreed by phone", null]);
  assert.equal(noteOnly.ok, true, JSON.stringify(noteOnly));
  const after = (await db.query<{ expected_amount: string; note: string }>("select expected_amount, note from public.client_payment_installments where id = $1", [deposit])).rows[0];
  assert.equal(toNumber(after.expected_amount), 63, "the existing 30% instalment keeps its amount");
  assert.equal(after.note, "agreed by phone");

  assert.equal((await attempt(db, ids.owner, ADD, addArgs(p, 367.5, "Ten percent", "percentage", 10, null))).ok, true);
  const ten = (await db.query<{ expected_amount: string }>("select expected_amount from public.client_payment_installments where title = 'Ten percent'")).rows[0];
  assert.equal(toNumber(ten.expected_amount), 21, "10% of the ORIGINAL 210, not of 367.50");

  // 63 + 100 + 21 = 184 scheduled of 367.50: the cap is the revised total.
  assert.equal((await attempt(db, ids.owner, ADD, addArgs(p, 367.5, "Fills it", "fixed", null, 183.5))).ok, true);
  const over = await attempt(db, ids.owner, ADD, addArgs(p, 367.5, "One fils too many", "fixed", null, 0.01));
  assert.deepEqual(over, { ok: false, message: "Scheduled total cannot exceed the Project File contract total." });
});

test("the variation instalment: amount is the delta, once per variation, fixed, role-checked", async () => {
  const p = await project(db, 12, "CO-12");
  await asUser(db, ids.owner, () => db.query(ADD, addArgs(p, 210, "Deposit", "percentage", 30, null)));
  await applyVariation(db, p, 1, [300, 50], 121);
  const id = (await db.query<{ id: string }>("select id from public.project_variations where order_no = 'CO-12'")).rows[0].id;

  assert.deepEqual(await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 210, 1]), { ok: false, message: "Project File contract total has changed. Reload before continuing." });
  assert.deepEqual(await attempt(db, ids.designer, VARIATION, [p.id, p.orderNo, 367.5, 1]), { ok: false, message: "Forbidden." });
  assert.deepEqual(await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 367.5, 2]), { ok: false, message: "Variation not found." });
  assert.equal((await db.query("select 1 from public.client_payment_installments where variation_id is not null")).rows.length, 0, "refusals save nothing");

  const made = await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 367.5, 1]);
  assert.equal(made.ok, true, JSON.stringify(made));
  const row = (await db.query<Record<string, unknown>>("select title, calculation_type, percentage, expected_amount, variation_id, sequence_no, due_type from public.client_payment_installments where variation_id is not null")).rows[0];
  assert.equal(row.title, "Variation V1"); assert.equal(row.calculation_type, "fixed"); assert.equal(row.percentage, null);
  assert.equal(toNumber(row.expected_amount), 157.5, "equal to the delta of the saved variation");
  assert.equal(row.variation_id, id); assert.equal(row.sequence_no, 2);

  assert.deepEqual(await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 367.5, 1]), { ok: false, message: "This variation already has an instalment." });
  await assert.rejects(db.query("insert into public.client_payment_installments(schedule_id,sequence_no,title,calculation_type,expected_amount,due_type,variation_id,created_by,updated_by) select schedule_id,9,'dup','fixed',1,'project_confirmation',variation_id,created_by,updated_by from public.client_payment_installments where variation_id is not null"), /client_payment_installments_variation_unique/, "the database refuses a second one even without the function");
  await assert.rejects(db.query("delete from public.project_variations where id = $1", [id]));

  // It is an ordinary fixed instalment afterwards: editable, and with receipts and voids as before.
  const instalment = (await db.query<{ id: string }>("select id from public.client_payment_installments where variation_id is not null")).rows[0].id;
  assert.equal((await attempt(db, ids.owner, UPDATE, [instalment, p.id, p.orderNo, 367.5, "Variation V1", "fixed", null, 150, "project_confirmation", null, null, null, null])).ok, true);
  assert.equal((await attempt(db, ids.owner, RECORD, [instalment, p.id, p.orderNo, 367.5, 50, "2026-11-05", "cash", null, null, null, uuid(7, 12), false])).ok, true);
  assert.deepEqual(await attempt(db, ids.owner, RECORD, [instalment, p.id, p.orderNo, 210, 1, "2026-11-05", "cash", null, null, null, uuid(7, 13), false]), { ok: false, message: "Project File contract total has changed. Reload before continuing." });
  const receiptId = (await db.query<{ id: string }>("select id from public.client_payment_receipts limit 1")).rows[0].id;
  assert.equal((await attempt(db, ids.owner, VOID, [receiptId, p.id, p.orderNo, 367.5, "wrong amount"])).ok, true);
  assert.deepEqual(await attempt(db, ids.owner, VOID, [receiptId, p.id, p.orderNo, 210, "again"]), { ok: false, message: "Project File contract total has changed. Reload before continuing." });
  assert.equal((await attempt(db, ids.owner, DELETE, [instalment, p.id, p.orderNo, 367.5])).ok, false, "an instalment with receipt history cannot be deleted, as before");
});

test("two applied variations: the revised total is the latest; each variation has its own instalment", async () => {
  const p = await project(db, 13, "CO-13");
  await applyVariation(db, p, 1, [300, 50], 131);
  await applyVariation(db, p, 2, [300, 110, 50], 132);
  assert.deepEqual(await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 367.5, 1]), { ok: false, message: "Project File contract total has changed. Reload before continuing." });
  assert.equal((await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 483, 1])).ok, true);
  assert.equal((await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 483, 2])).ok, true);
  const amounts = (await db.query<{ title: string; expected_amount: string }>("select title, expected_amount from public.client_payment_installments i join public.client_payment_schedules s on s.id = i.schedule_id where s.order_no = 'CO-13' order by sequence_no")).rows;
  assert.deepEqual(amounts.map((row) => [row.title, toNumber(row.expected_amount)]), [["Variation V1", 157.5], ["Variation V2", 115.5]]);
  assert.equal((await attempt(db, ids.owner, ADD, addArgs(p, 483, "Rest", "fixed", null, 210))).ok, true, "210 + 157.50 + 115.50 = 483");
  assert.equal((await attempt(db, ids.owner, ADD, addArgs(p, 483, "Over", "fixed", null, 0.01))).ok, false);
});

test("a credit or zero variation gets no instalment; a completed or cancelled Project is refused", async () => {
  const credit = await project(db, 14, "CO-14");
  await applyVariation(db, credit, 1, [100], 141);
  assert.deepEqual(await attempt(db, ids.owner, VARIATION, [credit.id, credit.orderNo, 105, 1]), { ok: false, message: "This variation does not increase the contract. Adjust the remaining instalments by hand." });
  const zero = await project(db, 15, "CO-15");
  await applyVariation(db, zero, 1, [100, 100], 151);
  assert.equal((await attempt(db, ids.owner, VARIATION, [zero.id, zero.orderNo, 210, 1])).ok, false);
  assert.equal((await db.query("select 1 from public.client_payment_installments i join public.client_payment_schedules s on s.id = i.schedule_id where s.order_no in ('CO-14','CO-15')")).rows.length, 0, "nothing saved for a credit or zero variation");
  // The credit's revised total (105) is what the schedule is now checked against.
  assert.deepEqual(await attempt(db, ids.owner, ADD, addArgs(credit, 210, "Old total", "fixed", null, 10)), { ok: false, message: "Project File contract total has changed. Reload before continuing." });
  assert.equal((await attempt(db, ids.owner, ADD, addArgs(credit, 105, "Deposit", "fixed", null, 105))).ok, true);

  for (const [n, mark] of [[16, "projectCompletedAt"], [17, "projectCancelledAt"]] as const) {
    const p = await project(db, n, `CO-${n}`);
    await applyVariation(db, p, 1, [300, 50], n * 10 + 1);
    await db.query("update public.quotations set layout_settings = layout_settings || jsonb_build_object($2::text, '2026-11-05') where id = $1", [p.id, mark]);
    assert.deepEqual(await attempt(db, ids.owner, VARIATION, [p.id, p.orderNo, 367.5, 1]), { ok: false, message: "Completed or cancelled Project File instalments are read-only." }, mark);
  }
});

test("the TEST file runs and saves nothing; the APPLY file is the migration", async () => {
  const fresh = new PGlite();
  await fresh.exec(schema);
  await fresh.exec("alter table public.profiles add column full_name text; alter table public.audit_activity_log add column parent_entity_type text, add column parent_entity_id uuid;");
  await fresh.exec("create function public.current_account_status() returns text language sql stable security definer set search_path=public as $$ select account_status from public.profiles where id = auth.uid() $$;");
  await fresh.exec(snapshotMigration); await fresh.exec(variationMigration); await fresh.exec(m089); await fresh.exec(receiptSlice); await fresh.exec(m092);
  const results = await fresh.exec(read("supabase/tests/client_payment_variation_instalments_TEST.sql"));
  assert.ok(results.some((result) => result.fields.some((field) => field.name === "variation_instalments_so_far")));
  assert.equal((await fresh.query<{ t: string | null }>("select column_name as t from information_schema.columns where table_name = 'client_payment_installments' and column_name = 'variation_id'")).rows.length, 0, "rolled back");
  await fresh.close();
  assert.ok(read("supabase/tests/client_payment_variation_instalments.sql").endsWith(migration));
});
