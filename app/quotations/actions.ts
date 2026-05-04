"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRecordsManager } from "@/lib/auth";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

const quotationStatuses = new Set([
  "draft",
  "sent",
  "revised",
  "approved",
  "won",
  "lost",
  "cancelled",
]);
const discountTypes = new Set(["amount", "percent"]);
const mergeModes = new Set(["none", "merge_specification", "merge_full_row"]);
const itemTypes = new Set(["product", "custom", "note", "blank", "subtotal"]);
const layoutModes = new Set([
  "simple_proposal",
  "standard_proposal",
  "comparison",
  "boq_schedule",
  "internal_costing",
]);
const sectionTypes = new Set(["option", "floor", "room", "category", "section"]);
const titleAlignments = new Set(["left", "center", "right"]);
const titleBackgrounds = new Set(["light_grey", "white", "dark_grey"]);
const titleSizes = new Set(["normal", "large"]);
const cellStyleKeys = new Set(["specification", "full_row"]);
const fontSizes = new Set(["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32"]);
const fontWeights = new Set(["400", "700"]);
const fontStyles = new Set(["normal", "italic"]);
const textDecorations = new Set(["none", "underline"]);
const textAlignments = new Set(["left", "center", "right"]);
const lineStyles = new Set([
  "normal",
  "optional",
  "rate_only",
  "no_quote",
  "note",
  "heading",
]);
const excludedTotalLineStyles = new Set(["rate_only", "no_quote", "note", "heading"]);
const layoutColumnKeys = [
  "s_no",
  "code",
  "specified_image",
  "proposed_image",
  "reference_image",
  "specification",
  "description",
  "room",
  "model",
  "finish",
  "size",
  "origin",
  "warranty",
  "qty",
  "unit_price",
  "discount",
  "discount_value",
  "discount_percentage",
  "discount_amount",
  "net_price",
  "net_total",
  "edit",
  "internal_cost",
  "margin",
  "supplier_notes",
  "supplier_name",
  "manual_serial",
] as const;

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

function boolValue(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function numberValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseFloat(textValue(formData, name));
  return Number.isFinite(value) ? value : fallback;
}

function integerValue(formData: FormData, name: string, fallback: number) {
  const value = Number.parseInt(textValue(formData, name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function optionalIntegerInRange(formData: FormData, name: string, min: number, max: number) {
  const rawValue = textValue(formData, name);
  if (!rawValue) return null;

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value)) return null;

  return Math.min(Math.max(value, min), max);
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function redirectWithMessage(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";

  redirect(`${path}${separator}message=${encodeURIComponent(message)}`);
}

function returnPath(formData: FormData, fallback: string) {
  const value = textValue(formData, "return_to");

  return value.startsWith("/quotations/") || value.startsWith("/clients/projects/")
    ? value
    : fallback;
}

function allowedText(formData: FormData, name: string, allowed: Set<string>, fallback: string) {
  const value = textValue(formData, name);

  return allowed.has(value) ? value : fallback;
}

type CellLayoutPayload = {
  mergeMode: string;
  cells?: Record<string, {
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    textDecoration: string;
    textAlign: string;
    wrapText: boolean;
  }>;
};

function isCellLayoutPayload(value: unknown): value is CellLayoutPayload {
  return typeof value === "object" && value !== null;
}

function cellLayoutValue(formData: FormData, currentLayout?: unknown): CellLayoutPayload {
  const current: Partial<CellLayoutPayload> = isCellLayoutPayload(currentLayout) ? currentLayout : {};
  const layout: CellLayoutPayload = {
    ...current,
    mergeMode: formData.has("merge_mode")
      ? allowedText(formData, "merge_mode", mergeModes, "none")
      : current.mergeMode && mergeModes.has(current.mergeMode)
        ? current.mergeMode
        : "none",
  };

  const submittedCells = formData
    .getAll("cell_style_key")
    .filter((value): value is string => typeof value === "string" && cellStyleKeys.has(value));
  const cells: CellLayoutPayload["cells"] = { ...(current.cells ?? {}) };

  for (const cellKey of Array.from(new Set(submittedCells))) {
    cells[cellKey] = {
      fontSize: Number(allowedText(formData, `cell_style_${cellKey}_font_size`, fontSizes, "12")),
      fontWeight: allowedText(formData, `cell_style_${cellKey}_font_weight`, fontWeights, "400"),
      fontStyle: allowedText(formData, `cell_style_${cellKey}_font_style`, fontStyles, "normal"),
      textDecoration: allowedText(formData, `cell_style_${cellKey}_text_decoration`, textDecorations, "none"),
      textAlign: allowedText(formData, `cell_style_${cellKey}_text_align`, textAlignments, "left"),
      wrapText: textValue(formData, `cell_style_${cellKey}_wrap_text`) !== "false",
    };
  }

  if (Object.keys(cells).length) {
    layout.cells = cells;
  }

  return layout;
}

function quotationPayload(formData: FormData, userId?: string) {
  const payload = {
    client_id: textValue(formData, "client_id"),
    project_id: textValue(formData, "project_id"),
    quotation_no: optionalTextValue(formData, "quotation_no"),
    title: textValue(formData, "title"),
    quotation_date: textValue(formData, "quotation_date") || new Date().toISOString().slice(0, 10),
    status: textValue(formData, "status") || "draft",
    layout_mode: textValue(formData, "layout_mode") || "standard_proposal",
    currency: textValue(formData, "currency") || "AED",
    vat_percent: numberValue(formData, "vat_percent", 5),
    overall_discount_type: allowedText(
      formData,
      "overall_discount_type",
      discountTypes,
      "amount",
    ),
    overall_discount_value: numberValue(formData, "overall_discount_value", 0),
    payment_terms: optionalTextValue(formData, "payment_terms"),
    validity: optionalTextValue(formData, "validity"),
    delivery_terms: optionalTextValue(formData, "delivery_terms"),
    warranty_terms: optionalTextValue(formData, "warranty_terms"),
    notes: optionalTextValue(formData, "notes"),
    is_active: boolValue(formData, "is_active"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

type QuotationCopyMode = "duplicate" | "revision" | "option";

type QuotationCopySource = {
  id: string;
  client_id: string;
  project_id: string;
  quotation_no: string | null;
  revision_no: number;
  title: string;
  quotation_date: string;
  currency: string;
  vat_percent: number;
  payment_terms: string | null;
  validity: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  notes: string | null;
  layout_mode: string;
  layout_settings: Record<string, unknown> | null;
  overall_discount_type: string;
  overall_discount_value: number;
};

type QuotationSectionCopySource = {
  id: string;
  section_title: string;
  section_notes: string | null;
  section_type: string;
  title_align: string;
  title_bold: boolean;
  title_bg: string;
  title_size: string;
  row_height: number | null;
  sort_order: number;
};

type QuotationItemCopySource = {
  id: string;
  section_id: string | null;
  item_type: string;
  source_template_id: string | null;
  source_component_data: unknown;
  manual_serial: string | null;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  brand_name_snapshot: string | null;
  category_name_snapshot: string | null;
  specified_image_url_snapshot: string | null;
  proposed_image_url_snapshot: string | null;
  specification_snapshot: string | null;
  selected_options_snapshot: unknown;
  internal_components_snapshot: unknown;
  room_name_snapshot: string | null;
  model_snapshot: string | null;
  finish_snapshot: string | null;
  size_snapshot: string | null;
  origin_snapshot: string | null;
  warranty_snapshot: string | null;
  supplier_name_snapshot: string | null;
  supplier_notes_snapshot: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  discount_type: string;
  discount_value: number;
  net_price: number;
  net_total: number;
  currency: string;
  sort_order: number;
  is_optional: boolean;
  internal_cost: number;
  margin_type: string;
  margin_value: number;
  is_rate_only: boolean;
  line_style: string;
  row_height: number | null;
  cell_layout: unknown;
  notes: string | null;
};

const quotationCopySelect =
  "id,client_id,project_id,quotation_no,revision_no,title,quotation_date,currency,vat_percent,payment_terms,validity,delivery_terms,warranty_terms,notes,layout_mode,layout_settings,overall_discount_type,overall_discount_value";

const sectionCopySelect =
  "id,section_title,section_notes,section_type,title_align,title_bold,title_bg,title_size,row_height,sort_order";

const itemCopySelect =
  "id,section_id,item_type,source_template_id,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,selected_options_snapshot,internal_components_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,notes";

function itemPayload(formData: FormData, userId?: string) {
  const qty = numberValue(formData, "qty", 1);
  const unitPrice = numberValue(formData, "unit_price", 0);
  const discountType = textValue(formData, "discount_type") || "amount";
  const discountValue = numberValue(formData, "discount_value", 0);
  const rawNetPrice =
    discountType === "percent"
      ? unitPrice - (unitPrice * discountValue) / 100
      : unitPrice - discountValue;
  const netPrice = money(Math.max(rawNetPrice, 0));
  const payload = {
    quotation_id: textValue(formData, "quotation_id"),
    section_id: optionalTextValue(formData, "section_id"),
    item_type: textValue(formData, "item_type") || "custom",
    manual_serial: optionalTextValue(formData, "manual_serial"),
    item_code_snapshot: optionalTextValue(formData, "item_code_snapshot"),
    item_name_snapshot: optionalTextValue(formData, "item_name_snapshot"),
    specified_image_url_snapshot: optionalTextValue(
      formData,
      "specified_image_url_snapshot",
    ),
    proposed_image_url_snapshot: optionalTextValue(
      formData,
      "proposed_image_url_snapshot",
    ),
    specification_snapshot: optionalTextValue(formData, "specification_snapshot"),
    room_name_snapshot: optionalTextValue(formData, "room_name_snapshot"),
    model_snapshot: optionalTextValue(formData, "model_snapshot"),
    finish_snapshot: optionalTextValue(formData, "finish_snapshot"),
    size_snapshot: optionalTextValue(formData, "size_snapshot"),
    origin_snapshot: optionalTextValue(formData, "origin_snapshot"),
    warranty_snapshot: optionalTextValue(formData, "warranty_snapshot"),
    supplier_name_snapshot: optionalTextValue(formData, "supplier_name_snapshot"),
    supplier_notes_snapshot: optionalTextValue(formData, "supplier_notes_snapshot"),
    qty,
    unit_label: textValue(formData, "unit_label") || "Pc",
    unit_price: unitPrice,
    discount_type: discountType,
    discount_value: discountValue,
    net_price: netPrice,
    net_total: money(qty * netPrice),
    currency: textValue(formData, "currency") || "AED",
    sort_order: integerValue(formData, "sort_order", 0),
    is_optional: boolValue(formData, "is_optional"),
    internal_cost: numberValue(formData, "internal_cost", 0),
    margin_type: textValue(formData, "margin_type") || "amount",
    margin_value: numberValue(formData, "margin_value", 0),
    is_rate_only: boolValue(formData, "is_rate_only"),
    line_style: textValue(formData, "line_style") || "normal",
    row_height: optionalIntegerInRange(formData, "row_height", 40, 600),
    cell_layout: cellLayoutValue(formData),
    is_active: boolValue(formData, "is_active"),
    notes: optionalTextValue(formData, "notes"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}

export async function recalculateQuotationTotals(quotationId: string) {
  const supabase = await createSupabaseClient();
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("vat_percent,overall_discount_type,overall_discount_value")
    .eq("id", quotationId)
    .single<{
      vat_percent: number;
      overall_discount_type: string;
      overall_discount_value: number;
    }>();

  if (quotationError) {
    console.error("QUOTATION TOTAL READ ERROR", quotationError.message);
    return;
  }

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select("qty,unit_price,net_total,line_style,is_rate_only,item_type")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .returns<
      Array<{
        qty: number;
        unit_price: number;
        net_total: number;
        line_style: string;
        is_rate_only: boolean;
        item_type: string;
      }>
    >();

  if (itemsError) {
    console.error("QUOTATION ITEMS TOTAL ERROR", itemsError.message);
    return;
  }

  const pricedItems = (items ?? []).filter(
    (item) =>
      !item.is_rate_only &&
      !excludedTotalLineStyles.has(item.line_style) &&
      !["note", "blank", "subtotal"].includes(item.item_type),
  );

  const subtotal = money(
    pricedItems.reduce((total, item) => total + item.qty * item.unit_price, 0),
  );
  const netTotal = money(
    pricedItems.reduce((total, item) => total + item.net_total, 0),
  );
  const discountTotal = money(subtotal - netTotal);
  const overallDiscountAmount = money(
    quotation.overall_discount_type === "percent"
      ? (netTotal * quotation.overall_discount_value) / 100
      : quotation.overall_discount_value,
  );
  const taxableTotal = money(Math.max(netTotal - overallDiscountAmount, 0));
  const vatAmount = money((taxableTotal * quotation.vat_percent) / 100);
  const grandTotal = money(taxableTotal + vatAmount);

  const { error } = await supabase
    .from("quotations")
    .update({
      subtotal,
      discount_total: discountTotal,
      vat_amount: vatAmount,
      grand_total: grandTotal,
    })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION TOTAL UPDATE ERROR", error.message);
  }
}

export async function createQuotation(formData: FormData) {
  const { user } = await requireRecordsManager();
  const payload = quotationPayload(formData, user.id);
  const redirectPath = returnPath(formData, "/quotations");

  if (!payload.client_id || !payload.project_id || !payload.title) {
    redirectWithMessage(redirectPath, "Client, project, and title are required.");
  }

  if (!quotationStatuses.has(payload.status) || !layoutModes.has(payload.layout_mode)) {
    redirectWithMessage(redirectPath, "Select valid quotation settings.");
  }

  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("quotations")
    .insert(payload)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("QUOTATION CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Quotation could not be created.");
  }

  revalidatePath("/quotations");
  revalidatePath(redirectPath);
  redirectWithMessage(`/quotations/${data.id}`, "Quotation created.");
}

function actionQuotationId(formData: FormData) {
  return textValue(formData, "quotation_id");
}

function optionNumberFromTitle(title: string, baseTitle: string) {
  const match = title.match(new RegExp(`^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} - Option (\\d+)$`));

  return match ? Number.parseInt(match[1], 10) : null;
}

function baseQuotationNo(quotationNo: string | null) {
  return quotationNo?.replace(/(?:-R\d+)+$/i, "") ?? null;
}

function revisionNoFromQuotationNo(quotationNo: string | null, baseNo: string) {
  if (quotationNo === baseNo) return 0;

  const match = quotationNo?.match(new RegExp(`^${baseNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-R(\\d+)$`, "i"));

  return match ? Number.parseInt(match[1], 10) : null;
}

function baseRevisionTitle(title: string) {
  return title.replace(/(?:\s+Rev\s+\d+)+$/i, "");
}

async function copyQuotation(
  formData: FormData,
  mode: QuotationCopyMode,
  message: string,
) {
  const { user } = await requireRecordsManager();
  const quotationId = actionQuotationId(formData);
  const redirectPath = returnPath(formData, "/quotations");

  if (!quotationId) {
    redirectWithMessage(redirectPath, "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { data: source, error: sourceError } = await supabase
    .from("quotations")
    .select(quotationCopySelect)
    .eq("id", quotationId)
    .single<QuotationCopySource>();

  if (sourceError || !source) {
    console.error("QUOTATION COPY READ ERROR", sourceError?.message);
    redirectWithMessage(redirectPath, "Quotation could not be copied.");
  }

  let title = `${source.title} - Copy`;
  let quotationNo: string | null = null;
  let revisionNo = 0;

  if (mode === "revision") {
    const baseNo = baseQuotationNo(source.quotation_no);
    let highestRevisionNo = source.revision_no ?? 0;

    if (baseNo) {
      const { data: siblingRevisions, error: siblingError } = await supabase
        .from("quotations")
        .select("quotation_no,revision_no")
        .eq("client_id", source.client_id)
        .eq("project_id", source.project_id)
        .eq("is_active", true)
        .returns<Array<{ quotation_no: string | null; revision_no: number }>>();

      if (siblingError) {
        console.error("QUOTATION REVISION LIST ERROR", siblingError.message);
        redirectWithMessage(redirectPath, "Revision could not be created.");
      }

      highestRevisionNo = Math.max(
        0,
        ...(siblingRevisions ?? [])
          .map((quotation) => revisionNoFromQuotationNo(quotation.quotation_no, baseNo))
          .filter((value): value is number => value !== null && Number.isFinite(value)),
      );
    }

    const nextRevisionNo = highestRevisionNo + 1;
    title = `${baseRevisionTitle(source.title)} Rev ${nextRevisionNo}`;
    quotationNo = baseNo ? `${baseNo}-R${nextRevisionNo}` : null;
    revisionNo = nextRevisionNo;
  }

  if (mode === "option") {
    const { data: siblingQuotations, error: siblingError } = await supabase
      .from("quotations")
      .select("title")
      .eq("project_id", source.project_id)
      .eq("is_active", true)
      .returns<Array<{ title: string }>>();

    if (siblingError) {
      console.error("QUOTATION OPTION LIST ERROR", siblingError.message);
      redirectWithMessage(redirectPath, "Option could not be created.");
    }

    const nextOption = Math.max(
      1,
      ...(siblingQuotations ?? [])
        .map((quotation) => optionNumberFromTitle(quotation.title, source.title))
        .filter((value): value is number => value !== null && Number.isFinite(value)),
    ) + 1;

    title = `${source.title} - Option ${nextOption}`;
  }

  const { data: newQuotation, error: insertError } = await supabase
    .from("quotations")
    .insert({
      client_id: source.client_id,
      project_id: source.project_id,
      quotation_no: quotationNo,
      revision_no: revisionNo,
      title,
      quotation_date: new Date().toISOString().slice(0, 10),
      status: "draft",
      currency: source.currency,
      vat_percent: source.vat_percent,
      payment_terms: source.payment_terms,
      validity: source.validity,
      delivery_terms: source.delivery_terms,
      warranty_terms: source.warranty_terms,
      notes: source.notes,
      layout_mode: source.layout_mode,
      layout_settings: source.layout_settings ?? {},
      overall_discount_type: source.overall_discount_type,
      overall_discount_value: source.overall_discount_value,
      is_active: true,
      created_by: user.id,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !newQuotation) {
    console.error("QUOTATION COPY CREATE ERROR", insertError?.message);
    redirectWithMessage(redirectPath, "Quotation could not be copied.");
  }

  const { data: sections, error: sectionsError } = await supabase
    .from("quotation_sections")
    .select(sectionCopySelect)
    .eq("quotation_id", source.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationSectionCopySource[]>();

  if (sectionsError) {
    console.error("QUOTATION COPY SECTIONS READ ERROR", sectionsError.message);
    redirectWithMessage(redirectPath, "Quotation sections could not be copied.");
  }

  const sectionIdMap = new Map<string, string>();
  for (const section of sections ?? []) {
    const { id: _oldId, ...sectionPayload } = section;
    const { data: newSection, error: sectionInsertError } = await supabase
      .from("quotation_sections")
      .insert({
        ...sectionPayload,
        quotation_id: newQuotation.id,
        is_active: true,
        created_by: user.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (sectionInsertError || !newSection) {
      console.error("QUOTATION COPY SECTION CREATE ERROR", sectionInsertError?.message);
      redirectWithMessage(redirectPath, "Quotation sections could not be copied.");
    }

    sectionIdMap.set(_oldId, newSection.id);
  }

  const { data: items, error: itemsError } = await supabase
    .from("quotation_items")
    .select(itemCopySelect)
    .eq("quotation_id", source.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationItemCopySource[]>();

  if (itemsError) {
    console.error("QUOTATION COPY ITEMS READ ERROR", itemsError.message);
    redirectWithMessage(redirectPath, "Quotation items could not be copied.");
  }

  const itemPayloads = (items ?? []).map((item) => {
    const { id, section_id: sectionId, ...itemPayload } = item;
    void id;

    return {
      ...itemPayload,
      quotation_id: newQuotation.id,
      section_id: sectionId ? sectionIdMap.get(sectionId) ?? null : null,
      is_active: true,
      created_by: user.id,
    };
  });

  if (itemPayloads.length) {
    const { error: itemInsertError } = await supabase
      .from("quotation_items")
      .insert(itemPayloads);

    if (itemInsertError) {
      console.error("QUOTATION COPY ITEM CREATE ERROR", itemInsertError.message);
      redirectWithMessage(redirectPath, "Quotation items could not be copied.");
    }
  }

  await recalculateQuotationTotals(newQuotation.id);
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${newQuotation.id}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, message);
}

export async function duplicateQuotation(formData: FormData) {
  await copyQuotation(formData, "duplicate", "Quotation duplicated.");
}

export async function createQuotationRevision(formData: FormData) {
  await copyQuotation(formData, "revision", "Revision created.");
}

export async function createQuotationOption(formData: FormData) {
  await copyQuotation(formData, "option", "Option created.");
}

export async function deactivateQuotation(formData: FormData) {
  await requireRecordsManager();
  const quotationId = actionQuotationId(formData);
  const redirectPath = returnPath(formData, "/quotations");

  if (!quotationId) {
    redirectWithMessage(redirectPath, "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotations")
    .update({ is_active: false })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Quotation could not be deactivated.");
  }

  revalidatePath("/quotations");
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Quotation deactivated.");
}

export async function updateQuotation(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = quotationPayload(formData);

  if (!id || !payload.client_id || !payload.project_id || !payload.title) {
    redirectWithMessage("/quotations", "Quotation, client, project, and title are required.");
  }

  if (!quotationStatuses.has(payload.status) || !layoutModes.has(payload.layout_mode)) {
    redirectWithMessage(`/quotations/${id}`, "Select valid quotation settings.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("quotations").update(payload).eq("id", id);

  if (error) {
    console.error("QUOTATION UPDATE ERROR", error.message);
    redirectWithMessage(`/quotations/${id}`, "Quotation could not be updated.");
  }

  await recalculateQuotationTotals(id);
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  redirectWithMessage(`/quotations/${id}`, "Quotation updated.");
}

export async function updateQuotationExtraDiscount(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const redirectPath = returnPath(formData, `/quotations/${id}`);
  const overallDiscountType = allowedText(
    formData,
    "overall_discount_type",
    discountTypes,
    "amount",
  );
  const overallDiscountValue = Math.max(numberValue(formData, "overall_discount_value", 0), 0);

  if (!id) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotations")
    .update({
      overall_discount_type: overallDiscountType,
      overall_discount_value: overallDiscountValue,
    })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION EXTRA DISCOUNT UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Extra discount could not be updated.");
  }

  await recalculateQuotationTotals(id);
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  revalidatePath(`/quotations/${id}/builder`);
  redirectWithMessage(redirectPath, "Extra discount updated.");
}

export async function updateQuotationLayoutSettings(formData: FormData) {
  await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!quotationId) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  const submittedKeys = formData
    .getAll("column_key")
    .filter((value): value is string => typeof value === "string" && layoutColumnKeys.includes(value as (typeof layoutColumnKeys)[number]));
  const keys = Array.from(new Set(submittedKeys));
  const columns = keys.map((key) => {
    const width = optionalIntegerInRange(formData, `width_${key}`, 40, 800) ?? 120;

    return {
      key,
      visible: boolValue(formData, `visible_${key}`),
      width,
    };
  });

  const layoutSettings = {
    columns,
    specificationMetadata: {
      title: boolValue(formData, "show_spec_title"),
      model: boolValue(formData, "show_spec_model"),
      size: boolValue(formData, "show_spec_size"),
      finish: boolValue(formData, "show_spec_finish"),
      warranty: boolValue(formData, "show_spec_warranty"),
    },
  };
  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotations")
    .update({ layout_settings: layoutSettings })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION LAYOUT SETTINGS UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Column settings could not be saved.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Column settings saved.");
}

export async function updateQuotationColumnWidth(formData: FormData) {
  await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const columnKey = textValue(formData, "column_key");
  const width = optionalIntegerInRange(formData, "width", 40, 800);

  if (!quotationId || !layoutColumnKeys.includes(columnKey as (typeof layoutColumnKeys)[number]) || width === null) {
    return { ok: false, message: "Invalid column width." };
  }

  const supabase = await createSupabaseClient();
  const { data: quotation, error: readError } = await supabase
    .from("quotations")
    .select("layout_settings")
    .eq("id", quotationId)
    .single<{ layout_settings: { columns?: Array<{ key?: string; visible?: boolean; width?: number }> } | null }>();

  if (readError || !quotation) {
    console.error("QUOTATION LAYOUT SETTINGS READ ERROR", readError?.message);
    return { ok: false, message: "Column settings could not be read." };
  }

  const currentColumns = Array.isArray(quotation.layout_settings?.columns)
    ? quotation.layout_settings.columns
    : [];
  let found = false;
  const columns = currentColumns
    .filter((column) => typeof column.key === "string")
    .map((column) => {
      if (column.key !== columnKey) return column;

      found = true;
      return { ...column, width };
    });

  if (!found) {
    columns.push({ key: columnKey, visible: true, width });
  }

  const { error } = await supabase
    .from("quotations")
    .update({ layout_settings: { ...(quotation.layout_settings ?? {}), columns } })
    .eq("id", quotationId);

  if (error) {
    console.error("QUOTATION COLUMN WIDTH UPDATE ERROR", error.message);
    return { ok: false, message: "Column width could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  return { ok: true };
}

export async function updateQuotationItemRowHeight(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const rowHeight = optionalIntegerInRange(formData, "row_height", 40, 600);

  if (!id || !quotationId || rowHeight === null) {
    return { ok: false, message: "Invalid row height." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_items")
    .update({ row_height: rowHeight })
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION ITEM ROW HEIGHT UPDATE ERROR", error.message);
    return { ok: false, message: "Row height could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  return { ok: true };
}

export async function updateQuotationSectionRowHeight(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const rowHeight = optionalIntegerInRange(formData, "row_height", 40, 600);

  if (!id || !quotationId || rowHeight === null) {
    return { ok: false, message: "Invalid section height." };
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_sections")
    .update({ row_height: rowHeight })
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION SECTION ROW HEIGHT UPDATE ERROR", error.message);
    return { ok: false, message: "Section height could not be saved." };
  }

  revalidatePath(`/quotations/${quotationId}`);
  return { ok: true };
}

export async function createQuotationSection(formData: FormData) {
  const { user } = await requireRecordsManager();
  const quotationId = textValue(formData, "quotation_id");
  const sectionTitle = textValue(formData, "section_title");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!quotationId || !sectionTitle) {
    redirectWithMessage("/quotations", "Quotation and section title are required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("quotation_sections").insert({
    quotation_id: quotationId,
    section_title: sectionTitle,
    section_notes: optionalTextValue(formData, "section_notes"),
    section_type: allowedText(formData, "section_type", sectionTypes, "section"),
    title_align: allowedText(formData, "title_align", titleAlignments, "center"),
    title_bold: boolValue(formData, "title_bold"),
    title_bg: allowedText(formData, "title_bg", titleBackgrounds, "light_grey"),
    title_size: allowedText(formData, "title_size", titleSizes, "normal"),
    row_height: optionalIntegerInRange(formData, "row_height", 40, 600),
    sort_order: integerValue(formData, "sort_order", 0),
    is_active: boolValue(formData, "is_active"),
    created_by: user.id,
  });

  if (error) {
    console.error("QUOTATION SECTION CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Section could not be created.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Section created.");
}

export async function updateQuotationSection(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const sectionTitle = textValue(formData, "section_title");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!id || !quotationId || !sectionTitle) {
    redirectWithMessage("/quotations", "Section id, quotation, and title are required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_sections")
    .update({
      section_title: sectionTitle,
      section_notes: optionalTextValue(formData, "section_notes"),
      section_type: allowedText(formData, "section_type", sectionTypes, "section"),
      title_align: allowedText(formData, "title_align", titleAlignments, "center"),
      title_bold: boolValue(formData, "title_bold"),
      title_bg: allowedText(formData, "title_bg", titleBackgrounds, "light_grey"),
      title_size: allowedText(formData, "title_size", titleSizes, "normal"),
      row_height: optionalIntegerInRange(formData, "row_height", 40, 600),
      sort_order: integerValue(formData, "sort_order", 0),
      is_active: boolValue(formData, "is_active"),
    })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION SECTION UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Section could not be updated.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Section updated.");
}

export async function deactivateQuotationSection(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Section id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_sections")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION SECTION DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Section could not be deactivated.");
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Section deactivated.");
}

export async function createQuotationItem(formData: FormData) {
  const { user } = await requireRecordsManager();
  const payload = itemPayload(formData, user.id);
  const redirectPath = returnPath(formData, `/quotations/${payload.quotation_id}`);

  if (!payload.quotation_id) {
    redirectWithMessage("/quotations", "Quotation is required.");
  }

  if (
    !itemTypes.has(payload.item_type) ||
    !discountTypes.has(payload.discount_type) ||
    !discountTypes.has(payload.margin_type) ||
    !lineStyles.has(payload.line_style)
  ) {
    redirectWithMessage(redirectPath, "Select valid item settings.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("quotation_items").insert(payload);

  if (error) {
    console.error("QUOTATION ITEM CREATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be created.");
  }

  await recalculateQuotationTotals(payload.quotation_id);
  revalidatePath(`/quotations/${payload.quotation_id}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Line item created.");
}

export async function updateQuotationItem(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const payload = itemPayload(formData);
  const redirectPath = returnPath(formData, `/quotations/${payload.quotation_id}`);

  if (!id || !payload.quotation_id) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  if (
    !itemTypes.has(payload.item_type) ||
    !discountTypes.has(payload.discount_type) ||
    !discountTypes.has(payload.margin_type) ||
    !lineStyles.has(payload.line_style)
  ) {
    redirectWithMessage(redirectPath, "Select valid item settings.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase.from("quotation_items").update(payload).eq("id", id);

  if (error) {
    console.error("QUOTATION ITEM UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be updated.");
  }

  await recalculateQuotationTotals(payload.quotation_id);
  revalidatePath(`/quotations/${payload.quotation_id}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Line item updated.");
}

export async function updateQuotationItemInline(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("qty,unit_price,discount_type,discount_value,cell_layout")
    .eq("id", id)
    .single<{
      qty: number;
      unit_price: number;
      discount_type: string;
      discount_value: number;
      cell_layout: CellLayoutPayload | null;
    }>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM INLINE READ ERROR", readError?.message);
    redirectWithMessage(redirectPath, "Line item could not be loaded.");
  }

  const payload: Record<string, string | number | CellLayoutPayload | null> = {};
  const textFields = [
    "manual_serial",
    "item_code_snapshot",
    "item_name_snapshot",
    "specified_image_url_snapshot",
    "proposed_image_url_snapshot",
    "specification_snapshot",
    "room_name_snapshot",
    "model_snapshot",
    "finish_snapshot",
    "size_snapshot",
    "origin_snapshot",
    "warranty_snapshot",
    "supplier_name_snapshot",
    "unit_label",
  ];

  for (const field of textFields) {
    if (formData.has(field)) {
      payload[field] = optionalTextValue(formData, field);
    }
  }

  const qty = formData.has("qty")
    ? numberValue(formData, "qty", currentItem.qty)
    : currentItem.qty;
  const unitPrice = formData.has("unit_price")
    ? numberValue(formData, "unit_price", currentItem.unit_price)
    : currentItem.unit_price;
  const discountValue = formData.has("discount_value")
    ? numberValue(formData, "discount_value", currentItem.discount_value)
    : currentItem.discount_value;
  const rawNetPrice =
    currentItem.discount_type === "percent"
      ? unitPrice - (unitPrice * discountValue) / 100
      : unitPrice - discountValue;
  const netPrice = money(Math.max(rawNetPrice, 0));

  if (formData.has("qty")) payload.qty = qty;
  if (formData.has("unit_price")) payload.unit_price = unitPrice;
  if (formData.has("discount_value")) payload.discount_value = discountValue;
  if (formData.has("row_height")) {
    payload.row_height = optionalIntegerInRange(formData, "row_height", 40, 600);
  }
  if (formData.has("merge_mode") || formData.has("cell_style_key")) {
    payload.cell_layout = cellLayoutValue(formData, currentItem.cell_layout);
  }
  payload.net_price = netPrice;
  payload.net_total = money(qty * netPrice);

  const { error } = await supabase.from("quotation_items").update(payload).eq("id", id);

  if (error) {
    console.error("QUOTATION ITEM INLINE UPDATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be updated.");
  }

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Row saved.");
}

export async function autosaveQuotationItemInline(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");

  if (!id || !quotationId) {
    return { ok: false, message: "Line item id and quotation are required." };
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("qty,unit_price,discount_type,discount_value,cell_layout")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .single<{
      qty: number;
      unit_price: number;
      discount_type: string;
      discount_value: number;
      cell_layout: CellLayoutPayload | null;
    }>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM AUTOSAVE READ ERROR", readError?.message);
    return { ok: false, message: "Line item could not be loaded." };
  }

  const payload: Record<string, string | number | CellLayoutPayload | null> = {};
  const textFields = [
    "manual_serial",
    "item_code_snapshot",
    "item_name_snapshot",
    "specified_image_url_snapshot",
    "proposed_image_url_snapshot",
    "specification_snapshot",
    "room_name_snapshot",
    "model_snapshot",
    "finish_snapshot",
    "size_snapshot",
    "origin_snapshot",
    "warranty_snapshot",
    "supplier_name_snapshot",
    "unit_label",
  ];

  for (const field of textFields) {
    if (formData.has(field)) {
      payload[field] = optionalTextValue(formData, field);
    }
  }

  const discountType = formData.has("discount_type")
    ? allowedText(formData, "discount_type", discountTypes, currentItem.discount_type)
    : currentItem.discount_type;
  const qty = formData.has("qty")
    ? numberValue(formData, "qty", currentItem.qty)
    : currentItem.qty;
  const unitPrice = formData.has("unit_price")
    ? numberValue(formData, "unit_price", currentItem.unit_price)
    : currentItem.unit_price;
  const discountValue = formData.has("discount_value")
    ? numberValue(formData, "discount_value", currentItem.discount_value)
    : currentItem.discount_value;
  const rawNetPrice =
    discountType === "percent"
      ? unitPrice - (unitPrice * discountValue) / 100
      : unitPrice - discountValue;
  const netPrice = money(Math.max(rawNetPrice, 0));

  if (formData.has("discount_type")) payload.discount_type = discountType;
  if (formData.has("line_style")) {
    payload.line_style = allowedText(formData, "line_style", lineStyles, "normal");
  }
  if (formData.has("qty")) payload.qty = qty;
  if (formData.has("unit_price")) payload.unit_price = unitPrice;
  if (formData.has("discount_value")) payload.discount_value = discountValue;
  if (formData.has("row_height")) {
    payload.row_height = optionalIntegerInRange(formData, "row_height", 40, 600);
  }
  if (formData.has("merge_mode") || formData.has("cell_style_key")) {
    payload.cell_layout = cellLayoutValue(formData, currentItem.cell_layout);
  }
  payload.net_price = netPrice;
  payload.net_total = money(qty * netPrice);

  const { error } = await supabase
    .from("quotation_items")
    .update(payload)
    .eq("id", id)
    .eq("quotation_id", quotationId);

  if (error) {
    console.error("QUOTATION ITEM AUTOSAVE ERROR", error.message);
    return { ok: false, message: "Save failed." };
  }

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}/builder`);
  return { ok: true };
}

async function moveQuotationItem(formData: FormData, direction: "up" | "down") {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { data: currentItem, error: readError } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,section_id")
    .eq("id", id)
    .eq("quotation_id", quotationId)
    .single<{ id: string; quotation_id: string; section_id: string | null }>();

  if (readError || !currentItem) {
    console.error("QUOTATION ITEM MOVE READ ERROR", readError?.message);
    redirectWithMessage(redirectPath, "Line item could not be moved.");
  }

  let query = supabase
    .from("quotation_items")
    .select("id,sort_order,created_at")
    .eq("quotation_id", quotationId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  query = currentItem.section_id
    ? query.eq("section_id", currentItem.section_id)
    : query.is("section_id", null);

  const { data: items, error: itemsError } = await query.returns<
    Array<{ id: string; sort_order: number; created_at: string }>
  >();

  if (itemsError) {
    console.error("QUOTATION ITEM MOVE LIST ERROR", itemsError.message);
    redirectWithMessage(redirectPath, "Line item could not be moved.");
  }

  const orderedItems = items ?? [];
  const index = orderedItems.findIndex((item) => item.id === id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (index < 0 || targetIndex < 0 || targetIndex >= orderedItems.length) {
    redirectWithMessage(redirectPath, "Row is already in that position.");
  }

  const reorderedItems = [...orderedItems];
  [reorderedItems[index], reorderedItems[targetIndex]] = [
    reorderedItems[targetIndex],
    reorderedItems[index],
  ];

  for (const [position, item] of reorderedItems.entries()) {
    const { error } = await supabase
      .from("quotation_items")
      .update({ sort_order: (position + 1) * 10 })
      .eq("id", item.id);

    if (error) {
      console.error("QUOTATION ITEM MOVE UPDATE ERROR", error.message);
      redirectWithMessage(redirectPath, "Line item could not be moved.");
    }
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Row moved.");
}

export async function moveQuotationItemUp(formData: FormData) {
  await moveQuotationItem(formData, "up");
}

export async function moveQuotationItemDown(formData: FormData) {
  await moveQuotationItem(formData, "down");
}

export async function deactivateQuotationItem(formData: FormData) {
  await requireRecordsManager();
  const id = textValue(formData, "id");
  const quotationId = textValue(formData, "quotation_id");
  const redirectPath = returnPath(formData, `/quotations/${quotationId}`);

  if (!id || !quotationId) {
    redirectWithMessage("/quotations", "Line item id and quotation are required.");
  }

  const supabase = await createSupabaseClient();
  const { error } = await supabase
    .from("quotation_items")
    .update({ is_active: false })
    .eq("id", id);

  if (error) {
    console.error("QUOTATION ITEM DEACTIVATE ERROR", error.message);
    redirectWithMessage(redirectPath, "Line item could not be deactivated.");
  }

  await recalculateQuotationTotals(quotationId);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath(redirectPath);
  redirectWithMessage(redirectPath, "Line item deactivated.");
}
