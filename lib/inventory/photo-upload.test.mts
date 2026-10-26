import assert from "node:assert/strict";
import test, { mock } from "node:test";

const ownerId = "123e4567-e89b-42d3-a456-426614174000";
let uploads: { path: string; blob: Blob; options: unknown }[] = [];
let dimensions: number[][] = [];
let qualities: number[] = [];
let closed = 0;
let fills: string[] = [];
let outputType: string | null = null;
let auth = true;
let failUploadAt = -1;
let outputSize: (quality: number) => number = () => 400;
const client = {
  auth: { getUser: async () => ({ data: { user: auth ? { id: "signed-in" } : null }, error: null }) },
  storage: { from: (bucket: string) => {
    assert.equal(bucket, "inventory-images");
    return { upload: async (path: string, blob: Blob, options: unknown) => {
      uploads.push({ path, blob, options });
      return { error: uploads.length - 1 === failUploadAt ? new Error("private storage detail") : null };
    } };
  } },
};
mock.module("@/lib/supabase/client", { namedExports: { createClient: () => client } });
const { uploadInventoryPhotos } = await import("./photo-upload");

function reset() {
  uploads = []; dimensions = []; qualities = []; fills = []; closed = 0; auth = true; failUploadAt = -1;
  outputType=null;outputSize = () => 400;
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: "", fillRect() { fills.push(this.fillStyle); }, drawImage: () => dimensions.push([canvas.width, canvas.height]) }),
        toBlob: (callback: (blob: Blob) => void, type: string, quality: number) => {
          qualities.push(quality);
          callback(new Blob([new Uint8Array(outputSize(quality))], { type:outputType ?? type }));
        },
      };
      return canvas;
    },
  } });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async (_file:File,options:ImageBitmapOptions) => {assert.equal(options.imageOrientation,"from-image");return { width: 4000, height: 2000, close: () => closed++ };} });
}
const image = () => new File(["photo"], "../../original.png", { type: "image/png" });

test("resizes before uploading WebP to random owner-scoped paths with exact metadata", async () => {
  reset();
  const result = await uploadInventoryPhotos({ ownerType: "product", ownerId, files: [image()] });
  assert.deepEqual(dimensions, [[2000, 1000]]);
  assert.deepEqual(fills, []);
  assert.equal(closed, 1);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.errors, []);
  assert.match(result.files[0].path, /^products\/123e4567-e89b-42d3-a456-426614174000\/[0-9a-f-]{36}\.webp$/);
  assert.deepEqual(result.files[0], { path: uploads[0].path, contentType: "image/webp", sizeBytes: 400 });
  assert.deepEqual(uploads[0].options, { contentType: "image/webp", upsert: false });
});

test("canonicalizes uppercase owner IDs and does not enlarge small portrait photos", async () => {
  reset();
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: async () => ({ width: 200, height: 400, close: () => closed++ }) });
  const result = await uploadInventoryPhotos({ ownerType: "request", ownerId: ownerId.toUpperCase(), files: [image()] });
  assert.deepEqual(dimensions, [[200, 400]]);
  assert.ok(result.files[0].path.startsWith(`requests/${ownerId}/`));
});

test("Image fallback releases object URLs on success and invalid image failure", async () => {
  reset();
  Object.defineProperty(globalThis, "createImageBitmap", { value: undefined, configurable: true });
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let badImage = false;
  URL.createObjectURL = () => "blob:fixture";
  URL.revokeObjectURL = url => { revoked.push(url); };
  Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    naturalWidth = 1000; naturalHeight = 4000;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { if (badImage) this.onerror?.(); else this.onload?.(); }
  } });
  try {
    assert.equal((await uploadInventoryPhotos({ ownerType: "product", ownerId, files: [image()] })).failedCount, 0);
    assert.deepEqual(dimensions, [[500, 2000]]);
    badImage = true;
    assert.equal((await uploadInventoryPhotos({ ownerType: "product", ownerId, files: [image()] })).failedCount, 1);
    assert.deepEqual(revoked, ["blob:fixture", "blob:fixture"]);
    assert.equal(uploads.length, 1);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("rejects invalid owner IDs, owner types and batches over three without storage calls", async () => {
  reset();
  for (const input of [
    { ownerType: "product", ownerId: "../escape", files: [image()] },
    { ownerType: "other", ownerId, files: [image()] },
    { ownerType: "request", ownerId, files: [image(), image(), image(), image()] },
  ]) {
    const result = await uploadInventoryPhotos(input as Parameters<typeof uploadInventoryPhotos>[0]);
    assert.equal(result.failedCount, input.files.length);
    assert.ok(result.errors.length);
    assert.deepEqual(result.files, []);
  }
  assert.deepEqual(uploads, []);
  assert.deepEqual(await uploadInventoryPhotos({ ownerType: "request", ownerId, files: [] }), { files: [], failedCount: 0, errors: [] });
});

test("rejects non-images and preserves uploads around individual storage failures", async () => {
  reset(); failUploadAt = 0;
  const result = await uploadInventoryPhotos({ ownerType: "request", ownerId, files: [new File(["x"], "file.txt", { type: "text/plain" }), image(), image()] });
  assert.equal(result.failedCount, 2);
  assert.equal(result.errors.length, 2);
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].path, /^requests\//);
  assert.equal(uploads.length, 2);
  assert.ok(result.errors.every(error => !error.includes("private storage detail")));
});

test("lowers WebP quality until under 2 MiB and reports images that remain too large", async () => {
  reset(); outputSize = quality => quality > 0.7 ? 5 * 1024 * 1024 : 300;
  const result = await uploadInventoryPhotos({ ownerType: "request", ownerId, files: [image()] });
  assert.equal(result.files[0].sizeBytes, 300);
  assert.ok(qualities.length > 1);
  assert.ok(qualities.every((quality, index) => index === 0 || quality < qualities[index - 1]));
  reset(); outputSize = () => 5 * 1024 * 1024;
  const failure = await uploadInventoryPhotos({ ownerType: "product", ownerId, files: [image()] });
  assert.equal(failure.failedCount, 1);
  assert.equal(uploads.length, 0);
  assert.equal(closed, 1);
});

test("requires a browser and authenticated user before any upload", async () => {
  reset(); auth = false;
  assert.equal((await uploadInventoryPhotos({ ownerType: "product", ownerId, files: [image()] })).failedCount, 1);
  assert.equal(uploads.length, 0);
  Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });
  await assert.rejects(uploadInventoryPhotos({ ownerType: "product", ownerId, files: [image()] }), /browser/i);
});

test('selection-prepared Files upload without another encode or rotation pass',async()=>{
 reset();const {compressInventoryPhoto}=await import('./photo-compress');
 const ready=await compressInventoryPhoto(image());const encodes=qualities.length;
 const result=await uploadInventoryPhotos({ownerType:'product',ownerId,files:[ready.file]});
 assert.equal(result.failedCount,0);assert.equal(qualities.length,encodes);assert.equal(closed,1);
 assert.equal(uploads[0].blob,ready.file);
});
test('JPEG fallback flattens transparency and keeps JPEG upload metadata',async()=>{
 reset();outputType='image/jpeg';
 const result=await uploadInventoryPhotos({ownerType:'request',ownerId,files:[image()]});
 assert.equal(result.failedCount,0);assert.equal(result.files[0].contentType,'image/jpeg');
 assert.match(result.files[0].path,/\.jpg$/);assert.deepEqual(fills,['#ffffff']);
});
test('undecodable and invalid-dimension photos never reach Storage and release decoded resources',async()=>{
 reset();Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({width:0,height:100,close:()=>closed++})});
 assert.equal((await uploadInventoryPhotos({ownerType:'request',ownerId,files:[image()]})).failedCount,1);
 assert.equal(uploads.length,0);assert.equal(closed,1);
});
