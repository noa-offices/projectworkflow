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
  source_component_data: unknown;
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
  is_optional: boolean;
  include_in_total: boolean;
  is_rate_only: boolean;
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

type SupplierCodeEntry = {
  code: string;
  label: string;
};

function splitSupplierCodes(value: string | null | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function addSupplierCodeEntries(
  entries: SupplierCodeEntry[],
  seenEntries: Set<string>,
  seenCodes: Set<string>,
  codeValue: string | null | undefined,
  label: string | null | undefined,
  options: { skipSeenCodes?: boolean } = {},
) {
  const normalizedLabel = label?.trim() || "Item";
  const codes = splitSupplierCodes(codeValue);
  const uniqueCodes = codes.filter((code, index) =>
    codes.findIndex((candidate) => candidate.toLowerCase() === code.toLowerCase()) === index
  );
  const nextCodes: string[] = [];

  for (const code of uniqueCodes) {
    const codeKey = code.toLowerCase();
    if (options.skipSeenCodes && seenCodes.has(codeKey)) {
      continue;
    }

    const dedupeKey = `${normalizedLabel.toLowerCase()}::${code.toLowerCase()}`;
    if (seenEntries.has(dedupeKey)) {
      continue;
    }

    seenEntries.add(dedupeKey);
    seenCodes.add(codeKey);
    nextCodes.push(code);
  }

  if (nextCodes.length) {
    entries.push({
      code: nextCodes.join(" / "),
      label: normalizedLabel,
    });
  }
}

function supplierCodeLabel(record: Record<string, unknown>, fallback: string) {
  return stringFromRecord(record, [
    "item_name",
    "display_name",
    "variant_name",
    "label",
    "template_name",
    "group_name",
    "component_name",
    "name",
  ]) ?? fallback;
}

function compactSupplierCodeLabel(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim() || fallback;
  return normalized
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

export function collectSupplierCodeSummary(sourceData: unknown): SupplierCodeEntry[] {
  const itemRecord = isRecord(sourceData) && "source_component_data" in sourceData ? sourceData : null;
  const sourceRecord = itemRecord && isRecord(itemRecord.source_component_data)
    ? itemRecord.source_component_data
    : isRecord(sourceData)
      ? sourceData
      : null;
  if (!sourceRecord) return [];

  const entries: SupplierCodeEntry[] = [];
  const seenEntries = new Set<string>();
  const seenCodes = new Set<string>();

  const desking = isRecord(sourceRecord.desking) ? sourceRecord.desking : null;
  if (desking) {
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(desking, ["base_supplier_price_list_code"]),
      "Base",
    );
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(desking, ["additional_supplier_price_list_code"]),
      "Additional",
    );
  }

  const variantPricing = isRecord(sourceRecord.variant_pricing) ? sourceRecord.variant_pricing : null;
  if (variantPricing) {
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(variantPricing, ["supplier_price_list_code"]),
      "Main",
    );
  }

  const modularPricing = isRecord(sourceRecord.modular_pricing) ? sourceRecord.modular_pricing : null;
  const modularItems = modularPricing && Array.isArray(modularPricing.items) ? modularPricing.items : [];
  for (const item of modularItems) {
    if (!isRecord(item)) continue;
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(item, ["supplier_price_list_code"]),
      compactSupplierCodeLabel(supplierCodeLabel(item, "Modular item"), "Modular"),
    );
  }

  const categoryPricing = isRecord(sourceRecord.category_pricing) ? sourceRecord.category_pricing : null;
  const selectedRow = categoryPricing && isRecord(categoryPricing.selected_row) ? categoryPricing.selected_row : null;
  if (selectedRow) {
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(selectedRow, ["supplier_price_list_code"]),
      "Main",
    );
  }

  const addOns = isRecord(sourceRecord.add_ons) ? sourceRecord.add_ons : null;
  const addOnGroups = addOns && Array.isArray(addOns.groups) ? addOns.groups : [];
  for (const group of addOnGroups) {
    if (!isRecord(group)) continue;
    const items = Array.isArray(group.items) ? group.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      addSupplierCodeEntries(
        entries,
        seenEntries,
        seenCodes,
        stringFromRecord(item, ["supplier_price_list_code"]),
        compactSupplierCodeLabel(supplierCodeLabel(item, "Accessory"), "Accessory"),
      );
    }
  }

  const linkedProducts = isRecord(sourceRecord.linked_products) ? sourceRecord.linked_products : null;
  const linkedItems = linkedProducts && Array.isArray(linkedProducts.items) ? linkedProducts.items : [];
  for (const item of linkedItems) {
    if (!isRecord(item)) continue;
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(item, ["supplier_price_list_code"]),
      compactSupplierCodeLabel(supplierCodeLabel(item, "Linked product"), "Linked product"),
    );

    const accessories = Array.isArray(item.accessories) ? item.accessories : [];
    for (const accessory of accessories) {
      if (!isRecord(accessory)) continue;
      addSupplierCodeEntries(
        entries,
        seenEntries,
        seenCodes,
        stringFromRecord(accessory, ["supplier_price_list_code"]),
        compactSupplierCodeLabel(supplierCodeLabel(accessory, "Add-on"), "Add-on"),
      );
    }
  }

  const selectedOptions = [
    ...arrayRecords(sourceRecord.selected_options),
    ...arrayRecords(sourceRecord.selected_options_snapshot),
    ...arrayRecords(itemRecord?.selected_options_snapshot),
  ];
  for (const option of selectedOptions) {
    addSupplierCodeEntries(
      entries,
      seenEntries,
      seenCodes,
      stringFromRecord(option, ["supplier_price_list_code", "component_code"]),
      compactSupplierCodeLabel(supplierCodeLabel(option, "Option"), "Option"),
    );

    const selectedVariant = isRecord(option.selected_variant) ? option.selected_variant : null;
    if (selectedVariant) {
      addSupplierCodeEntries(
        entries,
        seenEntries,
        seenCodes,
        stringFromRecord(selectedVariant, ["supplier_price_list_code"]),
        compactSupplierCodeLabel(supplierCodeLabel(selectedVariant, "Option"), "Option"),
      );
    }

    const accessories = Array.isArray(option.accessories) ? option.accessories : [];
    for (const accessory of accessories) {
      if (!isRecord(accessory)) continue;
      addSupplierCodeEntries(
        entries,
        seenEntries,
        seenCodes,
        stringFromRecord(accessory, ["supplier_price_list_code"]),
        compactSupplierCodeLabel(supplierCodeLabel(accessory, "Add-on"), "Add-on"),
      );
    }
  }

  addSupplierCodeEntries(
    entries,
    seenEntries,
    seenCodes,
    stringFromRecord(sourceRecord, ["supplier_price_list_code"]),
    "Main",
    { skipSeenCodes: true },
  );

  return entries;
}

export function formatSupplierCodeSummary(entries: SupplierCodeEntry[]) {
  return entries.map((entry) => `${entry.label} ${entry.code}`).join(" | ");
}

export function supplierPriceListCodeFromSourceData(sourceData: unknown) {
  const entries = collectSupplierCodeSummary(sourceData);

  if (!entries.length) {
    return null;
  }

  return formatSupplierCodeSummary(entries);
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
      .select("id,section_id,item_type,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,supplier_name_snapshot,qty,unit_label,unit_price,net_total,currency,sort_order,is_optional,include_in_total,is_rate_only,line_style,is_active,notes")
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
