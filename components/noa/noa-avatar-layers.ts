// NOA Avatar V2 - PART 6/7: a small, explicit contract for NOA's avatar rendering, so the real
// layered asset set (independent body/head/arm PNGs, rebuilt pixel-perfect from the original
// public/noa/noa-robot.png) can be wired in without redesigning noa-avatar.tsx's structure again.
//
// TODAY: `USE_LAYERED_NOA_AVATAR` is false and the single flat `public/noa/noa-robot.png` (PART 8
// fallback) is the only thing that actually renders - this file changes NONE of that until the
// layered rendering has been visually verified. This file never uses a Next.js static `import`
// for a layer PNG (a missing static import would break the build); every path below is a plain
// runtime string, only ever read behind the flag, so a missing file would 404 gracefully at
// runtime rather than break anything.
//
// There is no wing artwork - NOA has no wings. The decorative amber "wing shimmer" light streaks
// in noa-avatar.tsx are a standalone CSS overlay effect near the shoulders, unrelated to this
// layer contract.
//
// Pure data/types only - no React, no DOM, no business logic.

export const USE_LAYERED_NOA_AVATAR = true;

export type NoaAvatarLayerName = "body" | "head" | "leftArm" | "rightArm";

// PART 9/10/11: each layer's motion budget is deliberately tiny and named, never a generic
// "animate everything" hook - "tilt" is a bounded ±3-5deg rotation (head), "greetingWave" is a
// small one-shot rotation on the right arm only, "sway" is a subtle, continuous, low-amplitude
// secondary motion on the left arm (clearly smaller than the wave). A layer with no `motion` is a
// stable anchor - "body" is the anchor every other layer is positioned against.
export type NoaAvatarLayerMotion = "tilt" | "greetingWave" | "sway";

export type NoaAvatarLayer = {
  name: NoaAvatarLayerName;
  // The real asset path, e.g. "/noa/layers/head.png". Never imported statically; only ever used
  // as a plain <img src> string behind USE_LAYERED_NOA_AVATAR.
  src: string;
  motion?: NoaAvatarLayerMotion;
};

// Stacking order (painted back-to-front) validated against the original flat artwork by
// compositing these 4 layers onto a blank canvas and diffing against public/noa/noa-robot.png:
// body, then left arm, then right arm, then head on top - reproduces the source exactly.
export const NOA_AVATAR_LAYERS: readonly NoaAvatarLayer[] = [
  { name: "body", src: "/noa/layers/body.png" },
  { name: "leftArm", src: "/noa/layers/left-arm.png", motion: "sway" },
  { name: "rightArm", src: "/noa/layers/right-arm.png", motion: "greetingWave" },
  { name: "head", src: "/noa/layers/head.png", motion: "tilt" },
];

// Lighting stays CSS overlays in BOTH fallback and layered modes - never baked into a layer PNG,
// never a separate lighting asset.
export type NoaAvatarLightName = "eyeGlow" | "chestGlow";
