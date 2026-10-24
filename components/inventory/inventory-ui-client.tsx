"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { buttonClass, focusRing } from "./inventory-ui";

/**
 * Horizontally scrolling tab row. Fades show when more tabs are hidden, and the current tab
 * ([aria-current]) is scrolled into view.
 */
export function ScrollTabs({ label, children, className = "", currentKey }: { label: string; children: ReactNode; className?: string; currentKey?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const update = () => setEdges({ left: nav.scrollLeft > 4, right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4 });
    const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) {
      const box = nav.getBoundingClientRect(), tab = current.getBoundingClientRect();
      if (tab.right > box.right) nav.scrollLeft += tab.right - box.right + 24;
      else if (tab.left < box.left) nav.scrollLeft -= box.left - tab.left + 24;
    }
    update();
    nav.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { nav.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [currentKey]);
  return <div className={`relative min-w-0 ${className}`}>
    <nav ref={ref} aria-label={label} className="flex min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</nav>
    <span aria-hidden="true" data-fade="left" className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent transition-opacity motion-reduce:transition-none ${edges.left ? "opacity-100" : "opacity-0"}`} />
    <span aria-hidden="true" data-fade="right" className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent transition-opacity motion-reduce:transition-none ${edges.right ? "opacity-100" : "opacity-0"}`} />
  </div>;
}

export type MoreMenuItem = { href: string; label: string; icon?: ReactNode };
/** Three-dot menu. Items stay in the page (hidden while closed) so they remain reachable by search and tests. */
export function MoreMenu({ items, label = "More", defaultOpen = false }: { items: MoreMenuItem[]; label?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  if (!items.length) return null;
  return <div ref={root} className="relative shrink-0">
    <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(value => !value)} className={`${buttonClass.secondary} min-w-11 px-3`}><MoreHorizontal size={20} aria-hidden="true" /></button>
    <div role="menu" aria-label={label} hidden={!open} className="absolute right-0 z-30 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
      {items.map(item => <Link key={item.href} role="menuitem" href={item.href} onClick={() => setOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100 ${focusRing}`}>{item.icon}{item.label}</Link>)}
    </div>
  </div>;
}

/** Error state with a retry button. */
export function ErrorState({ title, text, onRetry, children }: { title: string; text: string; onRetry?: () => void; children?: ReactNode }) {
  return <section role="alert" data-error-state className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
    <p className="mt-2 text-sm text-zinc-600">{text}</p>
    <div className="mt-4 flex flex-wrap gap-2">{onRetry ? <button type="button" onClick={onRetry} className={buttonClass.primary}>Try again</button> : null}{children}</div>
  </section>;
}
