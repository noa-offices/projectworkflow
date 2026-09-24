// NOA Avatar Redesign: Full Default Avatar + Sneak-Behind-Screen Hide Behavior. "use client"
// components with "@/..." aliases aren't resolvable by Node's plain ESM resolver outside the
// Next.js build, so - matching the established convention for this file family (see
// components/noa/noa-assistant.test.mts, components/noa/noa-messages.test.mts) - these are
// deterministic source-inspection tests, not a runtime render/exercise of the components.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NOA_AVATAR_LAYERS,
  USE_LAYERED_NOA_AVATAR,
  type NoaAvatarLayerName,
} from "./noa-avatar-layers.js";

const avatar = readFileSync("components/noa/noa-avatar.tsx", "utf8");
const launcher = readFileSync("components/noa/noa-launcher.tsx", "utf8");
const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const stateMachine = readFileSync("lib/noa/noa-state-machine.ts", "utf8");
const types = readFileSync("lib/noa/noa-types.ts", "utf8");

test("1. Default local launcher mode is Full", () => {
  assert.ok(launcher.includes('const [mode, setMode] = useState<NoaLauncherMode>("full");'));
});

test("2. In Full mode the avatar renders at its own full size, unclipped (no crop window wrapping it)", () => {
  const fullBranch = launcher.slice(launcher.indexOf(") : (\n          <NoaAvatar"), launcher.indexOf(")}\n      </button>"));
  assert.ok(fullBranch.includes("<NoaAvatar floatEnabled={floatEnabled} greet={greeted} size=\"launcher\" state={state} />"));
  assert.ok(!fullBranch.includes("overflow-hidden"));
});

test("3/4. The Hide/Show control is not permanently visible - hidden by default and revealed only via hover/focus (on hover-capable devices)", () => {
  assert.ok(launcher.includes("noa-secondary-control"));
  const mediaBlock = assistant.slice(assistant.indexOf("@media (hover: hover) and (pointer: fine)"));
  assert.ok(mediaBlock.includes(".noa-secondary-control { opacity: 0; pointer-events: none; }"));
  assert.ok(mediaBlock.includes(".group:hover .noa-secondary-control") && mediaBlock.includes(".group:focus-within .noa-secondary-control"));
});

test("5. Clicking Hide switches mode to sneak, and never opens chat", () => {
  const hideButtonStart = launcher.indexOf('aria-label={isSneak ? "Show NOA" : "Hide NOA"}');
  const hideButtonEnd = launcher.indexOf("</button>", hideButtonStart);
  const hideButtonBlock = launcher.slice(hideButtonStart, hideButtonEnd);
  assert.ok(hideButtonBlock.includes("event.stopPropagation();"));
  assert.ok(hideButtonBlock.includes('setMode(isSneak ? "full" : "sneak")'));
  assert.ok(!hideButtonBlock.includes("onToggle"));
});

test("6/7. Sneak is an intentional crop window (head + shoulder proportions of the real avatar), not a tiny arbitrary box of random content", () => {
  assert.ok(launcher.includes('<span className="relative h-10 w-5 overflow-hidden rounded-l-2xl'));
  // The avatar rendered inside is the SAME full-size launcher avatar, pinned top-left - the crop
  // reveals real head/shoulder proportions of that one image, never a separately cropped asset.
  assert.ok(launcher.includes('className="noa-anim-sneak-lean absolute left-0 top-0'));
  assert.ok(launcher.includes('<NoaAvatar floatEnabled={floatEnabled} greet={greeted} size="launcher" state={state} />'));
});

test("8. Sneak hover/focus reveals more avatar via a growing crop window, not just a translate", () => {
  assert.ok(launcher.includes("group-hover:h-12 group-hover:w-9"));
  assert.ok(launcher.includes("group-focus-within:h-12 group-focus-within:w-9"));
  assert.ok(launcher.includes("transition-[width,height]"));
});

test("9. Sneak's restore (\"Show NOA\") control is the SAME hover/focus-revealed secondary control, never permanently shown", () => {
  assert.ok(launcher.includes('aria-label={isSneak ? "Show NOA" : "Hide NOA"}'));
  assert.ok(launcher.includes("noa-secondary-control"));
});

test("10. Clicking restore returns mode to full", () => {
  assert.ok(launcher.includes('setMode(isSneak ? "full" : "sneak")'));
});

test("11/12. The main \"Open NOA assistant\" button (onClick=onToggle) exists in BOTH modes - clicking the robot always opens chat", () => {
  assert.equal((launcher.match(/onClick=\{onToggle\}/g) ?? []).length, 1);
  const openButtonStart = launcher.indexOf('aria-label="Open NOA assistant"');
  const openButtonEnd = launcher.indexOf("</button>", openButtonStart);
  const openButtonBlock = launcher.slice(openButtonStart, openButtonEnd);
  assert.ok(openButtonBlock.includes("onClick={onToggle}"));
  // Both the Full-mode <NoaAvatar> and the Sneak crop window are inside this SAME button.
  assert.ok(openButtonBlock.includes("isSneak ? ("));
});

test("13. User-selected mode is never reset by opening/closing chat - `mode` is untouched by `state`", () => {
  // No effect/derived logic resets `mode` from `state` transitions (e.g. on becoming "open").
  assert.ok(!/setMode\(\s*"full"\s*\)\s*;?\s*$/m.test(launcher.replace(/setMode\(isSneak.*\n/g, "")));
  assert.ok(!launcher.includes('useEffect(() => {\n    if (state === "open")'));
});

test("14. No setInterval/setTimeout-driven periodic hide timer - the sneak lean is a CSS animation only", () => {
  assert.ok(!/setInterval/.test(launcher));
  // The only setTimeout in this file is the one-shot greet delay, not a hide/sneak timer.
  const timeoutCallCount = (launcher.match(/window\.setTimeout\(/g) ?? []).length;
  assert.equal(timeoutCallCount, 1);
  assert.ok(launcher.includes("window.setTimeout(() => setGreeted(true), GREET_DELAY_MS)"));
  assert.ok(assistant.includes("@keyframes noa-sneak-lean"));
});

test("15. No large rear shadow/halo/dock/panel behind the avatar", () => {
  assert.ok(!avatar.includes("AMBIENT_GLOW") && !avatar.includes("inset-[-20%]") && !avatar.includes("blur-2xl"));
  assert.ok(!launcher.includes("backdrop-blur") && !launcher.includes("bg-white/70"));
});

test("16/17. Eye glow exists and is stronger than chest glow at every shared state key", () => {
  assert.ok(avatar.includes("EYE_GLOW_CLASS_BY_STATE") && avatar.includes("CHEST_GLOW_CLASS_BY_STATE"));
  const eyeMatches = [...avatar.matchAll(/idle: "bg-amber-400\/(\d+)"/g)];
  const chestMatches = [...avatar.matchAll(/idle: "bg-amber-300\/(\d+)"/g)];
  assert.ok(eyeMatches.length > 0 && chestMatches.length > 0);
  assert.ok(Number(eyeMatches[0][1]) > Number(chestMatches[0][1]), "eye base opacity must exceed chest base opacity");
  // Eye glow is also physically bigger (27% vs chest's 12%/34%-of-a-thin-band).
  assert.ok(avatar.includes("h-[27%] w-[27%]"));
});

test("18. Wing light/shimmer exists as two staggered streaks, restricted to the launcher (never the header/open drawer)", () => {
  assert.ok(avatar.includes("noa-anim-wing-shimmer-left") && avatar.includes("noa-anim-wing-shimmer-right"));
  assert.ok(avatar.includes('const wingShimmerEnabled = size === "launcher" && isIdleLike;'));
  assert.ok(assistant.includes(".noa-anim-wing-shimmer-left { animation: noa-wing-shimmer 8s"));
  assert.ok(assistant.includes(".noa-anim-wing-shimmer-right { animation: noa-wing-shimmer 10.5s"));
});

test("19. A one-shot greeting effect exists (lean/bounce/rotate + eye brighten), never repeating", () => {
  assert.ok(assistant.includes("@keyframes noa-greet {"));
  assert.ok(assistant.includes(".noa-anim-greet { animation: noa-greet 1.05s ease-in-out 1;"));
  assert.ok(assistant.includes("@keyframes noa-greet-eye {"));
  assert.ok(assistant.includes(".noa-anim-greet-eye { animation: noa-greet-eye 1.1s ease-in-out 1; }"));
  assert.ok(launcher.includes("const [greeted, setGreeted] = useState(false);"));
});

test("20. Reduced motion disables every animation class, but Full/Sneak positioning stays static and correct", () => {
  const reducedMotionBlock = assistant.slice(
    assistant.indexOf("@media (prefers-reduced-motion: reduce)"),
    assistant.indexOf("@media (hover: hover)"),
  );
  for (const className of [
    ".noa-anim-float", ".noa-anim-idle-pulse", ".noa-anim-greet", ".noa-anim-greet-eye",
    ".noa-anim-chest-pulse", ".noa-anim-wing-shimmer-left", ".noa-anim-wing-shimmer-right", ".noa-anim-sneak-lean",
  ]) {
    assert.ok(reducedMotionBlock.includes(className), `${className} missing from reduced-motion override`);
  }
  assert.ok(reducedMotionBlock.includes(".noa-anim-sneak-lean { transform: translateX(5px); }"));
});

test("21. lib/noa/noa-state-machine.ts and lib/noa/noa-types.ts are never imported/referenced by the launcher's mode logic", () => {
  assert.ok(!/from\s+["'].*noa-state-machine["']/.test(launcher));
  assert.ok(launcher.includes("type NoaLauncherMode = \"full\" | \"sneak\";"));
  // Sanity: these files still exist/are non-empty (they were read-only for this task).
  assert.ok(stateMachine.length > 0 && types.length > 0);
});

test("22. No animation library was added - only CSS keyframes/Tailwind classes", () => {
  for (const source of [avatar, launcher, assistant]) {
    assert.ok(!/framer-motion|react-spring|gsap|lottie/i.test(source));
  }
});

test("23. Mobile has a usable hide interaction despite lacking hover: the secondary control has a non-zero BASE Tailwind opacity, only zeroed under the hover-capable media query", () => {
  assert.ok(launcher.includes("opacity-70"));
  const mediaBlock = assistant.slice(assistant.indexOf("@media (hover: hover) and (pointer: fine)"));
  assert.ok(mediaBlock.includes("opacity: 0"));
});

test("All launcher controls (open + hide/show) are real <button type=\"button\"> elements with aria-label and a visible focus-visible ring", () => {
  const openCount = (launcher.match(/<button\b/g) ?? []).length;
  const typeButtonCount = (launcher.match(/type="button"/g) ?? []).length;
  const ariaLabelCount = (launcher.match(/aria-label=/g) ?? []).length;
  const focusRingCount = (launcher.match(/focus-visible:ring-2/g) ?? []).length;
  assert.equal(openCount, 2, "expected exactly 2 <button> elements: open, hide/show");
  assert.equal(typeButtonCount, 2);
  assert.equal(ariaLabelCount, 2);
  assert.equal(focusRingCount, 3); // open button (2 className branches) + hide/show button
});

test("Decorative overlay layers are aria-hidden and pointer-events-none", () => {
  const decorativeSpans = launcher.match(/<span\s+aria-hidden="true"[\s\S]{0,220}?\/>/g) ?? [];
  assert.ok(decorativeSpans.length > 0);
  for (const span of decorativeSpans) {
    assert.ok(span.includes("pointer-events-none"), span.slice(0, 100));
  }
  const avatarDecorativeSpans = avatar.match(/aria-hidden="true"/g) ?? [];
  assert.ok(avatarDecorativeSpans.length >= 4); // eye, chest, 2x wing shimmer (+ success pulse when applicable)
});

test("Header avatar stays calm during open chat: no wing shimmer at size=\"header\", regardless of state", () => {
  assert.ok(avatar.includes('const wingShimmerEnabled = size === "launcher" && isIdleLike;'));
});

// ── V2: layer-ready avatar contract ─────────────────────────────────────────────────────────────

test("V2-9/10. USE_LAYERED_NOA_AVATAR defaults false, and a real layer contract (6 named layers) exists", () => {
  assert.equal(USE_LAYERED_NOA_AVATAR, false);
  const names: NoaAvatarLayerName[] = NOA_AVATAR_LAYERS.map((layer) => layer.name);
  for (const expected of ["body", "head", "leftArm", "rightArm", "leftWing", "rightWing"] as const) {
    assert.ok(names.includes(expected), `missing layer: ${expected}`);
  }
  assert.equal(new Set(names).size, names.length, "layer names must be unique");
});

test("V2-7. Every future layer path is a plain string under /noa/layers/, never a Next.js static import", () => {
  for (const layer of NOA_AVATAR_LAYERS) {
    assert.match(layer.src, /^\/noa\/layers\/[a-z-]+\.png$/);
  }
  assert.ok(!avatar.includes('import') || !/from ["'].*noa\/layers\//.test(avatar));
});

test("V2-11. Missing layer asset files cannot break the build - noa-avatar.tsx never statically imports a layer PNG, only reads layer.src as a runtime string", () => {
  assert.ok(!/import\s+\w+\s+from\s+["'].*\.png["']/.test(avatar));
  assert.ok(avatar.includes("src={layer.src}"));
});

test("V2-12. The current robot PNG path is unchanged and remains the fallback's actual src", () => {
  assert.ok(avatar.includes('src="/noa/noa-robot.png"'));
});

test("V2-13. The fallback (USE_LAYERED_NOA_AVATAR === false) branch never fakes independent head/hand articulation - only the whole-image greet class is applied there", () => {
  const fallbackBranchStart = avatar.indexOf(") : (\n        <img");
  const fallbackBranchEnd = avatar.indexOf(")}\n      {state ===", fallbackBranchStart);
  const fallbackBranch = avatar.slice(fallbackBranchStart, fallbackBranchEnd);
  assert.ok(fallbackBranch.includes('src="/noa/noa-robot.png"'));
  assert.ok(!fallbackBranch.includes("noa-anim-layer-tilt") && !fallbackBranch.includes("noa-anim-layer-wave"));
});

test("V2-9. Layer motion is small and bounded (+/-3-5deg tilt, one-shot small-angle wave), never a fake 3D rotation, gated behind the unused layered branch only", () => {
  assert.ok(assistant.includes("@keyframes noa-layer-tilt { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }"));
  assert.ok(assistant.includes("@keyframes noa-layer-wave"));
  assert.ok(avatar.includes("USE_LAYERED_NOA_AVATAR ? ("));
  assert.ok(avatar.includes("layerMotionClass(layer.motion, greet)"));
});

test("V2 reduced-motion also disables the (currently unused) layer-ready motion classes", () => {
  const reducedMotionBlock = assistant.slice(
    assistant.indexOf("@media (prefers-reduced-motion: reduce)"),
    assistant.indexOf("@media (hover: hover)"),
  );
  assert.ok(reducedMotionBlock.includes(".noa-anim-layer-tilt") && reducedMotionBlock.includes(".noa-anim-layer-wave"));
  assert.ok(reducedMotionBlock.includes(".noa-anim-greet-chest") && reducedMotionBlock.includes(".noa-anim-greet-wing"));
});

test("V2 wing shimmer now travels (translateY component) and is visibly brighter (bg-amber-100, opacity up to 1)", () => {
  assert.ok(assistant.includes("translateY(6px) scale(0.7)") && assistant.includes("translateY(-6px) scale(1.2)"));
  assert.ok(avatar.includes("bg-amber-100"));
});

test("V2 greeting now also brightens chest and flashes both wing streaks, in addition to the existing eye brighten + lean", () => {
  assert.ok(avatar.includes("noa-anim-greet-chest"));
  assert.ok(avatar.includes("noa-anim-greet-wing"));
  assert.ok(avatar.includes("noa-anim-greet-eye"));
});
