import assert from "node:assert/strict";
import test from "node:test";
import { repairJsonSyntax } from "./import-guardian-syntax-repair.js";

test("strict-valid JSON needs no repair at all", () => {
  const text = '{"a": 1, "b": [1, 2, 3], "c": "quote \\" inside"}';
  const result = repairJsonSyntax(text);
  assert.deepEqual(result.applied, []);
  assert.equal(result.text, text);
  assert.doesNotThrow(() => JSON.parse(result.text));
});

test("strips a ```json Markdown fence", () => {
  const text = '```json\n{"a": 1}\n```';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("markdown_fence"));
  assert.deepEqual(JSON.parse(result.text), { a: 1 });
});

test("strips a bare ``` fence without a json language tag", () => {
  const text = '```\n{"a": 1}\n```';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("markdown_fence"));
  assert.deepEqual(JSON.parse(result.text), { a: 1 });
});

test("strips a leading byte-order mark", () => {
  const text = "﻿" + '{"a": 1}';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("byte_order_mark"));
  assert.deepEqual(JSON.parse(result.text), { a: 1 });
});

test("fixes invalid \\_ Markdown-style escapes without touching real escapes", () => {
  const text = '{"group\\_id": "oxi\\_p", "note": "line one\\nline two"}';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("invalid_underscore_escape"));
  const parsed = JSON.parse(result.text) as { group_id: string; note: string };
  assert.equal(parsed.group_id, "oxi_p");
  assert.equal(parsed.note, "line one\nline two");
});

test("removes trailing commas before closing braces and brackets", () => {
  const text = '{"a": 1, "b": [1, 2, 3,],}';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("trailing_comma"));
  assert.deepEqual(JSON.parse(result.text), { a: 1, b: [1, 2, 3] });
});

test("does not remove a comma that is inside a string value", () => {
  const text = '{"specification": "Panel-base bench, with holes for cable tray."}';
  const result = repairJsonSyntax(text);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(JSON.parse(result.text), { specification: "Panel-base bench, with holes for cable tray." });
});

test("escapes an unescaped inner quote (the real OXI_P rawText case from the audit)", () => {
  const text = '{"rawText": "BENCH ... "OXI_P" ..."}';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("unescaped_quote"));
  const parsed = JSON.parse(result.text) as { rawText: string };
  assert.equal(parsed.rawText, 'BENCH ... "OXI_P" ...');
});

test("unescaped-quote repair does not corrupt an already-valid adjacent string", () => {
  const text = '{"a": "value one", "b": "value two"}';
  const result = repairJsonSyntax(text);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(JSON.parse(result.text), { a: "value one", b: "value two" });
});

test("combines multiple repairs in one pass (fence + underscore + trailing comma)", () => {
  const text = '```json\n{"group\\_id": "oxi\\_p", "items": [1, 2,],}\n```';
  const result = repairJsonSyntax(text);
  assert.ok(result.applied.includes("markdown_fence"));
  assert.ok(result.applied.includes("invalid_underscore_escape"));
  assert.ok(result.applied.includes("trailing_comma"));
  assert.deepEqual(JSON.parse(result.text), { group_id: "oxi_p", items: [1, 2] });
});

test("never invents or alters numeric/commercial values - only syntax changes", () => {
  const text = '{"price": 69, "currency": "EUR", "supplierCodes": ["111 058",],}';
  const result = repairJsonSyntax(text);
  const parsed = JSON.parse(result.text) as { price: number; currency: string; supplierCodes: string[] };
  assert.equal(parsed.price, 69, "Expected the unit price to survive syntax repair unchanged");
  assert.equal(parsed.currency, "EUR");
  assert.deepEqual(parsed.supplierCodes, ["111 058"]);
});

test("gives up cleanly on JSON that is not a repairable syntax defect", () => {
  const text = "this is not JSON at all";
  const result = repairJsonSyntax(text);
  assert.throws(() => JSON.parse(result.text));
});
