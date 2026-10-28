"use client";

import { useEffect, useState } from "react";
import { countFinishedRequests, clearFinishedRequests, restoreClearedRequests } from "@/lib/inventory/request-history-actions";
import { RequestDialog } from "./request-dialog";

type Kind = "product" | "movement" | "all";
type Age = 0 | 30 | 90;
const button = "min-h-11 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50";
export function RequestHistoryDialog({ mode, preview, previewCount = 0, onClose, onSuccess }: { mode: "clear" | "restore"; preview: boolean; previewCount?: number; onClose: () => void; onSuccess: (message: string) => void }) {
  const [kind, setKind] = useState<Kind>("all");
  const [age, setAge] = useState<Age>(0);
  const [count, setCount] = useState<number | null>(preview ? previewCount : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "clear" || preview) return;
    let active = true;
    void countFinishedRequests({kind, olderThanDays: age}).then(result => { if (!active) return; if (result.ok) setCount(result.count); else setError(result.error); }).catch(() => { if (active) setError("Could not count requests. Please try again."); });
    return () => { active = false; };
  }, [kind, age, mode, preview]);
  async function submit() {
    setBusy(true); setError("");
    try {
      if (preview) { onSuccess(mode === "clear" ? `${count ?? 0} requests hidden.` : "Cleared requests restored."); return; }
      const result = mode === "clear" ? await clearFinishedRequests({kind, olderThanDays: age}) : await restoreClearedRequests({kind: "all"});
      if (!result.ok) { setError(result.error); return; }
      onSuccess(mode === "clear" ? `${result.count} requests hidden.` : `${result.count} requests restored.`);
    } catch { setError("Could not update requests. Please try again."); } finally { setBusy(false); }
  }
  return <RequestDialog title={mode === "clear" ? "Clear history" : "Restore all cleared"} onClose={onClose} busy={busy}>
    <div className="space-y-4">
      {mode === "clear" ? <>
        <label className="block text-sm font-medium text-zinc-700">Requests<select value={kind} onChange={event => { setCount(preview ? previewCount : null); setError(""); setKind(event.target.value as Kind); }} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3"><option value="product">Product requests</option><option value="movement">Movement requests</option><option value="all">Both</option></select></label>
        <label className="block text-sm font-medium text-zinc-700">Older than<select value={age} onChange={event => { setCount(preview ? previewCount : null); setError(""); setAge(Number(event.target.value) as Age); }} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-3"><option value="0">All</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
        {count === null ? <p role="status">Counting finished requests...</p> : <p>Hide {count} finished requests? Pending requests are not affected. Stock numbers and the movements history are not changed. You can show them again with Show cleared.</p>}
      </> : <p>Restore all cleared requests to the list?</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-3"><button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || (mode === "clear" && (count === null || count === 0))} onClick={submit}>{busy ? "Saving..." : mode === "clear" ? "Hide requests" : "Restore all"}</button></div>
    </div>
  </RequestDialog>;
}
