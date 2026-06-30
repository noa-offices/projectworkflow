"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  sendNotification,
  sendNotificationToRole,
} from "@/lib/notifications/actions";
import {
  getActiveProfilesForSelect,
  type ProfileForSelect,
} from "@/lib/notifications/send-form-data";
import type { AppRole } from "@/lib/supabase/types";

const ROLES: { value: AppRole; label: string }[] = [
  { value: "system_owner", label: "System Owner" },
  { value: "admin_manager", label: "Admin Manager" },
  { value: "procurement_manager", label: "Procurement Manager" },
  { value: "sales_designer", label: "Sales Designer" },
  { value: "designer", label: "Designer" },
  { value: "viewer", label: "Viewer" },
];

export function SendNotificationForm({
  onClose,
  onSent,
  initialOrderNo,
}: {
  onClose: () => void;
  onSent: () => void;
  initialOrderNo?: string;
}) {
  const [mode, setMode] = useState<"person" | "role">("person");
  const [profiles, setProfiles] = useState<ProfileForSelect[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [recipientId, setRecipientId] = useState("");
  const [role, setRole] = useState<AppRole>("admin_manager");
  const [body, setBody] = useState("");
  const [orderNo, setOrderNo] = useState(initialOrderNo ?? "");
  const [requiresResponse, setRequiresResponse] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    getActiveProfilesForSelect().then((res) => {
      if (res.ok) setProfiles(res.data);
      setLoadingProfiles(false);
    });
  }, []);

  // Auto-close 1.2s after successful send
  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => {
      onSent();
      onClose();
    }, 1200);
    return () => window.clearTimeout(id);
  }, [success, onSent, onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!body.trim()) {
      setError("Message body is required.");
      return;
    }
    if (mode === "person" && !recipientId) {
      setError("Please select a recipient.");
      return;
    }

    setSending(true);

    const result =
      mode === "person"
        ? await sendNotification(recipientId, body.trim(), orderNo.trim() || undefined, requiresResponse || undefined)
        : await sendNotificationToRole(role, body.trim(), orderNo.trim() || undefined, requiresResponse || undefined);

    setSending(false);

    if (!result.ok) {
      setError(result.error);
    } else {
      setSuccess(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/45 p-4 pt-16">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-950">Send Notification</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-xl leading-none text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            ×
          </button>
        </div>

        {success ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-emerald-800">Notification sent!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => setMode("person")}
                className={`flex-1 rounded-md px-3 py-1.5 transition ${
                  mode === "person"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                Send to a Person
              </button>
              <button
                type="button"
                onClick={() => setMode("role")}
                className={`flex-1 rounded-md px-3 py-1.5 transition ${
                  mode === "role"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                Send to a Role
              </button>
            </div>

            {/* Recipient / Role selector */}
            {mode === "person" ? (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-600">
                  Recipient
                </label>
                {loadingProfiles ? (
                  <p className="text-sm text-zinc-400">Loading users…</p>
                ) : (
                  <select
                    required
                    value={recipientId}
                    onChange={(e) => setRecipientId(e.target.value)}
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="">— Select a person —</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name ?? "Unnamed"}
                        {p.email ? ` (${p.email})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-600">
                  Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as AppRole)}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-600 focus:outline-none"
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Body */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-600">
                Message
              </label>
              <textarea
                required
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
                className="w-full resize-none rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            {/* Optional order_no */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-600">
                Order No.{" "}
                <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                type="text"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="e.g. CO-2024-001"
                className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            {/* Require response toggle */}
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={requiresResponse}
                onChange={(e) => setRequiresResponse(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 accent-emerald-700"
              />
              <span className="text-sm font-medium text-zinc-700">
                Require Accept / Decline response
              </span>
            </label>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
