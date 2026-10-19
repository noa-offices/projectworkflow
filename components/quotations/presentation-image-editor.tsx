"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { normalizePresentationImageRect, type PresentationImageRect } from "@/lib/quotations/presentation-settings";
import { moveRect, nudgeRect, resizeRect, type ImageRectCorner } from "@/lib/quotations/presentation-image-rect";

const BRONZE = "#CC9366";
const FULL_BOX: PresentationImageRect = { x: 0, y: 0, w: 100, h: 100 };
const corners: Array<{ corner: ImageRectCorner; style: CSSProperties; cursor: string }> = [
  { corner: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
  { corner: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
  { corner: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
  { corner: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
];

function objectPositionFraction(value: string | undefined, free: number) {
  if (!value) return 0.5;
  if (value.endsWith("%")) return Number.parseFloat(value) / 100;
  const pixels = Number.parseFloat(value);
  return free > 0 && Number.isFinite(pixels) ? pixels / free : 0.5;
}

// Bounds of the image as it is drawn right now, in percent of the box. getBoundingClientRect already includes
// the stage's scale transform and the preview zoom, and percentages cancel the preview zoom out.
function measureDrawnImageRect(box: HTMLElement): PresentationImageRect | null {
  const image = box.querySelector("img");
  const boxBounds = box.getBoundingClientRect();
  if (!image || !boxBounds.width || !boxBounds.height) return null;

  const bounds = image.getBoundingClientRect();
  let { left, top, width, height } = bounds;
  const style = window.getComputedStyle(image);
  if (style.objectFit === "contain") {
    if (!image.naturalWidth || !image.naturalHeight) return null;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    const [positionX, positionY] = style.objectPosition.split(" ");
    left += (width - drawnWidth) * objectPositionFraction(positionX, width - drawnWidth);
    top += (height - drawnHeight) * objectPositionFraction(positionY, height - drawnHeight);
    width = drawnWidth;
    height = drawnHeight;
  }

  return normalizePresentationImageRect({
    x: ((left - boxBounds.left) / boxBounds.width) * 100,
    y: ((top - boxBounds.top) / boxBounds.height) * 100,
    w: (width / boxBounds.width) * 100,
    h: (height / boxBounds.height) * 100,
  }) ?? null;
}

// Text selection is switched off on the page only while a drag is in progress.
function setPageUserSelect(value: string) {
  if (value) document.body.style.setProperty("user-select", value);
  else document.body.style.removeProperty("user-select");
}

function sameRect(left: PresentationImageRect | null, right: PresentationImageRect | null) {
  return left === right || Boolean(left && right && left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h);
}

type DragState = {
  mode: "move" | ImageRectCorner;
  pointerId: number;
  startX: number;
  startY: number;
  start: PresentationImageRect;
  previousUserSelect: string;
};

/**
 * The product image box with an optional on-slide editor. When `editable` is false it renders the box only,
 * so print/PDF output is unchanged.
 */
export function ProductImageEditBox({
  children,
  editable,
  imageRect,
  measureKey,
  onRectChange,
  onSelectedChange,
  selected,
  style,
}: {
  children: ReactNode;
  editable: boolean;
  imageRect: PresentationImageRect | null;
  measureKey: string;
  onRectChange: (rect: PresentationImageRect) => void;
  onSelectedChange: (selected: boolean) => void;
  selected: boolean;
  style: CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingRef = useRef<PresentationImageRect | null>(null);
  const frameRef = useRef(0);
  const [measured, setMeasured] = useState<PresentationImageRect | null>(null);
  const [dragging, setDragging] = useState(false);

  // Before the first edit the frame follows the drawn image, so starting a drag does not make it jump.
  const display = imageRect ?? measured ?? FULL_BOX;
  const displayRef = useRef(display);
  const onRectChangeRef = useRef(onRectChange);
  const onSelectedChangeRef = useRef(onSelectedChange);
  useEffect(() => {
    displayRef.current = display;
    onRectChangeRef.current = onRectChange;
    onSelectedChangeRef.current = onSelectedChange;
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!editable || imageRect || !box) return;
    const update = () => {
      const next = measureDrawnImageRect(box);
      setMeasured((current) => (sameRect(current, next) ? current : next));
    };
    update();
    const image = box.querySelector("img");
    image?.addEventListener("load", update);
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => {
      image?.removeEventListener("load", update);
      observer.disconnect();
    };
  }, [editable, imageRect, measureKey]);

  // Deselect on outside pointer, Esc; arrow keys nudge. Only while selected.
  useEffect(() => {
    if (!editable || !selected) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!overlayRef.current?.contains(event.target as Node)) onSelectedChangeRef.current(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (event.key === "Escape") {
        onSelectedChangeRef.current(false);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      onRectChangeRef.current(nudgeRect(displayRef.current, event.key, event.shiftKey ? 2 : 0.5));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [editable, selected]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (dragRef.current) setPageUserSelect(dragRef.current.previousUserSelect);
  }, []);

  function flush() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next) onRectChangeRef.current(next);
  }

  function schedule(next: PresentationImageRect) {
    pendingRef.current = next;
    if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, mode: DragState["mode"]) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectedChange(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: displayRef.current,
      previousUserSelect: document.body.style.getPropertyValue("user-select"),
    };
    setPageUserSelect("none");
    setDragging(true);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const box = boxRef.current;
    if (!drag || !box || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    // Read the box size now: it already includes the fit-to-width preview scale.
    const bounds = box.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dx = ((event.clientX - drag.startX) / bounds.width) * 100;
    const dy = ((event.clientY - drag.startY) / bounds.height) * 100;
    if (!dx && !dy) return;
    schedule(drag.mode === "move" ? moveRect(drag.start, dx, dy) : resizeRect(drag.start, drag.mode, dx, dy));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    flush();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPageUserSelect(drag.previousUserSelect);
    dragRef.current = null;
    setDragging(false);
  }

  const dragHandlers = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag };

  return (
    <div ref={boxRef} className="absolute bg-white" style={style}>
      {children}
      {editable ? (
        <div ref={overlayRef} className="pointer-events-none absolute inset-0 print:hidden" data-presentation-image-editor="true">
          <div
            role="button"
            aria-label="Product image. Drag to move, use the corner handles to resize."
            aria-pressed={selected}
            className={`pointer-events-auto absolute select-none ${selected || dragging ? "" : "hover:outline hover:outline-1 hover:outline-[#CC9366]/60"}`}
            style={{
              left: `${display.x}%`,
              top: `${display.y}%`,
              width: `${display.w}%`,
              height: `${display.h}%`,
              cursor: "move",
              touchAction: "none",
              outline: selected ? `2px solid ${BRONZE}` : undefined,
            }}
            onPointerDown={(event) => beginDrag(event, "move")}
            {...dragHandlers}
          >
            {selected
              ? corners.map(({ corner, style: cornerStyle, cursor }) => (
                <div
                  key={corner}
                  aria-hidden="true"
                  className="absolute bg-white"
                  style={{
                    ...cornerStyle,
                    width: "calc(22 * var(--u))",
                    height: "calc(22 * var(--u))",
                    border: `2px solid ${BRONZE}`,
                    transform: "translate(-50%, -50%)",
                    cursor,
                    touchAction: "none",
                  }}
                  onPointerDown={(event) => beginDrag(event, corner)}
                  {...dragHandlers}
                />
              ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
