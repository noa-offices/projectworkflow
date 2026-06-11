import { notFound } from "next/navigation";
import { DocumentSetupDialog } from "@/components/quotations/document-setup-dialog";
import { LocalQuotationBuilder } from "@/components/quotations/local-quotation-builder";
import { OpportunityQuotationLinkSync } from "@/components/quotations/opportunity-quotation-link-sync";
import {
  type ProductLibraryLinkedFamily,
  type ProductLibraryBrand,
  type ProductLibraryCategory,
  type ProductLibraryComponent,
  type ProductLibraryTemplate,
} from "@/components/quotations/product-library-selector";
import {
  type FinishMaterial,
  type FinishMaterialGroup,
  type ProductTemplateMaterialGroupItemLink,
  type ProductTemplateMaterialGroupLink,
} from "@/components/quotations/finish-selections-editor";
import { requireActiveUser } from "@/lib/auth";
import { formatProjectReferenceDisplay } from "@/lib/project-reference";
import { ensureDefaultProductCategoryTree } from "@/lib/product-default-category-tree";
import {
  brandPriceBaselineDate,
  latestBrandPriceListUpdate,
  productTemplatePriceCheckState,
} from "@/lib/product-price-check";
import { createWorkspaceFromServerSnapshot } from "@/lib/local/quotation-workspace";
import { resolveDocumentSetup } from "@/lib/quotations/document-setup";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

type Quotation = {
  id: string;
  client_id: string;
  legacy_reference: string | null;
  option_no: number | null;
  project_id: string | null;
  quotation_no: string | null;
  revision_no: number | null;
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

type Client = { id: string; client_number: string | null; company_name: string };
type Project = {
  id: string;
  project_name: string | null;
  project_number: string | null;
  project_code: string | null;
  project_year: string | null;
  location: string | null;
  attention_to: string | null;
  attention_mobile: string | null;
  attention_landline: string | null;
  attention_email: string | null;
  po_box: string | null;
  project_address: string | null;
};
type QuotationSection = Parameters<typeof createWorkspaceFromServerSnapshot>[0]["sections"][number];
type QuotationItem = Parameters<typeof createWorkspaceFromServerSnapshot>[0]["items"][number];

export default async function LocalQuotationBuilderPage({ params }: PageProps) {
  const { id } = await params;
  const { profile, user } = await requireActiveUser();
  const canManageProductLibrary =
    profile?.role === "system_owner" || profile?.role === "admin_manager";
  const supabase = await createSupabaseClient();

  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .select("id,client_id,project_id,quotation_no,legacy_reference,option_no,revision_no,title,status,quotation_date,currency,vat_percent,layout_mode,layout_settings,overall_discount_type,overall_discount_value")
    .eq("id", id)
    .single<Quotation>();

  if (quotationError || !quotation) notFound();

  const { data: client } = await supabase
    .from("clients")
    .select("id,client_number,company_name")
    .eq("id", quotation.client_id)
    .maybeSingle<Client>();

  const projectId = validUuidOrNull(quotation.project_id);
  const { data: project } = projectId
    ? await supabase
        .from("projects")
        .select("id,project_name,project_number,project_code,project_year,location,attention_to,attention_mobile,attention_landline,attention_email,po_box,project_address")
        .eq("id", projectId)
        .maybeSingle<Project>()
    : { data: null };

  const { data: sections } = await supabase
    .from("quotation_sections")
    .select("id,quotation_id,section_title,section_notes,section_type,parent_section_id,section_kind,title_align,title_bold,title_bg,title_size,row_height,sort_order,is_active")
    .eq("quotation_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationSection[]>();

  const { data: items } = await supabase
    .from("quotation_items")
    .select("id,quotation_id,section_id,item_type,source_template_id,source_component_data,manual_serial,item_code_snapshot,item_name_snapshot,brand_name_snapshot,category_name_snapshot,specified_image_url_snapshot,proposed_image_url_snapshot,specification_snapshot,finish_selections_snapshot,selected_options_snapshot,internal_components_snapshot,room_name_snapshot,model_snapshot,finish_snapshot,size_snapshot,origin_snapshot,warranty_snapshot,supplier_name_snapshot,supplier_notes_snapshot,allow_material_continuation_page,qty,unit_label,unit_price,discount_type,discount_value,net_price,net_total,currency,sort_order,is_optional,parent_item_id,include_in_total,internal_cost,margin_type,margin_value,is_rate_only,line_style,row_height,cell_layout,is_active,notes,created_at,updated_at")
    .eq("quotation_id", id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<QuotationItem[]>();

  const { data: productBrands } = await supabase
    .from("brands")
    .select("id,name,origin,last_price_list_checked_at,default_currency")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<ProductLibraryBrand[]>();

  if ((productBrands ?? []).length) {
    try {
      await ensureDefaultProductCategoryTree({
        supabase,
        brandIds: (productBrands ?? []).map((brand) => brand.id),
        userId: user.id,
      });
    } catch (seedError) {
      console.error("DEFAULT PRODUCT CATEGORY BACKFILL ERROR", seedError);
    }
  }

  const { data: productCategories } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<ProductLibraryCategory[]>();

  const { data: productTemplates } = await supabase
    .from("product_templates")
    .select("id,brand_id,main_category_id,sub_category_id,template_code,template_name,internal_selection_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,proposed_image_url_4,proposed_image_url_5,proposed_image_url_6,proposed_image_url_7,proposed_image_url_8,proposed_image_url_9,proposed_image_url_10,proposed_image_url_11,proposed_image_url_12,proposed_image_url_13,proposed_image_url_14,proposed_image_url_15,proposed_image_url_16,proposed_image_url_17,proposed_image_url_18,proposed_image_url_19,proposed_image_url_20,image_settings,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,unit_label,currency,default_unit_price,last_price_checked_at,price_check_interval_days,price_check_note,created_at,price_notes")
    .eq("is_active", true)
    .eq("lifecycle_status", "active")
    .order("template_name", { ascending: true })
    .returns<ProductLibraryTemplate[]>();

  const { data: brandPriceListUpdates } = await supabase
    .from("brand_price_list_updates")
    .select("id,brand_id,title,effective_from,received_at,status,created_at")
    .in("status", ["draft", "active"])
    .order("brand_id", { ascending: true })
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const updatesByBrand = new Map<string, NonNullable<typeof brandPriceListUpdates>>();
  for (const update of brandPriceListUpdates ?? []) {
    updatesByBrand.set(update.brand_id, [...(updatesByBrand.get(update.brand_id) ?? []), update]);
  }
  const brandById = new Map((productBrands ?? []).map((brand) => [brand.id, brand]));

  const productTemplatesWithPriceChecks = (productTemplates ?? []).map((template) => ({
    ...template,
    brand_latest_price_list_at: brandPriceBaselineDate({
      fallbackCheckedAt: brandById.get(template.brand_id)?.last_price_list_checked_at ?? null,
      latestBrandPriceListUpdate: latestBrandPriceListUpdate(updatesByBrand.get(template.brand_id) ?? []) ?? null,
    }),
    latest_brand_price_list_update: latestBrandPriceListUpdate(updatesByBrand.get(template.brand_id) ?? []) ?? null,
  }));

  for (const template of productTemplatesWithPriceChecks) {
    const brandName = brandById.get(template.brand_id)?.name ?? null;

    if (brandName !== "LAS MOBILI") {
      continue;
    }

    const status = productTemplatePriceCheckState({
      brandPriceBaselineAt: template.brand_latest_price_list_at,
      formatDate: (value) => value ?? "",
      latestBrandPriceListUpdate: template.latest_brand_price_list_update,
      template,
    });

    console.log("Product price status derived", {
      brandLatestPriceListAt: template.brand_latest_price_list_at,
      brandName,
      reason: status.reason,
      status: status.key,
      templateCreatedAt: template.created_at,
      templateId: template.id,
      templateName: template.internal_selection_name ?? template.template_name,
      templatePriceCheckedAt: template.last_price_checked_at,
    });
  }

  const { data: productComponents } = await supabase
    .from("product_components")
    .select("id,template_id,option_type,component_group,component_code,component_name,description,qty,unit_label,unit_price,currency,is_optional,is_default_selected,sort_order,calculation_data")
    .eq("is_active", true)
    .order("template_id", { ascending: true })
    .order("option_type", { ascending: true })
    .order("component_group", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductLibraryComponent[]>();

  const { data: linkedFamilies } = await supabase
    .from("product_template_linked_families")
    .select("id,parent_template_id,linked_template_id,label,is_required,allow_multiple,add_to_parent_price,append_to_specification,default_qty,sort_order,is_active")
    .eq("is_active", true)
    .order("parent_template_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductLibraryLinkedFamily[]>();

  const { data: materialGroups } = await supabase
    .from("brand_material_groups")
    .select("id,brand_id,group_name,sort_order")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<FinishMaterialGroup[]>();

  const { data: materials } = await supabase
    .from("brand_materials")
    .select("id,brand_id,material_group_id,material_category,material_collection,material_code,material_name,description,image_url,sort_order,is_active")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("material_group_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<FinishMaterial[]>();

  const { data: templateMaterialGroups } = await supabase
    .from("product_template_material_groups")
    .select("id,product_template_id,material_group_id,selection_mode,label_override,is_required,allow_multiple,show_in_specification,show_in_quotation,sort_order")
    .eq("is_active", true)
    .order("product_template_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductTemplateMaterialGroupLink[]>();

  const { data: templateMaterialGroupItems } = await supabase
    .from("product_template_material_group_items")
    .select("id,product_template_material_group_id,brand_material_id,sort_order,is_active")
    .eq("is_active", true)
    .order("product_template_material_group_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductTemplateMaterialGroupItemLink[]>();

  const resolvedDocumentSetup = resolveDocumentSetup({
    client,
    project,
    quotation,
  });
  const workspaceProject = project
    ? {
        ...project,
        attention_email: resolvedDocumentSetup.header.contactEmail || project.attention_email,
        attention_landline: resolvedDocumentSetup.header.telephone || project.attention_landline,
        attention_mobile: resolvedDocumentSetup.header.contactPhone || project.attention_mobile,
        attention_to: resolvedDocumentSetup.header.contactName || project.attention_to,
        location: resolvedDocumentSetup.header.location || project.location,
        po_box: resolvedDocumentSetup.header.poBox || project.po_box,
        project_address: resolvedDocumentSetup.header.projectAddress || project.project_address,
        project_name: resolvedDocumentSetup.header.reference || project.project_name,
      }
    : {
        attention_email: resolvedDocumentSetup.header.contactEmail,
        attention_landline: resolvedDocumentSetup.header.telephone,
        attention_mobile: resolvedDocumentSetup.header.contactPhone,
        attention_to: resolvedDocumentSetup.header.contactName,
        location: resolvedDocumentSetup.header.location,
        po_box: resolvedDocumentSetup.header.poBox,
        project_address: resolvedDocumentSetup.header.projectAddress,
        project_name: resolvedDocumentSetup.header.reference,
      };
  const initialWorkspace = createWorkspaceFromServerSnapshot({
    quotation,
    client: client ?? null,
    project: workspaceProject,
    sections: sections ?? [],
    items: items ?? [],
  });

  return (
    <>
      <OpportunityQuotationLinkSync />
      <LocalQuotationBuilder
        canManageProductLibrary={canManageProductLibrary}
        clientName={resolvedDocumentSetup.header.clientDisplayName}
        documentSetupAction={
          <DocumentSetupDialog
            clientId={quotation.client_id}
            hasProject={resolvedDocumentSetup.header.hasConfirmedProject}
            projectId={projectId}
            quotationId={quotation.id}
            returnTo={`/quotations/${quotation.id}/local-builder`}
            setup={resolvedDocumentSetup}
            triggerClassName="inline-flex h-9 items-center border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900"
          />
        }
        initialWorkspace={initialWorkspace}
        materialGroups={materialGroups ?? []}
        materials={materials ?? []}
        productBrands={productBrands ?? []}
        productCategories={productCategories ?? []}
        productComponents={productComponents ?? []}
        productLinkedFamilies={linkedFamilies ?? []}
        productTemplates={productTemplatesWithPriceChecks}
        projectName={
          resolvedDocumentSetup.header.reference ||
          formatProjectReferenceDisplay(project) ||
          "Quotation reference"
        }
        templateMaterialGroupItems={templateMaterialGroupItems ?? []}
        templateMaterialGroups={templateMaterialGroups ?? []}
      />
    </>
  );
}

function validUuidOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}
