// NOA 2.0B-3.3: Procurement vendor-progress field-level audit instrumentation (eta/etd/
// active_step) plus the matching B3.2 Catch-Up allow-list extension. Source-level wiring/safety
// checks, same convention as the other *-safety.test.mts files in this codebase (server-only
// "@/..." aliases/"use server" are not resolvable by Node's plain ESM resolver outside the
// Next.js build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const writer = readFileSync("lib/procurement/vendor-docs-action.ts", "utf8");
const catchUp = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const attentionCapability = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");

function sliceFunctionBody(src: string, startIndex: number): string {
  const rest = src.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

const fnStart = writer.indexOf("export async function saveVendorProgress(");
const fnBody = sliceFunctionBody(writer, fnStart);

test("1. saveVendorProgress pre-reads the exact order_no/vendor_key row", () => {
  assert.ok(fnBody.includes('.eq("order_no", orderNo)'));
  assert.ok(fnBody.includes('.eq("vendor_key", vendorKey)'));
  assert.ok(fnBody.includes(".maybeSingle()"));
});

test("2. pre-read selects only active_step/etd/eta", () => {
  assert.ok(fnBody.includes('.select("active_step,etd,eta")'));
});

test("3. no whole-table scan - the pre-read select is scoped by both identity columns before maybeSingle()", () => {
  const selectIndex = fnBody.indexOf('.select("active_step,etd,eta")');
  const maybeSingleIndex = fnBody.indexOf(".maybeSingle()");
  const between = fnBody.slice(selectIndex, maybeSingleIndex);
  assert.ok(between.includes('.eq("order_no", orderNo)'));
  assert.ok(between.includes('.eq("vendor_key", vendorKey)'));
});

test("4. missing existing row maps old values to null via optional chaining + ?? null", () => {
  assert.ok(fnBody.includes("previous?.active_step ?? null"));
  assert.ok(fnBody.includes("previous?.etd ?? null"));
  assert.ok(fnBody.includes("previous?.eta ?? null"));
});

test("5. ETD normalization matches the persisted value written to the database", () => {
  assert.ok(fnBody.includes("const nextEtd = etd || null;"));
  assert.ok(fnBody.includes("etd: nextEtd,"));
  assert.ok(fnBody.includes("(previous?.etd ?? null) !== nextEtd"));
});

test("6. ETA normalization matches the persisted value written to the database", () => {
  assert.ok(fnBody.includes("const nextEta = eta || null;"));
  assert.ok(fnBody.includes("eta: nextEta,"));
  assert.ok(fnBody.includes("(previous?.eta ?? null) !== nextEta"));
});

test("7. active_step actual change captured with the correct field/label", () => {
  assert.ok(fnBody.includes('{ field: "active_step", label: "Procurement step", oldValue: previous?.active_step ?? null, newValue: activeStep }'));
});

test("8. ETD actual change captured with the correct field/label", () => {
  assert.ok(fnBody.includes('{ field: "etd", label: "ETD", oldValue: previous?.etd ?? null, newValue: nextEtd }'));
});

test("9. ETA actual change captured with the correct field/label", () => {
  assert.ok(fnBody.includes('{ field: "eta", label: "ETA", oldValue: previous?.eta ?? null, newValue: nextEta }'));
});

test("10. unchanged values are omitted - each push is guarded by its own inequality check", () => {
  assert.equal((fnBody.match(/changes\.push\(/g) ?? []).length, 3);
  assert.ok(fnBody.includes("if ((previous?.active_step ?? null) !== activeStep) {"));
  assert.ok(fnBody.includes("if ((previous?.etd ?? null) !== nextEtd) {"));
  assert.ok(fnBody.includes("if ((previous?.eta ?? null) !== nextEta) {"));
});

test("11. no-op save (changes.length === 0) creates no audit event", () => {
  assert.ok(fnBody.includes("if (changes.length > 0) {"));
  assert.ok(!fnBody.includes("createAuditLog(auditClient") || fnBody.indexOf("createAuditLog(auditClient") > fnBody.indexOf("if (changes.length > 0) {"));
});

test("12. one save with up to 3 changes creates exactly one audit event (single createAuditLog call inside the changes-gated block)", () => {
  assert.equal((fnBody.match(/createAuditLog\(/g) ?? []).length, 1);
});

test("13. audit occurs after the successful upsert - the write's own error check returns before change detection/audit", () => {
  const upsertIndex = fnBody.indexOf(".upsert(");
  const errorCheckIndex = fnBody.indexOf("if (error) {");
  const changesIndex = fnBody.indexOf("const changes:");
  const auditIndex = fnBody.indexOf("createAuditLog(");
  assert.ok(upsertIndex < errorCheckIndex);
  assert.ok(errorCheckIndex < changesIndex);
  assert.ok(changesIndex < auditIndex);
});

test("14. upsert failure returns before change detection/audit ever runs", () => {
  const errorCheckIndex = fnBody.indexOf("if (error) {");
  const returnErrorIndex = fnBody.indexOf("return { ok: false, error: error.message };");
  const changesIndex = fnBody.indexOf("const changes:");
  assert.ok(errorCheckIndex < returnErrorIndex);
  assert.ok(returnErrorIndex < changesIndex);
});

test("15. audit uses the existing createAuditLog() helper, not a hand-rolled insert", () => {
  assert.ok(fnBody.includes("await createAuditLog(auditClient, {"));
  assert.ok(writer.includes('import { createAuditLog } from "@/lib/audit-log";'));
});

test("16. the new audit path does not use/pass the admin client - it constructs its own ordinary user-scoped client", () => {
  assert.ok(fnBody.includes("const auditClient = await createSupabaseClient();"));
  assert.ok(fnBody.includes("createAuditLog(auditClient, {"));
  assert.ok(!fnBody.includes("createAuditLog(supabase,"));
  assert.ok(writer.includes('import { createClient as createSupabaseClient } from "@/lib/supabase/server";'));
});

test("17. metadata contains orderNo (the real CO identifier, matching B2's metadata->>orderNo Catch-Up query)", () => {
  assert.ok(fnBody.includes("metadata: { orderNo, vendorKey, changes }"));
});

test("18. metadata preserves vendor identity (vendorKey) for correlation, never exposed in the human-facing title/description", () => {
  assert.ok(fnBody.includes("metadata: { orderNo, vendorKey, changes }"));
  assert.ok(fnBody.includes('title: "Vendor progress updated",'));
  assert.ok(!fnBody.includes("${vendorKey}"));
});

test("19. only active_step/etd/eta ever appear as field names in this writer's changes array", () => {
  const fieldMatches = [...fnBody.matchAll(/field: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(fieldMatches.length, 3);
  for (const field of fieldMatches) {
    assert.ok(["active_step", "etd", "eta"].includes(field));
  }
});

test("20. no sensitive fields (notes/documents/url/contact/bank/payment/arbitrary payload) are logged by this writer", () => {
  assert.ok(!fnBody.includes("note"));
  assert.ok(!fnBody.includes("storage_path"));
  assert.ok(!fnBody.includes("public_url"));
  assert.ok(!fnBody.includes("formData"));
});

test("21. Catch-Up allow-list adds active_step/eta/etd with the specified labels", () => {
  assert.ok(catchUp.includes('active_step: "Procurement step",'));
  assert.ok(catchUp.includes('eta: "ETA",'));
  assert.ok(catchUp.includes('etd: "ETD",'));
});

test("22. active_step labels map RFQ/PO Issued correctly via an explicit index list, never generic Title Case", () => {
  assert.ok(catchUp.includes('"RFQ",'));
  assert.ok(catchUp.includes('"PO Issued",'));
  const codeWithoutComments = catchUp.replace(/\/\/.*$/gm, "");
  assert.ok(!codeWithoutComments.includes('"Rfq"'));
  assert.ok(!codeWithoutComments.includes('"Po"'));
});

test("23. ETA gets deterministic canonical-date formatting", () => {
  const fmtStart = catchUp.indexOf("function formatCanonicalDate(");
  const fmtBody = sliceFunctionBody(catchUp, fmtStart);
  assert.ok(fmtBody.includes("CANONICAL_DATE_PATTERN"));
  assert.ok(catchUp.includes('(field === "eta" || field === "etd") && typeof value === "string"'));
});

test("24. ETD gets the same deterministic canonical-date formatting as ETA (one shared formatter definition, one call site - no ETD-specific duplicate)", () => {
  assert.equal((catchUp.match(/function formatCanonicalDate\(/g) ?? []).length, 1);
  assert.equal((catchUp.match(/formatCanonicalDate\(value\)/g) ?? []).length, 1);
});

test("25. null -> date renders as an honest \"added\" phrase (reuses the existing B3.2 null-endpoint rule, no new code needed)", () => {
  assert.ok(catchUp.includes('`${label} added: ${formattedNew}`'));
});

test("26. date -> null renders as an honest \"cleared\" phrase (reuses the existing B3.2 null-endpoint rule)", () => {
  assert.ok(catchUp.includes('`${label} cleared (was ${formattedOld})`'));
});

test("27. B3.2 grouping key is unchanged by this phase - it already includes ALL validated structured changes generically", () => {
  const groupKeyStart = catchUp.indexOf("function catchUpGroupKey(");
  const groupKeyBody = sliceFunctionBody(catchUp, groupKeyStart);
  assert.ok(groupKeyBody.includes("JSON.stringify(validateStructuredChanges(row.metadata))"));
});

test("28. Attention capability is untouched by this phase", () => {
  assert.ok(!attentionCapability.includes("N2B3.3"));
  assert.ok(!attentionCapability.includes("vendor_progress_updated"));
});

test("29. no schema/migration/RLS reference was added in either touched file", () => {
  for (const source of [writer, catchUp]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

test("30. no provider/LLM usage was added in either touched file", () => {
  for (const source of [writer, catchUp]) {
    assert.ok(!/openai|anthropic|llm|provider\.(generate|complete|chat)/i.test(source));
  }
});
