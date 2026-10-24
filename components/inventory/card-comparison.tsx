import { previewProduct } from "@/lib/inventory/preview-data";
import { ProductCard } from "./product-card";

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${body}</svg>`)}`;
const whiteRender = svg('<rect width="400" height="300" fill="#fff"/><rect x="150" y="60" width="100" height="120" rx="14" fill="#3f3f46"/><rect x="190" y="180" width="20" height="60" fill="#52525b"/><rect x="140" y="240" width="120" height="14" rx="7" fill="#71717a"/>');
const darkPhoto = svg('<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0a0a"/><stop offset="1" stop-color="#27272a"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><rect x="150" y="70" width="100" height="110" rx="14" fill="#18181b"/><rect x="140" y="230" width="120" height="14" rx="7" fill="#111"/>');

/** Development preview only: brand labels over a white product render and a dark real-looking photo. */
export function CardComparison() {
  const base = { ...previewProduct, main_image_url: null as string | null };
  return <div className="min-w-0 space-y-3">
    <h1 className="text-xl font-semibold text-zinc-950">Brand label on light and dark photos</h1>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <ProductCard product={{ ...base, id: "cmp-1", item_name: "White background render", main_image_url: whiteRender }} href="#" />
      <ProductCard product={{ ...base, id: "cmp-2", item_name: "Dark photo", main_image_url: darkPhoto, item_type: "accessory" }} href="#" />
      <ProductCard product={{ ...base, id: "cmp-3", item_name: "No photo", brand_name: "International Furniture Manufacturing Company" }} href="#" />
      <ProductCard product={{ ...base, id: "cmp-4", item_name: "Temporary item", main_image_url: darkPhoto, item_type: "temporary", brand_name: "Nora Office" }} href="#" />
    </div>
  </div>;
}
