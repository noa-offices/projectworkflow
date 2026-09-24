import assert from "node:assert/strict";
import test from "node:test";
import { resolveNoaSemanticPeriod, resolveNoaSemanticSubject } from "./noa-subject-resolver.js";

// PART 5 extraction examples - subject/period portions ------------------------
// (domain/intent classification itself is the LLM extractor's job, not testable without a live
// provider call; these test the pure, deterministic refinement this module is responsible for.)

test("1. 'how much active time do I have today' -> self / today", () => {
  const message = "how much active time do I have today";
  assert.deepEqual(resolveNoaSemanticSubject(message), { type: "self" });
  assert.equal(resolveNoaSemanticPeriod(message), "today");
});

test("2. 'how much active time did Yahya have this week' -> named_user Yahya / this_week", () => {
  const message = "how much active time did Yahya have this week";
  assert.deepEqual(
    resolveNoaSemanticSubject(message, { type: "named_user", name: "Yahya" }),
    { type: "named_user", name: "Yahya" },
  );
  assert.equal(resolveNoaSemanticPeriod(message), "this_week");
});

test("3. 'what yahya did today' -> named_user Yahya / today", () => {
  const message = "what yahya did today";
  assert.deepEqual(
    resolveNoaSemanticSubject(message, { type: "named_user", name: "yahya" }),
    { type: "named_user", name: "yahya" },
  );
  assert.equal(resolveNoaSemanticPeriod(message), "today");
});

test("4. 'what did i do today' -> self / today", () => {
  const message = "what did i do today";
  assert.deepEqual(resolveNoaSemanticSubject(message), { type: "self" });
  assert.equal(resolveNoaSemanticPeriod(message), "today");
});

test("5. 'who online' -> team (no explicit period)", () => {
  const message = "who online";
  assert.deepEqual(resolveNoaSemanticSubject(message), { type: "team" });
  assert.equal(resolveNoaSemanticPeriod(message), undefined);
});

test("6. 'am i online' -> self", () => {
  assert.deepEqual(resolveNoaSemanticSubject("am i online"), { type: "self" });
});

// Critical precedence rules ------------------------------------------------------

test("explicit self is never replaced by a stray/hallucinated extracted name not present in the message", () => {
  // Extractor incorrectly proposes a named user that doesn't actually appear in the text -
  // the deterministic self-pronoun in the message must still win.
  const message = "how much active time do I have today";
  assert.deepEqual(
    resolveNoaSemanticSubject(message, { type: "named_user", name: "Sarah" }),
    { type: "self" },
  );
});

test("an explicit, message-verified named user is never silently collapsed into self", () => {
  // "I" appears, but the sentence is genuinely about Yahya.
  const message = "can I check how long Yahya was active today";
  assert.deepEqual(
    resolveNoaSemanticSubject(message, { type: "named_user", name: "Yahya" }),
    { type: "named_user", name: "Yahya" },
  );
});

test("team wording (team/everyone/users) resolves to team even without an extractor proposal", () => {
  assert.deepEqual(resolveNoaSemanticSubject("show team activity"), { type: "team" });
  assert.deepEqual(resolveNoaSemanticSubject("is everyone active"), { type: "team" });
  assert.deepEqual(resolveNoaSemanticSubject("how many users are active"), { type: "team" });
});

test("with no deterministic signal in the text, the extractor's proposal is trusted as-is", () => {
  assert.deepEqual(resolveNoaSemanticSubject("show recent activity", { type: "team" }), { type: "team" });
  assert.equal(resolveNoaSemanticSubject("show recent activity"), undefined);
});

// Period normalization ------------------------------------------------------------

test("period normalizer recognizes only the five supported values, and falls back to the extractor otherwise", () => {
  assert.equal(resolveNoaSemanticPeriod("show my activity yesterday"), "yesterday");
  assert.equal(resolveNoaSemanticPeriod("show this week's activity"), "this_week");
  assert.equal(resolveNoaSemanticPeriod("activity over the last 7 days"), "last_7_days");
  assert.equal(resolveNoaSemanticPeriod("this month's activity"), "this_month");
  assert.equal(resolveNoaSemanticPeriod("no period mentioned here"), undefined);
  assert.equal(resolveNoaSemanticPeriod("no period mentioned here", "this_month"), "this_month");
});
