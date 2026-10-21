"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { MaterialDialogButton } from "@/components/products/material-library-dialogs";

type FormAction = (formData: FormData) => void | Promise<void>;

export type ViewerSwatch = {
  code: string;
  grade: string;
  id: string;
  isActive: boolean;
  name: string;
  needsReview: boolean;
  record: NonNullable<ComponentProps<typeof MaterialDialogButton>["material"]>;
  url: string | null;
};

const WIDE_SCREEN = 1024;
const MIN_WIDTH = 380;
const WIDTH_KEY = "material-swatch-viewer-width";
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

// Big swatch viewer: docked on the right (screens >= 1024 px) or a full-screen overlay (smaller). Uses the signed URL already loaded for
// the swatch; nothing is fetched or signed here.
export function SwatchViewerPanel({
  brandId,
  brandName,
  confirmAction,
  deactivateAction,
  editMode = false,
  groups,
  items,
  onClose,
  onLayout,
  onSelect,
  returnTo,
  selectedId,
  subgroupLabels,
  subgroupOptions,
}: {
  brandId: string;
  brandName: string;
  confirmAction: FormAction;
  deactivateAction: FormAction;
  editMode?: boolean;
  groups: Array<{ group_name: string; id: string }>;
  items: ViewerSwatch[];
  onClose: () => void;
  onLayout: (paddingRight: number) => void;
  onSelect: (id: string) => void;
  returnTo: string;
  selectedId: string;
  subgroupLabels: Record<string, string>;
  subgroupOptions: Array<{ id: string; label: string }>;
}) {
  const [zoom, setZoom] = useState(1);
  // About 45% of the screen by default (min 380 px, max 75%); a divider on the left edge resizes it and the width is remembered.
  const [width, setWidth] = useState(() => {
    let stored = 0;
    try {
      stored = Number(window.localStorage.getItem(WIDTH_KEY)) || 0;
    } catch {
      stored = 0;
    }
    return clamp(stored || window.innerWidth * 0.45, MIN_WIDTH, window.innerWidth * 0.75);
  });
  const resizing = useRef(false);
  // Where the selected swatch was in the list: if it disappears (deactivated), the next one in that place is shown.
  const [fallbackIndex, setFallbackIndex] = useState(() => Math.max(0, items.findIndex((item) => item.id === selectedId)));
  const [wide, setWide] = useState(() => window.innerWidth >= WIDE_SCREEN);
  const scroller = useRef<HTMLDivElement>(null);
  const pan = useRef<{ left: number; moved: number; top: number; x: number; y: number } | null>(null);

  const found = items.findIndex((item) => item.id === selectedId);
  const index = found >= 0 ? found : Math.min(fallbackIndex, items.length - 1);
  const current = items[index] ?? null;

  const go = (next: number) => {
    const target = items[next];
    if (!target) return;
    setFallbackIndex(next);
    setZoom(1);
    onSelect(target.id);
  };

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${WIDE_SCREEN}px)`);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // The page keeps room for the docked panel; nothing is reserved in the full-screen overlay.
  useEffect(() => {
    onLayout(wide ? width : 0);
    return () => onLayout(0);
  }, [onLayout, wide, width]);

  // Nothing left to show (the last swatch was deactivated or filtered out): close.
  useEffect(() => {
    if (!current) onClose();
  }, [current, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector(".fixed.inset-0:not([data-swatch-viewer])")) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key === "ArrowRight") go(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!current) return null;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = scroller.current;
    if (!box) return;
    box.setPointerCapture(event.pointerId);
    pan.current = { left: box.scrollLeft, moved: 0, top: box.scrollTop, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = pan.current;
    const box = scroller.current;
    if (!state || !box) return;
    state.moved = Math.max(state.moved, Math.abs(event.clientX - state.x), Math.abs(event.clientY - state.y));
    if (zoom > 1) {
      box.scrollLeft = state.left - (event.clientX - state.x);
      box.scrollTop = state.top - (event.clientY - state.y);
    }
  };
  const onPointerUp = () => {
    // A click (no drag) cycles 1x, 2x, 3x and back to 1x.
    if (pan.current && pan.current.moved < 5) setZoom((value) => (value >= 3 ? 1 : value + 1));
    pan.current = null;
  };

  const onDividerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizing.current = true;
  };
  const onDividerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizing.current) setWidth(clamp(window.innerWidth - event.clientX, MIN_WIDTH, window.innerWidth * 0.75));
  };
  const onDividerUp = () => {
    if (!resizing.current) return;
    resizing.current = false;
    try {
      window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch {
      // Storage blocked: the width is simply not remembered.
    }
  };

  const label = [current.code, current.name].filter(Boolean).join(" | ");
  const subgroup = current.record.subgroup_id ? subgroupLabels[current.record.subgroup_id] : "";
  const iconButton = "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40";

  return createPortal(
    <aside
      data-swatch-viewer
      aria-label="Swatch viewer"
      className={wide ? "fixed bottom-0 right-0 top-0 z-[55] flex flex-col border-l border-zinc-200 bg-white shadow-2xl" : "fixed inset-0 z-[55] flex flex-col bg-white"}
      style={wide ? { width } : undefined}
    >
      {wide ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize viewer"
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onPointerCancel={onDividerUp}
          className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-emerald-600/30"
        />
      ) : null}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <button type="button" aria-label="Previous swatch" disabled={index <= 0} onClick={() => go(index - 1)} className={iconButton}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
        <span className="text-sm text-zinc-500">{index + 1} / {items.length}</span>
        <button type="button" aria-label="Next swatch" disabled={index >= items.length - 1} onClick={() => go(index + 1)} className={iconButton}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        <button type="button" aria-label="Close viewer" onClick={onClose} className={`${iconButton} ml-auto`}><X aria-hidden="true" className="h-4 w-4" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-2 flex items-center gap-1.5" role="group" aria-label="Zoom">
          {[1, 2, 3].map((level) => (
            <button key={level} type="button" aria-pressed={zoom === level} onClick={() => setZoom(level)} className={`h-8 rounded-lg border px-3 text-sm font-semibold ${zoom === level ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}>{level}x</button>
          ))}
          <span className="ml-auto text-xs text-zinc-400">Click the picture to zoom, drag to look around</span>
        </div>
        <div
          key={current.id}
          ref={scroller}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { pan.current = null; }}
          className={`relative mx-auto max-h-[70vh] w-full touch-none select-none overflow-auto rounded-2xl border border-zinc-200 bg-zinc-100 ${zoom >= 3 ? "cursor-zoom-out" : "cursor-zoom-in"}`}
        >
          {current.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.url}
              alt={label}
              draggable={false}
              className="block max-w-none"
              // 1x fits the whole picture (object-contain, no cropping); 2x and 3x enlarge the same file.
              style={zoom === 1 ? { height: "auto", maxHeight: "70vh", objectFit: "contain", width: "100%" } : { height: "auto", width: `${zoom * 100}%` }}
            />
          ) : (
            <span className="flex aspect-square w-full items-center justify-center text-2xl font-semibold text-zinc-400">{current.code.slice(0, 6) || "No image"}</span>
          )}
        </div>

        <div className="mt-4 grid gap-1">
          <p className="text-xl font-bold text-zinc-950">{label || "Untitled swatch"}</p>
          {current.grade ? <p className="text-sm text-zinc-600">Grade: {current.grade}</p> : null}
          <p className="text-sm text-zinc-600">Sub-group: {subgroup || "No sub-group"}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${current.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-zinc-100 text-zinc-600"}`}>{current.isActive ? "Active" : "Inactive"}</span>
            {current.needsReview ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Needs review</span> : null}
          </div>
        </div>

        {editMode ? <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          {current.needsReview ? (
            <form action={confirmAction}>
              <input type="hidden" name="id" value={current.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <button type="submit" className="h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 font-semibold text-amber-900 hover:bg-amber-100">Confirm</button>
            </form>
          ) : null}
          <MaterialDialogButton brandId={brandId} brandName={brandName} groups={groups} material={current.record} returnTo={returnTo} subgroups={subgroupOptions} title={`Edit Material - ${current.name}`} triggerClassName="h-9 rounded-lg border border-zinc-200 bg-white px-3 font-semibold text-emerald-900 hover:bg-zinc-50" triggerLabel="Edit" />
          {current.isActive ? (
            <form action={deactivateAction}>
              <input type="hidden" name="id" value={current.id} />
              <input type="hidden" name="return_to" value={returnTo} />
              <ConfirmSubmitButton message="Deactivate this material? It stays stored and can be shown again with inactive records." className="h-9 rounded-lg border border-red-200 bg-white px-3 font-semibold text-red-700 hover:bg-red-50">Deactivate</ConfirmSubmitButton>
            </form>
          ) : null}
        </div> : null}
      </div>
    </aside>,
    document.body,
  );
}
