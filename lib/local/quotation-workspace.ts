import { defaultCurrency, normalizeCurrency } from "@/lib/currencies";
export type LocalQuotationSection = {
  id: string;
  quotation_id: string;
  section_title: string;
  section_notes: string | null;
  section_type: string;
  parent_section_id: string | null;
  section_kind: "main" | "sub";
  title_align: string;
  title_bold: boolean;
  title_bg: string;
  title_size: string;
  row_height: number | null;
  sort_order: number;
  is_active: boolean;
  source_section_id?: string | null;
};

export type LocalQuotationItem = {
  id: string;
  quotation_id: string;
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
  finish_selections_snapshot: unknown;
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
  allow_material_continuation_page: boolean;
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
  is_active: boolean;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  source_item_id?: string | null;
};

export type LocalQuotationTotals = {
  subtotal: number;
  discount_total: number;
  overall_discount_amount: number;
  net_total: number;
  vat_amount: number;
  grand_total: number;
};

export type LocalQuotationWorkspaceIndex = {
  local_id: string;
  server_quotation_id: string;
  quotation_no: string | null;
  title: string;
  project_id: string;
  client_id: string;
  status: string;
  currency: string;
  updated_at: string;
  has_unsaved_changes: boolean;
  last_saved_to_software_at: string | null;
};

export type LocalQuotationWorkspace = LocalQuotationWorkspaceIndex & {
  created_at: string;
  quotation_date: string;
  layout_mode: string;
  vat_percent: number;
  overall_discount_type: string;
  overall_discount_value: number;
  layout_settings: unknown;
  header_snapshot: Record<string, unknown>;
  project_snapshot: Record<string, unknown>;
  client_snapshot: Record<string, unknown>;
  sections: LocalQuotationSection[];
  items: LocalQuotationItem[];
  totals: LocalQuotationTotals;
  terms: Record<string, unknown>;
  column_settings: unknown;
  metadata?: Record<string, unknown>;
};

export type ServerQuotationWorkspaceSource = {
  quotation: {
    id: string;
    client_id: string;
    project_id: string;
    quotation_no: string | null;
    title: string;
    status: string;
    quotation_date: string;
    currency: string;
    vat_percent: number;
    layout_mode: string;
    layout_settings: unknown;
    overall_discount_type: string;
    overall_discount_value: number;
  };
  client: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  sections: LocalQuotationSection[];
  items: LocalQuotationItem[];
};

export function localNow() {
  return new Date().toISOString();
}

export function createLocalId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function exactMoneyValue(value: unknown) {
  const number = Number(value);
  const safeValue = Number.isFinite(number) ? number : 0;

  return Math.round(safeValue * 100) / 100;
}

function normalizedLineQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : 0;
}

export function itemLinePricing(item: Pick<LocalQuotationItem, "qty" | "unit_price" | "discount_type" | "discount_value">) {
  const qty = normalizedLineQty(item.qty);
  const unitPrice = exactMoneyValue(Number.isFinite(item.unit_price) ? item.unit_price : 0);
  const rawDiscountValue = exactMoneyValue(Number.isFinite(item.discount_value) ? item.discount_value : 0);
  const discountType = item.discount_type === "percent"
    ? "percent"
    : item.discount_type === "none"
      ? "none"
      : "amount";
  const discountValue = discountType === "percent"
    ? Math.min(Math.max(rawDiscountValue, 0), 100)
    : discountType === "none"
      ? 0
    : Math.min(Math.max(rawDiscountValue, 0), unitPrice);
  const discountAmount = discountType === "percent"
    ? exactMoneyValue(unitPrice * discountValue / 100)
    : discountType === "none"
      ? 0
    : discountValue;
  const netPrice = exactMoneyValue(Math.max(unitPrice - discountAmount, 0));
  const netTotal = exactMoneyValue(netPrice * qty);

  return {
    unitPrice,
    discountValue,
    netPrice,
    netTotal,
  };
}

function overallDiscountAmount(
  subtotal: number,
  netTotal: number,
  discountType: string,
  discountValue: number,
) {
  const base = exactMoneyValue(
    discountType === "percent"
      ? netTotal * Math.min(Math.max(discountValue, 0), 100) / 100
      : Math.max(discountValue, 0),
  );

  return exactMoneyValue(Math.min(base, netTotal || subtotal));
}

export function workspaceTotals(workspace: Pick<LocalQuotationWorkspace, "items" | "overall_discount_type" | "overall_discount_value" | "vat_percent">): LocalQuotationTotals {
  const pricedItems = workspace.items.filter(
    (item) =>
      item.is_active !== false &&
      !item.is_rate_only &&
      !["note", "blank", "subtotal"].includes(item.item_type) &&
      !["heading", "note", "no_quote"].includes(item.line_style),
  );
  const subtotal = exactMoneyValue(
    pricedItems.reduce((total, item) => total + exactMoneyValue(normalizedLineQty(item.qty) * exactMoneyValue(item.unit_price)), 0),
  );
  const netTotal = exactMoneyValue(
    pricedItems.reduce((total, item) => total + exactMoneyValue(item.net_total), 0),
  );
  const discountTotal = exactMoneyValue(Math.max(subtotal - netTotal, 0));
  const extraDiscount = overallDiscountAmount(
    subtotal,
    netTotal,
    workspace.overall_discount_type,
    workspace.overall_discount_value,
  );
  const totalAfterExtraDiscount = exactMoneyValue(Math.max(netTotal - extraDiscount, 0));
  const vatAmount = exactMoneyValue(totalAfterExtraDiscount * Math.max(workspace.vat_percent, 0) / 100);
  const grandTotal = exactMoneyValue(totalAfterExtraDiscount + vatAmount);

  return {
    subtotal,
    discount_total: discountTotal,
    overall_discount_amount: extraDiscount,
    net_total: totalAfterExtraDiscount,
    vat_amount: vatAmount,
    grand_total: grandTotal,
  };
}

export function recalculateWorkspace(workspace: LocalQuotationWorkspace): LocalQuotationWorkspace {
  const items = workspace.items.map((item) => {
    const nextLinePricing = itemLinePricing(item);
    const normalizedQty = item.item_type === "blank" || item.item_type === "note"
      ? normalizedLineQty(item.qty)
      : Math.max(normalizedLineQty(item.qty), 1);

    return {
      ...item,
      currency: normalizeCurrency(item.currency || workspace.currency || defaultCurrency),
      qty: normalizedQty,
      unit_price: nextLinePricing.unitPrice,
      discount_type: item.discount_type === "percent" ? "percent" : item.discount_type === "none" ? "none" : "amount",
      discount_value: nextLinePricing.discountValue,
      net_price: nextLinePricing.netPrice,
      net_total: nextLinePricing.netTotal,
    };
  });
  const updated = {
    ...workspace,
    currency: normalizeCurrency(workspace.currency || defaultCurrency),
    items,
    updated_at: localNow(),
  };

  return {
    ...updated,
    totals: workspaceTotals(updated),
  };
}

export function createWorkspaceFromServerSnapshot(source: ServerQuotationWorkspaceSource): LocalQuotationWorkspace {
  const local_id = `quotation-${source.quotation.id}`;
  const workspace: LocalQuotationWorkspace = {
    local_id,
    server_quotation_id: source.quotation.id,
    project_id: source.quotation.project_id,
    client_id: source.quotation.client_id,
    quotation_no: source.quotation.quotation_no,
    title: source.quotation.title,
    status: source.quotation.status,
    currency: normalizeCurrency(source.quotation.currency || defaultCurrency),
    quotation_date: source.quotation.quotation_date,
    layout_mode: source.quotation.layout_mode,
    vat_percent: source.quotation.vat_percent,
    overall_discount_type: source.quotation.overall_discount_type || "amount",
    overall_discount_value: source.quotation.overall_discount_value ?? 0,
    layout_settings: source.quotation.layout_settings,
    header_snapshot: { quotation: source.quotation },
    project_snapshot: source.project ?? {},
    client_snapshot: source.client ?? {},
    sections: source.sections.map((section) => ({
      ...section,
      source_section_id: section.id,
    })),
    items: source.items.map((item) => ({
      ...item,
      source_item_id: item.id,
      currency: normalizeCurrency(item.currency || source.quotation.currency || defaultCurrency),
    })),
    totals: {
      subtotal: 0,
      discount_total: 0,
      overall_discount_amount: 0,
      net_total: 0,
      vat_amount: 0,
      grand_total: 0,
    },
    terms: {},
    column_settings: source.quotation.layout_settings,
    created_at: localNow(),
    updated_at: localNow(),
    has_unsaved_changes: false,
    last_saved_to_software_at: null,
    metadata: {},
  };

  return recalculateWorkspace(workspace);
}

export function createEmptySection(workspace: LocalQuotationWorkspace, sectionKind: "main" | "sub", parentSectionId?: string | null): LocalQuotationSection {
  const nextSortOrder = (workspace.sections.reduce((max, section) => Math.max(max, section.sort_order), 0) || 0) + 10;

  return {
    id: createLocalId("section"),
    quotation_id: workspace.server_quotation_id,
    section_title: sectionKind === "main" ? "NEW SECTION" : "Sub Section",
    section_notes: null,
    section_type: "section",
    parent_section_id: parentSectionId ?? null,
    section_kind: sectionKind,
    title_align: "left",
    title_bold: true,
    title_bg: sectionKind === "main" ? "dark_grey" : "light_grey",
    title_size: sectionKind === "main" ? "large" : "normal",
    row_height: null,
    sort_order: nextSortOrder,
    is_active: true,
    source_section_id: null,
  };
}

export function createEmptyItem(workspace: LocalQuotationWorkspace, itemType: "product" | "custom" | "note" | "blank", sectionId: string | null): LocalQuotationItem {
  const nextSortOrder = (workspace.items.reduce((max, item) => Math.max(max, item.sort_order), 0) || 0) + 10;
  const lineStyle = itemType === "blank" ? "blank" : itemType === "note" ? "note" : "normal";

  return {
    id: createLocalId("item"),
    quotation_id: workspace.server_quotation_id,
    section_id: sectionId,
    item_type: itemType,
    source_template_id: null,
    source_component_data: null,
    manual_serial: null,
    item_code_snapshot: null,
    item_name_snapshot: itemType === "note" ? "Note" : itemType === "blank" ? "" : "New Item",
    brand_name_snapshot: null,
    category_name_snapshot: null,
    specified_image_url_snapshot: null,
    proposed_image_url_snapshot: null,
    specification_snapshot: null,
    finish_selections_snapshot: [],
    selected_options_snapshot: [],
    internal_components_snapshot: null,
    room_name_snapshot: null,
    model_snapshot: null,
    finish_snapshot: null,
    size_snapshot: null,
    origin_snapshot: null,
    warranty_snapshot: null,
    supplier_name_snapshot: null,
    supplier_notes_snapshot: null,
    allow_material_continuation_page: false,
    qty: itemType === "blank" || itemType === "note" ? 0 : 1,
    unit_label: "Pc",
    unit_price: 0,
    discount_type: "none",
    discount_value: 0,
    net_price: 0,
    net_total: 0,
    currency: normalizeCurrency(workspace.currency || defaultCurrency),
    sort_order: nextSortOrder,
    is_optional: false,
    internal_cost: 0,
    margin_type: "amount",
    margin_value: 0,
    is_rate_only: false,
    line_style: lineStyle,
    row_height: null,
    cell_layout: {},
    is_active: true,
    notes: null,
    created_at: localNow(),
    updated_at: localNow(),
    source_item_id: null,
  };
}

export function orderedSections(sections: LocalQuotationSection[]) {
  return [...sections].sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

export function orderedItems(items: LocalQuotationItem[], sectionId: string | null) {
  return items
    .filter((item) => item.section_id === sectionId && item.is_active !== false)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}
