"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import { GalleryDetailDialog } from "@/components/products/product-gallery-detail-dialog";
import { ConfirmRemoveDialog, EditGalleryItemDialog, MergeGalleryItemDialog, RemovedItemsDialog } from "@/components/products/product-gallery-dialogs";
import { toolbarContainer, toolbarControl, toolbarPrimaryButton, toolbarSecondaryButton } from "@/components/products/product-toolbar-styles";
import { checkGalleryUpdatesAction, listGalleryFiltersAction, listGalleryItemsAction, removeGalleryItemAction } from "@/lib/products/gallery/gallery-actions";
import { GALLERY_SORT_MODES, type GalleryCurrencyEntry, type GalleryFilterEntry, type GalleryListItem, type GallerySortMode, type GallerySubCategoryEntry, type GalleryTagEntry } from "@/lib/products/gallery/gallery";
import {
  GALLERY_SEARCH_DEBOUNCE_MS,
  GALLERY_SORT_LABELS,
  activeGalleryFilterCount,
  buildGalleryQuery,
  clearedGalleryFilters,
  filterOptionLabel,
  hasActiveGalleryFilters,
  quotedText,
  showingText,
  updateTagText,
  UPDATE_AVAILABLE_TEXT,
  subCategoryLabel,
  type GalleryUrlState,
} from "@/lib/products/gallery/gallery-view";

// The Product Gallery page: configured products the company has quoted. Cards are clean by default. Users who may edit (canEdit)
// get one "Edit" toggle; only while it is on do the cards show Edit and Remove, and Merge only for curators (canCurate). Edit mode is
// React state only (it resets on refresh). The filters live in the URL (the server passes the parsed state in; this component keeps
// the URL in step with history.replaceState). 30 per page with a Load more button. No money values on this page and no recipe: adding
// to a quotation happens in the quote builder. The server and the database decide who may change anything; these flags only mirror that.
type Filters = { brands: GalleryFilterEntry[]; categories: GalleryFilterEntry[]; tags: GalleryTagEntry[]; subCategories: GallerySubCategoryEntry[]; currencies: GalleryCurrencyEntry[] };
const NO_FILTERS: Filters = { brands: [], categories: [], tags: [], subCategories: [], currencies: [] };
type Dialog = { kind: "edit" | "remove" | "merge" | "detail"; item: GalleryListItem } | null;

const control = `${toolbarControl} w-full`;
const smallButton =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const removeButton =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700";
const openButton =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select className={control} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} title={label}>
      {children}
    </select>
  );
}

function GalleryCard({ item, editMode, canCurate, onDialog }: { item: GalleryListItem; editMode: boolean; canCurate: boolean; onDialog: (dialog: Dialog) => void }) {
  return (
    <li className={`flex h-full min-w-0 flex-col rounded-lg border border-zinc-200 bg-white shadow-sm`} data-testid="gallery-card">
      <div className="p-2 pb-0">
        <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-md border border-zinc-100 bg-zinc-50">
          <button type="button" onClick={() => onDialog({ kind: "detail", item })} aria-label={`Open details of ${item.displayName}`} className="flex h-full w-full items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
            <SetupThumbnail path={item.picture?.kind === "template" ? item.picture.path : null} alt={item.displayName} size={88} />
          </button>
          <span className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1">
            {updateTagText(item) ? <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-900">{updateTagText(item)}</span> : null}
            {!item.available ? <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">No longer available</span> : null}
          </span>
          {item.currency ? <span className="pointer-events-none absolute right-1.5 top-1.5 z-10 rounded-full border border-zinc-200 bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600" title="Currency">{item.currency}</span> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="min-w-0 text-sm font-semibold text-zinc-950">
          <button type="button" onClick={() => onDialog({ kind: "detail", item })} title={item.displayName} className="block w-full truncate text-left hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">{item.displayName}</button>
        </h3>
        {item.brandName ? <p className="truncate text-xs text-zinc-500" title={item.brandName}>{item.brandName}</p> : null}
        {item.itemCode ? <p className="truncate text-xs text-zinc-500" title={item.itemCode}>{item.itemCode}</p> : null}
        <div className="flex flex-wrap gap-1">
          {item.categoryName ? <span className="max-w-full truncate rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600" title="Category">{item.categoryName}</span> : null}
          {item.subCategoryName ? <span className="max-w-full truncate rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] text-zinc-600" title="Sub-category">{item.subCategoryName}</span> : null}
        </div>
        {item.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-900">{tag}</span>)}
          </div>
        ) : null}
        <p className="text-xs font-medium text-zinc-700">{quotedText(item.quotedCount)}</p>
        <div className="mt-auto grid grid-cols-2 gap-2 pt-2">
          <button type="button" className={`${openButton} col-span-2`} onClick={() => onDialog({ kind: "detail", item })} aria-label={`Details of ${item.displayName}`}>Details</button>
          {editMode ? (
            <>
              <button type="button" className={smallButton} onClick={() => onDialog({ kind: "edit", item })} aria-label={`Edit ${item.displayName}`}>Edit</button>
              <button type="button" className={removeButton} onClick={() => onDialog({ kind: "remove", item })} aria-label={`Remove ${item.displayName} from the gallery`}>Remove</button>
              {canCurate ? <button type="button" className={`${smallButton} col-span-2`} onClick={() => onDialog({ kind: "merge", item })} aria-label={`Merge ${item.displayName} into another item`}>Merge into...</button> : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5" aria-hidden="true" data-testid="gallery-skeleton">
      {Array.from({ length: 10 }, (_, index) => (
        <li key={index} className="h-56 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100" />
      ))}
    </ul>
  );
}

export function ProductGalleryBrowser({ canEdit, canCurate, initialState }: { canEdit: boolean; canCurate: boolean; initialState: GalleryUrlState }) {
  const [state, setState] = useState<GalleryUrlState>(initialState);
  const [searchText, setSearchText] = useState(initialState.query);
  const [editMode, setEditMode] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [items, setItems] = useState<GalleryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionProblem, setActionProblem] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const requestId = useRef(0);

  // Edit mode only means something for users who may edit.
  const editing = canEdit && editMode;
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
        updateAvailable: canEdit && current.updateAvailable,
        page: pageNumber,
      }),
    [canEdit],
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
    // reload on every filter change and when edit mode turns on or off; a newer request makes an older answer ignored
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

  function toggleEditMode() {
    setEditMode((on) => !on);
    setDialog(null);
    setRemovedOpen(false);
    setNotice("");
    setActionProblem("");
  }

  async function afterChange(message: string) {
    setDialog(null);
    setActionProblem("");
    setNotice(message);
    await Promise.all([reload(state), loadFilters()]);
  }

  async function checkUpdates() {
    setCheckingUpdates(true);
    setNotice("");
    setActionProblem("");
    try {
      const result = await checkGalleryUpdatesAction();
      if (result.ok) await afterChange(result.message);
      else setActionProblem(result.message);
    } catch {
      setActionProblem("The change could not be saved. Please try again.");
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function removeItem(item: GalleryListItem): Promise<string | null> {
    const result = await removeGalleryItemAction({ id: item.id });
    if (!result.ok) return result.message;
    await afterChange(result.alreadyRemoved ? "Already removed." : "Removed from the gallery.");
    return null;
  }

  const filtered = hasActiveGalleryFilters(state);
  const filterCount = activeGalleryFilterCount(state);

  return (
    <div className="px-5 py-6 sm:px-8">
      <div className="flex min-w-0 flex-col gap-4">
        {canEdit ? (
          <div className="flex justify-end gap-2">
            {editing ? <button type="button" className={toolbarSecondaryButton} onClick={() => setRemovedOpen(true)}>Removed items</button> : null}
            <button type="button" className={editing ? toolbarPrimaryButton : toolbarSecondaryButton} aria-pressed={editing} onClick={toggleEditMode}>
              {editing ? "Done" : "Edit"}
            </button>
          </div>
        ) : null}

        <section aria-label="Find products" className={`${toolbarContainer} flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full min-w-0 @xl:w-auto @xl:min-w-[14rem] @xl:flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search name, code or tag" aria-label="Search the gallery" className={`${control} pl-9 pr-3`} />
            </div>
            <button type="button" className={`${toolbarSecondaryButton} @xl:hidden`} aria-expanded={filtersOpen} aria-controls="gallery-filter-panel" onClick={() => setFiltersOpen((open) => !open)}>
              Filters{filterCount ? ` (${filterCount})` : ""}
            </button>
            {canEdit ? <button type="button" className={toolbarSecondaryButton} onClick={() => void checkUpdates()} disabled={checkingUpdates}>{checkingUpdates ? "Checking..." : "Check for updates"}</button> : null}
            {canEdit ? (
              <button type="button" className={state.updateAvailable ? toolbarPrimaryButton : toolbarSecondaryButton} aria-pressed={state.updateAvailable} onClick={() => change({ updateAvailable: !state.updateAvailable })}>
                {UPDATE_AVAILABLE_TEXT}
              </button>
            ) : null}
            {filtered ? <button type="button" className={toolbarSecondaryButton} onClick={clearFilters}>Clear filters</button> : null}
          </div>
          <div id="gallery-filter-panel" className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-2 min-[480px]:grid-cols-2 @xl:grid @xl:grid-cols-3 @4xl:grid-cols-6`}>
            <Select label="Brand" value={state.brandId} onChange={(value) => change({ brandId: value })}>
              <option value="">All brands</option>
              {filters.brands.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
            </Select>
            <Select label="Category" value={state.categoryId} onChange={(value) => change({ categoryId: value })}>
              <option value="">All categories</option>
              {filters.categories.map((entry) => <option key={entry.id} value={entry.id}>{filterOptionLabel(entry.name, entry.count)}</option>)}
            </Select>
            <Select label="Sub-category" value={state.subCategoryId} onChange={(value) => change({ subCategoryId: value })}>
              <option value="">All sub-categories</option>
              {filters.subCategories.map((entry) => <option key={entry.id} value={entry.id}>{subCategoryLabel(entry, filters.subCategories)}</option>)}
            </Select>
            <Select label="Tag" value={state.tag} onChange={(value) => change({ tag: value })}>
              <option value="">All tags</option>
              {state.tag && !filters.tags.some((entry) => entry.tag === state.tag) ? <option value={state.tag}>{state.tag}</option> : null}
              {filters.tags.map((entry) => <option key={entry.tag} value={entry.tag}>{filterOptionLabel(entry.tag, entry.count)}</option>)}
            </Select>
            <Select label="Currency" value={state.currency} onChange={(value) => change({ currency: value })}>
              <option value="">All currencies</option>
              {filters.currencies.map((entry) => <option key={entry.currency} value={entry.currency}>{filterOptionLabel(entry.currency, entry.count)}</option>)}
            </Select>
            <Select label="Sort by" value={state.sort} onChange={(value) => change({ sort: value as GallerySortMode })}>
              {GALLERY_SORT_MODES.map((mode) => <option key={mode} value={mode}>{GALLERY_SORT_LABELS[mode]}</option>)}
            </Select>
          </div>
        </section>

        {editing ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Edit mode is on. Choose Done when you are finished.</p> : null}
        {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
        {actionProblem ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{actionProblem}</p> : null}

        {phase === "loading" ? <Skeleton /> : null}

        {phase === "failed" ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p>{failure}</p>
            <button type="button" className={smallButton} onClick={() => void reload(state)}>Retry</button>
          </div>
        ) : null}

        {phase === "ready" && items.length === 0 ? (
          <section className="rounded-xl border border-dashed border-zinc-200 bg-white p-10 text-center text-sm text-zinc-600 shadow-sm">
            {filtered ? (
              <>No products match. <button type="button" className="font-semibold text-emerald-900 underline" onClick={clearFilters}>Clear filters</button>.</>
            ) : (
              "The gallery is empty. Products appear here when a quotation that uses them is sent or confirmed."
            )}
          </section>
        ) : null}

        {phase === "ready" && items.length > 0 ? (
          <>
            <p className="text-sm text-zinc-600" aria-live="polite">{showingText(items.length, total)}</p>
            <ul className="grid auto-rows-fr grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {items.map((item) => (
                <GalleryCard key={item.id} item={item} editMode={editing} canCurate={canCurate} onDialog={setDialog} />
              ))}
            </ul>
            {hasMore ? (
              <div className="flex justify-center">
                <button type="button" className={toolbarSecondaryButton} onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {dialog?.kind === "detail" ? <GalleryDetailDialog itemId={dialog.item.id} title={dialog.item.displayName} canEdit={canEdit} onChanged={() => void Promise.all([reload(state), loadFilters()])} onClose={() => setDialog(null)} /> : null}
      {editing && removedOpen ? <RemovedItemsDialog onClose={() => setRemovedOpen(false)} onChanged={(message) => { setNotice(message); void Promise.all([reload(state), loadFilters()]); }} /> : null}
      {editing && dialog?.kind === "edit" ? <EditGalleryItemDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={() => void afterChange("Saved.")} /> : null}
      {editing && dialog?.kind === "remove" ? <ConfirmRemoveDialog item={dialog.item} onClose={() => setDialog(null)} onConfirm={() => removeItem(dialog.item)} /> : null}
      {editing && canCurate && dialog?.kind === "merge" ? <MergeGalleryItemDialog item={dialog.item} onClose={() => setDialog(null)} onMerged={() => void afterChange("Items merged.")} /> : null}
    </div>
  );
}
