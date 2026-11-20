"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import { getGalleryPricesAction, listGalleryFiltersAction, listGalleryItemsAction } from "@/lib/products/gallery/gallery-actions";
import { GALLERY_SORT_MODES, type GalleryFilterEntry, type GalleryListItem, type GallerySortMode, type GallerySubCategoryEntry } from "@/lib/products/gallery/gallery";
import { fetchGalleryListFacts } from "@/lib/products/gallery/gallery-price-view";
import { EMPTY_PICKER_FILTERS, appendPickerPage, hasPickerFilters, isPickable, pickPayload, pickerKindLine, pickerListInput, type GalleryPickerFilters } from "@/lib/products/gallery/gallery-picker";
import { GALLERY_SEARCH_DEBOUNCE_MS, GALLERY_SORT_LABELS, filterOptionLabel, showingText, subCategoryLabel } from "@/lib/products/gallery/gallery-view";

// "Add from Gallery" picker (read-only). It lists the Product Gallery, shows name, brand, category and size, and calls onPick with the
// item id and name. It adds nothing, opens nothing and shows NO money: the size comes from the batched list action and only its
// `dimensions` are read. The parent decides what a pick does. No URL sync, no browser storage, no edit controls.
type Filters = { brands: GalleryFilterEntry[]; categories: GalleryFilterEntry[]; subCategories: GallerySubCategoryEntry[] };
const NO_FILTERS: Filters = { brands: [], categories: [], subCategories: [] };
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-6";
const control = "h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-emerald-800";
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
const smallButton = `h-8 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 ${focusRing}`;

function PickerCard({ item, dimension, onPick }: { item: GalleryListItem; dimension: string | null | undefined; onPick: (item: { id: string; name: string }) => void }) {
  const pickable = isPickable(item);
  const kind = pickerKindLine(item);
  return (
    <li className={`flex min-w-0 flex-col text-[#1d1f1c] ${pickable ? "" : "opacity-60"}`} data-testid="gallery-picker-card">
      <button
        type="button"
        disabled={!pickable}
        aria-label={pickable ? `Choose ${item.displayName}` : `${item.displayName} is no longer available`}
        onClick={() => { if (pickable) onPick(pickPayload(item)); }}
        className={`flex min-w-0 flex-col rounded-[10px] text-left ${pickable ? "cursor-pointer" : "cursor-not-allowed"} ${focusRing}`}
      >
        <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-[10px] bg-[#f1f2ee]">
          <SetupThumbnail path={item.picture?.kind === "template" ? item.picture.path : null} alt={item.displayName} fill />
        </span>
        <span className="mt-2.5 block w-full truncate text-[15px] font-semibold leading-snug" title={item.displayName}>{item.displayName}</span>
        {kind ? <span className="block w-full truncate text-[13px] text-[#5d6159]" title={kind}>{kind}</span> : null}
        {dimension === undefined ? <span aria-hidden="true" className="mt-0.5 block h-[17px] w-32 animate-pulse rounded bg-[#f1f2ee]" /> : null}
        {dimension ? <span className="mt-0.5 block w-full truncate text-[12.5px] text-[#5d6159]" title={dimension} data-testid="gallery-picker-size">{dimension}</span> : null}
        {!pickable ? <span className="mt-1 inline-block w-fit rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">No longer available</span> : null}
      </button>
    </li>
  );
}

export function AddFromGalleryPicker({ open = true, onClose, onPick }: { open?: boolean; onClose?: () => void; onPick: (item: { id: string; name: string }) => void }) {
  const [filters, setFilters] = useState<GalleryPickerFilters>(EMPTY_PICKER_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [options, setOptions] = useState<Filters>(NO_FILTERS);
  const [items, setItems] = useState<GalleryListItem[]>([]);
  // Item size text: absent while its batch loads, null when none can be worked out.
  const [dimensions, setDimensions] = useState<Record<string, string | null>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [problem, setProblem] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || searchText === filters.query) return;
    const timer = window.setTimeout(() => setFilters((current) => ({ ...current, query: searchText })), GALLERY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, searchText, filters.query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.queueMicrotask(async () => {
      try {
        const result = await listGalleryFiltersAction();
        if (!cancelled && result.ok) setOptions({ brands: result.brands, categories: result.categories, subCategories: result.subCategories });
      } catch {
        // the filters are optional; the list still works
      }
    });
    return () => { cancelled = true; };
  }, [open]);

  // Sizes only: whatever else the batch returns is never read.
  const loadSizes = useCallback(async (list: GalleryListItem[], request: number) => {
    if (!list.length) return;
    const ids = list.map((item) => item.id);
    const { dimensions: found } = await fetchGalleryListFacts(ids, getGalleryPricesAction);
    if (request !== requestId.current) return;
    setDimensions((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, found[id] ?? null])) }));
  }, []);

  useEffect(() => {
    if (!open) return;
    window.queueMicrotask(async () => {
      const id = ++requestId.current;
      setPhase("loading");
      setProblem("");
      setDimensions({});
      try {
        const result = await listGalleryItemsAction(pickerListInput(filters, 1));
        if (id !== requestId.current) return;
        if (result.ok) {
          setItems(result.items);
          setTotal(result.total);
          setPage(result.page);
          setHasMore(result.hasMore);
          setPhase("ready");
          void loadSizes(result.items, id);
        } else {
          setProblem(result.message);
          setPhase("failed");
        }
      } catch {
        if (id !== requestId.current) return;
        setProblem("Could not load the gallery. Please try again.");
        setPhase("failed");
      }
    });
  }, [open, filters, attempt, loadSizes]);

  async function loadMore() {
    setLoadingMore(true);
    const id = requestId.current;
    try {
      const result = await listGalleryItemsAction(pickerListInput(filters, page + 1));
      if (id !== requestId.current) return;
      if (result.ok) {
        const shown = new Set(items.map((item) => item.id));
        setItems((current) => appendPickerPage(current, result.items));
        setTotal(result.total);
        setPage(result.page);
        setHasMore(result.hasMore);
        void loadSizes(result.items.filter((item) => !shown.has(item.id)), id);
      } else setProblem(result.message);
    } catch {
      setProblem("Could not load more. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function change(patch: Partial<GalleryPickerFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  if (!open) return null;
  const filtered = hasPickerFilters(filters) || searchText !== "";

  return (
    <div role="dialog" aria-modal="true" aria-label="Add from Gallery" className="flex max-h-full min-h-0 w-full min-w-0 flex-col gap-3 bg-white p-4 text-[#1d1f1c]" data-testid="gallery-picker">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Add from Gallery</h2>
        {onClose ? <button type="button" onClick={onClose} className={smallButton}>Close</button> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 sm:flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search name, code or tag" aria-label="Search the gallery" className={`${control} pl-9 pr-3`} />
        </div>
        {filtered ? <button type="button" onClick={() => { setSearchText(""); setFilters(EMPTY_PICKER_FILTERS); }} className={`h-9 ${smallButton}`}>Clear filters</button> : null}
      </div>
      <div className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-2 lg:grid-cols-4">
        <select className={control} value={filters.brandId} onChange={(event) => change({ brandId: event.target.value })} aria-label="Brand">
          <option value="">All brands</option>
          {options.brands.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
        </select>
        <select className={control} value={filters.categoryId} onChange={(event) => change({ categoryId: event.target.value })} aria-label="Category">
          <option value="">All categories</option>
          {options.categories.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
        </select>
        <select className={control} value={filters.subCategoryId} onChange={(event) => change({ subCategoryId: event.target.value })} aria-label="Sub-category">
          <option value="">All sub-categories</option>
          {options.subCategories.map((entry) => <option key={entry.id} value={entry.id}>{subCategoryLabel(entry, options.subCategories)}</option>)}
        </select>
        <select className={control} value={filters.sort} onChange={(event) => change({ sort: event.target.value as GallerySortMode })} aria-label="Sort by">
          {GALLERY_SORT_MODES.map((mode) => <option key={mode} value={mode}>{GALLERY_SORT_LABELS[mode]}</option>)}
        </select>
      </div>
      {problem && phase !== "failed" ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{problem}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {phase === "loading" ? (
          <ul className={GRID} aria-hidden="true" data-testid="gallery-picker-skeleton">
            {Array.from({ length: 8 }, (_, index) => <li key={index} className="aspect-[4/3] animate-pulse rounded-[10px] bg-[#f1f2ee]" />)}
          </ul>
        ) : null}
        {phase === "failed" ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{problem}</p>
            <button type="button" className={smallButton} onClick={() => setAttempt((count) => count + 1)}>Retry</button>
          </div>
        ) : null}
        {phase === "ready" && items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-600">{filtered ? "No products match." : "No gallery items yet"}</p>
        ) : null}
        {phase === "ready" && items.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-zinc-600" aria-live="polite">{showingText(items.length, total)}</p>
            <ul className={GRID}>
              {items.map((item) => <PickerCard key={item.id} item={item} dimension={dimensions[item.id]} onPick={onPick} />)}
            </ul>
            {hasMore ? (
              <div className="mt-4 flex justify-center">
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={`h-9 px-4 disabled:opacity-60 ${smallButton}`}>{loadingMore ? "Loading…" : "Load more"}</button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
