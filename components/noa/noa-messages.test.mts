// GPC-4.2: the message bubble must preserve server-sent line breaks (GPC-4.1's `\n\n`-separated
// summary blocks) instead of collapsing them into one paragraph. No React test renderer is wired
// up in this repo yet, so - matching this codebase's existing convention for files it's cheaper to
// verify by source inspection (see lib/noa/noa-phase-gpc33-safety.test.mts /
// noa-phase-gpc4-safety.test.mts) - this is a deterministic source-inspection test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("components/noa/noa-messages.tsx", "utf8");

test("1. The message text container declares whitespace-preserving behavior", () => {
  assert.ok(source.includes("whitespace-pre-wrap"));
  // On the SAME <p> that renders message.text, not some unrelated element.
  const openTagStart = source.indexOf("<p");
  const openTagEnd = source.indexOf("{message.text}", openTagStart);
  const paragraphOpenTag = source.slice(openTagStart, openTagEnd);
  assert.ok(paragraphOpenTag.includes("whitespace-pre-wrap"));
});

test("2. No dangerouslySetInnerHTML is used to render message text", () => {
  assert.ok(!source.includes("dangerouslySetInnerHTML"));
});

test("3. No manual newline-to-HTML conversion (no <br> injection, no string replace on message.text)", () => {
  assert.ok(!source.includes("<br"));
  assert.ok(!/message\.text\.replace/.test(source));
  assert.ok(!/message\.text\.split/.test(source));
  // message.text is rendered as-is, as plain React text content.
  assert.ok(source.includes("{message.text}"));
});

test("4. Choice-button rendering is unchanged", () => {
  assert.ok(source.includes("message.choices.map((choice, index) =>"));
  assert.ok(source.includes("onClick={() => onQuickPrompt(choice.value)}"));
  assert.ok(source.includes("disabled={!choicesEnabled}"));
});

test("5. Source badge rendering is unchanged", () => {
  assert.ok(source.includes('message.role === "assistant" ? ('));
  assert.ok(source.includes("<NoaSourceBadges domain={message.domain} sources={message.sources} />"));
});

test("6. No new message component/rendering path was introduced - still one shared <p> for both roles", () => {
  assert.equal((source.match(/<p\b/g) ?? []).length, 1);
  assert.ok(!source.includes("react-markdown"));
});

// ── Home UX: working starter actions ────────────────────────────────────────────────────────────

test("Home UX 1. Old vague starter strings are gone", () => {
  for (const stale of ["Find a product", "Check quotation", "Price status", "How do I..."]) {
    assert.ok(!source.includes(stale), `stale starter "${stale}" must be removed`);
  }
});

test("Home UX 3/4/7. Proven-request starters send their proven outgoing text, not their short label", () => {
  assert.ok(source.includes('{ label: "Pending quotations", prompt: "Show pending quotations" }'));
  assert.ok(source.includes('{ label: "Active projects", prompt: "Show active projects" }'));
});

test("N2A3. Needs attention starter sends the exact proven Attention phrase", () => {
  assert.ok(source.includes('{ label: "Needs attention", prompt: "what needs my attention" }'));
});

test("Home UX 5/6. Configure-product starter never sends the bare label - it's encoded as a local draft signal", () => {
  assert.ok(source.includes('{ draft: "configure ", label: "Configure product" }'));
  assert.ok(!/onQuickPrompt\(\s*["'`]Configure product["'`]/.test(source));
  assert.ok(source.includes("NOA_DRAFT_STARTER_SIGNAL_PREFIX"));
});

test("Home UX 8. At most 4 primary starters", () => {
  const arrayBody = source.slice(source.indexOf("const QUICK_PROMPTS"), source.indexOf("];", source.indexOf("const QUICK_PROMPTS")));
  const starterCount = (arrayBody.match(/\{ (draft|label):/g) ?? []).length;
  assert.equal(starterCount, 4);
});

test("Home UX 9. GPC choice buttons remain a completely separate rendering path from starter buttons", () => {
  assert.ok(source.includes("message.choices?.length"));
  assert.ok(source.includes("!hasUserMessage"));
  // Two distinct button groups - choices are never filtered/merged into QUICK_PROMPTS.
  assert.ok(!source.includes("QUICK_PROMPTS.concat") && !source.includes("...QUICK_PROMPTS"));
});

test("Home UX 10. Starter buttons still disappear after the first user message", () => {
  assert.ok(source.includes("const hasUserMessage = messages.some((message) => message.role"));
  assert.ok(source.includes("{!hasUserMessage ? ("));
});
