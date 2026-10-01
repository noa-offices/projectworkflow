"use client";
import Image from "next/image";
import { Fragment, useMemo, useState } from "react";
import type { ReadEntity, ReadSnapshot } from "@/lib/local-read-cache/types";
export const readTitles: Record<ReadEntity, string> = { products: "Product Library", quotations: "Quotations", projects: "Active Project Files", completed: "Completed Projects", clients: "Clients", "products:management": "Product Management", "brands:list": "Brands", "materials:library": "Material Library" };
export function CachedReadSurface({ entity, snapshot, message, refresh, close }: {
  entity: ReadEntity; snapshot?: ReadSnapshot; message: string; refresh: () => void; close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [archived, setArchived] = useState(false);
  const rows = useMemo(() => (snapshot?.data ?? []).filter(row =>
    (!row.archived || archived) && (!filter || [row.brand, row.category, row.group, row.subtitle, row.status, row.year].includes(filter)) &&
    [row.title, row.code, row.subtitle, row.status, row.brand, row.category, row.group].some(value => value?.toLowerCase().includes(query.toLowerCase()))
  ), [snapshot, query, filter, archived]);
  const productArea = ["products", "products:management", "brands:list", "materials:library"].includes(entity);
  const filters = [...new Set((snapshot?.data ?? []).flatMap(r => [productArea && entity !== "brands:list" ? r.brand : r.subtitle, r.year, entity === "clients" || entity === "brands:list" ? r.status : "", entity === "materials:library" ? r.group : ""]).filter((v): v is string => !!v))].sort();
  return <section aria-label="Saved read view" className="fixed inset-0 z-[70] overflow-y-auto bg-zinc-100 p-4 sm:p-8 lg:left-[280px]">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
      <div><p className="text-xs text-zinc-500">ProjectWorkflow · read-only preview</p><h1 className="mt-1 text-2xl font-semibold">{readTitles[entity]}</h1></div>
      <div className="flex gap-3"><button onClick={refresh} className="rounded border bg-white px-3 py-2 text-sm">Refresh data</button><button onClick={close} className="rounded border bg-white px-3 py-2 text-sm">Close preview</button></div>
    </div>
    <p role="status" className="my-3 text-sm text-zinc-600">{message}{snapshot ? " · Last refreshed " + new Date(snapshot.fetchedAt).toLocaleString() : ""}</p>
    <p className="mb-4 text-xs text-zinc-500">Recent bounded summaries. Server-only actions are unavailable in this preview.</p>
    {entity === "products:management" ? <p className="mb-4 text-xs text-zinc-500">Product Template details and editors are online-only and are never saved in this read cache.</p> : null}
    <div className="mb-5 flex flex-wrap gap-3">
      <input aria-label="Search saved data" placeholder="Search saved data…" value={query} onChange={e => setQuery(e.target.value)} className="min-w-60 rounded border bg-white px-3 py-2" />
      <select aria-label="Filter saved data" value={filter} onChange={e => setFilter(e.target.value)} className="rounded border bg-white px-3 py-2"><option value="">All saved results</option>{filters.map(f => <option key={f}>{f}</option>)}</select>
      {entity === "quotations" ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Include archived folders</label> : null}
      {["products:management", "brands:list", "materials:library"].includes(entity) ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Include inactive / archived records</label> : null}
    </div>
    <div className={entity === "products" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-3"}>
      {rows.map((row, index) => <Fragment key={row.id}>
        {entity === "materials:library" && (row.groupId !== rows[index - 1]?.groupId || row.category !== rows[index - 1]?.category) ? <h2 className="mt-4 font-semibold">{row.brand} · {row.group}{row.category ? " / " + row.category : ""}</h2> : null}
        <article className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        {productArea && row.thumbnail && /^(https?:\/\/|\/)/.test(row.thumbnail) ? <Image unoptimized src={row.thumbnail} alt="" width={180} height={120} className="mb-3 h-28 w-full object-contain" onError={e => { e.currentTarget.style.visibility = "hidden"; }} /> : null}
        <p className="text-xs text-zinc-500">{row.code}{row.count ? " · " + row.count + " quotations" : ""}</p>
        <h2 className="mt-1 font-semibold">{row.title}</h2>
        <p className="mt-1 text-sm text-zinc-600">{[row.brand, row.category, row.subtitle].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 text-xs text-zinc-500">{row.status}{row.date ? " · " + row.date.slice(0, 10) : ""}{row.total !== undefined ? " · " + row.currency + " " + row.total.toLocaleString() : ""}</p>
      </article></Fragment>)}
    </div>
    {!snapshot ? <p className="mt-8 rounded border border-dashed p-6">This page has not been saved on this device yet. If offline, reconnect and open it once.</p> : !rows.length ? <p className="mt-8">No matching saved results in this bounded snapshot.</p> : null}
    <a href="/offline.html" className="mt-6 inline-block text-sm text-emerald-900 underline">Local draft recovery</a>
  </section>;
}
