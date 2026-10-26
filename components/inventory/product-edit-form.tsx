"use client";
import { inventoryIdentifier } from "@/lib/inventory/presentation";
import { BrandPicker } from "./brand-picker";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Save } from "lucide-react";
import { updateProduct } from "@/lib/inventory/actions";
import { canSeeCosts } from "@/lib/inventory/access";
import { InventoryInputError, productInput } from "@/lib/inventory/action-validation";
import { buildProductPatch, canUseProductTools, productEditFormInput } from "@/lib/inventory/product-edit";
import { PRODUCT_COST_FIELDS } from "@/lib/inventory/product-request-submission";
import { inventoryLabel, formatInventoryNumber } from "@/lib/inventory/presentation";
import { StickyActionBar } from "./inventory-ui";
import { NumberInput } from "./number-input";
import { ITEM_TYPES, PRODUCT_STATUSES, type InventoryBrand, type InventoryCategoryNode, type InventoryProductDetail } from "@/lib/inventory/types";
import { saveFailureMessage } from "@/lib/inventory/save-errors";

const fieldStyle = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const readOnlyStyle = "mt-1 min-h-11 w-full min-w-0 cursor-default rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-base text-zinc-600";
const sectionStyle = "min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
const labelStyle = "min-w-0 text-sm font-medium text-zinc-700";
const costLabels = { price: "Price", freight_cost: "Freight cost", c_and_f: "C & F", transport: "Transport", custom_duty: "Custom duty", labour: "Labour", vat: "VAT" };

export function ProductEditForm({ product, brands, categories, role, productHref, preview = false }: { product: InventoryProductDetail; brands: InventoryBrand[]; categories: InventoryCategoryNode[]; role: string | null; productHref: string; preview?: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState(product.category_id), [pending, setPending] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const held = useRef(false), errorRef = useRef<HTMLParagraphElement>(null);
  if (!canUseProductTools(role)) return <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">You do not have permission to edit items.</p>;
  const costsAllowed = canSeeCosts(role), hasLocation = !!product.location;
  const activeCategories = categories.filter(row => row.is_active || row.id === product.category_id);
  const subcategories = activeCategories.find(row => row.id === category)?.children.filter(row => row.is_active || row.id === product.subcategory_id) ?? [];
  return <form aria-label="Edit item" aria-describedby={error ? "product-edit-error" : undefined} className="min-w-0 space-y-4" onSubmit={async event => {
    event.preventDefault(); if (held.current) return;
    held.current = true; setPending(true); setError(""); setSaved(false);
    try {
      const patch = buildProductPatch(product, productEditFormInput(new FormData(event.currentTarget), { costsAllowed, hasLocation }));
      if (!Object.keys(patch).length) { setError("No changes to save."); return; }
      productInput(patch, costsAllowed, true);
      if (preview) { setSaved(true); return; }
      const response = await updateProduct({ productId: product.id, patch });
      if (!response.ok) { setError(response.error); return; }
      router.push(`${productHref}?saved=1`);
    } catch (failure) { setError(failure instanceof InventoryInputError ? failure.message : saveFailureMessage(failure, "Could not save your changes. Please try again.")); }
    finally { held.current = false; setPending(false); requestAnimationFrame(() => errorRef.current?.focus()); }
  }}>
    <header className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Edit item</h1><p className="break-words text-sm text-zinc-600">{product.item_name}</p><p className="text-sm text-emerald-800 [overflow-wrap:anywhere]">{inventoryIdentifier(product)}</p></header>
    <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Item details</h2><p className="text-sm text-zinc-600">Required fields are marked *.</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className={labelStyle}>Stock ref<input name="stock_ref_display" readOnly aria-readonly="true" value={product.stock_ref ?? ""} className={readOnlyStyle} /><span className="mt-1 block text-sm text-zinc-500">Created automatically. It cannot be changed.</span></label>
          <label className={labelStyle}>Quantity<input name="quantity_display" readOnly aria-readonly="true" value={formatInventoryNumber(product.quantity)} className={readOnlyStyle} /><span className="mt-1 block text-sm text-zinc-500">Change stock with Take / Move stock.</span></label>
          <label className={labelStyle}>Item name *<input required name="item_name" maxLength={200} defaultValue={product.item_name} className={fieldStyle} /></label>
          <label className={labelStyle}>Item code<input name="item_code" maxLength={100} defaultValue={product.item_code ?? ""} className={fieldStyle} /></label>
          <label className={labelStyle}>Model name<input name="model_name" maxLength={200} defaultValue={product.model_name ?? ""} className={fieldStyle} /></label>
          <label className={labelStyle}>Item type *<select name="item_type" defaultValue={product.item_type} className={fieldStyle}>{ITEM_TYPES.map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <BrandPicker brands={brands} role={role} current={product} preview={preview} />
          <label className={labelStyle}>Category *<select required name="category_id" value={category} onChange={event => setCategory(event.target.value)} className={fieldStyle}>{activeCategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className={labelStyle}>Subcategory<select key={category} name="subcategory_id" disabled={!subcategories.length} defaultValue={category === product.category_id ? product.subcategory_id ?? "" : ""} className={fieldStyle}><option value="">No subcategory</option>{subcategories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className={labelStyle}>Custom category<input name="custom_category_name" maxLength={200} defaultValue={product.custom_category_name ?? ""} className={fieldStyle} /></label>
          <label className={labelStyle}>Status *<select name="status" defaultValue={product.status} className={fieldStyle}>{PRODUCT_STATUSES.map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          <label className={labelStyle}>Condition *<select name="condition" defaultValue={product.condition} className={fieldStyle}>{["new", "used", "showroom", "damaged"].map(value => <option key={value} value={value}>{inventoryLabel(value)}</option>)}</select></label>
          {hasLocation && <label className={labelStyle}>Location<input name="location" maxLength={200} defaultValue={product.location ?? ""} className={fieldStyle} /></label>}
        </div>
        <label className="block text-sm font-medium text-zinc-700">Description<textarea name="description" defaultValue={product.description ?? ""} maxLength={5000} rows={3} className={fieldStyle} /></label>
        <label className="block text-sm font-medium text-zinc-700">Note<textarea name="note" defaultValue={product.note ?? ""} maxLength={2000} rows={3} className={fieldStyle} /></label>
      </section>
      <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Size <span className="text-sm font-normal text-zinc-500">(optional)</span></h2><p className="text-sm text-zinc-600">Fill all three measurements and choose a unit, or leave all measurements empty.</p>
        <div className="grid min-w-0 grid-cols-2 gap-4">
          {(["length", "width", "height"] as const).map(value => <label key={value} className={labelStyle}>{inventoryLabel(value)}<NumberInput decimals name={`dimension_${value}`} maxLength={13} defaultValue={product[`dimension_${value}`] ?? ""} className={fieldStyle} /></label>)}
          <label className={labelStyle}>Unit<select name="dimension_unit" defaultValue={product.dimension_unit ?? "mm"} className={fieldStyle}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
        </div>
      </section>
      {costsAllowed && <section className={sectionStyle}><h2 className="font-semibold text-zinc-900">Costs</h2>
        <div className="grid min-w-0 grid-cols-2 gap-4">{PRODUCT_COST_FIELDS.map(key => <label key={key} className={labelStyle}>{costLabels[key]}<NumberInput decimals name={key} maxLength={13} defaultValue={product.costs?.[key] ?? 0} className={fieldStyle} /></label>)}</div>
      </section>}
      <StickyActionBar>
        {error && <p id="product-edit-error" ref={errorRef} tabIndex={-1} role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error} Your entries are retained.</p>}
        {saved && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Preview only. Nothing was saved.</p>}
        <button type="submit" disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-900 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait"><Save size={18} aria-hidden="true" />{pending ? "Saving…" : "Save changes"}</button>
        <Link href={productHref} className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">Cancel</Link>
      </StickyActionBar>
    </fieldset>
  </form>;
}
