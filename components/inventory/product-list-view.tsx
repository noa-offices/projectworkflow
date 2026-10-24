import { PackageSearch } from "lucide-react";
import { ProductCard } from "@/components/inventory/product-card";
import type { InventoryProduct } from "@/lib/inventory/types";
import { EmptyState } from "./inventory-ui";

export function ProductListView({ products, filtered, detailHrefPrefix = "/inventory/products/", clearHref = "/inventory/products" }: { products: InventoryProduct[]; filtered: boolean; detailHrefPrefix?: string; clearHref?: string }) {
  if (products.length === 0) {
    return filtered
      ? <EmptyState icon={<PackageSearch size={32} aria-hidden="true" />} title="No products found" text="Nothing matches your search or filters." action={{ href: clearHref, label: "Clear filters" }} />
      : <EmptyState icon={<PackageSearch size={32} aria-hidden="true" />} title="No products yet" text="Products show here after they are added." />;
  }
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => <ProductCard key={product.id} product={product} href={`${detailHrefPrefix}${encodeURIComponent(product.id)}`} />)}
    </div>
  );
}
