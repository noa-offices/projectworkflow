import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { inventoryIdentifier, formatInventoryDate, inventoryPersonName, formatInventoryNumber, inventoryOverviewHref } from "@/lib/inventory/presentation";
import { canManageInventory } from '@/lib/inventory/access';
import type { InventoryOverviewActivity } from '@/lib/inventory/types';
import { LOCATION_LABELS, type InventoryLocation, type InventoryOverview } from "@/lib/inventory/types";
import { InventoryActions } from './inventory-actions';

const cardLink = "group relative block min-h-11 min-w-0 rounded-lg transition hover:border-emerald-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const chipLink = "inline-flex min-h-11 items-center rounded-full bg-zinc-100 px-4 font-medium hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const viewHint = <span aria-hidden="true" className="absolute right-3 top-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-800 opacity-70 group-hover:opacity-100"><span className="hidden sm:inline">View</span><ArrowRight size={14} /></span>;
type CardProps = { className?: string; href: string; label: string; value: number; note?: string; hint?: string; hero?: boolean };
/** The one card used for every Overview figure, so cards cannot drift apart. */
function OverviewCard({ className = "", href, label, value, note, hint, hero }: CardProps) {
  return (
    <Link href={href} data-overview-card className={`${cardLink} ${hero ? "border border-transparent" : "border border-zinc-200 bg-white shadow-sm"} ${className}`}>
      <div className={hero ? "h-full rounded-lg border border-emerald-100 bg-emerald-50/40 p-4 pr-8" : "p-4 pr-8"}>
        <dt className="break-words text-sm font-medium text-zinc-600">{label}</dt>
        <dd className={`mt-2 break-words font-semibold tabular-nums ${hero ? "text-4xl tracking-tight text-emerald-950" : "text-2xl text-zinc-950"}`}>{formatInventoryNumber(value)}</dd>
        {note ? <dd className="mt-1 text-sm text-zinc-500">{note}</dd> : null}
        {hint ? <dd className="mt-1 text-sm text-zinc-500">{hint}</dd> : null}
      </div>
      {viewHint}
    </Link>
  );
}
const plural = (count: number) => `${formatInventoryNumber(count)} ${count === 1 ? "product" : "products"}`;

export function InventoryOverviewView({ overview, activity, productsHref = "/inventory/products", role, moveHref, categoriesHref, reportsHref }: { overview: InventoryOverview; activity?: InventoryOverviewActivity | null; productsHref?: string; role?: string | null; moveHref?: string; categoriesHref?: string; reportsHref?: string }) {
  const href = (filter: Parameters<typeof inventoryOverviewHref>[0]) => inventoryOverviewHref(filter, productsHref);
  const stats = [
    { className: "col-span-2 lg:col-span-1", label: "Reserved", value: overview.reserved_quantity, note: plural(overview.reserved_product_count), href: href({ stock: "reserved" }) },
  ];
  const requests = [
    { label: "Pending product requests", value: overview.pending_product_requests, href: '/inventory/requests?tab=products&status=pending_review' },
    { label: "Pending movement requests", value: overview.pending_movement_requests, href: '/inventory/requests?tab=movements&status=pending_review' },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <InventoryActions role={role} moveHref={moveHref} categoriesHref={categoriesHref} reportsHref={reportsHref} />
      <section className="min-w-0 rounded-lg border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <OverviewCard hero href={href({ stock: "live" })} label="Units" value={overview.total_live_quantity} />
              <OverviewCard hero href={href({ stock: "live" })} label="Products" value={overview.product_count} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-zinc-700">
              <Link href={href({ itemType: "accessory", stock: "live" })} className={chipLink}>Accessories {formatInventoryNumber(overview.item_type_counts.accessory)}<ArrowRight size={14} aria-hidden="true" className="ml-2" /></Link>
              <Link href={href({ itemType: "temporary", stock: "live" })} className={chipLink}>Temporary {formatInventoryNumber(overview.item_type_counts.temporary)}<ArrowRight size={14} aria-hidden="true" className="ml-2" /></Link>
            </div>
            <p className="mt-3 text-sm text-zinc-500">Across all live locations. Cumulative sold stock is excluded.</p>
          </div>
          <Link href={productsHref} className="inline-flex min-h-11 max-w-full shrink-0 items-center justify-center rounded-lg bg-emerald-900 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Browse products</Link>
        </div>
      </section>

      <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
        {[...stats, ...requests].map(card => <OverviewCard key={card.label} {...card} />)}
      </dl>

      {canManageInventory(role) && activity ? <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {([
          ['Pending product requests',activity.pending_products,'Requested by','/inventory/requests?tab=products&status=pending_review'],
          ['Pending movement requests',activity.pending_movements,'Requested by','/inventory/requests?tab=movements&status=pending_review'],
          ['Recently added items',activity.recent_products,'Added by',''],
          ['Recent movements',activity.recent_movements,'Recorded by','/inventory/movements'],
        ] as const).map(([title,entries,by,destination])=><section key={title} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">Latest five</p>
          {entries.length ? <ul className="mt-3 divide-y divide-zinc-100">{entries.map(entry=><li key={entry.id} className="min-w-0 py-3 text-sm [overflow-wrap:anywhere]">
            <Link href={destination || `/inventory/products/${entry.product_id}`} className="inline-flex min-h-11 items-center font-semibold text-emerald-900 underline underline-offset-4">{entry.item_name}</Link>
            <p className="text-emerald-800">{inventoryIdentifier(entry,title === "Pending product requests")}</p>
            <p className="text-zinc-700">{by} {inventoryPersonName(entry.display_name)}</p>
            <time dateTime={entry.created_at} className="mt-1 block text-zinc-500">{formatInventoryDate(entry.created_at)}</time>
          </li>)}</ul> : <p className="mt-3 text-sm text-zinc-500">No items to show.</p>}
        </section>)}
      </div> : null}

      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-zinc-950">Quantity by location</h2>
        <p className="mt-1 text-sm text-zinc-500">Units and number of products in each location.</p>
        <dl className="mt-4 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.keys(LOCATION_LABELS) as InventoryLocation[]).map((location) => (
            <OverviewCard key={location} href={href({ location })} label={location === "sold" ? `${LOCATION_LABELS[location]} (cumulative)` : LOCATION_LABELS[location]} value={overview.location_quantities[location]} note={`${plural(overview.location_product_counts[location])}${location === "sold" ? " sold" : ""}`} />
          ))}
        </dl>
      </section>
    </div>
  );
}
