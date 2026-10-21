"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Ellipsis, LayoutGrid, Layers, List, Search } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";

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

type Filters = { brand: string; group: string; level: "brands" | "groups"; q: string; sort: string; status: string; view: string };
export type MaterialLibraryBrand = { code: string | null; id: string; isActive: boolean; name: string };
type FormAction = (formData: FormData) => void | Promise<void>;

const fieldClass = "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const urlKeys: Array<[keyof Filters, string]> = [["q", "q"], ["brand", "libBrand"], ["group", "libGroup"], ["level", "libLevel"], ["status", "libStatus"], ["sort", "libSort"], ["view", "libView"]];
const defaults: Filters = { brand: "", group: "", level: "brands", q: "", sort: "updated", status: "", view: "grid" };

function StatCard({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-zinc-950">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
    </div>
  );
}

function StatusPill({ group }: { group: MaterialLibraryGroup }) {
  const [label, className] = group.needsReview
    ? ["Needs Review", "border-amber-200 bg-amber-50 text-amber-900"]
    : group.isActive
      ? ["Active", "border-emerald-200 bg-emerald-50 text-emerald-900"]
      : ["Inactive", "border-zinc-200 bg-zinc-100 text-zinc-600"];
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

function Swatch({ thumb }: { thumb: MaterialLibraryGroup["thumbs"][number] }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 text-[10px] font-semibold text-zinc-500">
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
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

type BrandRow = { brand: MaterialLibraryBrand; groups: MaterialLibraryGroup[]; materials: number; thumbs: MaterialLibraryGroup["thumbs"] };

// Brand level: cards (or a compact table) built only from the groups and thumbnails already loaded.
function BrandLevel({ onAddGroup, onOpen, rows, view }: { onAddGroup: (brandId: string) => void; onOpen: (brandId: string) => void; rows: BrandRow[]; view: string }) {
  const openButton = (row: BrandRow, className: string) => row.groups.length === 0
    ? <button type="button" onClick={() => onAddGroup(row.brand.id)} className={className}>Add first group</button>
    : <button type="button" onClick={() => onOpen(row.brand.id)} className={className}>Open brand <ArrowRight aria-hidden="true" className="h-4 w-4" /></button>;
  if (rows.length === 0) return <p className="rounded-xl border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No brands yet.</p>;
  if (view === "list") {
    return (
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr><th className="px-4 py-3">Brand</th><th className="px-4 py-3 text-right">Groups</th><th className="px-4 py-3 text-right">Materials</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.brand.id} className="border-t border-zinc-100">
                <td className="px-4 py-3 font-semibold text-zinc-950">{row.brand.name}{row.brand.code ? <span className="ml-2 text-xs font-normal text-zinc-500">{row.brand.code}</span> : null}</td>
                <td className="px-4 py-3 text-right text-zinc-700">{row.groups.length}</td>
                <td className="px-4 py-3 text-right text-zinc-700">{row.materials}</td>
                <td className="px-4 py-3"><BrandStatus active={row.groups.some((group) => group.isActive)} groupCount={row.groups.length} /></td>
                <td className="px-4 py-3 text-right">{openButton(row, "inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-900 px-3 text-xs font-semibold text-white hover:bg-emerald-800")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
      {rows.map((row) => (
        <article key={row.brand.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold text-zinc-950">{row.brand.name}</h3>
              {row.brand.code ? <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{row.brand.code}</p> : null}
            </div>
            <BrandStatus active={row.groups.some((group) => group.isActive)} groupCount={row.groups.length} />
          </div>
          <p className="flex items-center gap-1.5 text-sm text-zinc-600"><Layers aria-hidden="true" className="h-4 w-4 text-zinc-400" />{row.groups.length} {row.groups.length === 1 ? "group" : "groups"} - {row.materials} {row.materials === 1 ? "material" : "materials"}</p>
          {row.groups.length ? (
            <div className="flex flex-wrap gap-1.5">
              {row.groups.slice(0, 4).map((group) => <span key={group.id} className="max-w-full truncate rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700">{group.name} {group.activeCount}</span>)}
              {row.groups.length > 4 ? <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-500">+{row.groups.length - 4}</span> : null}
            </div>
          ) : null}
          {row.thumbs.length ? <div className="flex items-center gap-1.5">{row.thumbs.map((thumb, index) => <Swatch key={`${row.brand.id}-${index}`} thumb={thumb} />)}</div> : null}
          <div className="mt-auto pt-1">{openButton(row, "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800")}</div>
        </article>
      ))}
    </div>
  );
}

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
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const isFirstRender = useRef(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addBrand, setAddBrand] = useState("");

  // Filters live in the URL (replaceState only, so the server does not re-render). Not brand/group: those params open the detail view.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const next = new URLSearchParams(window.location.search);
    for (const [key, param] of urlKeys) {
      const value = key === "q" ? filters.q.trim() : filters[key];
      if (value && value !== defaults[key]) next.set(param, value);
      else next.delete(param);
    }
    next.delete("message");
    const query = next.toString();
    window.history.replaceState(null, "", `/products/materials${query ? `?${query}` : ""}`);
  }, [filters]);

  const returnTo = useMemo(() => {
    const next = new URLSearchParams();
    for (const [key, param] of urlKeys) {
      const value = key === "q" ? filters.q.trim() : filters[key];
      if (value && value !== defaults[key]) next.set(param, value);
    }
    const query = next.toString();
    return `/products/materials${query ? `?${query}` : ""}`;
  }, [filters]);

  const groupNames = useMemo(() => Array.from(new Set(groups.map((group) => group.name))).sort((left, right) => left.localeCompare(right)), [groups]);
  const visible = useMemo(() => {
    const words = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = groups.filter((group) =>
      (!filters.brand || group.brandId === filters.brand) &&
      (!filters.group || group.name === filters.group) &&
      (filters.status === "" ||
        (filters.status === "active" && group.isActive) ||
        (filters.status === "inactive" && !group.isActive) ||
        (filters.status === "needs_review" && group.needsReview)) &&
      words.every((word) => group.searchText.includes(word)));
    return [...matching].sort((left, right) =>
      filters.sort === "name" ? left.name.localeCompare(right.name)
        : filters.sort === "materials" ? right.activeCount - left.activeCount || left.name.localeCompare(right.name)
          : right.updatedAt.localeCompare(left.updatedAt));
  }, [filters, groups]);

  // Brand cards show while nothing narrows the list; searching, a Group/Status filter, "All groups" or an opened brand show group cards.
  const searching = Boolean(filters.q.trim() || filters.group || filters.status);
  const showBrands = !searching && !filters.brand && filters.level !== "groups";
  const scoped = filters.brand ? groups.filter((group) => group.brandId === filters.brand) : groups;
  const openBrand = brands.find((brand) => brand.id === filters.brand);
  const brandRows = useMemo<BrandRow[]>(() => brands.map((brand) => {
    const own = groups.filter((group) => group.brandId === brand.id);
    // Up to 5 pictures, taking up to 2 per group in order so the groups are mixed.
    const thumbs: MaterialLibraryGroup["thumbs"] = [];
    for (let round = 0; round < 2; round += 1) for (const group of own) if (group.thumbs[round] && thumbs.length < 5) thumbs.push(group.thumbs[round]);
    return { brand, groups: own, materials: own.reduce((total, group) => total + group.activeCount, 0), thumbs };
  }).sort((left, right) => left.brand.name.localeCompare(right.brand.name)), [brands, groups]);
  const activeGroups = scoped.filter((group) => group.isActive).length;
  const totalMaterials = scoped.reduce((total, group) => total + group.activeCount, 0);
  // View Group opens the new group page; Edit still opens the classic view with the group's edit form open.
  const viewHref = (group: MaterialLibraryGroup, edit: boolean) => edit
    ? `/products/materials?brand=${encodeURIComponent(group.brandId)}&group=${encodeURIComponent(group.id)}&open=1&edit=1#group-${group.id}`
    : `/products/materials/groups/${group.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/products" className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800">Back to products</Link>
        <div className="flex flex-wrap items-center gap-2">
          <details className="relative" open={addOpen} onToggle={(event) => setAddOpen(event.currentTarget.open)}>
            <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center rounded-lg border border-emerald-900 bg-white px-4 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50">+ Add Group</summary>
            <form action={createGroupAction} className="absolute right-0 z-30 mt-2 grid w-[min(420px,calc(100vw-3rem))] gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg">
              <input type="hidden" name="return_to" value={returnTo} />
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Brand
                <select key={addBrand || filters.brand} name="brand_id" required defaultValue={addBrand || filters.brand} className={`${fieldClass} normal-case`}>
                  <option value="" disabled>Select brand</option>
                  {brands.filter((brand) => brand.isActive).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Group name
                <input name="group_name" required className={`${fieldClass} normal-case`} />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Sort order
                <input name="sort_order" type="number" defaultValue={0} className={`${fieldClass} normal-case`} />
              </label>
              <label className="grid gap-1 text-xs font-semibold uppercase text-zinc-500">Description
                <textarea name="description" rows={2} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm normal-case outline-none focus:border-emerald-800" />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" name="is_active" defaultChecked /> Active</label>
              <PendingSubmitButton className="h-10 rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800" pendingLabel="Creating group...">Add group</PendingSubmitButton>
            </form>
          </details>
          <Link href={addBrandHref} className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">+ Add Brand</Link>
        </div>
      </div>

      {openBrand && !showBrands ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
          <button type="button" onClick={() => set({ brand: "", group: "", level: "brands", status: "" })} className="font-semibold text-emerald-900 hover:underline">All brands</button>
          <span className="text-zinc-400">/</span>
          <span className="font-semibold text-zinc-900">{openBrand.name}</span>
        </nav>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Material Groups" value={String(scoped.length)} note={openBrand ? openBrand.name : "Across all brands"} />
        <StatCard label="Active Groups" value={`${activeGroups}${scoped.length ? ` (${Math.round((activeGroups / scoped.length) * 100)}%)` : ""}`} note="Currently active" />
        <StatCard label="Total Materials" value={String(totalMaterials)} note="Across all groups" />
        <StatCard label="Needs Review" value={String(scoped.filter((group) => group.needsReview).length)} note="Requires attention" />
      </div>

      <section className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input aria-label="Search groups" value={filters.q} onChange={(event) => set({ q: event.target.value })} placeholder="Search groups, materials, or keywords..." className="h-11 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
            <option value="needs_review">Needs Review</option>
          </select>
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-white" role="group" aria-label="Show">
            <button type="button" aria-pressed={showBrands} onClick={() => set({ brand: "", group: "", level: "brands", q: "", status: "" })} className={`h-10 px-3 text-sm font-semibold ${showBrands ? "bg-emerald-50 text-emerald-900" : "text-zinc-600"}`}>Brands</button>
            <button type="button" aria-pressed={!showBrands && !filters.brand} onClick={() => set({ brand: "", level: "groups" })} className={`h-10 px-3 text-sm font-semibold ${!showBrands && !filters.brand ? "bg-emerald-50 text-emerald-900" : "text-zinc-600"}`}>All groups</button>
          </div>
          {showBrands ? null : (
            <label className="flex items-center gap-2 text-sm text-zinc-500">Sort by
              <select aria-label="Sort by" value={filters.sort} onChange={(event) => set({ sort: event.target.value })} className={fieldClass}>
                <option value="updated">Recently updated</option>
                <option value="name">Name A-Z</option>
                <option value="materials">Most materials</option>
              </select>
            </label>
          )}
          <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <button type="button" aria-label="Grid view" aria-pressed={filters.view === "grid"} onClick={() => set({ view: "grid" })} className={`inline-flex h-10 w-10 items-center justify-center ${filters.view === "grid" ? "bg-emerald-50 text-emerald-900" : "text-zinc-500"}`}><LayoutGrid aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" aria-label="List view" aria-pressed={filters.view === "list"} onClick={() => set({ view: "list" })} className={`inline-flex h-10 w-10 items-center justify-center ${filters.view === "list" ? "bg-emerald-50 text-emerald-900" : "text-zinc-500"}`}><List aria-hidden="true" className="h-4 w-4" /></button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {showBrands ? (
          <h2 className="text-lg font-semibold text-zinc-950">Brands ({brandRows.length})</h2>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-zinc-950">Material Groups ({scoped.length})</h2>
            <p className="text-sm text-zinc-500">Showing {visible.length} of {scoped.length} groups</p>
          </>
        )}
      </div>

      {showBrands ? (
        <BrandLevel
          onAddGroup={(brandId) => { setAddBrand(brandId); setAddOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          onOpen={(brandId) => set({ brand: brandId, level: "brands" })}
          rows={brandRows}
          view={filters.view}
        />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">No material groups match these filters.</p>
      ) : filters.view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr><th className="px-4 py-3">Group</th><th className="px-4 py-3">Brand</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Materials</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {visible.map((group) => (
                <tr key={group.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3"><p className="font-semibold text-zinc-950">{group.name}</p>{group.description ? <p className="text-xs text-zinc-500">{group.description}</p> : null}</td>
                  <td className="px-4 py-3 text-zinc-600">{group.brandLabel}</td>
                  <td className="px-4 py-3"><StatusPill group={group} /></td>
                  <td className="px-4 py-3 text-right text-zinc-700">{group.activeCount}</td>
                  <td className="px-4 py-3"><div className="flex items-center justify-end gap-2">
                    <Link href={viewHref(group, false)} className="inline-flex h-9 items-center rounded-lg bg-emerald-900 px-3 text-xs font-semibold text-white hover:bg-emerald-800">View Group</Link>
                    <Link href={viewHref(group, true)} className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">Edit</Link>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
          {visible.map((group) => (
            <article key={group.id} className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md">
              <span className="inline-flex max-w-full self-start truncate rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-700">{group.brandLabel}</span>
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 flex-1 text-base font-bold text-zinc-950">{group.name}</h3>
                <StatusPill group={group} />
                <details className="relative shrink-0">
                  <summary aria-label="More actions" className="inline-flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><Ellipsis aria-hidden="true" className="h-4 w-4" /></summary>
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
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{group.brandLabel}</p>
              {group.description ? <p className="line-clamp-2 text-sm text-zinc-500">{group.description}</p> : null}
              <div className="flex items-center gap-1.5">
                {group.thumbs.map((thumb, index) => <Swatch key={`${group.id}-${index}`} thumb={thumb} />)}
                {group.activeCount > group.thumbs.length ? (
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">+{group.activeCount - group.thumbs.length}</span>
                ) : null}
              </div>
              <p className="flex items-center gap-1.5 text-sm text-zinc-600"><Layers aria-hidden="true" className="h-4 w-4 text-zinc-400" />{group.activeCount} {group.activeCount === 1 ? "material" : "materials"}</p>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                <Link href={viewHref(group, false)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800">View Group <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
                <Link href={viewHref(group, true)} className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">Edit</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
