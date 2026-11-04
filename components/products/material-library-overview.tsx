"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Ellipsis, LayoutGrid, Layers, List, Search } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  buildBrandRows,
  defaultMaterialLibraryFilters as defaults,
  filterMaterialGroups,
  materialLibraryChips,
  materialLibraryCountText,
  materialLibraryQuery,
  noMaterialResultsText,
  showsBrandLevel,
  toggleNeedsReview,
  type LibraryBrandRow,
  type MaterialLibraryFilters as Filters,
} from "@/lib/products/material-library-filter";

export type MaterialLibraryGroup = {
  activeCount: number;
  brandId: string;
  brandLabel: string;
  description: string;
  id: string;
  isActive: boolean;
  name: string;
  needsReview: boolean;
  searchText: string;
  sortOrder: number;
  thumbs: Array<{ code: string; url: string | null }>;
  updatedAt: string;
};

export type MaterialLibraryBrand = { code: string | null; id: string; isActive: boolean; name: string };
type FormAction = (formData: FormData) => void | Promise<void>;
type BrandRow = LibraryBrandRow<MaterialLibraryGroup, MaterialLibraryBrand>;

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const fieldClass = `h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10 ${focusRing}`;
const labelClass = "grid gap-1 text-xs font-semibold text-zinc-600";
const gridClass = "grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";
const primaryButton = `inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 ${focusRing}`;
const secondaryButton = `inline-flex h-8 items-center justify-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 ${focusRing}`;
const chipBase = `inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${focusRing}`;
const tableHead = "bg-zinc-50 text-xs text-zinc-500";

const readableCount = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function StatusPill({ group }: { group: MaterialLibraryGroup }) {
  const [label, className] = group.needsReview
    ? ["Needs review", "border-amber-200 bg-amber-50 text-amber-900"]
    : group.isActive
      ? ["Active", "border-emerald-200 bg-emerald-50 text-emerald-900"]
      : ["Inactive", "border-zinc-200 bg-zinc-100 text-zinc-600"];
  return <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
}

function Swatch({ thumb }: { thumb: MaterialLibraryGroup["thumbs"][number] }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-[9px] font-semibold text-zinc-500">
      {thumb.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        thumb.code.slice(0, 4)
      )}
    </span>
  );
}

function BrandStatus({ groupCount, active }: { active: boolean; groupCount: number }) {
  const [label, className] = groupCount === 0
    ? ["No groups yet", "border-amber-200 bg-amber-50 text-amber-900"]
    : active
      ? ["Active", "border-emerald-200 bg-emerald-50 text-emerald-900"]
      : ["Inactive", "border-zinc-200 bg-zinc-100 text-zinc-600"];
  return <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
}

/** One small Brand card: name, code, status, the counts line, group chips, a small swatch strip and one button. */
export function MaterialBrandCard({ onAddGroup, onOpen, row }: { onAddGroup: (brandId: string) => void; onOpen: (brandId: string) => void; row: BrandRow }) {
  const { brand, groups } = row;
  return (
    <article className="flex h-full min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="truncate text-base font-semibold leading-tight text-zinc-950" title={brand.name}>{brand.name}</h3>
          {brand.code ? <span className="shrink-0 text-xs text-zinc-500">{brand.code}</span> : null}
        </div>
        <BrandStatus active={groups.some((group) => group.isActive)} groupCount={groups.length} />
      </div>
      <p className="flex items-center gap-1.5 text-xs text-zinc-600"><Layers aria-hidden="true" className="h-3.5 w-3.5 text-zinc-400" />{readableCount(groups.length, "group", "groups")} · {readableCount(row.materials, "material", "materials")}</p>
      {groups.length ? (
        <div className="flex flex-wrap gap-1">
          {groups.slice(0, 3).map((group) => <span key={group.id} className="max-w-full truncate rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700">{group.name} {group.activeCount}</span>)}
          {groups.length > 3 ? <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-500">+{groups.length - 3}</span> : null}
        </div>
      ) : null}
      {row.thumbs.length ? <div className="flex items-center gap-1">{row.thumbs.map((thumb, index) => <Swatch key={`${brand.id}-${index}`} thumb={thumb} />)}</div> : null}
      <div className="mt-auto pt-1">
        {groups.length === 0
          ? <button type="button" onClick={() => onAddGroup(brand.id)} className={`${primaryButton} w-full`}>Add first group</button>
          : <button type="button" onClick={() => onOpen(brand.id)} className={`${primaryButton} w-full`}>Open brand <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></button>}
      </div>
    </article>
  );
}

/** One small group card with the same actions as before (View Group, Edit, Deactivate or Activate). */
export function MaterialGroupCard({ deactivateGroupAction, group, returnTo, updateGroupAction, viewHref }: {
  deactivateGroupAction: FormAction; group: MaterialLibraryGroup; returnTo: string; updateGroupAction: FormAction; viewHref: (group: MaterialLibraryGroup, edit: boolean) => string;
}) {
  return (
    <article className="flex h-full min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-tight text-zinc-950" title={group.name}>{group.name}</h3>
          <p className="truncate text-xs text-zinc-500" title={group.brandLabel}>{group.brandLabel}</p>
        </div>
        <StatusPill group={group} />
        <details className="relative shrink-0">
          <summary aria-label="More actions" className={`inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 ${focusRing}`}><Ellipsis aria-hidden="true" className="h-4 w-4" /></summary>
          <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg">
            <Link href={viewHref(group, true)} className="block rounded-md px-2 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Edit</Link>
            {group.isActive ? (
              <form action={deactivateGroupAction}>
                <input type="hidden" name="id" value={group.id} />
                <input type="hidden" name="return_to" value={returnTo} />
                <ConfirmSubmitButton message="Deactivate this material group? Materials remain stored and can be shown again with inactive records." className="block w-full rounded-md px-2 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50">Deactivate</ConfirmSubmitButton>
              </form>
            ) : (
              <form action={updateGroupAction}>
                <input type="hidden" name="id" value={group.id} />
                <input type="hidden" name="brand_id" value={group.brandId} />
                <input type="hidden" name="group_name" value={group.name} />
                <input type="hidden" name="description" value={group.description} />
                <input type="hidden" name="sort_order" value={group.sortOrder} />
                <input type="hidden" name="is_active" value="on" />
                <input type="hidden" name="return_to" value={returnTo} />
                <ConfirmSubmitButton message="Activate this material group?" className="block w-full rounded-md px-2 py-2 text-left text-sm font-medium text-emerald-800 hover:bg-emerald-50">Activate</ConfirmSubmitButton>
              </form>
            )}
          </div>
        </details>
      </div>
      {group.description ? <p className="line-clamp-1 text-xs text-zinc-500">{group.description}</p> : null}
      <p className="flex items-center gap-1.5 text-xs text-zinc-600"><Layers aria-hidden="true" className="h-3.5 w-3.5 text-zinc-400" />{readableCount(group.activeCount, "material", "materials")}</p>
      {group.thumbs.length ? (
        <div className="flex items-center gap-1">
          {group.thumbs.map((thumb, index) => <Swatch key={`${group.id}-${index}`} thumb={thumb} />)}
          {group.activeCount > group.thumbs.length ? <span className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-600">+{group.activeCount - group.thumbs.length}</span> : null}
        </div>
      ) : null}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
        <Link href={viewHref(group, false)} className={primaryButton}>View Group <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Link>
        <Link href={viewHref(group, true)} className={secondaryButton}>Edit</Link>
      </div>
    </article>
  );
}

function BrandTable({ onAddGroup, onOpen, rows }: { onAddGroup: (brandId: string) => void; onOpen: (brandId: string) => void; rows: BrandRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className={tableHead}>
          <tr><th className="px-3 py-2 font-semibold">Brand</th><th className="px-3 py-2 text-right font-semibold">Groups</th><th className="px-3 py-2 text-right font-semibold">Materials</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2"><span className="sr-only">Action</span></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.brand.id} className="border-t border-zinc-100">
              <td className="px-3 py-2 font-semibold text-zinc-950">{row.brand.name}{row.brand.code ? <span className="ml-2 text-xs font-normal text-zinc-500">{row.brand.code}</span> : null}</td>
              <td className="px-3 py-2 text-right text-zinc-700">{row.groups.length}</td>
              <td className="px-3 py-2 text-right text-zinc-700">{row.materials}</td>
              <td className="px-3 py-2"><BrandStatus active={row.groups.some((group) => group.isActive)} groupCount={row.groups.length} /></td>
              <td className="px-3 py-2 text-right">{row.groups.length === 0
                ? <button type="button" onClick={() => onAddGroup(row.brand.id)} className={primaryButton}>Add first group</button>
                : <button type="button" onClick={() => onOpen(row.brand.id)} className={primaryButton}>Open brand <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupTable({ groups, viewHref }: { groups: MaterialLibraryGroup[]; viewHref: (group: MaterialLibraryGroup, edit: boolean) => string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className={tableHead}>
          <tr><th className="px-3 py-2 font-semibold">Group</th><th className="px-3 py-2 font-semibold">Brand</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 text-right font-semibold">Materials</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id} className="border-t border-zinc-100">
              <td className="px-3 py-2"><p className="font-semibold text-zinc-950">{group.name}</p>{group.description ? <p className="line-clamp-1 text-xs text-zinc-500">{group.description}</p> : null}</td>
              <td className="px-3 py-2 text-zinc-600">{group.brandLabel}</td>
              <td className="px-3 py-2"><StatusPill group={group} /></td>
              <td className="px-3 py-2 text-right text-zinc-700">{group.activeCount}</td>
              <td className="px-3 py-2"><div className="flex items-center justify-end gap-2">
                <Link href={viewHref(group, false)} className={primaryButton}>View Group</Link>
                <Link href={viewHref(group, true)} className={secondaryButton}>Edit</Link>
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Material Library body: count chips, one toolbar row (live search, filters, switches, Add Group, Add Brand) and small cards in a grid.
 * Search and the filters run in the browser on the loaded groups and keep their values in the address bar without a reload.
 */
export function MaterialLibraryOverview({
  addBrandHref,
  brands,
  createGroupAction,
  deactivateGroupAction,
  groups,
  initialFilters,
  updateGroupAction,
}: {
  addBrandHref: string;
  brands: MaterialLibraryBrand[];
  createGroupAction: FormAction;
  deactivateGroupAction: FormAction;
  groups: MaterialLibraryGroup[];
  initialFilters: Partial<Filters>;
  updateGroupAction: FormAction;
}) {
  const [filters, setFilters] = useState<Filters>({ ...defaults, ...initialFilters });
  const [typed, setTyped] = useState(filters.q);
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const reset = (patch: Partial<Filters>) => { if (patch.q !== undefined) setTyped(patch.q); set(patch); };
  const isFirstRender = useRef(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addBrand, setAddBrand] = useState("");

  // Typing filters the list after a short pause (no reload).
  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => current.q === typed.trim() ? current : { ...current, q: typed.trim() }), 250);
    return () => clearTimeout(timer);
  }, [typed]);

  // Filters live in the URL (replaceState only, so the server does not re-render). Not brand/group: those params open the detail view.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.delete("message");
    window.history.replaceState(null, "", `/products/materials${materialLibraryQuery(filters, next)}`);
  }, [filters]);

  const returnTo = useMemo(() => `/products/materials${materialLibraryQuery(filters)}`, [filters]);
  const groupNames = useMemo(() => Array.from(new Set(groups.map((group) => group.name))).sort((left, right) => left.localeCompare(right)), [groups]);
  const visible = useMemo(() => filterMaterialGroups(groups, filters), [filters, groups]);
  const showBrands = showsBrandLevel(filters);
  const openBrand = brands.find((brand) => brand.id === filters.brand);
  const brandRows = useMemo(() => buildBrandRows(brands, groups), [brands, groups]);
  const chips = materialLibraryChips(groups, filters.brand);
  // View Group opens the new group page; Edit still opens the classic view with the group's edit form open.
  const viewHref = (group: MaterialLibraryGroup, edit: boolean) => edit
    ? `/products/materials?brand=${encodeURIComponent(group.brandId)}&group=${encodeURIComponent(group.id)}&open=1&edit=1#group-${group.id}`
    : `/products/materials/groups/${group.id}`;
  const openAddGroup = (brandId: string) => { setAddBrand(brandId); setAddOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const needsReviewOn = filters.status === "needs_review";
  const segment = (on: boolean) => `h-10 px-3 text-sm font-semibold ${focusRing} ${on ? "bg-emerald-50 text-emerald-900" : "text-zinc-600 hover:bg-zinc-50"}`;
  const iconSegment = (on: boolean) => `inline-flex h-10 w-10 items-center justify-center ${focusRing} ${on ? "bg-emerald-50 text-emerald-900" : "text-zinc-500 hover:bg-zinc-50"}`;
  const infoChip = `${chipBase} border-zinc-200 bg-white text-zinc-700`;

  return (
    <div className="space-y-4">
      <Link href="/products" className={`inline-block text-sm font-semibold text-emerald-900 transition hover:text-emerald-800 ${focusRing}`}>Back to products</Link>

      {openBrand && !showBrands ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
          <button type="button" onClick={() => reset({ brand: "", group: "", level: "brands", status: "" })} className={`font-semibold text-emerald-900 hover:underline ${focusRing}`}>All brands</button>
          <span className="text-zinc-400">/</span>
          <span className="font-semibold text-zinc-900">{openBrand.name}</span>
        </nav>
      ) : null}

      <ul className="flex flex-wrap items-center gap-2" aria-label="Library totals">
        <li className={infoChip}>Material groups <span className="tabular-nums">{chips.groups}</span></li>
        <li className={infoChip}>Active groups <span className="tabular-nums">{chips.active}</span></li>
        <li className={infoChip}>Total materials <span className="tabular-nums">{chips.materials}</span></li>
        <li>
          <button type="button" aria-pressed={needsReviewOn} onClick={() => set(toggleNeedsReview(filters))}
            className={`${chipBase} transition ${needsReviewOn ? "border-amber-700 bg-amber-700 text-white" : "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300"}`}>
            Needs review <span className="tabular-nums">{chips.needsReview}</span>
          </button>
        </li>
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input type="search" aria-label="Search groups" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Search groups, materials, or keywords..." className={`${fieldClass} w-full pl-9 pr-3`} />
        </div>
        <select aria-label="Brand" value={filters.brand} onChange={(event) => set({ brand: event.target.value, level: "brands" })} className={fieldClass}>
          <option value="">All brands</option>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select>
        <select aria-label="Group / Category" value={filters.group} onChange={(event) => set({ group: event.target.value })} className={fieldClass}>
          <option value="">All groups</option>
          {groupNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(event) => set({ status: event.target.value })} className={fieldClass}>
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="needs_review">Needs review</option>
        </select>
        {showBrands ? null : (
          <select aria-label="Sort by" value={filters.sort} onChange={(event) => set({ sort: event.target.value })} className={fieldClass}>
            <option value="updated">Recently updated</option>
            <option value="name">Name A-Z</option>
            <option value="materials">Most materials</option>
          </select>
        )}
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 bg-white" role="group" aria-label="Show">
          <button type="button" aria-pressed={showBrands} onClick={() => reset({ brand: "", group: "", level: "brands", q: "", status: "" })} className={segment(showBrands)}>Brands</button>
          <button type="button" aria-pressed={!showBrands && !filters.brand} onClick={() => set({ brand: "", level: "groups" })} className={segment(!showBrands && !filters.brand)}>All groups</button>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-200 bg-white" role="group" aria-label="Layout">
          <button type="button" aria-label="Grid view" aria-pressed={filters.view === "grid"} onClick={() => set({ view: "grid" })} className={iconSegment(filters.view === "grid")}><LayoutGrid aria-hidden="true" className="h-4 w-4" /></button>
          <button type="button" aria-label="List view" aria-pressed={filters.view === "list"} onClick={() => set({ view: "list" })} className={iconSegment(filters.view === "list")}><List aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <details className="relative" open={addOpen} onToggle={(event) => setAddOpen(event.currentTarget.open)}>
            <summary className={`inline-flex h-10 cursor-pointer list-none items-center justify-center rounded-md border border-emerald-900 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 ${focusRing}`}>+ Add Group</summary>
            <form action={createGroupAction} className="absolute right-0 z-30 mt-2 grid w-[min(420px,calc(100vw-3rem))] gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-lg">
              <input type="hidden" name="return_to" value={returnTo} />
              <label className={labelClass}>Brand
                <select key={addBrand || filters.brand} name="brand_id" required defaultValue={addBrand || filters.brand} className={fieldClass}>
                  <option value="" disabled>Select brand</option>
                  {brands.filter((brand) => brand.isActive).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              </label>
              <label className={labelClass}>Group name
                <input name="group_name" required className={fieldClass} />
              </label>
              <label className={labelClass}>Sort order
                <input name="sort_order" type="number" defaultValue={0} className={fieldClass} />
              </label>
              <label className={labelClass}>Description
                <textarea name="description" rows={2} className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-normal outline-none focus:border-emerald-800" />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" name="is_active" defaultChecked /> Active</label>
              <PendingSubmitButton className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800" pendingLabel="Creating group...">Add group</PendingSubmitButton>
            </form>
          </details>
          <Link href={addBrandHref} className={`inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 ${focusRing}`}>+ Add Brand</Link>
        </div>
      </div>

      <p className="text-sm text-zinc-500" role="status" aria-live="polite" data-testid="material-count">
        {showBrands ? materialLibraryCountText(brandRows.length, brandRows.length, "brands") : materialLibraryCountText(visible.length, chips.scoped, "groups")}
      </p>

      {showBrands ? (
        brandRows.length === 0
          ? <p className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No brands yet.</p>
          : filters.view === "list"
            ? <BrandTable onAddGroup={openAddGroup} onOpen={(brandId) => set({ brand: brandId, level: "brands" })} rows={brandRows} />
            : <div className={gridClass}>{brandRows.map((row) => <MaterialBrandCard key={row.brand.id} onAddGroup={openAddGroup} onOpen={(brandId) => set({ brand: brandId, level: "brands" })} row={row} />)}</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          <p>{noMaterialResultsText(filters.q)}</p>
          <button type="button" onClick={() => reset({ brand: "", group: "", level: "brands", q: "", status: "" })} className={`mt-3 h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${focusRing}`}>Clear search</button>
        </div>
      ) : filters.view === "list" ? (
        <GroupTable groups={visible} viewHref={viewHref} />
      ) : (
        <div className={gridClass}>
          {visible.map((group) => <MaterialGroupCard key={group.id} deactivateGroupAction={deactivateGroupAction} group={group} returnTo={returnTo} updateGroupAction={updateGroupAction} viewHref={viewHref} />)}
        </div>
      )}
    </div>
  );
}
