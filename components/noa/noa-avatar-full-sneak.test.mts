import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync("components/noa/noa-launcher.tsx", "utf8");
const assistant = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const avatar = readFileSync("components/noa/noa-avatar.tsx", "utf8");
const layers = readFileSync("components/noa/noa-avatar-layers.ts", "utf8");

test("layered Full remains default, four-layered, and free of side streaks", () => {
  assert.ok(launcher.includes('useState<NoaLauncherMode>("full")'));
  assert.ok(layers.includes("USE_LAYERED_NOA_AVATAR = true"));
  for (const name of ["body", "leftArm", "rightArm", "head"]) assert.ok(layers.includes(`name: "${name}"`));
  assert.ok(!avatar.includes("wing-shimmer") && !assistant.includes("noa-wing-shimmer"));
});

test("there is no secondary Hide/Show or chevron UI", () => {
  for (const source of [launcher, assistant]) {
    assert.ok(!source.includes("noa-secondary-control"));
    assert.ok(!source.includes("Show NOA") && !source.includes("Hide NOA"));
    assert.ok(!source.includes("ChevronLeft") && !source.includes("ChevronRight"));
  }
});

test("an open drawer hides the mobile launcher without unmounting its local Full/Sneak mode", () => {
  assert.ok(launcher.includes('const isDrawerOpen = state !== "idle" && state !== "hover";'));
  assert.ok(launcher.includes('isDrawerOpen ? "hidden sm:block" : ""'));
  assert.ok(launcher.includes('useState<NoaLauncherMode>("full")'));
});

test("one native Pointer Events path distinguishes a candidate, horizontal drag, release, and cancel", () => {
  for (const handler of ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel"]) assert.ok(launcher.includes(handler));
  assert.ok(launcher.includes("setPointerCapture(event.pointerId)") && launcher.includes("releasePointerCapture(event.pointerId)"));
  assert.ok(launcher.includes("Math.abs(dx) <= Math.abs(dy)"));
  assert.ok(launcher.includes("DRAG_ACTIVATION_PX") && launcher.includes("MODE_DRAG_THRESHOLD_PX"));
});

test("right drag hides, left drag restores, and insufficient movement only snaps back", () => {
  assert.ok(launcher.includes('if (!isSneak && dx >= MODE_DRAG_THRESHOLD_PX) setMode("sneak")'));
  assert.ok(launcher.includes('if (isSneak && dx <= -MODE_DRAG_THRESHOLD_PX) setMode("full")'));
  assert.ok(launcher.includes("setDragOffset(isSneak ? Math.min(0, dx) : Math.max(0, dx))"));
  assert.ok(launcher.includes("setDragOffset(0)") && launcher.includes("setIsDragging(false)"));
});

test("short clicks still open chat while completed drags suppress the click", () => {
  assert.ok(launcher.includes("suppressClickRef"));
  assert.ok(launcher.includes("if (suppressClickRef.current)"));
  assert.ok(launcher.includes("suppressClickRef.current = true"));
  assert.equal((launcher.match(/onToggle\(\)/g) ?? []).length, 1);
});

test("keyboard, cursor, touch handling, and drag animation suppression remain accessible", () => {
  assert.ok(launcher.includes('event.key === "ArrowRight"') && launcher.includes('event.key === "ArrowLeft"'));
  assert.ok(launcher.includes("touch-pan-y") && launcher.includes("cursor-grab") && launcher.includes("cursor-grabbing"));
  assert.ok(launcher.includes("noa-dragging"));
  assert.ok(assistant.includes(".noa-dragging .noa-anim-float") && assistant.includes(".noa-dragging .noa-sneak-composite"));
});

test("Sneak uses a body-led composite lean with only small head secondary motion", () => {
  assert.ok(avatar.includes('isSneak ? "noa-sneak-composite" : ""'));
  assert.ok(avatar.includes("isSneak ? undefined : layer.motion"));
  assert.ok(assistant.includes("translateX(44px) rotate(-3deg)"));
  assert.ok(assistant.includes("transform-origin: 50% 85%"));
  assert.ok(assistant.includes("translateX(-3px) rotate(-2deg)"));
  assert.ok(assistant.includes("transform-origin: 50% 72%"));
  assert.ok(!assistant.includes("noa-sneak-leftArm") && !assistant.includes("noa-sneak-rightArm"));
  assert.ok(assistant.includes("translateX(34px) rotate(-3.5deg)"));
});

test("reduced motion keeps the corrected static assembled pose", () => {
  assert.ok(assistant.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(assistant.includes(".noa-sneak-composite { transform: translateX(44px) rotate(-3deg); }"));
  assert.ok(assistant.includes(".noa-sneak-head { transform: translateX(-3px) rotate(-2deg); }"));
  assert.ok(!/from\s+["'].*noa-state-machine/.test(launcher));
});
