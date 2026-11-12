"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const optionPanelTabs = { items: "Items", applies: "Applies to", settings: "Settings", subgroups: "Subgroups" } as const;
export type OptionPanelTab = keyof typeof optionPanelTabs;

/** Keep the existing crop viewer in the modal's top layer without moving its owner/state. */
export function OptionPanelCropLayer({ children }: { children: ReactNode }) {
  const host = typeof document === "undefined" ? null : document.querySelector("dialog[data-option-panel][open]");
  return host ? createPortal(<div data-option-inner-overlay>{children}</div>, host) : children;
}

export function OptionGroupPanel({ title, summary, tab, onTabChange, onClose, tabs }: {
  title: string; summary: string; tab: OptionPanelTab | null; onTabChange: (tab: OptionPanelTab) => void;
  onClose: () => void; tabs: Record<OptionPanelTab, ReactNode>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const innerEscape = useRef(false);
  const id = useId();
  const open = tab !== null;
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scroll = element.closest<HTMLElement>("[data-smart-review-scroll]");
    const top = scroll?.scrollTop ?? 0;
    const overflow = scroll?.style.overflowY ?? "";
    if (scroll) scroll.style.overflowY = "hidden";
    const captureEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") innerEscape.current = !!element.querySelector('[role="dialog"], [data-option-inner-overlay]');
    };
    element.addEventListener("keydown", captureEscape, true);
    element.showModal();
    element.querySelector<HTMLElement>("[data-panel-close]")?.focus({ preventScroll: true });
    return () => {
      element.close();
      element.removeEventListener("keydown", captureEscape, true);
      if (scroll) { scroll.style.overflowY = overflow; scroll.scrollTop = top; }
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    };
  }, [open]);
  return <dialog ref={dialog} data-option-panel aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`}
    onCancel={(event) => { event.preventDefault(); if (!innerEscape.current) onClose(); innerEscape.current = false; }}
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-white p-0 shadow-xl backdrop:bg-zinc-950/40 sm:w-[min(64rem,95vw)]">
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b p-4"><div><h2 id={`${id}-title`} className="font-semibold">{title}</h2><p id={`${id}-summary`} className="mt-1 text-xs text-zinc-600">{summary}</p></div><button type="button" data-panel-close aria-label="Close group editor" onClick={onClose} className="rounded border px-3 py-1">×</button></header>
      <div role="tablist" aria-label="Group editor" className="flex shrink-0 overflow-x-auto border-b">
        {Object.entries(optionPanelTabs).map(([key, label]) => <button key={key} type="button" role="tab" id={`${id}-${key}-tab`} aria-controls={`${id}-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
          onClick={() => onTabChange(key as OptionPanelTab)} onKeyDown={(event) => {
            const keys = Object.keys(optionPanelTabs) as OptionPanelTab[];
            const index = keys.indexOf(key as OptionPanelTab);
            const next = event.key === "ArrowRight" ? keys[(index + 1) % keys.length] : event.key === "ArrowLeft" ? keys[(index + keys.length - 1) % keys.length] : event.key === "Home" ? keys[0] : event.key === "End" ? keys[keys.length - 1] : null;
            if (next) { event.preventDefault(); onTabChange(next); document.getElementById(`${id}-${next}-tab`)?.focus(); }
          }} className={`min-h-11 whitespace-nowrap px-4 text-sm ${tab === key ? "border-b-2 border-emerald-800 font-semibold" : ""}`}>{label}</button>)}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">{Object.keys(optionPanelTabs).map((key) => <div key={key} role="tabpanel" id={`${id}-${key}`} aria-labelledby={`${id}-${key}-tab`} hidden={tab !== key}>{tabs[key as OptionPanelTab]}</div>)}</div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t p-4"><p className="text-xs text-zinc-600">Changes are kept in this review. Use Apply to Product Template to continue.</p><button type="button" onClick={onClose} className="rounded bg-emerald-900 px-4 py-2 text-sm font-semibold text-white">Done</button></footer>
    </div>
  </dialog>;
}
