import assert from "node:assert/strict";
import test from "node:test";
import { extractLikelyAiJsonPayload } from "./extract-ai-json-payload.js";

test("1: raw { \"version\": 1, ... } input remains unchanged", () => {
  const input = "{\"version\":1,\"template\":{\"templateName\":\"Chair\"}}";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.text, input);
  assert.equal(result.extracted, false);
  assert.equal(result.source, "original");
});

test("2: an explicit ```json fence extracts the fenced JSON", () => {
  const input = "Here is the extraction:\n```json\n{\"version\":1,\"template\":{\"templateName\":\"Chair\"}}\n```\nLet me know if you need anything else.";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "json_fence");
  assert.equal(result.text, "{\"version\":1,\"template\":{\"templateName\":\"Chair\"}}");
});

test("3: a ```python fence before a later valid JSON object is ignored", () => {
  const input = "```python\ndata = {'version': 1, 'note': 'not this one'}\n```\n\nActual output:\n{\"version\": 1, \"template\": {\"templateName\": \"Chair\"}}";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  assert.equal(result.text, "{\"version\": 1, \"template\": {\"templateName\": \"Chair\"}}");
});

test("4: prose + python + code output + later \"version\": 1 JSON extracts only the JSON object", () => {
  const input = [
    "Sure, here is how I built the draft:",
    "```python",
    "draft = {'version': 1, 'template': {'templateName': 'Chair'}}",
    "print(draft)",
    "```",
    "Code output",
    "{'version': 1, 'template': {'templateName': 'Chair'}}",
    "",
    "Here is the final ProductTemplateDraft JSON:",
    "{\"version\": 1, \"template\": {\"templateName\": \"Chair\"}, \"pricing\": {\"baseModelRows\": []}}",
  ].join("\n");
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  assert.equal(result.text, "{\"version\": 1, \"template\": {\"templateName\": \"Chair\"}, \"pricing\": {\"baseModelRows\": []}}");
  const parsed = JSON.parse(result.text) as { version: number };
  assert.equal(parsed.version, 1);
});

test("5: a Python dict using None/True is never converted", () => {
  const input = "```python\ndraft = {'version': 1, 'active': True, 'notes': None}\n```";
  const result = extractLikelyAiJsonPayload(input);
  // No ```json fence and no double-quoted "version": 1 property exists (the Python dict uses single quotes), so nothing is extracted.
  assert.equal(result.extracted, false);
  assert.equal(result.source, "original");
  assert.equal(result.text, input);
  assert.ok(!result.text.includes("null"), "None must never be converted to null");
  assert.ok(!/:\s*false\b/.test(result.text) && !/:\s*true\b/.test(result.text) || result.text.includes("True"), "True must never be converted to a JSON boolean");
});

test("6: earlier unrelated {...} text is ignored if it is not the \"version\": 1 ProductTemplateDraft object", () => {
  const input = "Config used: {mode: 'demo', retries: 3}\n\nFinal draft:\n{\"version\": 1, \"template\": {\"templateName\": \"Lamp\"}}";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  assert.equal(result.text, "{\"version\": 1, \"template\": {\"templateName\": \"Lamp\"}}");
});

test("7: balanced nested objects/arrays extract completely", () => {
  const input = "Result:\n{\"version\": 1, \"pricing\": {\"baseModelRows\": [{\"id\": \"a\", \"prices\": {\"x\": 1, \"y\": 2}}, {\"id\": \"b\"}]}, \"tags\": [\"x\", \"y\", {\"nested\": true}]}\nDone.";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  const parsed = JSON.parse(result.text) as { pricing: { baseModelRows: Array<{ id: string }> }; tags: unknown[] };
  assert.equal(parsed.pricing.baseModelRows.length, 2);
  assert.equal(parsed.tags.length, 3);
});

test("8: braces inside JSON strings do not terminate extraction", () => {
  const input = "Output:\n{\"version\": 1, \"template\": {\"specification\": \"Frame profile {A} with bracket {B}\"}}\nEnd.";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  const parsed = JSON.parse(result.text) as { template: { specification: string } };
  assert.equal(parsed.template.specification, "Frame profile {A} with bracket {B}");
});

test("9: escaped quotes inside strings do not terminate extraction", () => {
  const input = "Output:\n{\"version\": 1, \"template\": {\"description\": \"Model \\\"LOOP\\\" with 15\\\" arm\"}}\nEnd.";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  const parsed = JSON.parse(result.text) as { template: { description: string } };
  assert.equal(parsed.template.description, "Model \"LOOP\" with 15\" arm");
});

test("10: missing closing brace returns original input unchanged", () => {
  const input = "Here is the draft:\n{\"version\": 1, \"template\": {\"templateName\": \"Chair\"";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.text, input);
  assert.equal(result.extracted, false);
  assert.equal(result.source, "original");
});

test("11: no candidate returns original input unchanged", () => {
  const input = "I could not generate a ProductTemplateDraft for this page; please supply clearer source images.";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.text, input);
  assert.equal(result.extracted, false);
  assert.equal(result.source, "original");
});

test("12: a generic non-json code fence is not treated as a json fence", () => {
  const input = "```text\nsome notes, not json\n```\n{\"version\": 1, \"template\": {\"templateName\": \"Chair\"}}";
  const result = extractLikelyAiJsonPayload(input);
  assert.equal(result.extracted, true);
  assert.equal(result.source, "version_object");
  assert.equal(result.text, "{\"version\": 1, \"template\": {\"templateName\": \"Chair\"}}");
});
