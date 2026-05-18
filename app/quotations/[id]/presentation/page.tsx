import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import { QuotationPresentation } from "@/components/quotations/quotation-presentation";
import { requireActiveUser } from "@/lib/auth";
import { getCompanyProfile, isRemoteOrAppLogo } from "@/lib/company-profile";
import { normalizePresentationSettings } from "@/lib/quotations/presentation-settings";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PresentationPageProps = {
  params: Promise<{ id: string }>;
};

type Client = {
  id: string;
  company_name: string;
};

type Project = {
  id: string;
  project_name: string | null;
  location: string | null;
  attention_to: string | null;
};

type Quotation = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
};

type QuotationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

type QuotationItem = {
  id: string;
  section_id: string | null;
  item_type: string;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  category_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  finish_selections_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  sort_order: number;
  line_style: string;
  is_active: boolean;
  cell_layout: {
    images?: Record<string, unknown>;
  } | null;
};

type PresentationSettingsRecord = {
  settings_json: unknown;
  updated_at: string;
};

function presentationDocumentTitle(quotation?: Pick<Quotation, "quotation_no" | "title"> | null) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Furniture Presentation";

  return `${quotationNo} - ${title} Presentation`.replace(/[\\/:*?"<>|]/g, "-");
}

export async function generateMetadata({ params }: PresentationPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseClient();
  const { data: quotation } = await supabase
    .from("quotations")
    .select("quotation_no,title")
    .eq("id", id)
    .maybeSingle<Pick<Quotation, "quotation_no" | "title">>();

  return {
    title: presentationDocumentTitle(quotation),
  };
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
}

function hasUsableCompanyLogo(logoUrl: string | null) {
  if (!logoUrl) return false;
  if (!isRemoteOrAppLogo(logoUrl)) return false;
  if (!logoUrl.startsWith("/")) return true;
  return existsSync(join(process.cwd(), "public", logoUrl.replace(/^\//, "")));
}

async function signedImageUrl(value: string | null, supabase: Awaited<ReturnType<typeof createSupabaseClient>>) {
  if (!value) return null;
  if (isDirectImageUrl(value)) return value;

  const bucket = value.startsWith("product-images:") ? "product-images" : "quote-images";
  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value.startsWith("quote-images:")
      ? value.slice("quote-images:".length)
      : value;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("PRESENTATION IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function booleanFromRecord(record: Record<string, unknown>, key: string, fallback: boolean) {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function finishSelections(value: unknown) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (typeof value !== "string") return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function materialEntries(item: QuotationItem) {
  return finishSelections(item.finish_selections_snapshot)
    .filter((finish) => booleanFromRecord(finish, "show_in_specification", true));
}

function selectedFinishEntries(item: QuotationItem) {
  return materialEntries(item)
    .filter((finish) => {
      if (stringFromRecord(finish, ["type"]) === "material_group_chart") return false;
      return Boolean(
        stringFromRecord(finish, ["finish_code"]) ||
        stringFromRecord(finish, ["finish_name"]) ||
        stringFromRecord(finish, ["finish_description"]) ||
        stringFromRecord(finish, ["finish_image_url"]),
      );
    });
}

export default async function QuotationPresentationPage({ params }: PresentationPageProps) {
  await requireActiveUser();
  const { id } = await params;
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,title,quotation_date")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const [{ data: client }, { data: project }, { data: sections }, { data: items }, { data: presentationSettings }, companyProfile] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,company_name")
        .eq("id", quotation.client_id)
        .maybeSingle<Client>(),
      supabase
        .from("projects")
        .select("id,project_name,location,attention_to")
        .eq("id", quotation.project_id)
        .maybeSingle<Project>(),
      supabase
        .from("quotation_sections")
        .select("id,section_title,section_notes,parent_section_id,section_kind,sort_order,is_active")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .returns<QuotationSection[]>(),
      supabase
        .from("quotation_items")
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,sort_order,line_style,is_active,cell_layout")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .returns<QuotationItem[]>(),
      supabase
        .from("quotation_presentations")
        .select("settings_json,updated_at")
        .eq("quotation_id", id)
        .maybeSingle<PresentationSettingsRecord>(),
      getCompanyProfile(),
    ]);

  const activeItems = (items ?? []).filter((item) => item.is_active !== false);
  const imageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot ?? item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const finishImageEntries = await Promise.all(
    activeItems.flatMap((item) =>
      selectedFinishEntries(item).map(async (finish, index) => {
        const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
        const finishImageUrl = stringFromRecord(finish, ["finish_image_url"]);

        return [
          `${item.id}:${finishId}`,
          await signedImageUrl(finishImageUrl, supabase),
        ] as const;
      }),
    ),
  );

  const normalizedCompanyProfile = {
    ...companyProfile,
    logoUrl: hasUsableCompanyLogo(companyProfile.logoUrl) ? companyProfile.logoUrl : null,
  };
  const initialSettings = normalizePresentationSettings(presentationSettings?.settings_json, {
    updatedAt: presentationSettings?.updated_at ?? null,
  });

  return (
    <QuotationPresentation
      client={client ?? null}
      companyProfile={normalizedCompanyProfile}
      finishImageUrlByItemAndFinishId={Object.fromEntries(finishImageEntries)}
      imageUrlByItemId={Object.fromEntries(imageEntries)}
      initialSettings={initialSettings}
      items={items ?? []}
      project={project ?? null}
      quotation={quotation}
      sections={sections ?? []}
    />
  );
}
