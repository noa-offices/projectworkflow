"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Eye, EyeOff, FolderPlus, Pencil, Plus } from "lucide-react";
import { createCategory, setCategoryActive, updateCategory } from "@/lib/inventory/actions";
import { categoryNameError, categorySiblings, categoryVisibilityLabel } from "@/lib/inventory/category-form";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";
import { formatInventoryNumber } from "@/lib/inventory/presentation";
import type { InventoryCategoryOverview } from "@/lib/inventory/types";
import { RequestDialog } from "./request-dialog";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50";
type Dialog = { kind: "add" } | { kind: "sub"; parent: InventoryCategoryOverview } | { kind: "rename"; node: InventoryCategoryOverview; parentId: string | null };

export function CategoryManager({ categories, role, preview = false, initialDialog = null }: { categories: InventoryCategoryOverview[]; role: string | null; preview?: boolean; initialDialog?: "add" | null }) {
  const router = useRouter(), lock = useRef(false);
  const [dialog, setDialog] = useState<Dialog | null>(initialDialog === "add" ? { kind: "add" } : null);
  const [name, setName] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  if (!canUseManagerMovements(role)) return <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">You do not have permission to manage categories.</p>;

  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await work();
      if (!response.ok) { setError(response.error); return false; }
      setMessage(preview ? `${done} (preview only, nothing was saved)` : done);
      if (!preview) router.refresh();
      return true;
    } catch { setError("Something went wrong. Please try again."); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  function open(next: Dialog) { setDialog(next); setName(next.kind === "rename" ? next.node.name : ""); setError(""); setMessage(""); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    const parentId = dialog.kind === "add" ? null : dialog.kind === "sub" ? dialog.parent.id : dialog.parentId;
    const problem = categoryNameError(name, categorySiblings(categories, parentId), dialog.kind === "rename" ? dialog.node.id : undefined);
    if (problem) { setError(problem); return; }
    const text = name.trim();
    const ok = await run(() => preview ? Promise.resolve({ ok: true as const }) : dialog.kind === "rename" ? updateCategory({ categoryId: dialog.node.id, patch: { name: text } }) : createCategory({ name: text, parentId }),
      dialog.kind === "rename" ? "Category renamed." : dialog.kind === "sub" ? "Subcategory added." : "Category added.");
    if (ok) setDialog(null);
  }
  const toggle = (node: InventoryCategoryOverview) => run(() => preview ? Promise.resolve({ ok: true as const }) : setCategoryActive({ categoryId: node.id, active: !node.is_active }), node.is_active ? "Category hidden." : "Category shown.");
  const row = (node: InventoryCategoryOverview, parentId: string | null, child: boolean) => <div className={`min-w-0 space-y-2 ${child ? "rounded-md border border-zinc-100 bg-zinc-50 p-3" : ""}`}>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><p className={`break-words font-semibold ${node.is_active ? "text-zinc-950" : "text-zinc-500"}`}>{node.name}</p>
        <p className="text-sm text-zinc-600">{formatInventoryNumber(node.item_count)} {node.item_count === 1 ? "item" : "items"} · <span className={node.is_active ? "text-emerald-800" : "text-amber-800"}>{categoryVisibilityLabel(node.is_active)}</span></p></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => open({ kind: "rename", node, parentId })} className={button}><Pencil size={16} aria-hidden="true" />Rename</button>
      <button type="button" disabled={busy} onClick={() => toggle(node)} className={button}>{node.is_active ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{node.is_active ? "Hide" : "Show"}</button>
      {!child && <button type="button" disabled={busy} onClick={() => open({ kind: "sub", parent: node })} className={button}><Plus size={16} aria-hidden="true" />Add subcategory</button>}
    </div>
  </div>;
  return <div className="min-w-0 space-y-4">
    <header className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Categories</h1><p className="text-sm text-zinc-600">Hidden categories stay on existing items but cannot be chosen for new ones. Categories are never deleted.</p></header>
    <button type="button" disabled={busy} onClick={() => open({ kind: "add" })} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white hover:bg-emerald-800 sm:w-auto"><FolderPlus size={18} aria-hidden="true" />Add category</button>
    {message && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">{message}</p>}
    {error && !dialog && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {categories.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">No categories yet.</p> : <ul className="grid min-w-0 gap-3 md:grid-cols-2" aria-label="Categories">
      {categories.map(node => <li key={node.id} className="min-w-0 space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        {row(node, null, false)}
        {node.children.length > 0 && <ul className="space-y-2" aria-label={`${node.name} subcategories`}>{node.children.map(childNode => <li key={childNode.id}>{row(childNode, node.id, true)}</li>)}</ul>}
      </li>)}
    </ul>}
    {dialog && <RequestDialog title={dialog.kind === "rename" ? "Rename category" : dialog.kind === "sub" ? "Add subcategory" : "Add category"} busy={busy} onClose={() => setDialog(null)}>
      <form onSubmit={submit} className="min-w-0 space-y-4">
        {dialog.kind === "sub" && <p className="text-sm text-zinc-600">Inside {dialog.parent.name}</p>}
        <label className="block text-sm font-medium text-zinc-800">Name *<input required autoFocus maxLength={200} value={name} disabled={busy} onChange={event => { setName(event.target.value); setError(""); }} className="mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base" /></label>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} onClick={() => setDialog(null)} className={button}>Cancel</button><button type="submit" disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </RequestDialog>}
  </div>;
}
