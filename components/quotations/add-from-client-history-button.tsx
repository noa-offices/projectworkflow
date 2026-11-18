"use client";

import { useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CustomItemTargetContext } from "@/components/quotations/custom-item-picker-pane";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import {
  addHistoryItemToQuotationAction,
  deleteClientHistoryAction,
  getClientHistoryItemForAddAction,
  listClientHistoryAction,
} from "@/lib/quotations/client-history/client-history-actions";
import type { ClientHistoryListItem } from "@/lib/quotations/client-history/client-history";
import {
  CLIENT_HISTORY_KIND_FILTERS,
  CLIENT_HISTORY_KIND_LABELS,
  carriedDiscount,
  lastQuotedMeta,
  lastQuotedPrice,
  previousPriceChangeText,
  priceHistoryLine,
  shortClientName,
  type ClientHistoryKindFilter,
  type HistoryDiscount,
} from "@/lib/quotations/client-history/client-history-view";
import type { SetupForUse } from "@/lib/products/saved-setups/saved-setups-service";

/**
 * "Add from {client} history": the items previously quoted to THIS client, newest first, added in one click.
 * Same popup style as "Add from My Collection". Nothing here prices anything: configured items reopen the normal
 * configurator pre-filled (the current price comes from it), library items open the product, custom items become an
 * ordinary manual row exactly like a My Collection custom item. After a successful add the popup closes (a note keeps it
 * open so the note can be read), the same as the My Collection custom add.
 * `onOpenSetup` / `onOpenProduct` come from the Product Library selector and return an error message, or null when it took over.
 */
const SEARCH_DEBOUNCE_MS = 300;

function Picture({ item }: { item: ClientHistoryListItem }) {
  const [failed, setFailed] = useState(false);
  if (item.picture?.kind === "template") return <SetupThumbnail path={item.picture.path} alt={item.itemName} size={88} />;
  if (item.picture?.kind === "signed" && !failed) {
    return (
      <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.picture.url} alt={item.itemName} className="h-full w-full object-contain" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }
  return <SetupThumbnail path={null} alt={item.itemName} size={88} />;
}

function HistoryCard({
  busy,
  clientName,
  confirming,
  expanded,
  item,
  onAdd,
  onAskRemove,
  onCancelRemove,
  onRemove,
  onToggle,
}: {
  busy: boolean;
  clientName: string;
  confirming: boolean;
  expanded: boolean;
  item: ClientHistoryListItem;
  onAdd: (item: ClientHistoryListItem) => void;
  onAskRemove: (id: string) => void;
  onCancelRemove: () => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const change = previousPriceChangeText(item);
  const brandCode = [item.brand, item.itemCode].filter(Boolean).join(" · ");
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <Picture item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="break-words text-sm font-bold leading-snug text-zinc-900">{item.itemName}</p>
            <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{CLIENT_HISTORY_KIND_LABELS[item.kind]}</span>
          </div>
          {brandCode ? <p className="mt-1 truncate text-xs text-zinc-500">{brandCode}</p> : null}
          {item.specShort ? <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.specShort}</p> : null}
          <p className="mt-1 break-words text-xs font-semibold text-zinc-800">{lastQuotedPrice(item)}</p>
          <p className="break-words text-xs text-zinc-500">
            {lastQuotedMeta(item)}
            {change ? <span className="ml-2 font-medium text-zinc-600">{change}</span> : null}
          </p>
        </div>
      </div>
      {expanded ? (
        <ul aria-label="Price history" className="space-y-0.5 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          {item.priceHistory.length === 0 ? <li>No earlier prices.</li> : item.priceHistory.map((entry, index) => <li key={`${entry.at ?? ""}-${index}`}>{priceHistoryLine(entry)}</li>)}
        </ul>
      ) : null}
      {confirming ? (
        <div role="alertdialog" aria-label="Remove from history" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="min-w-0 flex-1">Remove this item from {clientName}&apos;s history? Quotes are not affected.</span>
          <button type="button" disabled={busy} onClick={() => onRemove(item.id)} className="h-8 rounded-md bg-red-700 px-3 font-semibold text-white transition hover:bg-red-800 disabled:opacity-60">Remove</button>
          <button type="button" onClick={onCancelRemove} className="h-8 rounded-md border border-zinc-300 bg-white px-3 font-semibold text-zinc-700 transition hover:border-emerald-800">Cancel</button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAdd(item)}
          className="h-9 rounded-md bg-emerald-900 px-5 text-xs font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:opacity-60"
        >
          Add
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`Price history for ${item.itemName}`}
          title="Price history"
          onClick={() => onToggle(item.id)}
          className="h-9 w-9 rounded-md border border-zinc-300 bg-white text-xs font-semibold italic text-zinc-600 transition hover:border-emerald-800 hover:text-emerald-900"
        >
          i
        </button>
        <button
          type="button"
          aria-label={`Remove ${item.itemName} from history`}
          title="Remove from history"
          disabled={busy}
          onClick={() => onAskRemove(item.id)}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-500 transition hover:border-red-600 hover:text-red-700 disabled:opacity-60"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    </li>
  );
}

export function AddFromClientHistoryButton({
  clientId,
  clientName,
  onOpenProduct,
  onOpenSetup,
  quoteCurrency = null,
}: {
  clientId: string | null;
  clientName: string;
  /** The discount of the old line is handed over with the product (null = it had none). */
  onOpenProduct: (templateId: string, discount: HistoryDiscount | null) => string | null;
  onOpenSetup: (setup: SetupForUse, discount: HistoryDiscount | null) => string | null;
  quoteCurrency?: string | null;
}) {
  const router = useRouter();
  const target = useContext(CustomItemTargetContext);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ClientHistoryKindFilter>("all");
  const [items, setItems] = useState<ClientHistoryListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const name = clientName.trim() || "this client";
  const hasClient = Boolean(clientId);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Debounced search text.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // First page: when the popup opens and whenever the search, the kind filter or Retry changes. Late answers are ignored.
  useEffect(() => {
    if (!open || !clientId) return;
    const id = ++request.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new search starts a fresh list
    setItems(null);
    setError("");
    listClientHistoryAction({ clientId, query, kind: kind === "all" ? undefined : kind, page: 1 })
      .then((result) => {
        if (id !== request.current) return;
        if (!result.ok) {
          setItems([]);
          setError(result.message);
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setHasMore(result.hasMore);
      })
      .catch(() => {
        if (id !== request.current) return;
        setItems([]);
        setError("Client history could not be loaded.");
      });
  }, [open, clientId, query, kind, retryKey]);

  // Escape closes an open confirmation first, then the popup.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmId) setConfirmId(null);
      else setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, confirmId]);

  function openPopup() {
    if (!hasClient) return;
    setSearch("");
    setQuery("");
    setKind("all");
    setNotice("");
    setExpandedId(null);
    setConfirmId(null);
    setOpen(true);
  }

  function loadMore() {
    if (!clientId || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    listClientHistoryAction({ clientId, query, kind: kind === "all" ? undefined : kind, page: page + 1 })
      .then((result) => {
        if (id !== request.current) return;
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        setItems((current) => {
          const seen = new Set((current ?? []).map((entry) => entry.id));
          return [...(current ?? []), ...result.items.filter((entry) => !seen.has(entry.id))];
        });
        setTotal(result.total);
        setPage(result.page);
        setHasMore(result.hasMore);
      })
      .catch(() => setNotice("More items could not be loaded."))
      .finally(() => setLoadingMore(false));
  }

  function add(item: ClientHistoryListItem) {
    if (!clientId) return;
    setNotice("");
    startTransition(async () => {
      try {
        // Custom items on the SERVER builder: the server action adds the row to this quotation (the client is read from the quotation there).
        if (item.kind === "custom" && target?.kind === "server") {
          const result = await addHistoryItemToQuotationAction({ quotationId: target.quotationId, sectionId: target.sectionId, historyId: item.id });
          if (!result.ok) {
            setNotice(result.message);
            return;
          }
          router.refresh();
          if (result.note) setNotice(`Added to the quote. ${result.note}`);
          else setOpen(false);
          return;
        }
        const loaded = await getClientHistoryItemForAddAction({ historyId: item.id, clientId });
        if (!loaded.ok) {
          setNotice(loaded.message);
          return;
        }
        const data = loaded.item;
        if (data.kind === "configured") {
          // The EXISTING replay: the configurator opens pre-filled (with the old discount) and the user confirms there. The current price comes from it.
          const problem = onOpenSetup(data.setup, carriedDiscount(data, quoteCurrency));
          if (problem) setNotice(problem);
          else setOpen(false);
          return;
        }
        if (data.kind === "library") {
          const problem = onOpenProduct(data.templateId, carriedDiscount(data, quoteCurrency));
          if (problem) setNotice(problem);
          else setOpen(false);
          return;
        }
        // Custom item on the LOCAL builder: an ordinary manual row, picture copied by the builder (a failure never blocks the add).
        if (target?.kind === "local" && target.onAddHistory) {
          const note = target.onAddHistory(data);
          if (note) setNotice(`Added to the quote. ${note}`);
          else setOpen(false);
          return;
        }
        setNotice("Custom items can be added from the section's own add buttons on this screen.");
      } catch {
        setNotice("This item could not be added.");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      try {
        const result = await deleteClientHistoryAction({ historyId: id });
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        setItems((current) => current?.filter((entry) => entry.id !== id) ?? current);
        setTotal((current) => Math.max(0, current - 1));
        setConfirmId(null);
        setNotice("");
      } catch {
        setNotice("This item could not be removed.");
      }
    });
  }

  const label = shortClientName(name);
  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        disabled={!hasClient}
        title={hasClient ? `Add from ${name} history` : "Select a client first"}
        className="max-w-full border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
      >
        <span className="hidden sm:inline">Add from {label} history</span>
        <span className="sm:hidden">Client history</span>
      </button>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-zinc-950/30 p-0 sm:items-center sm:p-[3vw]">
          <div role="dialog" aria-modal="true" aria-label={`${name} history`} className="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-[90vh] sm:w-[min(1200px,94vw)] sm:max-w-[1200px] sm:rounded-lg sm:border sm:border-zinc-300">
            <div className="sticky top-0 z-10 space-y-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-zinc-950">{name}</h2>
                  <p className="text-xs text-zinc-500">Previously quoted items</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">Close</button>
              </div>
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, brand or code"
                aria-label="Search client history"
                className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
              />
              <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-2">
                {CLIENT_HISTORY_KIND_FILTERS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    aria-pressed={kind === entry.value}
                    onClick={() => setKind(entry.value)}
                    className={`h-8 rounded-full border px-3 text-xs font-semibold transition ${kind === entry.value ? "border-emerald-900 bg-emerald-900 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-emerald-800"}`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
            {notice ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-5">{notice}</p> : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {items === null ? (
                <ul aria-label="Loading" className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {[0, 1, 2, 3].map((slot) => (
                    <li key={slot} className="flex animate-pulse gap-3 rounded-lg border border-zinc-200 bg-white p-3">
                      <div className="h-[88px] w-[88px] shrink-0 rounded-md bg-zinc-100" />
                      <div className="flex-1 space-y-2 pt-1">
                        <div className="h-3 w-2/3 rounded bg-zinc-100" />
                        <div className="h-3 w-1/3 rounded bg-zinc-100" />
                        <div className="h-3 w-3/4 rounded bg-zinc-100" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : error ? (
                <div role="alert" className="rounded-lg border border-dashed border-red-300 px-4 py-8 text-center text-sm text-red-800">
                  <p>{error}</p>
                  <button type="button" onClick={() => setRetryKey((current) => current + 1)} className="mt-3 h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">Retry</button>
                </div>
              ) : items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                  {query.trim() || kind !== "all"
                    ? "No item matches your search."
                    : "Nothing quoted for this client yet. Items appear here after a quotation is sent or confirmed."}
                </p>
              ) : (
                <>
                  <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {items.map((item) => (
                      <HistoryCard
                        key={item.id}
                        busy={pending}
                        clientName={name}
                        confirming={confirmId === item.id}
                        expanded={expandedId === item.id}
                        item={item}
                        onAdd={add}
                        onAskRemove={setConfirmId}
                        onCancelRemove={() => setConfirmId(null)}
                        onRemove={remove}
                        onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
                      />
                    ))}
                  </ul>
                  <div className="mt-4 flex items-center gap-3">
                    {hasMore ? (
                      <button type="button" disabled={loadingMore} onClick={loadMore} className="h-9 rounded-md border border-zinc-300 bg-white px-4 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 disabled:opacity-60">
                        {loadingMore ? "Loading..." : "Load more"}
                      </button>
                    ) : null}
                    <span className="text-xs text-zinc-500">Showing {items.length} of {total}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
