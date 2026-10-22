import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupPictures, collectPicturePaths, pictureCleanupMessage, templatePicturePath } from "./template-picture-cleanup";

const id = "10000000-0000-4000-8000-000000000001";
const path = `product-templates/${id}/picture.webp`;
test("collects and deduplicates only owned product-image paths in all approved scopes", () => {
  const reference = `product-template-references/${id}/group/file.png`;
  assert.deepEqual(collectPicturePaths([path, `product-images:${path}`, `https://example.test/storage/v1/object/sign/product-images/${path}?token=x`, reference, null], id), [path, reference]);
  for (const prefix of ["product-template-row-references", "product-template-subgroup-references", "product-template-group-references"]) {
    assert.equal(templatePicturePath(`${prefix}/${id}/nested/file.png`, id), `${prefix}/${id}/nested/file.png`);
  }
  for (const unsafe of [`quote-images:${path}`, "shared/hash.webp", `product-images:shared/${id}/x`, "brand-materials/x.png", "product-templates/other/picture.webp", `${path}/../other`, `${path}//x`, `${path}%2fx`, `${path}\\x`, `https://example.test/${path}`, "x".repeat(301)]) {
    assert.equal(templatePicturePath(unsafe, id), null);
  }
});
test("quotation references are kept; user removes only unused files", async () => {
  const unused = `${path}2`;
  const result = await cleanupPictures([path, unused], {
    guard: async () => [path], userRemove: async (paths) => { assert.deepEqual(paths, [unused]); return { paths, error: false }; }, adminRemove: async () => assert.fail("No fallback needed"),
  });
  assert.deepEqual(result, { removed: 1, kept: 1, warning: false });
  assert.match(pictureCleanupMessage(result), /1 files removed, 1 kept because a quotation uses them/);
});
test("missing/error/malformed guard and incomplete collection fail closed", async () => {
  for (const guard of [async () => { throw Error("RPC missing"); }, async () => ["unexpected/path"], async () => null as unknown as string[]]) {
    const result = await cleanupPictures([path], { guard, userRemove: async () => assert.fail("No removal"), adminRemove: async () => assert.fail("No fallback") });
    assert.equal(result.removed, 0); assert.equal(result.guardFailed, true);
    assert.match(pictureCleanupMessage(result), /no files removed/);
  }
  assert.equal((await cleanupPictures(null, { guard: async () => assert.fail(), userRemove: async () => assert.fail(), adminRemove: async () => assert.fail() })).guardFailed, true);
});
test("checks all 500-path guard batches before deleting; later failure retains everything", async () => {
  let batches = 0;
  const paths = Array.from({ length: 501 }, (_, i) => `${path}${i}`);
  const result = await cleanupPictures(paths, {
    guard: async (batch) => { assert.ok(batch.length <= 500); if (++batches === 2) throw Error("Failed second guard"); return []; },
    userRemove: async () => assert.fail("Must finish guard first"), adminRemove: async () => assert.fail(),
  });
  assert.equal(batches, 2); assert.equal(result.removed, 0);
});
test("removal batches max 100, user first; admin retries only unconfirmed server-collected paths", async () => {
  const paths = Array.from({ length: 205 }, (_, i) => `${path}${i}`);
  let userCalls = 0, adminCalls = 0;
  const result = await cleanupPictures(paths, {
    guard: async () => [],
    userRemove: async (batch) => { userCalls++; assert.ok(batch.length <= 100); return { paths: batch.slice(0, 1), error: false }; },
    adminRemove: async (batch) => { adminCalls++; assert.ok(batch.length <= 99); assert.ok(batch.every((p) => paths.includes(p))); return { paths: batch, error: false }; },
  });
  assert.equal(userCalls, 3); assert.equal(adminCalls, 3); assert.equal(result.removed, 205); assert.equal(result.warning, false);
});
test("Storage failure becomes a warning; empty plan is harmless", async () => {
  const deps = { guard: async () => [], userRemove: async () => { throw Error("Storage denied"); }, adminRemove: async () => ({ paths: [], error: true }) };
  const result = await cleanupPictures([path], deps);
  assert.equal(result.warning, true); assert.equal(result.removed, 0);
  assert.match(pictureCleanupMessage(result), /Product deleted. Some files could not be removed./);
  assert.deepEqual(await cleanupPictures([], deps), { removed: 0, kept: 0, warning: false });
});
