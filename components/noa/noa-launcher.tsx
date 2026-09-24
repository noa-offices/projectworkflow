"use client";

import { useEffect, useState } from "react";
import { NoaAvatar } from "@/components/noa/noa-avatar";
import type { NoaVisualState } from "@/lib/noa/noa-types";

// PART 1: a single, one-shot "hello" shortly after NOA first appears on the page - never repeats,
// no interval kept alive afterward, never blocks interaction either way (the button works
// identically before/during/after the greet).
const GREET_DELAY_MS = 650;

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

  const [greeted, setGreeted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGreeted(true), GREET_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    // PART 3 "peek" presentation: docked flush to the viewport's own right edge (not floating
    // fully on-screen like before) - NOA rests mostly in view but leans slightly off the edge,
    // then leans further INTO view on hover/focus/alert as an invitation to open it. The <button>
    // below keeps a normal, fully on-screen, generously-sized hit box at all times (PART 5) - only
    // the decorative avatar/dock content inside it is translated, so this never makes the control
    // harder to reach on mobile. The vertical offset (bottom-20/sm:bottom-24) is unchanged from
    // before, so this still sits above the app's other fixed bottom-right control
    // (GlobalLoadingIndicator, bottom-4 right-4) rather than on top of it.
    <div
      className="fixed bottom-20 right-0 z-40 sm:bottom-24"
      data-noa-page-section={pageSection}
    >
      <span
        aria-hidden="true"
        role="tooltip"
        className={`pointer-events-none absolute bottom-full right-3 mb-2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg transition-opacity duration-150 ${
          isHovered ? "opacity-100" : "opacity-0"
        }`}
      >
        Ask NOA
      </span>
      <button
        aria-label="Open NOA assistant"
        className="group relative flex h-14 w-14 items-center justify-center outline-none transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 sm:h-[76px] sm:w-[76px]"
        onBlur={onHoverEnd}
        onClick={onToggle}
        onFocus={onHoverStart}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        type="button"
      >
        {/* The "ledge" NOA peeks from - a soft rounded dock bleeding past the button's own right
            edge (i.e. off the viewport), never a hard visual cutoff. Purely decorative: it never
            extends the button's own hit box, only its painted background. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-2 -right-4 left-2 rounded-l-[26px] border border-white/60 bg-white/70 shadow-lg shadow-zinc-900/10 backdrop-blur-sm transition-colors duration-300 group-hover:bg-white/85"
        />
        <span
          aria-hidden="true"
          className="absolute inset-1 rounded-full bg-black/10 blur-lg transition-opacity duration-200"
          style={{ opacity: isHovered || isAlert ? 0.3 : 0.16 }}
        />
        {/* PART 3 "occasional attention" - a separate, dedicated layer (never sharing `transform`
            with the avatar's own hover-translate below) so the two motions can never fight. Long
            9s cycle, almost entirely dormant, one brief soft amber blip near the end - sparse by
            design, not a constant loop. Idle only; never runs during hover/alert. */}
        {state === "idle" ? (
          <span aria-hidden="true" className="noa-anim-peek-attention absolute inset-3 rounded-full bg-amber-300/70 blur-md" />
        ) : null}
        <span
          className={`relative block transition-transform duration-300 ease-out ${
            isHovered || isAlert ? "translate-x-0" : "translate-x-[16%]"
          }`}
        >
          <NoaAvatar floatEnabled={floatEnabled} greet={greeted} size="launcher" state={state} />
        </span>
      </button>
    </div>
  );
}
