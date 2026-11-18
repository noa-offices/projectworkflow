import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const files = { "gallery.ts": read("./gallery.ts"), "gallery-service.ts": read("./gallery-service.ts"), "gallery-actions.ts": read("./gallery-actions.ts") };

test("no admin client, no service role and never the sources table", () => {
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /createAdminClient|supabase\/admin|service_role|SUPABASE_SERVICE/i, name);
    assert.doesNotMatch(text, /product_gallery_sources/, `${name}: the sources table is never touched`);
  }
});

test('the "use server" file exports only async functions (and types)', () => {
  const actions = files["gallery-actions.ts"];
  assert.match(actions, /^"use server";/);
  const exports = actions.match(/^export .*$/gm) ?? [];
  assert.ok(exports.length >= 7);
  for (const line of exports) assert.match(line, /^export (async function |type )/, line);
  assert.doesNotMatch(actions, /^export (const|let|var|class|function )/m);
});

test("every action calls requireActiveUser before anything else", () => {
  const actions = files["gallery-actions.ts"];
  const bodies = actions.split(/^export async function /m).slice(1);
  assert.equal(bodies.length, 7);
  for (const body of bodies) {
    const name = body.slice(0, body.indexOf("("));
    assert.ok(body.indexOf("await requireActiveUser()") > 0, `${name}: requireActiveUser`);
    assert.ok(body.indexOf("await requireActiveUser()") < body.indexOf("createClient()"), `${name}: auth before the client`);
    assert.ok(body.indexOf("try {") < body.indexOf("await requireActiveUser()"), `${name}: inside try, so it never throws`);
    assert.match(body, /catch \(problem\)[\s\S]*return failure\(/, `${name}: friendly failure`);
  }
});

test("select lists never contain a recipe (except the single-item add read), a price, a discount or a cost", () => {
  const service = files["gallery-service.ts"];
  const selectStrings = [
    ...Array.from(service.matchAll(/\.select\("([^"]*)"/g), (match) => match[1]),
    ...Array.from(service.matchAll(/(?:const|let) (?:LIST_COLUMNS|TEMPLATE_SELECT) = ([\s\S]*?);\n/g), (match) => match[1]),
  ];
  assert.ok(selectStrings.length >= 5);
  for (const text of selectStrings) assert.doesNotMatch(text, /price|discount|cost|total/i, text);
  const withRecipe = selectStrings.filter((text) => /\brecipe\b/.test(text));
  assert.deepEqual(withRecipe, ["id,template_id,item_name,display_name,recipe"], "only the one-item add read selects the recipe");
  const listColumns = service.match(/const LIST_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] ?? "";
  assert.ok(listColumns.includes('"is_hidden"') && !/recipe/.test(listColumns));
});

test("no price, discount or cost field in any type or result of the gallery", () => {
  for (const [name, text] of Object.entries(files)) {
    const code = text.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/**")).join("\n");
    assert.doesNotMatch(code, /\b(unit_?price|net_?price|list_?price|discount\w*|internal_?cost|supplier_?cost|last_unit_price|quotation_?no|client_?name|client_?id)\b/i, name);
  }
});

test("nothing logs a recipe, a row or a payload: logs carry a short name only", () => {
  for (const [name, text] of Object.entries(files)) {
    for (const call of text.split(String.fromCharCode(10)).filter((line) => /console\.\w+\(/.test(line))) {
      assert.match(call, /problem instanceof Error \? problem\.name : typeof problem/, `${name}: ${call}`);
      assert.doesNotMatch(call.replace("product gallery action failed", "").replace("product gallery", ""), /recipe|\brow\b|data|result/i, `${name}: ${call}`);
    }
  }
});

test("the gallery code uses the existing replay input and touches no existing server code", () => {
  const service = files["gallery-service.ts"];
  assert.match(service, /completeGalleryRecipe\(row\.recipe, row\.template_id\)/);
  assert.match(service, /specOverrides: neutralSpecOverrides\(\)/);
  assert.match(service, /isSetupUsable\(\{ template_id: row\.template_id \}, activity\)/);
  assert.match(files["gallery.ts"], /validateRecipeShape\(raw\)/);
});

test("the migration is copied exactly and is the only SQL", () => {
  const sql = read("../../../supabase/migrations/20261119170000_product_gallery.sql");
  assert.match(sql, /create table if not exists public\.product_gallery_items/);
  assert.match(sql, /create or replace function public\.product_gallery_merge\(p_from uuid, p_to uuid\)/);
});

test("PR G-B diff guard: only the gallery files and the attached migration; at most 10 files", () => {
  let base: string;
  try {
    base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  } catch {
    return; // no origin/main in this checkout
  }
  const changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" }).split("\n").map((line) => line.trim()).filter((line) => line && line !== "AGENTS.md");
  const allowed = (file: string) => file === "supabase/migrations/20261119170000_product_gallery.sql" || file.startsWith("lib/products/gallery/") || file === "lib/quotations/client-history/client-history-wiring.test.mts";
  const outside = changed.filter((file) => !allowed(file));
  assert.deepEqual(outside, [], `unexpected files: ${outside.join(", ")}`);
  assert.ok(changed.length <= 10, `${changed.length} files`);
  assert.ok(!changed.some((file) => /^components\/|\.tsx$|^package/.test(file)), "no UI, no package");
});
