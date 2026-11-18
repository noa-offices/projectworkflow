"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BrandCombobox, BrandFilterList } from "@/components/products/brand-combobox";
import { createCustomItem, deleteCustomItem, updateCustomItem } from "@/lib/products/saved-setups/saved-custom-items-actions";
import { renameCustomBrand } from "@/lib/products/saved-setups/saved-custom-brands-actions";
import { copyQuoteImageToCollection, removeCustomItemImage, signCustomItemImageUrls, uploadCustomItemImage } from "@/lib/products/saved-setups/saved-custom-images-actions";
import { resolveQuotationImageUrl } from "@/lib/quotation-image-path";
import { formatImageSize, imageMessage, type CustomItemWithImage } from "@/lib/products/saved-setups/custom-item-image";
import { compressToWebp } from "@/lib/images/compress-custom-item-image";
import {
  CUSTOM_BRAND_PAGE_SIZE,
  distinctBrands,
  filterByBrand,
  normaliseBrandKey,
  resolveBrandInput,
  type BrandCount,
} from "@/lib/products/saved-setups/custom-brands";
import {
  COLLECTION_SORT_OPTIONS,
  filterSetups,
  groupByBrand,
  itemCountLabel,
  sortSetups,
  type CollectionSortMode,
} from "@/lib/products/saved-setups/collection-view";
import {
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

// ── Pictures (PR 2b-3) ───────────────────────────────────────────────────────────────────────────────────────
// Thumbnails use short-lived signed links made by the server for the CALLER's own pictures only. Links are requested
// in one batch for the thumbnails that are actually on screen (lazy: only when scrolled near), cached for 50 minutes.
const SIGNED_REUSE_MS = 3000 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
let signQueue = new Map<string, Array<(url: string | null) => void>>();
let signTimer: ReturnType<typeof setTimeout> | null = null;

async function flushSignQueue() {
  const batch = signQueue;
  signQueue = new Map();
  signTimer = null;
  const paths = Array.from(batch.keys());
  for (let start = 0; start < paths.length; start += 60) {
    const chunk = paths.slice(start, start + 60);
    let urls: Record<string, string> = {};
    try {
      urls = await signCustomItemImageUrls(chunk);
    } catch {
      urls = {};
    }
    for (const path of chunk) {
      const url = urls[path] ?? null;
      if (url) signedUrlCache.set(path, { url, expiresAt: Date.now() + SIGNED_REUSE_MS });
      for (const resolve of batch.get(path) ?? []) resolve(url);
    }
  }
}

function requestSignedUrl(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);
  return new Promise((resolve) => {
    signQueue.set(path, [...(signQueue.get(path) ?? []), resolve]);
    if (!signTimer) signTimer = setTimeout(() => { void flushSignQueue(); }, 30);
  });
}

// The picture of a custom item (or the "No image" box). Pictures are loaded only when the thumbnail is near the screen.
export function CustomItemThumb({ imagePath, size, name }: { imagePath?: string | null; size: number; name: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!imagePath) return;
    const node = boxRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [imagePath]);

  useEffect(() => {
    if (!imagePath || !near) return;
    let cancelled = false;
    requestSignedUrl(imagePath).then((url) => { if (!cancelled) setResolved({ path: imagePath, url }); });
    return () => { cancelled = true; };
  }, [imagePath, near]);

  const url = imagePath && resolved?.path === imagePath && failedPath !== imagePath ? resolved.url : null;
  return (
    <div ref={boxRef} style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed private link, not optimisable by next/image
        <img src={url} alt={name} loading="lazy" decoding="async" onError={() => { signedUrlCache.delete(imagePath ?? ""); setFailedPath(imagePath ?? null); }} className="h-full w-full object-contain" />
      ) : (
        <span aria-hidden="true">No image</span>
      )}
    </div>
  );
}

// What the form holds for the picture. "row" = the quote row's own picture, copied into My Collection only when saving.
type ImageState =
  | { kind: "none" }
  | { kind: "saved"; path: string }
  | { kind: "uploaded"; path: string }
  | { kind: "row"; ref: string };

function RowPicturePreview({ imageRef }: { imageRef: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    resolveQuotationImageUrl(imageRef).then((resolved) => { if (!cancelled) setUrl(resolved); }).catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [imageRef]);
  return (
    <div style={{ width: 96, height: 96 }} className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed link
        <img src={url} alt="Row picture" decoding="async" className="h-full w-full object-contain" />
      ) : <span aria-hidden="true">No image</span>}
    </div>
  );
}

function CustomItemImageField({ busy, error, note, onPick, onRetry, onRemove, state }: { busy: string | null; error: string; note: string; onPick: (file: File) => void; onRetry: () => void; onRemove: () => void; state: ImageState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-md border border-zinc-200 p-3">
      <p className="mb-2 text-xs font-semibold text-zinc-600">Image (optional)</p>
      <div className="flex flex-wrap items-center gap-3">
        {state.kind === "row" ? <RowPicturePreview imageRef={state.ref} /> : <CustomItemThumb imagePath={state.kind === "none" ? null : state.path} size={96} name="Item picture" />}
        <div className="min-w-0 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Item picture file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onPick(file);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()} className={secondaryButton}>
              {busy ?? (state.kind === "none" ? "Upload picture" : "Replace picture")}
            </button>
            {state.kind !== "none" ? <button type="button" disabled={Boolean(busy)} onClick={onRemove} className={secondaryButton}>Remove picture</button> : null}
          </div>
          <p className="text-[11px] text-zinc-500">PNG, JPG or WebP, up to 10 MB. We compress it to a small WebP automatically.{state.kind === "row" ? " This is the row's current picture; it is copied when you save." : ""}</p>
          {note && !error ? <p role="status" className="text-[11px] font-semibold text-emerald-800">{note}</p> : null}
        </div>
      </div>
      {error ? (
        <div role="alert" className="mt-2 space-y-2">
          <p className="text-xs text-red-700">{error}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={onRetry} className={secondaryButton}>Try again</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()} className={secondaryButton}>Choose another picture</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// One form for "Add custom item" and for editing. Errors come from the shared validator (shown next to each field).
export function CustomItemForm({ item, defaults, brands = [], rowImageRef = null, onDone, onSaved }: { item: CustomItemWithImage | null; defaults?: FormValues; brands?: BrandCount[]; rowImageRef?: string | null; onDone: () => void; onSaved?: () => void }) {
  const [values, setValues] = useState<FormValues>(() => defaults ?? valuesFor(item));
  const [errors, setErrors] = useState<CustomItemFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, startTransition] = useTransition();
  const [image, setImage] = useState<ImageState>(() => (item?.imagePath ? { kind: "saved", path: item.imagePath } : rowImageRef ? { kind: "row", ref: rowImageRef } : { kind: "none" }));
  // "Compressing..." / "Uploading..." while a picture is being prepared; Save is disabled so a half-uploaded picture is never saved.
  const [imageBusy, setImageBusy] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [imageNote, setImageNote] = useState("");
  const lastFile = useRef<File | null>(null);
  const set = (key: keyof FormValues) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [key]: event.target.value }));

  function submit() {
    // The brand is required; a name matching an existing brand (ignoring case and spaces) uses the existing spelling.
    const brand = resolveBrandInput(values.brandName, brands);
    if (!brand.ok) {
      setErrors({ brandName: brand.error });
      return;
    }
    startTransition(async () => {
      // Picture: a row picture is COPIED into My Collection now; an uploaded one is already there.
      // undefined = leave the saved picture alone, null = remove it, a path = use it.
      let imagePath: string | null | undefined = item ? undefined : null;
      let copiedPath: string | null = null;
      if (image.kind === "uploaded") imagePath = image.path;
      else if (image.kind === "none") imagePath = item ? null : undefined;
      else if (image.kind === "row") {
        const copied = await copyQuoteImageToCollection(image.ref);
        if (!copied.ok) {
          setImageError(copied.error);
          return;
        }
        imagePath = copiedPath = copied.path;
      }
      const payload = { ...values, brandName: brand.name, imagePath };
      const result = item ? await updateCustomItem(item.id, payload) : await createCustomItem(payload);
      if (result.ok) {
        (onSaved ?? onDone)();
        return;
      }
      // A copy made for this save is not kept when the save fails (no orphan). An uploaded picture is removed by the
      // server when the save itself failed; after a plain field error it stays so the user can fix the field and retry.
      if (copiedPath) void removeCustomItemImage(copiedPath);
      if (image.kind === "uploaded" && !result.fieldErrors) {
        setImage({ kind: "none" });
        setImageError(imageMessage("unknown"));
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(result.fieldErrors ? "" : result.error);
    });
  }

  // Browser first (Vercel limits a request body to about 4.5 MB, so the original is never posted), then upload the small
  // WebP. Every failure becomes a plain-English message under the field; nothing half-saved is kept.
  async function pickImage(file: File) {
    lastFile.current = file;
    setImageError("");
    setImageNote("");
    setImageBusy("Compressing...");
    try {
      const compressed = await compressToWebp(file);
      if (!compressed.ok) {
        setImageError(compressed.error);
        return;
      }
      setImageBusy("Uploading...");
      const body = new FormData();
      body.set("file", compressed.file);
      const result = await uploadCustomItemImage(body);
      if (!result.ok) {
        setImageError(result.error);
        return;
      }
      // Replacing a picture that was uploaded in this form but never saved: the earlier file goes (best effort).
      if (image.kind === "uploaded") void removeCustomItemImage(image.path);
      setImage({ kind: "uploaded", path: result.path });
      setImageNote(`Saved as ${formatImageSize(result.size ?? compressed.finalBytes)}`);
      lastFile.current = null;
    } catch {
      setImageError(imageMessage("upload_failed"));
    } finally {
      setImageBusy(null);
    }
  }

  // "Try again": run the same file again; if there is no file (the row picture copy failed), save again.
  function retryImage() {
    if (lastFile.current) void pickImage(lastFile.current);
    else if (!pending) { setImageError(""); submit(); }
  }

  function removeImage() {
    if (image.kind === "uploaded") void removeCustomItemImage(image.path);
    setImage({ kind: "none" });
    setImageError("");
    setImageNote("");
    lastFile.current = null;
  }

  function cancel() {
    if (image.kind === "uploaded") void removeCustomItemImage(image.path);
    onDone();
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
        <BrandCombobox brands={brands} value={values.brandName} error={errors.brandName} onChange={(value) => setValues((current) => ({ ...current, brandName: value }))} />
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
      <CustomItemImageField state={image} busy={imageBusy} error={imageError} note={imageNote} onPick={(file) => { void pickImage(file); }} onRetry={retryImage} onRemove={removeImage} />
      {formError ? <p role="alert" className="text-xs text-red-700">{formError}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending || Boolean(imageBusy)} className={primaryButton}>{pending ? "Saving..." : "Save item"}</button>
        <button type="button" disabled={pending} onClick={cancel} className={secondaryButton}>Cancel</button>
      </div>
    </form>
  );
}

function CustomItemCard({ item, brands, onMessage }: { item: CustomItemWithImage; brands: BrandCount[]; onMessage: (message: string) => void }) {
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

  if (editing) return <li className="sm:col-span-2 xl:col-span-3"><CustomItemForm item={item} brands={brands} onDone={() => setEditing(false)} /></li>;

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 gap-3">
        <CustomItemThumb imagePath={item.imagePath} size={104} name={item.itemName} />
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

function RenameBrand({ brand, onDone, onMessage }: { brand: string; onDone: (newName: string, count: number) => void; onMessage: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(brand);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await renameCustomBrand(brand, name);
      if (!result.ok) {
        onMessage(result.error);
        return;
      }
      setOpen(false);
      onDone(result.brandName, result.count);
    });
  }

  if (!open) {
    return <button type="button" onClick={() => { setName(brand); setOpen(true); }} aria-label={`Rename brand ${brand}`} className="text-[11px] font-semibold normal-case tracking-normal text-emerald-900 underline">Rename brand</button>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 normal-case tracking-normal">
      <input
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") setOpen(false);
        }}
        aria-label="New brand name"
        className="h-8 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-emerald-800"
      />
      <button type="button" disabled={pending} onClick={submit} className={primaryButton}>Save</button>
      <button type="button" disabled={pending} onClick={() => setOpen(false)} className={secondaryButton}>Cancel</button>
    </span>
  );
}

export function MyCollectionCustomItems({ items }: { items: CustomItemWithImage[] }) {
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CollectionSortMode>("recent");
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});

  const brands = useMemo(() => distinctBrands(items), [items]);
  // A brand that no longer exists (renamed, or all its items deleted) falls back to All brands.
  const activeBrand = brandFilter && brands.some((brand) => normaliseBrandKey(brand.brandName) === normaliseBrandKey(brandFilter)) ? brandFilter : null;
  const entries = useMemo(() => items.map(toCollectionItem), [items]);
  const groups = useMemo(
    () => groupByBrand(sortSetups(filterSetups(filterByBrand(entries, activeBrand), search), sort)),
    [entries, activeBrand, search, sort],
  );

  return (
    <div className="space-y-6">
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}
      {info ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{info}</p> : null}

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

      {adding ? <CustomItemForm item={null} brands={brands} onDone={() => setAdding(false)} /> : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          Add an item that is not in the Product Library, with your own price.
        </p>
      ) : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="md:w-56 md:shrink-0">
            <BrandFilterList brands={brands} total={items.length} selected={activeBrand} onSelect={(brand) => { setBrandFilter(brand); setInfo(""); }} />
          </div>
          <div className="min-w-0 flex-1">
            {groups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
                No item matches your search.
              </p>
            ) : (
              <div className="space-y-8">
                {groups.map((brand) => {
                  const limit = shown[normaliseBrandKey(brand.brandName)] ?? CUSTOM_BRAND_PAGE_SIZE;
                  const visible = brand.items.slice(0, limit);
                  return (
                    <section key={brand.brandName} aria-label={brand.brandName}>
                      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
                        <span>{brand.brandName} <span className="font-semibold text-zinc-500">· {itemCountLabel(brand.count)}</span></span>
                        <RenameBrand
                          brand={brand.brandName}
                          onMessage={setMessage}
                          onDone={(newName, count) => {
                            setMessage("");
                            setBrandFilter(activeBrand ? newName : null);
                            setInfo(`${count} ${count === 1 ? "item" : "items"} updated to brand "${newName}".`);
                          }}
                        />
                      </h2>
                      <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {visible.map((entry) => <CustomItemCard key={entry.id} item={entry.item} brands={brands} onMessage={setMessage} />)}
                      </ul>
                      {brand.items.length > visible.length ? (
                        <button
                          type="button"
                          onClick={() => setShown((current) => ({ ...current, [normaliseBrandKey(brand.brandName)]: limit + CUSTOM_BRAND_PAGE_SIZE }))}
                          className={`${secondaryButton} mt-3`}
                        >
                          Show more ({brand.items.length - visible.length} more)
                        </button>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
