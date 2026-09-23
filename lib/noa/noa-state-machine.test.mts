import assert from "node:assert/strict";
import test from "node:test";
import { noaStateReducer } from "./noa-state-machine.js";

test("idle -> hover on HOVER_START", () => {
  assert.equal(noaStateReducer("idle", { type: "HOVER_START" }), "hover");
});

test("hover -> idle on HOVER_END", () => {
  assert.equal(noaStateReducer("hover", { type: "HOVER_END" }), "idle");
});

test("idle -> open on OPEN", () => {
  assert.equal(noaStateReducer("idle", { type: "OPEN" }), "open");
});

test("hover -> open on OPEN", () => {
  assert.equal(noaStateReducer("hover", { type: "OPEN" }), "open");
});

test("open -> idle on CLOSE only when settled (no pending request)", () => {
  assert.equal(noaStateReducer("open", { type: "CLOSE" }), "idle");
  assert.equal(noaStateReducer("thinking", { type: "CLOSE" }), "thinking");
  assert.equal(noaStateReducer("responding", { type: "CLOSE" }), "responding");
});

test("open -> thinking on SEND", () => {
  assert.equal(noaStateReducer("open", { type: "SEND" }), "thinking");
});

test("thinking -> success on RESPONSE_SUCCESS", () => {
  assert.equal(noaStateReducer("thinking", { type: "RESPONSE_SUCCESS" }), "success");
});

test("thinking -> error on RESPONSE_ERROR", () => {
  assert.equal(noaStateReducer("thinking", { type: "RESPONSE_ERROR" }), "error");
});

test("thinking -> responding on STREAM_START", () => {
  assert.equal(noaStateReducer("thinking", { type: "STREAM_START" }), "responding");
});

test("responding -> success on RESPONSE_SUCCESS", () => {
  assert.equal(noaStateReducer("responding", { type: "RESPONSE_SUCCESS" }), "success");
});

test("responding -> error on RESPONSE_ERROR", () => {
  assert.equal(noaStateReducer("responding", { type: "RESPONSE_ERROR" }), "error");
});

test("success -> open on SETTLE", () => {
  assert.equal(noaStateReducer("success", { type: "SETTLE" }), "open");
});

test("error -> open on SETTLE", () => {
  assert.equal(noaStateReducer("error", { type: "SETTLE" }), "open");
});

test("unrelated events are no-ops for a given state", () => {
  assert.equal(noaStateReducer("idle", { type: "SEND" }), "idle");
  assert.equal(noaStateReducer("open", { type: "HOVER_START" }), "open");
  assert.equal(noaStateReducer("success", { type: "SEND" }), "success");
});
