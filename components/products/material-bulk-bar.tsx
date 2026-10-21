"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteMaterialsPermanently, setMaterialsActive } from "@/app/products/materials/actions";
import { materialDeleteSummary, type MaterialDeleteResult } from "@/lib/products/material-delete";
import { readCacheDb } from "@/lib/local-read-cache/db";
import { fetchReadProjection, notifyReadCache } from "@/lib/local-read-cache/runtime";

type Item = { id: string; code: string; name: string; isActive: boolean };
type UpdateResult = Awaited<ReturnType<typeof setMaterialsActive>>["results"][number];
const notReady = "Delete is not ready: the database update has not been applied yet.";
const button = "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";

export function MaterialBulkBar({ groupId, selected, onSelectAll, onClear, onDone, onBusy, onResults, onBanner }: {
  groupId: string; selected: Item[]; onSelectAll: () => void; onClear: () => void; onDone: () => void;
  onBusy: (busy: boolean) => void;
  onResults: (results: Array<MaterialDeleteResult | UpdateResult>) => void;
  onBanner: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const dialog = useRef<HTMLDialogElement>(null);
  const needsTyped = selected.length >= 10 || selected.some((item) => item.isActive);
  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);

  const run = async (kind: "delete" | "activate" | "deactivate") => {
    if (running.current || !selected.length) return;
    if (kind === "delete" && needsTyped && typed !== "DELETE") return;
    running.current = true; setBusy(true); onBusy(true);
    const ids = selected.map((item) => item.id);
    const deleted: MaterialDeleteResult[] = [];
    const updated: UpdateResult[] = [];
    let unavailable = false;
    let interrupted = "";
    setProgress({ done: 0, total: ids.length });
    try {
      for (let offset = 0; offset < ids.length; offset += 50) {
        const chunk = ids.slice(offset, offset + 50);
        if (kind === "delete") {
          const response = await deleteMaterialsPermanently({ groupId, ids: chunk });
          deleted.push(...response.results);
          if (response.results.some((result) => result.status === "error" && result.message === notReady)) { unavailable = true; break; }
        } else updated.push(...(await setMaterialsActive({ groupId, ids: chunk, active: kind === "activate" })).results);
        setProgress({ done: Math.min(offset + chunk.length, ids.length), total: ids.length });
      }
    } catch {
      interrupted = "Could not confirm the action. Refresh the group before trying again.";
      onBanner(interrupted);
    } finally {
      const results = kind === "delete" ? deleted : updated;
      const changed = results.some((result) => result.status === "deleted" || result.status === "updated");
      if (unavailable && !changed) onBanner(notReady);
      else if (results.length) {
        onResults(results);
        const messages = [...new Set([...results.filter((result) => result.status === "error").map((result) => result.message).filter(Boolean), interrupted].filter(Boolean))];
        onBanner(kind === "delete" ? [materialDeleteSummary(deleted), deleted.some((result) => result.status === "in_use") ? "In use by a product template: deactivate instead." : "", ...messages].filter(Boolean).join(" ")
          : `${kind === "activate" ? "Activated" : "Deactivated"} ${updated.filter((result) => result.status === "updated").length}. ${updated.filter((result) => result.status === "error").length} errors. ${updated.filter((result) => result.status === "not_found").length} not found. ${messages.join(" ")}`);
      }
      if (deleted.some((result) => result.status === "deleted")) {
        try {
          const lease = await readCacheDb().boundary.get("active");
          if (!lease) throw new Error("No verified cache session");
          await fetchReadProjection(lease, "materials:library");
          notifyReadCache("materials:library");
        } catch { onBanner(`${materialDeleteSummary(deleted)} Saved offline data could not be refreshed. Use Refresh data when online.`); }
      }
      if (!unavailable || changed) router.refresh();
      setConfirming(false); setTyped("");
      running.current = false; setBusy(false); onBusy(false);
    }
  };

  return <>
    <div className="sticky bottom-2 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-300 bg-white p-3 shadow-lg" aria-label="Bulk material actions">
      <span className="mr-2 text-sm font-semibold" aria-live="polite">{selected.length} selected</span>
      <button type="button" disabled={busy} onClick={onSelectAll} className={button}>Select all shown</button>
      <button type="button" disabled={busy || !selected.length} onClick={onClear} className={button}>Clear</button>
      <button type="button" disabled={busy || !selected.length} onClick={() => void run("deactivate")} className={button}>Deactivate</button>
      <button type="button" disabled={busy || !selected.length} onClick={() => void run("activate")} className={button}>Activate</button>
      <button type="button" disabled={busy || !selected.length} onClick={() => { setTyped(""); setConfirming(true); }} className={`${button} border-red-300 text-red-700`}>Delete permanently</button>
      <button type="button" disabled={busy} onClick={onDone} className={button}>Done</button>
      {busy ? <span role="status" className="w-full text-sm">Processing {progress.done} of {progress.total}…</span> : null}
    </div>
    <dialog ref={dialog} aria-labelledby="material-delete-title" onCancel={(event) => { event.preventDefault(); if (!busy) setConfirming(false); }} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} className="fixed inset-0 z-[90] m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-auto rounded-xl border border-zinc-300 bg-white p-5 shadow-xl backdrop:bg-black/40">
      <h2 id="material-delete-title" className="text-lg font-bold">Delete {selected.length} swatches permanently?</h2>
      <p className="mt-2 text-sm">Their pictures are removed from storage too, unless a saved quotation or template still uses a picture. This cannot be undone.</p>
      <ul className="my-3 space-y-1 text-sm">{selected.slice(0, 5).map((item) => <li key={item.id} className="break-words">{[item.code, item.name].filter(Boolean).join(" | ")}</li>)}</ul>
      {selected.length > 5 ? <p className="text-sm">and {selected.length - 5} more</p> : null}
      {needsTyped ? <label className="mt-3 grid gap-1 text-sm">Type DELETE to confirm<input autoComplete="off" value={typed} disabled={busy} onChange={(event) => setTyped(event.target.value)} className="rounded border border-zinc-300 p-2" /></label> : null}
      {busy ? <p role="status" className="mt-3 text-sm">Deleting {progress.done} of {progress.total}…</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={() => setConfirming(false)} className={button}>Cancel</button><button type="button" disabled={busy || !selected.length || (needsTyped && typed !== "DELETE")} onClick={() => void run("delete")} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Delete permanently</button></div>
    </dialog>
  </>;
}
