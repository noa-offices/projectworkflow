"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { NoaAvatar } from "@/components/noa/noa-avatar";
import type { NoaVisualState } from "@/lib/noa/noa-types";

// PART 15: a single, one-shot "hello" shortly after NOA first appears on the page - never
// repeats, no interval kept alive afterward, never blocks interaction either way.
const GREET_DELAY_MS = 650;

// PART 1/10/20: FULL (default, whole robot visible) or SNEAK (user-chosen hidden-behind-the-edge
// state). Deliberately just these two - no separate near-hidden "tab" level. Pure local
// presentation state, kept entirely OUT of noa-state-machine.ts (that machine still owns
// idle/hover/open/thinking/etc. exactly as before; this only decides how the CLOSED states look,
// and survives open/close for the rest of the page session by simply never being reset - see the
// comment above `mode` below for why no reset-on-open logic is even needed).
type NoaLauncherMode = "full" | "sneak";

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
  const isClosed = state === "idle" || state === "hover";
  const floatEnabled = state === "idle" || state === "hover" || state === "open";

  const [greeted, setGreeted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGreeted(true), GREET_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // PART 20: clicking the robot (the ONLY way to open the drawer from this component, in either
  // mode - PART 3/8) never touches `mode`, so whichever mode the user picked is exactly what's
  // still selected the next time the drawer closes. No reset effect needed.
  const [mode, setMode] = useState<NoaLauncherMode>("full");
  const isSneak = mode === "sneak";

  return (
    // PART 2/9: `group` marks this as the hover/focus scope for the secondary Hide/Show control
    // below (CSS group-hover/group-focus-within - no JS hover state needed for that reveal). The
    // vertical offset (bottom-20/sm:bottom-24) is unchanged from before, so this still sits above
    // the app's other fixed bottom-right control (GlobalLoadingIndicator, bottom-4 right-4) rather
    // than on top of it. Full mode sits a small inset from the true edge (so it's never clipped by
    // default - PART 1); Sneak docks flush to the edge (PART 5's "wall").
    <div
      className={`group fixed bottom-20 z-40 sm:bottom-24 ${isSneak ? "right-0" : "right-2 sm:right-3"}`}
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
      {/* PART 2/9/18/23: the Hide/Show control - a SEPARATE button/hit box from the main "open"
          button below (never overlapping it), positioned above the avatar so it never covers the
          face. `noa-secondary-control` (defined in noa-assistant.tsx's shared <style>) hides this
          until hover/keyboard-focus ONLY on devices that actually have hover + a fine pointer
          (real mice); on touch devices (no reliable hover) it stays at a small, subtle opacity by
          default instead, so there's still always a way to reach it (PART 18). */}
      {isClosed ? (
        <button
          aria-label={isSneak ? "Show NOA" : "Hide NOA"}
          className="noa-secondary-control absolute -top-2 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 opacity-70 shadow-sm outline-none transition-colors duration-200 hover:text-zinc-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          onClick={(event) => {
            // PART 3: never opens chat - this control only ever changes the presentation mode.
            event.stopPropagation();
            onHoverEnd();
            setMode(isSneak ? "full" : "sneak");
          }}
          type="button"
        >
          {isSneak ? (
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
      <button
        aria-label="Open NOA assistant"
        // PART 3/6/8/11: clicking the robot itself always opens chat, in either mode. Full mode's
        // box just wraps the avatar at its own natural size; Sneak's box is deliberately WIDER
        // than the visible crop window below so the tap target stays generous even though the
        // painted content is narrower (PART 6/23 - the hitbox itself is never translated/clipped).
        className={isSneak ? "relative flex h-14 w-11 items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 sm:h-16 sm:w-14" : "relative flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"}
        onBlur={onHoverEnd}
        onClick={onToggle}
        onFocus={onHoverStart}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        type="button"
      >
        {isSneak ? (
          // PART 5/6/7/8: the crop WINDOW - narrower/shorter than the avatar at rest, so only its
          // own top-left slice (head + a shoulder edge) is painted; everything past this box's
          // edges is simply clipped by `overflow-hidden`, never a separate crop/mask asset. It
          // GROWS on hover/keyboard-focus (revealing more upper torso, PART 8) via a plain size
          // transition - real proportions of the same full-size avatar underneath, never a
          // different image.
          <span className="relative h-10 w-5 overflow-hidden rounded-l-2xl transition-[width,height] duration-300 ease-out group-hover:h-12 group-hover:w-9 group-focus-within:h-12 group-focus-within:w-9 sm:h-12 sm:w-6 sm:group-hover:h-14 sm:group-hover:w-11 sm:group-focus-within:h-14 sm:group-focus-within:w-11">
            {/* PART 5: the ONLY "wall" treatment - a hairline static rim light along the clip
                edge, never a blurred halo/dock/panel (PART 11). */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-amber-200/60 to-transparent"
            />
            <span
              // PART 7/8: resting state is the sparse "curious peek" CSS animation (mostly hidden,
              // one brief small lean out every ~11s); hovering/focusing cancels that animation and
              // snaps to the fully-revealed resting position instead, transitioning smoothly - two
              // mutually exclusive drivers of the SAME transform, never running together.
              className="noa-anim-sneak-lean absolute left-0 top-0 transition-transform duration-300 ease-out group-hover:[animation:none] group-hover:translate-x-0 group-focus-within:[animation:none] group-focus-within:translate-x-0"
            >
              <NoaAvatar floatEnabled={floatEnabled} greet={greeted} size="launcher" state={state} />
            </span>
          </span>
        ) : (
          <NoaAvatar floatEnabled={floatEnabled} greet={greeted} size="launcher" state={state} />
        )}
      </button>
    </div>
  );
}
