/* eslint-disable @typescript-eslint/no-explicit-any -- hostile input and in-memory fakes */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp, { type Sharp } from "sharp";
import {
  IMAGE_MESSAGES,
  IMAGE_REASONS,
  MAX_INPUT_BYTES,
  MAX_LONG_SIDE,
  MAX_STORED_BYTES,
  classifyStorageError,
  compressionLadder,
  firstFittingStep,
  formatImageSize,
  imageMessage,
  isWebpBytes,
  planResize,
  validateCopyableStored,
  validateImageFile,
  validateStoredWebp,
  type ImageErrorKind,
} from "./custom-item-image";
import { pictureDimensions, toStoredWebp } from "./custom-item-image-sharp";
import { compressWithEngine, type PictureEngine } from "../../images/compress-custom-item-image";
import { copyCustomImageToQuoteRowForUser, copyQuoteImageToCollectionForUser, uploadCustomItemImageForUser } from "./saved-custom-items-service";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const USER_A = "11111111-1111-4111-8111-111111111111";
const QUOTATION = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-18T10:00:00Z");
const MB = 1024 * 1024;

// ── planResize ───────────────────────────────────────────────────────────────────────────────────────────────
test("planResize: keeps the aspect ratio and caps the long side at 1600", () => {
  assert.deepEqual(planResize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(planResize(3000, 4000), { width: 1200, height: 1600 }, "portrait");
  assert.deepEqual(planResize(1601, 1601), { width: 1600, height: 1600 });
  assert.equal(MAX_LONG_SIDE, 1600);
  const wide = planResize(12000, 300);
  assert.equal(wide.width, 1600);
  assert.equal(wide.height, 40, "very wide image keeps its ratio");
});

test("planResize: never enlarges, handles tiny images and bad numbers", () => {
  assert.deepEqual(planResize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(planResize(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(planResize(1, 1), { width: 1, height: 1 });
  assert.deepEqual(planResize(10000, 1), { width: 1600, height: 1 }, "never below 1 px");
  assert.deepEqual(planResize(0, 0), { width: 1, height: 1 });
  assert.deepEqual(planResize(Number.NaN, 50), { width: 1, height: 50 });
  assert.deepEqual(planResize(4000, 3000, 1000), { width: 1000, height: 750 });
});

// ── Quality / size ladder ────────────────────────────────────────────────────────────────────────────────────
test("ladder: quality 85, 80, 75, 70, 60 at 1600 px, then 1400, 1200, 1000 px; small pictures are never enlarged", () => {
  const steps = compressionLadder(4000, 3000);
  assert.deepEqual(steps.map((step) => step.quality), [85, 80, 75, 70, 60, 60, 60, 60]);
  assert.deepEqual(steps.map((step) => Math.max(step.width, step.height)), [1600, 1600, 1600, 1600, 1600, 1400, 1200, 1000]);
  const small = compressionLadder(800, 600);
  assert.deepEqual(small.map((step) => step.quality), [85, 80, 75, 70, 60], "800 px is already under every reduced size");
  assert.ok(small.every((step) => step.width === 800 || step.width < 800), "never larger than the picture");
  assert.deepEqual(compressionLadder(1100, 700).map((step) => Math.max(step.width, step.height)), [1100, 1100, 1100, 1100, 1100, 1000]);
  assert.deepEqual(compressionLadder(500, 400).map((step) => Math.max(step.width, step.height)), [500, 500, 500, 500, 500], "nothing to reduce");
});

test("ladder: stops at the FIRST step that fits 2 MB, and rejects when nothing fits", async () => {
  const steps = compressionLadder(4000, 3000);
  const seen: number[] = [];
  const sizes = [5 * MB, 4 * MB, 2.5 * MB, 1.9 * MB, 1 * MB, 1 * MB, 1 * MB, 1 * MB];
  const found = await firstFittingStep(steps, async (step) => { seen.push(seen.length); return { size: sizes[seen.length - 1], value: step.quality }; });
  assert.equal(found?.step.quality, 70, "fourth step is the first under 2 MB");
  assert.deepEqual(seen, [0, 1, 2, 3], "later steps are not tried");
  assert.equal((await firstFittingStep(steps, async () => ({ size: MAX_STORED_BYTES, value: 1 })))?.step.quality, 85, "exactly 2 MB fits");
  assert.equal(await firstFittingStep(steps, async () => ({ size: MAX_STORED_BYTES + 1, value: 1 })), null, "nothing fits -> rejected");
  assert.equal(await firstFittingStep(steps, async () => ({ size: 0, value: 1 })), null, "an empty result never counts as fitting");
});

// ── Validators and magic bytes ───────────────────────────────────────────────────────────────────────────────
test("validateImageFile (input): png/jpeg/webp up to 10 MB; 10 MB + 1 and other types rejected", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) assert.equal(validateImageFile(type, 10 * MB, "a.png").ok, true, type);
  const big = validateImageFile("image/jpeg", 10 * MB + 1, "a.jpg") as any;
  assert.equal(big.ok, false);
  assert.equal(big.kind, "too_large");
  for (const type of ["image/gif", "application/pdf", "text/plain", "image/svg+xml", undefined]) assert.equal((validateImageFile(type, 10, "a.png") as any).kind, "wrong_type", String(type));
  assert.equal((validateImageFile("image/png", 10, "fake.pdf") as any).kind, "wrong_type", "extension that is not a picture");
});

test("validateStoredWebp: webp only, 1 byte to 2 MB, real WebP bytes; a renamed png is rejected by the magic-byte check", async () => {
  const webp = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer());
  const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer());
  const jpg = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  assert.equal(isWebpBytes(webp), true);
  assert.equal(isWebpBytes(png), false);
  assert.equal(isWebpBytes(jpg), false);
  assert.equal(isWebpBytes(new Uint8Array(5)), false);
  assert.equal(isWebpBytes(null), false);
  assert.equal(validateStoredWebp("image/webp", webp.byteLength, "a.webp", webp).ok, true);
  assert.equal(validateStoredWebp("image/webp", 2 * MB, "a.webp").ok, true, "exactly 2 MB");
  assert.equal((validateStoredWebp("image/webp", 2 * MB + 1, "a.webp") as any).reason, "over_limit");
  assert.equal((validateStoredWebp("image/png", 100, "a.png") as any).reason, "not_webp");
  assert.equal((validateStoredWebp("image/jpeg", 100, "a.jpg") as any).reason, "not_webp");
  assert.equal((validateStoredWebp("image/webp", 0, "a.webp") as any).reason, "empty");
  assert.equal((validateStoredWebp("image/webp", png.byteLength, "renamed.webp", png) as any).reason, "invalid_webp", "a png renamed to .webp");
  assert.equal((validateStoredWebp("image/webp", 100, "../a.webp") as any).reason, "bad_name");
});

test("validateCopyableStored: a stored WebP and OLD png/jpeg pictures can be copied to a quote; anything else cannot", () => {
  assert.equal(validateCopyableStored("image/webp", 1000), true);
  assert.equal(validateCopyableStored("image/png", 4 * MB), true, "old pictures keep working");
  assert.equal(validateCopyableStored("image/jpeg", 5 * MB), true);
  assert.equal(validateCopyableStored("image/jpeg", 5 * MB + 1), false);
  assert.equal(validateCopyableStored("application/pdf", 10), false);
  assert.equal(validateCopyableStored("image/webp", 0), false);
});

// ── Failure messages: one map, one test per message ──────────────────────────────────────────────────────────
const EXPECTED: Array<[ImageErrorKind, string | number | undefined, string]> = [
  ["wrong_type", undefined, "This file type is not supported. Please choose a PNG, JPG or WebP picture."],
  ["too_large", 12.3 * MB, "This picture is too large (12.3 MB). Please choose one under 10 MB."],
  ["unreadable", undefined, "This picture could not be opened. It may be damaged. Please try another one."],
  ["too_detailed", undefined, "This picture is too detailed to shrink under 2 MB. Please choose a smaller or simpler picture."],
  ["upload_failed", undefined, "The picture could not be uploaded. Check your connection and try again."],
  ["not_allowed", undefined, "You are not allowed to upload here. Please sign in again."],
  ["server_rejected", "not_webp", "The picture was rejected by the server (reason: not a WebP picture). Please choose another one."],
  ["copy_from_row_failed", "not_found", "The row's picture could not be copied (reason: picture not found). You can save without it, or choose another picture."],
  ["copy_to_quote_failed", "storage", "The picture could not be copied, so the row was added without it. (Reason: storage error.)"],
  ["copy_to_quote_failed", undefined, "The picture could not be copied, so the row was added without it."],
  ["unknown", undefined, "Something went wrong with this picture. Please try again."],
];
for (const [kind, detail, text] of EXPECTED) {
  test(`message: ${kind}${detail !== undefined ? ` (${String(detail).slice(0, 12)})` : ""} -> exact text`, () => {
    assert.equal(imageMessage(kind, detail), text);
  });
}

test("messages: the map has every kind, and no message can contain a path, an owner id, a stack trace or storage JSON", () => {
  assert.deepEqual(Object.keys(IMAGE_MESSAGES).sort(), ["copy_from_row_failed", "copy_to_quote_failed", "not_allowed", "server_rejected", "too_detailed", "too_large", "unknown", "unreadable", "upload_failed", "wrong_type"].sort());
  const hostile = `${USER_A}/folder/file.webp at Object.<anonymous> (/srv/app.js:1:1) {"statusCode":"403","error":"Unauthorized"}`;
  for (const kind of Object.keys(IMAGE_MESSAGES) as ImageErrorKind[]) {
    const text = imageMessage(kind, hostile);
    assert.ok(!text.includes(USER_A) && !text.includes("/") && !text.includes("{") && !/\bat \w/.test(text), `${kind}: ${text}`);
  }
  // a free-text detail is replaced, only the closed reasons list can appear
  assert.match(imageMessage("server_rejected", hostile), /reason: unexpected error/);
  for (const reason of Object.values(IMAGE_REASONS)) assert.ok(!/[/{}\\]/.test(reason), reason);
});

test("classifyStorageError: permission problems are told apart from connection problems", () => {
  assert.equal(classifyStorageError({ statusCode: "403", message: "x" }), "not_allowed");
  assert.equal(classifyStorageError({ status: 401 }), "not_allowed");
  assert.equal(classifyStorageError({ message: "new row violates row-level security policy" }), "not_allowed");
  assert.equal(classifyStorageError({ message: "Network request failed" }), "upload_failed");
  assert.equal(classifyStorageError(null), "upload_failed");
});

test("formatImageSize", () => {
  assert.equal(formatImageSize(240 * 1024), "240 KB");
  assert.equal(formatImageSize(1.2 * MB), "1.2 MB");
  assert.equal(formatImageSize(10), "1 KB");
});

// ── Browser helper: typed errors, never throws (fake engine, no browser) ─────────────────────────────────────────
const fileOf = (type: string, size: number, name = "photo.jpg") => ({ type, size, name, lastModified: 0 }) as unknown as File;
const blobOf = (size: number, type = "image/webp") => new Blob([new Uint8Array(size)], { type });
function engineOf(width: number, height: number, encode: (quality: number, w: number, h: number) => Blob | null | Promise<Blob | null>): PictureEngine {
  return { decode: async () => ({ width, height, encode: async (step) => encode(step.quality, step.width, step.height), close: () => undefined }) };
}

test("browser helper: success returns a WebP file under 2 MB at the first step that fits", async () => {
  const calls: number[] = [];
  const result = await compressWithEngine(fileOf("image/jpeg", 6 * MB, "My Phone Photo.JPG"), engineOf(4000, 3000, (quality) => { calls.push(quality); return blobOf(quality >= 80 ? 3 * MB : 1 * MB); }));
  assert.equal(result.ok, true);
  const ok = result as Extract<typeof result, { ok: true }>;
  assert.equal(ok.file.type, "image/webp");
  assert.equal(ok.file.name, "my-phone-photo.webp");
  assert.equal(ok.finalBytes, 1 * MB);
  assert.equal(ok.originalBytes, 6 * MB);
  assert.deepEqual(calls, [85, 80, 75], "stops at the first step that fits");
});

test("browser helper: wrong type, over 10 MB, unreadable, too detailed, unsupported browser, unexpected -> typed errors with the exact message", async () => {
  const fine = engineOf(100, 100, () => blobOf(1000));
  const wrong = await compressWithEngine(fileOf("application/pdf", 1000, "a.pdf"), fine);
  assert.deepEqual([wrong.ok, (wrong as any).kind, (wrong as any).error], [false, "wrong_type", imageMessage("wrong_type")]);
  assert.equal((await compressWithEngine(fileOf("image/gif", 1000, "a.gif"), fine) as any).kind, "wrong_type");

  const large = await compressWithEngine(fileOf("image/jpeg", 12 * MB), fine);
  assert.deepEqual([(large as any).kind, (large as any).error], ["too_large", imageMessage("too_large", 12 * MB)]);
  assert.match((large as any).error, /\(12\.0 MB\)/);
  assert.equal((await compressWithEngine(fileOf("image/jpeg", 10 * MB + 1), fine) as any).kind, "too_large");

  const broken: PictureEngine = { decode: async () => { throw new Error("decode failed"); } };
  assert.equal((await compressWithEngine(fileOf("image/png", 100, "fake.png"), broken) as any).kind, "unreadable", "a text file renamed fake.png");
  assert.equal((await compressWithEngine(fileOf("image/png", 100), engineOf(0, 0, () => blobOf(10))) as any).kind, "unreadable");
  assert.equal((await compressWithEngine(fileOf("image/png", 0), fine) as any).kind, "unreadable", "empty file");

  const detailed = await compressWithEngine(fileOf("image/jpeg", 9 * MB), engineOf(4000, 3000, () => blobOf(3 * MB)));
  assert.deepEqual([(detailed as any).kind, (detailed as any).error], ["too_detailed", imageMessage("too_detailed")]);

  assert.equal((await compressWithEngine(fileOf("image/jpeg", 1000), engineOf(100, 100, () => blobOf(10, "image/png"))) as any).kind, "unknown", "a browser that cannot make WebP");
  assert.equal((await compressWithEngine(fileOf("image/jpeg", 1000), engineOf(100, 100, () => null)) as any).kind, "unknown");
  assert.equal((await compressWithEngine(fileOf("image/jpeg", 1000), engineOf(100, 100, () => { throw new Error("canvas exploded"); })) as any).kind, "unknown");
  assert.equal((await compressWithEngine(null as any, fine) as any).ok, false, "garbage input never throws");
});

// ── sharp: server conversions ────────────────────────────────────────────────────────────────────────────────
async function photo(width: number, height: number, extra: (image: Sharp) => Sharp = (image) => image.jpeg({ quality: 92 })) {
  // photo-like: smooth gradients plus noise so the file is a realistic few MB
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 3;
    const noise = (Math.sin(x * 0.07) + Math.cos(y * 0.05)) * 40 + ((x * 7919 + y * 104729) % 23);
    raw[i] = (x / width) * 200 + noise; raw[i + 1] = (y / height) * 200 + noise; raw[i + 2] = 120 + noise;
  }
  return new Uint8Array(await extra(sharp(raw, { raw: { width, height, channels: 3 } })).toBuffer());
}

test("sharp: a 4000x3000 jpeg becomes a WebP <= 2 MB, long side 1600, and the sizes are measured", async () => {
  const original = await photo(4000, 3000);
  const result = await toStoredWebp(original);
  assert.equal(result.ok, true);
  const ok = result as Extract<typeof result, { ok: true }>;
  assert.ok(isWebpBytes(ok.bytes));
  assert.ok(ok.bytes.byteLength <= MAX_STORED_BYTES, String(ok.bytes.byteLength));
  const size = await pictureDimensions(ok.bytes);
  assert.deepEqual(size, { width: 1600, height: 1200 });
  console.log(`[measured] 4000x3000 jpeg ${Math.round(original.byteLength / 1024)} KB -> ${size!.width}x${size!.height} webp ${Math.round(ok.bytes.byteLength / 1024)} KB`);
});

test("sharp: never enlarges a small picture, keeps transparency, strips metadata, auto-rotates from EXIF", async () => {
  const small = new Uint8Array(await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.4 } } }).png().toBuffer());
  const result = await toStoredWebp(small) as any;
  assert.equal(result.ok, true);
  assert.deepEqual(await pictureDimensions(result.bytes), { width: 200, height: 100 }, "never enlarged");
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.hasAlpha, true, "transparency kept");
  assert.equal(meta.exif, undefined, "metadata stripped");

  // a phone photo stored sideways with EXIF orientation 6 (rotate 90): the result is upright (width/height swapped)
  const sideways = new Uint8Array(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#789" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
  const rotated = await toStoredWebp(sideways) as any;
  assert.equal(rotated.ok, true);
  assert.deepEqual(await pictureDimensions(rotated.bytes), { width: 200, height: 300 });
  assert.equal((await sharp(rotated.bytes).metadata()).orientation, undefined);
});

test("sharp: damaged or non-picture bytes are 'unreadable', never an exception", async () => {
  assert.deepEqual(await toStoredWebp(new TextEncoder().encode("this is not a picture")), { ok: false, reason: "unreadable" });
  assert.deepEqual(await toStoredWebp(new Uint8Array(0)), { ok: false, reason: "unreadable" });
  assert.equal(await pictureDimensions(new Uint8Array([1, 2, 3])), null);
});

// ── Server upload and copy paths ─────────────────────────────────────────────────────────────────────────────
type World = { files: Map<string, { type: string; bytes: Uint8Array }>; calls: string[] };
function fake(world: World, session: string) {
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array, options: { contentType: string }) => {
        world.calls.push(`upload ${bucket}`);
        if (bucket === "my-collection-images" && path.split("/")[0] !== session) return { data: null, error: { message: "policy" } };
        world.files.set(`${bucket}/${path}`, { type: options.contentType, bytes: body });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const file = world.files.get(`${bucket}/${path}`);
        return file ? { data: new Blob([file.bytes as BlobPart], { type: file.type }), error: null } : { data: null, error: { message: "missing" } };
      },
      remove: async () => ({ data: [], error: null }),
    }),
  };
  return { storage } as unknown as SupabaseClient;
}
const fileFrom = (bytes: Uint8Array, type = "image/webp", name = "Desk Photo.webp") => ({ type, size: bytes.byteLength, name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });

test("server upload: accepts a small webp, builds a .webp path in the owner's folder, ignores a client path or owner", async () => {
  const world: World = { files: new Map(), calls: [] };
  const webp = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#abc" } }).webp().toBuffer());
  const result = await uploadCustomItemImageForUser(fake(world, USER_A), USER_A, { ...fileFrom(webp), path: "someone-else/x/y.webp", owner_id: "someone-else" } as any, NOW) as any;
  assert.equal(result.ok, true);
  assert.match(result.path, new RegExp(`^${USER_A}/[0-9a-f-]{36}/${NOW.getTime()}-desk-photo\\.webp$`));
  assert.equal(world.files.get(`my-collection-images/${result.path}`)?.type, "image/webp");
  assert.equal(result.size, webp.byteLength);
});

test("server upload: rejects non-webp, over 2 MB, a renamed png, an unreadable webp; every reason is plain English", async () => {
  const world: World = { files: new Map(), calls: [] };
  const client = fake(world, USER_A);
  const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer());
  const jpg = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).jpeg().toBuffer());
  const cases: Array<[any, RegExp]> = [
    [fileFrom(png, "image/png", "a.png"), /reason: not a WebP picture/],
    [fileFrom(jpg, "image/jpeg", "a.jpg"), /reason: not a WebP picture/],
    [fileFrom(png, "image/webp", "renamed.webp"), /reason: not a valid WebP file/],
    [{ type: "image/webp", size: 2 * MB + 1, name: "big.webp", arrayBuffer: async () => new Uint8Array(2 * MB + 1).buffer }, /reason: over 2 MB/],
    [fileFrom(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5, 6]), "image/webp", "bad.webp"), /reason: damaged or unreadable picture/],
  ];
  for (const [file, expected] of cases) {
    const result = await uploadCustomItemImageForUser(client, USER_A, file, NOW) as any;
    assert.equal(result.ok, false);
    assert.match(result.error, expected);
    assert.ok(!result.error.includes(USER_A) && !result.error.includes("/"));
  }
  assert.equal(world.calls.length, 0, "nothing stored");
});

test("server upload: a permission error and a connection error give different messages", async () => {
  const webp = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#abc" } }).webp().toBuffer());
  const denied = { storage: { from: () => ({ upload: async () => ({ data: null, error: { statusCode: "403", message: "new row violates row-level security policy" } }) }) } } as unknown as SupabaseClient;
  const offline = { storage: { from: () => ({ upload: async () => ({ data: null, error: { message: "fetch failed" } }) }) } } as unknown as SupabaseClient;
  assert.equal((await uploadCustomItemImageForUser(denied, USER_A, fileFrom(webp), NOW) as any).error, imageMessage("not_allowed"));
  assert.equal((await uploadCustomItemImageForUser(offline, USER_A, fileFrom(webp), NOW) as any).error, imageMessage("upload_failed"));
  const throwing = { storage: { from: () => { throw new Error("boom with /secret/path"); } } } as unknown as SupabaseClient;
  const unknown = await uploadCustomItemImageForUser(throwing, USER_A, fileFrom(webp), NOW) as any;
  assert.equal(unknown.error, imageMessage("unknown"), "never throws; the detail is not shown");
});

test("server upload: a webp wider than 1600 px is re-encoded with sharp (fallback)", async () => {
  const world: World = { files: new Map(), calls: [] };
  const wide = new Uint8Array(await sharp({ create: { width: 2400, height: 100, channels: 3, background: "#456" } }).webp().toBuffer());
  const result = await uploadCustomItemImageForUser(fake(world, USER_A), USER_A, fileFrom(wide), NOW) as any;
  assert.equal(result.ok, true);
  const stored = world.files.get(`my-collection-images/${result.path}`)!.bytes;
  assert.deepEqual(await pictureDimensions(stored), { width: 1600, height: 67 });
  assert.ok(isWebpBytes(stored) && stored.byteLength <= MAX_STORED_BYTES);
});

test("copy: a big jpeg quote picture becomes a WebP <= 2 MB (<= 1600 px) in the owner's folder; the row keeps its picture", async () => {
  const world: World = { files: new Map(), calls: [] };
  const source = `quotation-items/${QUOTATION}/item-1/1700000000000-chair.jpg`;
  const jpeg = await photo(3000, 2000);
  world.files.set(`quote-images/${source}`, { type: "image/jpeg", bytes: jpeg });
  const result = await copyQuoteImageToCollectionForUser(fake(world, USER_A), USER_A, `quote-images:${source}`, NOW) as any;
  assert.equal(result.ok, true);
  const stored = world.files.get(`my-collection-images/${result.path}`)!;
  assert.equal(stored.type, "image/webp");
  assert.ok(result.path.startsWith(`${USER_A}/`) && result.path.endsWith("-chair.webp"));
  assert.ok(isWebpBytes(stored.bytes) && stored.bytes.byteLength <= MAX_STORED_BYTES);
  assert.deepEqual(await pictureDimensions(stored.bytes), { width: 1600, height: 1067 });
  assert.ok(world.files.has(`quote-images/${source}`));
  console.log(`[measured] row picture 3000x2000 jpeg ${Math.round(jpeg.byteLength / 1024)} KB -> webp ${Math.round(stored.bytes.byteLength / 1024)} KB`);
});

test("copy from a row: failures give a reason, never a path (damaged picture, missing file, not a picture)", async () => {
  const world: World = { files: new Map(), calls: [] };
  const client = fake(world, USER_A);
  const damaged = `quotation-items/${QUOTATION}/item-1/1700000000000-bad.png`;
  world.files.set(`quote-images/${damaged}`, { type: "image/png", bytes: new TextEncoder().encode("not really a png") });
  const bad = await copyQuoteImageToCollectionForUser(client, USER_A, `quote-images:${damaged}`, NOW) as any;
  assert.equal(bad.error, imageMessage("copy_from_row_failed", "unreadable"));
  const missing = await copyQuoteImageToCollectionForUser(client, USER_A, `quote-images:quotation-items/${QUOTATION}/item-1/1700000000000-none.png`, NOW) as any;
  assert.equal(missing.error, imageMessage("copy_from_row_failed", "not_found"));
  const notPicture = await copyQuoteImageToCollectionForUser(client, USER_A, "product-images:a/b/c/d.png", NOW) as any;
  assert.equal(notPicture.error, imageMessage("copy_from_row_failed", "not_copyable"));
  for (const result of [bad, missing, notPicture]) assert.ok(!result.error.includes(QUOTATION) && !result.error.includes(USER_A) && !result.error.includes("/"));
});

test("copy into a quote: a stored WebP is copied as is, content type image/webp, a .webp name; a wrong content type or name is refused", async () => {
  const world: World = { files: new Map(), calls: [] };
  const webp = new Uint8Array(await sharp({ create: { width: 30, height: 30, channels: 3, background: "#123" } }).webp().toBuffer());
  const mine = `${USER_A}/44444444-4444-4444-8444-444444444444/1700000000001-desk.webp`;
  world.files.set(`my-collection-images/${mine}`, { type: "image/webp", bytes: webp });
  const copied = await copyCustomImageToQuoteRowForUser(fake(world, USER_A), USER_A, { imagePath: mine, quotationId: QUOTATION, rowId: "item-new" }, NOW) as any;
  assert.equal(copied.ok, true);
  assert.equal(copied.ref, `quote-images:quotation-items/${QUOTATION}/item-new/${NOW.getTime()}-desk.webp`);
  const target = world.files.get(`quote-images/${copied.ref.slice("quote-images:".length)}`)!;
  assert.equal(target.type, "image/webp");
  assert.deepEqual(Array.from(target.bytes), Array.from(webp), "copied as is");
  // a .webp whose stored content type is something else is refused with a reason
  const odd = `${USER_A}/44444444-4444-4444-8444-444444444444/1700000000002-odd.webp`;
  world.files.set(`my-collection-images/${odd}`, { type: "image/png", bytes: webp });
  assert.equal((await copyCustomImageToQuoteRowForUser(fake(world, USER_A), USER_A, { imagePath: odd, quotationId: QUOTATION, rowId: "r" }, NOW) as any).error, imageMessage("copy_to_quote_failed", "not_copyable"));
  // a missing file gives a reason, not a path
  const gone = await copyCustomImageToQuoteRowForUser(fake(world, USER_A), USER_A, { imagePath: `${USER_A}/44444444-4444-4444-8444-444444444444/1700000000003-gone.webp`, quotationId: QUOTATION, rowId: "r" }, NOW) as any;
  assert.equal(gone.error, imageMessage("copy_to_quote_failed", "not_found"));
  // an OLD png picture (stored before this change) is still copied as is
  const old = `${USER_A}/44444444-4444-4444-8444-444444444444/1700000000004-old.png`;
  world.files.set(`my-collection-images/${old}`, { type: "image/png", bytes: new Uint8Array([1, 2, 3]) });
  assert.equal((await copyCustomImageToQuoteRowForUser(fake(world, USER_A), USER_A, { imagePath: old, quotationId: QUOTATION, rowId: "r2" }, NOW) as any).ok, true);
});

// ── Source-text guards ───────────────────────────────────────────────────────────────────────────────────────
test("actions never throw to the client and use no admin client; messages are mapped", () => {
  const actions = read("./saved-custom-images-actions.ts");
  assert.match(actions, /^"use server";/);
  for (const name of ["uploadCustomItemImage", "removeCustomItemImage", "copyQuoteImageToCollection", "copyCustomItemImageToQuote", "signCustomItemImageUrls"]) {
    const start = actions.indexOf(`export async function ${name}`);
    assert.ok(start >= 0, name);
    const body = actions.slice(start, actions.indexOf("\nexport async function ", start + 10) === -1 ? undefined : actions.indexOf("\nexport async function ", start + 10));
    assert.match(body, /try \{[\s\S]*\} catch/, `${name} wraps its work in try/catch`);
  }
  assert.match(actions, /NEXT_REDIRECT/, "a sign-in redirect becomes the 'not allowed' message");
  assert.match(actions, /Vercel limits a request body\s+\*?\s*to about 4\.5 MB/);
  assert.ok(!/service[_-]?role|createAdmin|supabase\/admin/i.test(actions + read("./saved-custom-items-service.ts") + read("./custom-item-image-sharp.ts") + read("../../images/compress-custom-item-image.ts")));
});

test("form: compresses in the browser BEFORE uploading, shows Compressing/Uploading, disables Save, inline error with Try again / Choose another", () => {
  const form = read("../../../components/products/my-collection-custom-items.tsx");
  const compress = form.indexOf("await compressToWebp(file)");
  const upload = form.indexOf("await uploadCustomItemImage(body)");
  assert.ok(compress > 0 && upload > compress, "compression runs before the upload");
  assert.match(form, /body\.set\("file", compressed\.file\)/, "only the compressed WebP is posted, never the original");
  assert.match(form, /Vercel limits a request body to about 4\.5 MB/);
  assert.match(form, /"Compressing\.\.\."/);
  assert.match(form, /"Uploading\.\.\."/);
  assert.match(form, /disabled=\{pending \|\| Boolean\(imageBusy\)\}/, "Save is disabled while compressing or uploading");
  assert.match(form, /role="alert" className="mt-2 space-y-2"/);
  assert.match(form, /Try again/);
  assert.match(form, /Choose another picture/);
  assert.match(form, /PNG, JPG or WebP, up to 10 MB\. We compress it to a small WebP automatically\./);
  assert.match(form, /Saved as \$\{formatImageSize/);
  assert.match(form, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(form, /setImageError\(copied\.error\)/, "a failed row-picture copy shows its reason in the popup");
  assert.match(form, /catch \{\s*setImageError\(imageMessage\("upload_failed"\)\)/, "network failure shows the upload reason");
});

test("popup uses the same form (so compression and inline errors), and the local builder shows the copy reason", () => {
  const popup = read("../../../components/quotations/save-as-custom-item-button.tsx");
  assert.match(popup, /<CustomItemForm [^>]*rowImageRef=\{rowPictureRef\(row\)\}/);
  const builder = read("../../../components/quotations/local-quotation-builder.tsx");
  assert.match(builder, /pictureFailed\(copied\.error\)/);
  assert.match(builder, /imageMessage\("copy_to_quote_failed"/);
  const helper = read("../../images/compress-custom-item-image.ts");
  assert.match(helper, /Vercel limits a request body to about 4\.5 MB/);
  assert.match(helper, /createImageBitmap/);
  assert.match(helper, /image\/webp/);
});

test("diff guard: earlier migration, policies, package files, pricing, saved_setups, selector and quote-images/product-images code are untouched", () => {
  assert.equal(read("../../../supabase/migrations/20261118100000_my_collection_images_2mb_webp.sql").includes("allowed_mime_types = array['image/webp']"), true);
  let diff: string[];
  try {
    const root = new URL("../../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  for (const forbidden of ["supabase/migrations/20261117150000_my_collection_images_bucket.sql", "package.json", "package-lock.json", "lib/quotation-image-path.ts", "lib/quotation-image-upload.ts", "lib/products/saved-setups/recipe.ts", "lib/products/saved-setups/saved-setups-service.ts", "lib/products/saved-setups/actions.ts", "components/products/product-library-selector.tsx", "app/quotations/actions.ts"]) {
    assert.ok(!diff.includes(forbidden), `${forbidden} must have an empty diff`);
  }
  assert.ok(!diff.some((file) => /^lib\/(quotations|pricing)\//.test(file)));
  assert.ok(diff.length <= 12, `at most 12 files change (${diff.length})`);
  void MAX_INPUT_BYTES;
});
