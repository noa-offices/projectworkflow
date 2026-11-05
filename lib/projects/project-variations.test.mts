import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { currentScopeNote, loadRevisedContractTotals, vendorsWithChangedLines } from "./project-variations";
import { loadProjectScope } from "./project-scope";
import { applyVariationErrorMessage, projectFileCardState, variationCreationDecision } from "../quotations/project-variation";
import { isLockedQuotationUpdateAllowed, isQuotationLocked, quotationLockReason, unlockedQuotationCopyLayoutSettings, variationAppliedFromLayoutSettings } from "../quotations/quotation-lock";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20261108100000_project_variations.sql");
const snapshotMigration = read("supabase/migrations/20261107100000_project_snapshots.sql");
const snapshotTest = read("lib/quotations/project-snapshot.test.mts");
const schema = snapshotTest.slice(snapshotTest.indexOf("const schema = `") + "const schema = `".length, snapshotTest.indexOf("`;\nbefore(async"));

// ---- Pure rules ----

const link = { orderNo: "CO-0002-001", projectQuotationId: "q", snapshotId: "s", variationNo: 1, baseRevisionNo: 5 };
const applied = { orderNo: "CO-0002-001", variationNo: 1, appliedAt: "2026-11-05", projectVariationId: "v" };

test("the card: confirmed offers the update; applied says so; open and the rest are unchanged", () => {
  const state = (status: string, layoutSettings: unknown) => projectFileCardState({ id: "v", status, layoutSettings, folderOrderNo: "CO-0002-001" });
  assert.deepEqual(state("client_confirmed", { variationOf: link }), { kind: "variation_confirmed", orderNo: "CO-0002-001", message: "Variation V1 is confirmed. Update the Project File to apply it." });
  assert.deepEqual(state("client_confirmed", { variationOf: link, variationApplied: applied }), { kind: "variation_applied", orderNo: "CO-0002-001", message: "Variation V1 is applied to Project CO-0002-001." });
  assert.equal(state("draft", { variationOf: link }).kind, "variation_open");
  assert.equal(state("client_confirmed", {}).kind, "folder_has_project");
});

test("the limit: a confirmed variation must be applied first; then the next number follows; one open at a time", () => {
  const row = (quotation_no: string, status: string, layout_settings: unknown = {}, is_active = true) => ({ quotation_no, status, is_active, layout_settings });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "client_confirmed")]), { ok: false, message: "Variation V1 is confirmed. Update the Project File before creating another." });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "client_confirmed", { variationApplied: applied })]), { ok: true, variationNo: 2 });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "client_confirmed", { variationApplied: applied }), row("QN-0002-001-V2", "draft")]), { ok: false, message: "Variation V2 is still open for this Project. Finish it before creating another." });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "client_confirmed", { variationApplied: applied }), row("QN-0002-001-V2", "client_confirmed", { variationApplied: { ...applied, variationNo: 2 } })]), { ok: true, variationNo: 3 });
  assert.deepEqual(variationCreationDecision([row("QN-0002-001-V1", "cancelled")]), { ok: true, variationNo: 2 });
});

test("the lock: an applied variation is locked with its own words, an open one is not, and the mark cannot change", () => {
  const settings = { variationOf: link, variationApplied: applied, pricing_rule: "whole_aed_v1" };
  assert.equal(isQuotationLocked({ layout_settings: settings }), true);
  assert.equal(quotationLockReason({ layout_settings: settings }), "Locked: Variation V1 was applied to Project CO-0002-001.");
  assert.equal(isQuotationLocked({ layout_settings: { variationOf: link } }), false);
  assert.equal(quotationLockReason({ layout_settings: { variationOf: link } }), null);
  for (const bad of [null, {}, { variationApplied: {} }, { variationApplied: { orderNo: " ", variationNo: 1 } }, { variationApplied: { orderNo: "CO", variationNo: "1" } }]) assert.equal(variationAppliedFromLayoutSettings(bad), null);
  const quotation = { layout_settings: settings };
  assert.equal(isLockedQuotationUpdateAllowed(quotation, { layout_settings: { ...settings, variationApplied: null } }), false);
  assert.equal(isLockedQuotationUpdateAllowed(quotation, { layout_settings: { ...settings, variationApplied: { ...applied, variationNo: 2 } } }), false);
  assert.equal(isLockedQuotationUpdateAllowed(quotation, { layout_settings: { variationOf: link, pricing_rule: "whole_aed_v1" } }), false);
  assert.equal(isLockedQuotationUpdateAllowed(quotation, { title: "Changed" }), false);
  assert.ok(!("variationApplied" in unlockedQuotationCopyLayoutSettings(settings)));
  // Step A is unchanged for a Project's own quotation.
  const projectFile = { orderNo: "CO-1", quotationId: "q", quotationNo: "Q", clientId: "c", clientName: "C", reference: "R", total: 1, currency: "AED", createdAt: "d", createdBy: "u" };
  assert.match(quotationLockReason({ layout_settings: { projectFile } }) ?? "", /Locked: Project CO-1 was created/);
});

test("the words of an apply failure", () => {
  const cases: Array<[string, RegExp]> = [["Variation is not Client Confirmed", /not Client Confirmed yet/], ["Variation is out of order", /earlier variation/], ["Project is cancelled or completed", /cancelled or completed/], ["The copied items do not add up to the stored variation total", /do not add up/], ["Project has no frozen copy", /no frozen copy/], ["This is not a variation", /not a variation/], ["anything else", /Nothing was changed/]];
  for (const [message, expected] of cases) assert.match(applyVariationErrorMessage({ message }), expected, message);
  assert.match(applyVariationErrorMessage({ code: "PGRST202" }), /not available yet/);
  assert.match(applyVariationErrorMessage({ code: "42501", message: "insufficient_privilege" }), /permission/);
});

test("the note and the vendor warning", () => {
  assert.equal(currentScopeNote([{ variationNo: 1 }]), "Current scope includes V1");
  assert.equal(currentScopeNote([{ variationNo: 1 }, { variationNo: 2 }]), "Current scope includes V1, V2");
  const warnings = vendorsWithChangedLines([{ variationNo: 1, changeSummary: { added: [{ item_name: "New", supplier_name: "Supplier X" }], removed: [{ item_name: "Gone", brand_name: "Brand Y" }], changed: [{ item_name: "Moved", supplier_name: "New Co", supplier_name_before: "Old Co" }], unchanged_count: 0 } }], new Set(["supplierx", "oldco"]));
  assert.deepEqual(warnings.map((vendor) => vendor.vendorLabel).sort(), ["Old Co", "Supplier X"]);
  assert.deepEqual(warnings.find((vendor) => vendor.vendorLabel === "Supplier X")?.notes, ["V1: added New"]);
});

test("list totals ask only about Projects that have an applied variation", async () => {
  const projectFile = (id: string, orderNo: string) => ({ orderNo, quotationId: id, quotationNo: "Q", clientId: "c", clientName: "C", reference: "R", total: 100, currency: "AED", createdAt: "d", createdBy: "u" });
  const calls: unknown[] = [];
  const client = { rpc: async (_name: string, args: { p_quotation_ids: string[] }) => { calls.push(args.p_quotation_ids); return { data: args.p_quotation_ids.map((id) => ({ quotation_id: id, contract_total: id === "a" ? 125.5 : null })), error: null }; } };
  const base = [{ id: "a", layout_settings: { projectFile: projectFile("a", "CO-A") } }, { id: "b", layout_settings: { projectFile: projectFile("b", "CO-B") } }];
  assert.equal((await loadRevisedContractTotals(client, base)).size, 0);
  assert.equal(calls.length, 0, "no variation applied: no extra read");
  const totals = await loadRevisedContractTotals(client, [...base, { id: "v", layout_settings: { variationOf: { ...link, projectQuotationId: "a" }, variationApplied: applied } }]);
  assert.deepEqual([...totals], [["CO-A", 125.5]]);
  assert.deepEqual(calls, [["a"]]);
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `v${i}`, layout_settings: { variationOf: { ...link, projectQuotationId: `p${i}` }, variationApplied: applied } }));
  calls.length = 0;
  await loadRevisedContractTotals(client, many);
  assert.deepEqual(calls.map((ids) => (ids as string[]).length), [50, 50, 20]);
});

// ---- Migration text ----

test("the migration: closed, immutable, one row per variation, and nothing else touched", () => {
  for (const table of ["project_variations", "project_variation_sections", "project_variation_items"]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`), table);
    assert.ok(migration.includes(`create trigger ${table}_no_change before update or delete on public.${table}`), table);
    assert.ok(migration.includes(`create trigger ${table}_no_truncate before truncate on public.${table}`), table);
  }
  assert.ok(migration.includes("revoke all on public.project_variations, public.project_variation_sections, public.project_variation_items from public, anon, authenticated, service_role;"));
  assert.doesNotMatch(migration, /grant (all|insert|update|delete)[^;]*project_variation/);
  assert.match(migration, /snapshot_id uuid not null references public\.project_snapshots\(id\) on delete restrict/);
  assert.match(migration, /variation_quotation_id uuid not null unique references public\.quotations\(id\) on delete restrict/);
  assert.match(migration, /unique \(snapshot_id, variation_no\)/);
  assert.doesNotMatch(migration, /client_payment|payment_schedule|payment_receipt/);
  assert.doesNotMatch(migration, /(create or replace|drop|alter) function public\.(create_project_snapshot|backfill_project_snapshots|project_snapshot)/);
  assert.doesNotMatch(migration, /alter table public\.(project_snapshot|projects|quotations|quotation_items|quotation_sections|clients)/);
  assert.doesNotMatch(migration, /(update|delete from|insert into) public\.(project_snapshot|projects|clients|quotation_items|quotation_sections)/);
  assert.doesNotMatch(migration, /projectFile/, "no Project File record is written");
  assert.equal(migration.match(/update public\.quotations /g)?.length, 1, "only the mark on the variation");
});

test("the migration: fixed search path, definer only where needed, and three functions open to signed-in users", () => {
  const functions = [...migration.matchAll(/create function public\.(\w+)\((?:[^()]|\([^)]*\))*\) returns [^$]*?\$\$/g)];
  assert.equal(functions.length, 12);
  for (const [text, name] of functions) assert.ok(text.includes("set search_path=''"), name);
  for (const name of ["project_variation_preview", "apply_project_variation"]) assert.ok(functions.find(([, found]) => found === name)?.[0].includes("security definer"), name);
  assert.ok(functions.find(([, found]) => found === "project_variation_state")?.[0].includes("security invoker"));
  assert.deepEqual([...migration.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to authenticated;/g)].map((match) => match[1]).sort(), ["apply_project_variation", "project_variation_preview", "project_variation_state"]);
  assert.ok(migration.includes("for update;"));
  assert.ok(snapshotMigration.includes("create function public.project_snapshot_copy"), "B1 is read, not changed");
});

// ---- Run in an in-memory test database (never the live one) ----

const db = new PGlite();
const ids = { owner: "00000000-0000-4000-8000-000000000001", designer: "00000000-0000-4000-8000-000000000002", viewer: "00000000-0000-4000-8000-000000000003", client: "00000000-0000-4000-8000-0000000000c1" };
const uuid = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let nextItem = 1;
const projectFileOf = (id: string, orderNo: string, total: number) => ({ orderNo, quotationId: id, quotationNo: `QN-${orderNo}`, clientId: ids.client, clientName: "Client", reference: "Office", total, currency: "AED", createdAt: "2026-11-04", createdBy: ids.owner });
type Line = { code?: string | null; name?: string | null; template?: string | null; qty?: number; price?: number; net?: number; active?: boolean };

async function addRow(n: number, layout: object, lines: Line[], totals: { grand: number; vat: number; status?: string; no?: string; rule?: string }) {
  const id = uuid(1, n);
  await db.query("insert into public.quotations(id,client_id,quotation_no,title,status,vat_amount,grand_total,layout_settings) values($1,$2,$3,'T',$4,$5,$6,$7)", [id, ids.client, totals.no ?? `Q-${n}`, totals.status ?? "client_confirmed", totals.vat, totals.grand, JSON.stringify({ ...layout, ...(totals.rule ? { pricing_rule: totals.rule } : {}) })]);
  await db.query("insert into public.quotation_sections(id,quotation_id,section_title) values($1,$2,'Main')", [uuid(2, n), id]);
  for (const [index, line] of lines.entries()) {
    await db.query("insert into public.quotation_items(id,quotation_id,section_id,sort_order,item_code_snapshot,item_name_snapshot,source_template_id,qty,unit_price,net_price,net_total,is_active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [uuid(3, nextItem++), id, uuid(2, n), index, line.code ?? null, line.name ?? null, line.template ?? null, line.qty ?? 1, line.price ?? line.net ?? 100, line.net ?? 100, line.net ?? 100, line.active ?? true]);
  }
  return id;
}
async function asUser<T>(user: string, run: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await run(); } finally { await db.exec("reset role;"); }
}
const call = async <T = Record<string, unknown>,>(fn: string, id: unknown, user = ids.designer) => asUser(user, async () => (await db.query<{ r: T }>(`select public.${fn}($1) as r`, [id])).rows[0].r);
const apply = (id: string, user?: string) => call<{ id: string; created: boolean }>("apply_project_variation", id, user);
const linkTo = (project: string, snapshot: string, orderNo: string, variationNo: number) => ({ variationOf: { orderNo, projectQuotationId: project, snapshotId: snapshot, variationNo, baseRevisionNo: 0 } });

/** A Project with a frozen copy: 2 lines at 100, VAT 5%. */
async function project(n: number, orderNo: string, lines: Line[] = [{ code: "A", name: "Chair", template: uuid(9, 1) }, { code: "B", name: "Desk", template: uuid(9, 2) }], totals = { grand: 210, vat: 10, rule: "whole_aed_v1" }) {
  const id = uuid(1, n);
  await addRow(n, { projectFile: projectFileOf(id, orderNo, totals.grand) }, lines, totals);
  const created = await call<{ id: string }>("create_project_snapshot", id);
  return { id, snapshotId: created.id, orderNo };
}

before(async () => {
  await db.exec(schema);
  await db.exec("alter table public.profiles add column full_name text;");
  await db.query("insert into public.profiles(id,role,account_status,full_name) values($1,'system_owner','active','Owner'),($2,'designer','active',' Sara '),($3,'viewer','active','View')", [ids.owner, ids.designer, ids.viewer]);
  await db.query("insert into public.clients(id,company_name) values($1,'Client')", [ids.client]);
  await db.exec(snapshotMigration);
  await db.exec(migration);
});
after(async () => { await db.close(); });

test("apply: the copy, the summary, the totals and the mark happen together; a second call returns the same row", async () => {
  const p = await project(1, "CO-1");
  const v = await addRow(11, linkTo(p.id, p.snapshotId, p.orderNo, 1), [
    { code: "A", name: "Chair", template: uuid(9, 1), qty: 3, price: 100, net: 300 }, // quantity and price total changed
    { code: "C", name: "Lamp", template: uuid(9, 3), net: 50 }, // new
    { code: "D", name: "Old inactive", net: 999, active: false },
  ], { grand: 367.5, vat: 17.5, rule: "whole_aed_v1", no: "QN-1-V1" }); // Desk removed

  const preview = await call<Record<string, unknown>>("project_variation_preview", v);
  assert.equal(preview.new_contract_total, 367.5); assert.equal(preview.previous_contract_total, 210); assert.equal(preview.contract_delta, 157.5);
  assert.equal((await db.query("select 1 from public.project_variations")).rows.length, 0, "the preview saves nothing");

  const first = await apply(v);
  assert.equal(first.created, true);
  assert.deepEqual(await apply(v), { id: first.id, created: false });
  const { rows: [row] } = await db.query<Record<string, never>>("select * from public.project_variations where id = $1", [first.id]);
  assert.equal(row.applied_by, ids.designer); assert.equal(row.applied_by_name, "Sara"); assert.equal(row.variation_no, 1);
  assert.equal(Number(row.previous_contract_total), 210); assert.equal(Number(row.new_contract_total), 367.5); assert.equal(Number(row.contract_delta), 157.5);
  const summary = row.change_summary as unknown as { added: Array<{ item_name: string }>; removed: Array<{ item_name: string }>; changed: Array<{ item_name: string; qty_before: number; qty: number; net_total_before: number; net_total: number }>; unchanged_count: number };
  assert.deepEqual(summary.added.map((line) => line.item_name), ["Lamp"]);
  assert.deepEqual(summary.removed.map((line) => line.item_name), ["Desk"]);
  assert.deepEqual(summary.changed.map((line) => [line.item_name, line.qty_before, line.qty, line.net_total_before, line.net_total]), [["Chair", 1, 3, 100, 300]]);
  assert.equal(summary.unchanged_count, 0);
  assert.equal((await db.query("select 1 from public.project_variation_items where variation_id = $1", [first.id])).rows.length, 2, "the inactive item is not copied");
  assert.equal((await db.query("select 1 from public.project_variation_sections where variation_id = $1", [first.id])).rows.length, 1);

  const { rows: [marked] } = await db.query<{ layout_settings: { variationApplied: Record<string, unknown>; projectFile?: unknown } }>("select layout_settings from public.quotations where id = $1", [v]);
  assert.equal(marked.layout_settings.variationApplied.projectVariationId, first.id);
  assert.equal(marked.layout_settings.variationApplied.variationNo, 1);
  assert.equal(marked.layout_settings.variationApplied.orderNo, "CO-1");
  assert.equal(isQuotationLocked(marked), true);
  const { rows: [source] } = await db.query<{ layout_settings: { projectFile: { total: number } } }>("select layout_settings from public.quotations where id = $1", [p.id]);
  assert.equal(source.layout_settings.projectFile.total, 210, "the Project File record is not written");
  assert.equal((await db.query("select 1 from public.audit_activity_log where entity_id = $1 and action = 'project_variation_applied'", [v])).rows.length, 1);
});

test("lines keep their previous ids across variations, by template and code, then code, then name; a new line has none", async () => {
  const p = await project(2, "CO-2", [{ code: "A", name: "Chair", template: uuid(9, 1) }, { code: "M", name: "Manual code" }, { name: "Named only" }, { name: "Renamed manual" }], { grand: 420, vat: 20, rule: "whole_aed_v1" });
  const previous = (await db.query<{ original_item_id: string; net_total: string; data: { item_name_snapshot: string } }>("select original_item_id, data from public.project_snapshot_items where snapshot_id = $1 order by sort_order", [p.snapshotId])).rows;
  const v1 = await addRow(21, linkTo(p.id, p.snapshotId, p.orderNo, 1), [
    { code: "A", name: "Chair renamed", template: uuid(9, 1) }, { code: "M", name: "Manual code" }, { name: "Named only" }, { name: "Another name" },
  ], { grand: 420, vat: 20, rule: "whole_aed_v1", no: "QN-2-V1" });
  const a1 = await apply(v1);
  const v1Items = (await db.query<{ original_item_id: string | null; item_name: string }>("select original_item_id, item_name from public.project_variation_items where variation_id = $1 order by sort_order", [a1.id])).rows;
  assert.deepEqual(v1Items.map((line) => line.original_item_id), [previous[0].original_item_id, previous[1].original_item_id, previous[2].original_item_id, null]);

  // V2 is measured against V1, and the ids carry through.
  const v2 = await addRow(22, linkTo(p.id, p.snapshotId, p.orderNo, 2), [{ code: "A", name: "Chair renamed", template: uuid(9, 1) }, { code: "M", name: "Manual code", net: 200 }], { grand: 315, vat: 15, rule: "whole_aed_v1", no: "QN-2-V2" });
  const a2 = await apply(v2);
  const v2Row = (await db.query<{ previous_contract_total: string; new_contract_total: string; change_summary: { removed: unknown[]; changed: unknown[]; unchanged_count: number } }>("select * from public.project_variations where id = $1", [a2.id])).rows[0];
  assert.equal(Number(v2Row.previous_contract_total), 420); assert.equal(Number(v2Row.new_contract_total), 315);
  assert.equal(v2Row.change_summary.removed.length, 2); assert.equal(v2Row.change_summary.changed.length, 1); assert.equal(v2Row.change_summary.unchanged_count, 1);
  const v2Items = (await db.query<{ original_item_id: string }>("select original_item_id from public.project_variation_items where variation_id = $1 order by sort_order", [a2.id])).rows;
  assert.deepEqual(v2Items.map((line) => line.original_item_id), [previous[0].original_item_id, previous[1].original_item_id]);
});

test("the contract total follows the Create Project File rule: legacy rounds up to 5, whole AED is exact", async () => {
  const legacy = await project(3, "CO-3", [{ code: "A", name: "Chair" }, { code: "B", name: "Desk" }], { grand: 210, vat: 10, rule: "" });
  const v = await addRow(31, linkTo(legacy.id, legacy.snapshotId, legacy.orderNo, 1), [{ code: "A", name: "Chair", net: 1399.5 }], { grand: 1469.48, vat: 69.98, no: "QN-3-V1" });
  const { rows: [row] } = await db.query<{ new_contract_total: string; contract_delta: string; pricing_rule: string }>("select * from public.project_variations where id = $1", [(await apply(v)).id]);
  assert.equal(row.pricing_rule, "round_up_5_legacy"); assert.equal(Number(row.new_contract_total), 1470); assert.equal(Number(row.contract_delta), 1260);
});

test("refusals: role, status, Project state, order, and a copy that does not add up leave nothing behind", async () => {
  const p = await project(4, "CO-4");
  const line = [{ code: "A", name: "Chair", net: 200 }];
  const ok = { grand: 210, vat: 10, rule: "whole_aed_v1" };

  const notConfirmed = await addRow(41, linkTo(p.id, p.snapshotId, p.orderNo, 1), line, { ...ok, status: "draft", no: "QN-4-V1" });
  await assert.rejects(apply(notConfirmed), /not Client Confirmed/);
  await assert.rejects(apply(notConfirmed, ids.viewer), /insufficient_privilege/);
  await assert.rejects(call("project_variation_preview", notConfirmed, ids.viewer), /insufficient_privilege/);

  // V1 is still a draft: V2 must wait.
  const second = await addRow(42, linkTo(p.id, p.snapshotId, p.orderNo, 2), line, { ...ok, no: "QN-4-V2" });
  await assert.rejects(apply(second), /out of order/);
  // A rejected V1 no longer holds it up.
  await db.query("update public.quotations set status = 'cancelled' where id = $1", [notConfirmed]);
  const applied2 = await apply(second);
  assert.equal(applied2.created, true);
  // An older number cannot follow a newer one.
  await db.query("update public.quotations set status = 'client_confirmed' where id = $1", [notConfirmed]);
  await assert.rejects(apply(notConfirmed), /out of order/);
  await db.query("update public.quotations set status = 'cancelled' where id = $1", [notConfirmed]);

  const bad = await addRow(43, linkTo(p.id, p.snapshotId, p.orderNo, 3), line, { grand: 999, vat: 10, rule: "whole_aed_v1", no: "QN-4-V3" });
  await assert.rejects(apply(bad), /do not add up/);
  assert.equal((await db.query("select 1 from public.project_variations where variation_quotation_id = $1", [bad])).rows.length, 0);
  assert.equal(((await db.query<{ layout_settings: Record<string, unknown> }>("select layout_settings from public.quotations where id = $1", [bad])).rows[0].layout_settings.variationApplied), undefined);
  assert.equal((await db.query("select 1 from public.audit_activity_log where entity_id = $1", [bad])).rows.length, 0);

  await assert.rejects(apply(await addRow(44, { pricing_rule: "x" }, line, ok)), /not a variation/);
  await assert.rejects(apply(await addRow(45, linkTo(p.id, uuid(8, 1), p.orderNo, 3), line, ok)), /no frozen copy/);

  for (const flag of ["projectCancelledAt", "projectCompletedAt"]) {
    const closed = await project(flag === "projectCancelledAt" ? 5 : 6, `CO-${flag}`);
    await db.query("update public.quotations set layout_settings = layout_settings || $2 where id = $1", [closed.id, JSON.stringify({ [flag]: "2026-11-05" })]);
    await assert.rejects(apply(await addRow(flag === "projectCancelledAt" ? 51 : 61, linkTo(closed.id, closed.snapshotId, closed.orderNo, 1), line, { ...ok, no: `QN-${flag}-V1` })), /cancelled or completed/);
  }
});

test("rows are immutable and closed; the state reads through the source quotation", async () => {
  await assert.rejects(db.query("update public.project_variations set order_no = 'X'"), /history/);
  await assert.rejects(db.query("delete from public.project_variation_items"), /history/);
  await assert.rejects(db.query("delete from public.project_variation_sections"), /history/);
  await assert.rejects(db.exec("truncate public.project_variation_items"), /history/);
  await assert.rejects(db.query("delete from public.quotations where id = $1", [uuid(1, 11)]), /foreign key/);
  await asUser(ids.owner, async () => {
    await assert.rejects(db.query("insert into public.project_variations(order_no) values('x')"), /permission denied/);
    await assert.rejects(db.query("select public.project_variation_match_lines('[]', '[]')"), /permission denied/);
  });
  const state = await call<Array<{ quotation_id: string; applied_variation_no: number | null; contract_total: number | null; original_contract_total: number | null }>>("project_variation_state", [uuid(1, 2), uuid(1, 7), uuid(1, 999)], ids.viewer);
  assert.deepEqual(state.find((row) => row.quotation_id === uuid(1, 2)), { quotation_id: uuid(1, 2), applied_variation_no: 2, contract_total: 315, original_contract_total: 420 });
  assert.equal(state.find((row) => row.quotation_id === uuid(1, 999))?.applied_variation_no, null);
  await assert.rejects(call("project_variation_state", [], ids.viewer), /between 1 and 50/);
});

// ---- The scope module, read from the real tables ----

test("the current scope is the latest applied variation, with the Project's own identity; the original copy stays available", async () => {
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []; let columns = "*"; let order = ""; let range = "";
      const run = async () => {
        const where = filters.length ? `where ${filters.map(([key], i) => `${key} = $${i + 1}`).join(" and ")}` : "";
        const rows = await db.query<Row>(`select ${columns} from public.${table} ${where} ${order} ${range}`, filters.map(([, value]) => value));
        const count = (await db.query<{ n: number }>(`select count(*)::int as n from public.${table} ${where}`, filters.map(([, value]) => value))).rows[0].n;
        return { data: rows.rows, error: null, count };
      };
      const query: Record<string, unknown> = {
        select(cols: string) { columns = cols; return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        order(key: string, options?: { ascending?: boolean }) { order = `${order ? `${order},` : "order by "}${key} ${options?.ascending === false ? "desc" : "asc"}`; return query; },
        range(from: number, to: number) { range = `limit ${to - from + 1} offset ${from}`; return query; },
        async maybeSingle() { const result = await run(); return { data: result.data[0] ?? null, error: null }; },
        then(resolve: (value: unknown) => void, reject: (error: unknown) => void) { run().then(resolve, reject); },
      };
      return query;
    },
  };
  type Row = Record<string, unknown>;
  const options = { itemColumns: "id,item_code_snapshot,qty,net_total", sectionColumns: "id,section_title", headerColumns: "id,title,subtotal,grand_total,quotation_no,layout_settings,payment_terms" };
  const scope = await loadProjectScope<Row, Row, Row>(client, uuid(1, 2), options);
  assert.equal(scope.source, "snapshot");
  assert.equal(scope.appliedVariationNo, 2);
  assert.deepEqual(scope.appliedVariations.map((variation) => variation.variationNo), [1, 2]);
  assert.equal(scope.contractTotal, 315); assert.equal(scope.originalContractTotal, 420);
  assert.equal(scope.pricingRule, "whole_aed_v1");
  assert.equal(scope.items.length, 2);
  const original = await db.query<{ original_item_id: string }>("select original_item_id from public.project_snapshot_items where snapshot_id = (select id from public.project_snapshots where quotation_id = $1) order by sort_order", [uuid(1, 2)]);
  assert.equal(scope.items[0].id, original.rows[0].original_item_id, "a line that came through keeps its first id");
  assert.equal(scope.items[1].net_total, 200);
  assert.equal(scope.header?.id, uuid(1, 2), "document settings stay linked to the Project's quotation");
  assert.equal(scope.header?.quotation_no, "QN-2-V2");
  assert.equal(scope.header?.grand_total, 315);
  assert.ok((scope.header?.layout_settings as { projectFile?: unknown }).projectFile, "the Project File stays on the header");
  assert.equal(scope.originalHeader?.grand_total, 420);

  // No applied variation: exactly the original copy.
  const plain = await loadProjectScope<Row, Row, Row>(client, uuid(1, 5), options);
  assert.equal(plain.source, "snapshot"); assert.equal(plain.appliedVariationNo, null); assert.deepEqual(plain.appliedVariations, []); assert.deepEqual(plain.header, plain.originalHeader); assert.equal(plain.contractTotal, plain.originalContractTotal);
});

// ---- Source text ----

test("payments follow the revised total (Step C2b); the Project page shows the revised one elsewhere", () => {
  const page = read("app/projects/orders/[orderNo]/page.tsx");
  assert.ok(page.includes("contractTotal={clientPaymentContractTotal}"));
  assert.ok(page.includes("const contract = moneyToFils(clientPaymentContractTotal);"), "the outstanding line uses the revised total");
  assert.ok(!page.includes("The payment schedule still follows the original contract total"));
  assert.equal(page.split("formatRuleMoney(pricingRule, entry.order.currency, revisedContractTotal)").length - 1, 3);
  assert.ok(page.includes("(scope.originalHeader ?? commercial).payment_terms"));
  for (const file of ["lib/projects/client-payment-actions.ts", "components/projects/client-payment-panel.tsx"]) assert.ok(!read(file).includes("project_variation"), file);
});

test("the action calls the function and maps its errors; the lists and procurement pages show the revised total", () => {
  const actions = read("app/quotations/actions.ts");
  const body = actions.slice(actions.indexOf("export async function applyProjectVariation"), actions.indexOf("export async function deactivateQuotation"));
  assert.ok(body.includes('supabase.rpc("apply_project_variation", { p_variation_quotation_id: variationQuotationId })'));
  assert.ok(body.includes("applyVariationErrorMessage(error)"));
  for (const path of ["/projects/orders", "/procurement/orders"]) assert.ok(body.includes(`revalidatePath("${path}")`), path);
  const create = actions.slice(actions.indexOf("export async function createProjectVariation"), actions.indexOf("export async function applyProjectVariation"));
  assert.ok(create.includes('.from("project_variation_items")') && create.includes('.from("project_snapshot_items")'));
  assert.doesNotMatch(create, /\.from\("quotation_(items|sections)"\)\s*\.select/);
  for (const file of ["app/projects/orders/page.tsx", "app/projects/completed/page.tsx", "app/procurement/orders/page.tsx", "app/procurement/completed/page.tsx"]) {
    assert.ok(read(file).includes("revisedTotals.get(projectFile.orderNo) ?? projectFile.total"), file);
  }
  for (const file of ["app/procurement/orders/[orderNo]/page.tsx", "app/procurement/completed/[orderNo]/page.tsx"]) {
    const source = read(file);
    assert.ok(source.includes("scope.contractTotal ?? entry.order.total") && source.includes("currentScopeNote(scope.appliedVariations)"), file);
  }
});

test("an applied variation offers neither Create variation nor Create option on its locked view", () => {
  const view = read("components/quotations/quotation-locked-view.tsx");
  assert.ok(view.includes("{applied ? null : ("));
  assert.ok(view.indexOf("{applied ? null : (") < view.indexOf("createProjectVariation}>"));
  assert.ok(view.includes("projectFile?.orderNo ?? applied?.orderNo"));
});

test("the TEST file runs and saves nothing; the APPLY file is the migration", async () => {
  const fresh = new PGlite();
  await fresh.exec(schema);
  await fresh.exec("alter table public.profiles add column full_name text;");
  await fresh.exec(snapshotMigration);
  const results = await fresh.exec(read("supabase/tests/project_variations_TEST.sql"));
  assert.ok(results.some((result) => result.fields.some((field) => field.name === "confirmed_variations_waiting")));
  assert.equal((await fresh.query<{ t: string | null }>("select to_regclass('public.project_variations') as t")).rows[0].t, null);
  await fresh.close();
  assert.ok(read("supabase/tests/project_variations.sql").endsWith(migration));
});
