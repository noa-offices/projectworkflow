import { redirect } from "next/navigation";
import { ProductTemplatesPage, type TemplatesPageProps } from "./templates/page";

function stringParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ProductsPage({ searchParams }: TemplatesPageProps) {
  const params = (await searchParams) ?? {};
  const priceStatus = stringParam(params.priceStatus);

  if (priceStatus === "due") {
    const query = new URLSearchParams();
    const q = stringParam(params.q).trim();
    const brand = stringParam(params.brand);

    if (q) query.set("q", q);
    if (brand) query.set("brand", brand);
    query.set("status", "due");

    const suffix = query.toString();
    redirect(`/products/price-updates${suffix ? `?${suffix}` : ""}`);
  }

  return <ProductTemplatesPage searchParams={Promise.resolve(params)} />;
}
