"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DialogShell, galleryButton } from "@/components/products/product-gallery-dialogs";
import { ProductLibraryPreviewImage } from "@/components/products/product-library-preview-image";
import { getGalleryItemDetailAction } from "@/lib/products/gallery/gallery-actions";
import type { GalleryDetail } from "@/lib/products/gallery/gallery-detail";
import { fullDetailHref, quotedText } from "@/lib/products/gallery/gallery-view";

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

function Body({ detail }: { detail: GalleryDetail }) {
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
                <li key={`${line.label}-${index}`}><span className="font-medium text-zinc-900">{line.label}:</span> {line.value}</li>
              ))}
            </ul>
          ) : (
            <p className="text-zinc-500">No saved choices to show for this product.</p>
          )}
        </Section>

        <Section title="Specification" defaultOpen>
          {/* G-S1 (later PR): the gallery-owned specification goes HERE, above the template text, with an Edit option for editors.
              Not built yet: this block only shows the product template's own specification. */}
          {detail.specification ? <p className="whitespace-pre-line">{detail.specification}</p> : <p className="text-zinc-500">No specification available.</p>}
        </Section>

        <Section title="Available materials">
          {detail.materials.length ? (
            <div className="flex flex-col gap-3">
              {detail.materials.map((group) => (
                <div key={group.groupName}>
                  <p className="font-medium text-zinc-900">{group.groupName}</p>
                  <p className="text-zinc-600">{group.items.join(", ")}{group.moreCount ? ` and ${group.moreCount} more` : ""}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500">No materials listed for this product.</p>
          )}
        </Section>

        <Section title="Options and accessories">
          {detail.options.length ? (
            <div className="flex flex-col gap-3">
              {detail.options.map((group) => (
                <div key={`${group.kind}-${group.groupName}`}>
                  <p className="font-medium text-zinc-900">{group.groupName}</p>
                  <p className="text-zinc-600">{group.items.join(", ")}</p>
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

export function GalleryDetailDialog({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
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
      {phase.kind === "ready" ? <Body detail={phase.detail} /> : null}
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-1 flex flex-wrap justify-end gap-2 border-t border-zinc-100 bg-white px-4 py-3">
        <button type="button" className={`${galleryButton} h-9`} onClick={onClose}>Close</button>
        {phase.kind === "ready" ? <Link href={fullDetailHref(phase.detail.templateId)} className={openLink}>Open full detail</Link> : null}
      </div>
    </DialogShell>
  );
}
