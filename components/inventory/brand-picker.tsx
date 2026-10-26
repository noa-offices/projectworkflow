"use client";

import { useId, useState } from "react";
import { canManageInventory } from "@/lib/inventory/access";
import { createLocalBrand } from "@/lib/inventory/actions";
import { brandValue } from "@/lib/inventory/brands";
import type { InventoryBrand } from "@/lib/inventory/types";
import { buttonClass, fieldClass } from "./inventory-ui";

export function BrandOptions({ brands }: {brands: InventoryBrand[]}) {
 return <><option value="none">No brand</option><optgroup label="Brands">{brands.filter(row=>row.kind!=="local").map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</optgroup><optgroup label="Local brands (Inventory only)">{brands.filter(row=>row.kind==="local").map(row=><option key={row.id} value={`local:${row.id}`}>{row.name}</option>)}</optgroup></>;
}
export function BrandPicker({brands,role,current,preview=false}: {brands: InventoryBrand[];role:string|null;current?: {brand_id:string|null;local_brand_id?:string|null;brand_name:string|null};preview?:boolean}) {
 const id=useId(), [value,setValue]=useState(current ? brandValue(current) : "none"),[added,setAdded]=useState<InventoryBrand[]>([]),[creating,setCreating]=useState(false),[name,setName]=useState(""),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const options=[...brands,...added.filter(row=>!brands.some(brand=>brand.id===row.id && brand.kind===row.kind))], manager=canManageInventory(role);
 const missing=current && brandValue(current)!=="none" && !options.some(row=>(row.kind==="local" ? `local:${row.id}` : row.id)===brandValue(current));
 const displayBrands: InventoryBrand[]=missing ? [...options,{id:current.local_brand_id || current.brand_id!,name:`${current.brand_name || "Current brand"} (inactive)`,kind:current.local_brand_id ? "local" : "public"}] : options;
 return <div className="min-w-0 space-y-2"><label htmlFor={id} className="block text-sm font-medium text-zinc-700">Brand</label>
  <select id={id} name="brand_selection" value={value} onChange={event=>{if(event.target.value==="create") {setCreating(true);setError("");} else setValue(event.target.value);}} className={fieldClass}>
   <BrandOptions brands={displayBrands} />
   {manager && <option value="create">+ New local brand (Inventory only)</option>}
  </select>
  {manager && creating && <div onKeyDown={event=>{if(event.key==="Enter" && event.target instanceof HTMLInputElement) event.preventDefault();}} className="min-w-0 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
   <p className="text-sm font-semibold text-zinc-900">New local brand (Inventory only)</p>
   <label htmlFor={`${id}-name`} className="block text-sm text-zinc-700">Name<input id={`${id}-name`} value={name} onChange={event=>setName(event.target.value)} maxLength={200} disabled={busy} className={fieldClass} /></label>
   <label htmlFor={`${id}-code`} className="block text-sm text-zinc-700">Short code<input id={`${id}-code`} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} maxLength={5} disabled={busy} autoCapitalize="characters" className={fieldClass} aria-describedby={`${id}-help`} /></label>
   <p id={`${id}-help`} className="text-sm text-zinc-600">Use 2?5 letters or numbers. GEN is reserved for items with no brand.</p>
   {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
   <div className="flex min-w-0 flex-wrap gap-2"><button type="button" disabled={busy} className={buttonClass.primary} onClick={async()=>{
    if(!name.trim() || !/^[A-Z0-9]{2,5}$/.test(code.trim()) || code.trim()==="GEN") {setError("Enter a name and a short code of 2?5 letters or numbers, other than GEN.");return;}
    setBusy(true);setError("");
    try {
     const result=preview ? {ok:true as const,brandId:crypto.randomUUID()} : await createLocalBrand({name,code});
     if(!result.ok) {setError(result.error);return;}
     setAdded(previous=>[...previous,{id:result.brandId,name:name.trim(),code:code.trim(),kind:"local"}]);setValue(`local:${result.brandId}`);setCreating(false);setName("");setCode("");
    } catch {setError("Could not save the brand. Please try again.");} finally {setBusy(false);}
   }}>{busy ? "Saving?" : "Save brand"}</button><button type="button" disabled={busy} className={buttonClass.secondary} onClick={()=>setCreating(false)}>Cancel</button></div>
  </div>}
 </div>;
}
