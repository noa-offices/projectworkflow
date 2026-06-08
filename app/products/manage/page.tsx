import { ProductTemplatesPage, type TemplatesPageProps } from "../templates/page";

export default async function ProductManagementPage({ searchParams }: TemplatesPageProps) {
  const params = (await searchParams) ?? {};

  return <ProductTemplatesPage searchParams={Promise.resolve({ ...params, manage: "1" })} />;
}
