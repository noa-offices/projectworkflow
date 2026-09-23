"use client";

import type { NoaVisualState } from "@/lib/noa/noa-types";

const GLOW_CLASS_BY_STATE: Record<NoaVisualState, string> = {
  idle: "bg-amber-400/40",
  hover: "bg-amber-300/60",
  open: "bg-amber-300/70",
  thinking: "bg-amber-300/85",
  responding: "bg-amber-300/85",
  success: "bg-emerald-300/85",
  error: "bg-red-400/70",
};

type NoaAvatarSize = "launcher" | "header";

const SIZE_CLASS: Record<NoaAvatarSize, string> = {
  launcher: "h-16 w-16 sm:h-[76px] sm:w-[76px]",
  header: "h-9 w-9",
};

export function NoaAvatar({
  floatEnabled = false,
  size = "launcher",
  state,
}: {
  floatEnabled?: boolean;
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
      {/* Glow overlay only - the robot artwork itself is never distorted, cropped, or recolored. */}
      <span
        aria-hidden="true"
        className={`absolute left-1/2 top-[30%] h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-md transition-colors duration-300 ${GLOW_CLASS_BY_STATE[state]} ${
          state === "idle" ? "noa-anim-idle-pulse" : ""
        } ${isThinking ? "noa-anim-thinking-ring" : ""}`}
      />
      <img
        alt="NOA assistant"
        className="relative h-full w-full select-none object-contain drop-shadow-md"
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
