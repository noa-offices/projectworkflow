"use client";

import { useCallback, useEffect, useState } from "react";
import { NotificationsPageContent } from "@/components/notifications/notifications-page-content";
import { SendNotificationForm } from "@/components/notifications/send-notification-form";
import {
  getSentNotificationsEnriched,
  type EnrichedDirectSent,
  type EnrichedBroadcastSummary,
} from "@/lib/notifications/send-form-data";

type Tab = "received" | "sent";

// ─── Shared time helpers ─────────────────────────────────────────────────────

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

// ─── Response status label helpers ───────────────────────────────────────────

function responseLabel(response: "accepted" | "declined" | null): string {
  if (response === "accepted") return "✓ Accepted";
  if (response === "declined") return "✕ Declined";
  return "Pending";
}

function responseLabelClass(response: "accepted" | "declined" | null): string {
  if (response === "accepted") return "text-emerald-700";
  if (response === "declined") return "text-red-600";
  return "text-amber-600";
}

// ─── Sent tab ────────────────────────────────────────────────────────────────

// SentTab remounts on every tab switch (conditional render), so fetch-on-mount
// always shows fresh data without needing a separate refresh trigger.
function SentTab() {
  const [direct, setDirect] = useState<EnrichedDirectSent[]>([]);
  const [broadcasts, setBroadcasts] = useState<EnrichedBroadcastSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks which broadcast indices have their per-recipient breakdown expanded
  const [expandedBroadcasts, setExpandedBroadcasts] = useState<Set<number>>(new Set());

  const fetchSent = useCallback(async () => {
    setLoading(true);
    const res = await getSentNotificationsEnriched();
    if (res.ok) {
      setDirect(res.data.direct);
      setBroadcasts(res.data.broadcasts);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSent();
  }, [fetchSent]);

  function toggleBroadcastExpanded(idx: number) {
    setExpandedBroadcasts((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-zinc-400">Loading sent notifications…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const hasContent = direct.length > 0 || broadcasts.length > 0;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      {!hasContent ? (
        <p className="text-sm text-zinc-400">No notifications sent yet.</p>
      ) : (
        <div className="space-y-6">
          {broadcasts.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Role Broadcasts
              </h3>
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                {broadcasts.map((b, i) => {
                  const isExpanded = expandedBroadcasts.has(i);
                  return (
                    <li key={i} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-relaxed text-zinc-800">{b.body}</p>

                          {/* Pills + timestamp row */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                              {b.sent_to_role}
                            </span>
                            {b.order_no && (
                              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
                                {b.order_no}
                              </span>
                            )}
                            <span className="text-xs text-zinc-400">
                              {relativeTime(b.created_at)} &middot;{" "}
                              {absoluteTime(b.created_at)}
                            </span>
                          </div>

                          {/* Response tally + breakdown — only when requires_response */}
                          {b.requires_response && (
                            <div className="mt-2.5">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="text-xs font-medium text-emerald-700">
                                  {b.accepted_count} accepted
                                </span>
                                <span className="text-xs text-zinc-300" aria-hidden="true">·</span>
                                <span className="text-xs font-medium text-red-600">
                                  {b.declined_count} declined
                                </span>
                                <span className="text-xs text-zinc-300" aria-hidden="true">·</span>
                                <span className="text-xs font-medium text-amber-600">
                                  {b.pending_count} pending
                                </span>
                                {b.recipients.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleBroadcastExpanded(i)}
                                    className="text-xs font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-700"
                                  >
                                    {isExpanded ? "Hide responses" : "Show responses"}
                                  </button>
                                )}
                              </div>

                              {isExpanded && (
                                <ul className="mt-2 space-y-1 rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
                                  {b.recipients.map((r, j) => (
                                    <li key={j} className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-zinc-600">
                                        {r.recipient_name ?? "Unknown"}
                                      </span>
                                      <span
                                        className={`text-xs font-semibold ${responseLabelClass(r.response)}`}
                                      >
                                        {responseLabel(r.response)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Read count badge — always shown */}
                        <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600">
                          {b.read_count} / {b.total} read
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {direct.length > 0 && (
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Direct Sends
              </h3>
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                {direct.map((item) => (
                  <li key={item.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-zinc-800">{item.body}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {item.recipient_name && (
                            <span className="text-xs text-zinc-500">
                              To: {item.recipient_name}
                            </span>
                          )}
                          <span className="text-xs text-zinc-400">
                            {relativeTime(item.created_at)} &middot;{" "}
                            {absoluteTime(item.created_at)}
                          </span>
                          {item.order_no && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
                              {item.order_no}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status badge: response status when requires_response, else read/unread */}
                      {item.requires_response ? (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            item.response === "accepted"
                              ? "bg-emerald-100 text-emerald-700"
                              : item.response === "declined"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {item.response === "accepted"
                            ? "Accepted"
                            : item.response === "declined"
                              ? "Declined"
                              : "Pending response"}
                        </span>
                      ) : (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            item.read_at
                              ? "bg-zinc-100 text-zinc-500"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {item.read_at ? "Read" : "Unread"}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main exported tabs shell ────────────────────────────────────────────────

export function NotificationsTabs({ canSend }: { canSend: boolean }) {
  const [tab, setTab] = useState<Tab>("received");
  const [showForm, setShowForm] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  function handleSent() {
    // Increment trigger to re-fetch the Received tab, then switch to it
    setRefreshTrigger((n) => n + 1);
    setTab("received");
  }

  return (
    <>
      {canSend && showForm && (
        <SendNotificationForm
          onClose={() => setShowForm(false)}
          onSent={handleSent}
        />
      )}

      <div className="px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          {/* Tab selector */}
          <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
            <button
              type="button"
              onClick={() => setTab("received")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                tab === "received"
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Received
            </button>
            <button
              type="button"
              onClick={() => setTab("sent")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                tab === "sent"
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Sent
            </button>
          </div>

          {/* New notification button */}
          {canSend ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              <span aria-hidden="true">+</span> New
            </button>
          ) : null}
        </div>
      </div>

      {tab === "received" ? (
        <NotificationsPageContent refreshTrigger={refreshTrigger} />
      ) : (
        <SentTab />
      )}
    </>
  );
}
