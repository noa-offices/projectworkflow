import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatInventoryNumber, inventoryOverviewHref } from "@/lib/inventory/presentation";
import { LOCATION_LABELS, type InventoryLocation, type InventoryOverview } from "@/lib/inventory/types";
import { AddItemButton } from './add-item-button';

const cardLink = "group relative block min-h-11 min-w-0 rounded-lg transition hover:border-emerald-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const chipLink = "inline-flex min-h-11 items-center rounded-full bg-zinc-100 px-4 font-medium hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700";
const viewHint = <span aria-hidden="true" className="absolute right-3 top-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-800 opacity-70 group-hover:opacity-100"><span className="hidden sm:inline">View</span><ArrowRight size={14} /></span>;
const plural = (count: number) => `${formatInventoryNumber(count)} ${count === 1 ? "product" : "products"}`;

export function InventoryOverviewView({ overview, productsHref = "/inventory/products", role }: { overview: InventoryOverview; productsHref?: string; role?: string | null }) {
  const href = (filter: Parameters<typeof inventoryOverviewHref>[0]) => inventoryOverviewHref(filter, productsHref);
  const stats = [
    { label: "Reserved", value: overview.reserved_quantity, note: plural(overview.reserved_product_count), href: href({ stock: "reserved" }) },
    { label: "Low stock products", value: overview.low_stock_count, href: href({ stock: "low_stock" }) },
  ];
  const requests = [
    { label: "Pending product requests", value: overview.pending_product_requests, href: '/inventory/requests?tab=products&status=pending_review' },
    { label: "Pending movement requests", value: overview.pending_movement_requests, href: '/inventory/requests?tab=movements&status=pending_review' },
  ];
  const bigCard = "h-full rounded-lg border border-emerald-100 bg-emerald-50/40 p-4 pr-8";

  return (
    <div className="min-w-0 space-y-5">
      <AddItemButton role={role} />
      <section className="min-w-0 rounded-lg border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <Link href={href({ stock: "live" })} className={`${cardLink} border border-transparent`}>
                <div className={bigCard}>
                  <h2 className="text-sm font-medium text-zinc-600">Units</h2>
                  <p className="mt-2 break-words text-4xl font-semibold tabular-nums tracking-tight text-emerald-950">{formatInventoryNumber(overview.total_live_quantity)}</p>
                </div>
                {viewHint}
              </Link>
              <Link href={href({ stock: "live" })} className={`${cardLink} border border-transparent`}>
                <div className={bigCard}>
                  <h2 className="text-sm font-medium text-zinc-600">Products</h2>
                  <p className="mt-2 break-words text-4xl font-semibold tabular-nums tracking-tight text-emerald-950">{formatInventoryNumber(overview.product_count)}</p>
                </div>
                {viewHint}
              </Link>
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

      <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, value, note, href: target }) => (
          <Link key={label} href={target} className={`${cardLink} border border-zinc-200 bg-white shadow-sm`}>
            <div className="p-4 pr-8">
              <dt className="break-words text-sm text-zinc-600">{label}</dt>
              <dd className="mt-3 break-words text-2xl font-semibold tabular-nums text-zinc-950">{formatInventoryNumber(value)}</dd>
              {note ? <dd className="mt-1 text-sm text-zinc-500">{note}</dd> : null}
            </div>
            {viewHint}
          </Link>
        ))}
        {requests.map(({ label, value, href: target }) => (
          <div key={label} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <dt className="break-words text-sm text-zinc-600"><Link className="inline-flex min-h-11 items-center font-medium text-emerald-900 underline underline-offset-4" href={target}>{label}</Link></dt>
            <dd className="mt-3 break-words text-2xl font-semibold tabular-nums text-zinc-950">{formatInventoryNumber(value)}</dd>
          </div>
        ))}
      </dl>

      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-zinc-950">Quantity by location</h2>
        <p className="mt-1 text-sm text-zinc-500">Units and number of products in each location.</p>
        <dl className="mt-4 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.keys(LOCATION_LABELS) as InventoryLocation[]).map((location) => (
            <Link key={location} href={href({ location })} className={`${cardLink} border border-zinc-200 bg-zinc-50`}>
              <div className="p-3 pb-4">
                <dt className="break-words pr-5 text-sm text-zinc-600">
                  {LOCATION_LABELS[location]}
                  {location === "sold" ? <span className="mt-1 block text-sm text-zinc-500">Cumulative</span> : null}
                </dt>
                <dd className="mt-2 break-words text-xl font-semibold tabular-nums text-zinc-950">{formatInventoryNumber(overview.location_quantities[location])}</dd>
                <dd className="mt-1 text-sm text-zinc-500">{plural(overview.location_product_counts[location])}{location === "sold" ? " sold" : ""}</dd>
              </div>
              {viewHint}
            </Link>
          ))}
        </dl>
      </section>
    </div>
  );
}
