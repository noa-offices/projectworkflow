import assert from "node:assert/strict";
import test from "node:test";
import { buildAttribution, inventoryAttributionLine, requestAttribution, requestPeopleLine } from "./attribution";

const people = new Map<string, string | null>([["w", "Subair"], ["m", "Junais KP"], ["hidden", null]]);

test("requested and approved by different people", () => {
  const line = inventoryAttributionLine(buildAttribution("m", { requester_id: "w", approver_id: "m" }, people));
  assert.equal(line, "Requested by Subair · Approved by Junais KP");
  assert.equal(inventoryAttributionLine(buildAttribution("m", { requester_id: "w", approver_id: "m" }, people), "Recorded"), line, "same wording for movements");
});

test("same person requested and approved shows once", () => {
  assert.equal(inventoryAttributionLine(buildAttribution("m", { requester_id: "m", approver_id: "m" }, people)), "Added by Junais KP");
  assert.equal(inventoryAttributionLine(buildAttribution("m", { requester_id: "m", approver_id: "m" }, people), "Recorded"), "Recorded by Junais KP");
});

test("no request keeps one line with the creator", () => {
  assert.equal(inventoryAttributionLine(buildAttribution("m", null, people)), "Added by Junais KP");
  assert.equal(inventoryAttributionLine(buildAttribution("m", undefined, people), "Recorded"), "Recorded by Junais KP");
  assert.equal(inventoryAttributionLine(undefined, "Recorded"), "Recorded by Team member");
});

test("missing names fall back to Team member and never show emails or ids", () => {
  assert.equal(inventoryAttributionLine(buildAttribution("hidden", { requester_id: "hidden", approver_id: "m" }, people)), "Requested by Team member · Approved by Junais KP");
  assert.equal(inventoryAttributionLine(buildAttribution("x", { requester_id: "x", approver_id: null }, people)), "Requested by Team member · Approved by Team member");
  assert.equal(inventoryAttributionLine(buildAttribution("hidden", null, people)), "Added by Team member");
  const email = inventoryAttributionLine({ creator_name: "a@b.com", request: { requester_id: "w", requester_name: "a@b.com", approver_id: "m", approver_name: "Unknown" } });
  assert.equal(email, "Requested by Team member · Approved by Team member");
});

test("request rows show requester and approver only once approved", () => {
  const base = { submitted_by: "w", submitter_display_name: "Subair", reviewed_by: "m", reviewer_display_name: "Junais KP" };
  assert.equal(requestAttribution({ ...base, request_status: "pending_review" }), null);
  assert.equal(requestPeopleLine({ ...base, request_status: "pending_review" }), "Subair");
  assert.equal(requestPeopleLine({ ...base, request_status: "rejected" }), "Subair");
  assert.equal(requestPeopleLine({ ...base, request_status: "approved", item_name: "Chair" }), "Requested by Subair · Approved by Junais KP");
  assert.equal(requestPeopleLine({ ...base, submitted_by: "m", submitter_display_name: "Junais KP", request_status: "approved", item_name: "Chair" }), "Added by Junais KP");
  assert.equal(requestPeopleLine({ ...base, submitted_by: "m", submitter_display_name: "Junais KP", request_status: "approved" }), "Recorded by Junais KP");
});
