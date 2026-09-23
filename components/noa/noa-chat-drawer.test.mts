import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-chat-drawer.tsx / noa-assistant.tsx are "use client" modules with "@/..." aliases, which
// Node's plain ESM resolver can't resolve outside the Next.js build - same limitation documented
// for other "use client" files in this repo (see components/quotations/product-library-selector.test.mts
// for the established precedent). These are source-level layout/wiring checks, not runtime
// execution tests.
const drawerSource = readFileSync("components/noa/noa-chat-drawer.tsx", "utf8");
const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const launcherSource = readFileSync("components/noa/noa-launcher.tsx", "utf8");
const stateMachineSource = readFileSync("lib/noa/noa-state-machine.ts", "utf8");

test("closed state hides the panel completely (opacity-0, pointer-events-none)", () => {
  assert.match(drawerSource, /pointer-events-none translate-y-2 scale-95 opacity-0/);
});

test("open state shows the floating panel at full opacity/scale", () => {
  assert.match(drawerSource, /translate-y-0 scale-100 opacity-100/);
});

test("panel visibility is driven by aria-hidden={!isOpen}", () => {
  assert.match(drawerSource, /aria-hidden=\{!isOpen\}/);
});

test("desktop panel does not use a full-height inset-y drawer layout", () => {
  assert.ok(!/inset-y-0|sm:inset-y/.test(drawerSource), "must not use inset-y-based full-height positioning");
  assert.ok(!/translate-x-full/.test(drawerSource), "must not use the old slide-from-right drawer animation");
});

test("desktop panel is a fixed-size floating card positioned near the launcher, not full height", () => {
  assert.ok(drawerSource.includes("sm:bottom-[188px]"));
  assert.ok(drawerSource.includes("sm:right-6"));
  assert.ok(drawerSource.includes("sm:w-[400px]"));
  assert.ok(drawerSource.includes("sm:h-[600px]"));
  assert.ok(drawerSource.includes("sm:max-h-[calc(100vh_-_140px)]"));
});

test("mobile layout fits the viewport using inset positioning instead of a fixed card size", () => {
  assert.ok(drawerSource.includes("inset-x-3 top-16 bottom-20"));
});

test("open/close animation is a subtle opacity+translateY+scale transition within 150-220ms, not a slide drawer", () => {
  assert.match(drawerSource, /duration-200/);
  assert.match(drawerSource, /motion-reduce:transition-none/);
});

test("NoaLauncher is always rendered (not conditional on isOpen), so it stays visible while the panel is open", () => {
  const launcherRenderIndex = assistantSource.indexOf("<NoaLauncher");
  const drawerRenderIndex = assistantSource.indexOf("<NoaChatDrawer");
  assert.ok(launcherRenderIndex >= 0 && drawerRenderIndex >= 0);
  assert.ok(!/\{isOpen \? <NoaLauncher|isOpen && <NoaLauncher/.test(assistantSource));
});

test("NoaLauncher renders no panel wrapper of its own", () => {
  assert.ok(!/NoaChatDrawer|bg-white/.test(launcherSource));
});

test("state-machine transitions are unchanged by this layout-only refinement", () => {
  for (const transition of [
    '"HOVER_START"',
    '"HOVER_END"',
    '"OPEN"',
    '"CLOSE"',
    '"SEND"',
    '"STREAM_START"',
    '"RESPONSE_SUCCESS"',
    '"RESPONSE_ERROR"',
    '"SETTLE"',
  ]) {
    assert.ok(stateMachineSource.includes(transition), `expected ${transition} to still be handled`);
  }
});

test("session state shape and settle-delay constant are unchanged by this layout-only refinement", () => {
  // MOCK_RESPONSE_DELAY_MS was Phase 1A mock-only plumbing, intentionally removed once Phase 1B
  // wired a real backend request in its place (see lib/noa/noa-phase-1b-safety.test.mts) - this
  // test now guards the parts of noa-assistant.tsx that are still expected to be stable: the
  // settle delay and the plain in-memory session message state.
  assert.ok(assistantSource.includes("const SETTLE_DELAY_MS = 900;"));
  assert.ok(assistantSource.includes("const [messages, setMessages] = useState<NoaMessage[]>"));
});
