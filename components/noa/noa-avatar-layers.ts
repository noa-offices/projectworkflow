// NOA Avatar V2 - PART 6/7: a small, explicit contract for NOA's avatar rendering, so a FUTURE
// layered asset set (independent head/arm/wing PNGs) can be wired in later without redesigning
// noa-avatar.tsx's structure again.
//
// TODAY: `USE_LAYERED_NOA_AVATAR` is false and the single flat `public/noa/noa-robot.png` (PART 8
// fallback) is the only thing that actually renders - this file changes NONE of that. No layer
// PNG exists yet, and this file never uses a Next.js static `import` for one (a missing static
// import would break the build); every path below is a plain runtime string, only ever read
// behind the flag, so a missing file would 404 gracefully at runtime rather than break anything.
//
// Pure data/types only - no React, no DOM, no business logic.

export const USE_LAYERED_NOA_AVATAR = false;

export type NoaAvatarLayerName = "body" | "head" | "leftArm" | "rightArm" | "leftWing" | "rightWing";

// PART 9/10/11: each layer's motion budget is deliberately tiny and named, never a generic
// "animate everything" hook - "tilt" is a bounded ±3-5deg rotation (head), "greetingWave" is a
// small one-shot rotation on the ONE arm asked for (never a full hand articulation). A layer with
// no `motion` is a stable anchor (e.g. "body", the wings - which get their light streaks from the
// existing CSS overlay effects in noa-avatar.tsx, never a body-part animation per PART 14/9).
export type NoaAvatarLayerMotion = "tilt" | "greetingWave";

export type NoaAvatarLayer = {
  name: NoaAvatarLayerName;
  // PART 7: the expected future asset path - e.g. "/noa/layers/head.png". Never imported
  // statically; only ever used as a plain <img src> string behind USE_LAYERED_NOA_AVATAR.
  src: string;
  motion?: NoaAvatarLayerMotion;
};

// PART 7: expected future paths, defined clearly, with none of the files required to exist yet
// (PART 6). Order matters for stacking (painted back-to-front): body first, then limbs/wings,
// head last (matches the current single-PNG artwork's own front-facing layering).
export const NOA_AVATAR_LAYERS: readonly NoaAvatarLayer[] = [
  { name: "body", src: "/noa/layers/body.png" },
  { name: "leftWing", src: "/noa/layers/left-wing.png" },
  { name: "rightWing", src: "/noa/layers/right-wing.png" },
  { name: "leftArm", src: "/noa/layers/left-arm.png" },
  { name: "rightArm", src: "/noa/layers/right-arm.png", motion: "greetingWave" },
  { name: "head", src: "/noa/layers/head.png", motion: "tilt" },
];

// Lighting stays CSS overlays in BOTH fallback and layered modes - never baked into a layer PNG,
// never a separate lighting asset.
export type NoaAvatarLightName = "eyeGlow" | "chestGlow";
