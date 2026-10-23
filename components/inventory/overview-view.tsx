import Link from "next/link";
import { formatInventoryNumber } from "@/lib/inventory/presentation";
import { LOCATION_LABELS, type InventoryLocation, type InventoryOverview } from "@/lib/inventory/types";

export function InventoryOverviewView({ overview, productsHref = "/inventory/products" }: { overview: InventoryOverview; productsHref?: string }) {
  const stats = [
    { label: "Products", value: overview.product_count },
    { label: "Low stock products", value: overview.low_stock_count },
    { label: "Pending product requests", value: overview.pending_product_requests },
    { label: "Pending movement requests", value: overview.pending_movement_requests },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <section className="min-w-0 rounded-lg border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-zinc-600">Total live quantity</h2>
            <p className="mt-2 break-words text-4xl font-semibold tabular-nums tracking-tight text-emerald-950">{formatInventoryNumber(overview.total_live_quantity)}</p>
            <p className="mt-2 text-sm text-zinc-500">Across all live locations. Cumulative sold stock is excluded.</p>
          </div>
          <Link href={productsHref} className="inline-flex min-h-11 max-w-full shrink-0 items-center justify-center rounded-lg bg-emerald-900 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Browse products</Link>
        </div>
      </section>

      <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, value }) => (
          <div key={label} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <dt className="break-words text-sm text-zinc-600">{label}</dt>
            <dd className="mt-3 break-words text-2xl font-semibold tabular-nums text-zinc-950">{formatInventoryNumber(value)}</dd>
          </div>
        ))}
      </dl>

      <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold text-zinc-950">Quantity by location</h2>
        <p className="mt-1 text-sm text-zinc-500">Live stock and cumulative sold quantities.</p>
        <dl className="mt-4 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
          {(Object.keys(LOCATION_LABELS) as InventoryLocation[]).map((location) => (
            <div key={location} className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <dt className="break-words text-sm text-zinc-600">
                {LOCATION_LABELS[location]}
                {location === "sold" ? <span className="mt-1 block text-sm text-zinc-500">Cumulative</span> : null}
              </dt>
              <dd className="mt-2 break-words text-xl font-semibold tabular-nums text-zinc-950">{formatInventoryNumber(overview.location_quantities[location])}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
