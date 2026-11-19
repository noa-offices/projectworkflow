"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import { ConfirmHiddenDialog, EditGalleryItemDialog, MergeGalleryItemDialog, galleryButton } from "@/components/products/product-gallery-dialogs";
import { listGalleryFiltersAction, listGalleryItemsAction, setGalleryItemHiddenAction } from "@/lib/products/gallery/gallery-actions";
import { GALLERY_SORT_MODES, type GalleryCurrencyEntry, type GalleryFilterEntry, type GalleryListItem, type GallerySortMode, type GallerySubCategoryEntry, type GalleryTagEntry } from "@/lib/products/gallery/gallery";
import {
  GALLERY_SEARCH_DEBOUNCE_MS,
  GALLERY_SORT_LABELS,
  activeGalleryFilterCount,
  buildGalleryQuery,
  categoryLine,
  clearedGalleryFilters,
  filterOptionLabel,
  hasActiveGalleryFilters,
  lastQuotedText,
  productLibraryHref,
  quotedText,
  showingText,
  subCategoriesFor,
  withGalleryCategory,
  type GalleryUrlState,
} from "@/lib/products/gallery/gallery-view";

// The Product Gallery page: configured products the company has quoted. Read-only for staff; curators (canCurate) can also edit,
// hide and merge. The filters live in the URL query string (the server passes the parsed state in; this component keeps the URL in
// step with history.replaceState). The list is 30 per page with a Load more button. This page shows no money values and never
// asks for a recipe: adding to a quotation happens in the quote builder.
type Filters = { brands: GalleryFilterEntry[]; categories: GalleryFilterEntry[]; tags: GalleryTagEntry[]; subCategories: GallerySubCategoryEntry[]; currencies: GalleryCurrencyEntry[] };
const NO_FILTERS: Filters = { brands: [], categories: [], tags: [], subCategories: [], currencies: [] };
type Dialog = { kind: "edit" | "hide" | "merge"; item: GalleryListItem } | null;

const selectClass = "h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:bg-zinc-100 disabled:text-zinc-400";
const chip = "rounded-full border px-2.5 py-0.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-zinc-600">
      {label}
      {children}
    </label>
  );
}

function GalleryCard({ item, canCurate, onDialog, onToggleHidden }: { item: GalleryListItem; canCurate: boolean; onDialog: (dialog: Dialog) => void; onToggleHidden: (item: GalleryListItem) => void }) {
  const meta = [item.brandName, categoryLine(item)].filter(Boolean).join(" · ");
  const lastQuoted = lastQuotedText(item.lastQuotedAt);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm" data-testid="gallery-card">
      <div className="flex min-w-0 items-start gap-3">
        <SetupThumbnail path={item.picture?.kind === "template" ? item.picture.path : null} alt={item.displayName} size={88} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 break-words text-sm font-semibold text-zinc-900">{item.displayName}</h3>
            {item.currency ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600" title="Currency">{item.currency}</span> : null}
          </div>
          {item.itemCode ? <p className="text-xs text-zinc-600">{item.itemCode}</p> : null}
          {meta ? <p className="text-xs text-zinc-600">{meta}</p> : null}
          <p className="mt-1 text-xs font-medium text-zinc-800">{quotedText(item.quotedCount)}</p>
          {lastQuoted ? <p className="text-xs text-zinc-500">{lastQuoted}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.isHidden ? <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-700">Hidden</span> : null}
        {!item.available ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">No longer available</span> : null}
        {item.tags.map((tag) => (
          <span key={tag} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-900">{tag}</span>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Link href={productLibraryHref(item.templateId)} className={`${galleryButton} inline-flex items-center`} aria-label={`View product ${item.displayName}`}>View product</Link>
        {canCurate ? (
          <>
            <button type="button" className={galleryButton} onClick={() => onDialog({ kind: "edit", item })} aria-label={`Edit ${item.displayName}`}>Edit</button>
            <button type="button" className={galleryButton} onClick={() => (item.isHidden ? onToggleHidden(item) : onDialog({ kind: "hide", item }))} aria-label={`${item.isHidden ? "Unhide" : "Hide"} ${item.displayName}`}>{item.isHidden ? "Unhide" : "Hide"}</button>
            <button type="button" className={galleryButton} onClick={() => onDialog({ kind: "merge", item })} aria-label={`Merge ${item.displayName} into another item`}>Merge into...</button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true" data-testid="gallery-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="h-36 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
      ))}
    </ul>
  );
}

export function ProductGalleryBrowser({ canCurate, initialState }: { canCurate: boolean; initialState: GalleryUrlState }) {
  const [state, setState] = useState<GalleryUrlState>(initialState);
  const [searchText, setSearchText] = useState(initialState.query);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [items, setItems] = useState<GalleryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionProblem, setActionProblem] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestId = useRef(0);

  const stateKey = buildGalleryQuery(state);

  // Keep the URL in step with the filters (shareable and refresh-safe) without a page reload.
  useEffect(() => {
    const next = `${window.location.pathname}${stateKey ? `?${stateKey}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [stateKey]);

  // Debounced search box -> state.
  useEffect(() => {
    if (searchText === state.query) return;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, query: searchText })), GALLERY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, state.query]);

  const loadFilters = useCallback(async () => {
    const result = await listGalleryFiltersAction();
    if (result.ok) setFilters({ brands: result.brands, categories: result.categories, tags: result.tags, subCategories: result.subCategories, currencies: result.currencies });
  }, []);

  const fetchPage = useCallback(
    async (current: GalleryUrlState, pageNumber: number) =>
      listGalleryItemsAction({
        query: current.query,
        brandId: current.brandId || null,
        categoryId: current.categoryId || null,
        subCategoryId: current.subCategoryId || null,
        currency: current.currency || null,
        tag: current.tag || null,
        sort: current.sort,
        includeHidden: canCurate && current.showHidden,
        page: pageNumber,
      }),
    [canCurate],
  );

  const reload = useCallback(
    async (current: GalleryUrlState) => {
      const id = ++requestId.current;
      setPhase("loading");
      try {
        const result = await fetchPage(current, 1);
        if (id !== requestId.current) return;
        if (result.ok) {
          setItems(result.items);
          setTotal(result.total);
          setPage(result.page);
          setHasMore(result.hasMore);
          setPhase("ready");
        } else {
          setFailure(result.message);
          setPhase("failed");
        }
      } catch {
        if (id !== requestId.current) return;
        setFailure("Could not load the gallery. Please try again.");
        setPhase("failed");
      }
    },
    [fetchPage],
  );

  // Data loading is started from a microtask (the same pattern as SetupThumbnail), not synchronously inside the effect.
  useEffect(() => {
    window.queueMicrotask(() => void loadFilters());
  }, [loadFilters]);

  useEffect(() => {
    // reload on every filter change (state is the whole filter set); a newer request makes an older answer ignored
    window.queueMicrotask(() => void reload(state));
  }, [state, reload]);

  async function loadMore() {
    setLoadingMore(true);
    setActionProblem("");
    const id = requestId.current;
    try {
      const result = await fetchPage(state, page + 1);
      if (id !== requestId.current) return;
      if (result.ok) {
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...result.items.filter((item) => !seen.has(item.id))];
        });
        setTotal(result.total);
        setPage(result.page);
        setHasMore(result.hasMore);
      } else setActionProblem(result.message);
    } catch {
      setActionProblem("Could not load more. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function change(patch: Partial<GalleryUrlState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function clearFilters() {
    setSearchText("");
    setState((current) => clearedGalleryFilters(current));
  }

  async function afterChange(message: string) {
    setDialog(null);
    setActionProblem("");
    setNotice(message);
    await Promise.all([reload(state), loadFilters()]);
  }

  async function setHidden(item: GalleryListItem, hidden: boolean): Promise<string | null> {
    const result = await setGalleryItemHiddenAction({ id: item.id, hidden });
    if (!result.ok) return result.message;
    await afterChange(hidden ? "Item hidden." : "Item is visible again.");
    return null;
  }

  async function unhideNow(item: GalleryListItem) {
    const message = await setHidden(item, false);
    if (message) setActionProblem(message);
  }

  const subOptions = subCategoriesFor(filters.subCategories, state.categoryId);
  const filtered = hasActiveGalleryFilters(state);
  const filterCount = activeGalleryFilterCount(state);

  const filterPanel = (
    <div className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-3 sm:grid-cols-2 md:grid lg:grid-cols-3 xl:grid-cols-6`} id="gallery-filter-panel">
      <Field label="Brand">
        <select className={selectClass} value={state.brandId} onChange={(event) => change({ brandId: event.target.value })} aria-label="Brand">
          <option value="">All brands</option>
          {filters.brands.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
        </select>
      </Field>
      <Field label="Category">
        <select className={selectClass} value={state.categoryId} onChange={(event) => setState((current) => withGalleryCategory(current, event.target.value))} aria-label="Category">
          <option value="">All categories</option>
          {filters.categories.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
        </select>
      </Field>
      <Field label="Sub-category">
        <select className={selectClass} value={state.subCategoryId} disabled={!state.categoryId} onChange={(event) => change({ subCategoryId: event.target.value })} aria-label="Sub-category">
          <option value="">{state.categoryId ? "All sub-categories" : "Choose a category first"}</option>
          {subOptions.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
        </select>
      </Field>
      <Field label="Currency">
        <select className={selectClass} value={state.currency} onChange={(event) => change({ currency: event.target.value })} aria-label="Currency">
          <option value="">All currencies</option>
          {filters.currencies.map((entry) => <option key={entry.currency} value={entry.currency}>{filterOptionLabel(entry.currency, entry.count)}</option>)}
        </select>
      </Field>
      <Field label="Sort by">
        <select className={selectClass} value={state.sort} onChange={(event) => change({ sort: event.target.value as GallerySortMode })} aria-label="Sort by">
          {GALLERY_SORT_MODES.map((mode) => <option key={mode} value={mode}>{GALLERY_SORT_LABELS[mode]}</option>)}
        </select>
      </Field>
      {canCurate ? (
        <label className="flex items-end gap-2 pb-2 text-sm font-medium text-zinc-800">
          <input type="checkbox" checked={state.showHidden} onChange={(event) => change({ showHidden: event.target.checked })} className="h-4 w-4 accent-emerald-800" />
          Show hidden
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label="Filters" className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs font-semibold text-zinc-600">
            Search
            <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Name, code or tag" aria-label="Search the gallery" className="h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800" />
          </label>
          <button type="button" className={`${galleryButton} h-9 md:hidden`} aria-expanded={filtersOpen} aria-controls="gallery-filter-panel" onClick={() => setFiltersOpen((open) => !open)}>
            Filters{filterCount ? ` (${filterCount})` : ""}
          </button>
          {filtered ? <button type="button" className={`${galleryButton} h-9`} onClick={clearFilters}>Clear filters</button> : null}
        </div>
        {filterPanel}
        {filters.tags.length ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
            {filters.tags.map((entry) => {
              const active = state.tag === entry.tag;
              return (
                <button
                  key={entry.tag}
                  type="button"
                  aria-pressed={active}
                  onClick={() => change({ tag: active ? "" : entry.tag })}
                  className={`${chip} ${active ? "border-emerald-800 bg-emerald-800 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-emerald-800"}`}
                >
                  {entry.tag} ({entry.count})
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {actionProblem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{actionProblem}</p> : null}

      {phase === "loading" ? <Skeleton /> : null}

      {phase === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{failure}</p>
          <button type="button" className={galleryButton} onClick={() => void reload(state)}>Retry</button>
        </div>
      ) : null}

      {phase === "ready" && items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-600">
          {filtered ? (
            <>No products match. <button type="button" className="font-semibold text-emerald-900 underline" onClick={clearFilters}>Clear filters</button>.</>
          ) : (
            "The gallery is empty. Products appear here when a quotation that uses them is sent or confirmed."
          )}
        </p>
      ) : null}

      {phase === "ready" && items.length > 0 ? (
        <>
          <p className="text-sm text-zinc-600" aria-live="polite">{showingText(items.length, total)}</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <GalleryCard key={item.id} item={item} canCurate={canCurate} onDialog={setDialog} onToggleHidden={(target) => void unhideNow(target)} />
            ))}
          </ul>
          {hasMore ? (
            <div className="flex justify-center">
              <button type="button" className={`${galleryButton} h-9 px-6`} onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button>
            </div>
          ) : null}
        </>
      ) : null}

      {canCurate && dialog?.kind === "edit" ? <EditGalleryItemDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={() => void afterChange("Saved.")} /> : null}
      {canCurate && dialog?.kind === "hide" ? <ConfirmHiddenDialog item={dialog.item} hide onClose={() => setDialog(null)} onConfirm={() => setHidden(dialog.item, true)} /> : null}
      {canCurate && dialog?.kind === "merge" ? <MergeGalleryItemDialog item={dialog.item} onClose={() => setDialog(null)} onMerged={() => void afterChange("Items merged.")} /> : null}
    </div>
  );
}
