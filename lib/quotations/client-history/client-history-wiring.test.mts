/* eslint-disable @typescript-eslint/no-explicit-any -- fake clients */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

const CR = String.fromCharCode(13);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").split(CR).join("");
const FROM = "11111111-1111-4111-8111-111111111111";
const TO = "22222222-2222-4222-8222-222222222222";

// ── mergeClients: history follows the merge, a failure never blocks it ─────────────────────────────────
const log: string[] = [];
let historyMode: "ok" | "error" | "throw" = "ok";
let rpcCalls: Array<{ name: string; args: any }> = [];
const errors: string[] = [];

function adminFake() {
  return {
    from: (table: string) => ({
      select: () => ({ eq: async () => { log.push(`admin:select:${table}`); return { data: [], error: null, count: 0 }; } }),
      update: (values: any) => ({ eq: async () => { log.push(`admin:update:${table}:${Object.keys(values).join(",")}`); return { error: null }; } }),
    }),
  };
}
mock.module("@/lib/auth", { namedExports: { requireActiveUser: async () => ({ user: { id: "u1" }, profile: { role: "admin_manager" } }) } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => ({ client: adminFake(), error: null }) } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  rpc: async (name: string, args: any) => {
    log.push(`rpc:${name}`);
    rpcCalls.push({ name, args });
    if (historyMode === "throw") throw new Error("network down");
    return { data: null, error: historyMode === "error" ? { code: "42501", message: "Not allowed. secret detail" } : null };
  },
}) } });
mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });

const clientActions = await import("../../../app/sales/clients/actions");

test("mergeClients: the history is moved with the caller's own session, before the duplicate client is deactivated", async () => {
  log.length = 0; rpcCalls = []; historyMode = "ok";
  const result = await clientActions.mergeClients(TO, FROM);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(rpcCalls, [{ name: "client_quote_history_merge_clients", args: { p_from: FROM, p_to: TO } }]);
  const rpcAt = log.indexOf("rpc:client_quote_history_merge_clients");
  const deactivateAt = log.indexOf("admin:update:clients:is_active");
  assert.ok(rpcAt >= 0 && deactivateAt > rpcAt, `rpc before deactivate: ${log.join(" | ")}`);
  assert.ok(log.indexOf("admin:update:quotations:client_id") < rpcAt, "after the quotations were moved");
});

test("mergeClients: a history failure (error or exception) does not block the merge and logs only a short code", async () => {
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    for (const mode of ["error", "throw"] as const) {
      log.length = 0; rpcCalls = []; historyMode = mode;
      assert.deepEqual(await clientActions.mergeClients(TO, FROM), { ok: true }, mode);
      assert.ok(log.includes("admin:update:clients:is_active"), `${mode}: the merge still finished`);
    }
  } finally {
    console.error = original;
  }
  assert.ok(errors.length >= 2);
  for (const line of errors) assert.doesNotMatch(line, /secret|network down/i, line);
});

test("mergeClients: every other step is unchanged (a diff of the function against main shows only the history block)", () => {
  const root = new URL("../../../", import.meta.url);
  let before: string;
  try {
    before = execFileSync("git", ["show", "origin/main:app/sales/clients/actions.ts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(CR).join("");
  } catch {
    return;
  }
  const after = read("../../../app/sales/clients/actions.ts");
  const removed = before.split("\n").filter((line) => !after.includes(line));
  assert.deepEqual(removed, [], "no existing line was removed or changed");
  const added = after.split("\n").filter((line) => !before.includes(line));
  assert.ok(added.every((line) => /createClient|client history|historyError|client_quote_history|session|try \{|\} catch|exception|^\s*\}?\s*$|Client quote history|\(not the admin/.test(line)), `unexpected added lines: ${added.join(" | ")}`);
});

// ── source-text guards ─────────────────────────────────────────────────────
const files = ["client-history.ts", "client-history-service.ts", "client-history-actions.ts"].map((name) => [name, read(`./${name}`)] as const);

test("no admin client or service role anywhere in the new files", () => {
  for (const [name, source] of files) {
    assert.doesNotMatch(source, /createAdminClient|service_role|SUPABASE_SERVICE|supabase\/admin/, name);
  }
});

test('the "use server" file exports only async functions (and types), and every action calls requireActiveUser first', () => {
  const source = files.find(([name]) => name === "client-history-actions.ts")![1];
  assert.match(source, /^"use server";/);
  const exported = source.split("\n").filter((line) => /^export /.test(line));
  for (const line of exported) assert.match(line, /^export (async function \w+|type \w+)/, line);
  const actionNames = [...source.matchAll(/^export async function (\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(actionNames.sort(), ["addHistoryItemToQuotationAction", "copyHistoryPictureToLocalRowAction", "deleteClientHistoryAction", "getClientHistoryItemForAddAction", "listClientHistoryAction"]);
  for (const name of actionNames) {
    const start = source.indexOf(`export async function ${name}`);
    const body = source.slice(start, source.indexOf("\n}\n", start));
    const authAt = body.indexOf("await requireActiveUser()");
    assert.ok(authAt > 0, `${name} authenticates`);
    for (const later of ["createClient()", "from(", "rpc("]) {
      const at = body.indexOf(later);
      assert.ok(at === -1 || at > authAt, `${name}: ${later} comes after requireActiveUser`);
    }
  }
});

test("nothing logs a payload, price, recipe or picture path", () => {
  for (const [name, source] of files) {
    for (const call of source.matchAll(/console\.(error|log|warn|info)\(([^)]*)\)/g)) {
      assert.doesNotMatch(call[2], /price|recipe|payload|picture|row\b|data\b|JSON\.stringify/i, `${name}: ${call[0]}`);
    }
  }
  const quotations = read("../../../app/quotations/actions.ts");
  const start = quotations.indexOf("export async function addHistoryItemToQuotation(");
  const body = quotations.slice(start, quotations.indexOf("export async function addProductTemplateToQuotation"));
  assert.doesNotMatch(body, /console\./);
});

test("the list query never selects the recipe whole", () => {
  const service = files.find(([name]) => name === "client-history-service.ts")![1];
  const listColumns = service.slice(service.indexOf("const LIST_COLUMNS"), service.indexOf("type HistoryRow"));
  assert.doesNotMatch(listColumns.replace(/line_recipe->/g, ""), /line_recipe/);
  assert.match(service, /\.range\(from, from \+ CLIENT_HISTORY_PAGE_SIZE - 1\)/);
});

// ── add to the server builder (custom rows): the same rules as My Collection custom items ───────────────
const quotationsSource = read("../../../app/quotations/actions.ts");
const addStart = quotationsSource.indexOf("export async function addHistoryItemToQuotation(");
const addBody = quotationsSource.slice(addStart, quotationsSource.indexOf("export async function addProductTemplateToQuotation"));
const referenceBody = quotationsSource.slice(quotationsSource.indexOf("export async function addCustomItemToQuotation("), addStart);

test("addHistoryItemToQuotation follows addCustomItemToQuotation step by step (permission, lock, currency rule, one write, picture)", () => {
  assert.ok(addBody.length > 500, "found the action");
  assert.match(addBody, /await requireRecordsManager\(\)/);
  assert.ok(addBody.indexOf("requireRecordsManager") < addBody.indexOf("quotationFormLockReason"), "permission, then lock check");
  assert.ok(addBody.indexOf("quotationFormLockReason") < addBody.indexOf("createBlankQuotationItemRecord"));
  // the client comes from the QUOTATION, never from the browser
  assert.match(addBody, /\.from\("quotations"\)\s*\.select\("client_id,currency"\)/);
  assert.match(addBody, /getClientHistoryItemForAdd\(supabase, \{ id: historyId, clientId: quotation\.client_id \}\)/);
  assert.doesNotMatch(addBody, /textValue\(formData, "client_id"\)/);
  // currency rule + pricing: the same helpers as the My Collection custom item
  assert.match(addBody, /rowOverlayFromCustomItem\(/);
  assert.match(addBody, /quotation\.currency \?\? defaultCurrency/);
  for (const shared of ["quotationPricingRule(supabase, quotationId)", 'roundedLinePricing(overlay.unit_price, "amount", 0, 1, pricingRule)', "recalculateQuotationTotals(quotationId)"]) {
    assert.ok(addBody.includes(shared) && referenceBody.includes(shared), shared);
  }
  // exactly ONE row insert, ONE total recalculation, ONE picture step
  assert.equal((addBody.match(/createBlankQuotationItemRecord\(/g) ?? []).length, 1);
  assert.equal((addBody.match(/recalculateQuotationTotals\(/g) ?? []).length, 1);
  assert.equal((addBody.match(/addHistoryPictureToQuoteRow\(/g) ?? []).length, 1);
  // only manual rows are added here; product rows go through the existing replay in the browser
  assert.match(addBody, /loaded\.item\.kind !== "custom"/);
  // a dead picture never fails the add: the note is appended and the row is returned
  assert.match(addBody, /picture\.ok \? null : clientHistoryMessage\(picture\.kind\)/);
  assert.match(addBody, /return \{ ok: true as const, itemId: result\.itemId/);
  // the picture is attached to the row that was just created
  assert.match(addBody, /rowId: result\.itemId/);
});

test("the new action sits next to the existing ones and changes nothing else in app/quotations/actions.ts", () => {
  const root = new URL("../../../", import.meta.url);
  let before: string;
  try {
    before = execFileSync("git", ["show", "origin/main:app/quotations/actions.ts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(CR).join("");
  } catch {
    return;
  }
  const removed = before.split("\n").filter((line) => !quotationsSource.includes(line));
  assert.deepEqual(removed, [], "no existing line was removed or changed");
});

// ── migrations and diff guard ──────────────────────────────────────────────
test("the spec-2000 migration is copied exactly and no other SQL was written", () => {
  const sql = read("../../../supabase/migrations/20261119140000_client_history_spec_2000.sql");
  assert.match(sql, /char_length\(spec_short\) <= 2000/);
  assert.match(sql, /create or replace function public\.client_quote_history_record\(p_quotation_id uuid\)/);
});

test("PR H-B diff guard: only the listed files, no UI, no package, no SQL beyond the attached migrations; at most 12 files", () => {
  let diff: string[];
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter((line) => line && line !== "AGENTS.md");
  } catch {
    return;
  }
  assert.ok(diff.length <= 12, `${diff.length} files`);
  assert.ok(!diff.some((file) => /^components\/|\.tsx$/.test(file)), "no UI");
  assert.ok(!diff.some((file) => /^package(-lock)?\.json$/.test(file)), "no package change");
  const sql = diff.filter((file) => file.startsWith("supabase/"));
  assert.ok(sql.every((file) => /^supabase\/migrations\/(20261119130000_client_quote_history|20261119140000_client_history_spec_2000)\.sql$/.test(file)), `unexpected SQL: ${sql.join(", ")}`);
  assert.ok(!diff.some((file) => /^lib\/(quotation-pricing|pricing)|^lib\/local\//.test(file)), "no pricing or builder code");
  const allowed = [
    /^supabase\/migrations\/20261119/, /^lib\/quotations\/client-history\//, /^app\/quotations\/actions\.ts$/, /^app\/sales\/clients\/actions\.ts$/,
    /^lib\/products\/saved-setups\/custom-item-line\.test\.mts$/, // one count 4 -> 5 (the history add action also calls createBlankQuotationItemRecord)
  ];
  assert.ok(diff.every((file) => allowed.some((rule) => rule.test(file))), `unexpected files: ${diff.join(", ")}`);
});
