"use client";

import { type MouseEvent, type ReactNode, useRef, useState } from "react";

export function MobileBuilderHeader({
  children,
  finalTotal,
  quotationNo,
}: {
  children: ReactNode;
  finalTotal: string;
  quotationNo: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="xl:hidden">
      {!isExpanded ? (
        <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5 xl:hidden">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-950">{quotationNo}</p>
            <p className="truncate text-xs font-semibold text-emerald-950">{finalTotal}</p>
          </div>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-controls="mobile-builder-expanded-controls"
            aria-expanded={false}
            className="flex h-10 shrink-0 items-center gap-1.5 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700"
          >
            Show controls
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-3.5 w-3.5 fill-none stroke-current"
              strokeWidth="2"
            >
              <path d="m5 7.5 5 5 5-5" />
            </svg>
          </button>
        </div>
      ) : null}
      <div
        id="mobile-builder-expanded-controls"
        aria-hidden={!isExpanded}
        className={isExpanded ? undefined : "hidden"}
      >
        <div className="flex justify-end px-3 pt-2.5">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            aria-controls="mobile-builder-expanded-controls"
            aria-expanded
            className="flex h-10 items-center gap-1.5 border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700"
          >
            Hide controls
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-3.5 w-3.5 fill-none stroke-current"
              strokeWidth="2"
            >
              <path d="m5 12.5 5-5 5 5" />
            </svg>
          </button>
        </div>
        {children}
        <div className="px-3 pb-2.5">
          <div className="min-w-0 border border-emerald-900 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950">
            <span className="mr-1">Final Total:</span>
            <span className="break-words">{finalTotal}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileBuilderMoreMenu({ children }: { children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function closeAfterAction(event: MouseEvent<HTMLDetailsElement>) {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      (!target.closest("[data-mobile-more-close]") && !target.closest('button[type="submit"]'))
    ) return;
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <details ref={detailsRef} onClickCapture={closeAfterAction} className="relative shrink-0">
      {children}
    </details>
  );
}
