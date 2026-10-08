import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { classifyTemporaryProductSources, temporaryProductSourcePath } from "./temporary-product-source.js";

const valid = "smart-source-qa/123e4567-e89b-42d3-a456-426614174000-source.pdf";

test("accepts only exact temporary source objects", () => {
  assert.equal(temporaryProductSourcePath(valid), valid);
  ["", "smart-source-qa/a.pdf", "https://example.com/a.pdf", "../smart-source-qa/a.pdf", "product-images/a.webp", "product-source-files/a.pdf", "smart-source-qa/", "smart-source-qa/a/b.pdf", "smart-source-qa/../a.pdf"].forEach((path) => assert.equal(temporaryProductSourcePath(path), null));
});

test("classifies referenced, grace-period, reclaimable, unknown-age and unrelated objects conservatively", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const referenced = valid;
  const recent = "smart-source-qa/223e4567-e89b-42d3-a456-426614174000-recent.pdf";
  const old = "smart-source-qa/323e4567-e89b-42d3-a456-426614174000-old.pdf";
  const unknown = "smart-source-qa/423e4567-e89b-42d3-a456-426614174000-unknown.pdf";
  const result = classifyTemporaryProductSources([
    { path: referenced, createdAt: "2026-09-01T00:00:00Z", bytes: 10 },
    { path: recent, createdAt: "2026-10-04T00:00:00Z", bytes: 20 },
    { path: old, createdAt: "2026-09-28T00:00:00Z", bytes: 30 },
    { path: unknown, createdAt: null, bytes: null },
    { path: "durable/source.pdf", createdAt: "2020-01-01T00:00:00Z", bytes: 40 },
  ], new Set([referenced]), now);
  assert.deepEqual(result.active.map((item) => item.path), [referenced]);
  assert.deepEqual(result.temporary.map((item) => item.path), [recent, unknown]);
  assert.deepEqual(result.reclaimable.map((item) => [item.path, item.ageDays]), [[old, 10]]);
  assert.equal(result.ignored.length, 1);
});

test("template save, replacement and explicit cancellation are wired to non-blocking temporary cleanup", async () => {
  const [actions, form, smart, panel] = await Promise.all([
    readFile(new URL("../../app/products/templates/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/products/product-template-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/products/smart-product-json-import.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/products/source-qa-panel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /cleanupTemporarySourceAfterSave/);
  assert.match(actions, /Product Template saved, but temporary Source QA PDF cleanup could not be completed/);
  const createAction = actions.slice(actions.indexOf("export async function createProductTemplate"), actions.indexOf("export async function updateProductTemplate"));
  const updateAction = actions.slice(actions.indexOf("export async function updateProductTemplate"), actions.indexOf("export async function updateProductTemplateForQuotationModal"));
  assert.ok(createAction.indexOf("cleanupTemporarySourceAfterSave") > createAction.indexOf("if (error || !template)"), "create cleanup runs only after the Product Template insert succeeds");
  assert.ok(updateAction.indexOf("cleanupTemporarySourceAfterSave") > updateAction.indexOf("if (!savedTemplate) return"), "update cleanup runs only after the Product Template update succeeds");
  assert.match(form, /formData\.set\("temporary_source_pdf_path"/);
  assert.match(form, /onCancelStart=\{cleanupTemporarySourceOnCancel\}/);
  assert.match(smart, /discardTemporarySource\(\)[\s\S]*clearReview\(\)/);
  assert.match(panel, /previousPath[\s\S]*deleteTemporaryProductSource\(previousPath\)/);
  assert.match(panel, /if \(uploadedPath\) void deleteTemporaryProductSource\(uploadedPath\)/);
});
