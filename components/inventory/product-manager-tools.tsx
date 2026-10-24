"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeftRight, Camera, Pencil, Trash2 } from "lucide-react";
import { removeProduct } from "@/lib/inventory/actions";
import { canUseProductTools, removalNotice, removeReasonError } from "@/lib/inventory/product-edit";
import type { InventoryProduct } from "@/lib/inventory/types";
import { RequestDialog } from "./request-dialog";
import { saveFailureMessage } from "@/lib/inventory/save-errors";

const toolStyle = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";

export function toolHref(product: Pick<InventoryProduct, "id">, tool: "edit" | "photos" | "move", role: string | null, preview: boolean) {
  if (tool === "move") return preview ? `/dev/inventory-preview?view=move&frame=1&role=${encodeURIComponent(role ?? "")}&id=${product.id}` : `/inventory/move?product=${product.id}`;
  return preview ? `/dev/inventory-preview?view=${tool}&frame=1&role=${encodeURIComponent(role ?? "")}&id=${product.id}` : `/inventory/products/${product.id}/${tool}`;
}

/** Edit item, Manage photos and Remove item. Renders nothing unless the role is a manager. */
export function ProductManagerTools({ product, role, preview = false, initialRemove = false }: { product: InventoryProduct; role: string | null; preview?: boolean; initialRemove?: boolean }) {
  const [open, setOpen] = useState(initialRemove);
  if (!canUseProductTools(role)) return null;
  return <>
    <Link href={toolHref(product, "move", role, preview)} className={toolStyle}><ArrowLeftRight size={16} aria-hidden="true" />Move stock</Link>
    <Link href={toolHref(product, "edit", role, preview)} className={toolStyle}><Pencil size={16} aria-hidden="true" />Edit item</Link>
    <Link href={toolHref(product, "photos", role, preview)} className={toolStyle}><Camera size={16} aria-hidden="true" />Manage photos</Link>
    <button type="button" className={`${toolStyle} border-red-200 text-red-800 hover:bg-red-50`} onClick={() => setOpen(true)}><Trash2 size={16} aria-hidden="true" />Remove item</button>
    {open && <RemoveItemDialog product={product} preview={preview} onClose={() => setOpen(false)} />}
  </>;
}

function RemoveItemDialog({ product, preview, onClose }: { product: InventoryProduct; preview: boolean; onClose: () => void }) {
  const router = useRouter(), lock = useRef(false);
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const notice = removalNotice(product);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (lock.current) return;
    const problem = removeReasonError(reason);
    if (problem) { setError(problem); return; }
    if (preview) { setDone(true); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await removeProduct({ productId: product.id, reason: reason.trim() });
      if (!result.ok) { setError(result.error); return; }
      router.push("/inventory/products");
    } catch (failure) { setError(saveFailureMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <RequestDialog title="Remove item" onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="min-w-0 space-y-4" aria-describedby={error ? "remove-error" : undefined}>
      <p className="break-words font-semibold">{product.item_name}</p>
      {notice.warnings.length > 0 && <div role="note" className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{notice.warnings.map(line => <p key={line}>{line}</p>)}</div>}
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">{notice.effects.map(line => <li key={line}>{line}</li>)}</ul>
      <label className="block text-sm font-medium text-zinc-800">Reason for removing *
        <textarea required name="reason" rows={3} maxLength={1000} value={reason} disabled={busy || done} onChange={event => { setReason(event.target.value); setError(""); }} className="mt-1 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base" />
      </label>
      {error && <p id="remove-error" role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {done && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Preview only. Nothing was removed.</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={onClose} className={toolStyle}>Keep item</button>
        <button type="submit" disabled={busy || done} className="inline-flex min-h-11 items-center justify-center rounded-md bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">{busy ? "Removing…" : "Remove item"}</button>
      </div>
    </form>
  </RequestDialog>;
}
