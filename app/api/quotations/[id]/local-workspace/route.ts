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

type ProjectSnapshotRecord = {
  project_name: string | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};

type SupabaseLikeError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
};

const allowedSectionTypes = new Set(["option", "floor", "room", "category", "section"]);
const allowedSectionKinds = new Set(["main", "sub"]);
const allowedTitleAlignments = new Set(["left", "center", "right"]);
const allowedTitleBackgrounds = new Set(["light_grey", "white", "dark_grey"]);
const allowedTitleSizes = new Set(["normal", "large"]);

function sortByOrder<T extends { sort_order: number }>(rows: T[]) {
  return [...rows].sort((left, right) => left.sort_order - right.sort_order);
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

function errorResponse(error: string, details?: string, status = 500, hint?: string | null, code?: string) {
  return NextResponse.json(
    {
      error,
      ...(details ? { details } : {}),
      ...(hint ? { hint } : {}),
      ...(code ? { code } : {}),
    },
    { status },
  );
}

function supabaseErrorDetails(error: SupabaseLikeError | null | undefined) {
  if (!error) return "";

  return [
    error.message,
    error.details,
    error.hint,
    error.code ? `code=${error.code}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function logSupabaseSaveError(label: string, error: SupabaseLikeError | null | undefined, context: Record<string, unknown>) {
  console.error(label, {
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    code: error?.code ?? null,
    ...context,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = await request.json() as SavePayload;
    const workspace = recalculateWorkspace(payload.workspace);
    const projectSnapshot = snapshotRecord(workspace.project_snapshot);

    if (!workspace || workspace.server_quotation_id !== id) {
      return errorResponse("Workspace quotation mismatch.", undefined, 400);
    }

    const supabase = await createSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return errorResponse("Unauthorized", undefined, 401);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role,account_status")
      .eq("id", user.id)
      .maybeSingle<{ role: string | null; account_status: string | null }>();

    if (profile?.account_status !== "active" || !["system_owner", "admin_manager", "sales_designer"].includes(profile?.role ?? "")) {
      return errorResponse("Forbidden", undefined, 403);
    }

    const { data: quotation, error: quotationError } = await supabase
      .from("quotations")
      .select("id,client_id,project_id")
      .eq("id", id)
      .single<QuotationRecord>();

    if (quotationError || !quotation) {
      return errorResponse("Quotation not found.", supabaseErrorDetails(quotationError), 404);
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

    const existingItemIds = (existingItems ?? []).map((item) => item.id);
    if (existingItemIds.length) {
      const { error: deactivateItemsError } = await supabase
        .from("quotation_items")
        .update({ is_active: false })
        .in("id", existingItemIds);

      if (deactivateItemsError) {
        return errorResponse("Failed to deactivate previous quotation items.", supabaseErrorDetails(deactivateItemsError));
      }
    }

    const existingSectionIds = (existingSections ?? []).map((section) => section.id);
    if (existingSectionIds.length) {
      const { error: deactivateSectionsError } = await supabase
        .from("quotation_sections")
        .update({ is_active: false })
        .in("id", existingSectionIds);

      if (deactivateSectionsError) {
        return errorResponse("Failed to deactivate previous quotation sections.", supabaseErrorDetails(deactivateSectionsError));
      }
    }

    if (sectionsToInsert.length) {
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
      const { error: insertSectionsError } = await supabase
        .from("quotation_sections")
        .insert(sectionPayloads);

      if (insertSectionsError) {
        logSupabaseSaveError("LOCAL WORKSPACE SAVE SECTION ERROR", insertSectionsError, {
          quotationId: quotation.id,
          sectionCount: sectionPayloads.length,
          sectionKeys: Object.keys(sectionPayloads[0] ?? {}),
        });
        return errorResponse(
          "Failed to save quotation sections.",
          insertSectionsError.details ?? insertSectionsError.message,
          500,
          insertSectionsError.hint,
          insertSectionsError.code,
        );
      }
    }

    if (itemsToInsert.length) {
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
        internal_cost: numericValue(item.internal_cost),
        margin_type: item.margin_type === "percent" ? "percent" : "amount",
        margin_value: numericValue(item.margin_value),
        is_rate_only: Boolean(item.is_rate_only),
        line_style: itemLineStyleForInsert(item),
        row_height: integerInRange(item.row_height, 40, 600),
        cell_layout: jsonValue(item.cell_layout),
        is_active: true,
        notes: textOrNull(item.notes),
        created_by: user.id,
      }));
      const { error: insertItemsError } = await supabase
        .from("quotation_items")
        .insert(itemPayloads);

      if (insertItemsError) {
        logSupabaseSaveError("LOCAL WORKSPACE SAVE ITEM ERROR", insertItemsError, {
          itemCount: itemPayloads.length,
          lineStyles: Array.from(new Set(itemPayloads.map((item) => item.line_style))),
          itemTypes: Array.from(new Set(itemPayloads.map((item) => item.item_type))),
        });
        return errorResponse(
          "Failed to save quotation items.",
          insertItemsError.details ?? insertItemsError.message,
          500,
          insertItemsError.hint,
          insertItemsError.code,
        );
      }
    }

    const { error: updateQuotationError } = await supabase
      .from("quotations")
      .update({
        quotation_no: textOrNull(workspace.quotation_no),
        quotation_date: textOrNull(workspace.quotation_date),
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
      return errorResponse("Failed to update quotation totals.", supabaseErrorDetails(updateQuotationError));
    }

    const { error: updateProjectError } = await supabase
      .from("projects")
      .update({
        project_name: textOrNull(projectSnapshot.project_name) ?? "Project",
        location: textOrNull(projectSnapshot.location),
        attention_to: textOrNull(projectSnapshot.attention_to),
        attention_mobile: textOrNull(projectSnapshot.attention_mobile),
        attention_landline: textOrNull(projectSnapshot.attention_landline),
        attention_email: textOrNull(projectSnapshot.attention_email),
        po_box: textOrNull(projectSnapshot.po_box),
        project_address: textOrNull(projectSnapshot.project_address),
      } satisfies ProjectSnapshotRecord)
      .eq("id", quotation.project_id);

    if (updateProjectError) {
      return errorResponse("Failed to update project details.", supabaseErrorDetails(updateProjectError));
    }

    return NextResponse.json({
      ok: true,
      savedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("LOCAL WORKSPACE SAVE UNEXPECTED ERROR", error);
    return errorResponse(
      "Failed to save local workspace.",
      error instanceof Error ? error.message : "Unexpected server error.",
    );
  }
}
