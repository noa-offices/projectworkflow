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
