"use client";

import type { NoaVisualState } from "@/lib/noa/noa-types";
import { NOA_AVATAR_LAYERS, USE_LAYERED_NOA_AVATAR } from "./noa-avatar-layers";

// PART 12: the strongest light effect on the avatar - clearly visible at rest. Still a small,
// localized glow (never a large halo behind the whole character - PART 18).
const EYE_GLOW_CLASS_BY_STATE: Record<NoaVisualState, string> = {
  idle: "bg-amber-400/60",
  hover: "bg-amber-300/75",
  open: "bg-amber-300/80",
  thinking: "bg-amber-300/90",
  responding: "bg-amber-300/90",
  success: "bg-emerald-300/90",
  error: "bg-red-400/80",
};

// PART 13: chest/logo light - clearly visible but noticeably weaker/smaller than the eye light at
// every shared state. Energy moving through the logo area, never a detached glow.
const CHEST_GLOW_CLASS_BY_STATE: Record<NoaVisualState, string> = {
  idle: "bg-amber-300/32",
  hover: "bg-amber-300/38",
  open: "bg-amber-300/38",
  thinking: "bg-amber-300/48",
  responding: "bg-amber-300/48",
  success: "bg-emerald-300/42",
  error: "bg-red-300/30",
};

type NoaAvatarSize = "launcher" | "header";

const SIZE_CLASS: Record<NoaAvatarSize, string> = {
  launcher: "h-16 w-16 sm:h-20 sm:w-20",
  header: "h-9 w-9",
};

// PART 10/11: a layer's own motion class - only ever reached from the (today unused)
// USE_LAYERED_NOA_AVATAR branch below. Bounded per PART 9/10/11: a small ±3-5deg head tilt, a
// small one-shot right-arm rotation for the greeting, a subtle continuous left-arm sway - never a
// fake 3D rotation, never a full articulation.
function layerMotionClass(motion: "tilt" | "greetingWave" | "sway" | undefined, greet: boolean): string {
  if (motion === "tilt") return "noa-anim-layer-tilt";
  if (motion === "greetingWave" && greet) return "noa-anim-layer-wave";
  if (motion === "sway") return "noa-anim-layer-sway";
  return "";
}

export function NoaAvatar({
  floatEnabled = false,
  greet = false,
  pose = "full",
  size = "launcher",
  state,
}: {
  floatEnabled?: boolean;
  // PART 15: a single, one-shot "hello" (lean + tiny bounce + rotate + eye/chest brighten + wing
  // shimmer). The CALLER decides when (e.g. shortly after mount) by flipping this to true.
  // Applied to the <img>/light layers specifically (never the floating wrapper span), so the
  // greet motion composes as an independent nested transform instead of fighting the idle float
  // for the same property.
  greet?: boolean;
  pose?: "full" | "sneak";
  size?: NoaAvatarSize;
  state: NoaVisualState;
}) {
  const isThinking = state === "thinking" || state === "responding";
  const isSneak = pose === "sneak";

  return (
    <span
      className={`relative inline-flex items-center justify-center ${SIZE_CLASS[size]} ${
        floatEnabled ? "noa-anim-float" : ""
      } ${isSneak ? "noa-sneak-composite" : ""}`}
    >
      {/* PART 13: chest/logo light - soft, slow, clearly weaker than the eye light below. Brief,
          separate brighten during the one-shot greet (PART 15) - never combined with the
          continuous idle pulse on the same element. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-[64%] h-[8%] w-[18%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-sm transition-colors duration-500 ${CHEST_GLOW_CLASS_BY_STATE[state]} ${
          greet ? "noa-anim-greet-chest" : state === "idle" ? "noa-anim-chest-pulse" : ""
        }`}
      />
      {/* PART 12: focal eye-light overlay - small, aligned with the visor/eye-ring, clearly
          visible. The robot artwork itself is never distorted, cropped, or recolored. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-[30%] h-[19%] w-[19%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-sm transition-colors duration-300 ${EYE_GLOW_CLASS_BY_STATE[state]} ${
          greet ? "noa-anim-greet-eye" : state === "idle" ? "noa-anim-idle-pulse" : ""
        } ${isThinking ? "noa-anim-thinking-ring" : ""}`}
      />
      {/* PART 6/8/9: USE_LAYERED_NOA_AVATAR is false today, so this is always the single flat PNG
          (the only thing that actually ships/renders - PART 8). The `true` branch is real,
          type-checked code (never a fake/broken import - every layer `src` is a plain runtime
          string, not a Next.js static import) that stacks each configured layer with its own
          bounded motion class, so wiring in real layer assets later is a data change, not a
          rewrite. Do NOT flip USE_LAYERED_NOA_AVATAR until the actual PNGs exist. */}
      {USE_LAYERED_NOA_AVATAR ? (
        // The composite (all layers stacked) reads as one accessible image - each individual
        // layer underneath is purely decorative on its own.
        <span aria-label="NOA assistant" className="absolute inset-0" role="img">
          {NOA_AVATAR_LAYERS.map((layer) => (
            <img
              alt=""
              aria-hidden="true"
              className={`absolute inset-0 h-full w-full select-none object-contain drop-shadow-sm ${layerMotionClass(
                isSneak ? undefined : layer.motion,
                greet,
              )} ${
                isSneak && layer.name === "head" ? "noa-sneak-head" : ""
              }`}
              draggable={false}
              key={layer.name}
              src={layer.src}
            />
          ))}
        </span>
      ) : (
        <img
          alt="NOA assistant"
          className={`relative h-full w-full select-none object-contain drop-shadow-sm ${greet ? "noa-anim-greet" : ""}`}
          draggable={false}
          src="/noa/noa-robot.png"
        />
      )}
      {state === "success" ? (
        <span
          aria-hidden="true"
          className="noa-anim-success-pulse pointer-events-none absolute left-1/2 top-[30%] h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300"
        />
      ) : null}
    </span>
  );
}
