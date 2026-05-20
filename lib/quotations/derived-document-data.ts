import { getCompanyProfile, type CompanyProfile } from "@/lib/company-profile";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export type DerivedDocumentClient = {
  id: string;
  company_name: string;
};

export type DerivedDocumentProject = {
  id: string;
  project_name: string;
  project_year: number | null;
  project_code: string | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

export type DerivedDocumentQuotation = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  currency: string;
  subtotal: number;
  discount_total: number;
  vat_percent: number;
  vat_amount: number;
  grand_total: number;
  payment_terms: string | null;
  delivery_terms: string | null;
  notes: string | null;
};

export type DerivedDocumentSection = {
  id: string;
  section_title: string;
  section_notes: string | null;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  sort_order: number;
  is_active: boolean;
};

export type DerivedDocumentItem = {
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
  selected_options_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  supplier_name_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  line_style: string;
  is_active: boolean;
  notes: string | null;
};

export type DerivedDocumentData = {
  client: DerivedDocumentClient | null;
  companyProfile: CompanyProfile;
  imageUrlByItemId: Map<string, string | null>;
  items: DerivedDocumentItem[];
  project: DerivedDocumentProject | null;
  quotation: DerivedDocumentQuotation;
  sections: DerivedDocumentSection[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function isDirectImageUrl(value: string) {
  return /^(https?:|data:|\/)/i.test(value);
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
    console.error("DERIVED DOCUMENT IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
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

export function selectedFinishSummaries(item: Pick<DerivedDocumentItem, "finish_selections_snapshot" | "finish_snapshot">) {
  const selectedFinishes = finishSelections(item.finish_selections_snapshot)
    .filter((finish) => stringFromRecord(finish, ["type"]) !== "material_group_chart")
    .map((finish) => {
      const group = stringFromRecord(finish, ["group_label"]);
      const code = stringFromRecord(finish, ["finish_code"]);
      const name = stringFromRecord(finish, ["finish_name", "finish_value", "value", "name"]);
      const detail = [name, code].filter(Boolean).join(" / ");
      return [group, detail].filter(Boolean).join(": ");
    })
    .filter(Boolean);

  if (selectedFinishes.length > 0) {
    return selectedFinishes;
  }

  return item.finish_snapshot?.trim() ? [item.finish_snapshot.trim()] : [];
}

export function documentItemTitle(item: Pick<DerivedDocumentItem, "item_name_snapshot" | "model_snapshot" | "item_code_snapshot">) {
  return item.item_name_snapshot || item.model_snapshot || item.item_code_snapshot || "Quotation Item";
}

export function isDocumentItem(item: Pick<DerivedDocumentItem, "item_type" | "line_style" | "is_active">) {
  if (!item.is_active) return false;
  if (["heading", "note", "blank", "subtotal"].includes(item.item_type)) return false;
  if (["heading", "note", "no_quote"].includes(item.line_style)) return false;
  return true;
}

export function projectContactLine(project?: DerivedDocumentProject | null) {
  return [
    project?.attention_to ? `Attn: ${project.attention_to}` : null,
    project?.attention_mobile ? `Mob: ${project.attention_mobile}` : null,
    project?.attention_landline ? `Tel: ${project.attention_landline}` : null,
    project?.attention_email ? `Email: ${project.attention_email}` : null,
    project?.po_box ? `PO Box: ${project.po_box}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
}

export function itemGroupLabel(item: Pick<DerivedDocumentItem, "supplier_name_snapshot" | "brand_name_snapshot">) {
  const supplier = item.supplier_name_snapshot?.trim();
  if (supplier) {
    return { label: supplier, type: "Supplier" as const };
  }

  const brand = item.brand_name_snapshot?.trim();
  if (brand) {
    return { label: brand, type: "Brand" as const };
  }

  return { label: "Unassigned Supplier", type: "Unassigned Supplier" as const };
}

export function preferredItemImageUrl(item: Pick<DerivedDocumentItem, "id">, imageUrlByItemId: Map<string, string | null>) {
  return imageUrlByItemId.get(item.id) ?? null;
}

export async function loadQuotationDerivedDocumentData(id: string): Promise<DerivedDocumentData | null> {
  const supabase = await createSupabaseClient();
  const companyProfile = await getCompanyProfile();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,revision_no,title,quotation_date,currency,subtotal,discount_total,vat_percent,vat_amount,grand_total,payment_terms,delivery_terms,notes")
    .eq("id", id)
    .maybeSingle<DerivedDocumentQuotation>();

  if (quotationError) {
    console.error("DERIVED DOCUMENT QUOTATION ERROR", quotationError.message);
  }

  if (!quotation) return null;

  const [
    clientResponse,
    projectResponse,
    sectionsResponse,
    itemsResponse,
  ] = await Promise.all([
    supabase
      .from("clients")
      .select("id,company_name")
      .eq("id", quotation.client_id)
      .maybeSingle<DerivedDocumentClient>(),
    supabase
      .from("projects")
      .select("id,project_name,project_year,project_code,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
      .eq("id", quotation.project_id)
      .maybeSingle<DerivedDocumentProject>(),
    supabase
      .from("quotation_sections")
      .select("id,section_title,section_notes,parent_section_id,section_kind,sort_order,is_active")
      .eq("quotation_id", id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("section_title", { ascending: true })
      .returns<DerivedDocumentSection[]>(),
    supabase
      .from("quotation_items")
      .select("id,section_id,item_type,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,supplier_name_snapshot,qty,unit_label,unit_price,net_total,currency,sort_order,line_style,is_active,notes")
      .eq("quotation_id", id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .returns<DerivedDocumentItem[]>(),
  ]);

  const activeItems = (itemsResponse.data ?? []).filter(isDocumentItem);
  const imageEntries = await Promise.all(
    activeItems.map(async (item) => [
      item.id,
      await signedImageUrl(item.proposed_image_url_snapshot ?? item.specified_image_url_snapshot, supabase),
    ] as const),
  );
  const imageUrlByItemId = new Map(imageEntries);
  const itemsBySection = new Map<string, DerivedDocumentItem[]>();

  for (const item of activeItems) {
    const key = item.section_id ?? "unsectioned";
    itemsBySection.set(key, [...(itemsBySection.get(key) ?? []), item]);
  }

  const sections = [
    ...(sectionsResponse.data ?? []),
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

  return {
    client: clientResponse.data ?? null,
    companyProfile,
    imageUrlByItemId,
    items: activeItems,
    project: projectResponse.data ?? null,
    quotation,
    sections,
  };
}
