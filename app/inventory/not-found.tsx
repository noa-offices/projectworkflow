import Link from "next/link";
export default function InventoryNotFound() {
  return <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-zinc-950">Product not found</h2><p className="mt-2 text-sm text-zinc-600">This product is unavailable or the link is no longer valid.</p><Link href="/inventory/products" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white">Browse products</Link></section>;
}
