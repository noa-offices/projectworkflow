import { CompanySettingsSection } from "@/components/settings/company-settings-section";

type CompanyPageProps = {
  searchParams?: Promise<{
    message?: string;
    messageScope?: string;
    messageType?: string;
  }>;
};

export default function CompanyPage({ searchParams }: CompanyPageProps) {
  return <CompanySettingsSection section="company" searchParams={searchParams} />;
}
