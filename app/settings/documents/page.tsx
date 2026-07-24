import { CompanySettingsSection } from "@/components/settings/company-settings-section";

type DocumentsPageProps = {
  searchParams?: Promise<{
    message?: string;
    messageScope?: string;
    messageType?: string;
  }>;
};

export default function DocumentsPage({ searchParams }: DocumentsPageProps) {
  return <CompanySettingsSection section="documents" searchParams={searchParams} />;
}
