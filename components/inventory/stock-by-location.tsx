import { formatInventoryNumber, productStockLocations } from "@/lib/inventory/presentation";
import type { StockBuckets } from "@/lib/inventory/types";

export function StockByLocation({ product }: { product: StockBuckets }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      {productStockLocations(product).map(({ code, label, quantity, cumulative }) => (
        <div key={code} className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <dt className="break-words text-sm text-zinc-600">
            {label}
            {cumulative ? <span className="mt-1 block text-sm text-zinc-500">Cumulative</span> : null}
          </dt>
          <dd className="mt-2 break-words text-xl font-semibold tabular-nums text-zinc-950">{formatInventoryNumber(quantity)}</dd>
        </div>
      ))}
    </dl>
  );
}
