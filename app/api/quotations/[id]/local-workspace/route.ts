import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  recalculateWorkspace,
  normalizeNullableUuid,
  type LocalQuotationItem,
  type LocalQuotationSection,
  type LocalQuotationWorkspace,
} from "@/lib/local/quotation-workspace";
import {
  normalizePresentationSettings,
  type QuotationPresentationSettings,
} from "@/lib/quotations/presentation-settings";
import {
  documentSetupRecord,
  mergeDocumentSetupIntoLayoutSettings,
} from "@/lib/quotations/document-setup";

type SavePayload = {
  workspace: LocalQuotationWorkspace;
};

type QuotationRecord = {
  id: string;
  client_id: string;
  layout_settings: unknown;
  project_id: string | null;
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

type PresentationSettingsRecord = {
  settings_json: unknown;
  updated_at: string;
};

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

function recordValue(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
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

function remapIdList(ids: string[], idByPreviousId: Map<string, string>) {
  return Array.from(new Set(ids.map((id) => idByPreviousId.get(id) ?? id)));
}

function remapKeyedRecord<T>(record: Record<string, T>, idByPreviousId: Map<string, string>) {
  return Object.fromEntries(
    Object.entries(record).map(([id, value]) => [idByPreviousId.get(id) ?? id, value]),
  );
}

function remapPresentationSettingsForInsertedRows(
  settings: QuotationPresentationSettings,
  sectionIdByPreviousId: Map<string, string>,
  itemIdByPreviousId: Map<string, string>,
): QuotationPresentationSettings {
  return {
    ...settings,
    hiddenItemIds: remapIdList(settings.hiddenItemIds, itemIdByPreviousId),
    flowOrder: {
      mainSectionKeys: remapIdList(settings.flowOrder.mainSectionKeys, sectionIdByPreviousId),
      sectionKeysByMain: Object.fromEntries(
        Object.entries(settings.flowOrder.sectionKeysByMain).map(([mainSectionId, sectionIds]) => [
          sectionIdByPreviousId.get(mainSectionId) ?? mainSectionId,
          remapIdList(sectionIds, sectionIdByPreviousId),
        ]),
      ),
      itemIdsBySection: Object.fromEntries(
        Object.entries(settings.flowOrder.itemIdsBySection).map(([sectionId, itemIds]) => [
          sectionIdByPreviousId.get(sectionId) ?? sectionId,
          remapIdList(itemIds, itemIdByPreviousId),
        ]),
      ),
    },
    mainSectionOverrides: remapKeyedRecord(settings.mainSectionOverrides, sectionIdByPreviousId),
    sectionOverrides: remapKeyedRecord(settings.sectionOverrides, sectionIdByPreviousId),
    itemOverrides: remapKeyedRecord(settings.itemOverrides, itemIdByPreviousId),
  };
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
      .select("id,client_id,project_id,layout_settings")
      .eq("id", id)
      .single<QuotationRecord>();

    if (quotationError || !quotation) {
      return errorResponse("Quotation not found.", supabaseErrorDetails(quotationError), 404);
    }

    const { data: presentationSettings, error: presentationSettingsReadError } = await supabase
      .from("quotation_presentations")
      .select("settings_json,updated_at")
      .eq("quotation_id", quotation.id)
      .maybeSingle<PresentationSettingsRecord>();

    if (presentationSettingsReadError) {
      return errorResponse("Failed to read presentation settings.", supabaseErrorDetails(presentationSettingsReadError));
    }

    const { data: existingSections } = await supabase
      .from("quotation_sections")
      .select("id")
      .eq("quotation_id", quotation.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .returns<Array<{ id: string }>>();
    const { data: existingItems } = await supabase
      .from("quotation_items")
      .select("id")
      .eq("quotation_id", quotation.id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .returns<Array<{ id: string }>>();

    const orderedSections = sortByOrder(workspace.sections).filter((section) => section.is_active !== false);
    const orderedItems = sortItemsWithOptionalChildren(workspace.items.filter((item) => item.is_active !== false));
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
    const itemsToInsert: LocalQuotationItem[] = orderedItems.map((item, index) => ({
      ...item,
      id: crypto.randomUUID(),
      quotation_id: quotation.id,
      section_id: item.section_id ? nextSectionIdByLocalId.get(item.section_id) ?? null : null,
      sort_order: (index + 1) * 10,
      source_item_id: item.source_item_id ?? item.id,
      parent_item_id: item.parent_item_id ?? null,
    }));
    const sectionIdByPreviousId = new Map<string, string>();
    sectionsToInsert.forEach((section, index) => {
      [section.source_section_id, orderedSections[index]?.id, existingSections?.[index]?.id].forEach((previousId) => {
        if (previousId) sectionIdByPreviousId.set(previousId, section.id);
      });
    });
    const itemIdByPreviousId = new Map<string, string>();
    itemsToInsert.forEach((item, index) => {
      [item.source_item_id, orderedItems[index]?.id, existingItems?.[index]?.id].forEach((previousId) => {
        if (previousId) itemIdByPreviousId.set(previousId, item.id);
      });
    });
    itemsToInsert.forEach((item) => {
      item.parent_item_id = item.parent_item_id ? itemIdByPreviousId.get(item.parent_item_id) ?? null : null;
    });

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

    if (presentationSettings) {
      const normalizedPresentationSettings = normalizePresentationSettings(presentationSettings.settings_json, {
        updatedAt: presentationSettings.updated_at,
      });
      const remappedPresentationSettings = remapPresentationSettingsForInsertedRows(
        normalizedPresentationSettings,
        sectionIdByPreviousId,
        itemIdByPreviousId,
      );
      const { error: updatePresentationSettingsError } = await supabase
        .from("quotation_presentations")
        .update({
          settings_json: {
            ...remappedPresentationSettings,
            updatedAt: new Date().toISOString(),
          },
        })
        .eq("quotation_id", quotation.id);

      if (updatePresentationSettingsError) {
        return errorResponse("Failed to preserve presentation settings.", supabaseErrorDetails(updatePresentationSettingsError));
      }
    }

    const currentDocumentSetup = documentSetupRecord(quotation.layout_settings);
    const currentDocumentSetupHeader = recordValue(currentDocumentSetup.header);
    const nextLayoutSettings = Object.keys(currentDocumentSetup).length
      ? mergeDocumentSetupIntoLayoutSettings(workspace.layout_settings, currentDocumentSetup)
      : workspace.layout_settings;

    const { error: updateQuotationError } = await supabase
      .from("quotations")
      .update({
        quotation_date: textOrNull(workspace.quotation_date),
        title: workspace.title,
        status: workspace.status,
        currency: workspace.currency,
        vat_percent: workspace.vat_percent,
        layout_mode: workspace.layout_mode,
        layout_settings: nextLayoutSettings,
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

    const projectId = normalizeNullableUuid(quotation.project_id);
    let responseMessage = "Saved to software";

    if (projectId) {
      const { error: updateProjectError } = await supabase
        .from("projects")
        .update({
          project_name: textOrNull(stringFromRecord(currentDocumentSetupHeader, "reference")) ?? textOrNull(projectSnapshot.project_name) ?? "Project",
          location: textOrNull(stringFromRecord(currentDocumentSetupHeader, "location")) ?? textOrNull(projectSnapshot.location),
          attention_to: textOrNull(stringFromRecord(currentDocumentSetupHeader, "contactName")) ?? textOrNull(projectSnapshot.attention_to),
          attention_mobile: textOrNull(stringFromRecord(currentDocumentSetupHeader, "contactPhone")) ?? textOrNull(projectSnapshot.attention_mobile),
          attention_landline: textOrNull(stringFromRecord(currentDocumentSetupHeader, "telephone")) ?? textOrNull(projectSnapshot.attention_landline),
          attention_email: textOrNull(stringFromRecord(currentDocumentSetupHeader, "contactEmail")) ?? textOrNull(projectSnapshot.attention_email),
          po_box: textOrNull(stringFromRecord(currentDocumentSetupHeader, "poBox")) ?? textOrNull(projectSnapshot.po_box),
          project_address: textOrNull(stringFromRecord(currentDocumentSetupHeader, "projectAddress")) ?? textOrNull(projectSnapshot.project_address),
        } satisfies ProjectSnapshotRecord)
        .eq("id", projectId);

      if (updateProjectError) {
        return errorResponse("Failed to update project details.", supabaseErrorDetails(updateProjectError));
      }
    } else {
      responseMessage = "Quotation saved. Project/order details will be created after client approval.";
    }

    return NextResponse.json({
      ok: true,
      savedAt: new Date().toISOString(),
      message: responseMessage,
    });
  } catch (error) {
    console.error("LOCAL WORKSPACE SAVE UNEXPECTED ERROR", error);
    return errorResponse(
      "Failed to save local workspace.",
      error instanceof Error ? error.message : "Unexpected server error.",
    );
  }
}
