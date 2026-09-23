import assert from "node:assert/strict";
import test from "node:test";
import {
  activityWeekStart,
  formatActivityDuration,
  formatActivityTimestamp,
  resolveActivityPeriod,
  shiftActivityDate,
} from "./activity-time-view.js";

test("activity periods use organization-calendar dates", () => {
  assert.equal(shiftActivityDate("2026-01-01", -1), "2025-12-31");
  assert.equal(activityWeekStart("2026-01-01"), "2025-12-29");
  assert.equal(resolveActivityPeriod("yesterday"), "yesterday");
  assert.equal(resolveActivityPeriod("unknown"), "today");
});

test("activity display formatting is bounded and explicitly time-zoned", () => {
  assert.equal(formatActivityDuration(272), "4h 32m");
  assert.equal(formatActivityDuration(-1), "0m");
  assert.equal(formatActivityTimestamp("2026-01-01T00:30:00.000Z", "America/New_York"), "7:30 PM");
});
