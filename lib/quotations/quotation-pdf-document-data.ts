import { existsSync } from "node:fs";
import { join } from "node:path";
import { notFound } from "next/navigation";
import {
  companyProfileFromRecord,
  getCompanySettingsRecord,
  isRemoteOrAppLogo,
} from "@/lib/company-profile";
import { DEFAULT_QUOTATION_NOTES } from "@/lib/quotations/quotation-pdf-settings";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  columnWidthPercentages,
  customPrintableColumnValue,
  customPrintablePdfColumns,
  getPdfColumns,
  quotationVisibleFinishes,
  specificationMetadataSettings,
  type Client,
  type Project,
  type Quotation,
  type QuotationItem,
  type QuotationPdfDocumentData,
  type QuotationSection,
} from "@/components/quotations/quotation-pdf-document";

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
}

function hasUsableCompanyLogo(logoUrl: string | null) {
  if (!logoUrl) return false;
  if (!isRemoteOrAppLogo(logoUrl)) return false;
  if (!logoUrl.startsWith("/")) return true;
  return existsSync(join(process.cwd(), "public", logoUrl.replace(/^\//, "")));
}

function sectionSubtotal(items: QuotationItem[]) {
  return items
    .filter((item) => (
      item.line_style !== "rate_only" &&
      !item.is_rate_only &&
      item.line_style !== "no_quote" &&
      item.line_style !== "note" &&
      item.line_style !== "heading" &&
      item.item_type !== "note" &&
      item.item_type !== "blank" &&
      item.item_type !== "subtotal"
    ))
    .reduce((total, item) => total + item.net_total, 0);
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
    console.error("QUOTATION PDF IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
}

function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

export async function loadQuotationPdfDocumentData(id: string): Promise<QuotationPdfDocumentData> {
  const supabase = await createSupabaseClient();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) {
    notFound();
  }

  const [{ data: client }, { data: project }, { data: sections }, { data: items }, companySettingsRecord] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id,company_name")
        .eq("id", quotation.client_id)
        .maybeSingle<Client>(),
      supabase
        .from("projects")
        .select("id,project_name,project_number,project_year,project_code,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
        .eq("id", quotation.project_id)
        .maybeSingle<Project>(),
      supabase
        .from("quotation_sections")
        .select("id,section_title,section_notes,parent_section_id,section_kind,sort_order,is_active")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("section_title", { ascending: true })
        .returns<QuotationSection[]>(),
      supabase
        .from("quotation_items")
        .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,line_style,is_rate_only,is_active,cell_layout,notes")
        .eq("quotation_id", id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .returns<QuotationItem[]>(),
      getCompanySettingsRecord(),
    ]);
  const companyProfile = companyProfileFromRecord(companySettingsRecord);
  const defaultQuotationNotes = companySettingsRecord?.default_quotation_notes?.trim() || DEFAULT_QUOTATION_NOTES;

  const activeItems = (items ?? []).filter((item) => item.is_active);
  const specifiedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const proposedImageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot, supabase),
    ] as const),
  );
  const finishImageEntries = await Promise.all(
    activeItems.flatMap((item) =>
      quotationVisibleFinishes(item).map(async (finish, index) => {
        const finishId = stringFromRecord(finish, ["id"]) || `finish-${index + 1}`;
        const finishImageUrl = stringFromRecord(finish, ["finish_image_url"]);

        return [
          `${item.id}:${finishId}`,
          await signedImageUrl(finishImageUrl, supabase),
        ] as const;
      }),
    ),
  );
  const customPrintableImageEntries = await Promise.all(
    activeItems.flatMap((item) =>
      customPrintablePdfColumns(quotation.layout_settings)
        .filter((column) => column.customPrintableColumnType === "image" && column.customPrintableColumnId)
        .map(async (column) => [
          `${item.id}:${column.customPrintableColumnId}`,
          await signedImageUrl(customPrintableColumnValue(item, column.customPrintableColumnId!), supabase),
        ] as const),
    ),
  );
  const itemsBySection = new Map<string, QuotationItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    itemsBySection.set(key, [...(itemsBySection.get(key) ?? []), item]);
  }

  const activeSections = [
    ...(sections ?? []),
    ...(itemsBySection.has("unsectioned")
      ? [{
          id: "unsectioned",
          section_title: "General Items",
          section_notes: null,
          parent_section_id: null,
          section_kind: "sub" as const,
          sort_order: 999999,
          is_active: true,
        }]
      : []),
  ];
  const pdfColumns = getPdfColumns(quotation.layout_mode, quotation.layout_settings);
  const sectionTotals = new Map<string, number>();

  for (const [sectionId, sectionItems] of itemsBySection.entries()) {
    sectionTotals.set(sectionId, sectionSubtotal(sectionItems));
  }

  const mainSectionIds = new Set(
    activeSections
      .filter((section) => section.section_kind === "main")
      .map((section) => section.id),
  );
  const sectionById = new Map(activeSections.map((section) => [section.id, section]));
  const childrenByParent = new Map<string, QuotationSection[]>();

  for (const section of activeSections) {
    if (section.section_kind !== "sub" || !section.parent_section_id) continue;
    childrenByParent.set(section.parent_section_id, [...(childrenByParent.get(section.parent_section_id) ?? []), section]);
  }

  const mainSectionTotals = new Map<string, number>();
  for (const [mainSectionId, childSections] of childrenByParent.entries()) {
    mainSectionTotals.set(
      mainSectionId,
      childSections.reduce((total, section) => total + (sectionTotals.get(section.id) ?? 0), 0),
    );
  }

  const printableSections = [];
  for (const section of activeSections) {
    if (section.section_kind === "main") {
      printableSections.push({ ...section, renderAsMainOnly: true });
      for (const child of childrenByParent.get(section.id) ?? []) {
        printableSections.push(child);
      }
      continue;
    }

    if (section.parent_section_id && mainSectionIds.has(section.parent_section_id)) {
      continue;
    }

    printableSections.push(section);
  }

  return {
    client: client ?? null,
    companyProfile,
    customPrintableImageUrlByItemAndColumnId: new Map(customPrintableImageEntries),
    finishImageUrlByItemAndFinishId: new Map(finishImageEntries),
    hasLogo: hasUsableCompanyLogo(companyProfile.logoPath),
    itemsBySection,
    mainSectionIds,
    mainSectionTotals,
    metadataSettings: specificationMetadataSettings(quotation.layout_settings),
    pdfColumnWidths: columnWidthPercentages(pdfColumns),
    pdfColumns,
    printableSections,
    project: project ?? null,
    proposedImageUrlByItemId: new Map(proposedImageEntries),
    quotation,
    sectionById,
    sectionTotals,
    specifiedImageUrlByItemId: new Map(specifiedImageEntries),
    visibleColumnKeys: new Set(pdfColumns.map((column) => column.key)),
    defaultQuotationNotes,
  };
}
