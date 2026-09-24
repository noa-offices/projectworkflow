"use client";

import type { NoaVisualState } from "@/lib/noa/noa-types";

// Focal "eye-light" glow - sits right over the visor/eye-ring in the artwork, tuned per state.
const GLOW_CLASS_BY_STATE: Record<NoaVisualState, string> = {
  idle: "bg-amber-400/40",
  hover: "bg-amber-300/60",
  open: "bg-amber-300/70",
  thinking: "bg-amber-300/85",
  responding: "bg-amber-300/85",
  success: "bg-emerald-300/85",
  error: "bg-red-400/70",
};

// Second, larger, softer glow BEHIND the whole character - reads as ambient room light rather than
// a focused eye-glow (PART 1: "soft light/glow feel around face/helmet/eyes"), never a color swap
// on the artwork itself.
const AMBIENT_GLOW_CLASS_BY_STATE: Record<NoaVisualState, string> = {
  idle: "bg-amber-200/25",
  hover: "bg-amber-200/35",
  open: "bg-amber-200/35",
  thinking: "bg-amber-200/45",
  responding: "bg-amber-200/45",
  success: "bg-emerald-200/40",
  error: "bg-red-300/30",
};

type NoaAvatarSize = "launcher" | "header";

const SIZE_CLASS: Record<NoaAvatarSize, string> = {
  launcher: "h-14 w-14 sm:h-[76px] sm:w-[76px]",
  header: "h-9 w-9",
};

export function NoaAvatar({
  floatEnabled = false,
  greet = false,
  size = "launcher",
  state,
}: {
  floatEnabled?: boolean;
  // PART 1: a single, one-shot "hello" wiggle. The CALLER decides when (e.g. shortly after
  // mount) by flipping this to true - see noa-assistant.tsx's .noa-anim-greet keyframe, whose own
  // final frame already matches the unanimated resting rotation. Applied to the <img> specifically
  // (not the floating wrapper span) so the greet rotation and the idle float/breathe motion compose
  // as independent nested transforms instead of two animations fighting over the same element's
  // `transform`.
  greet?: boolean;
  size?: NoaAvatarSize;
  state: NoaVisualState;
}) {
  const isThinking = state === "thinking" || state === "responding";

  return (
    <span
      className={`relative inline-flex items-center justify-center ${SIZE_CLASS[size]} ${
        floatEnabled ? "noa-anim-float" : ""
      }`}
    >
      {/* Ambient halo - large, soft, low-opacity, always colors match the focal glow's state.
          Purely decorative light, never touches the artwork's own pixels. */}
      <span
        aria-hidden="true"
        className={`absolute inset-[-20%] rounded-full blur-2xl transition-colors duration-500 ${AMBIENT_GLOW_CLASS_BY_STATE[state]} ${
          state === "idle" ? "noa-anim-ambient-pulse" : ""
        }`}
      />
      {/* Focal glow overlay only - the robot artwork itself is never distorted, cropped, or
          recolored. */}
      <span
        aria-hidden="true"
        className={`absolute left-1/2 top-[30%] h-[24%] w-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-md transition-colors duration-300 ${GLOW_CLASS_BY_STATE[state]} ${
          state === "idle" ? "noa-anim-idle-pulse" : ""
        } ${isThinking ? "noa-anim-thinking-ring" : ""}`}
      />
      <img
        alt="NOA assistant"
        className={`relative h-full w-full select-none object-contain drop-shadow-md ${greet ? "noa-anim-greet" : ""}`}
        draggable={false}
        src="/noa/noa-robot.png"
      />
      {state === "success" ? (
        <span
          aria-hidden="true"
          className="noa-anim-success-pulse absolute left-1/2 top-[30%] h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300"
        />
      ) : null}
    </span>
  );
}
