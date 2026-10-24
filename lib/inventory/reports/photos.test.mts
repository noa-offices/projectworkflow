import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { CURRENT_PHOTO_LIMIT, MOVEMENT_PHOTO_LIMIT, PHOTO_CONCURRENCY, PHOTO_TIMEOUT_MS, loadReportPhotos, photoKey, resizeToThumbnail } from "./photos";

const ok = (bytes: Buffer) => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
const bad = { ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
const same = async (input: Buffer) => input;

test("limits: 500 items for the current report, 2,000 for movements, 8 downloads at once, 8 seconds each", () => {
  assert.equal(CURRENT_PHOTO_LIMIT, 500); assert.equal(MOVEMENT_PHOTO_LIMIT, 2000); assert.equal(PHOTO_CONCURRENCY, 8); assert.equal(PHOTO_TIMEOUT_MS, 8000);
});
test("the same stored image has the same key even when the signed link differs", () => {
  assert.equal(photoKey("https://x.test/inventory-images/products/a.jpg?token=1"), photoKey("https://x.test/inventory-images/products/a.jpg?token=2"));
  assert.notEqual(photoKey("https://x.test/a.jpg"), photoKey("https://x.test/b.jpg"));
  assert.equal(photoKey(null), null); assert.equal(photoKey(""), null);
});
test("a photo that fails to download is skipped, counted, and never stops the others", async () => {
  const good = Buffer.from("good");
  const fetcher = async (url: string) => { if (url.includes("broken")) return bad; if (url.includes("throws")) throw new Error("network down"); return ok(good); };
  const result = await loadReportPhotos([{ url: "https://x.test/a.jpg?t=1" }, { url: "https://x.test/broken.jpg?t=1" }, { url: "https://x.test/throws.jpg" }, { url: "https://x.test/b.jpg" }, { url: null }, { url: undefined }], { fetcher, resize: same });
  assert.equal(result.buffers.size, 2); assert.equal(result.skipped, 2);
  assert.ok(result.buffers.has("/a.jpg")); assert.ok(result.buffers.has("/b.jpg"));
});
test("each distinct image is downloaded once, and skipped counts every item that lacks its photo", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => { urls.push(url); return url.includes("broken") ? bad : ok(Buffer.from("x")); };
  const result = await loadReportPhotos([{ url: "https://x.test/a.jpg?t=1" }, { url: "https://x.test/a.jpg?t=2" }, { url: "https://x.test/broken.jpg?t=1" }, { url: "https://x.test/broken.jpg?t=2" }], { fetcher, resize: same });
  assert.equal(urls.length, 2); assert.equal(result.buffers.size, 1); assert.equal(result.skipped, 2);
});
test("a slow photo times out and is skipped", async () => {
  const fetcher = (_url: string, init: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout"))));
  const result = await loadReportPhotos([{ url: "https://x.test/slow.jpg" }], { fetcher, resize: same, timeoutMs: 20 });
  assert.equal(result.buffers.size, 0); assert.equal(result.skipped, 1);
});
test("at most 8 photos download at the same time", async () => {
  let active = 0, peak = 0;
  const fetcher = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return ok(Buffer.from("x")); };
  const result = await loadReportPhotos(Array.from({ length: 30 }, (_, index) => ({ url: `https://x.test/${index}.jpg` })), { fetcher, resize: same });
  assert.equal(result.buffers.size, 30); assert.ok(peak <= 8 && peak > 1, `peak ${peak}`);
});
test("a photo that cannot be shrunk (not an image) is skipped", async () => {
  const result = await loadReportPhotos([{ url: "https://x.test/a.jpg" }], { fetcher: async () => ok(Buffer.from("not an image")) });
  assert.equal(result.buffers.size, 0); assert.equal(result.skipped, 1);
});
test("photos are shrunk to a 240 x 180 JPEG (4:3, cover crop)", async () => {
  const wide = await sharp({ create: { width: 1200, height: 400, channels: 3, background: "#336699" } }).png().toBuffer();
  const meta = await sharp(await resizeToThumbnail(wide)).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [240, 180, "jpeg"]);
  const tall = await sharp({ create: { width: 300, height: 900, channels: 3, background: "#993366" } }).jpeg().toBuffer();
  const tallMeta = await sharp(await resizeToThumbnail(tall)).metadata();
  assert.deepEqual([tallMeta.width, tallMeta.height], [240, 180]);
});
