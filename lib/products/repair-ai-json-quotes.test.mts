import assert from "node:assert/strict";
import test from "node:test";
import { repairLikelyUnescapedJsonQuotes } from "./repair-ai-json-quotes.js";

test("1: valid JSON remains byte-for-byte unchanged", () => {
  const input = "{\"name\":\"Chair\",\"price\":100}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
});

test("2: embedded inch marks are repaired into valid JSON preserving the readable value", () => {
  const input = "{\"specification\": \"Suitable for 15\" to 24\" screens.\"}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.repaired, true);
  assert.equal(result.repairCount, 2);
  const parsed = JSON.parse(result.text) as { specification: string };
  assert.equal(parsed.specification, "Suitable for 15\" to 24\" screens.");
});

test("3: a quoted commercial name becomes valid serialized JSON and parses back to the exact original value", () => {
  const input = "{\"label\": \"PORTA-ABITO \"LOOP\"\", \"note\": \"ok\"}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.repaired, true);
  assert.equal(result.repairCount, 2);
  const parsed = JSON.parse(result.text) as { label: string; note: string };
  assert.equal(parsed.label, "PORTA-ABITO \"LOOP\"");
  assert.equal(parsed.note, "ok");
});

test("4: multiple repairs in one document (inch marks + quoted product name) are both repaired correctly", () => {
  const input = "{\"specification\": \"Suitable for 15\" to 24\" screens.\", \"label\": \"PORTA-ABITO \"LOOP\"\"}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.repaired, true);
  assert.equal(result.repairCount, 4);
  const parsed = JSON.parse(result.text) as { specification: string; label: string };
  assert.equal(parsed.specification, "Suitable for 15\" to 24\" screens.");
  assert.equal(parsed.label, "PORTA-ABITO \"LOOP\"");
});

test("5: already-escaped quotes are not double escaped", () => {
  const input = "{\"label\": \"PORTA-ABITO \\\"LOOP\\\"\"}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
  const parsed = JSON.parse(result.text) as { label: string };
  assert.equal(parsed.label, "PORTA-ABITO \"LOOP\"");
});

test("6: normal object-property closing quotes remain untouched", () => {
  const input = "{\"name\":\"Chair\",\"model\":\"X1\",\"nested\":{\"a\":\"b\"}}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
});

test("7: normal array string closing quotes remain untouched", () => {
  const input = "{\"tags\":[\"a\",\"b\",\"c\"],\"codes\":[\"X1\",\"X2\"]}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
});

test("8: apostrophes remain untouched", () => {
  const input = "{\"specification\":\"Client's choice, manufacturer's finish\"}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
});

test("9: unicode smart quotes remain untouched", () => {
  const input = "{\"specification\":\"“Premium” collection ‘Edition’\"}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
});

test("10: malformed trailing-comma JSON is not repaired into validity", () => {
  const input = "{\"name\":\"Chair\",}";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
  assert.throws(() => JSON.parse(result.text));
});

test("11: missing-closing-brace JSON is not repaired into validity", () => {
  const input = "{\"name\":\"Chair\"";
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
  assert.throws(() => JSON.parse(result.text));
});

test("12: more than 100 candidate quote repairs returns the original input unchanged", () => {
  const input = `{"note":"${"\"".repeat(101)}"}`;
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.text, input);
  assert.equal(result.repaired, false);
  assert.equal(result.repairCount, 0);
});

test("13: a realistic nested ProductTemplateDraft-like object with inch marks and a quoted model name is repaired and accepted by JSON.parse", () => {
  const input = [
    "{",
    "\"template\":{\"templateName\":\"Screens\",\"description\":\"Adjustable range\"},",
    "\"pricing\":{\"baseModelRows\":[",
    "{\"id\":\"row-1\",\"label\":\"Monitor Screen\",\"specification\":\"Fits 15\" to 24\" monitors.\",\"price\":100},",
    "{\"id\":\"row-2\",\"label\":\"PORTA-ABITO \"LOOP\"\",\"specification\":\"Wall mounted\",\"price\":50}",
    "]},",
    "\"optionGroups\":[]",
    "}",
  ].join("");
  const result = repairLikelyUnescapedJsonQuotes(input);
  assert.equal(result.repaired, true);
  assert.ok(result.repairCount > 0);
  const parsed = JSON.parse(result.text) as {
    pricing: { baseModelRows: Array<{ specification: string; label: string }> };
  };
  assert.equal(parsed.pricing.baseModelRows[0].specification, "Fits 15\" to 24\" monitors.");
  assert.equal(parsed.pricing.baseModelRows[1].label, "PORTA-ABITO \"LOOP\"");
});
