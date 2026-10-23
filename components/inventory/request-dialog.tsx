'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Native modal keeps focus inside, restores the opener and supports Escape. */
export function RequestDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!openerRef.current && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({preventScroll:true});
      // Wait for the removed modal's inert state to clear before restoring focus.
      requestAnimationFrame(() => { if (!document.querySelector('dialog[open]') && opener?.isConnected) opener.focus({preventScroll:true}); });
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[95dvh] w-full max-w-none overflow-y-auto rounded-t-xl border border-zinc-200 bg-white p-0 text-zinc-950 shadow-xl backdrop:bg-zinc-950/40 sm:inset-0 sm:m-auto sm:max-w-lg sm:rounded-xl">
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white p-4"><h2 id={id} className="min-w-0 break-words text-lg font-semibold">{title}</h2><button type="button" disabled={busy} onClick={onClose} className="min-h-11 min-w-11 shrink-0 rounded-md border border-zinc-300 px-3 text-sm font-semibold disabled:opacity-50">Close</button></header>
    <div className="min-w-0 p-4">{children}</div>
  </dialog>;
}
