import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  recalculateWorkspace,
  type LocalQuotationItem,
  type LocalQuotationSection,
  type LocalQuotationWorkspace,
} from "@/lib/local/quotation-workspace";

type SavePayload = {
  workspace: LocalQuotationWorkspace;
};

type QuotationRecord = {
  id: string;
  client_id: string;
  project_id: string;
};

function sortByOrder<T extends { sort_order: number }>(rows: T[]) {
  return [...rows].sort((left, right) => left.sort_order - right.sort_order);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await request.json() as SavePayload;
  const workspace = recalculateWorkspace(payload.workspace);

  if (!workspace || workspace.server_quotation_id !== id) {
    return NextResponse.json({ error: "Workspace quotation mismatch." }, { status: 400 });
  }

  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,account_status")
    .eq("id", user.id)
    .maybeSingle<{ role: string | null; account_status: string | null }>();

  if (profile?.account_status !== "active" || !["system_owner", "admin_manager", "sales_designer"].includes(profile?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id")
    .eq("id", id)
    .single<QuotationRecord>();

  if (quotationError || !quotation) {
    return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
  }

  const { data: existingSections } = await supabase
    .from("quotation_sections")
    .select("id")
    .eq("quotation_id", quotation.id)
    .eq("is_active", true)
    .returns<Array<{ id: string }>>();
  const { data: existingItems } = await supabase
    .from("quotation_items")
    .select("id")
    .eq("quotation_id", quotation.id)
    .eq("is_active", true)
    .returns<Array<{ id: string }>>();

  const orderedSections = sortByOrder(workspace.sections).filter((section) => section.is_active !== false);
  const orderedItems = sortByOrder(workspace.items).filter((item) => item.is_active !== false);
  const nextSectionIdByLocalId = new Map<string, string>();

  for (const section of orderedSections) {
    nextSectionIdByLocalId.set(section.id, crypto.randomUUID());
  }

  const sectionsToInsert: LocalQuotationSection[] = orderedSections.map((section) => ({
    ...section,
    id: nextSectionIdByLocalId.get(section.id) ?? crypto.randomUUID(),
    quotation_id: quotation.id,
    parent_section_id: section.parent_section_id ? nextSectionIdByLocalId.get(section.parent_section_id) ?? null : null,
    source_section_id: section.source_section_id ?? section.id,
  }));
  const itemsToInsert: LocalQuotationItem[] = orderedItems.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    quotation_id: quotation.id,
    section_id: item.section_id ? nextSectionIdByLocalId.get(item.section_id) ?? null : null,
    source_item_id: item.source_item_id ?? item.id,
  }));

  if (sectionsToInsert.length) {
    const { error: insertSectionsError } = await supabase
      .from("quotation_sections")
      .insert(sectionsToInsert.map((section) => ({
        id: section.id,
        quotation_id: section.quotation_id,
        section_title: section.section_title,
        section_notes: section.section_notes,
        section_type: section.section_type,
        parent_section_id: section.parent_section_id,
        section_kind: section.section_kind,
        title_align: section.title_align,
        title_bold: section.title_bold,
        title_bg: section.title_bg,
        title_size: section.title_size,
        row_height: section.row_height,
        sort_order: section.sort_order,
        is_active: true,
      })));

    if (insertSectionsError) {
      return NextResponse.json({ error: insertSectionsError.message }, { status: 500 });
    }
  }

  if (itemsToInsert.length) {
    const { error: insertItemsError } = await supabase
      .from("quotation_items")
      .insert(itemsToInsert.map((item) => ({
        id: item.id,
        quotation_id: item.quotation_id,
        section_id: item.section_id,
        item_type: item.item_type,
        source_template_id: item.source_template_id,
        source_component_data: item.source_component_data,
        manual_serial: item.manual_serial,
        item_code_snapshot: item.item_code_snapshot,
        item_name_snapshot: item.item_name_snapshot,
        brand_name_snapshot: item.brand_name_snapshot,
        category_name_snapshot: item.category_name_snapshot,
        specified_image_url_snapshot: item.specified_image_url_snapshot,
        proposed_image_url_snapshot: item.proposed_image_url_snapshot,
        specification_snapshot: item.specification_snapshot,
        finish_selections_snapshot: item.finish_selections_snapshot,
        selected_options_snapshot: item.selected_options_snapshot,
        internal_components_snapshot: item.internal_components_snapshot,
        room_name_snapshot: item.room_name_snapshot,
        model_snapshot: item.model_snapshot,
        finish_snapshot: item.finish_snapshot,
        size_snapshot: item.size_snapshot,
        origin_snapshot: item.origin_snapshot,
        warranty_snapshot: item.warranty_snapshot,
        supplier_name_snapshot: item.supplier_name_snapshot,
        supplier_notes_snapshot: item.supplier_notes_snapshot,
        allow_material_continuation_page: item.allow_material_continuation_page,
        qty: item.qty,
        unit_label: item.unit_label,
        unit_price: item.unit_price,
        discount_type: item.discount_type,
        discount_value: item.discount_value,
        net_price: item.net_price,
        net_total: item.net_total,
        currency: item.currency,
        sort_order: item.sort_order,
        is_optional: item.is_optional,
        internal_cost: item.internal_cost,
        margin_type: item.margin_type,
        margin_value: item.margin_value,
        is_rate_only: item.is_rate_only,
        line_style: item.line_style,
        row_height: item.row_height,
        cell_layout: item.cell_layout,
        is_active: true,
        notes: item.notes,
        created_by: user.id,
      })));

    if (insertItemsError) {
      return NextResponse.json({ error: insertItemsError.message }, { status: 500 });
    }
  }

  const existingSectionIds = (existingSections ?? []).map((section) => section.id);
  if (existingSectionIds.length) {
    const { error: deactivateSectionsError } = await supabase
      .from("quotation_sections")
      .update({ is_active: false })
      .in("id", existingSectionIds);

    if (deactivateSectionsError) {
      return NextResponse.json({ error: deactivateSectionsError.message }, { status: 500 });
    }
  }

  const existingItemIds = (existingItems ?? []).map((item) => item.id);
  if (existingItemIds.length) {
    const { error: deactivateItemsError } = await supabase
      .from("quotation_items")
      .update({ is_active: false })
      .in("id", existingItemIds);

    if (deactivateItemsError) {
      return NextResponse.json({ error: deactivateItemsError.message }, { status: 500 });
    }
  }

  const { error: updateQuotationError } = await supabase
    .from("quotations")
    .update({
      title: workspace.title,
      status: workspace.status,
      currency: workspace.currency,
      vat_percent: workspace.vat_percent,
      layout_mode: workspace.layout_mode,
      layout_settings: workspace.layout_settings,
      overall_discount_type: workspace.overall_discount_type,
      overall_discount_value: workspace.overall_discount_value,
      subtotal: workspace.totals.subtotal,
      discount_total: workspace.totals.discount_total + workspace.totals.overall_discount_amount,
      vat_amount: workspace.totals.vat_amount,
      grand_total: workspace.totals.grand_total,
    })
    .eq("id", quotation.id);

  if (updateQuotationError) {
    return NextResponse.json({ error: updateQuotationError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    savedAt: new Date().toISOString(),
  });
}
