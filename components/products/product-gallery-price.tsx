import Link from "next/link";
import { galleryPriceView, type GalleryPriceState } from "@/lib/products/gallery/gallery-price-view";
import { PriceStatusBadge } from "./product-price-status-badge";

export function ProductGalleryPrice({ templateId, price, detail = false }: {
  templateId: string;
  price: GalleryPriceState;
  detail?: boolean;
}) {
  const view = galleryPriceView(templateId, price);
  if (!view) return null;
  if (view.kind === "loading") return (
    <div role="status" aria-label="Loading price list" className="flex flex-col gap-1.5 pt-1">
      <span aria-hidden="true" className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
      <span aria-hidden="true" className="h-3 w-16 animate-pulse rounded bg-zinc-100" />
    </div>
  );
  if (view.kind === "configure") return (
    <Link href={view.href} title="Some saved choices changed, so the price cannot be calculated here." className="text-xs font-semibold text-emerald-900 underline underline-offset-2">
      Open to configure
    </Link>
  );
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p title={view.amount} className={detail ? "text-sm" : "max-w-full overflow-x-auto whitespace-nowrap text-xs [scrollbar-width:thin]"}>
        <span className="text-zinc-600">Price list</span>{" "}
        <strong className="tabular-nums text-zinc-950">{view.amount}</strong>
      </p>
      {view.badge ? <PriceStatusBadge {...view.badge} /> : null}
      {detail && view.checked ? <p className="text-xs text-zinc-600">{view.checked}</p> : null}
    </div>
  );
}
