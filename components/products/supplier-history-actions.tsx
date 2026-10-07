"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { leaveSupplierReview, permanentlyDeleteSupplierSource, unarchiveSupplierSource } from "@/app/products/price-updates/supplier-sources/actions";
import { SupplierArchiveButton } from "./supplier-price-workspace-controls";

/** Flip above bottom rows and clamp inside the viewport without altering the table layout. */
export function historyMenuPosition(anchor: { right: number; top: number; bottom: number }, menu: { width: number; height: number }, viewport: { width: number; height: number }) {
  const padding = 8, gap = 4;
  const below = anchor.bottom + gap;
  return {
    left: Math.max(padding, Math.min(anchor.right - menu.width, viewport.width - menu.width - padding)),
    top: Math.max(padding, Math.min(below + menu.height <= viewport.height - padding ? below : anchor.top - menu.height - gap, viewport.height - menu.height - padding)),
  };
}

export function SupplierHistoryActions({ sourceId, title, viewHref, downloadUrl, archived, canArchive, canUnarchive, canPermanentlyDelete, deleteBlockedReason }: {
  sourceId: string; title: string; viewHref: string; downloadUrl?: string; archived: boolean; canArchive: boolean; canUnarchive: boolean; canPermanentlyDelete: boolean; deleteBlockedReason?: string;
}) {
  const id = useId(), router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [retryCleanup, setRetryCleanup] = useState(false);
  function position() {
    if (!trigger.current || !panel.current) return;
    const point = historyMenuPosition(trigger.current.getBoundingClientRect(), panel.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
    panel.current.style.left = `${point.left}px`; panel.current.style.top = `${point.top}px`;
  }
  // Re-clamp when a destructive-action warning or retry label changes the panel's size.
  useLayoutEffect(() => { if (panel.current?.matches(":popover-open")) position(); });
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.type === "scroll" && event.target instanceof Node && panel.current?.contains(event.target)) return;
      panel.current?.hidePopover();
    };
    window.addEventListener("resize", close); document.addEventListener("scroll", close, { capture: true, passive: true });
    return () => { window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true); };
  }, [open]);
  async function remove() {
    if (!retryCleanup && !window.confirm("Permanently delete this archived Supplier price list?\nThis cannot be undone.")) return;
    setBusy(true); setMessage("");
    try {
      const result = await permanentlyDeleteSupplierSource(sourceId, true);
      if (result.warning) { setMessage(result.warning); setRetryCleanup(true); }
      else { panel.current?.hidePopover(); router.refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not permanently delete."); }
    finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setMessage("");
    try { await unarchiveSupplierSource(sourceId); panel.current?.hidePopover(); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not unarchive this price list."); }
    finally { setBusy(false); }
  }
  const item = "block w-full rounded px-2 py-1 text-left text-zinc-700 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
  return <>
    <button ref={trigger} type="button" aria-label={`Actions for ${title}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
      onClick={() => {
        if (!panel.current) return;
        if (panel.current.matches(":popover-open")) panel.current.hidePopover();
        else { panel.current.showPopover(); position(); panel.current.querySelector<HTMLElement>("a,button")?.focus({ preventScroll: true }); }
      }}>⋯</button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`Price list actions for ${title}`}
      className="fixed z-[100] m-0 w-52 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto space-y-1 rounded-md border border-zinc-200 bg-white p-2 text-xs font-semibold shadow-lg"
      onToggle={(event) => setOpen(event.currentTarget.matches(":popover-open"))}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); panel.current?.hidePopover(); trigger.current?.focus(); }
      }}>
      <Link className={item} href={viewHref}>View</Link>
      {downloadUrl ? <a className={item} href={downloadUrl} target="_blank" rel="noopener noreferrer">Download</a> : null}
      {canArchive && !archived ? <div className="border-t border-zinc-100 pt-1"><SupplierArchiveButton sourceId={sourceId} title={title} /></div> : null}
      {canUnarchive && archived ? <button type="button" disabled={busy} className={item} onClick={() => void restore()}>Unarchive</button> : null}
      {canPermanentlyDelete && archived ? <button type="button" disabled={busy || Boolean(deleteBlockedReason)} title={deleteBlockedReason} className={`${item} border-t border-zinc-100 text-red-800 hover:bg-red-50 disabled:opacity-50`} onClick={() => void remove()}>
        {busy ? "Deleting…" : retryCleanup ? "Retry file cleanup" : "Permanently delete"}
      </button> : null}
      {canPermanentlyDelete && archived && deleteBlockedReason ? <p className="p-2 font-normal text-zinc-600">{deleteBlockedReason}</p> : null}
      {message ? <p role="alert" className="break-words p-2 font-normal text-red-800">{message}</p> : null}
    </div>
  </>;
}

/** An explicit two-button confirmation; leaving retains the review as history, not a rollback. */
export function SupplierLeaveReviewButton({ batchId }: { batchId: string }) {
  const dialog = useRef<HTMLDialogElement>(null), router = useRouter(), titleId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function leave() {
    setBusy(true); setError("");
    try { await leaveSupplierReview(batchId, true); dialog.current?.close(); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not leave this Supplier review."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100" onClick={() => { setError(""); dialog.current?.showModal(); }}>Leave review</button>
    <dialog ref={dialog} aria-labelledby={titleId} className="m-auto max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-sm shadow-xl backdrop:bg-black/30"
      onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <h3 id={titleId} className="font-semibold">Leave this Supplier review?</h3>
      <p className="mt-3">Unfinished review work will be abandoned.<br />Prices already applied or recorded in Product history will not be changed.</p>
      {error ? <p role="alert" className="mt-3 text-red-800">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" disabled={busy} className="rounded bg-amber-800 px-3 py-2 font-semibold text-white disabled:opacity-50" onClick={() => void leave()}>{busy ? "Leaving…" : "Leave review"}</button>
      </div>
    </dialog>
  </>;
}
