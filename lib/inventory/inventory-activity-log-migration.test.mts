import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../../supabase/migrations/20261029100000_inventory_activity_log.sql", import.meta.url), "utf8");
const sql = raw.split("\n").filter(line => !line.trim().startsWith("--")).join("\n");

// Every log_activity(...) call: these arguments become the title, description and metadata.
function logCalls(): string[] {
  const calls: string[] = [];
  for (const match of sql.matchAll(/perform inventory\.log_activity\(/g)) {
    let depth = 1, i = match.index! + match[0].length;
    const start = i;
    while (depth > 0 && i < sql.length) { if (sql[i] === "(") depth++; else if (sql[i] === ")") depth--; i++; }
    calls.push(sql.slice(start, i - 1));
  }
  return calls;
}

const helper = sql.slice(sql.indexOf("function inventory.log_activity("), sql.indexOf("function inventory.activity_label("));

test("helper is security definer with an empty search_path", () => {
  assert.match(helper, /security definer set search_path = ''/);
});
test("every function is security definer or immutable with an empty search_path", () => {
  const defs = [...sql.matchAll(/create or replace function [\s\S]*?\$\$;?/g)].map(m => m[0]);
  assert.ok(defs.length >= 8);
  for (const def of defs) assert.match(def.split("$$")[0], /set search_path = ''/, def.slice(0, 80));
});
test("execute is revoked from public, anon and authenticated for every function", () => {
  const created = [...sql.matchAll(/create or replace function (inventory\.\w+)\(/g)].map(m => m[1]);
  for (const name of created) assert.match(sql, new RegExp(`revoke all on function ${name.replace(".", "\\.")}\\([^)]*\\) from public, anon, authenticated;`), name);
});
test("the insert is wrapped so logging can never block an action", () => {
  assert.match(helper, /exception when others then null/);
  assert.match(helper, /v_actor is null then return/);
  const triggers = [...sql.matchAll(/create or replace function inventory\.trg_log_\w+[\s\S]*?\$\$;/g)].map(m => m[0]);
  assert.equal(triggers.length, 5);
  for (const body of triggers) assert.match(body, /exception when others then null/);
});
test("no money, note or payload wording anywhere in executable SQL", () => {
  assert.doesNotMatch(sql, /\b(cost|costs|price|margin|supplier_cost|supplier|note|review_note|payload|currency|patch|freight|vat)\b/i);
});
test("log calls use only name, ref, quantity, locations, request type and fixed titles", () => {
  const calls = logCalls();
  assert.equal(calls.length, 11);
  for (const call of calls) {
    assert.doesNotMatch(call, /to_jsonb|row_to_json|\bnew\.\*|\bold\.\*|\bnew\)|\bold\)/i, call);
    assert.doesNotMatch(call, /\b(cost|price|margin|note|payload|description|project_label|reference_note)\b/i, call);
  }
  assert.match(helper, /jsonb_build_object\('actorName', coalesce\(v_name, 'A team member'\), 'module', 'inventory'\)/);
});
test("only inventory_* entity types are written", () => {
  for (const call of logCalls()) assert.match(call, /^'inventory_(product|movement|request)'/);
});
test("photos, categories and local brands are not logged", () => {
  assert.doesNotMatch(sql, /product_images|categories|local_brands|storage\./i);
  assert.doesNotMatch(sql, /create trigger[^;]*on inventory\.(product_images|categories|local_brands)/i);
});
test("every trigger is re-runnable and AFTER", () => {
  const triggers = [...sql.matchAll(/create trigger (\w+) (\w+) /g)];
  assert.equal(triggers.length, 10);
  for (const [, name, timing] of triggers) {
    assert.equal(timing, "after");
    assert.match(sql, new RegExp(`drop trigger if exists ${name} on`));
  }
});
