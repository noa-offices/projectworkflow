import { createClient } from "@/lib/supabase/server";

export type CompanySettingsRecord = {
  id: string;
  company_name: string | null;
  display_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  country: string | null;
  trn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  default_currency: string | null;
  vat_percent: number | null;
  logo_url: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
};

export type CompanyProfile = {
  companyName: string;
  displayName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  trn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  defaultCurrency: string;
  vatPercent: number;
  logoUrl: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  name: string;
  trnText: string | null;
  logoPath: string | null;
  offices: Array<{ label: string; location: string }>;
};

export const FALLBACK_COMPANY_PROFILE: CompanyProfile = {
  companyName: "NOA Office Solutions LLC",
  displayName: "NOA Office Solutions",
  addressLine1: null,
  addressLine2: null,
  city: "Dubai, UAE",
  country: "United Arab Emirates",
  trn: "100003535000003",
  phone: null,
  email: null,
  website: null,
  defaultCurrency: "AED",
  vatPercent: 5,
  logoUrl: "/noa-logo.png",
  updatedBy: null,
  updatedAt: null,
  createdAt: null,
  name: "NOA Office Solutions LLC",
  trnText: "100003535000003",
  logoPath: "/noa-logo.png",
  offices: [{ label: "Head Office", location: "Dubai, UAE" }],
};

function stringValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function companyProfileFromRecord(record?: CompanySettingsRecord | null): CompanyProfile {
  const companyName = stringValue(record?.company_name) ?? FALLBACK_COMPANY_PROFILE.companyName;
  const displayName = stringValue(record?.display_name)
    ?? stringValue(record?.company_name)
    ?? FALLBACK_COMPANY_PROFILE.displayName;
  const city = stringValue(record?.city) ?? FALLBACK_COMPANY_PROFILE.city;
  const country = stringValue(record?.country) ?? FALLBACK_COMPANY_PROFILE.country;
  const summaryLine = [
    stringValue(record?.address_line_1) ?? FALLBACK_COMPANY_PROFILE.addressLine1,
    stringValue(record?.address_line_2) ?? FALLBACK_COMPANY_PROFILE.addressLine2,
    [city, country].filter(Boolean).join(", ") || null,
  ].filter(Boolean).join(" / ");
  const logoUrl = stringValue(record?.logo_url) ?? FALLBACK_COMPANY_PROFILE.logoUrl;
  const trn = stringValue(record?.trn) ?? FALLBACK_COMPANY_PROFILE.trn;

  return {
    companyName,
    displayName,
    addressLine1: stringValue(record?.address_line_1) ?? FALLBACK_COMPANY_PROFILE.addressLine1,
    addressLine2: stringValue(record?.address_line_2) ?? FALLBACK_COMPANY_PROFILE.addressLine2,
    city,
    country,
    trn,
    phone: stringValue(record?.phone) ?? FALLBACK_COMPANY_PROFILE.phone,
    email: stringValue(record?.email) ?? FALLBACK_COMPANY_PROFILE.email,
    website: stringValue(record?.website) ?? FALLBACK_COMPANY_PROFILE.website,
    defaultCurrency: stringValue(record?.default_currency) ?? FALLBACK_COMPANY_PROFILE.defaultCurrency,
    vatPercent: numberValue(record?.vat_percent, FALLBACK_COMPANY_PROFILE.vatPercent),
    logoUrl,
    updatedBy: record?.updated_by ?? FALLBACK_COMPANY_PROFILE.updatedBy,
    updatedAt: record?.updated_at ?? FALLBACK_COMPANY_PROFILE.updatedAt,
    createdAt: record?.created_at ?? FALLBACK_COMPANY_PROFILE.createdAt,
    name: companyName,
    trnText: trn,
    logoPath: logoUrl,
    offices: summaryLine ? [{ label: "Office", location: summaryLine }] : FALLBACK_COMPANY_PROFILE.offices,
  };
}

export async function getCompanySettingsRecord() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<CompanySettingsRecord>();

  if (error) {
    console.error("COMPANY SETTINGS READ ERROR", error.message);
    return null;
  }

  return data;
}

export async function getCompanyProfile() {
  const record = await getCompanySettingsRecord();
  return companyProfileFromRecord(record);
}

export function companyAddressLines(profile: CompanyProfile) {
  const cityCountry = [profile.city, profile.country].filter(Boolean).join(", ");
  return [profile.addressLine1, profile.addressLine2, cityCountry || null].filter(Boolean);
}

export function companySummaryLine(profile: CompanyProfile) {
  return companyAddressLines(profile).join(" / ");
}

export function isRemoteOrAppLogo(value: string) {
  return /^(https?:|data:|blob:|\/)/i.test(value);
}
