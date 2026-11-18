/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake rows/storage and deliberately hostile input */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOM_IMAGE_MAX_BYTES,
  buildImagePath,
  buildQuoteRowImagePath,
  isOwnImagePath,
  ownImagePaths,
  quoteImageStoragePath,
  safeFileName,
  validateImageFile,
} from "./custom-item-image";
import {
  addCustomItemPictureToQuoteRow,
  copyCustomImageToQuoteRowForUser,
  copyQuoteImageToCollectionForUser,
  createCustomItemForUser,
  deleteCustomItemForUser,
  listCustomItemsForUser,
  removeUnusedCustomImageForUser,
  updateCustomItemForUser,
  uploadCustomItemImageForUser,
} from "./saved-custom-items-service";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const QUOTATION = "33333333-3333-4333-8333-333333333333";
const ITEM_FOLDER = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-18T10:00:00Z");

// ── Validator and paths (pure) ───────────────────────────────────────────────────────────────────────────────
test("validateImageFile: png/jpeg/webp up to 5 MB are accepted", () => {
  for (const [type, name] of [["image/png", "a.png"], ["image/jpeg", "a.jpg"], ["image/jpeg", "a.JPEG"], ["image/webp", "a.webp"], ["image/png", "camera"]] as const) {
    assert.equal(validateImageFile(type, 1000, name).ok, true, `${type} ${name}`);
  }
  assert.equal(validateImageFile("image/png", CUSTOM_IMAGE_MAX_BYTES, "a.png").ok, true, "exactly 5 MB");
  assert.equal(CUSTOM_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
});

test("validateImageFile: other types, 5 MB + 1, empty and unsafe names are rejected with plain English", () => {
  for (const type of ["application/pdf", "image/gif", "image/svg+xml", "text/html", "", undefined, 7]) {
    const result = validateImageFile(type, 1000, "a.png");
    assert.equal(result.ok, false, String(type));
    assert.match((result as any).error, /PNG, JPG and WebP/);
  }
  assert.match((validateImageFile("image/png", CUSTOM_IMAGE_MAX_BYTES + 1, "a.png") as any).error, /5 MB or smaller/);
  assert.match((validateImageFile("image/png", 0, "a.png") as any).error, /empty/);
  assert.equal(validateImageFile("image/png", Number.NaN, "a.png").ok, false);
  for (const name of ["", "   ", "../a.png", "a/b.png", "a\\b.png", "a..png", "bad\u0000.png", "x".repeat(201) + ".png", "a.exe", "a.pdf"]) {
    assert.equal(validateImageFile("image/png", 1000, name).ok, false, JSON.stringify(name));
  }
});

test("safeFileName: slug plus an extension from the TYPE, never from the name", () => {
  assert.equal(safeFileName("My Photo (1).PNG", "image/png"), "my-photo-1.png");
  assert.equal(safeFileName("camera", "image/jpeg"), "camera.jpg");
  assert.equal(safeFileName("a.exe", "image/webp"), "a.webp");
  assert.equal(safeFileName("", "image/png"), "image.png");
  assert.ok(safeFileName("x".repeat(200) + ".png", "image/png").length <= 70);
});

test("buildImagePath: always {owner}/{item}/{timestamp}-{safe name}; isOwnImagePath rejects other owners and traversal", () => {
  const path = buildImagePath(USER_A, ITEM_FOLDER, "Desk Photo.PNG", NOW, "image/png");
  assert.equal(path, `${USER_A}/${ITEM_FOLDER}/${NOW.getTime()}-desk-photo.png`);
  assert.ok(path.startsWith(`${USER_A}/`));
  assert.equal(isOwnImagePath(USER_A, path), true);
  assert.equal(isOwnImagePath(USER_B, path), false, "another owner's path");
  for (const bad of [
    `${USER_A}/../${USER_B}/x/y.png`, `${USER_A}/${ITEM_FOLDER}/../../${USER_B}/f.png`, `${USER_A}/${ITEM_FOLDER}/a/../b.png`,
    `${USER_A}//f.png`, `${USER_A}/f.png`, `${USER_A}/${ITEM_FOLDER}/a/b.png`, `/${USER_A}/${ITEM_FOLDER}/f.png`,
    `${USER_A}/${ITEM_FOLDER}/%2e%2e.png`, `${USER_A}/${ITEM_FOLDER}/f.png\u0000`, `${USER_A}/${ITEM_FOLDER}/${"x".repeat(300)}.png`, "", null, undefined, 5,
  ]) assert.equal(isOwnImagePath(USER_A, bad), false, JSON.stringify(bad));
  assert.equal(isOwnImagePath("not-a-uuid", "not-a-uuid/a/b.png"), false);
  assert.throws(() => buildImagePath("../x", ITEM_FOLDER, "a.png", NOW));
  assert.throws(() => buildImagePath(USER_A, "../x", "a.png", NOW));
});

test("ownImagePaths keeps only the caller's own paths (signing filter)", () => {
  const mine = `${USER_A}/${ITEM_FOLDER}/1-a.png`;
  const theirs = `${USER_B}/${ITEM_FOLDER}/1-a.png`;
  assert.deepEqual(ownImagePaths(USER_A, [mine, theirs, mine, `${USER_A}/../${USER_B}/x/y.png`, 7, null]), [mine]);
  assert.deepEqual(ownImagePaths(USER_A, "not an array"), []);
  assert.equal(ownImagePaths(USER_A, Array.from({ length: 100 }, (_, i) => `${USER_A}/${ITEM_FOLDER}/${i}-a.png`)).length, 60);
});

test("quote row picture references: only quote-images row pictures are accepted; quote path convention is the existing one", () => {
  const ok = `quote-images:quotation-items/${QUOTATION}/row-1/1700000000000-a.png`;
  assert.equal(quoteImageStoragePath(ok), `quotation-items/${QUOTATION}/row-1/1700000000000-a.png`);
  for (const bad of ["product-images:x/y/z/a.png", `quote-images:quotation-items/${QUOTATION}/../x/a.png`, "quote-images:other/${QUOTATION}/r/a.png", `${USER_A}/${ITEM_FOLDER}/a.png`, "https://x/y.png", `quote-images:quotation-items/${QUOTATION}/r`, null, 4]) {
    assert.equal(quoteImageStoragePath(bad), null, String(bad));
  }
  assert.equal(buildQuoteRowImagePath(QUOTATION, "item-abc", "Desk.PNG", NOW, "image/png"), `quotation-items/${QUOTATION}/item-abc/${NOW.getTime()}-desk.png`);
  assert.throws(() => buildQuoteRowImagePath("../q", "item-abc", "a.png", NOW));
});

// ── Fake client: tables + storage ────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
type World = {
  items: Row[];
  quoteRows: Row[];
  files: Map<string, { type: string; bytes: Uint8Array }>; // "bucket/path"
  calls: string[];
  failInsert?: boolean;
  failUpdate?: boolean;
  failRemove?: boolean;
  failUpload?: Set<string>;
  failDownload?: boolean;
};
const newWorld = (): World => ({ items: [], quoteRows: [], files: new Map(), calls: [], failUpload: new Set() });

function fake(world: World, session: string) {
  let counter = 0;
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private filters: Array<(row: Row) => boolean> = [];
    constructor(private table: string) {}
    select() { return this; }
    insert(payload: Row) { this.op = "insert"; this.payload = payload; return this; }
    update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    order() { return this; }
    limit() { return this; }
    private run(): { data: Row[] | null; error: { message: string } | null } {
      const rows = this.table === "quotation_items" ? world.quoteRows : world.items;
      if (this.op === "insert") {
        if (world.failInsert) return { data: null, error: { message: "boom" } };
        if (this.payload.owner_id !== session) return { data: null, error: { message: "rls" } };
        const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, use_count: 0, created_at: "2026-01-01", ...this.payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const owned = this.table === "quotation_items" ? rows : rows.filter((row) => row.owner_id === session);
      const matched = owned.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.op === "update") {
        if (world.failUpdate) return { data: null, error: { message: "boom" } };
        matched.forEach((row) => Object.assign(row, this.payload));
        return { data: matched, error: null };
      }
      if (this.op === "delete") {
        matched.forEach((row) => rows.splice(rows.indexOf(row), 1));
        world.calls.push("row-deleted");
        return { data: matched, error: null };
      }
      return { data: matched.map((row) => ({ ...row })), error: null };
    }
    single() { const r = this.run(); return Promise.resolve(r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "none" } }); }
    maybeSingle() { return Promise.resolve({ data: this.run().data?.[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array, options: { contentType: string }) => {
        world.calls.push(`upload ${bucket}/${path}`);
        if (world.failUpload?.has(bucket)) return { data: null, error: { message: "denied" } };
        // storage policy: the first folder of my-collection-images must be the caller's id
        if (bucket === "my-collection-images" && path.split("/")[0] !== session) return { data: null, error: { message: "policy" } };
        world.files.set(`${bucket}/${path}`, { type: options.contentType, bytes: body });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        world.calls.push(`download ${bucket}/${path}`);
        const file = world.files.get(`${bucket}/${path}`);
        if (world.failDownload || !file) return { data: null, error: { message: "missing" } };
        return { data: new Blob([file.bytes as BlobPart], { type: file.type }), error: null };
      },
      remove: async (paths: string[]) => {
        world.calls.push(`remove ${bucket}/${paths.join(",")}`);
        if (world.failRemove) throw new Error("storage down");
        for (const path of paths) world.files.delete(`${bucket}/${path}`);
        return { data: [], error: null };
      },
    }),
  };
  return { from: (table: string) => new Query(table), storage } as unknown as SupabaseClient;
}

const png = (size = 10) => ({ type: "image/png", size, name: "Desk Photo.png", arrayBuffer: async () => new Uint8Array(size).buffer as ArrayBuffer });
const good = { brandName: "Acme", itemName: "Desk", sellingPrice: "100", currency: "AED" };
const ownPath = (owner = USER_A, stamp = 1) => `${owner}/${ITEM_FOLDER}/${1700000000000 + stamp}-desk.png`; // real stamps are 13 digits
const seed = (world: World, owner: string, path: string | null, extra: Row = {}) => {
  const row: Row = { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(world.items.length + 1).padStart(12, "0")}`, owner_id: owner, brand_name: "Acme", item_name: "Desk", item_code: null, specification: null, unit_label: "Pc", selling_price: 100, currency: "AED", price_saved_at: "2026-01-01", created_at: "2026-01-01", last_used_at: null, use_count: 0, ...extra };
  if (path) { row.image_path = path; world.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array(4) }); }
  world.items.push(row);
  return row;
};

// ── Upload ───────────────────────────────────────────────────────────────────────────────────────────────────
test("upload: owner folder comes from the session, the path is built on the server, a client path or owner is ignored", async () => {
  const world = newWorld();
  const result = await uploadCustomItemImageForUser(fake(world, USER_A), USER_A, { ...png(), path: `${USER_B}/x/y.png`, owner_id: USER_B, ownerId: USER_B } as any, NOW);
  assert.equal(result.ok, true);
  const path = (result as any).path as string;
  assert.ok(path.startsWith(`${USER_A}/`), path);
  assert.equal(isOwnImagePath(USER_A, path), true);
  assert.match(path, new RegExp(`-desk-photo\\.png$`));
  assert.equal(world.files.get(`my-collection-images/${path}`)?.type, "image/png");
  assert.equal(world.calls.filter((call) => call.startsWith("upload")).length, 1);
  assert.ok(world.calls.every((call) => !call.includes(USER_B)));
});

test("upload: wrong type or size is rejected before anything is stored", async () => {
  const world = newWorld();
  const client = fake(world, USER_A);
  assert.equal((await uploadCustomItemImageForUser(client, USER_A, { ...png(), type: "application/pdf", name: "a.pdf" }, NOW) as any).ok, false);
  assert.match(((await uploadCustomItemImageForUser(client, USER_A, png(CUSTOM_IMAGE_MAX_BYTES + 1), NOW)) as any).error, /5 MB or smaller/);
  assert.equal((await uploadCustomItemImageForUser(client, USER_A, png(0), NOW) as any).ok, false);
  // a file that claims to be small but is bigger is caught by the real byte length
  const liar = { type: "image/png", size: 10, name: "a.png", arrayBuffer: async () => new Uint8Array(CUSTOM_IMAGE_MAX_BYTES + 5).buffer as ArrayBuffer };
  assert.equal((await uploadCustomItemImageForUser(client, USER_A, liar, NOW) as any).ok, false);
  assert.equal(world.files.size, 0);
  assert.equal(world.calls.length, 0);
});

test("upload: a storage failure returns a plain message", async () => {
  const world = newWorld();
  world.failUpload!.add("my-collection-images");
  const result = await uploadCustomItemImageForUser(fake(world, USER_A), USER_A, png(), NOW);
  assert.deepEqual(result, { ok: false, error: "The picture could not be uploaded. Try again." });
});

// ── Save, replace, remove, delete ────────────────────────────────────────────────────────────────────────────
test("create: only the owner's own picture path is accepted and saved; someone else's path is refused", async () => {
  const world = newWorld();
  const path = ownPath();
  world.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array(3) });
  const created = await createCustomItemForUser(fake(world, USER_A), USER_A, { ...good, imagePath: path });
  assert.equal(created.ok, true);
  assert.equal(world.items[0].image_path, path);
  assert.equal(world.items[0].owner_id, USER_A);
  const refused = await createCustomItemForUser(fake(world, USER_A), USER_A, { ...good, imagePath: ownPath(USER_B) });
  assert.deepEqual(refused, { ok: false, error: "The picture is not valid. Add it again." });
  assert.equal(world.items.length, 1);
  const noPicture = await createCustomItemForUser(fake(world, USER_A), USER_A, good);
  assert.equal(noPicture.ok, true);
  assert.ok(!("image_path" in world.items[1]), "no picture: the column is not written");
});

test("create: a failed save after an upload removes the just-uploaded file (no orphan)", async () => {
  const world = newWorld();
  const path = ownPath();
  world.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array(3) });
  world.failInsert = true;
  const result = await createCustomItemForUser(fake(world, USER_A), USER_A, { ...good, imagePath: path });
  assert.equal(result.ok, false);
  assert.equal(world.files.has(`my-collection-images/${path}`), false);
  assert.ok(world.calls.includes(`remove my-collection-images/${path}`));
});

test("update: replacing a picture removes the OLD file after the row changed; a failed removal does not fail the save", async () => {
  const world = newWorld();
  const oldPath = ownPath(USER_A, 1);
  const newPath = ownPath(USER_A, 2);
  const row = seed(world, USER_A, oldPath);
  world.files.set(`my-collection-images/${newPath}`, { type: "image/png", bytes: new Uint8Array(3) });
  const result = await updateCustomItemForUser(fake(world, USER_A), USER_A, row.id, { ...good, imagePath: newPath });
  assert.equal(result.ok, true);
  assert.equal(row.image_path, newPath);
  assert.equal(world.files.has(`my-collection-images/${oldPath}`), false);
  assert.ok(world.files.has(`my-collection-images/${newPath}`));

  // removal throws: the action still succeeds
  const world2 = newWorld();
  const row2 = seed(world2, USER_A, oldPath);
  world2.failRemove = true;
  const result2 = await updateCustomItemForUser(fake(world2, USER_A), USER_A, row2.id, { ...good, imagePath: null });
  assert.equal(result2.ok, true);
  assert.equal(row2.image_path, null);
});

test("update: no imagePath keeps the picture; null removes it (file removed after the row change)", async () => {
  const world = newWorld();
  const path = ownPath();
  const row = seed(world, USER_A, path);
  assert.equal((await updateCustomItemForUser(fake(world, USER_A), USER_A, row.id, good)).ok, true);
  assert.equal(row.image_path, path);
  assert.ok(world.files.has(`my-collection-images/${path}`));
  assert.equal((await updateCustomItemForUser(fake(world, USER_A), USER_A, row.id, { ...good, imagePath: null })).ok, true);
  assert.equal(row.image_path, null);
  assert.equal(world.files.has(`my-collection-images/${path}`), false);
});

test("update: a failed save keeps the old picture and removes a newly uploaded one", async () => {
  const world = newWorld();
  const oldPath = ownPath(USER_A, 1);
  const newPath = ownPath(USER_A, 2);
  const row = seed(world, USER_A, oldPath);
  world.files.set(`my-collection-images/${newPath}`, { type: "image/png", bytes: new Uint8Array(3) });
  world.failUpdate = true;
  const result = await updateCustomItemForUser(fake(world, USER_A), USER_A, row.id, { ...good, imagePath: newPath });
  assert.equal(result.ok, false);
  assert.equal(row.image_path, oldPath);
  assert.ok(world.files.has(`my-collection-images/${oldPath}`), "old picture kept");
  assert.equal(world.files.has(`my-collection-images/${newPath}`), false, "new upload cleaned up");
});

test("delete: the file is removed AFTER the row is deleted; a failed removal never fails the delete", async () => {
  const world = newWorld();
  const path = ownPath();
  const row = seed(world, USER_A, path);
  const result = await deleteCustomItemForUser(fake(world, USER_A), USER_A, row.id);
  assert.equal(result.ok, true);
  assert.equal(world.files.has(`my-collection-images/${path}`), false);
  assert.ok(world.calls.indexOf("row-deleted") < world.calls.indexOf(`remove my-collection-images/${path}`), "row first, file second");

  const world2 = newWorld();
  const row2 = seed(world2, USER_A, path);
  world2.failRemove = true;
  assert.equal((await deleteCustomItemForUser(fake(world2, USER_A), USER_A, row2.id)).ok, true);
  assert.equal(world2.items.length, 0);

  // another owner's item is never deleted and its file is never touched
  const world3 = newWorld();
  const foreign = seed(world3, USER_B, ownPath(USER_B));
  assert.equal((await deleteCustomItemForUser(fake(world3, USER_A), USER_A, foreign.id)).ok, false);
  assert.ok(world3.files.has(`my-collection-images/${ownPath(USER_B)}`));
});

test("dropping an unsaved picture: removed only when it is the caller's own and no item uses it", async () => {
  const world = newWorld();
  const kept = ownPath(USER_A, 1);
  const unused = ownPath(USER_A, 2);
  seed(world, USER_A, kept);
  world.files.set(`my-collection-images/${unused}`, { type: "image/png", bytes: new Uint8Array(3) });
  const client = fake(world, USER_A);
  assert.equal(await removeUnusedCustomImageForUser(client, USER_A, kept), false, "still used by an item");
  assert.ok(world.files.has(`my-collection-images/${kept}`));
  assert.equal(await removeUnusedCustomImageForUser(client, USER_A, unused), true);
  assert.equal(world.files.has(`my-collection-images/${unused}`), false);
  assert.equal(await removeUnusedCustomImageForUser(client, USER_A, ownPath(USER_B)), false, "another owner's path");
  assert.equal(await removeUnusedCustomImageForUser(client, USER_A, `${USER_A}/../${USER_B}/x/y.png`), false);
});

test("list: the picture path is returned only for items that have one", async () => {
  const world = newWorld();
  seed(world, USER_A, ownPath(), { item_name: "With" });
  seed(world, USER_A, null, { item_name: "Without" });
  const list = await listCustomItemsForUser(fake(world, USER_A), USER_A);
  assert.equal(list.find((item) => item.itemName === "With")?.imagePath, ownPath());
  assert.ok(!("imagePath" in (list.find((item) => item.itemName === "Without") as object)));
});

// ── Copies ───────────────────────────────────────────────────────────────────────────────────────────────────
test("save from a quote row: the row picture is COPIED into my-collection-images under the owner's folder", async () => {
  const world = newWorld();
  const source = `quotation-items/${QUOTATION}/item-1/1700000000000-chair.png`;
  world.files.set(`quote-images/${source}`, { type: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  const result = await copyQuoteImageToCollectionForUser(fake(world, USER_A), USER_A, `quote-images:${source}`, NOW);
  assert.equal(result.ok, true);
  const path = (result as any).path as string;
  assert.equal(isOwnImagePath(USER_A, path), true);
  assert.deepEqual(Array.from(world.files.get(`my-collection-images/${path}`)!.bytes), [1, 2, 3]);
  assert.ok(world.files.has(`quote-images/${source}`), "copy, not move: the row keeps its picture");
  // then saved with the item
  assert.equal((await createCustomItemForUser(fake(world, USER_A), USER_A, { ...good, imagePath: path })).ok, true);
  assert.equal(world.items[0].image_path, path);
});

test("save from a quote row: removing the preselected picture saves without one; bad references are refused", async () => {
  const world = newWorld();
  // the form sends no imagePath when the user removed the preselected picture
  assert.equal((await createCustomItemForUser(fake(world, USER_A), USER_A, good)).ok, true);
  assert.ok(!("image_path" in world.items[0]));
  assert.equal(world.calls.length, 0, "nothing copied");
  for (const bad of ["product-images:x/y/z/a.png", `quote-images:quotation-items/${QUOTATION}/../x/a.png`, `${USER_B}/${ITEM_FOLDER}/a.png`, "", null]) {
    assert.equal((await copyQuoteImageToCollectionForUser(fake(world, USER_A), USER_A, bad, NOW) as any).ok, false, String(bad));
  }
  assert.equal(world.files.size, 0);
  const missing = await copyQuoteImageToCollectionForUser(fake(world, USER_A), USER_A, `quote-images:quotation-items/${QUOTATION}/item-1/1-a.png`, NOW);
  assert.equal(missing.ok, false);
});

test("add into a quote: the picture is copied into quote-images under the NEW row's path, row field is bucket:path", async () => {
  const world = newWorld();
  const path = ownPath();
  world.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array([9, 8, 7]) });
  const copied = await copyCustomImageToQuoteRowForUser(fake(world, USER_A), USER_A, { imagePath: path, quotationId: QUOTATION, rowId: "item-new-1" }, NOW);
  assert.equal(copied.ok, true);
  const ref = (copied as any).ref as string;
  assert.equal(ref, `quote-images:quotation-items/${QUOTATION}/item-new-1/${NOW.getTime()}-desk.png`);
  assert.ok(!ref.includes("my-collection-images"), "a quote row never points at a My Collection path");
  assert.ok(!ref.includes(USER_A));
  assert.deepEqual(Array.from(world.files.get(`quote-images/${ref.slice("quote-images:".length)}`)!.bytes), [9, 8, 7]);
  assert.ok(world.files.has(`my-collection-images/${path}`), "the item keeps its own picture");
  // only the caller's own picture can be copied
  assert.equal((await copyCustomImageToQuoteRowForUser(fake(world, USER_A), USER_A, { imagePath: ownPath(USER_B), quotationId: QUOTATION, rowId: "r" }, NOW) as any).ok, false);
});

test("server builder add: sets the row's usual picture field only; no other key; a copy failure still adds the row and reports it", async () => {
  const world = newWorld();
  const path = ownPath();
  world.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array([1]) });
  world.quoteRows.push({ id: "row-1", quotation_id: QUOTATION, item_type: "custom", item_name_snapshot: "Desk", proposed_image_url_snapshot: null });
  const before = Object.keys(world.quoteRows[0]).sort();
  const ok = await addCustomItemPictureToQuoteRow(fake(world, USER_A), USER_A, { imagePath: path, quotationId: QUOTATION, rowId: "row-1" });
  assert.deepEqual(ok, { ok: true, attached: true });
  assert.match(world.quoteRows[0].proposed_image_url_snapshot, new RegExp(`^quote-images:quotation-items/${QUOTATION}/row-1/\\d+-desk\\.png$`));
  assert.deepEqual(Object.keys(world.quoteRows[0]).sort(), before, "no new keys on the row");

  // item without a picture: nothing happens
  assert.deepEqual(await addCustomItemPictureToQuoteRow(fake(world, USER_A), USER_A, { imagePath: null, quotationId: QUOTATION, rowId: "row-1" }), { ok: true, attached: false });

  // copy failure (quote-images upload denied): the row stays, no picture, the user is told
  const world2 = newWorld();
  world2.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array([1]) });
  world2.quoteRows.push({ id: "row-2", quotation_id: QUOTATION, proposed_image_url_snapshot: null });
  world2.failUpload!.add("quote-images");
  const failed = await addCustomItemPictureToQuoteRow(fake(world2, USER_A), USER_A, { imagePath: path, quotationId: QUOTATION, rowId: "row-2" });
  assert.deepEqual(failed, { ok: false, note: "The picture could not be copied, so the row was added without it." });
  assert.equal(world2.quoteRows[0].proposed_image_url_snapshot, null);

  // the row update fails: the copied file is removed again
  const world3 = newWorld();
  world3.files.set(`my-collection-images/${path}`, { type: "image/png", bytes: new Uint8Array([1]) });
  world3.quoteRows.push({ id: "row-3", quotation_id: QUOTATION, proposed_image_url_snapshot: null });
  world3.failUpdate = true;
  const failed3 = await addCustomItemPictureToQuoteRow(fake(world3, USER_A), USER_A, { imagePath: path, quotationId: QUOTATION, rowId: "row-3" });
  assert.equal(failed3.ok, false);
  assert.equal([...world3.files.keys()].filter((key) => key.startsWith("quote-images/")).length, 0, "no orphan in quote-images");
});

// ── Source-text and diff guards ──────────────────────────────────────────────────────────────────────────────
test("image actions: authenticate inside, session owner, caller's client, no admin client, only own paths signed", () => {
  const actions = read("./saved-custom-images-actions.ts");
  assert.match(actions, /^"use server";/);
  assert.equal((actions.match(/await requireActiveUser\(\)/g) ?? []).length, 4);
  assert.equal((actions.match(/await requireRecordsManager\(\)/g) ?? []).length, 1);
  assert.match(actions, /uploadCustomItemImageForUser\(supabase, user\.id, file\)/);
  assert.match(actions, /ownImagePaths\(user\.id, paths\)/);
  assert.match(actions, /formData\.get\("file"\)/);
  assert.ok(!/formData\.get\("(path|owner|owner_id|item)/.test(actions), "no client path or owner is read");
  assert.match(actions, /from "@\/lib\/supabase\/server"/);
  for (const file of ["./saved-custom-images-actions.ts", "./saved-custom-items-service.ts", "./custom-item-image.ts", "../../../components/products/my-collection-custom-items.tsx", "../../../components/quotations/save-as-custom-item-button.tsx", "../../../components/quotations/custom-item-picker-pane.tsx"]) {
    assert.ok(!/service[_-]?role|createAdmin|supabase\/admin|SUPABASE_SERVICE/i.test(read(file)), `${file}: no admin client`);
  }
  // existing counts stay valid: the original custom-items actions file keeps its 5 authenticated actions
  assert.equal((read("./saved-custom-items-actions.ts").match(/await requireActiveUser\(\)/g) ?? []).length, 5);
});

test("the new migration is saved unchanged and quote/product signing is untouched", () => {
  const migration = read("../../../supabase/migrations/20261117150000_my_collection_images_bucket.sql");
  assert.match(migration, /values \('my-collection-images', 'my-collection-images', false, 5242880/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
  const diff = changedFiles();
  if (diff === null) return; // not a git checkout (zero-network environment)
  for (const forbidden of ["lib/quotation-image-path.ts", "lib/quotation-image-upload.ts", "lib/products/saved-setups/recipe.ts", "lib/products/saved-setups/saved-setups-service.ts", "lib/products/saved-setups/actions.ts", "components/products/product-library-selector.tsx"]) {
    assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  }
  assert.ok(!diff.some((file) => /^lib\/(quotations|pricing)|^components\/products\/(my-collection-configured|configured)/.test(file)), "Configured tab and pricing files untouched");
  assert.ok(!diff.some((file) => /^supabase\/migrations\//.test(file) && !file.endsWith("20261117150000_my_collection_images_bucket.sql")), "only the one migration is added");
  assert.ok(!diff.some((file) => /^package(-lock)?\.json$/.test(file)));
});

function changedFiles(): string[] | null {
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    return [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}
