"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { registerInventoryPhotos, submitProductRequest } from "@/lib/inventory/actions";
import { canSeeCosts } from "@/lib/inventory/access";
import { InventoryInputError } from "@/lib/inventory/action-validation";
import { uploadInventoryPhotos } from "@/lib/inventory/photo-upload";
import { PRODUCT_COST_FIELDS, productRequestFormInput, sendProductRequest, type ProductRequestSubmissionResult } from "@/lib/inventory/product-request-submission";
import { ITEM_TYPES, PRODUCT_STATUSES, type InventoryBrand, type InventoryCategoryNode } from "@/lib/inventory/types";
import { inventoryLabel } from "@/lib/inventory/presentation";
import { RequestPhotoPicker } from "./request-photo-picker";

const fieldStyle = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const sectionStyle = "min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
const costLabels = { price: "Price", freight_cost: "Freight cost", c_and_f: "C & F", transport: "Transport", custom_duty: "Custom duty", labour: "Labour", vat: "VAT" };

export function ProductRequestForm({ brands, categories, role, preview = false }: { brands: InventoryBrand[]; categories: InventoryCategoryNode[]; role: string | null; preview?: boolean }) {
  const [category, setCategory] = useState(""), [files, setFiles] = useState<File[]>([]), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [result, setResult] = useState<ProductRequestSubmissionResult | null>(null);
  const held = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  const costsAllowed = canSeeCosts(role);
  const activeCategories = categories.filter(row => row.is_active);
  const subcategories = activeCategories.find(row => row.id === category)?.children.filter(row => row.is_active) ?? [];
  const heading = <header className="mb-5 space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Add-item request</h1><p className="text-sm text-zinc-600">Send an item for review before it enters inventory.</p></header>;
  if (result?.ok) return <>{heading}<section role="status" className={sectionStyle + " border-emerald-200 bg-emerald-50"}>
    <CheckCircle2 className="text-emerald-800" size={32} aria-hidden="true" /><h2 className="text-xl font-semibold text-zinc-900">Request sent</h2>
    <p className="text-sm text-zinc-700">Your add-item request is waiting for review.{preview ? " This is a preview; nothing was submitted." : ""}</p>
    {result.failedCount > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">{result.failedCount} {result.failedCount === 1 ? "photo could" : "photos could"} not be attached. Your request was still sent.</p>{result.photoError && <p className="mt-1">{result.photoError}</p>}</div>}
    <Link href={preview ? `/dev/inventory-preview?view=requests&frame=1&mine=1&status=all&role=${encodeURIComponent(role ?? '')}` : "/inventory/requests?tab=products&mine=1&status=all"} className="inline-flex min-h-11 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white">My requests</Link>
  </section></>;
  return <>{heading}<form aria-label="Add-item request" aria-describedby={error ? "product-request-error" : undefined} onSubmit={async event => {
    event.preventDefault(); if (held.current) return;
    held.current = true; setPending(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const input = productRequestFormInput(data, costsAllowed);
      const response: ProductRequestSubmissionResult = preview ? { ok: true, requestId: "preview", failedCount: 0, photoError: null }
        : await sendProductRequest(input, files, { submit: submitProductRequest, upload: uploadInventoryPhotos, register: registerInventoryPhotos });
      if (response.ok) setResult(response); else setError(response.error);
    } catch (failure) { setError(failure instanceof InventoryInputError ? failure.message : "Could not send your request. Please try again."); }
    finally { held.current = false; setPending(false); requestAnimationFrame(() => errorRef.current?.focus()); }
  }} className="min-w-0 space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Item details</h2><p className="text-sm text-zinc-600">Required fields are marked *. Stock is added to Warehouse after approval.</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-medium text-zinc-700">Brand *<select required name="brand_id" className={fieldStyle} defaultValue=""><option value="" disabled>Choose brand</option>{brands.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Category *<select required name="category_id" value={category} onChange={event => setCategory(event.target.value)} className={fieldStyle}><option value="" disabled>Choose category</option>{activeCategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Subcategory<select key={category} name="subcategory_id" disabled={!subcategories.length} className={fieldStyle} defaultValue=""><option value="">No subcategory</option>{subcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Item type *<select name="item_type" className={fieldStyle} defaultValue="product">{ITEM_TYPES.map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          {([{name:"stock_ref",label:"Stock ref",max:100},{name:"item_code",label:"Item code",max:100},{name:"item_name",label:"Item name",max:200},{name:"model_name",label:"Model name",max:200}]).map(field => <label key={field.name} className="min-w-0 text-sm font-medium text-zinc-700">{field.label} *<input name={field.name} required maxLength={field.max} className={fieldStyle} /></label>)}
          <label className="min-w-0 text-sm font-medium text-zinc-700">Quantity *<input name="quantity" type="number" inputMode="numeric" min={1} max={2147483647} step={1} defaultValue={1} required className={fieldStyle} /></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Status *<select name="requested_status" defaultValue="available" className={fieldStyle}>{PRODUCT_STATUSES.map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Condition *<select name="condition" defaultValue="new" className={fieldStyle}>{["new","used","showroom","damaged"].map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Source *<select name="source" defaultValue="manual_entry" className={fieldStyle}>{["project_balance","purchase","sample","manual_entry"].map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
        </div>
        <label className="block text-sm font-medium text-zinc-700">Description<textarea name="description" maxLength={5000} rows={3} className={fieldStyle} /></label>
      </section>
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Dimensions <span className="text-sm font-normal text-zinc-500">(optional)</span></h2><p className="text-sm text-zinc-600">Fill all three measurements and choose a unit, or leave all measurements empty.</p><div className="grid min-w-0 grid-cols-2 gap-4">
        {["length","width","height"].map(value => <label key={value} className="min-w-0 text-sm font-medium text-zinc-700">{inventoryLabel(value)}<input name={`dimension_${value}`} type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" className={fieldStyle} /></label>)}
        <label className="min-w-0 text-sm font-medium text-zinc-700">Unit<select name="dimension_unit" defaultValue="mm" className={fieldStyle}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
      </div></section>
      {costsAllowed && <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Costs</h2><div className="grid min-w-0 grid-cols-2 gap-4">{PRODUCT_COST_FIELDS.map(key => <label key={key} className="min-w-0 text-sm font-medium text-zinc-700">{costLabels[key]}<input name={key} type="number" inputMode="decimal" min={0} max="9999999999.99" step="0.01" defaultValue={0} className={fieldStyle} /></label>)}</div></section>}
      <div className={sectionStyle}><RequestPhotoPicker onChange={setFiles} disabled={pending} /></div>
      <section className={sectionStyle}><label className="block text-sm font-medium text-zinc-700">Note<textarea name="note" maxLength={2000} rows={3} className={fieldStyle} placeholder="Anything the reviewer should know" /></label></section>
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
        {error && <p id="product-request-error" ref={errorRef} tabIndex={-1} role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error} Your entries are retained.</p>}
        <button type="submit" disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-900 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait"><Send size={18} aria-hidden="true" />{pending ? "Sending request and photos…" : "Send add-item request"}</button>
        <p role="status" aria-live="polite" className="text-sm text-zinc-600">{pending ? "Please wait while your request and photos are sent." : preview ? "Preview only. Nothing will be submitted or uploaded." : "Your request will be reviewed before any stock is added."}</p>
      </div>
    </fieldset>
  </form></>;
}
