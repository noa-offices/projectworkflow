"use client";
import { BrandPicker } from "./brand-picker";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { registerInventoryPhotos, reviewProductRequestWithEdits, submitProductRequest } from "@/lib/inventory/actions";
import { canManageInventory, canSeeCosts } from "@/lib/inventory/access";
import { InventoryInputError } from "@/lib/inventory/action-validation";
import { uploadInventoryPhotos } from "@/lib/inventory/photo-upload";
import { PRODUCT_COST_FIELDS, changedProductRequestFields, productRequestFormInput, productRequestSuccessHref, sendProductRequest, type ProductRequestSubmissionResult } from "@/lib/inventory/product-request-submission";
import { ITEM_TYPES, LOCATION_LABELS, PRODUCT_STATUSES, type InventoryBrand, type InventoryCategoryNode, type InventoryProductRequest, type InventoryImage } from "@/lib/inventory/types";
import { inventoryLabel } from "@/lib/inventory/presentation";
import { StickyActionBar } from "./inventory-ui";
import { NumberInput } from "./number-input";
import { numberValue } from "@/lib/inventory/number-input";
import { RequestPhotoPicker } from "./request-photo-picker";
import { ProductImageGallery } from './product-image-gallery';
import { saveFailureMessage } from "@/lib/inventory/save-errors";

const fieldStyle = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const totalFieldStyle = "mt-1 min-h-11 w-full min-w-0 cursor-default rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-base text-zinc-500";
const sectionStyle = "min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
const costLabels = { price: "Price", freight_cost: "Freight cost", c_and_f: "C & F", transport: "Transport", custom_duty: "Custom duty", labour: "Labour", vat: "VAT" };

export function ProductRequestForm({ brands, categories, role, preview = false, request, images = [], onCancel, onApproved, onBusyChange }: { brands: InventoryBrand[]; categories: InventoryCategoryNode[]; role: string | null; preview?: boolean; request?: InventoryProductRequest; images?: InventoryImage[]; onCancel?: () => void; onApproved?: () => void; onBusyChange?: (busy:boolean) => void }) {
  const quantityHelpId = useId();
  const [category, setCategory] = useState(request?.category_id ?? ""), [files, setFiles] = useState<File[]>([]), [pending, setPending] = useState(false);
  const locations = Object.keys(LOCATION_LABELS).filter(key => key !== 'sold') as Exclude<keyof typeof LOCATION_LABELS,'sold'>[];
  const [stock, setStock] = useState<Record<string, string>>(() => Object.fromEntries(locations.map(key => [key, String(request?.initial_stock?.[key] ?? (key === 'warehouse' && !request?.initial_stock ? request?.quantity ?? 1 : 0))])));
  const [costValues, setCostValues] = useState<Record<string, string>>(() => Object.fromEntries(PRODUCT_COST_FIELDS.map(key => [key,String(request?.costs?.[key] ?? 0)])));
  const totalStock = Object.values(stock).reduce((sum, value) => sum + numberValue(value), 0);
  const [error, setError] = useState(""), [result, setResult] = useState<ProductRequestSubmissionResult | null>(null);
  const router = useRouter();
  const held = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  const costsAllowed = canSeeCosts(role), manager = canManageInventory(role);
  const activeCategories = categories.filter(row => row.is_active || row.id === request?.category_id);
  const subcategories = activeCategories.find(row => row.id === category)?.children.filter(row => row.is_active || row.id === request?.subcategory_id) ?? [];
  const heading = request ? null : <header className="mb-5 space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{manager ? "Add item" : "Add-item request"}</h1><p className="text-sm text-zinc-600">{manager ? "Save an item directly to inventory." : "Send an item for review before it enters inventory."}</p></header>;
  if (result?.ok) return <>{heading}<section role="status" className={sectionStyle + " border-emerald-200 bg-emerald-50"}>
    <CheckCircle2 className="text-emerald-800" size={32} aria-hidden="true" /><h2 className="text-xl font-semibold text-zinc-900">{manager ? "Done" : "Request sent"}</h2>
    <p className="text-sm text-zinc-700">{manager ? "Your item is saved in inventory." : "Your add-item request is waiting for review."}{preview ? " This is a preview; nothing was submitted." : ""}</p>
    {result.failedCount > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">{result.failedCount} {result.failedCount === 1 ? "photo could" : "photos could"} not be attached. {manager ? "Your item was still saved." : "Your request was still sent."}</p>{result.photoError && <p className="mt-1">{result.photoError}</p>}</div>}
    <Link href={preview ? `/dev/inventory-preview?view=requests&frame=1&mine=1&status=all&role=${encodeURIComponent(role ?? '')}` : "/inventory/requests?tab=products&mine=1&status=all"} className="inline-flex min-h-11 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white">My requests</Link>
  </section></>;
  return <>{heading}<form aria-label={manager ? "Add item" : "Add-item request"} aria-describedby={error ? "product-request-error" : undefined} onSubmit={async event => {
    event.preventDefault(); if (held.current) return;
    held.current = true; setPending(true); onBusyChange?.(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const input = productRequestFormInput(data, costsAllowed);
      if (request) {
        const edits = changedProductRequestFields(request, input);
        const response = preview ? {ok:true as const} : await reviewProductRequestWithEdits({requestId:request.id,decision:'approved',reviewNote:data.get('review_note'),edits});
        if (!response.ok) setError(response.error); else onApproved?.();
        return;
      }
      const response: ProductRequestSubmissionResult = preview ? { ok: true, requestId: "preview", failedCount: 0, photoError: null }
        : await sendProductRequest(input, files, { submit: submitProductRequest, upload: uploadInventoryPhotos, register: registerInventoryPhotos });
      if (response.ok) {
        setResult(response);
        const href = preview ? null : productRequestSuccessHref(response, role);
        if (href) router.push(href);
      } else setError(response.error);
    } catch (failure) { setError(failure instanceof InventoryInputError ? failure.message : saveFailureMessage(failure, "Could not send your request. Please try again.")); }
    finally { held.current = false; setPending(false); onBusyChange?.(false); requestAnimationFrame(() => errorRef.current?.focus()); }
  }} className="min-w-0 space-y-4">
    <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Item details</h2><p className="text-sm text-zinc-600">Required fields are marked *.</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <BrandPicker brands={brands} role={role} current={request} preview={preview} />
          <label className="min-w-0 text-sm font-medium text-zinc-700">Category *<select required name="category_id" value={category} onChange={event => setCategory(event.target.value)} className={fieldStyle}><option value="" disabled>Choose category</option>{activeCategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Subcategory<select key={category} name="subcategory_id" disabled={!subcategories.length} className={fieldStyle} defaultValue={request?.subcategory_id ?? ''}><option value="">No subcategory</option>{subcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Custom category<input name="custom_category_name" maxLength={200} defaultValue={request?.custom_category_name ?? ''} className={fieldStyle} /></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Item type *<select name="item_type" className={fieldStyle} defaultValue={request?.item_type ?? "product"}>{ITEM_TYPES.map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <p className="text-sm text-zinc-600 sm:col-span-2">Stock ref: auto-generated when saved</p>
          {([{name:"item_code",label:"Item code",max:100,required:false},{name:"item_name",label:"Item name",max:200,required:true},{name:"model_name",label:"Model name",max:200,required:false}] as const).map(field => <label key={field.name} className="min-w-0 text-sm font-medium text-zinc-700">{field.label}{field.required ? ' *' : ''}<input name={field.name} defaultValue={request?.[field.name] ?? ""} required={field.required} maxLength={field.max} className={fieldStyle} /></label>)}
          <div className="min-w-0 sm:col-span-2"><label className="block text-sm font-medium text-zinc-700">Total quantity (from locations below)<input name="quantity" type="text" value={totalStock} readOnly aria-readonly="true" aria-describedby={quantityHelpId} className={totalFieldStyle} /></label><p id={quantityHelpId} className="mt-1 text-sm text-zinc-500">Change the numbers in Initial stock by location below.</p></div>
          <section className={sectionStyle + " sm:col-span-2"}><h2 className="font-semibold text-zinc-900">Initial stock by location</h2><p className="text-sm text-zinc-600">Enter whole units. At least one location must be above zero.</p><div className="grid grid-cols-2 gap-4">{locations.map(key => <label key={key} className="min-w-0 text-sm font-medium text-zinc-700">{LOCATION_LABELS[key]}<NumberInput name={`stock_${key}`} aria-label={`${LOCATION_LABELS[key]} units`} maxLength={10} value={stock[key]} onValueChange={text => setStock(previous => ({...previous,[key]:text}))} className={fieldStyle} /></label>)}</div><p role="status" className="text-sm font-semibold text-zinc-900">Total: {totalStock} units</p></section>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Status *<select name="requested_status" defaultValue={request?.requested_status ?? "available"} className={fieldStyle}>{PRODUCT_STATUSES.map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Condition *<select name="condition" defaultValue={request?.condition ?? "new"} className={fieldStyle}>{["new","used","showroom","damaged"].map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium text-zinc-700">Source *<select name="source" defaultValue={request?.source ?? "manual_entry"} className={fieldStyle}>{["project_balance","purchase","sample","manual_entry"].map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
        </div>
        <label className="block text-sm font-medium text-zinc-700">Description<textarea name="description" defaultValue={request?.description ?? ''} maxLength={5000} rows={3} className={fieldStyle} /></label>
      </section>
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Dimensions <span className="text-sm font-normal text-zinc-500">(optional)</span></h2><p className="text-sm text-zinc-600">Fill all three measurements and choose a unit, or leave all measurements empty.</p><div className="grid min-w-0 grid-cols-2 gap-4">
        {["length","width","height"].map(value => <label key={value} className="min-w-0 text-sm font-medium text-zinc-700">{inventoryLabel(value)}<NumberInput decimals name={`dimension_${value}`} maxLength={13} defaultValue={request?.[`dimension_${value}` as "dimension_length" | "dimension_width" | "dimension_height"] ?? ""} className={fieldStyle} /></label>)}
        <label className="min-w-0 text-sm font-medium text-zinc-700">Unit<select name="dimension_unit" defaultValue={request?.dimension_unit ?? "mm"} className={fieldStyle}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
      </div></section>
      {costsAllowed && <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Costs</h2><div className="grid min-w-0 grid-cols-2 gap-4">{PRODUCT_COST_FIELDS.map(key => <label key={key} className="min-w-0 text-sm font-medium text-zinc-700">{costLabels[key]}<NumberInput decimals name={key} maxLength={13} value={costValues[key]} onValueChange={text => setCostValues(previous => ({...previous,[key]:text}))} className={fieldStyle} /></label>)}</div><p role="status" className="mt-3 text-sm font-semibold">Total cost: {Object.values(costValues).reduce((sum, value) => sum + numberValue(value), 0).toFixed(2)}</p></section>}
      <div className={sectionStyle}>{request ? <><h2 className="mb-3 font-semibold">Photos</h2><ProductImageGallery images={images} productName={request.item_name} /><p className="mt-2 text-sm text-zinc-500">Photos are read only during review.</p></> : <RequestPhotoPicker ownerType={manager ? "product" : "request"} onChange={setFiles} disabled={pending} />}</div>
      <section className={sectionStyle}><label className="block text-sm font-medium text-zinc-700">Note<textarea name="note" defaultValue={request?.note ?? ''} maxLength={2000} rows={3} className={fieldStyle} placeholder="Anything the reviewer should know" /></label></section>
      {request && <section className={sectionStyle}><label className="block text-sm font-medium text-zinc-700">Review note<textarea name="review_note" maxLength={2000} rows={3} className={fieldStyle} /></label></section>}
      <StickyActionBar>
        {error && <p id="product-request-error" ref={errorRef} tabIndex={-1} role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error} Your entries are retained.</p>}
        {request && <button type="button" disabled={pending} onClick={onCancel} className="min-h-11 w-full rounded-md border border-zinc-300 px-4 text-sm font-semibold">Cancel</button>}
        <button type="submit" disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-900 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait"><Send size={18} aria-hidden="true" />{pending ? "Saving…" : request ? 'Approve' : manager ? 'Add item' : "Send request"}</button>
        <p role="status" aria-live="polite" className="text-sm text-zinc-600">{pending ? "Please wait while your request and photos are sent." : preview ? "Preview only. Nothing will be submitted or uploaded." : request ? "Approval saves these details and adds the stock." : manager ? "Saving adds this item and its stock immediately." : "Your request will be reviewed before any stock is added."}</p>
      </StickyActionBar>
    </fieldset>
  </form></>;
}
