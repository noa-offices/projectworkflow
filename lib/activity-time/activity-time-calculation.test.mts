import assert from "node:assert/strict";
import test from "node:test";
import {
  activityDateInTimeZone,
  activityIntervalMilliseconds,
  summarizeActivityTime,
} from "./activity-time-calculation.js";

const now = "2026-01-01T12:00:00.000Z";

test("closed activity interval calculates its exact active minutes", () => {
  assert.equal(activityIntervalMilliseconds({ startedAt: "2026-01-01T09:00:00Z", lastActivityAt: "2026-01-01T09:05:00Z", endedAt: "2026-01-01T09:10:00Z" }, now, 15), 600_000);
});

test("open activity interval caps at the current time or idle boundary", () => {
  assert.equal(activityIntervalMilliseconds({ startedAt: "2026-01-01T11:45:00Z", lastActivityAt: "2026-01-01T11:55:00Z" }, now, 15), 900_000);
  assert.equal(activityIntervalMilliseconds({ startedAt: "2026-01-01T09:00:00Z", lastActivityAt: "2026-01-01T09:05:00Z" }, now, 15), 1_200_000);
});

test("activity summaries exclude idle gaps and merge overlaps without double counting", () => {
  const summary = summarizeActivityTime([
    { startedAt: "2026-01-01T09:00:00Z", lastActivityAt: "2026-01-01T09:10:00Z", endedAt: "2026-01-01T09:10:00Z" },
    { startedAt: "2026-01-01T10:00:00Z", lastActivityAt: "2026-01-01T10:05:00Z", endedAt: "2026-01-01T10:05:00Z" },
    { startedAt: "2026-01-01T10:03:00Z", lastActivityAt: "2026-01-01T10:08:00Z", endedAt: "2026-01-01T10:08:00Z" },
  ], now, 15);
  assert.equal(summary.activeMinutes, 18);
  assert.equal(summary.intervalCount, 3);
  assert.equal(summary.firstActivityAt, "2026-01-01T09:00:00.000Z");
  assert.equal(summary.latestActivityAt, "2026-01-01T10:08:00.000Z");
});

test("malformed activity intervals are ignored and configured IANA dates are respected", () => {
  assert.deepEqual(summarizeActivityTime([{ startedAt: "bad", lastActivityAt: "2026-01-01T10:00:00Z" }], now, 15), {
    activeMinutes: 0,
    firstActivityAt: null,
    intervalCount: 0,
    latestActivityAt: null,
  });
  assert.equal(activityDateInTimeZone("2026-01-01T00:30:00.000Z", "America/New_York"), "2025-12-31");
});
