"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DialogShell, galleryButton } from "@/components/products/product-gallery-dialogs";
import { ProductLibraryPreviewImage } from "@/components/products/product-library-preview-image";
import { resolveQuotationImageUrl, markQuotationImagePathFailed } from "@/lib/quotation-image-path";
import { getGalleryItemDetailAction, updateGalleryItemSpecificationAction } from "@/lib/products/gallery/gallery-actions";
import { GALLERY_SPECIFICATION_MAX } from "@/lib/products/gallery/gallery";
import type { GalleryDetail, GalleryDetailMaterialGroup, GalleryDetailSwatch, GallerySpecificationSource } from "@/lib/products/gallery/gallery-detail";
import { COLLECTIONS_COLLAPSE_ABOVE, COLLECTIONS_SHOWN_FIRST, SWATCHES_SHOWN_FIRST, SPECIFICATION_HELP_TEXT, SPECIFICATION_SOURCE_LABELS, fullDetailHref, quotedText, specificationDraft, swatchCaption } from "@/lib/products/gallery/gallery-view";

// The details popup of the Product Gallery. Read-only: names and text only, no money values, no recipe. The data comes from
// getGalleryItemDetailAction (the server decides what is readable). It opens from a card (Details button, picture or title); Escape and
// Close shut it and focus goes back to the card (DialogShell). On a phone it is a full-screen sheet.
type Phase = { kind: "loading" } | { kind: "ready"; detail: GalleryDetail } | { kind: "unavailable"; message: string } | { kind: "failed"; message: string };

const openLink =
  "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
        {title}
        <span aria-hidden="true" className="text-zinc-400 transition group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-zinc-100 px-3 py-3 text-sm text-zinc-700">{children}</div>
    </details>
  );
}

function Labels({ detail }: { detail: GalleryDetail }) {
  const items = [
    ["Brand", detail.brandName],
    ["Category", detail.categoryName],
    ["Sub-category", detail.subCategoryName],
    ["Item code", detail.itemCode],
    ["Template code", detail.templateCode],
  ].filter(([, value]) => value);
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm min-[480px]:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
          <dd className="break-words text-zinc-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Pictures({ detail }: { detail: GalleryDetail }) {
  const [selected, setSelected] = useState(0);
  const path = detail.images[Math.min(selected, Math.max(0, detail.images.length - 1))] ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ProductLibraryPreviewImage
        alt={detail.displayName}
        path={path}
        className="flex h-64 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 sm:h-80"
        placeholder="No image"
      />
      {detail.images.length > 1 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Pictures">
          {detail.images.map((image, index) => (
            <li key={image}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={`Show picture ${index + 1} of ${detail.images.length}`}
                aria-pressed={index === selected}
                className={`block overflow-hidden rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 ${index === selected ? "border-emerald-800" : "border-zinc-200 hover:border-zinc-400"}`}
              >
                <ProductLibraryPreviewImage alt="" path={image} className="flex h-14 w-14 items-center justify-center bg-zinc-50" placeholder="" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SwatchImage({ swatch, size }: { swatch: GalleryDetailSwatch; size: number }) {
  const [url, setUrl] = useState("");
  const path = swatch.imagePath;
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      window.queueMicrotask(() => {
        if (!cancelled) setUrl("");
      });
      return;
    }
    void resolveQuotationImageUrl(path)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      onError={() => {
        if (path) markQuotationImagePathFailed(path);
        setUrl("");
      }}
      className="block h-full w-full object-cover"
    />
  ) : (
    <span className="px-0.5 text-center text-[10px] font-semibold leading-tight text-zinc-500">{swatch.code}</span>
  );
}

/** A grid of small square swatches: the first 24, then "Show all (N)" / "Show less" for this collection. */
function SwatchGrid({ swatches, selected, onSelect }: { swatches: GalleryDetailSwatch[]; selected: GalleryDetailSwatch | null; onSelect: (swatch: GalleryDetailSwatch) => void }) {
  const [showAll, setShowAll] = useState(false);
  const total = swatches.length;
  const shown = showAll ? swatches : swatches.slice(0, SWATCHES_SHOWN_FIRST);
  return (
    <>
      <ul className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(56px,1fr))]">
        {shown.map((swatch, index) => (
          <li key={`${swatch.code}-${index}`} className="flex min-w-0 flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelect(swatch)}
              title={swatchCaption(swatch)}
              aria-label={swatchCaption(swatch)}
              aria-pressed={selected === swatch}
              className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 sm:h-14 sm:w-14 ${selected === swatch ? "border-emerald-800" : "border-zinc-200 hover:border-zinc-400"}`}
            >
              <SwatchImage swatch={swatch} size={56} />
            </button>
            <span className="w-full truncate text-center text-[10px] text-zinc-600" title={swatchCaption(swatch)}>{swatch.code}</span>
          </li>
        ))}
      </ul>
      {total > SWATCHES_SHOWN_FIRST ? (
        <button type="button" className={`${galleryButton} mt-2`} onClick={() => setShowAll((open) => !open)} aria-expanded={showAll}>
          {showAll ? "Show less" : `Show all (${total})`}
        </button>
      ) : null}
    </>
  );
}

/** One material group: a heading with the total, then each collection (Era, Manhattan, ...) as its own labelled sub-section. */
function SwatchGroup({ group }: { group: GalleryDetailMaterialGroup }) {
  const [selected, setSelected] = useState<GalleryDetailSwatch | null>(null);
  const [allCollections, setAllCollections] = useState(false);
  const collapsible = group.collections.length > COLLECTIONS_COLLAPSE_ABOVE;
  const visible = collapsible && !allCollections ? group.collections.slice(0, COLLECTIONS_SHOWN_FIRST) : group.collections;
  return (
    <section data-testid="swatch-group" aria-label={group.groupName}>
      <h4 className="font-medium text-zinc-900">{group.groupName} <span className="font-normal text-zinc-500">({group.count})</span></h4>
      <p className="mt-1 min-h-5 text-xs text-zinc-700" aria-live="polite">{selected ? swatchCaption(selected) : ""}</p>
      <div className="mt-1 flex flex-col gap-3">
        {visible.map((collection) => (
          <div key={collection.name} data-testid="swatch-collection">
            <h5 className="text-xs font-semibold text-zinc-800">{collection.name} ({collection.swatches.length})</h5>
            <SwatchGrid swatches={collection.swatches} selected={selected} onSelect={setSelected} />
          </div>
        ))}
      </div>
      {collapsible ? (
        <button type="button" className={`${galleryButton} mt-3`} onClick={() => setAllCollections((open) => !open)} aria-expanded={allCollections}>
          {allCollections ? "Show fewer collections" : `Show all collections (${group.collections.length})`}
        </button>
      ) : null}
      {group.moreCount ? <p className="mt-1 text-xs text-zinc-500">and {group.moreCount} more</p> : null}
    </section>
  );
}

function SpecificationBlock({ detail, canEdit, onSaved }: { detail: GalleryDetail; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const source = detail.specificationSource;
  const label = source === "none" ? "" : SPECIFICATION_SOURCE_LABELS[source as Exclude<GallerySpecificationSource, "none">];

  function startEditing() {
    setDraft(specificationDraft(detail.specification));
    setMessage(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateGalleryItemSpecificationAction({ id: detail.id, specification: draft });
      if (result.ok) {
        await onSaved();
        setEditing(false);
        setMessage({ kind: "ok", text: "Specification saved." });
      } else setMessage({ kind: "error", text: result.message });
    } catch {
      setMessage({ kind: "error", text: "The change could not be saved. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="gallery-specification-edit" className="text-xs font-semibold text-zinc-600">Specification</label>
          <textarea
            id="gallery-specification-edit"
            value={draft}
            maxLength={GALLERY_SPECIFICATION_MAX}
            rows={8}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800"
          />
          <div className="flex items-start justify-between gap-2 text-xs text-zinc-500">
            <p>{SPECIFICATION_HELP_TEXT}</p>
            <p className="shrink-0" aria-live="polite">{draft.length} / {GALLERY_SPECIFICATION_MAX}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={galleryButton} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button type="button" className="h-8 rounded-md bg-emerald-800 px-3 text-xs font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : (
        <>
          {label ? <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p> : null}
          {detail.specification ? <p className="whitespace-pre-line">{detail.specification}</p> : <p className="text-zinc-500">No specification available.</p>}
          {canEdit ? <div><button type="button" className={galleryButton} onClick={startEditing}>Edit specification</button></div> : null}
        </>
      )}
      {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-800" : "text-sm text-emerald-900"}>{message.text}</p> : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" aria-hidden="true" data-testid="gallery-detail-skeleton">
      <div className="h-64 animate-pulse rounded-lg bg-zinc-100 sm:h-80" />
      <div className="flex flex-col gap-3">
        <div className="h-6 w-2/3 animate-pulse rounded bg-zinc-100" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-100" />
        <div className="h-24 animate-pulse rounded bg-zinc-100" />
        <div className="h-24 animate-pulse rounded bg-zinc-100" />
      </div>
    </div>
  );
}

function Body({ detail, canEdit, onSpecificationSaved }: { detail: GalleryDetail; canEdit: boolean; onSpecificationSaved: () => Promise<void> }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Pictures detail={detail} />
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h3 className="break-words text-lg font-semibold text-zinc-950">{detail.displayName}</h3>
          {detail.displayName !== detail.itemName ? <p className="text-sm text-zinc-500">Product name: {detail.itemName}</p> : null}
          <p className="mt-1 text-sm font-medium text-zinc-700">{quotedText(detail.quotedCount)}</p>
        </div>
        <Labels detail={detail} />
        {detail.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {detail.tags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900">{tag}</span>)}
          </div>
        ) : null}
        {detail.description ? <p className="whitespace-pre-line text-sm text-zinc-700">{detail.description}</p> : null}

        <Section title="Saved configuration" defaultOpen>
          {detail.configuration.length ? (
            <ul className="flex flex-col gap-1">
              {detail.configuration.map((line, index) => (
                <li key={`${line.label}-${index}`}>
                  <span className="font-medium text-zinc-900">{line.label}:</span> {line.value}
                  {line.supplierCode ? <span className="ml-1 text-xs text-zinc-500">Supplier code: {line.supplierCode}</span> : null}
                </li>
              ))}
            </ul>
          ) : detail.requiredComponents.length ? null : (
            <p className="text-zinc-500">No saved choices to show for this product.</p>
          )}
          {detail.requiredComponents.length ? (
            <div className={detail.configuration.length ? "mt-3" : ""} data-testid="required-components">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Required components</h4>
              <ul className="mt-1 flex flex-col gap-1">
                {detail.requiredComponents.map((component) => (
                  <li key={`${component.name}-${component.supplierCode ?? ""}`}>
                    <span className="font-medium text-zinc-900">{component.name}</span> x {component.quantity}
                    {component.size ? <span className="ml-1 text-xs text-zinc-500">Size: {component.size}</span> : null}
                    {component.supplierCode ? <span className="ml-1 text-xs text-zinc-500">Supplier code: {component.supplierCode}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <Section title="Specification" defaultOpen>
          <SpecificationBlock detail={detail} canEdit={canEdit} onSaved={onSpecificationSaved} />
        </Section>

        <Section title="Available materials">
          {detail.materials.length ? (
            <div className="flex flex-col gap-4">
              {detail.materials.map((group) => <SwatchGroup key={group.groupName} group={group} />)}
            </div>
          ) : (
            <p className="text-zinc-500">No finishes connected to this product.</p>
          )}
        </Section>

        <Section title="Options and accessories">
          {detail.options.length ? (
            <div className="flex flex-col gap-3">
              {detail.options.map((group) => (
                <div key={`${group.kind}-${group.groupName}`}>
                  <p className="font-medium text-zinc-900">{group.groupName}</p>
                  <ul className="mt-0.5 flex flex-col gap-0.5 text-zinc-600">
                    {group.items.map((item) => (
                      <li key={`${item.name}-${item.supplierCode ?? ""}`}>
                        {item.name}
                        {item.supplierCode ? <span className="ml-1 text-xs text-zinc-500">Supplier code: {item.supplierCode}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500">No options or accessories listed for this product.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

export function GalleryDetailDialog({ itemId, title, canEdit = false, onClose }: { itemId: string; title: string; canEdit?: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (isCancelled: () => boolean) => {
    try {
      const result = await getGalleryItemDetailAction({ id: itemId });
      if (isCancelled()) return;
      if (result.ok) setPhase({ kind: "ready", detail: result.detail });
      else setPhase(result.unavailable ? { kind: "unavailable", message: "This product is no longer available." } : { kind: "failed", message: result.message });
    } catch {
      if (!isCancelled()) setPhase({ kind: "failed", message: "Could not load the details. Please try again." });
    }
  }, [itemId]);

  // After a save: read the item again and swap the text in place, without the loading state and without closing the popup.
  const refresh = useCallback(async () => {
    const result = await getGalleryItemDetailAction({ id: itemId });
    if (result.ok) setPhase({ kind: "ready", detail: result.detail });
  }, [itemId]);

  useEffect(() => {
    let cancelled = false;
    // Started from a microtask (same pattern as the thumbnails), not synchronously inside the effect.
    window.queueMicrotask(() => {
      if (!cancelled) setPhase({ kind: "loading" });
      void load(() => cancelled);
    });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  return (
    <DialogShell title={title} onClose={onClose} wide>
      {phase.kind === "loading" ? <Skeleton /> : null}
      {phase.kind === "unavailable" ? <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">{phase.message}</p> : null}
      {phase.kind === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{phase.message}</p>
          <button type="button" className={galleryButton} onClick={() => setAttempt((count) => count + 1)}>Retry</button>
        </div>
      ) : null}
      {phase.kind === "ready" ? <Body detail={phase.detail} canEdit={canEdit} onSpecificationSaved={refresh} /> : null}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-1 flex flex-wrap justify-end gap-2 border-t border-zinc-100 bg-white px-4 py-3">
        <button type="button" className={`${galleryButton} h-9`} onClick={onClose}>Close</button>
        {phase.kind === "ready" ? <Link href={fullDetailHref(phase.detail.templateId)} className={openLink}>Open full detail</Link> : null}
      </div>
    </DialogShell>
  );
}
