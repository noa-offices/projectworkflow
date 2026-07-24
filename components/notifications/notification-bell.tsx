"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import {
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  respondToNotification,
} from "@/lib/notifications/actions";
import {
  getRecentNotificationsWithSenders,
  type EnrichedNotification,
} from "@/components/notifications/notification-queries";
const POLL_MS = 30_000;

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

export function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<EnrichedNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    const res = await getUnreadCount();
    if (res.ok) setCount(res.count);
  }, []);

  const refreshList = useCallback(async () => {
    setLoadingList(true);
    const res = await getRecentNotificationsWithSenders(10);
    if (res.ok) setItems(res.data);
    setLoadingList(false);
  }, []);

  // Badge polling — always active
  useEffect(() => {
    refreshCount();
    const id = window.setInterval(refreshCount, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshCount]);

  // List fetch + polling — only while dropdown is open
  useEffect(() => {
    if (!isOpen) return;
    refreshList();
    const id = window.setInterval(refreshList, POLL_MS);
    return () => window.clearInterval(id);
  }, [isOpen, refreshList]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  async function handleItemClick(item: EnrichedNotification) {
    if (!item.read_at) {
      await markNotificationRead(item.id);
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
      setCount((c) => Math.max(0, c - 1));
    }
    if (item.order_no) {
      setIsOpen(false);
      router.push(item.order_no.startsWith("/") ? item.order_no : `/projects/orders/${item.order_no}`);
    }
  }

  async function handleMarkAll() {
    await markAllNotificationsRead();
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    setCount(0);
  }

  async function handleRespond(notificationId: string, resp: "accepted" | "declined") {
    const result = await respondToNotification(notificationId, resp);
    if (result.ok) {
      setItems((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, response: resp } : n)),
      );
    }
  }

  const badge = count >= 10 ? "9+" : count > 0 ? String(count) : null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}
        onClick={() => setIsOpen((o) => !o)}
        className="relative rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
      >
        <Bell className="h-4 w-4" strokeWidth={2} />
        {badge !== null && (
          <span className="absolute -right-1.5 -top-1.5 flex min-w-[1.1rem] items-center justify-center rounded-full bg-red-500 px-0.5 py-px text-[10px] font-bold leading-none text-white">
            {badge}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-zinc-950">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-xs text-emerald-800 transition hover:text-emerald-900"
              >
                Mark all as read
              </button>
            )}
          </div>

          <ul className="max-h-[360px] divide-y divide-zinc-50 overflow-y-auto">
            {loadingList && items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-zinc-400">Loading…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-zinc-400">
                No notifications yet.
              </li>
            ) : (
              items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full px-4 py-3 text-left transition hover:bg-zinc-50 ${item.read_at ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {!item.read_at && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                      )}
                      <div className={`min-w-0 flex-1 ${item.read_at ? "pl-3.5" : ""}`}>
                        <p
                          className={`break-words text-sm leading-snug text-zinc-800 ${item.read_at ? "" : "font-semibold"}`}
                        >
                          {item.body.length > 90
                            ? `${item.body.slice(0, 90)}…`
                            : item.body}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          {item.sender_name && (
                            <span className="text-xs text-zinc-500">{item.sender_name}</span>
                          )}
                          <span className="text-xs text-zinc-400">
                            {relativeTime(item.created_at)}
                          </span>
                          {item.order_no && (
                            <span className="rounded-full bg-zinc-100 px-2 py-px text-[11px] font-medium text-zinc-600">
                              {item.order_no}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                  {item.requires_response && (
                    <div className="border-t border-zinc-50 px-4 pb-3">
                      {item.response !== null ? (
                        <p className="text-xs font-medium text-zinc-400">
                          {item.response === "accepted"
                            ? "✓ You accepted this"
                            : "✕ You declined this"}
                        </p>
                      ) : (
                        <div className="flex gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => handleRespond(item.id, "accepted")}
                            className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRespond(item.id, "declined")}
                            className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-zinc-100 px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-medium text-emerald-800 transition hover:text-emerald-900"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
