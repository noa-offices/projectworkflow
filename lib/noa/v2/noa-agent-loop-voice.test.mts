import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withNoaSpokenResponse } from "../noa-spoken-response";

const source = readFileSync("lib/noa/v2/noa-agent-loop.server.ts", "utf8").replace(/\r\n/g, "\n");

test("withNoaSpokenResponse is imported from the shared spoken-response module", () => {
  assert.ok(source.includes('import { withNoaSpokenResponse } from "@/lib/noa/noa-spoken-response";'));
});

test("both runNoaAgentLoop returns go through withNoaSpokenResponse, keeping engine, domain, text and sources", () => {
  assert.ok(source.includes('if (configuration) return withNoaSpokenResponse({ ...configuration, engine: "v2" });'), "the stored guided-flow answer");
  assert.ok(source.includes('return withNoaSpokenResponse({ domain: "Help", engine: "v2", sources, text: result.text });'), "the normal answer");
  assert.equal((source.match(/withNoaSpokenResponse\(/g) ?? []).length, 2, "exactly the two returns, nothing else");
});

test("a v2 answer gains only voiceText; text, sources, engine and domain are untouched", () => {
  const answer = { domain: "Help" as const, engine: "v2" as const, sources: [{ label: "Fake", type: "product" as const }], text: "I found 3 chair templates." };
  const spoken = withNoaSpokenResponse(answer);
  const { voiceText, ...rest } = spoken;
  assert.deepEqual(rest, answer);
  assert.equal(typeof voiceText, "string");
});

test("an empty spoken result stays an empty string and does not crash", () => {
  const spoken = withNoaSpokenResponse({ domain: "Help", engine: "v2", sources: [], text: "" });
  assert.equal(spoken.voiceText, "");
  assert.equal(spoken.text, "");
  assert.equal(spoken.engine, "v2");
});
