"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AmountModeToggle } from "@/components/insights/amount-mode-toggle";
import { DateRangeSelector } from "@/components/insights/date-range-selector";
import { TeamMemberSkeleton } from "@/components/insights/team-member-states";
import { memberInitials } from "@/lib/insights/team-member-dialog";

const dialogStyles = `
@keyframes team-member-dialog-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
dialog[data-team-member-dialog][open] { animation: team-member-dialog-in 0.18s ease-out; }
@media (prefers-reduced-motion: reduce) { dialog[data-team-member-dialog][open] { animation: none; } }
`;

export function TeamMemberDialog({
  name,
  roleLabel,
  position,
  rangeLabel,
  range,
  customFrom,
  customTo,
  closeHref,
  prevHref,
  nextHref,
  children,
}: {
  name: string;
  roleLabel: string;
  position: string | null;
  rangeLabel: string;
  range: string;
  customFrom?: string;
  customTo?: string;
  closeHref: string;
  prevHref: string | null;
  nextHref: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [navPending, startNav] = useTransition();
  const [rangePending, setRangePending] = useState(false);
  const pending = navPending || rangePending;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Lock the page and any scroll container the app shell puts around it.
    const locked: Array<[HTMLElement, string]> = [];
    for (let node: HTMLElement | null = element.parentElement; node; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if (node === document.body || node === document.documentElement || overflowY === "auto" || overflowY === "scroll") {
        locked.push([node, node.style.overflow]);
        node.style.overflow = "hidden";
      }
    }
    element.showModal();
    element.querySelector<HTMLElement>("[data-panel-close]")?.focus({ preventScroll: true });
    return () => {
      element.close();
      for (const [node, overflow] of locked) node.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  function go(href: string | null) {
    if (!href) return;
    startNav(() => router.replace(href, { scroll: false }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, select, textarea, [contenteditable=true]")) return;
    if (event.key === "ArrowLeft" && prevHref) { event.preventDefault(); go(prevHref); }
    if (event.key === "ArrowRight" && nextHref) { event.preventDefault(); go(nextHref); }
  }

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) go(closeHref);
  }

  const navButton = "flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 outline-none transition hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <dialog
      ref={dialog}
      data-team-member-dialog
      aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); go(closeHref); }}
      onKeyDown={onKeyDown}
      onClick={onBackdropClick}
      className="fixed inset-0 m-auto h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-white p-0 shadow-xl backdrop:bg-zinc-950/40 sm:h-auto sm:max-h-[90dvh] sm:w-[min(64rem,95vw)] sm:rounded-xl"
    >
      <style>{dialogStyles}</style>
      <div className="flex h-full max-h-[inherit] min-w-0 flex-col">
        <header className="shrink-0 border-b border-zinc-100 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-900 text-sm font-semibold text-white ring-2 ring-emerald-100 ring-offset-2">
                {memberInitials(name)}
              </span>
              <div className="min-w-0">
                <h2 id={`${id}-title`} className="truncate text-sm font-semibold text-zinc-950">{name}</h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">{roleLabel}</span>
                  <span className="text-xs text-zinc-400">Sales Activity Profile</span>
                  {position ? <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{position}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" aria-label="Previous member" disabled={!prevHref} onClick={() => go(prevHref)} className={navButton}>‹</button>
              <button type="button" aria-label="Next member" disabled={!nextHref} onClick={() => go(nextHref)} className={navButton}>›</button>
              <button type="button" data-panel-close aria-label="Close" onClick={() => go(closeHref)} className={navButton}>×</button>
            </div>
          </div>
          <div className="mt-3 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-xs text-zinc-500">
              Showing <span className="font-semibold text-zinc-700">{rangeLabel.toLowerCase()}</span>
              {" "}vs. prior equivalent period
            </p>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <AmountModeToggle preserveScroll />
              <DateRangeSelector
                current={range}
                customFrom={customFrom}
                customTo={customTo}
                onPendingChange={setRangePending}
                preserveScroll
              />
            </div>
          </div>
        </header>
        <div aria-busy={pending} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-emerald-50/30 p-4 sm:p-5">
          {pending ? <TeamMemberSkeleton /> : children}
        </div>
      </div>
    </dialog>
  );
}
