import Link from "next/link";
import { ProductCard } from "@/components/inventory/product-card";
import type { InventoryProduct } from "@/lib/inventory/types";

export function ProductListView({ products, filtered, detailHrefPrefix = "/inventory/products/", clearHref = "/inventory/products" }: { products: InventoryProduct[]; filtered: boolean; detailHrefPrefix?: string; clearHref?: string }) {
  if (products.length === 0) {
    return (
      <section className="min-w-0 rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-12 text-center shadow-sm">
        <h2 className="break-words text-lg font-semibold text-zinc-950">{filtered ? "No products match these filters" : "No products yet"}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">{filtered ? "Try a different search or clear your filters to browse all products." : "Products will appear here when they are added to inventory."}</p>
        {filtered ? <Link href={clearHref} className="mt-5 inline-flex min-h-11 max-w-full items-center justify-center rounded-lg border border-zinc-200 px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Clear filters</Link> : null}
      </section>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {products.map((product) => <ProductCard key={product.id} product={product} href={`${detailHrefPrefix}${encodeURIComponent(product.id)}`} />)}
    </div>
  );
}
