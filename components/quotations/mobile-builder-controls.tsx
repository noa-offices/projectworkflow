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

  if (!isExpanded) {
    return (
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
          className="flex h-10 shrink-0 items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700"
        >
          Show controls ▼
        </button>
      </div>
    );
  }

  return (
    <div className="xl:hidden">
      <div id="mobile-builder-expanded-controls">{children}</div>
      <div className="grid gap-2 px-3 pb-2.5">
        <div className="min-w-0 border border-emerald-900 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950">
          <span className="mr-1">Final Total:</span>
          <span className="break-words">{finalTotal}</span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          aria-controls="mobile-builder-expanded-controls"
          aria-expanded
          className="flex h-10 w-full items-center justify-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700"
        >
          Hide controls ▲
        </button>
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
