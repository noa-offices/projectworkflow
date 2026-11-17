"use client";

import { useMemo, useState, useTransition } from "react";
import { createCustomItem, deleteCustomItem, updateCustomItem } from "@/lib/products/saved-setups/saved-custom-items-actions";
import {
  COLLECTION_SORT_OPTIONS,
  filterSetups,
  groupByBrand,
  itemCountLabel,
  sortSetups,
  type CollectionSortMode,
} from "@/lib/products/saved-setups/collection-view";
import {
  CUSTOM_ITEM_BRAND_MAX,
  CUSTOM_ITEM_CODE_MAX,
  CUSTOM_ITEM_CURRENCIES,
  CUSTOM_ITEM_DEFAULT_UNIT,
  CUSTOM_ITEM_NAME_MAX,
  CUSTOM_ITEM_SPEC_MAX,
  CUSTOM_ITEM_UNIT_MAX,
  customItemPriceLine,
  toCollectionItem,
  type CustomItemFieldErrors,
  type CustomItemListItem,
} from "@/lib/products/saved-setups/custom-item";

const secondaryButton =
  "h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60";
const dangerButton =
  "h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-60";
const primaryButton =
  "h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300";
const inputClass =
  "h-9 w-full rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";

export type FormValues = {
  brandName: string;
  itemName: string;
  itemCode: string;
  specification: string;
  unitLabel: string;
  sellingPrice: string;
  currency: string;
};

function valuesFor(item: CustomItemListItem | null): FormValues {
  return {
    brandName: item?.brandName ?? "",
    itemName: item?.itemName ?? "",
    itemCode: item?.itemCode ?? "",
    specification: item?.specification ?? "",
    unitLabel: item?.unitLabel ?? CUSTOM_ITEM_DEFAULT_UNIT,
    sellingPrice: item ? String(item.sellingPrice) : "",
    currency: item?.currency ?? "AED",
  };
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-zinc-600">{label}</span>
      {children}
      {error ? <span role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}
    </label>
  );
}

// One form for "Add custom item" and for editing. Errors come from the shared validator (shown next to each field).
export function CustomItemForm({ item, defaults, onDone, onSaved }: { item: CustomItemListItem | null; defaults?: FormValues; onDone: () => void; onSaved?: () => void }) {
  const [values, setValues] = useState<FormValues>(() => defaults ?? valuesFor(item));
  const [errors, setErrors] = useState<CustomItemFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, startTransition] = useTransition();
  const set = (key: keyof FormValues) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function submit() {
    startTransition(async () => {
      const result = item ? await updateCustomItem(item.id, values) : await createCustomItem(values);
      if (result.ok) {
        (onSaved ?? onDone)();
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(result.fieldErrors ? "" : result.error);
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) submit();
      }}
      aria-label={item ? "Edit custom item" : "Add custom item"}
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brand" error={errors.brandName}>
          <input value={values.brandName} maxLength={CUSTOM_ITEM_BRAND_MAX} onChange={set("brandName")} aria-label="Brand" className={inputClass} />
        </Field>
        <Field label="Item name" error={errors.itemName}>
          <input value={values.itemName} maxLength={CUSTOM_ITEM_NAME_MAX} onChange={set("itemName")} aria-label="Item name" className={inputClass} />
        </Field>
        <Field label="Code (optional)" error={errors.itemCode}>
          <input value={values.itemCode} maxLength={CUSTOM_ITEM_CODE_MAX} onChange={set("itemCode")} aria-label="Code" className={inputClass} />
        </Field>
        <Field label="Unit" error={errors.unitLabel}>
          <input value={values.unitLabel} maxLength={CUSTOM_ITEM_UNIT_MAX} onChange={set("unitLabel")} aria-label="Unit" className={inputClass} />
        </Field>
        <Field label="Selling price" error={errors.sellingPrice}>
          <input value={values.sellingPrice} inputMode="decimal" onChange={set("sellingPrice")} aria-label="Selling price" className={inputClass} />
        </Field>
        <Field label="Currency" error={errors.currency}>
          <select value={values.currency} onChange={set("currency")} aria-label="Currency" className={inputClass}>
            {CUSTOM_ITEM_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Specification (optional)" error={errors.specification}>
        <textarea value={values.specification} maxLength={CUSTOM_ITEM_SPEC_MAX} rows={3} onChange={set("specification")} aria-label="Specification" className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
      </Field>
      {formError ? <p role="alert" className="text-xs text-red-700">{formError}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primaryButton}>{pending ? "Saving..." : "Save item"}</button>
        <button type="button" disabled={pending} onClick={onDone} className={secondaryButton}>Cancel</button>
      </div>
    </form>
  );
}

function CustomItemCard({ item, onMessage }: { item: CustomItemListItem; onMessage: (message: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submitDelete() {
    startTransition(async () => {
      const result = await deleteCustomItem(item.id);
      if (!result.ok) onMessage(result.error);
      setConfirmingDelete(false);
    });
  }

  if (editing) return <li className="sm:col-span-2 xl:col-span-3"><CustomItemForm item={item} onDone={() => setEditing(false)} /></li>;

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 gap-3">
        <div aria-hidden="true" style={{ width: 104, height: 104 }} className="flex shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400">No image</div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-bold leading-snug text-zinc-900">{item.itemName}</p>
          {item.itemCode ? <p className="mt-1 truncate text-xs text-zinc-500">{item.itemCode}</p> : null}
          <p className="mt-1 text-xs font-semibold text-zinc-800">{customItemPriceLine(item)}</p>
          <p className="mt-1 text-xs text-zinc-500">Unit: {item.unitLabel}</p>
          {item.specification ? <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.specification}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
        {confirmingDelete ? (
          <>
            <button type="button" disabled={pending} onClick={submitDelete} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:bg-zinc-300">Confirm delete</button>
            <button type="button" disabled={pending} onClick={() => setConfirmingDelete(false)} className={secondaryButton}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" disabled={pending} onClick={() => setEditing(true)} aria-label={`Edit ${item.itemName}`} className={secondaryButton}>Edit</button>
            <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)} aria-label={`Delete ${item.itemName}`} className={dangerButton}>Delete</button>
          </>
        )}
      </div>
    </li>
  );
}

export function MyCollectionCustomItems({ items }: { items: CustomItemListItem[] }) {
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CollectionSortMode>("recent");

  const entries = useMemo(() => items.map(toCollectionItem), [items]);
  const groups = useMemo(() => groupByBrand(sortSetups(filterSetups(entries, search), sort)), [entries, search, sort]);

  return (
    <div className="space-y-6">
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        {items.length > 0 ? (
          <>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, code or brand"
              aria-label="Search custom items"
              className="h-10 min-w-0 flex-1 basis-56 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            />
            <label className="flex items-center gap-2 text-xs font-semibold uppercase text-zinc-500">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as CollectionSortMode)}
                className="h-10 rounded-md border border-zinc-200 bg-white px-2 text-sm font-normal normal-case text-zinc-800 outline-none focus:border-emerald-800"
              >
                {COLLECTION_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </>
        ) : null}
        <button type="button" onClick={() => setAdding(true)} disabled={adding} className={`${primaryButton} h-10 ml-auto`}>Add custom item</button>
      </div>

      {adding ? <CustomItemForm item={null} onDone={() => setAdding(false)} /> : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          Add an item that is not in the Product Library, with your own price.
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          No item matches your search.
        </p>
      ) : (
        <div className="space-y-8">
          {groups.map((brand) => (
            <section key={brand.brandName} aria-label={brand.brandName}>
              <h2 className="border-b border-zinc-200 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
                {brand.brandName} <span className="font-semibold text-zinc-500">· {itemCountLabel(brand.count)}</span>
              </h2>
              <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {brand.items.map((entry) => <CustomItemCard key={entry.id} item={entry.item} onMessage={setMessage} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
