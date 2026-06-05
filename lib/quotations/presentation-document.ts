import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCompanyProfile, isRemoteOrAppLogo, type CompanyProfile } from "@/lib/company-profile";
import { normalizePresentationSettings, type QuotationPresentationSettings } from "@/lib/quotations/presentation-settings";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type PresentationClient = {
  id: string;
  company_name: string;
} | null;

export type PresentationProject = {
  id: string;
  project_name: string | null;
  location: string | null;
  attention_to: string | null;
} | null;

export type PresentationQuotation = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  title: string;
  quotation_date: string;
};

export type PresentationSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

export type PresentationItem = {
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
  is_optional?: boolean;
  is_rate_only?: boolean;
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

export type LoadedQuotationPresentationData = {
  client: PresentationClient;
  companyProfile: CompanyProfile;
  finishImageUrlByItemAndFinishId: Record<string, string | null>;
  imageUrlByItemId: Record<string, string | null>;
  initialSettings: QuotationPresentationSettings;
  items: PresentationItem[];
  mainLayoutImageUrlById: Record<string, string | null>;
  presentationOverrideImageUrlByItemId: Record<string, string | null>;
  project: PresentationProject;
  quotation: PresentationQuotation;
  sectionOverrideImageUrlBySectionAndField: Record<string, string | null>;
  sections: PresentationSection[];
};

function migratedMainSectionOverridesFromLegacy(
  settings: ReturnType<typeof normalizePresentationSettings>,
  sections: PresentationSection[],
) {
  if (Object.keys(settings.mainSectionOverrides).length) return settings;

  const mainSections = sections
    .filter((section) => section.is_active !== false && section.section_kind === "main")
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));

  if (!mainSections.length || !settings.presentationVisuals.mainLayouts.length) return settings;

  const normalizedTitle = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";
  const nextOverrides = { ...settings.mainSectionOverrides };

  settings.presentationVisuals.mainLayouts.forEach((layout) => {
    const matchedSection = mainSections.find((section) => normalizedTitle(section.section_title) === normalizedTitle(layout.title));
    if (!matchedSection) return;
    if (nextOverrides[matchedSection.id]) return;

    nextOverrides[matchedSection.id] = {
      title: layout.title,
      note: layout.note,
      layoutImageUrl: layout.imageUrl,
    };
  });

  return {
    ...settings,
    mainSectionOverrides: nextOverrides,
    presentationVisuals: {
      ...settings.presentationVisuals,
      mainLayouts: [],
    },
  };
}

export function presentationDocumentTitle(
  quotation?: Pick<PresentationQuotation, "quotation_no" | "title"> | null,
) {
  const quotationNo = quotation?.quotation_no ?? "Draft";
  const title = quotation?.title ?? "Furniture Presentation";

  return `${quotationNo} - ${title} Presentation`.replace(/[\\/:*?"<>|]/g, "-");
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

function materialEntries(item: PresentationItem) {
  return finishSelections(item.finish_selections_snapshot)
    .filter((finish) => booleanFromRecord(finish, "show_in_specification", true));
}

function selectedFinishEntries(item: PresentationItem) {
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

export async function loadQuotationPresentationData(
  quotationId: string,
): Promise<LoadedQuotationPresentationData | null> {
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,title,quotation_date")
    .eq("id", quotationId)
    .single<PresentationQuotation>();

  if (quotationError || !quotation) {
    return null;
  }

  const [{ data: client }, { data: project }, { data: sections }, { data: items }, { data: presentationSettings }, companyProfile] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,company_name")
        .eq("id", quotation.client_id)
        .maybeSingle<NonNullable<PresentationClient>>(),
      supabase
        .from("projects")
        .select("id,project_name,location,attention_to")
        .eq("id", quotation.project_id)
        .maybeSingle<NonNullable<PresentationProject>>(),
      supabase
        .from("quotation_sections")
        .select("id,section_title,section_notes,parent_section_id,section_kind,sort_order,is_active")
        .eq("quotation_id", quotationId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .returns<PresentationSection[]>(),
      supabase
        .from("quotation_items")
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,sort_order,is_optional,is_rate_only,line_style,is_active,cell_layout")
        .eq("quotation_id", quotationId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .returns<PresentationItem[]>(),
      supabase
        .from("quotation_presentations")
        .select("settings_json,updated_at")
        .eq("quotation_id", quotationId)
        .maybeSingle<PresentationSettingsRecord>(),
      getCompanyProfile(),
    ]);

  const activeItems = (items ?? []).filter((item) => item.is_active !== false);
  const initialSettings = migratedMainSectionOverridesFromLegacy(normalizePresentationSettings(presentationSettings?.settings_json, {
    updatedAt: presentationSettings?.updated_at ?? null,
  }), sections ?? []);
  const imageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot ?? item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const presentationOverrideImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(initialSettings.itemOverrides[item.id]?.imageUrl ?? null, supabase),
    ] as const),
  );
  const mainLayoutImageEntries = await Promise.all(
    Object.entries(initialSettings.mainSectionOverrides).map(async ([sectionId, override]) => [
      sectionId,
      await signedImageUrl(override.layoutImageUrl ?? null, supabase),
    ] as const),
  );
  const sectionOverrideImageEntries = await Promise.all(
    (sections ?? []).flatMap((section) => {
      const override = initialSettings.sectionOverrides[section.id];
      return ([
        ["areaImageUrl", override?.areaImageUrl ?? null],
        ["sectionLayoutImageUrl", override?.sectionLayoutImageUrl ?? null],
      ] as const).map(async ([field, value]) => [
        `${section.id}:${field}`,
        await signedImageUrl(value, supabase),
      ] as const);
    }),
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

  return {
    client: client ?? null,
    companyProfile: normalizedCompanyProfile,
    finishImageUrlByItemAndFinishId: Object.fromEntries(finishImageEntries),
    imageUrlByItemId: Object.fromEntries(imageEntries),
    initialSettings,
    items: items ?? [],
    mainLayoutImageUrlById: Object.fromEntries(mainLayoutImageEntries),
    presentationOverrideImageUrlByItemId: Object.fromEntries(presentationOverrideImageEntries),
    project: project ?? null,
    quotation,
    sectionOverrideImageUrlBySectionAndField: Object.fromEntries(sectionOverrideImageEntries),
    sections: sections ?? [],
  };
}
