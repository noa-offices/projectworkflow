"use client";

import { useEffect, useRef, useState } from "react";
import { useEscapeLayer } from "@/components/products/escape-layer";
import { searchShareTargetsAction, sendShareAction } from "@/lib/products/saved-setups/shares-actions";
import { SHARE_NOTE_MAX, SHARE_TARGET_QUERY_MIN, sharePriceNotice, type ShareKind, type ShareTarget } from "@/lib/products/saved-setups/shares";

const secondaryButton =
  "h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60";
const primaryButton =
  "h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300";
const SEARCH_DELAY_MS = 300;

// "Share" on a card of the My Collection page: opens a small dialog to send a COPY to another user. Search shows names only
// (never emails). A custom item shares its price and picture; a setup never carries a price. Everything goes through
// sendShareAction / searchShareTargetsAction (authenticated on the server); the dialog only shows what they return.
export function ShareControl({ kind, itemId, itemName, priceItem = null }: { kind: ShareKind; itemId: string; itemName: string; priceItem?: { currency: string; sellingPrice: number } | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<ShareTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ShareTarget | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ name: string; warning: string } | null>(null);
  const sendingRef = useRef(false); // a second click while sending does nothing
  const searchId = useRef(0);

  function close() {
    setOpen(false);
  }
  function openDialog() {
    setQuery("");
    setTargets([]);
    setSelected(null);
    setNote("");
    setError("");
    setDone(null);
    setOpen(true);
  }
  // Inside the My Collection popup Escape closes this dialog first; on the page the dialog handles Escape itself (below).
  useEscapeLayer(open, close);

  // Debounced name search: at least 2 letters, 300 ms after the last key.
  useEffect(() => {
    const text = query.trim();
    if (!open || selected || text.length < SHARE_TARGET_QUERY_MIN) return;
    const handle = window.setTimeout(async () => {
      const id = ++searchId.current;
      setSearching(true);
      const result = await searchShareTargetsAction(text);
      if (id !== searchId.current) return; // an older search finished late
      setSearching(false);
      if (result.ok) {
        setTargets(result.targets);
        setError("");
      } else {
        setTargets([]);
        setError(result.message);
      }
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [query, open, selected]);

  async function send() {
    if (sendingRef.current || !selected) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      const result = await sendShareAction({ kind, itemId, recipientId: selected.id, note: note.trim() || null });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone({ name: selected.displayName, warning: result.pictureNote ?? "" });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const visibleTargets = query.trim().length >= SHARE_TARGET_QUERY_MIN ? targets : [];

  return (
    <>
      <button type="button" onClick={(event) => { event.stopPropagation(); openDialog(); }} aria-label={`Share ${itemName}`} className={secondaryButton}>Share</button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-stretch justify-center bg-zinc-950/30 p-0 sm:items-center sm:p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={`Share ${itemName}`} className="flex h-full w-full flex-col gap-4 overflow-y-auto bg-white p-4 text-left shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-lg sm:border sm:border-zinc-300">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-950">Share with a colleague</h2>
                <p className="mt-1 break-words text-xs text-zinc-500">{itemName}</p>
              </div>
              <button type="button" onClick={close} className={secondaryButton}>Close</button>
            </div>

            {done ? (
              <div className="space-y-3">
                <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Sent to {done.name}</p>
                {done.warning ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Sent, but the picture could not be included: {done.warning}</p> : null}
                <button type="button" onClick={close} className={primaryButton}>Done</button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <div>
                  <label htmlFor={`share-to-${itemId}`} className="mb-1 block text-xs font-semibold text-zinc-600">Send to</label>
                  {selected ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                      <span className="truncate font-semibold">{selected.displayName}</span>
                      <button type="button" onClick={() => { setSelected(null); setQuery(""); setTargets([]); }} className="shrink-0 text-xs font-semibold underline">Change</button>
                    </div>
                  ) : (
                    <>
                      <input
                        id={`share-to-${itemId}`}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Type at least 2 letters of a name"
                        autoComplete="off"
                        autoFocus
                        className="h-9 w-full rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                      />
                      <ul aria-label="People" className="mt-1 max-h-44 overflow-y-auto rounded-md border border-zinc-200 empty:hidden">
                        {visibleTargets.map((target) => (
                          <li key={target.id}>
                            <button type="button" onClick={() => { setSelected(target); setError(""); }} className="w-full px-3 py-2 text-left text-sm text-zinc-800 transition hover:bg-emerald-50 focus-visible:bg-emerald-50">{target.displayName}</button>
                          </li>
                        ))}
                      </ul>
                      {searching ? <p className="mt-1 text-xs text-zinc-500">Searching...</p> : null}
                      {!searching && query.trim().length >= SHARE_TARGET_QUERY_MIN && visibleTargets.length === 0 && !error ? <p className="mt-1 text-xs text-zinc-500">No one found.</p> : null}
                    </>
                  )}
                </div>

                <div>
                  <label htmlFor={`share-note-${itemId}`} className="mb-1 block text-xs font-semibold text-zinc-600">Note (optional)</label>
                  <textarea
                    id={`share-note-${itemId}`}
                    value={note}
                    maxLength={SHARE_NOTE_MAX}
                    rows={3}
                    onChange={(event) => setNote(event.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                  />
                  <p className="mt-1 text-right text-[11px] text-zinc-500">{note.length}/{SHARE_NOTE_MAX}</p>
                </div>

                <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-700">{sharePriceNotice(kind, priceItem)}</p>

                {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
                <div className="flex gap-2">
                  <button type="submit" disabled={sending || !selected} className={primaryButton}>{sending ? "Sending..." : "Send"}</button>
                  <button type="button" disabled={sending} onClick={close} className={secondaryButton}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
