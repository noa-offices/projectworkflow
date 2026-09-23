"use client";

import { NoaAvatar } from "@/components/noa/noa-avatar";
import type { NoaVisualState } from "@/lib/noa/noa-types";

export function NoaLauncher({
  onHoverEnd,
  onHoverStart,
  onToggle,
  pageSection,
  state,
}: {
  onHoverEnd: () => void;
  onHoverStart: () => void;
  onToggle: () => void;
  pageSection?: string;
  state: NoaVisualState;
}) {
  const isHovered = state === "hover";
  const isAlert = state !== "idle" && state !== "hover";
  const floatEnabled = state === "idle" || state === "hover" || state === "open";

  return (
    // Sits above the app's other fixed bottom-right control (GlobalLoadingIndicator, bottom-4
    // right-4) rather than on top of it.
    <div
      className="fixed bottom-20 right-4 z-40 sm:bottom-24 sm:right-6"
      data-noa-page-section={pageSection}
    >
      <span
        aria-hidden="true"
        role="tooltip"
        className={`pointer-events-none absolute bottom-full right-1 mb-2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg transition-opacity duration-150 ${
          isHovered ? "opacity-100" : "opacity-0"
        }`}
      >
        Ask NOA
      </span>
      <button
        aria-label="Ask NOA"
        className={`relative flex items-center justify-center rounded-full outline-none transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 ${
          isHovered ? "scale-[1.035]" : "scale-100"
        }`}
        onBlur={onHoverEnd}
        onClick={onToggle}
        onFocus={onHoverStart}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        type="button"
      >
        <span
          aria-hidden="true"
          className="absolute inset-2 rounded-full bg-black/15 blur-lg transition-opacity duration-200"
          style={{ opacity: isHovered || isAlert ? 0.32 : 0.18 }}
        />
        <NoaAvatar floatEnabled={floatEnabled} size="launcher" state={state} />
      </button>
    </div>
  );
}
