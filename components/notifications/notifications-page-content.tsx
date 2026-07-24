"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  markNotificationRead,
  markAllNotificationsRead,
  respondToNotification,
} from "@/lib/notifications/actions";
import {
  getRecentNotificationsWithSenders,
  type EnrichedNotification,
} from "@/components/notifications/notification-queries";

const HISTORY_LIMIT = 100;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationsPageContent({
  refreshTrigger,
}: {
  refreshTrigger?: number;
} = {}) {
  const router = useRouter();
  const [items, setItems] = useState<EnrichedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const res = await getRecentNotificationsWithSenders(HISTORY_LIMIT);
    if (res.ok) {
      setItems(res.data);
      setFetchError(null);
    } else {
      setFetchError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems, refreshTrigger]);

  async function handleItemClick(item: EnrichedNotification) {
    if (!item.read_at) {
      await markNotificationRead(item.id);
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
    }
    if (item.order_no) {
      router.push(item.order_no.startsWith("/") ? item.order_no : `/projects/orders/${item.order_no}`);
    }
  }

  async function handleMarkAll() {
    await markAllNotificationsRead();
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
  }

  async function handleRespond(notificationId: string, resp: "accepted" | "declined") {
    const result = await respondToNotification(notificationId, resp);
    if (result.ok) {
      setItems((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, response: resp } : n)),
      );
    }
  }

  const unreadCount = items.filter((n) => !n.read_at).length;

  if (loading) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-zinc-400">Loading notifications…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-red-600">{fetchError}</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      {/* Toolbar row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {items.length === 0 ? (
            "No notifications yet."
          ) : (
            <>
              {items.length} notification{items.length !== 1 ? "s" : ""}
              {unreadCount > 0 ? (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  {unreadCount} unread
                </span>
              ) : null}
            </>
          )}
        </p>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            className="text-sm font-medium text-emerald-800 transition hover:text-emerald-900"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Notification list */}
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleItemClick(item)}
                className={`w-full px-5 py-4 text-left transition hover:bg-zinc-50 ${item.read_at ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-3">
                  {/* Read/unread dot */}
                  {!item.read_at ? (
                    <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                  ) : (
                    <span className="mt-[5px] h-2 w-2 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    {/* Full body — not truncated on full page */}
                    <p
                      className={`text-sm leading-relaxed text-zinc-800 ${item.read_at ? "" : "font-semibold"}`}
                    >
                      {item.body}
                    </p>

                    {/* Meta row */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {item.sender_name && (
                        <span className="text-xs text-zinc-500">
                          From: {item.sender_name}
                        </span>
                      )}
                      <span className="text-xs text-zinc-400">
                        {relativeTime(item.created_at)} &middot; {absoluteTime(item.created_at)}
                      </span>
                      {item.order_no && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
                          {item.order_no}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Accept/Decline response controls — sibling of the body button,
                  not nested inside it (no button-in-button). Tracked independently
                  of read/unread state per spec. */}
              {item.requires_response && (
                <div className="border-t border-zinc-50 px-5 pb-4">
                  {item.response !== null ? (
                    <p className="text-sm font-medium text-zinc-400">
                      {item.response === "accepted"
                        ? "✓ You accepted this"
                        : "✕ You declined this"}
                    </p>
                  ) : (
                    <div className="flex gap-2 pt-3">
                      <button
                        type="button"
                        onClick={() => handleRespond(item.id, "accepted")}
                        className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRespond(item.id, "declined")}
                        className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Cap notice */}
      {items.length >= HISTORY_LIMIT && (
        <p className="mt-4 text-center text-xs text-zinc-400">
          Showing the most recent {HISTORY_LIMIT} notifications.
        </p>
      )}
    </div>
  );
}
