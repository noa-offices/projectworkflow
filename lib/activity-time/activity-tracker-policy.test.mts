import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_TOUCH_THROTTLE_MS, shouldSendActivityTouch } from "./activity-tracker-policy.js";

test("first visible interaction sends immediately and repeated interaction is throttled", () => {
  assert.equal(shouldSendActivityTouch({ isVisible: true, lastSentAt: null, now: 1_000 }), true);
  assert.equal(shouldSendActivityTouch({ isVisible: true, lastSentAt: 1_000, now: 1_000 + ACTIVITY_TOUCH_THROTTLE_MS - 1 }), false);
  assert.equal(shouldSendActivityTouch({ isVisible: true, lastSentAt: 1_000, now: 1_000 + ACTIVITY_TOUCH_THROTTLE_MS }), true);
});

test("hidden documents never send activity touches", () => {
  assert.equal(shouldSendActivityTouch({ isVisible: false, lastSentAt: null, now: 1_000 }), false);
});
