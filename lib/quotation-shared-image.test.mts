import assert from "node:assert/strict";
import { test } from "node:test";
import { copySharedImage, isDuplicateImage, sharedImageReplacements, sharedImageSource, sharedImageTarget } from "./quotation-shared-image-core";

const source = "product-images:product-templates/id/picture.png";
test("validates only template Storage paths; other inputs pass through", async () => {
  assert.equal(sharedImageSource(source), "product-templates/id/picture.png");
  for (const value of [null, "https://example.com/picture.png", "quote-images:shared/x.webp", "product-images:brand-materials/x.png", "product-templates/id/picture.png", "product-images:product-templates/../x", "product-images:product-templates/id/%2e/x", "product-images:product-templates//x", "product-images:product-templates/id/x?y", "product-images:product-templates/id/\\x"]) {
    assert.equal(sharedImageSource(value), null);
    if (typeof value === "string") assert.equal(await copySharedImage(value, async () => assert.fail("Must pass through"), () => assert.fail("No log")), value);
  }
});
test("target uses SHA-256 of original bytes and a fixed extension", () => {
  assert.equal(sharedImageTarget(new TextEncoder().encode("abc")), "shared/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.webp");
});
test("failure keeps original and logs once; successful copy returns shared path", async () => {
  let logs = 0;
  assert.equal(await copySharedImage(source, async () => { throw Error("download/compression/upload failure"); }, () => logs++), source);
  assert.equal(logs, 1);
  assert.equal(await copySharedImage(source, async () => "quote-images:shared/hash.webp", () => assert.fail()), "quote-images:shared/hash.webp");
  assert.equal(isDuplicateImage({ statusCode: "409" }), true);
  assert.equal(isDuplicateImage({ error: "Duplicate" }), true);
  assert.equal(isDuplicateImage({ statusCode: "403" }), false);
});
test("unique sources once, maximum three copies, excess sources unchanged", async () => {
  let calls = 0, active = 0, peak = 0, capped = 0;
  const values = Array.from({ length: 5 }, (_, i) => `${source}${i}`);
  const result = await sharedImageReplacements([...values, ...values], async (value) => {
    calls++; active++; peak = Math.max(peak, active);
    await Promise.resolve(); active--; return value.replace("product-images:", "quote-images:");
  }, () => capped++);
  assert.equal(calls, 3); assert.equal(peak, 3); assert.equal(capped, 1);
  assert.equal(result[values[4]], undefined);
});
