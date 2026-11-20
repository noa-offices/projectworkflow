"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import { GalleryDetailDialog } from "@/components/products/product-gallery-detail-dialog";
import { GalleryRatesContext, ProductGalleryPriceRow } from "@/components/products/product-gallery-price";
import { ProductGalleryRatePopover } from "@/components/products/product-gallery-rate-popover";
import { ConfirmRemoveDialog, EditGalleryItemDialog, MergeGalleryItemDialog, RemovedItemsDialog } from "@/components/products/product-gallery-dialogs";
import { toolbarContainer, toolbarControl, toolbarPrimaryButton, toolbarSecondaryButton } from "@/components/products/product-toolbar-styles";
import { checkGalleryUpdatesAction, getGalleryPricesAction, listGalleryFiltersAction, listGalleryItemsAction, removeGalleryItemAction } from "@/lib/products/gallery/gallery-actions";
import { listCurrencyDefaultRatesAction } from "@/lib/products/gallery/currency-default-rates-actions";
import { EMPTY_RATES, type CurrencyRates } from "@/lib/products/gallery/gallery-aed";
import { fetchGalleryListFacts, type GalleryPriceState } from "@/lib/products/gallery/gallery-price-view";
import { GALLERY_SORT_MODES, type GalleryCurrencyEntry, type GalleryFilterEntry, type GalleryListItem, type GallerySortMode, type GallerySubCategoryEntry, type GalleryTagEntry } from "@/lib/products/gallery/gallery";
import {
  GALLERY_SEARCH_DEBOUNCE_MS,
  GALLERY_SORT_LABELS,
  activeGalleryFilterCount,
  buildGalleryQuery,
  clearedGalleryFilters,
  filterOptionLabel,
  hasActiveGalleryFilters,
  showingText,
  updateTagText,
  UPDATE_AVAILABLE_TEXT,
  subCategoryLabel,
  type GalleryUrlState,
} from "@/lib/products/gallery/gallery-view";

// The Product Gallery page: configured products the company has quoted. Cards are clean by default. Users who may edit (canEdit)
// get one "Edit" toggle; only while it is on do the cards show Edit and Remove, and Merge only for curators (canCurate). Edit mode is
// React state only (it resets on refresh). The filters live in the URL (the server passes the parsed state in; this component keeps
// the URL in step with history.replaceState). 30 per page with a Load more button. List prices load separately when authorized; adding
// to a quotation happens in the quote builder. The server and the database decide who may change anything; these flags only mirror that.
type Filters = { brands: GalleryFilterEntry[]; categories: GalleryFilterEntry[]; tags: GalleryTagEntry[]; subCategories: GallerySubCategoryEntry[]; currencies: GalleryCurrencyEntry[] };
const NO_FILTERS: Filters = { brands: [], categories: [], tags: [], subCategories: [], currencies: [] };
type Dialog = { kind: "edit" | "remove" | "merge" | "detail"; item: GalleryListItem } | null;

const control = `${toolbarControl} w-full`;
const smallButton =
  "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select className={control} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} title={label}>
      {children}
    </select>
  );
}

function GalleryCard({ item, editMode, canCurate, canSeePrices, price, dimension, onDialog }: {
  item: GalleryListItem; editMode: boolean; canCurate: boolean; canSeePrices: boolean; price: GalleryPriceState; dimension: string | null | undefined; onDialog: (dialog: Dialog) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);
  const kind = [item.brandName, item.categoryName].filter(Boolean).join(" · ");
  const open = (kindOfDialog: "edit" | "remove" | "merge") => { setMenuOpen(false); onDialog({ kind: kindOfDialog, item }); };
  const menuItem = "block w-full px-3 py-1.5 text-left text-xs font-semibold text-[#1d1f1c] hover:bg-[#f1f2ee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800";
  return (
    <li className="flex min-w-0 flex-col text-[#1d1f1c]" data-testid="gallery-card">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-[#f1f2ee]">
        <button type="button" onClick={() => onDialog({ kind: "detail", item })} aria-label={`Open details of ${item.displayName}`} className="block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
          <SetupThumbnail path={item.picture?.kind === "template" ? item.picture.path : null} alt={item.displayName} fill />
        </button>
        <span className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
          {updateTagText(item) ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{updateTagText(item)}</span> : null}
          {!item.available ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">No longer available</span> : null}
        </span>
        {editMode ? (
          <div ref={menuRef} className="absolute right-2 top-2 z-20">
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Edit options for ${item.displayName}`} onClick={() => setMenuOpen((openNow) => !openNow)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-sm font-bold leading-none text-[#1d1f1c] shadow-sm hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">…</button>
            {menuOpen ? (
              <div role="menu" className="absolute right-0 mt-1 w-40 overflow-hidden rounded-md border border-[#e6e8e1] bg-white py-1 shadow-md">
                <button type="button" role="menuitem" className={menuItem} onClick={() => open("edit")} aria-label={`Rename or edit tags of ${item.displayName}`}>Rename / Tags</button>
                <button type="button" role="menuitem" className={`${menuItem} text-red-700`} onClick={() => open("remove")} aria-label={`Remove ${item.displayName} from the gallery`}>Remove</button>
                {canCurate ? <button type="button" role="menuitem" className={menuItem} onClick={() => open("merge")} aria-label={`Merge ${item.displayName} into another item`}>Merge into...</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <h3 className="mt-2.5 min-w-0 text-[15px] font-semibold leading-snug">
        <button type="button" onClick={() => onDialog({ kind: "detail", item })} title={item.displayName} className="block w-full truncate text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">{item.displayName}</button>
      </h3>
      {kind ? <p className="truncate text-[13px] text-[#5d6159]" title={kind}>{kind}</p> : null}
      {dimension === undefined ? <div aria-hidden="true" data-testid="gallery-card-size-loading" className="mt-0.5 h-[17px] w-32 animate-pulse rounded bg-[#f1f2ee]" /> : null}
      {dimension ? <p className="mt-0.5 truncate text-[12.5px] text-[#5d6159]" title={dimension} data-testid="gallery-card-size">{dimension}</p> : null}
      {canSeePrices ? <ProductGalleryPriceRow templateId={item.templateId} price={price} /> : null}
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-5 gap-y-7" aria-hidden="true" data-testid="gallery-skeleton">
      {Array.from({ length: 10 }, (_, index) => (
        <li key={index} className="aspect-[4/3] animate-pulse rounded-[10px] bg-[#f1f2ee]" />
      ))}
    </ul>
  );
}

export function ProductGalleryBrowser({ canEdit, canCurate, canSeePrices, initialState }: {
  canEdit: boolean; canCurate: boolean; canSeePrices: boolean; initialState: GalleryUrlState;
}) {
  const [state, setState] = useState<GalleryUrlState>(initialState);
  const [searchText, setSearchText] = useState(initialState.query);
  const [editMode, setEditMode] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [items, setItems] = useState<GalleryListItem[]>([]);
  const [prices, setPrices] = useState<Record<string, GalleryPriceState>>({});
  // Item size text: a key is absent while its batch is loading, null when no size can be worked out. It does not depend on price access.
  const [dimensions, setDimensions] = useState<Record<string, string | null>>({});
  const [defaultRates, setDefaultRates] = useState<CurrencyRates | null>(null);
  const [temporaryRates, setTemporaryRates] = useState<CurrencyRates>(EMPTY_RATES);
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

  const loadPrices = useCallback(async (items: GalleryListItem[], request: number) => {
    if (!items.length) return;
    const ids = items.map((item) => item.id);
    if (canSeePrices) setPrices((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, "loading" as const])) }));
    const results = await fetchGalleryListFacts(ids, getGalleryPricesAction);
    if (request !== requestId.current) return;
    if (canSeePrices) setPrices((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, results.prices[id]])) }));
    setDimensions((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, results.dimensions[id] ?? null])) }));
  }, [canSeePrices]);

  const reload = useCallback(
    async (current: GalleryUrlState) => {
      const id = ++requestId.current;
      setPhase("loading");
      setPrices({});
      setDimensions({});
      try {
        const result = await fetchPage(current, 1);
        if (id !== requestId.current) return;
        if (result.ok) {
          setItems(result.items);
          setTotal(result.total);
          setPage(result.page);
          setHasMore(result.hasMore);
          void loadPrices(result.items, id);
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
    [fetchPage, loadPrices],
  );

  // Data loading is started from a microtask (the same pattern as SetupThumbnail), not synchronously inside the effect.
  useEffect(() => {
    window.queueMicrotask(() => void loadFilters());
  }, [loadFilters]);

  useEffect(() => {
    if (!canSeePrices) return;
    let latest = 0;
    const loadRates = async () => {
      const request = ++latest;
      const rows = await listCurrencyDefaultRatesAction().catch(() => []);
      if (request === latest) setDefaultRates(Object.fromEntries(rows.map(({ currency, rate }) => [currency, rate])));
    };
    const onRefresh = () => {
      setTemporaryRates(EMPTY_RATES);
      if (navigator.onLine) void loadRates();
    };
    window.queueMicrotask(() => {
      if (latest === 0) void loadRates();
    });
    window.addEventListener("pw-read-refresh", onRefresh);
    return () => {
      latest++;
      window.removeEventListener("pw-read-refresh", onRefresh);
    };
  }, [canSeePrices]);

  useEffect(() => {
    // reload on every filter change and when edit mode turns on or off; a newer request makes an older answer ignored
    window.queueMicrotask(() => void reload(state));
  }, [state, reload]);

  useEffect(() => {
    const onRefresh = () => {
      if (!navigator.onLine) return;
      void reload(state);
      void loadFilters().catch(() => {});
    };
    window.addEventListener("pw-read-refresh", onRefresh);
    return () => window.removeEventListener("pw-read-refresh", onRefresh);
  }, [state, reload, loadFilters]);

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
        const visibleIds = new Set(items.map((item) => item.id));
        void loadPrices(result.items.filter((item) => !visibleIds.has(item.id)), id);
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
  const visibleCurrencies = [...new Set(items.flatMap(({ id }) => {
    const price = prices[id];
    return price && price !== "loading" && price.status === "priced"
      ? price.sourceTotals.map(({ currency }) => currency).filter((currency) => currency !== "AED")
      : [];
  }))].sort();

  return (
    <GalleryRatesContext value={{ defaults: defaultRates, temporary: temporaryRates }}>
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
            {canSeePrices ? (
              <ProductGalleryRatePopover currencies={visibleCurrencies} defaults={defaultRates ?? EMPTY_RATES} temporary={temporaryRates}
                onRate={(currency, rate) => setTemporaryRates((current) => ({ ...current, [currency]: rate }))}
                onReset={() => setTemporaryRates(EMPTY_RATES)} />
            ) : null}
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
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-5 gap-y-7">
              {items.map((item) => (
                <GalleryCard key={item.id} item={item} editMode={editing} canCurate={canCurate} canSeePrices={canSeePrices} price={prices[item.id]} dimension={dimensions[item.id]} onDialog={setDialog} />
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

      {dialog?.kind === "detail" ? <GalleryDetailDialog itemId={dialog.item.id} title={dialog.item.displayName} canEdit={canEdit} price={canSeePrices ? prices[dialog.item.id] : undefined} onChanged={() => void Promise.all([reload(state), loadFilters()])} onClose={() => setDialog(null)} /> : null}
      {editing && removedOpen ? <RemovedItemsDialog onClose={() => setRemovedOpen(false)} onChanged={(message) => { setNotice(message); void Promise.all([reload(state), loadFilters()]); }} /> : null}
      {editing && dialog?.kind === "edit" ? <EditGalleryItemDialog item={dialog.item} onClose={() => setDialog(null)} onSaved={() => void afterChange("Saved.")} /> : null}
      {editing && dialog?.kind === "remove" ? <ConfirmRemoveDialog item={dialog.item} onClose={() => setDialog(null)} onConfirm={() => removeItem(dialog.item)} /> : null}
      {editing && canCurate && dialog?.kind === "merge" ? <MergeGalleryItemDialog item={dialog.item} onClose={() => setDialog(null)} onMerged={() => void afterChange("Items merged.")} /> : null}
    </div>
    </GalleryRatesContext>
  );
}
