import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// PR 4-1: text checks on the two sharing migrations (zero live calls). The SQL itself is not run here.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");
const sharesRaw = read("../../../supabase/migrations/20261119100000_my_collection_shares.sql");
const grantsRaw = read("../../../supabase/migrations/20261119110000_my_collection_insert_grants.sql");
// Comments are removed first, so a word inside a comment can never satisfy or break a check.
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const shares = stripComments(sharesRaw);
const grants = stripComments(grantsRaw);

const FUNCTIONS = [
  "my_collection_json_forbidden_key",
  "my_collection_share_targets",
  "my_collection_send_share",
  "my_collection_attach_share_picture",
  "my_collection_unsend_share",
  "my_collection_dismiss_share",
  "my_collection_accept_custom_item",
  "my_collection_accept_setup",
  "my_collection_purge_finished_shares",
];
const DEFINER_FUNCTIONS = FUNCTIONS.filter((name) => name !== "my_collection_json_forbidden_key");

function functionBody(name: string): string {
  const start = shares.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = shares.indexOf("create or replace function public.", start + 10);
  // Comments are already removed, so a function ends at the next function or at the "revoke all on function" statement.
  const stop = Math.min(...[next, shares.indexOf("revoke all on function", start)].filter((index) => index > start), shares.length);
  return shares.slice(start, stop);
}

test("table my_collection_shares: exists, RLS enabled, exactly 2 select policies, SELECT is the only grant", () => {
  assert.match(shares, /create table if not exists public\.my_collection_shares \(/);
  assert.match(shares, /alter table public\.my_collection_shares enable row level security;/);
  const policies = shares.match(/create policy \w+ on public\.my_collection_shares for (\w+) to authenticated/g) ?? [];
  assert.equal(policies.length, 2, "only two policies on the shares table");
  assert.ok(policies.every((policy) => /for select to authenticated/.test(policy)), "both are select policies");
  assert.match(shares, /create policy shares_select_recipient on public\.my_collection_shares for select to authenticated\s+using \(recipient_id = \(select auth\.uid\(\)\) and \(select public\.current_user_is_active\(\)\)\)/);
  assert.match(shares, /create policy shares_select_sender on public\.my_collection_shares for select to authenticated\s+using \(sender_id = \(select auth\.uid\(\)\) and \(select public\.current_user_is_active\(\)\)\)/);
  assert.match(shares, /revoke all on public\.my_collection_shares from public, anon, authenticated;/);
  const tableGrants = shares.match(/grant [^;]*? on public\.my_collection_shares to [^;]*;/g) ?? [];
  assert.deepEqual(tableGrants, ["grant select on public.my_collection_shares to authenticated;"]);
  assert.doesNotMatch(shares, /grant\s+(insert|update|delete|all)[^;]*on public\.my_collection_shares/i);
  assert.doesNotMatch(shares, /public\.my_collection_shares[^;]*to\s+(anon|public)\b/i);
});

test("all 9 functions exist and every one sets search_path = ''", () => {
  const created = shares.match(/create or replace function public\.\w+\(/g) ?? [];
  assert.equal(created.length, 9);
  for (const name of FUNCTIONS) {
    const body = functionBody(name);
    assert.match(body, /set search_path = ''/, `${name} sets search_path = ''`);
  }
  assert.equal((shares.match(/set search_path = ''/g) ?? []).length, 9);
  assert.equal((shares.match(/security definer/g) ?? []).length, DEFINER_FUNCTIONS.length, "8 security definer functions");
  assert.doesNotMatch(functionBody("my_collection_json_forbidden_key"), /security definer/, "the key walker is a plain immutable function");
});

test("every SECURITY DEFINER function is revoked from public/anon and granted to authenticated only", () => {
  const revoke = shares.match(/revoke all on function[\s\S]*?;/)?.[0] ?? "";
  const grant = shares.match(/grant execute on function[\s\S]*?;/)?.[0] ?? "";
  assert.ok(revoke && grant, "one revoke and one grant statement");
  assert.match(revoke, /from public, anon;$/);
  assert.match(grant, /to authenticated;$/);
  for (const name of DEFINER_FUNCTIONS) {
    assert.ok(functionBody(name).includes("security definer"), `${name} is security definer`);
    assert.ok(revoke.includes(`public.${name}(`), `${name} is in the revoke`);
    assert.ok(grant.includes(`public.${name}(`), `${name} is in the grant`);
  }
  assert.ok(revoke.includes("public.my_collection_json_forbidden_key(jsonb)"), "the walker is revoked too");
  assert.equal((shares.match(/grant execute on function/g) ?? []).length, 1);
  assert.doesNotMatch(shares, /grant execute[\s\S]*?to\s+(anon|public)\b/i, "never granted to anon or public");
  assert.doesNotMatch(shares, /grant\s+(all|execute)\s+on\s+all functions/i);
});

test("picture rule: the incoming path and the fixed file name", () => {
  assert.match(shares, /constraint shares_picture_path check \(picture_path is null or picture_path = recipient_id::text \|\| '\/incoming\/' \|\| id::text \|\| '\/picture\.webp'\)/);
  assert.match(shares, /storage\.filename\(name\) = 'picture\.webp'/);
  assert.match(shares, /\(storage\.foldername\(name\)\)\[2\] = 'incoming'/);
  assert.match(shares, /array_length\(storage\.foldername\(name\), 1\) = 3/);
  assert.match(shares, /s\.status = 'pending'/, "the sender may write only while the share is pending");
  assert.equal((shares.match(/create policy my_collection_images_\w+ on storage\.objects/g) ?? []).length, 2, "one insert and one delete policy, nothing else on storage");
  assert.doesNotMatch(shares, /on storage\.objects for (update|select)/);
});

test("forbidden-key walker: one lateral block with a single union all; the recursive part refers to walk once", () => {
  const body = functionBody("my_collection_json_forbidden_key");
  assert.match(body, /with recursive walk\(v\) as \(/);
  const recursivePart = body.slice(body.indexOf("with recursive walk(v) as ("), body.indexOf("select exists"));
  const lateral = recursivePart.slice(recursivePart.indexOf("lateral ("), recursivePart.lastIndexOf(") c"));
  assert.equal((lateral.match(/union all/g) ?? []).length, 1, "exactly one union all inside the lateral block");
  assert.equal((recursivePart.match(/union all/g) ?? []).length, 2, "the other one is the CTE's own anchor / recursive split");
  assert.equal((recursivePart.match(/\bfrom walk\b/g) ?? []).length, 1, "walk is referenced once in the recursive part (no second recursive reference)");
  assert.equal((lateral.match(/\bwalk\b/g) ?? []).length, 0, "the lateral block itself never names walk");
  // same key list as the app's recipe price guard
  for (const key of ["price", "unitprice", "netprice", "nettotal", "exchangerate", "internalcost", "suppliercost", "discountvalue", "finalprice"]) {
    assert.ok(body.includes(`'${key}'`), key);
  }
});

test("grants file: revokes INSERT and re-grants only the listed columns, never provenance or id", () => {
  assert.match(grants, /revoke insert on public\.saved_setups from authenticated;/);
  assert.match(grants, /revoke insert on public\.saved_custom_items from authenticated;/);
  const columns = (table: string) => {
    const match = grants.match(new RegExp(`grant insert \\(([^)]*)\\)\\s+on public\\.${table} to authenticated;`));
    assert.ok(match, `${table} column grant`);
    return match[1].split(",").map((name) => name.trim());
  };
  assert.deepEqual(columns("saved_setups"), ["owner_id", "template_id", "brand_id", "brand_name", "product_name", "setup_name", "note", "recipe", "recipe_version", "spec_overrides", "template_pricing_version_at_save"]);
  assert.deepEqual(columns("saved_custom_items"), ["owner_id", "brand_name", "item_name", "item_code", "specification", "unit_label", "selling_price", "currency", "price_saved_at", "image_path"]);
  for (const table of ["saved_setups", "saved_custom_items"]) {
    for (const forbidden of ["shared_by", "source_item_id", "source_setup_id", "id"]) {
      assert.ok(!columns(table).includes(forbidden), `${table} does not grant insert on ${forbidden}`);
    }
  }
  assert.equal((grants.match(/grant /g) ?? []).length, 2, "only the two column grants");
  assert.doesNotMatch(grants, /grant\s+(all|insert\s+on|select|update|delete)/i, "no table-wide or other grant");
  assert.doesNotMatch(grants, /\bto\s+(anon|public)\b/i);
});

test("no admin client or service role anywhere in the new SQL", () => {
  for (const [name, sql] of [["shares", sharesRaw], ["grants", grantsRaw]] as const) {
    assert.ok(!/service[_-]?role|createAdmin|supabase\/admin|SUPABASE_SERVICE/i.test(sql), `${name}: no service role or admin reference`);
  }
});

test("the app's two insert sites write only granted columns (so the grants file cannot break them)", () => {
  const setups = read("./saved-setups-service.ts");
  const setupInsert = setups.slice(setups.indexOf('.from("saved_setups")\n    .insert({'), setups.indexOf(".select(\"id\")", setups.indexOf('.insert({')));
  const keys = Array.from(setupInsert.matchAll(/^\s{6}(\w+)(?::|,)/gm)).map((match) => match[1]);
  const granted = grants.match(/grant insert \(([^)]*)\)\s+on public\.saved_setups/)![1].split(",").map((name) => name.trim());
  assert.ok(keys.length >= 11, `found ${keys.length} insert keys`);
  for (const key of keys) assert.ok(granted.includes(key), `saved_setups insert key ${key} is granted`);
  assert.ok(!/shared_by|source_setup_id/.test(setupInsert));

  const custom = read("./saved-custom-items-service.ts");
  const customInsert = custom.slice(custom.indexOf('.insert({ owner_id: userId'), custom.indexOf(".select(\"id\")", custom.indexOf('.insert({ owner_id: userId')));
  assert.match(customInsert, /owner_id: userId, \.\.\.value, \.\.\.\(picture\.path \? \{ image_path: picture\.path \} : \{\}\), price_saved_at:/);
  assert.ok(!/shared_by|source_item_id/.test(customInsert));
});
