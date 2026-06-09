import QuotationsPage from "@/app/quotations/page";

export const dynamic = "force-dynamic";

type SalesQuotationsPageProps = {
  searchParams?: Promise<{
    client?: string;
    fromOpportunity?: string;
    message?: string;
    project?: string;
    q?: string;
    status?: string;
    year?: string;
  }>;
};

export default async function SalesQuotationsPage(props: SalesQuotationsPageProps) {
  return QuotationsPage(props);
}
