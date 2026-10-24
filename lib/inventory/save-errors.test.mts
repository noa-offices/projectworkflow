import assert from "node:assert/strict";
import test from "node:test";
import { NETWORK_MESSAGE, saveFailureMessage } from "./save-errors";

test("a network failure gets its own plain message, and entries are kept", () => {
  assert.equal(saveFailureMessage(new TypeError("Failed to fetch")), NETWORK_MESSAGE);
  assert.equal(saveFailureMessage(new TypeError("Load failed")), NETWORK_MESSAGE);
  assert.match(NETWORK_MESSAGE, /No connection/); assert.match(NETWORK_MESSAGE, /entries are kept/);
});
test("other failures use the fallback", () => {
  assert.equal(saveFailureMessage(new Error("boom")), "Something went wrong. Please try again.");
  assert.equal(saveFailureMessage(new Error("boom"), "Could not save."), "Could not save.");
  assert.equal(saveFailureMessage(undefined), "Something went wrong. Please try again.");
});
