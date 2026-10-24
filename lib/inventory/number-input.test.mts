import assert from "node:assert/strict";
import test from "node:test";
import { cleanNumberText, numberValue } from "./number-input";

/** Types characters one at a time the way a field does: each keystroke is cleaned before the next. */
const type = (keys: string, options = {}) => [...keys].reduce((text, key) => cleanNumberText(text + key, options), "");

test("typing 10 shows 10, never 010, and 21 never 021", () => {
  assert.equal(type("10"), "10"); assert.equal(type("21"), "21");
  assert.equal(type("0"), "0"); // a single zero stays
  assert.equal(type("07"), "7"); assert.equal(type("007"), "7"); assert.equal(type("0010"), "10");
});
test("selecting the 0 and typing replaces it", () => assert.equal(cleanNumberText("5"), "5"));
test("pasted text is cleaned: 0012 becomes 12", () => {
  assert.equal(cleanNumberText("0012"), "12"); assert.equal(cleanNumberText(" 1,200 "), "1200"); assert.equal(cleanNumberText("00"), "0");
});
test("letters, signs and symbols are ignored in whole-number fields", () => {
  assert.equal(type("1a2b3"), "123"); assert.equal(cleanNumberText("-5"), "5"); assert.equal(cleanNumberText("1.5"), "15"); assert.equal(cleanNumberText("abc"), "");
});
test("empty is allowed while typing and counts as 0 when sent", () => {
  assert.equal(cleanNumberText(""), ""); assert.equal(numberValue(""), 0); assert.equal(numberValue(undefined), 0); assert.equal(numberValue(null), 0); assert.equal(numberValue("   "), 0);
});
test("decimals are only allowed in decimal (cost and size) fields", () => {
  const options = { decimals: true };
  assert.equal(type("12.5", options), "12.5"); assert.equal(type("012.50", options), "12.50"); assert.equal(type("0.5", options), "0.5"); assert.equal(type("00.5", options), "0.5");
  assert.equal(cleanNumberText(".5", options), "0.5"); assert.equal(cleanNumberText("12.", options), "12.0".slice(0, 3)); assert.equal(cleanNumberText("1.234", options), "1.23");
  assert.equal(cleanNumberText("1.2.3", options), "1.23"); assert.equal(cleanNumberText("12a.5", options), "12.5"); assert.equal(cleanNumberText("007", options), "7");
});
test("totals, previews and server data use the clean number", () => {
  assert.equal(numberValue("10"), 10); assert.equal(numberValue("12.50"), 12.5); assert.equal(numberValue(7), 7); assert.equal(numberValue("x"), 0);
  const stock = { warehouse: type("010"), dubai: type("21"), mockup: "" };
  assert.equal(Object.values(stock).reduce((sum, text) => sum + numberValue(text), 0), 31);
});
