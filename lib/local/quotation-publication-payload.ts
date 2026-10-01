import { recalculateWorkspace, type LocalQuotationWorkspace, type LocalQuotationItem } from "./quotation-workspace";

const allowedSectionTypes = new Set(["option", "floor", "room", "category", "section"]);
const allowedSectionKinds = new Set(["main", "sub"]);
const allowedTitleAlignments = new Set(["left", "center", "right"]);
const allowedTitleBackgrounds = new Set(["light_grey", "white", "dark_grey"]);
const allowedTitleSizes = new Set(["normal", "large"]);

function sortByOrder<T extends { sort_order: number }>(rows: T[]) {
  return [...rows].sort((left, right) => left.sort_order - right.sort_order);
}

function sortItemsWithOptionalChildren(rows: LocalQuotationItem[]) {
  const ordered = sortByOrder(rows);
  const childrenByParent = new Map<string, LocalQuotationItem[]>();
  const topLevel: LocalQuotationItem[] = [];

  for (const row of ordered) {
    if (row.is_optional && row.parent_item_id) {
      childrenByParent.set(row.parent_item_id, [...(childrenByParent.get(row.parent_item_id) ?? []), row]);
    } else {
      topLevel.push(row);
    }
  }

  return topLevel.flatMap((row) => [row, ...(childrenByParent.get(row.id) ?? [])]);
}

function itemLineStyleForInsert(item: LocalQuotationItem) {
  if (item.line_style === "blank") {
    return "normal";
  }

  return item.line_style;
}

function sectionTypeForInsert(value: unknown) {
  return typeof value === "string" && allowedSectionTypes.has(value) ? value : "section";
}

function sectionKindForInsert(value: unknown) {
  return typeof value === "string" && allowedSectionKinds.has(value) ? value : "sub";
}

function titleAlignForInsert(value: unknown) {
  return typeof value === "string" && allowedTitleAlignments.has(value) ? value : "left";
}

function titleBackgroundForInsert(value: unknown, sectionKind: string) {
  if (value === "dark") return "dark_grey";
  if (value === "light") return "light_grey";
  if (typeof value === "string" && allowedTitleBackgrounds.has(value)) return value;
  return sectionKind === "main" ? "dark_grey" : "light_grey";
}

function titleSizeForInsert(value: unknown, sectionKind: string) {
  if (value === "lg") return "large";
  if (value === "sm") return "normal";
  if (typeof value === "string" && allowedTitleSizes.has(value)) return value;
  return sectionKind === "main" ? "large" : "normal";
}

function integerInRange(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return Math.min(Math.max(Math.round(parsed), minimum), maximum);
}

function numericValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function itemQtyValue(item: LocalQuotationItem) {
  const rounded = integerInRange(item.qty, 0, 100000) ?? 0;
  if (item.item_type === "blank" || item.item_type === "note") {
    return rounded;
  }

  return Math.max(rounded, 1);
}

function discountTypeValue(value: unknown) {
  return value === "percent" ? "percent" : value === "none" ? "none" : "amount";
}

function textOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function jsonValue(value: unknown) {
  return value ?? null;
}

function snapshotRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

export function preparePublication(workspaceInput: LocalQuotationWorkspace, userId: string) {
  const workspace = recalculateWorkspace(workspaceInput);
  const sectionsToInsert = sortByOrder(workspace.sections).filter((s) => s.is_active !== false);
  const itemsToInsert = sortItemsWithOptionalChildren(workspace.items.filter((i) => i.is_active !== false));
  const sectionPayloads = sectionsToInsert.map((section) => {
    const sectionKind = sectionKindForInsert(section.section_kind);

    return {
      id: section.id,
      quotation_id: section.quotation_id,
      section_title: textOrNull(section.section_title) ?? "Section",
      section_notes: textOrNull(section.section_notes),
      section_type: sectionTypeForInsert(section.section_type),
      parent_section_id: section.parent_section_id,
      section_kind: sectionKind,
      title_align: titleAlignForInsert(section.title_align),
      title_bold: section.title_bold,
      title_bg: titleBackgroundForInsert(section.title_bg, sectionKind),
      title_size: titleSizeForInsert(section.title_size, sectionKind),
      row_height: integerInRange(section.row_height, 40, 600),
      sort_order: numericValue(section.sort_order),
      is_active: true,
    };
  });
  const itemPayloads = itemsToInsert.map((item) => ({
    id: item.id,
    quotation_id: item.quotation_id,
    section_id: item.section_id,
    item_type: item.item_type,
    source_template_id: item.source_template_id,
    source_component_data: jsonValue(item.source_component_data),
    manual_serial: textOrNull(item.manual_serial),
    item_code_snapshot: textOrNull(item.item_code_snapshot),
    item_name_snapshot: textOrNull(item.item_name_snapshot),
    brand_name_snapshot: textOrNull(item.brand_name_snapshot),
    category_name_snapshot: textOrNull(item.category_name_snapshot),
    specified_image_url_snapshot: textOrNull(item.specified_image_url_snapshot),
    proposed_image_url_snapshot: textOrNull(item.proposed_image_url_snapshot),
    specification_snapshot: textOrNull(item.specification_snapshot),
    finish_selections_snapshot: jsonValue(item.finish_selections_snapshot),
    selected_options_snapshot: jsonValue(item.selected_options_snapshot),
    internal_components_snapshot: jsonValue(item.internal_components_snapshot),
    room_name_snapshot: textOrNull(item.room_name_snapshot),
    model_snapshot: textOrNull(item.model_snapshot),
    finish_snapshot: textOrNull(item.finish_snapshot),
    size_snapshot: textOrNull(item.size_snapshot),
    origin_snapshot: textOrNull(item.origin_snapshot),
    warranty_snapshot: textOrNull(item.warranty_snapshot),
    supplier_name_snapshot: textOrNull(item.supplier_name_snapshot),
    supplier_notes_snapshot: textOrNull(item.supplier_notes_snapshot),
    allow_material_continuation_page: Boolean(item.allow_material_continuation_page),
    qty: itemQtyValue(item),
    unit_label: textOrNull(item.unit_label) ?? "Pc",
    unit_price: numericValue(item.unit_price),
    discount_type: discountTypeValue(item.discount_type),
    discount_value: discountTypeValue(item.discount_type) === "none" ? 0 : numericValue(item.discount_value),
    net_price: numericValue(item.net_price),
    net_total: numericValue(item.net_total),
    currency: textOrNull(item.currency) ?? workspace.currency,
    sort_order: numericValue(item.sort_order),
    is_optional: Boolean(item.is_optional),
    parent_item_id: item.parent_item_id,
    include_in_total: item.is_optional ? item.include_in_total === true : true,
    internal_cost: numericValue(item.internal_cost),
    margin_type: item.margin_type === "percent" ? "percent" : "amount",
    margin_value: numericValue(item.margin_value),
    is_rate_only: Boolean(item.is_rate_only),
    line_style: itemLineStyleForInsert(item),
    row_height: integerInRange(item.row_height, 40, 600),
    cell_layout: jsonValue(item.cell_layout),
    is_active: true,
    notes: textOrNull(item.notes),
    created_by: userId,
  }));
  const projectSnapshot = snapshotRecord(workspace.project_snapshot);
  return {
    sections: sectionPayloads.map((row, i) => ({ ...row, source_id: sectionsToInsert[i].source_section_id ?? row.id })),
    items: itemPayloads.map((row, i) => ({ ...row, source_id: itemsToInsert[i].source_item_id ?? row.id, sort_order: (i + 1) * 10 })),
    quotation: {
      quotation_date: textOrNull(workspace.quotation_date), title: workspace.title, status: workspace.status,
      currency: workspace.currency, vat_percent: workspace.vat_percent, layout_mode: workspace.layout_mode,
      layout_settings: workspace.layout_settings, overall_discount_type: workspace.overall_discount_type,
      overall_discount_value: workspace.overall_discount_value, subtotal: workspace.totals.subtotal,
      discount_total: workspace.totals.discount_total + workspace.totals.overall_discount_amount,
      vat_amount: workspace.totals.vat_amount, grand_total: workspace.totals.grand_total,
    },
    project: {
      project_name: textOrNull(projectSnapshot.project_name) ?? "Project", location: textOrNull(projectSnapshot.location),
      attention_to: textOrNull(projectSnapshot.attention_to), attention_mobile: textOrNull(projectSnapshot.attention_mobile),
      attention_landline: textOrNull(projectSnapshot.attention_landline), attention_email: textOrNull(projectSnapshot.attention_email),
      po_box: textOrNull(projectSnapshot.po_box), project_address: textOrNull(projectSnapshot.project_address),
    },
  };
}
