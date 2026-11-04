"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deletePreviousSupplierSource, deleteSupplierSourceDefinition, leaveSupplierReview } from "@/app/products/price-updates/supplier-sources/actions";
import {
  cleanupSummary, deleteDefinitionDialog, deletedDefinitionMessage, deletedListMessage, deleteListDialog, leaveReviewDialog, leftReviewMessage,
  type CleanupOldList, type CleanupStaleReview, type CleanupUnusedDefinition, type SupplierCleanup,
} from "@/lib/products/supplier-cleanup";

const card = "rounded-lg border border-zinc-200 bg-white shadow-sm";
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const smallButton = `inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 ${focusRing}`;
const dangerButton = `inline-flex h-8 items-center justify-center rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-900 transition hover:bg-red-50 disabled:opacity-50 ${focusRing}`;

const confirmButton = `inline-flex h-8 items-center justify-center rounded-md bg-red-800 px-3 text-xs font-semibold text-white transition hover:bg-red-900 disabled:opacity-50 ${focusRing}`;

type Pending =
  | { kind: "list"; item: CleanupOldList }
  | { kind: "review"; item: CleanupStaleReview }
  | { kind: "definition"; item: CleanupUnusedDefinition };

const dialogText = (pending: Pending) => pending.kind === "list" ? deleteListDialog(pending.item) : pending.kind === "review" ? leaveReviewDialog(pending.item) : deleteDefinitionDialog(pending.item);
const confirmLabel = (pending: Pending) => pending.kind === "list" ? "Delete price list" : pending.kind === "review" ? "Leave review" : "Delete definition";

/**
 * The Clean up tab. Everything is a preview: nothing is removed until someone confirms in the dialog, and the database checks every rule again.
 * Delete needs the System Owner; Leave review and deleting an unused definition need a Brand price approver (as elsewhere on this screen).
 */
export function SupplierCleanupPanel({ brandId, brandName, cleanup, canDeleteLists, canLeaveReviews, canDeleteDefinitions }: {
  brandId: string; brandName: string; cleanup: SupplierCleanup; canDeleteLists: boolean; canLeaveReviews: boolean; canDeleteDefinitions: boolean;
}) {
  const router = useRouter(), titleId = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const ask = (next: Pending) => { setError(""); setPending(next); dialog.current?.showModal(); };
  const close = () => { dialog.current?.close(); setPending(null); };
  async function confirm() {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      if (pending.kind === "list") {
        if (!pending.item.currentSourceId) throw Error("This price list cannot be checked here.");
        const result = await deletePreviousSupplierSource(pending.item.currentSourceId, pending.item.id);
        setMessage(deletedListMessage(result.deleted));
      } else if (pending.kind === "review") { await leaveSupplierReview(pending.item.batchId, true); setMessage(leftReviewMessage); }
      else { await deleteSupplierSourceDefinition(brandId, pending.item.id); setMessage(deletedDefinitionMessage(pending.item.name)); }
      close(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not clean up. Nothing was changed."); }
    finally { setBusy(false); }
  }
  const text = pending ? dialogText(pending) : null;
  const removableLists = cleanup.oldLists.filter((item) => item.removable);

  return <section className="space-y-4" aria-label="Clean up">
    <div className={`${card} p-4`}>
      <h3 className="text-base font-semibold text-zinc-950">Clean up {brandName}</h3>
      <p className="mt-1 text-sm text-zinc-700" data-testid="cleanup-summary">{cleanupSummary(cleanup)}</p>
      <p className="mt-1 text-xs text-zinc-500">This is a preview. Nothing is removed until you confirm. Prices already applied and Product history are never changed.</p>
      {!canDeleteLists ? <p className="mt-2 text-xs text-zinc-600">Only the System Owner can delete old price lists. You can see what is there.</p> : null}
    </div>
    <p role="status" aria-live="polite" className={message ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950" : "sr-only"}>{message}</p>

    <section className={`${card} p-4`} aria-label="Old price lists">
      <h4 className="text-sm font-semibold text-zinc-950">Old price lists</h4>
      <p className="text-xs text-zinc-500">{removableLists.length ? `${removableLists.length} can be deleted.` : "None can be deleted."}</p>
      {cleanup.oldLists.length ? <ul className="mt-2 divide-y divide-zinc-100">{cleanup.oldLists.map((item) => <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2"><span className="font-semibold text-zinc-950">{item.title}</span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${item.removable ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>{item.removable ? "Can be deleted" : "Protected"}</span></p>
          <p className="break-words text-xs text-zinc-600">{item.filename} · imported {item.importedOn} · {item.lines.toLocaleString("en-US")} {item.lines === 1 ? "line" : "lines"}{item.archived ? " · archived" : ""}</p>
          <p className={`text-xs ${item.removable ? "text-emerald-900" : "text-amber-900"}`}>{item.reason}</p>
        </div>
        {item.removable && canDeleteLists ? <button type="button" className={`${dangerButton} shrink-0`} onClick={() => ask({ kind: "list", item })}>Delete…</button> : null}
      </li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">No old price lists.</p>}
    </section>

    <section className={`${card} p-4`} aria-label="Stale reviews">
      <h4 className="text-sm font-semibold text-zinc-950">Stale reviews</h4>
      <p className="text-xs text-zinc-500">Open reviews on price lists that are not the current one. The current list&apos;s review is never listed here.</p>
      {cleanup.staleReviews.length ? <ul className="mt-2 divide-y divide-zinc-100">{cleanup.staleReviews.map((item) => <li key={item.batchId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="font-semibold text-zinc-950">{item.title}</p><p className="break-words text-xs text-zinc-600">{item.filename} · {item.statusLabel.toLowerCase()} review</p></div>
        {canLeaveReviews ? <button type="button" className={`${smallButton} shrink-0`} onClick={() => ask({ kind: "review", item })}>Leave review…</button> : null}
      </li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">No stale reviews.</p>}
    </section>

    <section className={`${card} p-4`} aria-label="Unused definitions">
      <h4 className="text-sm font-semibold text-zinc-950">Unused definitions</h4>
      <p className="text-xs text-zinc-500">Supplier source definitions with no price list and no products.</p>
      {cleanup.unusedDefinitions.length ? <ul className="mt-2 divide-y divide-zinc-100">{cleanup.unusedDefinitions.map((item) => <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="font-semibold text-zinc-950">{item.name}</p><p className="text-xs text-zinc-600">Unused: no price list and no products.</p></div>
        {canDeleteDefinitions ? <button type="button" className={`${dangerButton} shrink-0`} onClick={() => ask({ kind: "definition", item })}>Delete…</button> : null}
      </li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">No unused definitions.</p>}
    </section>

    <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-6 text-sm shadow-xl backdrop:bg-black/30"
      onCancel={(event) => { if (busy) event.preventDefault(); else setPending(null); }}>
      {text ? <>
        <h3 id={titleId} className="font-semibold text-zinc-950">{text.title}</h3>
        <p className="mt-3 font-semibold text-zinc-900">This will remove:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-700">{text.removes.map((line) => <li key={line}>{line}</li>)}</ul>
        <p className="mt-3 font-semibold text-zinc-900">This is kept:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-700">{text.keeps.map((line) => <li key={line}>{line}</li>)}</ul>
        <p className="mt-3 text-xs text-zinc-500">This cannot be undone.</p>
        {error ? <p role="alert" className="mt-3 text-red-800">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} className={smallButton} onClick={close}>Cancel</button>
          <button type="button" disabled={busy} className={confirmButton} onClick={() => void confirm()}>{busy ? "Working…" : pending ? confirmLabel(pending) : ""}</button>
        </div>
      </> : null}
    </dialog>
  </section>;
}
