"use client";

import { useEffect, useRef, useState } from "react";
import { NoaAvatar } from "@/components/noa/noa-avatar";
import type { NoaVisualState } from "@/lib/noa/noa-types";

// PART 15: a single, one-shot "hello" shortly after NOA first appears on the page - never
// repeats, no interval kept alive afterward, never blocks interaction either way.
const GREET_DELAY_MS = 650;
const DRAG_ACTIVATION_PX = 6;
const MODE_DRAG_THRESHOLD_PX = 38;

// PART 1/10/20: FULL (default, whole robot visible) or SNEAK (user-chosen hidden-behind-the-edge
// state). Deliberately just these two - no separate near-hidden "tab" level. Pure local
// presentation state, kept entirely OUT of noa-state-machine.ts (that machine still owns
// idle/hover/open/thinking/etc. exactly as before; this only decides how the CLOSED states look,
// and survives open/close for the rest of the page session by simply never being reset - see the
// comment above `mode` below for why no reset-on-open logic is even needed).
type NoaLauncherMode = "full" | "sneak";

// N2A3 PART 6: pure display formatting only, no business meaning - 1-9 shown as-is, anything
// higher collapses to "9+" (PART 6) so the badge never grows unbounded.
function attentionBadgeLabel(count: number | null | undefined): string | null {
  if (typeof count !== "number" || count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

export function NoaLauncher({
  attentionCount,
  onHoverEnd,
  onHoverStart,
  onToggle,
  pageSection,
  state,
}: {
  attentionCount?: number | null;
  onHoverEnd: () => void;
  onHoverStart: () => void;
  onToggle: () => void;
  pageSection?: string;
  state: NoaVisualState;
}) {
  const floatEnabled = state === "idle" || state === "hover" || state === "open";
  const isDrawerOpen = state !== "idle" && state !== "hover";

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
  const dragRef = useRef<{ horizontal: boolean; pointerId: number; startX: number; startY: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const resetDrag = () => {
    dragRef.current = null;
    setDragOffset(0);
    setIsDragging(false);
  };

  // N2A3 PART 8: shown in Full only - Sneak's own transform/overflow already makes a clean badge
  // placement awkward, and the task explicitly allows hiding it there. PART 17: the numeral form
  // ("9+") is fine visually but reads oddly aloud, so the aria suffix spells it out instead.
  const badgeLabel = !isSneak ? attentionBadgeLabel(attentionCount) : null;
  const attentionAriaSuffix = badgeLabel
    ? ` ${typeof attentionCount === "number" && attentionCount > 9 ? "More than 9 items" : `${attentionCount} item${attentionCount === 1 ? "" : "s"}`} need attention.`
    : "";

  return (
    // PART 2/9: `group` marks this as the hover/focus scope for the secondary Hide/Show control
    // below (CSS group-hover/group-focus-within - no JS hover state needed for that reveal). The
    // vertical offset (bottom-20/sm:bottom-24) is unchanged from before, so this still sits above
    // the app's other fixed bottom-right control (GlobalLoadingIndicator, bottom-4 right-4) rather
    // than on top of it. Full mode sits a small inset from the true edge (so it's never clipped by
    // default - PART 1); Sneak docks flush to the edge (PART 5's "wall").
    <div
      className={`group fixed bottom-20 z-40 sm:bottom-24 ${isDrawerOpen ? "hidden sm:block" : ""} ${isSneak ? "right-0" : "right-2 sm:right-3"}`}
      data-noa-page-section={pageSection}
    >
      <button
        aria-label={`${isSneak ? "Open NOA assistant. Drag left to show." : "Open NOA assistant. Drag right to hide."}${attentionAriaSuffix}`}
        // PART 3/6/8/11: clicking the robot itself always opens chat, in either mode. Full mode's
        // box always remains a generous target; Sneak uses the viewport edge as NOA's hiding
        // surface rather than a crop window inside this button.
        className={`${isSneak ? "relative flex h-16 w-14 items-center justify-end overflow-visible sm:h-20 sm:w-20" : "relative flex items-center justify-center"} touch-pan-y cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 ${isDragging ? "cursor-grabbing" : ""}`}
        onBlur={onHoverEnd}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onToggle();
        }}
        onFocus={onHoverStart}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && !isSneak) {
            event.preventDefault();
            setMode("sneak");
          }
          if (event.key === "ArrowLeft" && isSneak) {
            event.preventDefault();
            setMode("full");
          }
          if (event.key === "Home") {
            event.preventDefault();
            setMode("full");
          }
        }}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            resetDrag();
          }
        }}
        onPointerDown={(event) => {
          dragRef.current = { horizontal: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          if (!drag.horizontal) {
            if (Math.abs(dx) < DRAG_ACTIVATION_PX && Math.abs(dy) < DRAG_ACTIVATION_PX) return;
            if (Math.abs(dx) <= Math.abs(dy)) return;
            drag.horizontal = true;
            setIsDragging(true);
          }
          event.preventDefault();
          setDragOffset(isSneak ? Math.min(0, dx) : Math.max(0, dx));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.startX;
          const completedDrag = drag.horizontal && Math.abs(dx) >= DRAG_ACTIVATION_PX;
          if (completedDrag) {
            suppressClickRef.current = true;
            if (!isSneak && dx >= MODE_DRAG_THRESHOLD_PX) setMode("sneak");
            if (isSneak && dx <= -MODE_DRAG_THRESHOLD_PX) setMode("full");
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          resetDrag();
        }}
        type="button"
      >
        <span
          className={`inline-flex ${isDragging ? "noa-dragging" : "transition-transform duration-200 ease-out"}`}
          style={isDragging ? { transform: `translateX(${dragOffset}px)` } : undefined}
        >
          {isSneak ? (
            <NoaAvatar floatEnabled={false} greet={false} pose="sneak" size="launcher" state={state} />
          ) : (
            <NoaAvatar floatEnabled={floatEnabled} greet={greeted} size="launcher" state={state} />
          )}
        </span>
        {/* N2A3 PART 6/7/9/17/19: decorative only - pointer-events-none so it can never intercept
            the drag/click handled above, aria-hidden since the button's own aria-label already
            carries the count, and it never touches drag/animation state or the avatar itself. */}
        {badgeLabel ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border-2 border-white bg-amber-400 px-1 text-[10px] font-semibold leading-none text-amber-950 shadow-sm"
          >
            {badgeLabel}
          </span>
        ) : null}
      </button>
    </div>
  );
}
