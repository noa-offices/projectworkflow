"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Ellipsis, LayoutGrid, List, Plus, Search } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { confirmMaterialReview, setMaterialsActive } from "@/app/products/materials/actions";
import { MaterialBulkBar } from "@/components/products/material-bulk-bar";
import { BatchMaterialDialogButton, MaterialDialogButton, type MaterialSubgroupOption } from "@/components/products/material-library-dialogs";
import { PdfMaterialImport } from "@/components/products/pdf-material-import";
import { SwatchViewerPanel } from "@/components/products/swatch-viewer-panel";
import { sortMaterials, type MaterialSortMode } from "@/lib/products/material-sort";

export type MaterialGroupCard = {
  count: number;
  editable: boolean;
  grade: string;
  id: string;
  isActive: boolean;
  name: string;
  needsReview: number;
  sortOrder: number;
  thumbs: Array<string | null>;
  title: string;
};
export type MaterialGroupSwatch = {
  code: string;
  createdAt: string;
  grade: string;
  id: string;
  isActive: boolean;
  name: string;
  needsReview: boolean;
  record: {
    color_family: string | null;
    description: string | null;
    id: string;
    image_url: string | null;
    is_active: boolean;
    material_category: string | null;
    material_code: string | null;
    material_collection: string | null;
    material_group_id: string;
    material_name: string;
    sort_order: number;
    subgroup_id: string | null;
  };
  url: string | null;
};

type FormAction = (formData: FormData) => void | Promise<void>;

const field = "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const outlineButton = "inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50";

function Img({ url, className }: { className: string; url: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" decoding="async" className={className} /> : null;
}

export function MaterialGroupView({
  activateSubgroupAction,
  brandId,
  brandName,
  cards,
  createSubgroupAction,
  deactivateMaterialAction,
  deactivateSubgroupAction,
  group,
  message,
  mode,
  needsReviewCount,
  sub,
  subgroupOptions,
  swatches,
  updateGroupAction,
  updateSubgroupAction,
}: {
  activateSubgroupAction: FormAction;
  brandId: string;
  brandName: string;
  cards: MaterialGroupCard[];
  createSubgroupAction: FormAction;
  deactivateMaterialAction: FormAction;
  deactivateSubgroupAction: FormAction;
  group: { description: string; id: string; isActive: boolean; name: string; sortOrder: number };
  message: string;
  mode: "cards" | "swatches";
  needsReviewCount: number;
  sub: { grade: string; id: string; name: string; title: string } | null;
  subgroupOptions: MaterialSubgroupOption[];
  swatches: MaterialGroupSwatch[];
  updateGroupAction: FormAction;
  updateSubgroupAction: FormAction;
}) {
  const [search, setSearch] = useState("");
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [subFormOpen, setSubFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkBanner, setBulkBanner] = useState("");
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const anchor = useRef<string | null>(null);
  const scope = `${group.id}:${sub?.id ?? ""}`;
  const [selectionScope, setSelectionScope] = useState(scope);
  if (selectionScope !== scope) {
    setSelectionScope(scope); setSelectedIds(new Set()); setEditing(false); setBlocked({}); setBulkBanner("");
  }
  const doneEditing = () => { setEditing(false); setSelectedIds(new Set()); anchor.current = null; };
  // While the PDF side panel is open the page keeps this much space on the right, so nothing is hidden behind it.
  const [panelPadding, setPanelPadding] = useState(0);
  const [viewerPadding, setViewerPadding] = useState(0);
  const [viewerId, setViewerId] = useState("");
  const [minimizePdf, setMinimizePdf] = useState(0);
  // Sort lives in the URL (?sort=name|recent); the default, code order, adds no param.
  const sortParam = useSearchParams().get("sort");
  const [sort, setSort] = useState<MaterialSortMode>(sortParam === "name" || sortParam === "recent" ? sortParam : "code");
  const changeSort = (next: MaterialSortMode) => {
    setSort(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "code") params.delete("sort");
    else params.set("sort", next);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  };
  const openViewer = (id: string) => {
    setViewerId(id);
    if (importOpen) setMinimizePdf((count) => count + 1);
  };

  const groupPath = `/products/materials/groups/${group.id}`;
  // The library with this brand already open (same libBrand param the overview uses).
  const brandHref = `/products/materials?libBrand=${encodeURIComponent(brandId)}`;
  const returnTo = sub ? `${groupPath}?sub=${encodeURIComponent(sub.id)}` : groupPath;
  const groups = [{ id: group.id, group_name: group.name }];
  // New materials get the group (and, inside a sub-group, its grade/collection text) pre-filled; the dialogs save exactly as before.
  const prefill = { groupId: group.id, ...(sub && sub.id !== "none" ? { collection: sub.name, grade: sub.grade || undefined, subgroupId: sub.id } : {}) };
  const addMaterialClass = "inline-flex h-10 items-center justify-center rounded-lg border border-emerald-900 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50";

  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sortMaterials(
      swatches.filter((item) => (showInactive || item.isActive) && words.every((word) => `${item.code} ${item.name}`.toLowerCase().includes(word))),
      sort,
    );
  }, [search, showInactive, sort, swatches]);
  const selectAll = () => { setSelectedIds(new Set(visible.map((item) => item.id))); anchor.current = null; };
  const toggleSelection = (id: string, shift: boolean) => {
    if (bulkBusy) return;
    const from = visible.findIndex((item) => item.id === anchor.current), to = visible.findIndex((item) => item.id === id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (shift && from >= 0 && to >= 0) for (const item of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(item.id);
      else if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    anchor.current = id;
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (!editing || bulkBusy || event.defaultPrevented || document.querySelector("dialog[open], [aria-modal='true']") ||
        (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectAll(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const selectionBox = (item: MaterialGroupSwatch) => editing ? <input type="checkbox" aria-label={`Select ${item.code} ${item.name}`} checked={selectedIds.has(item.id)} disabled={bulkBusy} onChange={() => undefined} onClick={(event) => toggleSelection(item.id, event.shiftKey)} className="absolute left-1.5 top-1.5 z-10 h-5 w-5 accent-emerald-800" /> : null;
  const subgroupLabels = Object.fromEntries(subgroupOptions.map((option) => [option.id, option.label]));
  const inactiveCount = swatches.filter((item) => !item.isActive).length;
  const [showInactiveSubgroups, setShowInactiveSubgroups] = useState(false);
  const inactiveSubgroups = cards.filter((card) => !card.isActive).length;
  const visibleCards = cards.filter((card) => card.isActive || showInactiveSubgroups);

  // Small Edit link (opens the Edit material dialog, with the sub-group picker so the material can be moved) and Deactivate.
  const rowActions = (item: MaterialGroupSwatch) => editing ? (
    <fieldset disabled={bulkBusy} className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs disabled:opacity-40">
      {item.needsReview ? (
        <form action={confirmMaterialReview}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <button type="submit" className="font-semibold text-amber-800 hover:underline">Confirm</button>
        </form>
      ) : null}
      <MaterialDialogButton brandId={brandId} brandName={brandName} groups={groups} material={item.record} returnTo={returnTo} subgroups={subgroupOptions} title={`Edit Material - ${item.name}`} triggerClassName="font-semibold text-emerald-900 hover:underline" triggerLabel="Edit" />
      {item.isActive ? (
        <form action={deactivateMaterialAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton message="Deactivate this material? It stays stored and can be shown again with inactive records." className="font-semibold text-red-700 hover:underline">Deactivate</ConfirmSubmitButton>
        </form>
      ) : <button type="button" onClick={async () => {
        setBulkBusy(true);
        try {
          const response = await setMaterialsActive({ groupId: group.id, ids: [item.id], active: true });
          const result = response.results[0];
          setBulkBanner(result?.status === "updated" ? "Material activated." : result?.message || "Material could not be activated.");
          if (result?.status === "updated") { setSelectedIds(new Set()); router.refresh(); }
        } catch { setBulkBanner("Material could not be activated."); }
        finally { setBulkBusy(false); }
      }} className="font-semibold text-emerald-900 hover:underline">Activate</button>}
    </fieldset>
  ) : null;

  const subForm = (
    <form action={createSubgroupAction} className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:max-w-md">
      <input type="hidden" name="material_group_id" value={group.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Sub-group name
        <input name="name" required placeholder="Crepe" className={`${field} normal-case`} />
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Grade (optional)
        <input name="grade" placeholder="CAT B" className={`${field} normal-case`} />
      </label>
      <div className="flex flex-wrap gap-2">
        <PendingSubmitButton className="h-10 rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800" pendingLabel="Creating...">Add sub-group</PendingSubmitButton>
        <button type="button" onClick={() => setSubFormOpen(false)} className={outlineButton}>Cancel</button>
      </div>
    </form>
  );

  return (
    <div className="space-y-5 px-4 py-5 sm:px-8 sm:py-6" style={panelPadding + viewerPadding ? { paddingRight: panelPadding + viewerPadding + 16 } : undefined}>
      <Link href={sub ? groupPath : brandHref} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-900 hover:text-emerald-800">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {sub ? `Back to ${group.name}` : `Back to ${brandName}`}
      </Link>

      {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{message}</p> : null}
      {bulkBanner ? <p role="status" className="break-words rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{bulkBanner}</p> : null}

      <header className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-zinc-950 sm:text-3xl">{group.name}</h1>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${group.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-zinc-100 text-zinc-600"}`}>{group.isActive ? "Active" : "Inactive"}</span>
          {needsReviewCount > 0 ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Needs review {needsReviewCount}</span> : null}
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500"><Link href={brandHref} className="hover:underline">{brandName}</Link></p>
        {group.description ? <p className="max-w-2xl text-sm text-zinc-600">{group.description}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <details className="relative">
            <summary className={`${outlineButton} cursor-pointer list-none`}>Edit group</summary>
            <form action={updateGroupAction} className="absolute left-0 z-30 mt-2 grid w-[min(420px,calc(100vw-2rem))] gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg">
              <input type="hidden" name="id" value={group.id} />
              <input type="hidden" name="brand_id" value={brandId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Group name
                <input name="group_name" required defaultValue={group.name} className={`${field} normal-case`} />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Sort order
                <input name="sort_order" type="number" defaultValue={group.sortOrder} className={`${field} normal-case`} />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Description
                <textarea name="description" rows={2} defaultValue={group.description} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm normal-case outline-none focus:border-emerald-800" />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" name="is_active" defaultChecked={group.isActive} /> Active</label>
              <PendingSubmitButton className="h-10 rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800" pendingLabel="Saving group...">Save group</PendingSubmitButton>
            </form>
          </details>
          <button type="button" onClick={() => setSubFormOpen((open) => !open)} className={outlineButton}>+ Add sub-group</button>
          <MaterialDialogButton brandId={brandId} brandName={brandName} groups={groups} prefill={prefill} returnTo={returnTo} subgroups={subgroupOptions} title={`Add Material - ${group.name}`} triggerClassName={addMaterialClass} triggerLabel="+ Add material" />
          <BatchMaterialDialogButton brandId={brandId} brandName={brandName} groups={groups} prefill={prefill} returnTo={returnTo} subgroups={subgroupOptions} triggerClassName={outlineButton} triggerLabel="Batch add materials" />
          <button type="button" onClick={() => setImportOpen(true)} className={outlineButton}>Import from PDF</button>
          <button type="button" disabled={bulkBusy} aria-pressed={editing} onClick={() => editing ? doneEditing() : setEditing(true)} className={`${outlineButton} ${editing ? "border-emerald-800 bg-emerald-100 text-emerald-950" : ""}`}>{editing ? "Done" : "Edit"}</button>
          <Link href={`/products/materials?brand=${encodeURIComponent(brandId)}&group=${encodeURIComponent(group.id)}&open=1`} className="ml-auto text-xs font-semibold text-zinc-500 underline hover:text-zinc-800">Classic view</Link>
        </div>
        {subFormOpen ? subForm : null}
      </header>

      {viewerId && mode === "swatches" ? (
        <SwatchViewerPanel
          brandId={brandId}
          brandName={brandName}
          confirmAction={confirmMaterialReview}
          editMode={editing}
          deactivateAction={deactivateMaterialAction}
          groups={groups}
          items={visible}
          onClose={() => { setViewerId(""); setViewerPadding(0); }}
          onLayout={setViewerPadding}
          onSelect={setViewerId}
          returnTo={returnTo}
          selectedId={viewerId}
          subgroupLabels={subgroupLabels}
          subgroupOptions={subgroupOptions}
        />
      ) : null}

      {importOpen ? (
        <PdfMaterialImport
          brandId={brandId}
          currentSubgroupId={sub && sub.id !== "none" ? sub.id : ""}
          existingMaterials={swatches.filter((item) => item.isActive).map((item) => ({ code: item.code, label: (item.record.subgroup_id ? subgroupLabels[item.record.subgroup_id] ?? "" : "").replace(" · ", " - "), subgroupId: item.record.subgroup_id }))}
          groupId={group.id}
          groupName={group.name}
          brandName={brandName}
          onClose={() => { setImportOpen(false); setPanelPadding(0); }}
          minimizeToken={minimizePdf}
          onLayout={setPanelPadding}
          returnTo={returnTo}
          subgroupOptions={subgroupOptions}
        />
      ) : null}

      {mode === "cards" ? (
        <div className="space-y-3">
        {inactiveSubgroups ? (
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={showInactiveSubgroups} onChange={(event) => setShowInactiveSubgroups(event.target.checked)} /> Show inactive ({inactiveSubgroups})
          </label>
        ) : null}
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
          {visibleCards.map((card) => (
            <div key={card.id} className={`relative flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm transition hover:border-zinc-300 hover:shadow-md ${card.isActive ? "" : "opacity-60"}`}>
              <Link href={`${groupPath}?sub=${encodeURIComponent(card.id)}`} className="grid gap-3">
                <div className="grid aspect-square grid-cols-2 gap-1 overflow-hidden rounded-xl bg-zinc-100">
                  {[0, 1, 2, 3].map((index) => (
                    <span key={index} className="relative overflow-hidden bg-zinc-200/70">
                      <Img url={card.thumbs[index] ?? null} className="absolute inset-0 h-full w-full object-cover" />
                    </span>
                  ))}
                </div>
                <div>
                  <p className="pr-8 font-bold text-zinc-950">{card.title}</p>
                  <p className="text-sm text-zinc-500">{card.count} {card.count === 1 ? "material" : "materials"}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {card.needsReview > 0 ? <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900">Needs review {card.needsReview}</span> : null}
                    {card.isActive ? null : <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">Inactive</span>}
                  </div>
                </div>
              </Link>
              {editing && card.editable ? (
                <details className="absolute right-2 top-2 z-10">
                  <summary aria-label="Sub-group actions" className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg bg-white/90 text-zinc-600 shadow-sm hover:bg-white"><Ellipsis aria-hidden="true" className="h-4 w-4" /></summary>
                  <div className="absolute right-0 mt-1 grid w-64 gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
                    <form action={updateSubgroupAction} className="grid gap-2">
                      <input type="hidden" name="id" value={card.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Name
                        <input name="name" required defaultValue={card.name} className={`${field} normal-case`} />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Grade
                        <input name="grade" defaultValue={card.grade} className={`${field} normal-case`} />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Sort order
                        <input name="sort_order" type="number" defaultValue={card.sortOrder} className={`${field} normal-case`} />
                      </label>
                      <PendingSubmitButton className="h-9 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white hover:bg-emerald-800" pendingLabel="Saving...">Save sub-group</PendingSubmitButton>
                    </form>
                    <form action={card.isActive ? deactivateSubgroupAction : activateSubgroupAction} className="border-t border-zinc-100 pt-2">
                      <input type="hidden" name="id" value={card.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      {card.isActive ? (
                        <ConfirmSubmitButton message="Deactivate this sub-group? Its materials stay stored." className="text-sm font-semibold text-red-700 hover:text-red-800">Deactivate</ConfirmSubmitButton>
                      ) : (
                        <ConfirmSubmitButton message="Activate this sub-group?" className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">Activate</ConfirmSubmitButton>
                      )}
                    </form>
                  </div>
                </details>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => setSubFormOpen(true)} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-4 text-sm font-semibold text-zinc-600 transition hover:border-emerald-700 hover:text-emerald-900">
            <Plus aria-hidden="true" className="h-5 w-5" />
            Add sub-group
          </button>
        </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sub ? <h2 className="text-lg font-semibold text-zinc-950">{sub.title}</h2> : null}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input aria-label="Search materials" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code or name..." className={`${field} w-full pl-9`} />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">Sort
              <select aria-label="Sort materials" value={sort} onChange={(event) => changeSort(event.target.value as MaterialSortMode)} className={field}>
                <option value="code">Code</option>
                <option value="name">Name A-Z</option>
                <option value="recent">Recently added</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive{inactiveCount ? ` (${inactiveCount})` : ""}
            </label>
            <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")} className={`inline-flex h-10 w-10 items-center justify-center ${view === "grid" ? "bg-emerald-50 text-emerald-900" : "text-zinc-500"}`}><LayoutGrid aria-hidden="true" className="h-4 w-4" /></button>
              <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")} className={`inline-flex h-10 w-10 items-center justify-center ${view === "list" ? "bg-emerald-50 text-emerald-900" : "text-zinc-500"}`}><List aria-hidden="true" className="h-4 w-4" /></button>
            </div>
          </div>

          {view === "grid" ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 130px), 1fr))" }}>
              {visible.map((item) => (
                <div key={item.id} className="grid min-w-0 gap-2">
                  <div className="relative">
                  {selectionBox(item)}
                  <button type="button" disabled={bulkBusy} aria-label={`${editing ? "Select" : "View"} ${item.name}`} onClick={(event) => editing ? toggleSelection(item.id, event.shiftKey) : openViewer(item.id)} className={`relative block aspect-square w-full ${editing ? "cursor-pointer" : "cursor-zoom-in"} overflow-hidden rounded-2xl border bg-zinc-100 ${editing && selectedIds.has(item.id) ? "border-emerald-800 ring-2 ring-emerald-700" : "border-zinc-200"} ${item.isActive ? "" : "opacity-50"}`}>
                    <Img url={item.url} className="absolute inset-0 h-full w-full object-cover" />
                    {item.url ? null : <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-zinc-400">{item.code.slice(0, 5) || "No image"}</span>}
                  </button>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-zinc-950">{[item.code, item.name].filter(Boolean).join(" | ")}</p>
                    {item.grade ? <p className="truncate text-xs text-zinc-500">{item.grade}</p> : null}
                    <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                      {item.needsReview ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Needs review</span> : null}
                      {item.isActive ? null : <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">Inactive</span>}
                    </div>
                    {rowActions(item)}
                    {blocked[item.id] ? <p className="mt-1 text-xs text-amber-800">{blocked[item.id]}</p> : null}
                  </div>
                </div>
              ))}
              <MaterialDialogButton brandId={brandId} brandName={brandName} groups={groups} prefill={prefill} returnTo={returnTo} subgroups={subgroupOptions} title={`Add Material - ${group.name}`} triggerClassName="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-2 text-center text-sm font-semibold text-zinc-600 transition hover:border-emerald-700 hover:text-emerald-900" triggerLabel="+ Add material" />
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              {visible.map((item) => (
                <div key={item.id} className={`flex flex-wrap items-center gap-3 p-2.5 sm:flex-nowrap ${item.isActive ? "" : "opacity-60"}`}>
                  <div className="relative h-12 w-12 shrink-0">
                  {selectionBox(item)}
                  <button type="button" disabled={bulkBusy} aria-label={`${editing ? "Select" : "View"} ${item.name}`} onClick={(event) => editing ? toggleSelection(item.id, event.shiftKey) : openViewer(item.id)} className={`relative block h-12 w-12 ${editing ? "cursor-pointer" : "cursor-zoom-in"} overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 ${editing && selectedIds.has(item.id) ? "ring-2 ring-emerald-700" : ""}`}>
                    <Img url={item.url} className="absolute inset-0 h-full w-full object-cover" />
                  </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-zinc-950">{[item.code, item.name].filter(Boolean).join(" | ")}</p>
                    {item.grade ? <p className="text-xs text-zinc-500">{item.grade}</p> : null}
                    {blocked[item.id] ? <p className="text-xs text-amber-800">{blocked[item.id]}</p> : null}
                  </div>
                  {item.needsReview ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Needs review</span> : null}
                  {item.isActive ? null : <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">Inactive</span>}
                  {rowActions(item)}
                </div>
              ))}
            </div>
          )}
          {visible.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500">No materials match.</p> : null}
        </div>
      )}
      {editing && mode === "swatches" ? <MaterialBulkBar key={scope} groupId={group.id} selected={swatches.filter((item) => selectedIds.has(item.id))} onSelectAll={selectAll} onClear={() => { setSelectedIds(new Set()); anchor.current = null; }} onDone={doneEditing} onBusy={setBulkBusy} onBanner={setBulkBanner} onResults={(results) => {
        const cleared = new Set(results.filter((result) => ["deleted", "updated", "not_found"].includes(result.status)).map((result) => result.id));
        setSelectedIds((current) => new Set([...current].filter((id) => !cleared.has(id))));
        setBlocked((current) => {
          const next = { ...current };
          for (const result of results) if (result.status === "in_use") next[result.id] = "In use by a product template. Deactivate it instead."; else if (cleared.has(result.id)) delete next[result.id];
          return next;
        });
        anchor.current = null;
      }} /> : null}
    </div>
  );
}
