"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, ImageOff, ImagePlus, Star, Trash2 } from "lucide-react";
import { registerInventoryPhotos, removeProductPhoto, setMainProductPhoto } from "@/lib/inventory/actions";
import { photoSelectionError } from "@/lib/inventory/product-request-submission";
import { MAX_PRODUCT_PHOTOS, PHOTO_PICKER_TYPES, canUseProductTools, photoSlotsLeft, photoUploadPlan } from "@/lib/inventory/product-edit";
import { compressInventoryPhoto, photoSizeLabel } from "@/lib/inventory/photo-compress";
import { uploadInventoryPhotos } from "@/lib/inventory/photo-upload";
import { orderedProductImages } from "@/lib/inventory/presentation";
import type { InventoryImage } from "@/lib/inventory/types";
import { RequestDialog } from "./request-dialog";
import { saveFailureMessage } from "@/lib/inventory/save-errors";

const buttonStyle = "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";

export function ProductPhotoManager({ productId, productName, images, role, productHref, preview = false }: { productId: string; productName: string; images: InventoryImage[]; role: string | null; productHref: string; preview?: boolean }) {
  const router = useRouter(), lock = useRef(false);
  const [compression,setCompression]=useState<{name:string;original:number;size?:number;error?:string}[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [confirming, setConfirming] = useState<InventoryImage | null>(null);
  const [previewImages, setLocal] = useState(() => orderedProductImages(images));
  if (!canUseProductTools(role)) return <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">You do not have permission to manage photos.</p>;
  const local = preview ? previewImages : orderedProductImages(images), left = photoSlotsLeft(local.length);
  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await work();
      if (!result.ok) setError(result.error); else { setNotice(done); if (!preview) router.refresh(); }
    } catch (failure) { setError(saveFailureMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  function add(files: FileList | null) {
    const incoming = files ? Array.from(files) : [];
    if (!incoming.length) return;
    const problem = photoSelectionError(local.length, incoming);
    if (problem) { setError(problem); setNotice(""); return; }
    void run(async () => {
      setCompression(incoming.map(file=>({name:file.name,original:file.size})));
      const prepared:File[]=[], failures:string[]=[];
      for(const [index,file] of incoming.entries()) {
        try {
          const result=await compressInventoryPhoto(file);prepared.push(result.file);
          setCompression(rows=>rows.map((row,i)=>i===index ? {...row,size:result.sizeBytes} : row));
        } catch(error) {
          const message=error instanceof Error ? error.message : "Could not compress this photo.";
          failures.push(`${file.name}: ${message}`);setCompression(rows=>rows.map((row,i)=>i===index ? {...row,error:message} : row));
        }
      }
      if(preview) return failures.length ? {ok:false,error:failures.join(" ")} : {ok:true};
      if(!prepared.length) return {ok:false,error:failures.join(" ")};
      const uploaded = await uploadInventoryPhotos({ ownerType: "product", ownerId: productId, files: prepared });
      uploaded.failedCount+=failures.length;uploaded.errors.push(...failures);
      if (!uploaded.files.length) return { ok: false, error: uploaded.errors.join(" ") || "The photo could not be uploaded." };
      const plan = photoUploadPlan(local, uploaded.files.length);
      const registered = await registerInventoryPhotos({ ownerType: "product", ownerId: productId, files: uploaded.files.map((file, index) => ({ ...file, ...plan[index] })) });
      if (!registered.ok) return registered;
      if (uploaded.failedCount) return { ok: false, error: `${uploaded.failedCount} ${uploaded.failedCount === 1 ? "photo" : "photos"} could not be added. ${uploaded.errors.join(" ")}` };
      return { ok: true };
    }, preview ? "Preview only. Nothing was uploaded." : "Photo added.");
  }
  const picker = (camera: boolean) => <label className={`${buttonStyle} cursor-pointer focus-within:ring-2 focus-within:ring-emerald-800 ${busy || left === 0 ? "cursor-not-allowed opacity-50" : ""}`}>
    {camera ? <Camera size={18} aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}{camera ? "Camera" : "Gallery"}
    <input className="sr-only" type="file" accept={PHOTO_PICKER_TYPES} multiple={!camera} {...(camera ? { capture: "environment" as const } : {})} disabled={busy || left === 0} aria-label={camera ? "Take a photo" : "Choose photos from gallery"}
      onChange={event => { add(event.target.files); event.target.value = ""; }} />
  </label>;
  return <div className="min-w-0 space-y-4">
    <header className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Manage photos</h1><p className="break-words text-sm text-zinc-600">{productName}</p></header>
    <section className="min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Add photos">
      <h2 className="font-semibold text-zinc-900">Photos <span className="text-sm font-normal text-zinc-500">({local.length}/{MAX_PRODUCT_PHOTOS})</span></h2>
      <p className="text-sm text-zinc-600">{left === 0 ? "This item has the maximum of three photos. Remove one to add another." : "JPEG, PNG or WebP. The main photo appears first."}</p>
      <div className="grid min-w-0 grid-cols-2 gap-2">{picker(true)}{picker(false)}</div>
      {compression.length>0 && <ul aria-label="Photo upload sizes" className="min-w-0 space-y-2">{compression.map((photo,index)=><li key={index} className="rounded-md bg-zinc-50 p-3 text-sm [overflow-wrap:anywhere]"><p className="font-medium text-zinc-800">{photo.name}</p><p aria-live="polite" className={photo.error ? "text-red-700" : "text-zinc-600"}>{photo.error || (photo.size === undefined ? "Compressing..." : photoSizeLabel(photo.original,photo.size))}</p></li>)}</ul>}
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    </section>
    {local.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">No photos yet.</p> : <ul className="grid min-w-0 gap-3 sm:grid-cols-3">
      {local.map((photo, index) => <li key={photo.id} className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="relative aspect-[4/3] bg-zinc-100">
          {photo.signed_url ? <Image src={photo.signed_url} alt={`${productName} photo ${index + 1}`} fill unoptimized className="object-cover" sizes="(max-width: 640px) 100vw, 300px" /> : <div className="flex h-full items-center justify-center text-zinc-400"><ImageOff aria-hidden="true" /></div>}
          {photo.is_main && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-900 px-2.5 py-1 text-sm font-semibold text-white"><Star size={12} aria-hidden="true" />Main</span>}
        </div>
        <div className="flex gap-2 p-2">
          <button type="button" disabled={busy || photo.is_main} className={buttonStyle} onClick={() => preview ? setNotice("Preview only. Nothing was changed.") : void run(() => setMainProductPhoto({ photoId: photo.id }), "Main photo updated.")}><Star size={16} aria-hidden="true" />{photo.is_main ? "Main photo" : "Set as main"}</button>
          <button type="button" disabled={busy} className={`${buttonStyle} text-red-800`} aria-label={`Remove photo ${index + 1}`} onClick={() => setConfirming(photo)}><Trash2 size={16} aria-hidden="true" />Remove</button>
        </div>
      </li>)}
    </ul>}
    <Link href={productHref} className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">Back to item</Link>
    {confirming && <RequestDialog title="Remove this photo?" busy={busy} onClose={() => setConfirming(null)}>
      <div className="space-y-4">
        <p className="text-sm text-zinc-700">The photo is deleted from this item. This cannot be undone.{confirming.is_main && local.length > 1 ? " Another photo becomes the main photo." : ""}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} className={buttonStyle} onClick={() => setConfirming(null)}>Keep photo</button>
          <button type="button" disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-md bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            onClick={() => { const photo = confirming; setConfirming(null); if (preview) { setLocal(rows => rows.filter(row => row.id !== photo.id)); setNotice("Preview only. Nothing was deleted."); } else void run(() => removeProductPhoto({ photoId: photo.id }), "Photo removed."); }}>Remove photo</button>
        </div>
      </div>
    </RequestDialog>}
  </div>;
}
