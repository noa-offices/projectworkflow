"use client";

import Image from "next/image";
import { Camera, ImagePlus, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compressInventoryPhoto, photoSizeLabel } from "@/lib/inventory/photo-compress";
import { photoSelectionError } from "@/lib/inventory/product-request-submission";

type PickedPhoto = { id: string; file: File; url: string | null; originalSize: number; sizeBytes?: number };
export function RequestPhotoPicker({ onChange, disabled = false, ownerType = 'request', onBusyChange }: { onChange: (files: File[]) => void; disabled?: boolean; ownerType?: 'request' | 'product'; onBusyChange?: (busy: boolean) => void }) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]), [error, setError] = useState(""), [compressing,setCompressing]=useState(false);
  const urls = useRef(new Set<string>()), current=useRef<PickedPhoto[]>([]), lock=useRef(false), mounted=useRef(true);
  useEffect(() => {mounted.current=true;const activeUrls=urls.current;return () => { mounted.current=false;for (const url of activeUrls) URL.revokeObjectURL(url); };}, []);
  const update = (next: PickedPhoto[]) => { current.current=next;setPhotos(next); onChange(next.filter(photo=>photo.url!==null).map(photo => photo.file)); };
  async function add(files: FileList | null) {
    if (!files || lock.current || disabled) return;
    const incoming = Array.from(files);
    if(!incoming.length) return;
    const selectionError = photoSelectionError(current.current.length, incoming);
    if (selectionError) { setError(selectionError); return; }
    lock.current=true;setCompressing(true);onBusyChange?.(true);setError("");
    const added=incoming.map(file=>({id:crypto.randomUUID(),file,url:null,originalSize:file.size}));
    update([...current.current,...added]);
    const failures:string[]=[];
    try {
      for(const photo of added) {
        try {
          const result=await compressInventoryPhoto(photo.file);
          if(!mounted.current) return;
          const url=URL.createObjectURL(result.file);urls.current.add(url);
          update(current.current.map(row=>row.id===photo.id ? {...row,file:result.file,url,sizeBytes:result.sizeBytes} : row));
        } catch(error) {
          if(!mounted.current) return;
          failures.push(`${photo.file.name}: ${error instanceof Error ? error.message : "Could not compress this photo."}`);
          update(current.current.filter(row=>row.id!==photo.id));
        }
      }
      if(mounted.current) setError(failures.join(" "));
    } finally {lock.current=false;if(mounted.current) {setCompressing(false);onBusyChange?.(false);}}
  }
  const blocked=disabled || compressing;
  const pickerStyle = "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-emerald-800";
  return <section aria-labelledby="request-photos-heading" className="min-w-0 space-y-3">
    <div><h2 id="request-photos-heading" className="font-semibold text-zinc-900">Photos <span className="text-sm font-normal text-zinc-500">({photos.length}/3)</span></h2><p className="mt-1 text-sm text-zinc-600">Optional. The main photo appears first. {ownerType === 'product' ? 'Photos are attached after the item is saved.' : 'Photos are attached after your request is sent.'}</p></div>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className={pickerStyle + (blocked || photos.length === 3 ? " cursor-not-allowed opacity-50" : "")}><Camera size={18} aria-hidden="true" />Camera<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={blocked || photos.length === 3} aria-label="Take a photo" onChange={event => { add(event.target.files); event.target.value = ""; }} /></label>
      <label className={pickerStyle + (blocked || photos.length === 3 ? " cursor-not-allowed opacity-50" : "")}><ImagePlus size={18} aria-hidden="true" />Gallery<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={blocked || photos.length === 3} aria-label="Choose photos from gallery" onChange={event => { add(event.target.files); event.target.value = ""; }} /></label>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">{photos.map((photo, index) => <article key={photo.id} className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="relative aspect-[4/3] bg-zinc-100">{photo.url ? <Image src={photo.url} alt={`Selected photo ${index + 1}`} fill unoptimized className="object-cover" sizes="(max-width: 640px) 100vw, 200px" /> : <p role="status" className="flex h-full items-center justify-center text-sm text-zinc-600">Compressing...</p>}</div>
      {photo.sizeBytes !== undefined && <p aria-live="polite" className="px-3 pt-2 text-sm text-zinc-600 [overflow-wrap:anywhere]">{photoSizeLabel(photo.originalSize,photo.sizeBytes)}</p>}
      <div className="flex flex-wrap gap-1 p-2"><button type="button" disabled={blocked || index === 0} className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-emerald-900 disabled:opacity-70" onClick={() => update([photo, ...photos.filter(row => row.id !== photo.id)])}><Star size={16} aria-hidden="true" />{index === 0 ? "Main photo" : "Make main"}</button>
        <button type="button" disabled={blocked} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100" aria-label={`Remove photo ${index + 1}`} onClick={() => { if(photo.url) { URL.revokeObjectURL(photo.url); urls.current.delete(photo.url); } update(photos.filter(row => row.id !== photo.id)); setError(""); }}><X size={18} aria-hidden="true" /></button></div>
    </article>)}</div>
  </section>;
}
