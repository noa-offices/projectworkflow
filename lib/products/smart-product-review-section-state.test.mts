import assert from "node:assert/strict";
import test from "node:test";
import { reviewDestinationExpanded, setReviewDestinationExpanded } from "./smart-product-review-section-state.js";

test("review destinations collapse independently and skipped routes stay compact", () => {
  const expanded = setReviewDestinationExpanded({}, "option:coat-hanger", true);
  assert.equal(reviewDestinationExpanded("accessory", expanded, "option:coat-hanger"), true);
  assert.equal(reviewDestinationExpanded("accessory", expanded, "option:castors"), false);
  assert.equal(reviewDestinationExpanded("skip", {}, "option:coat-hanger"), false);
});
