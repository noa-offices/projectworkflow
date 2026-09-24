import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-assistant.tsx and app/layout.tsx both use "@/..." aliases (React/Next imports), so they
// can't be imported directly by node --test (same class of limitation as other "use client"
// modules in this repo - see components/quotations/product-library-selector.test.mts for the
// established precedent). These are source-level wiring checks using the same readFileSync
// technique, not runtime execution tests.

test("NoaAssistant returns null (renders no active UI) when auth is not provided", () => {
  const source = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  assert.match(source, /if \(!auth\) \{\s*return null;\s*\}/);
});

test("app/layout.tsx derives NOA auth via a non-redirecting Supabase lookup, not a require* helper", () => {
  const source = readFileSync("app/layout.tsx", "utf8");
  assert.ok(source.includes("async function currentNoaAuthContext"));
  assert.ok(source.includes("supabase.auth.getUser()"));
  assert.ok(!/require(Active|ProductLibraryManager|QuotationActionUser)\(\)/.test(source));
});

test("app/layout.tsx mounts NoaAssistant exactly once", () => {
  const source = readFileSync("app/layout.tsx", "utf8");
  const mountCount = source.match(/<NoaAssistant auth=/g)?.length ?? 0;
  assert.equal(mountCount, 1);
});

test("app/layout.tsx passes the auth lookup result into NoaAssistant", () => {
  const source = readFileSync("app/layout.tsx", "utf8");
  assert.match(source, /<NoaAssistant auth=\{noaAuth\}\s*\/>/);
});

test("no NOA component or lib file reads/writes localStorage or sessionStorage", () => {
  const files = [
    "components/noa/noa-assistant.tsx",
    "components/noa/noa-launcher.tsx",
    "components/noa/noa-avatar.tsx",
    "components/noa/noa-chat-drawer.tsx",
    "components/noa/noa-header.tsx",
    "components/noa/noa-messages.tsx",
    "components/noa/noa-status.tsx",
    "components/noa/noa-composer.tsx",
    "lib/noa/noa-types.ts",
    "lib/noa/noa-state-machine.ts",
    "lib/noa/use-noa-page-context.ts",
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/localStorage|sessionStorage/.test(source), `${file} must not use localStorage/sessionStorage`);
  }
});

test("NoaAssistant's session thread is plain React state (useState), not persisted storage", () => {
  const source = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  assert.match(source, /const \[messages, setMessages\] = useState<NoaMessage\[\]>/);
});

// ── Home UX: better introduction + working starter actions ─────────────────────────────────────

test("Home UX 7/8. Greeting is concise and mentions product configuration, without claiming AI/internal-architecture capabilities", () => {
  const source = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  const greetingMatch = source.match(/const GREETING_TEXT =\s*\n?\s*"([^;]+)";/);
  assert.ok(greetingMatch, "GREETING_TEXT constant not found");
  const greeting = greetingMatch![1];
  assert.ok(/configure/i.test(greeting), "greeting should mention configuring products");
  assert.ok(greeting.length < 260, "greeting should stay concise");
  for (const forbidden of [/\bAI\b/i, /\bagent(s)?\b/i, /\bdatabase\b/i, /\barchitecture\b/i, /system[- ]owner/i]) {
    assert.ok(!forbidden.test(greeting), `greeting must not mention ${forbidden}`);
  }
});

test("Home UX 5/6. Configure-product draft signal is intercepted before it ever becomes an outgoing request", () => {
  const source = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  assert.ok(source.includes("import { NOA_DRAFT_STARTER_SIGNAL_PREFIX } from \"@/components/noa/noa-messages\";"));
  assert.ok(source.includes("if (text.startsWith(NOA_DRAFT_STARTER_SIGNAL_PREFIX)) {"));
  assert.ok(source.includes("pendingConfigureDraftRef.current = text.slice(NOA_DRAFT_STARTER_SIGNAL_PREFIX.length);"));
  // The intercepted click never reaches requestNoaAnswer/dispatch SEND - it returns immediately.
  const handleSendStart = source.indexOf("const handleSend = useCallback((text: string) => {");
  const interceptEnd = source.indexOf("return;", handleSendStart);
  const interceptBlock = source.slice(handleSendStart, interceptEnd);
  assert.ok(!interceptBlock.includes("requestNoaAnswer") && !interceptBlock.includes('dispatch({ type: "SEND" })'));
});

test("Home UX 6. The next real message is prefixed with the pending draft, then the draft is cleared", () => {
  const source = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  assert.ok(source.includes("const outgoing = pendingConfigureDraftRef.current ? `${pendingConfigureDraftRef.current}${typed}` : typed;"));
  assert.ok(source.includes("pendingConfigureDraftRef.current = null;"));
  // The SAME outgoing text is what's shown in the user's own bubble and what's actually sent.
  assert.ok(source.includes('createMessage("user", outgoing)'));
  assert.ok(source.includes("requestNoaAnswer(outgoing, "));
});

test("Home UX 11. No router/capability/provider file is imported (only pre-existing prose comments may name them)", () => {
  const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");
  const messagesSource = readFileSync("components/noa/noa-messages.tsx", "utf8");
  const importLines = (source: string) => source.split("\n").filter((line) => line.trim().startsWith("import "));
  for (const source of [assistantSource, messagesSource]) {
    for (const line of importLines(source)) {
      assert.ok(!/noa-orchestrator|noa-.*-capability\.server|noa-provider/.test(line), `unexpected import: ${line}`);
    }
  }
  // classifyNoaIntent is the existing, unchanged client-side pre-classifier (already used before
  // this change) - not a new router wiring.
  assert.ok(assistantSource.includes('import { classifyNoaIntent } from "@/lib/noa/noa-intent-router";'));
});
