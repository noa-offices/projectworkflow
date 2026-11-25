import assert from "node:assert/strict";
import test from "node:test";
import { isFrameworkRedirect, isStagedImagePath, STAGED_IMAGE_MAX_BYTES, STAGED_IMAGE_PREFIX, uploadStagedImages, type StagedUploadCache } from "./staged-image-upload";

const img = (size = 1000, type = "image/webp") => ({ size, type });
let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, file: img() }));

test("images upload in order, at most 3 at a time, and the result holds paths only", async () => {
  let running = 0, peak = 0; const started: string[] = [];
  const cache: StagedUploadCache<ReturnType<typeof img>> = new Map();
  const list = entries(8);
  const result = await uploadStagedImages({ entries: list, cache, newId, upload: async (_file, path) => { started.push(path); running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; } });
  assert.ok(result.ok);
  assert.equal(peak, 3);
  assert.equal(result.paths.size, 8);
  assert.ok([...result.paths.values()].every(isStagedImagePath), "only small staged paths go to the server action");
  assert.equal(started.length, 8);
  assert.equal(JSON.stringify([...result.paths.values()]).includes("base64"), false);
});

test("a failure reports 'Image N of M', keeps what was uploaded, and a repeat save skips finished images", async () => {
  const cache: StagedUploadCache<ReturnType<typeof img>> = new Map();
  const list = entries(5); let calls = 0, failAt = 3;
  const upload = async () => { calls++; if (calls === failAt) throw new Error("network down"); };
  const first = await uploadStagedImages({ entries: list, cache, newId, upload, limit: 1 });
  assert.equal(first.ok, false);
  assert.match(!first.ok ? first.message : "", /Image 3 of 5 failed.*Nothing was lost.*Press Save again/);
  assert.equal(cache.size, 2, "images 1 and 2 stay uploaded");
  failAt = -1; calls = 0;
  const second = await uploadStagedImages({ entries: list, cache, newId, upload, limit: 1 });
  assert.ok(second.ok);
  assert.equal(calls, 3, "only the 3 unfinished images upload again; no duplicates");
});

test("a replaced file overwrites its own staged path; an oversize or empty image fails before upload", async () => {
  const cache: StagedUploadCache<ReturnType<typeof img>> = new Map(); const paths: string[] = [];
  const upload = async (_f: unknown, p: string) => { paths.push(p); };
  await uploadStagedImages({ entries: [{ key: "a", file: img() }], cache, newId, upload });
  await uploadStagedImages({ entries: [{ key: "a", file: img(2000) }], cache, newId, upload });
  assert.equal(paths[0], paths[1]);
  const big = await uploadStagedImages({ entries: [{ key: "b", file: img(STAGED_IMAGE_MAX_BYTES + 1) }], cache, newId, upload });
  assert.equal(big.ok, false);
  assert.equal((await uploadStagedImages({ entries: [{ key: "c", file: img(0) }], cache, newId, upload })).ok, false);
  assert.equal(paths.length, 2);
});

test("only well-formed staging paths are accepted by the server; Next redirects are not swallowed", () => {
  assert.equal(isStagedImagePath(`${STAGED_IMAGE_PREFIX}/${newId()}/${newId()}.webp`), true);
  for (const bad of ["product-template-row-references/t/workstation/g/r/x.webp", `${STAGED_IMAGE_PREFIX}/../x.webp`, `${STAGED_IMAGE_PREFIX}/${newId()}/${newId()}.exe`, "", null, 5]) assert.equal(isStagedImagePath(bad), false);
  assert.equal(isFrameworkRedirect({ digest: "NEXT_REDIRECT;replace;/x" }), true);
  assert.equal(isFrameworkRedirect(new Error("413")), false);
});
