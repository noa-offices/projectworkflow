import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { manualRefreshAction } from "./manual-refresh.js";

test("online on a saved read page: refresh quietly, no preview", () => {
  assert.equal(manualRefreshAction(true, "products:management", false), "refresh");
  assert.equal(manualRefreshAction(true, "brands:list", false), "refresh");
});

test("offline on a saved read page: the saved view opens", () => {
  assert.equal(manualRefreshAction(false, "products:management", false), "preview");
});

test("a preview that is already open stays a preview, online or offline", () => {
  assert.equal(manualRefreshAction(true, "products:management", true), "preview");
  assert.equal(manualRefreshAction(false, "products:management", true), "preview");
});

test("a page with no saved read view only probes the session, online or offline", () => {
  assert.equal(manualRefreshAction(true, undefined, false), "probe");
  assert.equal(manualRefreshAction(false, undefined, false), "probe");
});

test("the runtime uses this decision for the manual refresh and still previews only through it", () => {
  const source = readFileSync(new URL("../../components/local-read-cache/local-read-runtime.tsx", import.meta.url), "utf8");
  assert.match(source, /manualRefreshAction\(navigator\.onLine, entity, Boolean\(previewEntity\)\)/);
  assert.doesNotMatch(source, /if \(entity\) \{ void openPreview\(entity\); \} else \{ void probe\(true\); \}/);
});
