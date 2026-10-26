"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteProductPermanently, getProductDeleteSummary } from "@/lib/inventory/actions";
import { canManageInventory } from "@/lib/inventory/access";
import { deleteConfirmationMatches, deletedProductHref, type ProductDeleteSummary } from "@/lib/inventory/delete-product";
import type { InventoryProduct, InventoryProductDetail } from "@/lib/inventory/types";
import { RequestDialog } from "./request-dialog";
import { buttonClass, fieldClass } from "./inventory-ui";
import { saveFailureMessage } from "@/lib/inventory/save-errors";

export function DeleteItemButton({product,role,preview=false}: {product:InventoryProduct;role:string|null;preview?:boolean}) {
 const [open,setOpen]=useState(false);
 if(!canManageInventory(role)) return null;
 return <div className="basis-full border-t border-red-100 pt-3"><button type="button" className={buttonClass.danger} onClick={()=>setOpen(true)}><Trash2 size={16} aria-hidden="true" />Delete item</button>
  {open && <DeleteItemDialog product={product} preview={preview} onClose={()=>setOpen(false)} />}
 </div>;
}
export function DeleteItemDialog({product,preview=false,onClose}: {product:InventoryProduct;preview?:boolean;onClose:()=>void}) {
 const detail=product as Partial<InventoryProductDetail>;
 const [summary,setSummary]=useState<ProductDeleteSummary|null>(preview ? {stock_ref:product.stock_ref,photos:detail.images?.length ?? 0,movements:detail.recent_movements?.length ?? 0,reservations:detail.reservations?.length ?? 0} : null);
 const [typed,setTyped]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(!preview),[error,setError]=useState(""),[retry,setRetry]=useState(0),[done,setDone]=useState(false);
 const lock=useRef(false),router=useRouter();
 useEffect(()=>{
  if(preview) return;
  let cancelled=false;
  getProductDeleteSummary({productId:product.id}).then(result=>{
   if(cancelled) return;
   if(result.ok) setSummary(result.summary);else setError(result.error);
   setLoading(false);
  }).catch(()=>{if(!cancelled) {setError("Could not load the deletion details. Please try again.");setLoading(false);}});
  return ()=>{cancelled=true;};
 },[product.id,preview,retry]);
 const enabled=!!summary && deleteConfirmationMatches(typed,summary.stock_ref) && !loading && !busy && !done;
 return <RequestDialog title="Delete item" busy={busy} onClose={onClose}><form className="min-w-0 space-y-4" onSubmit={async event=>{
  event.preventDefault();if(lock.current || !enabled || !summary) return;
  if(preview) {setDone(true);return;}
  lock.current=true;setBusy(true);setError("");
  try {
   const result=await deleteProductPermanently({productId:product.id,stockRef:typed});
   if(!result.ok) {setError(result.error);return;}
   router.push(deletedProductHref(result.failedPhotoCount));
  } catch(failure) {setError(saveFailureMessage(failure));}
  finally {lock.current=false;setBusy(false);}
 }}>
  <p className="break-words font-semibold text-zinc-950">{product.item_name}</p>
  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-950">This permanently deletes the item, its photos and its stock history. This cannot be undone.</p>
  {loading && <p role="status" className="text-sm text-zinc-600">Loading deletion details...</p>}
  {summary && <><dl className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-3 text-sm"><div><dt className="text-zinc-600">Photos</dt><dd className="font-semibold">{summary.photos}</dd></div><div><dt className="text-zinc-600">Movements</dt><dd className="font-semibold">{summary.movements}</dd></div><div><dt className="text-zinc-600">Holds/bookings</dt><dd className="font-semibold">{summary.reservations}</dd></div></dl>
   <p className="text-sm text-zinc-700 [overflow-wrap:anywhere]">Stock ref: <strong>{summary.stock_ref}</strong></p>
   <label className="block text-sm font-medium text-zinc-800">Type the Stock ref to confirm<input value={typed} disabled={busy || done} onChange={event=>setTyped(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} className={fieldClass} /></label>
  </>}
  {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {!summary && !loading && <button type="button" className={buttonClass.secondary} onClick={()=>{setError("");setLoading(true);setRetry(value=>value+1);}}>Retry details</button>}
  {done && <p role="status" className="text-sm text-emerald-900">Preview only. Nothing was deleted.</p>}
  <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={buttonClass.secondary} onClick={onClose}>Keep item</button><button type="submit" disabled={!enabled} className={buttonClass.danger}>{busy ? "Deleting..." : "Delete item"}</button></div>
 </form></RequestDialog>;
}
