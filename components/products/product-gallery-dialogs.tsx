"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { listGalleryItemsAction, mergeGalleryItemsAction, updateGalleryItemDetailsAction } from "@/lib/products/gallery/gallery-actions";
import type { GalleryListItem } from "@/lib/products/gallery/gallery";
import { GALLERY_MERGE_MAX_PAGES, editFormProblem, formatTagInput, mergeCandidates, parseTagInput, quotedText } from "@/lib/products/gallery/gallery-view";

// Curator dialogs for the Product Gallery page. Each dialog is a labelled modal: Escape closes it, focus starts inside it and
// returns to the button that opened it. Every change goes through a gallery action (the database decides who may curate); the
// action's own friendly message is shown on failure. Nothing here shows or sends a recipe.
export const galleryButton =
  "h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60";
export const galleryDangerButton =
  "h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-60";
const primaryButton =
  "h-9 rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60";
const fieldClass = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";

function DialogShell({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  // The latest onClose, so the effect below runs once (focus is set when the dialog opens, never again while typing).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const returnTo = opener.current as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:rounded-lg">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return text ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{text}</p> : null;
}

/** Edit: display name (1-120 characters, or empty to clear) and tags (comma separated, max 20, each max 30). */
export function EditGalleryItemDialog({ item, onClose, onSaved }: { item: GalleryListItem; onClose: () => void; onSaved: () => void }) {
  // Show the curated name only: an empty box means "use the product name".
  const [name, setName] = useState(item.displayName === item.itemName ? "" : item.displayName);
  const [tagText, setTagText] = useState(formatTagInput(item.tags));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    const local = editFormProblem(name, tagText);
    if (local) return setProblem(local);
    setBusy(true);
    setProblem("");
    const result = await updateGalleryItemDetailsAction({ id: item.id, displayName: name.trim() === "" ? null : name.trim(), tags: parseTagInput(tagText) });
    setBusy(false);
    if (result.ok) onSaved();
    else setProblem(result.message);
  }

  return (
    <DialogShell title="Edit gallery item" description={`Product name: ${item.itemName}`} onClose={onClose}>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800">
        Display name
        <input className={fieldClass} value={name} maxLength={120} placeholder={item.itemName} onChange={(event) => setName(event.target.value)} />
        <span className="text-xs font-normal text-zinc-500">Leave empty to show the product name.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800">
        Tags
        <input className={fieldClass} value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="chair, office" />
        <span className="text-xs font-normal text-zinc-500">Separate tags with commas. Up to 20 tags, each up to 30 characters.</span>
      </label>
      <Problem text={problem} />
      <div className="flex justify-end gap-2">
        <button type="button" className={galleryButton} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={primaryButton} onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </DialogShell>
  );
}

/** Hide / Unhide confirmation. */
export function ConfirmHiddenDialog({ item, hide, onClose, onConfirm }: { item: GalleryListItem; hide: boolean; onClose: () => void; onConfirm: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  async function confirm() {
    setBusy(true);
    const message = await onConfirm();
    setBusy(false);
    if (message) setProblem(message);
  }
  return (
    <DialogShell
      title={hide ? `Hide ${item.displayName}?` : `Unhide ${item.displayName}?`}
      description={hide ? "Hidden items are not shown to staff." : "This item will be shown to staff again."}
      onClose={onClose}
    >
      <Problem text={problem} />
      <div className="flex justify-end gap-2">
        <button type="button" className={galleryButton} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={hide ? galleryDangerButton : primaryButton} onClick={() => void confirm()} disabled={busy}>{busy ? "Working…" : hide ? "Hide" : "Unhide"}</button>
      </div>
    </DialogShell>
  );
}

/**
 * Merge this item INTO another item of the SAME product. Candidates come from the list action (same brand, hidden items included
 * for curators) and are then limited to the same template here; an item of a different product is never offered. A confirm
 * explains the effect before anything is sent.
 */
export function MergeGalleryItemDialog({ item, onClose, onMerged }: { item: GalleryListItem; onClose: () => void; onMerged: () => void }) {
  const [candidates, setCandidates] = useState<GalleryListItem[] | null>(null);
  const [loadProblem, setLoadProblem] = useState("");
  const [target, setTarget] = useState<GalleryListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: GalleryListItem[] = [];
      for (let page = 1; page <= GALLERY_MERGE_MAX_PAGES; page += 1) {
        const result = await listGalleryItemsAction({ brandId: item.brandId, includeHidden: true, sort: "name", page });
        if (cancelled) return;
        if (!result.ok) {
          setLoadProblem(result.message);
          setCandidates([]);
          return;
        }
        found.push(...result.items);
        if (!result.hasMore) break;
      }
      setCandidates(mergeCandidates(found, item) as GalleryListItem[]);
    })().catch(() => {
      if (!cancelled) {
        setLoadProblem("Could not load the gallery. Please try again.");
        setCandidates([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item]);

  async function merge() {
    if (!target) return;
    setBusy(true);
    setProblem("");
    const result = await mergeGalleryItemsAction({ fromId: item.id, toId: target.id });
    setBusy(false);
    if (result.ok) onMerged();
    else setProblem(result.message);
  }

  if (target) {
    return (
      <DialogShell title="Merge these items?" description={`${item.displayName} will be merged into ${target.displayName}. Counts are added and this item is removed.`} onClose={onClose}>
        <Problem text={problem} />
        <div className="flex justify-end gap-2">
          <button type="button" className={galleryButton} onClick={() => setTarget(null)} disabled={busy}>Back</button>
          <button type="button" className={galleryDangerButton} onClick={() => void merge()} disabled={busy}>{busy ? "Merging…" : "Merge"}</button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title={`Merge ${item.displayName} into…`} description="Only other items of the same product are listed." onClose={onClose}>
      {candidates === null ? <p role="status" className="text-sm text-zinc-600">Loading…</p> : null}
      <Problem text={loadProblem} />
      {candidates && !loadProblem && candidates.length === 0 ? <p className="text-sm text-zinc-600">There is no other item of this product to merge into.</p> : null}
      {candidates && candidates.length > 0 ? (
        <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <button type="button" onClick={() => setTarget(candidate)} className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 text-left text-sm hover:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
                <span className="min-w-0 truncate font-medium text-zinc-900">{candidate.displayName}{candidate.isHidden ? " (hidden)" : ""}</span>
                <span className="shrink-0 text-xs text-zinc-600">{quotedText(candidate.quotedCount)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end">
        <button type="button" className={galleryButton} onClick={onClose}>Cancel</button>
      </div>
    </DialogShell>
  );
}
