"use client";

import Image from "next/image";
import { Camera, ImagePlus, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { photoSelectionError } from "@/lib/inventory/product-request-submission";

type PickedPhoto = { id: string; file: File; url: string };
export function RequestPhotoPicker({ onChange, disabled = false, ownerType = 'request' }: { onChange: (files: File[]) => void; disabled?: boolean; ownerType?: 'request' | 'product' }) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]), [error, setError] = useState("");
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  const update = (next: PickedPhoto[]) => { setPhotos(next); onChange(next.map(photo => photo.file)); };
  function add(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const selectionError = photoSelectionError(photos.length, incoming);
    if (selectionError) { setError(selectionError); return; }
    setError("");
    update([...photos, ...incoming.map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { id: crypto.randomUUID(), file, url }; })]);
  }
  const pickerStyle = "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-emerald-800";
  return <section aria-labelledby="request-photos-heading" className="min-w-0 space-y-3">
    <div><h2 id="request-photos-heading" className="font-semibold text-zinc-900">Photos <span className="text-sm font-normal text-zinc-500">({photos.length}/3)</span></h2><p className="mt-1 text-sm text-zinc-600">Optional. The main photo appears first. {ownerType === 'product' ? 'Photos are attached after the item is saved.' : 'Photos are attached after your request is sent.'}</p></div>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className={pickerStyle + (disabled || photos.length === 3 ? " cursor-not-allowed opacity-50" : "")}><Camera size={18} aria-hidden="true" />Camera<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled || photos.length === 3} aria-label="Take a photo" onChange={event => { add(event.target.files); event.target.value = ""; }} /></label>
      <label className={pickerStyle + (disabled || photos.length === 3 ? " cursor-not-allowed opacity-50" : "")}><ImagePlus size={18} aria-hidden="true" />Gallery<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || photos.length === 3} aria-label="Choose photos from gallery" onChange={event => { add(event.target.files); event.target.value = ""; }} /></label>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">{photos.map((photo, index) => <article key={photo.id} className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="relative aspect-[4/3] bg-zinc-100"><Image src={photo.url} alt={`Selected photo ${index + 1}`} fill unoptimized className="object-cover" sizes="(max-width: 640px) 100vw, 200px" /></div>
      <div className="flex flex-wrap gap-1 p-2"><button type="button" disabled={disabled || index === 0} className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-md px-2 text-sm font-medium text-emerald-900 disabled:opacity-70" onClick={() => update([photo, ...photos.filter(row => row.id !== photo.id)])}><Star size={16} aria-hidden="true" />{index === 0 ? "Main photo" : "Make main"}</button>
        <button type="button" disabled={disabled} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100" aria-label={`Remove photo ${index + 1}`} onClick={() => { URL.revokeObjectURL(photo.url); urls.current.delete(photo.url); update(photos.filter(row => row.id !== photo.id)); setError(""); }}><X size={18} aria-hidden="true" /></button></div>
    </article>)}</div>
  </section>;
}
