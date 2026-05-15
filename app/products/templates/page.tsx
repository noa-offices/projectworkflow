import Link from "next/link";
import { randomUUID } from "crypto";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { type DeskingSizePricingRow } from "@/components/products/desking-size-pricing-table";
import {
  DeactivateGroupForm,
  DeactivateOptionForm,
} from "@/components/products/option-deactivate-controls";
import {
  type AccessoryPricingRow,
  type CategoryPricingRow,
  type VariantPricingRow,
} from "@/components/products/variant-pricing-tables";
import { ProductTemplateImageUploader } from "@/components/products/product-template-image-uploader";
import { TemplatePricingSections } from "@/components/products/template-pricing-sections";
import {
  TemplateDetailImageGallery,
  TemplateReferenceImageFieldManager,
} from "@/components/products/template-image-galleries";
import {
  QuickCategoryForm,
  TemplateCategoryFields,
} from "@/components/products/template-category-fields";
import { TemplateFormShell } from "@/components/products/template-form-shell";
import { TopBar } from "@/components/top-bar";
import { requireSettingsManager } from "@/lib/auth";
import {
  defaultCurrency,
  formatMoney,
  normalizeCurrency,
  supportedCurrencies,
} from "@/lib/currencies";
import {
  latestBrandPriceListUpdate,
  productTemplatePriceCheckState,
} from "@/lib/product-price-check";
import { createClient } from "@/lib/supabase/server";
import { profileDisplayName } from "@/lib/user-display";
import {
  createProductComponent,
  createLinkedProductFamily,
  archiveBrandPriceListUpdate,
  archiveProductTemplate,
  createBrandPriceListUpdate,
  createProductTemplateMaterialGroup,
  createProductTemplate,
  deactivateLinkedProductFamily,
  deactivateProductTemplateMaterialGroup,
  markProductTemplateDiscontinued,
  markComponentPriceChecked,
  markBrandPriceListCheckedAction,
  markBrandTemplatesPriceChecked,
  markTemplatePriceChecked,
  markVisibleProductTemplatesPriceChecked,
  permanentlyDeleteLinkedProductFamily,
  permanentlyDeleteProductTemplate,
  restoreLinkedProductFamily,
  restoreProductTemplate,
  updateLinkedProductFamily,
  updateBrandPriceListUpdate,
  updateProductComponent,
  updateProductTemplateDefaultPrice,
  updateProductTemplateDetailPrice,
  updateProductTemplateMaterialGroup,
  updateProductTemplate,
} from "./actions";

export const dynamic = "force-dynamic";

type TemplatesSearchParams = {
  message?: string | string[];
  q?: string | string[];
  brand?: string | string[];
  main?: string | string[];
  sub?: string | string[];
  priceStatus?: string | string[];
  template?: string | string[];
  addTemplate?: string | string[];
  editTemplate?: string | string[];
};

type TemplatesPageProps = {
  searchParams?: Promise<TemplatesSearchParams>;
};

type Brand = {
  id: string;
  name: string;
  default_currency: string;
  last_price_list_checked_at: string | null;
  last_price_list_checked_by: string | null;
  price_list_check_interval_days: number | null;
  price_list_check_note: string | null;
};

type BrandPriceListUpdate = {
  id: string;
  brand_id: string;
  title: string;
  reference_no: string | null;
  currency: string | null;
  effective_from: string | null;
  received_at: string | null;
  status: "draft" | "active" | "archived";
  notes: string | null;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProductTemplatePriceHistory = {
  id: string;
  product_template_id: string;
  brand_price_list_update_id: string | null;
  old_default_unit_price: number | null;
  new_default_unit_price: number | null;
  currency: string | null;
  effective_from: string | null;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
};

type ProductTemplateDetailPriceHistory = {
  id: string;
  product_template_id: string;
  brand_price_list_update_id: string | null;
  source_table: string;
  source_record_id: string;
  price_field: string;
  old_price: number | null;
  new_price: number;
  currency: string | null;
  effective_from: string | null;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
};

type AuditActivityEntry = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  parent_entity_type: string | null;
  parent_entity_id: string | null;
  action: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

type Category = {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
};

type ProductTemplateImageField =
  | "proposed_image_url_1"
  | "proposed_image_url_2"
  | "proposed_image_url_3"
  | "proposed_image_url_4"
  | "proposed_image_url_5"
  | "proposed_image_url_6"
  | "proposed_image_url_7"
  | "proposed_image_url_8"
  | "proposed_image_url_9"
  | "proposed_image_url_10"
  | "proposed_image_url_11"
  | "proposed_image_url_12"
  | "proposed_image_url_13"
  | "proposed_image_url_14"
  | "proposed_image_url_15"
  | "proposed_image_url_16"
  | "proposed_image_url_17"
  | "proposed_image_url_18"
  | "proposed_image_url_19"
  | "proposed_image_url_20";
type ExtraProductTemplateImageField = Exclude<
  ProductTemplateImageField,
  "proposed_image_url_1" | "proposed_image_url_2" | "proposed_image_url_3"
>;

type ProductTemplateImageDisplaySettings = {
  fit?: "contain" | "cover";
  zoom?: number;
  positionX?: number;
  positionY?: number;
};

type ProductTemplateImageSettings = {
  default_image_url?: ProductTemplateImageDisplaySettings;
  proposed_image_url_1?: ProductTemplateImageDisplaySettings;
  proposed_image_url_2?: ProductTemplateImageDisplaySettings;
  proposed_image_url_3?: ProductTemplateImageDisplaySettings;
  proposed_image_url_4?: ProductTemplateImageDisplaySettings;
  proposed_image_url_5?: ProductTemplateImageDisplaySettings;
  proposed_image_url_6?: ProductTemplateImageDisplaySettings;
  proposed_image_url_7?: ProductTemplateImageDisplaySettings;
  proposed_image_url_8?: ProductTemplateImageDisplaySettings;
  proposed_image_url_9?: ProductTemplateImageDisplaySettings;
  proposed_image_url_10?: ProductTemplateImageDisplaySettings;
  proposed_image_url_11?: ProductTemplateImageDisplaySettings;
  proposed_image_url_12?: ProductTemplateImageDisplaySettings;
  proposed_image_url_13?: ProductTemplateImageDisplaySettings;
  proposed_image_url_14?: ProductTemplateImageDisplaySettings;
  proposed_image_url_15?: ProductTemplateImageDisplaySettings;
  proposed_image_url_16?: ProductTemplateImageDisplaySettings;
  proposed_image_url_17?: ProductTemplateImageDisplaySettings;
  proposed_image_url_18?: ProductTemplateImageDisplaySettings;
  proposed_image_url_19?: ProductTemplateImageDisplaySettings;
  proposed_image_url_20?: ProductTemplateImageDisplaySettings;
  proposed_image_url_4_path?: string | null;
  proposed_image_url_5_path?: string | null;
  proposed_image_url_6_path?: string | null;
  proposed_image_url_7_path?: string | null;
  proposed_image_url_8_path?: string | null;
  proposed_image_url_9_path?: string | null;
  proposed_image_url_10_path?: string | null;
  proposed_image_url_11_path?: string | null;
  proposed_image_url_12_path?: string | null;
  proposed_image_url_13_path?: string | null;
  proposed_image_url_14_path?: string | null;
  proposed_image_url_15_path?: string | null;
  proposed_image_url_16_path?: string | null;
  proposed_image_url_17_path?: string | null;
  proposed_image_url_18_path?: string | null;
  proposed_image_url_19_path?: string | null;
  proposed_image_url_20_path?: string | null;
};

type ProductTemplate = {
  id: string;
  brand_id: string;
  main_category_id: string | null;
  sub_category_id: string | null;
  template_code: string | null;
  template_name: string;
  item_code: string | null;
  description: string | null;
  default_specification: string | null;
  origin: string | null;
  supplier_name: string | null;
  default_image_url: string | null;
  reference_image_url: string | null;
  proposed_image_url_1: string | null;
  proposed_image_url_2: string | null;
  proposed_image_url_3: string | null;
  proposed_image_url_4: string | null;
  proposed_image_url_5: string | null;
  proposed_image_url_6: string | null;
  proposed_image_url_7: string | null;
  proposed_image_url_8: string | null;
  proposed_image_url_9: string | null;
  proposed_image_url_10: string | null;
  proposed_image_url_11: string | null;
  proposed_image_url_12: string | null;
  proposed_image_url_13: string | null;
  proposed_image_url_14: string | null;
  proposed_image_url_15: string | null;
  proposed_image_url_16: string | null;
  proposed_image_url_17: string | null;
  proposed_image_url_18: string | null;
  proposed_image_url_19: string | null;
  proposed_image_url_20: string | null;
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  image_settings: ProductTemplateImageSettings | null;
  unit_label: string;
  currency: string;
  default_unit_price: number;
  is_active: boolean;
  lifecycle_status: "active" | "archived" | "discontinued";
  last_price_checked_at: string | null;
  last_price_checked_by: string | null;
  price_check_interval_days: number | null;
  price_check_note: string | null;
  price_notes: string | null;
};

type ProductComponent = {
  id: string;
  template_id: string;
  option_type: string;
  component_group: string;
  component_code: string | null;
  component_name: string;
  description: string | null;
  qty: number;
  unit_label: string;
  unit_price: number;
  currency: string;
  is_optional: boolean;
  is_default_selected: boolean;
  sort_order: number;
  is_active: boolean;
  calculation_data: {
    desking_role?: string;
    base_cluster_seats?: number;
    module_length?: number;
    depth?: number;
    height?: number;
    dimension_unit?: string;
    price_role?: string;
    seats_per_cluster?: number;
    modules_per_cluster?: number;
    label?: string;
    allow_manual_quantity?: boolean;
  } | null;
  last_price_checked_at: string | null;
  price_notes: string | null;
};

type LinkedProductFamily = {
  id: string;
  parent_template_id: string;
  linked_template_id: string;
  label: string | null;
  is_required: boolean;
  allow_multiple: boolean;
  add_to_parent_price: boolean;
  append_to_specification: boolean;
  default_qty: number;
  sort_order: number;
  is_active: boolean;
};

type BrandMaterialGroup = {
  id: string;
  brand_id: string;
  group_name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type BrandMaterial = {
  id: string;
  brand_id: string;
  material_group_id: string;
  material_category: string | null;
  material_code: string | null;
  material_name: string;
  sort_order: number;
  is_active: boolean;
};

type ProductTemplateMaterialGroup = {
  id: string;
  product_template_id: string;
  material_group_id: string;
  selection_mode: "full_group" | "selected_items";
  label_override: string | null;
  is_required: boolean;
  allow_multiple: boolean;
  show_in_specification: boolean;
  show_in_quotation: boolean;
  sort_order: number;
  is_active: boolean;
};

type ProductTemplateMaterialGroupItem = {
  id: string;
  product_template_material_group_id: string;
  brand_material_id: string;
  sort_order: number;
  is_active: boolean;
};

const advancedOptionTypes = [
  { value: "material_finish", label: "Material / Finish" },
  { value: "fabric_category", label: "Fabric Category" },
  { value: "linked_addon", label: "Advanced Add-on" },
  { value: "other", label: "Other" },
];

const legacyOptionTypes = [
  { value: "size_variant", label: "Size Variant" },
  { value: "cluster_preset", label: "Cluster Preset" },
];

const optionTypeLabels = new Map(
  [...advancedOptionTypes, ...legacyOptionTypes].map((optionType) => [
    optionType.value,
    optionType.label,
  ]),
);

const proposedImageSlots = [
  { field: "proposed_image_url_1", label: "Image 1" },
  { field: "proposed_image_url_2", label: "Image 2" },
  { field: "proposed_image_url_3", label: "Image 3" },
  { field: "proposed_image_url_4", label: "Image 4" },
  { field: "proposed_image_url_5", label: "Image 5" },
  { field: "proposed_image_url_6", label: "Image 6" },
  { field: "proposed_image_url_7", label: "Image 7" },
  { field: "proposed_image_url_8", label: "Image 8" },
  { field: "proposed_image_url_9", label: "Image 9" },
  { field: "proposed_image_url_10", label: "Image 10" },
  { field: "proposed_image_url_11", label: "Image 11" },
  { field: "proposed_image_url_12", label: "Image 12" },
  { field: "proposed_image_url_13", label: "Image 13" },
  { field: "proposed_image_url_14", label: "Image 14" },
  { field: "proposed_image_url_15", label: "Image 15" },
  { field: "proposed_image_url_16", label: "Image 16" },
  { field: "proposed_image_url_17", label: "Image 17" },
  { field: "proposed_image_url_18", label: "Image 18" },
  { field: "proposed_image_url_19", label: "Image 19" },
  { field: "proposed_image_url_20", label: "Image 20" },
] as const;

function extraTemplateImagePathKey(field: ExtraProductTemplateImageField) {
  return `${field}_path` as const;
}

function templateImageValue(
  template: Pick<ProductTemplate, "default_image_url" | "image_settings" | ProductTemplateImageField> | null | undefined,
  field: ProductTemplateImageField,
) {
  if (!template) return null;
  const directValue = template[field];

  if (field === "proposed_image_url_1") {
    return directValue ?? template.default_image_url;
  }

  if (directValue) {
    return directValue;
  }

  const imagePath = template.image_settings?.[
    extraTemplateImagePathKey(field as ExtraProductTemplateImageField)
  ];
  return typeof imagePath === "string" && imagePath ? imagePath : null;
}

function templateImageDisplaySettings(
  template: Pick<ProductTemplate, "image_settings"> | null | undefined,
  field: ProductTemplateImageField,
) {
  if (!template?.image_settings) return undefined;

  const settings = template.image_settings[field];
  if (settings && typeof settings === "object") {
    return settings;
  }

  return field === "proposed_image_url_1"
    ? template.image_settings.default_image_url
    : undefined;
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function templatesHref(
  params: TemplatesSearchParams,
  updates: Partial<
    Record<
      | "q"
      | "brand"
      | "main"
      | "sub"
      | "priceStatus"
      | "template"
      | "addTemplate"
      | "editTemplate",
      string | null
    >
  >,
) {
  const next = new URLSearchParams();

  for (const key of [
    "q",
    "brand",
    "main",
    "sub",
    "priceStatus",
    "template",
    "addTemplate",
    "editTemplate",
  ] as const) {
    const updatedValue = updates[key];
    const value =
      updatedValue === undefined ? stringParam(params[key]) : updatedValue;

    if (value) {
      next.set(key, value);
    }
  }

  const query = next.toString();
  return `/products/templates${query ? `?${query}` : ""}`;
}

function withHash(path: string, hash: string) {
  const hashIndex = path.indexOf("#");
  const basePath = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  return `${basePath}#${hash}`;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-zinc-200 bg-zinc-100 text-zinc-600"
      }`}
    >
      {active ? "active" : "inactive"}
    </span>
  );
}

function normalizeTemplateLifecycleStatus(
  template: Pick<ProductTemplate, "is_active" | "lifecycle_status">,
): "active" | "archived" | "discontinued" {
  if (template.lifecycle_status === "archived" || template.lifecycle_status === "discontinued") {
    return template.lifecycle_status;
  }

  return template.is_active ? "active" : "archived";
}

function TemplateLifecycleBadge({
  status,
}: {
  status: "active" | "archived" | "discontinued";
}) {
  const className = status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status === "discontinued"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-zinc-200 bg-zinc-100 text-zinc-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
}) {
  return (
    <label className="block md:col-span-2">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={2}
        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-zinc-300 text-emerald-900"
      />
      {label}
    </label>
  );
}

function CurrencySelect({
  defaultValue,
  name = "currency",
}: {
  defaultValue?: string | null;
  name?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        Currency
      </span>
      <select
        name={name}
        defaultValue={normalizeCurrency(defaultValue ?? defaultCurrency)}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        {supportedCurrencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel?: string }) {
  return (
    <PendingSubmitButton
      className="h-10 rounded-md bg-emerald-900 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800"
      pendingLabel={pendingLabel}
    >
      {label}
    </PendingSubmitButton>
  );
}

function messageTone(message: string): "error" | "success" {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes("could not") ||
    normalized.includes("required") ||
    normalized.includes("does not belong") ||
    normalized.includes("invalid") ||
    normalized.includes("failed")
  ) {
    return "error";
  }

  return "success";
}

function categoryPricingColumns(rows?: CategoryPricingRow[] | null) {
  const columns = ["Cat A", "Cat B", "Cat C", "Cat D"];

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    Object.keys(row.prices ?? {}).forEach((category) => {
      if (!columns.includes(category)) {
        columns.push(category);
      }
    });
  });

  return columns;
}

function FormSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function TemplateForm({
  brands,
  categories,
  defaultBrandId,
  defaultMainCategoryId,
  defaultSubCategoryId,
  initialMessage,
  returnTo,
  template,
}: {
  brands: Brand[];
  categories: Category[];
  defaultBrandId?: string;
  defaultMainCategoryId?: string;
  defaultSubCategoryId?: string;
  initialMessage?: string;
  returnTo: string;
  template?: ProductTemplate;
}) {
  const templateId = template?.id ?? randomUUID();
  const selectedBrandId = template?.brand_id ?? defaultBrandId ?? "";
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) ?? null;
  const brandDefaultCurrency = selectedBrand?.default_currency ?? defaultCurrency;
  const templateCurrency = template?.currency ?? brandDefaultCurrency;
  const selectedMainCategoryId =
    template?.main_category_id ?? defaultMainCategoryId ?? "";
  const selectedSubCategoryId =
    template?.sub_category_id ?? defaultSubCategoryId ?? "";
  const allowQuickCreate = !template;

  return (
    <TemplateFormShell
      action={template ? updateProductTemplate : createProductTemplate}
      cancelHref="/products/templates"
      initialMessage={initialMessage}
      pendingLabel={template ? "Saving template..." : "Adding template..."}
      pendingMessage={template ? "Saving template..." : "Adding product to library..."}
      submitLabel={template ? "Save template" : "Add template"}
    >
      <input type="hidden" name="id" value={templateId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <FormSection
        title="Template Details"
        description="Set the core product identity, category placement, quotation defaults, and internal notes for this template."
      >
        <TemplateCategoryFields
          allowQuickCreate={allowQuickCreate}
          brands={brands}
          categories={categories}
          defaultBrandId={selectedBrandId}
          defaultMainCategoryId={selectedMainCategoryId}
          defaultSubCategoryId={selectedSubCategoryId}
        />
        <Field
          name="template_name"
          label="Item Name / Template Name"
          defaultValue={template?.template_name}
          required
        />
        <Field
          name="template_code"
          label="Template Code"
          defaultValue={template?.template_code}
        />
        <Field name="item_code" label="Item Code" defaultValue={template?.item_code} />
        <TextArea
          name="default_specification"
          label="Specifications"
          defaultValue={template?.default_specification}
        />
        <Field
          name="origin"
          label="Origin override"
          defaultValue={template?.origin}
        />
        <Field
          name="supplier_name"
          label="Supplier override"
          defaultValue={template?.supplier_name}
        />
        <div className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 md:col-span-2 xl:col-span-1">
          Dimension is calculated from workstation size pricing when available.
          Finish and accessory choices still come from Template Options.
        </div>
        <TextArea name="description" label="Description" defaultValue={template?.description} />
        <TextArea
          name="price_notes"
          label="Pricing / Formula Notes"
          defaultValue={template?.price_notes}
        />
      </FormSection>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <FormSection
          title="Pricing"
          description="Define the base commercial values used before optional rows, materials, and linked product families are applied."
        >
          <Field
            name="unit_label"
            label="Unit"
            defaultValue={template?.unit_label ?? "Pc"}
          />
          <CurrencySelect defaultValue={templateCurrency} />
          <Field
            name="default_unit_price"
            label="Default U.Price"
            type="number"
            defaultValue={template?.default_unit_price ?? 0}
          />
          <div className="flex items-end">
            <p className="text-xs leading-5 text-zinc-500">
              New templates are created as active. Use Archive or Discontinue from the Product Library when the lifecycle changes.
            </p>
          </div>
        </FormSection>

        <FormSection
          title="Reference Images"
          description="Add product reference images. Click an image card or paste a PNG, JPG, JPEG, or WebP image from the clipboard."
        >
          <input
            type="hidden"
            name="reference_image_url"
            defaultValue={template?.reference_image_url ?? ""}
          />
          <div className="md:col-span-2 xl:col-span-3">
            <TemplateReferenceImageFieldManager
              initialSlots={proposedImageSlots.map((slot) => ({
                ...slot,
                settings: templateImageDisplaySettings(template, slot.field),
                value: templateImageValue(template, slot.field),
              }))}
              templateExists={Boolean(template)}
              templateId={templateId}
            />
          </div>
        </FormSection>
      </div>

      <FormSection
        title="Detailed Pricing"
        description="Maintain workstation pricing, base variants, accessories, and finish-category pricing in one dedicated pricing area."
      >
        <TemplatePricingSections
          key={[
            template?.id ?? "new",
            template?.desking_size_pricing?.length ?? 0,
            template?.variant_pricing?.length ?? 0,
            template?.accessory_pricing?.length ?? 0,
            template?.category_pricing?.length ?? 0,
            (template?.category_pricing ?? [])
              .map((row) => Object.keys(row.prices ?? {}).join(","))
              .join("|"),
          ].join(":")}
          deskingSizePricingRows={template?.desking_size_pricing}
          variantPricingRows={template?.variant_pricing}
          accessoryPricingRows={template?.accessory_pricing}
          categoryPricingRows={template?.category_pricing}
          brandDefaultCurrency={brandDefaultCurrency}
          templateCurrency={template?.currency}
        />
      </FormSection>
    </TemplateFormShell>
  );
}

function OptionTypeSelect({ defaultValue }: { defaultValue?: string | null }) {
  const visibleOptionTypes =
    defaultValue && !advancedOptionTypes.some((optionType) => optionType.value === defaultValue)
      ? [
          {
            value: defaultValue,
            label: `${optionTypeLabels.get(defaultValue) ?? defaultValue} (legacy)`,
          },
          ...advancedOptionTypes,
        ]
      : advancedOptionTypes;

  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        Option type
      </span>
      <select
        name="option_type"
        defaultValue={defaultValue ?? ""}
        required
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">Select option type</option>
        {visibleOptionTypes.map((optionType) => (
          <option key={optionType.value} value={optionType.value}>
            {optionType.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ComponentForm({
  templateId,
  component,
}: {
  templateId: string;
  component?: ProductComponent;
}) {
  return (
    <form
      action={component ? updateProductComponent : createProductComponent}
      className="space-y-4"
    >
      {component ? <input type="hidden" name="id" value={component.id} /> : null}
      <input type="hidden" name="template_id" value={templateId} />
      <FormSection title="Option Identity">
        <OptionTypeSelect defaultValue={component?.option_type} />
        <Field
          name="component_group"
          label="Option group"
          defaultValue={component?.component_group}
          required
        />
        <Field
          name="component_name"
          label="Option name"
          defaultValue={component?.component_name}
          required
        />
        <Field
          name="component_code"
          label="Code"
          defaultValue={component?.component_code}
        />
      </FormSection>

      <FormSection title="Quantity & Pricing">
        <Field name="qty" label="Qty" type="number" defaultValue={component?.qty ?? 1} />
        <Field
          name="unit_label"
          label="Unit"
          defaultValue={component?.unit_label ?? "Pc"}
        />
        <Field
          name="unit_price"
          label="U.Price"
          type="number"
          defaultValue={component?.unit_price ?? 0}
        />
        <CurrencySelect defaultValue={component?.currency} />
        <Field
          name="sort_order"
          label="Sort order"
          type="number"
          defaultValue={component?.sort_order ?? 0}
        />
      </FormSection>

      <FormSection title="Behavior & Notes">
        <div className="flex flex-wrap items-end gap-4 md:col-span-2 xl:col-span-3">
          <Checkbox
            name="is_optional"
            label="Optional"
            defaultChecked={component?.is_optional ?? true}
          />
          <Checkbox
            name="is_default_selected"
            label="Default selected"
            defaultChecked={component?.is_default_selected ?? false}
          />
          <Checkbox
            name="is_active"
            label="Active"
            defaultChecked={component?.is_active ?? true}
          />
        </div>
        <TextArea name="description" label="Description" defaultValue={component?.description} />
        <TextArea
          name="price_notes"
          label="Pricing notes"
          defaultValue={component?.price_notes}
        />
      </FormSection>

      <div className="flex justify-end border-t border-zinc-200 pt-4">
        <SubmitButton label={component ? "Save option" : "Add option"} />
      </div>
    </form>
  );
}

function LinkedProductFamilyForm({
  link,
  templates,
  templateId,
}: {
  link?: LinkedProductFamily;
  templates: ProductTemplate[];
  templateId: string;
}) {
  const linkedTemplateOptions = templates.filter((template) => template.id !== templateId);

  return (
    <form action={link ? updateLinkedProductFamily : createLinkedProductFamily} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {link ? <input type="hidden" name="id" value={link.id} /> : null}
      <input type="hidden" name="parent_template_id" value={templateId} />
      {link ? null : (
        <label className="block xl:col-span-2">
          <span className="text-xs font-semibold uppercase text-zinc-500">Product family</span>
          <select
            name="linked_template_id"
            required
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">Select product template</option>
            {linkedTemplateOptions.map((template) => (
              <option key={template.id} value={template.id}>
                {template.template_name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Field name="label" label="Label" defaultValue={link?.label} />
      <Field name="default_qty" label="Default qty" type="number" defaultValue={link?.default_qty ?? 0} />
      <Field name="sort_order" label="Sort order" type="number" defaultValue={link?.sort_order ?? 0} />
      <div className="flex flex-wrap items-end gap-4 md:col-span-2 xl:col-span-4">
        <Checkbox name="add_to_parent_price" label="Add price to parent row" defaultChecked={link?.add_to_parent_price ?? true} />
        <Checkbox name="append_to_specification" label="Append to specification" defaultChecked={link?.append_to_specification ?? true} />
        <Checkbox name="is_required" label="Required" defaultChecked={link?.is_required ?? false} />
        <Checkbox name="allow_multiple" label="Allow multiple" defaultChecked={link?.allow_multiple ?? true} />
        <Checkbox name="is_active" label="Active" defaultChecked={link?.is_active ?? true} />
      </div>
      <div className="md:col-span-2 xl:col-span-4">
        <SubmitButton label={link ? "Save link" : "Link Product Family"} />
      </div>
    </form>
  );
}

function TemplateMaterialGroupForm({
  link,
  linkedItemIds = new Set<string>(),
  materials,
  materialGroups,
  returnTo,
  template,
}: {
  link?: ProductTemplateMaterialGroup;
  linkedItemIds?: Set<string>;
  materials: BrandMaterial[];
  materialGroups: BrandMaterialGroup[];
  returnTo: string;
  template: ProductTemplate;
}) {
  const linkedGroupOptions = materialGroups.filter((group) => group.brand_id === template.brand_id);
  const formMaterials = materials
    .filter((material) => material.brand_id === template.brand_id)
    .filter((material) => (link ? material.material_group_id === link.material_group_id : true))
    .sort((left, right) =>
      left.material_group_id.localeCompare(right.material_group_id) ||
      (left.material_category ?? "").localeCompare(right.material_category ?? "") ||
      left.sort_order - right.sort_order ||
      (left.material_code ?? "").localeCompare(right.material_code ?? "") ||
      left.material_name.localeCompare(right.material_name),
    );
  const materialsByGroup = new Map<string, BrandMaterial[]>();

  for (const material of formMaterials) {
    materialsByGroup.set(material.material_group_id, [
      ...(materialsByGroup.get(material.material_group_id) ?? []),
      material,
    ]);
  }

  return (
    <form action={link ? updateProductTemplateMaterialGroup : createProductTemplateMaterialGroup} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {link ? <input type="hidden" name="id" value={link.id} /> : null}
      <input type="hidden" name="product_template_id" value={template.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      {!link ? (
        <label className="block xl:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-500">Material group</span>
          <select
            name="material_group_id"
            required
            className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">Select group</option>
            {linkedGroupOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.group_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Field name="label_override" label="Label override" defaultValue={link?.label_override} />
      <Field name="sort_order" label="Sort order" type="number" defaultValue={link?.sort_order ?? 0} />
      <fieldset className="grid gap-2 rounded-md border border-zinc-200 bg-white p-3 md:col-span-2 xl:col-span-4">
        <legend className="px-1 text-xs font-semibold uppercase text-zinc-500">Selection mode</legend>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            type="radio"
            name="selection_mode"
            value="full_group"
            defaultChecked={(link?.selection_mode ?? "full_group") === "full_group"}
            className="h-4 w-4 accent-emerald-900"
          />
          Full group
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input
            type="radio"
            name="selection_mode"
            value="selected_items"
            defaultChecked={link?.selection_mode === "selected_items"}
            className="h-4 w-4 accent-emerald-900"
          />
          Selected finishes only
        </label>
        <div className="mt-2 grid max-h-72 gap-3 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2">
          {Array.from(materialsByGroup.entries()).map(([groupId, groupMaterials]) => {
            const group = materialGroups.find((candidate) => candidate.id === groupId);

            return (
              <div key={groupId} className="grid gap-2">
                {!link ? (
                  <p className="text-[11px] font-bold uppercase text-zinc-500">{group?.group_name ?? "Material group"}</p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {groupMaterials.map((material) => (
                    <label key={material.id} className="flex min-w-0 items-start gap-2 rounded border border-zinc-200 bg-white p-2 text-xs text-zinc-700">
                      <input
                        type="checkbox"
                        name="brand_material_id[]"
                        value={material.id}
                        defaultChecked={linkedItemIds.has(material.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-900"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-zinc-900">
                          {[material.material_code, material.material_name].filter(Boolean).join(" - ") || material.material_name}
                        </span>
                        {material.material_category ? (
                          <span className="block truncate text-[11px] text-zinc-500">{material.material_category}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {!formMaterials.length ? (
            <p className="text-xs text-zinc-500">No active finishes found for this brand group yet.</p>
          ) : null}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-4 md:col-span-2 xl:col-span-4">
        <Checkbox name="is_required" label="Required" defaultChecked={link?.is_required ?? false} />
        <Checkbox name="show_in_specification" label="Show in Specification" defaultChecked={link?.show_in_specification ?? true} />
        <Checkbox name="show_in_quotation" label="Show in Quotation" defaultChecked={link?.show_in_quotation ?? false} />
        {link ? <Checkbox name="is_active" label="Active" defaultChecked={link.is_active} /> : null}
      </div>
      <div className="md:col-span-2 xl:col-span-4">
        <SubmitButton label={link ? "Save material group" : "Link Material Group"} />
      </div>
    </form>
  );
}

function DeactivateTemplateMaterialGroupForm({ id, returnTo }: { id: string; returnTo: string }) {
  return (
    <form action={deactivateProductTemplateMaterialGroup}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-700"
      >
        Remove link
      </button>
    </form>
  );
}

function DeactivateLinkedProductFamilyForm({ id }: { id: string }) {
  return (
    <form action={deactivateLinkedProductFamily}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-700"
      >
        Remove link
      </button>
    </form>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Not checked";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatShortDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function auditMetadataActorName(metadata: Record<string, unknown> | null | undefined) {
  const actorName = metadata?.actorName;

  return typeof actorName === "string" && actorName.trim() ? actorName : null;
}

function actorDisplayName(
  actorNameById: Map<string, string>,
  actorId?: string | null,
  metadata?: Record<string, unknown> | null,
) {
  if (actorId) {
    return actorNameById.get(actorId) ?? auditMetadataActorName(metadata) ?? "Unknown user";
  }

  return auditMetadataActorName(metadata) ?? "Unknown user";
}

function priceCheckState(
  template: ProductTemplate,
  latestBrandUpdate?: BrandPriceListUpdate | null,
  brandName?: string | null,
) {
  return productTemplatePriceCheckState({
    brandName,
    formatDate,
    latestBrandPriceListUpdate: latestBrandUpdate,
    template,
  });
}

function PriceCheckStatus({
  actorNameById,
  brandName,
  latestBrandUpdate,
  template,
}: {
  actorNameById: Map<string, string>;
  brandName?: string | null;
  latestBrandUpdate?: BrandPriceListUpdate | null;
  template: ProductTemplate;
}) {
  const status = priceCheckState(template, latestBrandUpdate, brandName);
  const className = status.tone === "ok"
    ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900"
    : status.tone === "notice"
      ? "inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-900"
    : "inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900";

  return (
    <div className="mt-2 grid gap-1">
      <span className={className}>{status.label}</span>
      <p className="text-xs text-zinc-500">
        {template.last_price_checked_at
          ? `Price checked by ${actorDisplayName(actorNameById, template.last_price_checked_by)} on ${formatDate(template.last_price_checked_at)}`
          : status.detail}
      </p>
      {template.price_check_note ? (
        <p className="line-clamp-2 text-xs text-zinc-500">{template.price_check_note}</p>
      ) : null}
    </div>
  );
}

function CompactPriceCheckStatus({
  actorNameById,
  brandName,
  latestBrandUpdate,
  template,
}: {
  actorNameById: Map<string, string>;
  brandName?: string | null;
  latestBrandUpdate?: BrandPriceListUpdate | null;
  template: ProductTemplate;
}) {
  const status = priceCheckState(template, latestBrandUpdate, brandName);
  const className = status.tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : status.tone === "notice"
      ? "border-sky-200 bg-sky-50 text-sky-900"
      : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      <span className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${className}`}>
        {status.label}
      </span>
      <span>
        {template.last_price_checked_at
          ? `Checked ${formatShortDate(template.last_price_checked_at)} by ${actorDisplayName(actorNameById, template.last_price_checked_by)}`
          : status.detail}
      </span>
    </div>
  );
}

function TemplateRowActions({
  editHref,
  openHref,
  template,
}: {
  editHref: string;
  openHref: string;
  template: ProductTemplate;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      <Link
        href={openHref}
        className="inline-flex h-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
      >
        Open
      </Link>
      <Link
        href={editHref}
        className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        Edit
      </Link>
      <details className="relative">
        <summary className="inline-flex h-9 cursor-pointer list-none items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
          More
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          <div className="mb-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Template actions
          </div>
          <form action={markTemplatePriceChecked} className="mb-1">
            <input type="hidden" name="id" value={template.id} />
            <PendingSubmitButton
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              pendingLabel="Marking checked..."
            >
              Mark price checked
            </PendingSubmitButton>
          </form>
          <form action={archiveProductTemplate} className="mb-1">
            <input type="hidden" name="id" value={template.id} />
            <ConfirmSubmitButton
              message="This will move the product template to Archive. You can restore it later."
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              pendingLabel="Archiving..."
            >
              Archive
            </ConfirmSubmitButton>
          </form>
          <form action={markProductTemplateDiscontinued}>
            <input type="hidden" name="id" value={template.id} />
            <ConfirmSubmitButton
              message="This will hide the product from active Product Library and future quotations. Existing quotations will not be affected."
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
              pendingLabel="Discontinuing..."
            >
              Discontinue
            </ConfirmSubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

function TemplateDetailHeaderActions({
  editHref,
  template,
}: {
  editHref: string;
  template: ProductTemplate;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={editHref}
        className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        Edit template details
      </Link>
      <details className="relative">
        <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
          More
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          <div className="mb-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Template actions
          </div>
          <form action={markTemplatePriceChecked} className="mb-1">
            <input type="hidden" name="id" value={template.id} />
            <PendingSubmitButton
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              pendingLabel="Marking checked..."
            >
              Mark price checked
            </PendingSubmitButton>
          </form>
          <form action={archiveProductTemplate} className="mb-1">
            <input type="hidden" name="id" value={template.id} />
            <ConfirmSubmitButton
              message="This will move the product template to Archive. You can restore it later."
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              pendingLabel="Archiving..."
            >
              Archive
            </ConfirmSubmitButton>
          </form>
          <form action={markProductTemplateDiscontinued}>
            <input type="hidden" name="id" value={template.id} />
            <ConfirmSubmitButton
              message="This will hide the product from active Product Library and future quotations. Existing quotations will not be affected."
              className="flex w-full items-center justify-start rounded-md px-2 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
              pendingLabel="Discontinuing..."
            >
              Discontinue
            </ConfirmSubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

function brandPriceCheckState(brand: Brand) {
  const intervalDays = brand.price_list_check_interval_days && brand.price_list_check_interval_days > 0
    ? brand.price_list_check_interval_days
    : 90;

  if (!brand.last_price_list_checked_at) {
    return {
      detail: "No brand price-list check recorded",
      tone: "warning" as const,
      label: "Brand price list not checked yet",
    };
  }

  const checkedAt = new Date(brand.last_price_list_checked_at);
  const dueAt = checkedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000;

  if (!Number.isFinite(checkedAt.getTime()) || dueAt < Date.now()) {
    return {
      detail: `Last checked: ${formatDate(brand.last_price_list_checked_at)}`,
      tone: "warning" as const,
      label: "Brand price list due",
    };
  }

  return {
    detail: `Brand price list checked: ${formatDate(brand.last_price_list_checked_at)}`,
    tone: "ok" as const,
    label: "Brand price list checked",
  };
}

function BrandPriceListUpdateForm({
  brandId,
  update,
}: {
  brandId: string;
  update?: BrandPriceListUpdate;
}) {
  return (
    <form action={update ? updateBrandPriceListUpdate : createBrandPriceListUpdate} className="grid gap-2">
      {update ? <input type="hidden" name="id" value={update.id} /> : null}
      <input type="hidden" name="brand_id" value={brandId} />
      <Field name="title" label="Title" defaultValue={update?.title} required />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field name="reference_no" label="Reference No." defaultValue={update?.reference_no} />
        <Field name="currency" label="Currency" defaultValue={update?.currency} />
        <Field name="effective_from" label="Effective from" type="date" defaultValue={update?.effective_from} />
        <Field name="received_at" label="Received date" type="date" defaultValue={update?.received_at} />
      </div>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Status</span>
        <select
          name="status"
          defaultValue={update?.status ?? "draft"}
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <Field name="attachment_url" label="Attachment URL" defaultValue={update?.attachment_url} />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Notes</span>
        <textarea
          name="notes"
          defaultValue={update?.notes ?? ""}
          rows={3}
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <SubmitButton label={update ? "Save price list update" : "Add price list update"} />
    </form>
  );
}

function ProductTemplatePriceUpdateForm({
  priceListUpdates,
  returnTo,
  template,
}: {
  priceListUpdates: BrandPriceListUpdate[];
  returnTo: string;
  template: ProductTemplate;
}) {
  const activeUpdates = priceListUpdates.filter((update) => update.status === "active");

  return (
    <form action={updateProductTemplateDefaultPrice} className="grid gap-2">
      <input type="hidden" name="product_template_id" value={template.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <div className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-600">
        Current price: <span className="font-semibold text-zinc-950">{formatMoney(template.currency, template.default_unit_price)}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field name="new_default_unit_price" label="New price" type="number" defaultValue={template.default_unit_price} required />
        <CurrencySelect defaultValue={template.currency} />
      </div>
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Price list update</span>
        <select
          name="brand_price_list_update_id"
          defaultValue=""
          className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        >
          <option value="">No linked price list</option>
          {activeUpdates.map((update) => (
            <option key={update.id} value={update.id}>
              {update.title}{update.effective_from ? ` (${formatShortDate(update.effective_from)})` : ""}
            </option>
          ))}
        </select>
      </label>
      <Field name="effective_from" label="Effective from" type="date" />
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Note</span>
        <textarea
          name="note"
          rows={3}
          className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </label>
      <ConfirmSubmitButton
        message="This updates the product template source price for future quotations only. Existing quotations will not change. Continue?"
        className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
        pendingLabel="Updating source price..."
      >
        Update source price
      </ConfirmSubmitButton>
    </form>
  );
}

function DetailPriceUpdateForm({
  currency,
  label,
  priceField,
  priceListUpdates,
  productTemplateId,
  returnTo,
  sourceRecordId,
  sourceTable,
  value,
}: {
  currency?: string | null;
  label: string;
  priceField: string;
  priceListUpdates: BrandPriceListUpdate[];
  productTemplateId: string;
  returnTo: string;
  sourceRecordId?: string | null;
  sourceTable: string;
  value: number;
}) {
  const selectableUpdates = priceListUpdates.filter((update) => update.status !== "archived");

  if (!sourceRecordId) {
    return (
      <p className="rounded-md border border-dashed border-zinc-200 bg-white p-2 text-xs text-zinc-500">
        Save this template once before updating this source price with history.
      </p>
    );
  }

  return (
    <details
      className="mt-2"
      data-state-key={`template-detail-price-form-${productTemplateId}-${sourceRecordId}-${priceField}`}
    >
      <summary className="inline-flex cursor-pointer rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700">
        Update price
      </summary>
      <form action={updateProductTemplateDetailPrice} className="mt-2 grid gap-2 rounded-md border border-zinc-200 bg-white p-3">
        <input type="hidden" name="product_template_id" value={productTemplateId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="source_table" value={sourceTable} />
        <input type="hidden" name="source_record_id" value={sourceRecordId} />
        <input type="hidden" name="price_field" value={priceField} />
        <p className="text-xs text-zinc-500">
          {label}: <span className="font-semibold text-zinc-950">{formatMoney(currency ?? defaultCurrency, value)}</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field name="new_price" label="New price" type="number" defaultValue={value} required />
          <CurrencySelect defaultValue={currency} />
        </div>
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Price list update</span>
          <select
            name="brand_price_list_update_id"
            defaultValue=""
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">No linked price list</option>
            {selectableUpdates.map((update) => (
              <option key={update.id} value={update.id}>
                {update.title}{update.effective_from ? ` (${formatShortDate(update.effective_from)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <Field name="effective_from" label="Effective from" type="date" />
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Note</span>
          <textarea
            name="note"
            rows={2}
            className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
        </label>
        <ConfirmSubmitButton
          message="This updates source pricing for future quotations only. Existing quotations will not change. Continue?"
          className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
          pendingLabel="Saving source price..."
        >
          Save source price
        </ConfirmSubmitButton>
      </form>
    </details>
  );
}

function DetailPriceRow({
  children,
  form,
}: {
  children: ReactNode;
  form: ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-sm text-zinc-600">{children}</div>
        <div className="sm:w-80">{form}</div>
      </div>
    </div>
  );
}

export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const { user, displayName } = await requireSettingsManager();
  const params = (await searchParams) ?? {};
  const message = stringParam(params.message);
  const searchQuery = stringParam(params.q).trim();
  const selectedBrandFilter = stringParam(params.brand);
  const selectedMainFilter = stringParam(params.main);
  const selectedSubFilter = stringParam(params.sub);
  const selectedPriceStatusFilter = stringParam(params.priceStatus);
  const openTemplateId = stringParam(params.template);
  const showAddTemplate = stringParam(params.addTemplate) === "1";
  const editTemplateId = stringParam(params.editTemplate);
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name,default_currency,last_price_list_checked_at,last_price_list_checked_by,price_list_check_interval_days,price_list_check_note")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<Brand[]>();

  const { data: categories, error: categoriesError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name,code,description,is_active")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<Category[]>();

  const { data: templates, error: templatesError } = await supabase
    .from("product_templates")
    .select(
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,proposed_image_url_4,proposed_image_url_5,proposed_image_url_6,proposed_image_url_7,proposed_image_url_8,proposed_image_url_9,proposed_image_url_10,proposed_image_url_11,proposed_image_url_12,proposed_image_url_13,proposed_image_url_14,proposed_image_url_15,proposed_image_url_16,proposed_image_url_17,proposed_image_url_18,proposed_image_url_19,proposed_image_url_20,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,image_settings,unit_label,currency,default_unit_price,is_active,lifecycle_status,last_price_checked_at,last_price_checked_by,price_check_interval_days,price_check_note,price_notes",
    )
    .order("brand_id", { ascending: true })
    .order("template_name", { ascending: true })
    .returns<ProductTemplate[]>();

  const { data: components, error: componentsError } = await supabase
    .from("product_components")
    .select("*")
    .order("template_id", { ascending: true })
    .order("component_group", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("component_name", { ascending: true })
    .returns<ProductComponent[]>();

  const { data: linkedFamilies, error: linkedFamiliesError } = await supabase
    .from("product_template_linked_families")
    .select("id,parent_template_id,linked_template_id,label,is_required,allow_multiple,add_to_parent_price,append_to_specification,default_qty,sort_order,is_active")
    .order("parent_template_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<LinkedProductFamily[]>();

  const { data: templateUsageRows, error: templateUsageRowsError } = await supabase
    .from("quotation_items")
    .select("source_template_id")
    .not("source_template_id", "is", null)
    .returns<Array<{ source_template_id: string | null }>>();

  const { data: materialGroups, error: materialGroupsError } = await supabase
    .from("brand_material_groups")
    .select("id,brand_id,group_name,description,sort_order,is_active")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("group_name", { ascending: true })
    .returns<BrandMaterialGroup[]>();

  const { data: materials, error: materialsError } = await supabase
    .from("brand_materials")
    .select("id,brand_id,material_group_id,material_category,material_code,material_name,sort_order,is_active")
    .eq("is_active", true)
    .order("brand_id", { ascending: true })
    .order("material_group_id", { ascending: true })
    .order("material_category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("material_code", { ascending: true })
    .returns<BrandMaterial[]>();

  const { data: templateMaterialGroups, error: templateMaterialGroupsError } = await supabase
    .from("product_template_material_groups")
    .select("id,product_template_id,material_group_id,selection_mode,label_override,is_required,allow_multiple,show_in_specification,show_in_quotation,sort_order,is_active")
    .order("product_template_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductTemplateMaterialGroup[]>();

  const { data: templateMaterialGroupItems, error: templateMaterialGroupItemsError } = await supabase
    .from("product_template_material_group_items")
    .select("id,product_template_material_group_id,brand_material_id,sort_order,is_active")
    .eq("is_active", true)
    .order("product_template_material_group_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .returns<ProductTemplateMaterialGroupItem[]>();

  const { data: brandPriceListUpdates, error: brandPriceListUpdatesError } = await supabase
    .from("brand_price_list_updates")
    .select("id,brand_id,title,reference_no,currency,effective_from,received_at,status,notes,attachment_url,created_by,created_at,updated_at")
    .order("brand_id", { ascending: true })
    .order("effective_from", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<BrandPriceListUpdate[]>();

  const { data: templatePriceHistory, error: templatePriceHistoryError } = await supabase
    .from("product_template_price_history")
    .select("id,product_template_id,brand_price_list_update_id,old_default_unit_price,new_default_unit_price,currency,effective_from,note,changed_by,changed_at")
    .order("product_template_id", { ascending: true })
    .order("changed_at", { ascending: false })
    .returns<ProductTemplatePriceHistory[]>();

  const { data: templateDetailPriceHistory, error: templateDetailPriceHistoryError } = await supabase
    .from("product_template_detail_price_history")
    .select("id,product_template_id,brand_price_list_update_id,source_table,source_record_id,price_field,old_price,new_price,currency,effective_from,note,changed_by,changed_at")
    .order("product_template_id", { ascending: true })
    .order("changed_at", { ascending: false })
    .returns<ProductTemplateDetailPriceHistory[]>();

  const { data: auditActivity, error: auditActivityError } = await supabase
    .from("audit_activity_log")
    .select("id,entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by,created_at")
    .in("entity_type", [
      "brand",
      "brand_price_list_update",
      "product_template",
      "product_template_price",
      "product_template_detail_price",
    ])
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<AuditActivityEntry[]>();

  if (brandsError) console.error("TEMPLATE BRANDS LIST ERROR", brandsError.message);
  if (categoriesError) console.error("TEMPLATE CATEGORIES LIST ERROR", categoriesError.message);
  if (templatesError) console.error("PRODUCT TEMPLATES LIST ERROR", templatesError.message);
  if (componentsError) console.error("PRODUCT COMPONENTS LIST ERROR", componentsError.message);
  if (linkedFamiliesError) console.error("LINKED PRODUCT FAMILIES LIST ERROR", linkedFamiliesError.message);
  if (templateUsageRowsError) console.error("PRODUCT TEMPLATE USAGE LIST ERROR", templateUsageRowsError.message);
  if (materialGroupsError) console.error("BRAND MATERIAL GROUPS LIST ERROR", materialGroupsError.message);
  if (materialsError) console.error("BRAND MATERIALS LIST ERROR", materialsError.message);
  if (templateMaterialGroupsError) console.error("TEMPLATE MATERIAL GROUPS LIST ERROR", templateMaterialGroupsError.message);
  if (templateMaterialGroupItemsError) console.error("TEMPLATE MATERIAL GROUP ITEMS LIST ERROR", templateMaterialGroupItemsError.message);
  if (brandPriceListUpdatesError) console.error("BRAND PRICE LIST UPDATES ERROR", brandPriceListUpdatesError.message);
  if (templatePriceHistoryError) console.error("TEMPLATE PRICE HISTORY ERROR", templatePriceHistoryError.message);
  if (templateDetailPriceHistoryError) console.error("TEMPLATE DETAIL PRICE HISTORY ERROR", templateDetailPriceHistoryError.message);
  if (auditActivityError) console.error("AUDIT ACTIVITY LOG ERROR", auditActivityError.message);

  const manageBrandsHref = "/products/brands?addBrand=1";
  const brandList = brands ?? [];
  const categoryList = categories ?? [];
  const templateList = templates ?? [];
  const templateLifecycleById = new Map<string, "active" | "archived" | "discontinued">(
    templateList.map((template) => [template.id, normalizeTemplateLifecycleStatus(template)]),
  );
  const activeTemplateList = templateList.filter((template) => templateLifecycleById.get(template.id) === "active");
  const archivedTemplateList = templateList.filter((template) => templateLifecycleById.get(template.id) === "archived");
  const discontinuedTemplateList = templateList.filter((template) => templateLifecycleById.get(template.id) === "discontinued");
  const archivedLinkedFamilyList = (linkedFamilies ?? []).filter((link) => !link.is_active);
  const usedTemplateIds = new Set(
    (templateUsageRows ?? [])
      .map((row) => row.source_template_id)
      .filter((value): value is string => Boolean(value)),
  );
  const linkedTemplateIds = new Set(
    (linkedFamilies ?? []).flatMap((link) => [link.parent_template_id, link.linked_template_id]),
  );
  const materialGroupList = materialGroups ?? [];
  const materialList = materials ?? [];
  const activeTemplateMaterialGroupList = (templateMaterialGroups ?? []).filter((link) => link.is_active);
  const materialGroupItemList = templateMaterialGroupItems ?? [];
  const brandPriceListUpdateList = brandPriceListUpdates ?? [];
  const templatePriceHistoryList = templatePriceHistory ?? [];
  const templateDetailPriceHistoryList = templateDetailPriceHistory ?? [];
  const brandMap = new Map(brandList.map((brand) => [brand.id, brand.name]));
  const categoryMap = new Map(
    categoryList.map((category) => [category.id, category.name]),
  );
  const mainCategories = categoryList.filter((category) => !category.parent_id);
  const subCategories = categoryList.filter((category) => category.parent_id);
  const visibleMainCategories = mainCategories.filter(
    (category) =>
      !selectedBrandFilter || category.brand_id === selectedBrandFilter,
  );
  const visibleSubCategories = subCategories.filter((category) => {
    if (selectedMainFilter) {
      return category.parent_id === selectedMainFilter;
    }

    return !selectedBrandFilter || category.brand_id === selectedBrandFilter;
  });
  const componentsByTemplate = new Map<string, ProductComponent[]>();
  const linkedFamiliesByTemplate = new Map<string, LinkedProductFamily[]>();
  const materialGroupsByTemplate = new Map<string, ProductTemplateMaterialGroup[]>();
  const materialGroupItemsByLink = new Map<string, ProductTemplateMaterialGroupItem[]>();
  const priceListUpdatesByBrand = new Map<string, BrandPriceListUpdate[]>();
  const latestPriceListUpdateByBrand = new Map<string, BrandPriceListUpdate>();
  const priceHistoryByTemplate = new Map<string, ProductTemplatePriceHistory[]>();
  const detailPriceHistoryByTemplate = new Map<string, ProductTemplateDetailPriceHistory[]>();
  const auditHistoryByTemplate = new Map<string, AuditActivityEntry[]>();
  const auditHistoryByPriceListUpdate = new Map<string, AuditActivityEntry[]>();

  for (const component of components ?? []) {
    const templateComponents = componentsByTemplate.get(component.template_id) ?? [];
    templateComponents.push(component);
    componentsByTemplate.set(component.template_id, templateComponents);
  }

  for (const link of (linkedFamilies ?? []).filter((link) => link.is_active)) {
    const templateLinks = linkedFamiliesByTemplate.get(link.parent_template_id) ?? [];
    templateLinks.push(link);
    linkedFamiliesByTemplate.set(link.parent_template_id, templateLinks);
  }

  for (const link of activeTemplateMaterialGroupList) {
    const templateLinks = materialGroupsByTemplate.get(link.product_template_id) ?? [];
    templateLinks.push(link);
    materialGroupsByTemplate.set(link.product_template_id, templateLinks);
  }

  for (const item of materialGroupItemList.filter((entry) => entry.is_active)) {
    materialGroupItemsByLink.set(item.product_template_material_group_id, [
      ...(materialGroupItemsByLink.get(item.product_template_material_group_id) ?? []),
      item,
    ]);
  }

  for (const update of brandPriceListUpdateList) {
    priceListUpdatesByBrand.set(update.brand_id, [
      ...(priceListUpdatesByBrand.get(update.brand_id) ?? []),
      update,
    ]);
  }

  for (const [brandId, updates] of priceListUpdatesByBrand.entries()) {
    const latestUpdate = latestBrandPriceListUpdate(updates);

    if (latestUpdate) {
      latestPriceListUpdateByBrand.set(brandId, latestUpdate);
    }
  }

  for (const history of templatePriceHistoryList) {
    priceHistoryByTemplate.set(history.product_template_id, [
      ...(priceHistoryByTemplate.get(history.product_template_id) ?? []),
      history,
    ]);
  }

  for (const history of templateDetailPriceHistoryList) {
    detailPriceHistoryByTemplate.set(history.product_template_id, [
      ...(detailPriceHistoryByTemplate.get(history.product_template_id) ?? []),
      history,
    ]);
  }

  const auditActivityList = auditActivity ?? [];
  const actorIds = Array.from(new Set(
    [
      ...brandList.map((brand) => brand.last_price_list_checked_by),
      ...templateList.map((template) => template.last_price_checked_by),
      ...brandPriceListUpdateList.map((update) => update.created_by),
      ...templatePriceHistoryList.map((history) => history.changed_by),
      ...templateDetailPriceHistoryList.map((history) => history.changed_by),
      ...auditActivityList.map((entry) => entry.created_by),
    ].filter((value): value is string => Boolean(value)),
  ));
  const actorNameById = new Map<string, string>();

  if (actorIds.length) {
    const { data: actorProfiles, error: actorProfilesError } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .in("id", actorIds)
      .returns<Array<{ id: string; full_name: string | null; email: string | null }>>();

    if (actorProfilesError) {
      console.error("TEMPLATE ACTOR PROFILES ERROR", actorProfilesError.message);
    } else {
      for (const profile of actorProfiles ?? []) {
        actorNameById.set(profile.id, profileDisplayName(profile));
      }
    }
  }

  const templateIds = new Set(templateList.map((template) => template.id));
  const priceListUpdateIds = new Set(brandPriceListUpdateList.map((update) => update.id));

  for (const entry of auditActivityList) {
    if (
      entry.entity_type === "product_template" &&
      entry.entity_id &&
      templateIds.has(entry.entity_id)
    ) {
      auditHistoryByTemplate.set(entry.entity_id, [
        ...(auditHistoryByTemplate.get(entry.entity_id) ?? []),
        entry,
      ]);
    }

    if (
      (entry.entity_type === "product_template_price" || entry.entity_type === "product_template_detail_price") &&
      entry.parent_entity_type === "product_template" &&
      entry.parent_entity_id &&
      templateIds.has(entry.parent_entity_id)
    ) {
      auditHistoryByTemplate.set(entry.parent_entity_id, [
        ...(auditHistoryByTemplate.get(entry.parent_entity_id) ?? []),
        entry,
      ]);
    }

    if (
      entry.entity_type === "brand_price_list_update" &&
      entry.entity_id &&
      priceListUpdateIds.has(entry.entity_id)
    ) {
      auditHistoryByPriceListUpdate.set(entry.entity_id, [
        ...(auditHistoryByPriceListUpdate.get(entry.entity_id) ?? []),
        entry,
      ]);
    }
  }

  const normalizedSearch = searchQuery.toLowerCase();
  const templatesMatchingStructure = activeTemplateList.filter((template) => {
    const matchesSearch =
      !normalizedSearch ||
      template.template_name.toLowerCase().includes(normalizedSearch) ||
      (template.template_code ?? "").toLowerCase().includes(normalizedSearch) ||
      (template.item_code ?? "").toLowerCase().includes(normalizedSearch);
    const matchesBrand =
      !selectedBrandFilter || template.brand_id === selectedBrandFilter;
    const matchesMain =
      !selectedMainFilter || template.main_category_id === selectedMainFilter;
    const matchesSub =
      !selectedSubFilter || template.sub_category_id === selectedSubFilter;

    return matchesSearch && matchesBrand && matchesMain && matchesSub;
  });
  const priceCheckSummary = templatesMatchingStructure.reduce(
    (summary, template) => {
      const key = priceCheckState(
        template,
        latestPriceListUpdateByBrand.get(template.brand_id),
        brandMap.get(template.brand_id),
      ).key;

      return {
        ...summary,
        [key]: summary[key] + 1,
        total: summary.total + 1,
      };
    },
    { checked: 0, due: 0, not_checked: 0, scheduled: 0, total: 0 },
  );
  const priceStatusOptions = new Set(["not_checked", "due", "checked", "scheduled"]);
  const filteredTemplates = templatesMatchingStructure.filter((template) => {
    if (!priceStatusOptions.has(selectedPriceStatusFilter)) return true;

    return priceCheckState(
      template,
      latestPriceListUpdateByBrand.get(template.brand_id),
      brandMap.get(template.brand_id),
    ).key === selectedPriceStatusFilter;
  });
  const selectedTemplate =
    activeTemplateList.find((template) => template.id === openTemplateId) ?? null;
  const selectedBrand =
    brandList.find((brand) => brand.id === selectedBrandFilter) ?? null;
  const selectedMainCategory =
    mainCategories.find((category) => category.id === selectedMainFilter) ?? null;
  const selectedSubCategory =
    subCategories.find((category) => category.id === selectedSubFilter) ?? null;
  const selectedCategory = selectedSubCategory ?? selectedMainCategory ?? null;
  const selectedBrandCategories = selectedBrand
    ? mainCategories.filter((category) => category.brand_id === selectedBrand.id)
    : [];
  const selectedBrandTemplates = selectedBrand
    ? filteredTemplates.filter((template) => template.brand_id === selectedBrand.id)
    : [];
  const selectedCategoryTemplates = selectedCategory
    ? selectedBrandTemplates.filter((template) =>
        selectedSubCategory
          ? template.sub_category_id === selectedSubCategory.id
          : template.main_category_id === selectedCategory.id
      )
    : [];
  const selectedCategorySubcategories = selectedMainCategory
    ? subCategories.filter((category) => category.parent_id === selectedMainCategory.id)
    : [];

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Product Templates"
          description="Manage reusable product templates and configurable options."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/products"
              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Back to products
            </Link>
            {message ? (
              <p className={`rounded-md border px-3 py-2 text-sm ${
                messageTone(message) === "error"
                  ? "border-red-200 bg-red-50 text-red-900"
                  : "border-emerald-200 bg-emerald-50 text-emerald-950"
              }`}>
                {message}
              </p>
            ) : null}
          </div>

          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3">
              <form
                action="/products/templates"
                className="grid gap-3 xl:grid-cols-[minmax(180px,1fr)_170px_180px_180px_190px_auto]"
              >
                <input
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Search name, item code, or template code"
                  className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
                <select
                  name="brand"
                  defaultValue={selectedBrandFilter}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All brands</option>
                  {brandList.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
                <select
                  name="main"
                  defaultValue={selectedMainFilter}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All main categories</option>
                  {visibleMainCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <select
                  name="sub"
                  defaultValue={selectedSubFilter}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All sub categories</option>
                  {visibleSubCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <select
                  name="priceStatus"
                  defaultValue={selectedPriceStatusFilter}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="">All price statuses</option>
                  <option value="not_checked">Price not checked yet</option>
                  <option value="due">Price check due</option>
                  <option value="scheduled">New price list scheduled</option>
                  <option value="checked">Price checked</option>
                </select>
                <div className="flex gap-2">
                  <PendingSubmitButton
                    className="h-10 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                    pendingLabel="Applying..."
                  >
                    Apply
                  </PendingSubmitButton>
                  <Link
                    href={manageBrandsHref}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    + Add Brand
                  </Link>
                  <Link
                    href={templatesHref(params, { addTemplate: "1" })}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                  >
                    + Add Product Template
                  </Link>
                </div>
              </form>

              {showAddTemplate ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="font-semibold text-zinc-950">
                        Add product template
                      </h2>
                      <p className="mt-1 text-sm text-zinc-500">
                        Create the template, then open it to manage pricing,
                        images, and linked product families.
                      </p>
                    </div>
                    <Link
                      href={templatesHref(params, { addTemplate: null })}
                      className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-white"
                    >
                      Cancel
                    </Link>
                  </div>
                  <TemplateForm
                    brands={brandList}
                    categories={categoryList}
                    defaultBrandId={selectedBrandFilter}
                    defaultMainCategoryId={selectedMainFilter}
                    defaultSubCategoryId={selectedSubFilter}
                    initialMessage={message}
                    returnTo={templatesHref(params, { addTemplate: "1" })}
                  />
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase text-zinc-500">Price check summary</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-zinc-700">Total: {priceCheckSummary.total}</span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">Not checked: {priceCheckSummary.not_checked}</span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">Due: {priceCheckSummary.due}</span>
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-900">Scheduled: {priceCheckSummary.scheduled}</span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-900">Checked: {priceCheckSummary.checked}</span>
                </div>
              </div>
              {filteredTemplates.length ? (
                <form action={markVisibleProductTemplatesPriceChecked}>
                  {filteredTemplates.map((template) => (
                    <input key={template.id} type="hidden" name="template_id[]" value={template.id} />
                  ))}
                  <ConfirmSubmitButton
                    message="Mark all visible templates as price checked now?"
                    className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
                    pendingLabel="Marking checked..."
                  >
                    Mark visible templates checked now
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>
          </section>

          <section className={selectedTemplate ? "mt-6 space-y-6" : "mt-6 grid gap-6 2xl:grid-cols-[360px_1fr]"}>
            {!selectedTemplate ? (
            <aside className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Product Library
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                  <Link href={templatesHref(params, {
                    brand: null,
                    main: null,
                    sub: null,
                    template: null,
                    editTemplate: null,
                  })} className={selectedBrand ? "font-medium text-zinc-500 transition hover:text-zinc-700" : "font-semibold text-zinc-950"}>
                    Product Library
                  </Link>
                  {selectedBrand ? (
                    <>
                      <span>/</span>
                      <Link href={templatesHref(params, {
                        brand: selectedBrand.id,
                        main: null,
                        sub: null,
                        template: null,
                        editTemplate: null,
                      })} className={selectedCategory ? "font-medium text-zinc-500 transition hover:text-zinc-700" : "font-semibold text-zinc-950"}>
                        {selectedBrand.name}
                      </Link>
                    </>
                  ) : null}
                  {selectedCategory ? (
                    <>
                      <span>/</span>
                      <span className="font-semibold text-zinc-950">{selectedCategory.name}</span>
                    </>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-zinc-500">
                  {!selectedBrand
                    ? `${brandList.length} brands`
                    : !selectedCategory
                      ? `${selectedBrandCategories.length} categories in ${selectedBrand.name}`
                      : `${selectedCategoryTemplates.length} templates in ${selectedCategory.name}`}
                </p>
              </div>
              <div className="max-h-[720px] space-y-3 overflow-auto p-4">
                {!selectedBrand ? (
                  brandList.map((brand) => {
                    const allBrandTemplates = templateList.filter((template) => template.brand_id === brand.id);
                    const activeBrandTemplates = activeTemplateList.filter((template) => template.brand_id === brand.id);
                    const matchingBrandTemplates = filteredTemplates.filter((template) => template.brand_id === brand.id);
                    const latestPriceListUpdate = latestPriceListUpdateByBrand.get(brand.id) ?? null;
                    const brandStatus = brandPriceCheckState(brand);
                    const badgeClass = brandStatus.tone === "ok"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900";

                    return (
                      <div key={brand.id} className="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold text-zinc-950">{brand.name}</h2>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold text-zinc-700">
                                {allBrandTemplates.length} templates
                              </span>
                              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold text-zinc-700">
                                {activeBrandTemplates.length} active
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 font-semibold ${badgeClass}`}>
                                {brandStatus.label}
                              </span>
                            </div>
                          </div>
                          <Link
                            href={templatesHref(params, {
                              brand: brand.id,
                              main: null,
                              sub: null,
                              template: null,
                              editTemplate: null,
                            })}
                            className="inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            View
                          </Link>
                        </div>
                        <div className="mt-3 grid gap-1 text-xs text-zinc-500">
                          <p>Matching current filters: {matchingBrandTemplates.length}</p>
                          <p>Last price check: {formatShortDate(brand.last_price_list_checked_at)}</p>
                          <p>Latest price list: {latestPriceListUpdate?.title ?? "No update recorded"}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <>
                    <Link
                      href={templatesHref(params, {
                        brand: null,
                        main: null,
                        sub: null,
                        template: null,
                        editTemplate: null,
                      })}
                      className="inline-flex text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                    >
                      ← Back to brands
                    </Link>
                    <details data-state-key={`template-library-main-category-create-${selectedBrand.id}`}>
                      <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                        + Main Category
                      </summary>
                      <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                        <QuickCategoryForm brandId={selectedBrand.id} />
                      </div>
                    </details>
                    {selectedBrandCategories.map((mainCategory) => {
                      const categoryTemplates = selectedBrandTemplates.filter(
                        (template) => template.main_category_id === mainCategory.id,
                      );
                      const subcategoryCount = subCategories.filter(
                        (category) => category.parent_id === mainCategory.id,
                      ).length;
                      const isActive = selectedMainCategory?.id === mainCategory.id;

                      return (
                        <div
                          key={mainCategory.id}
                          className={`rounded-xl border p-4 transition ${
                            isActive
                              ? "border-emerald-200 bg-emerald-50/40"
                              : "border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-sm"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate font-semibold text-zinc-950">{mainCategory.name}</h3>
                              {categoryTemplates.length > 0 || subcategoryCount > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                  {categoryTemplates.length > 0 ? (
                                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold text-zinc-700">
                                      {categoryTemplates.length} templates
                                    </span>
                                  ) : null}
                                  {subcategoryCount > 0 ? (
                                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold text-zinc-700">
                                      {subcategoryCount} subcategories
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            <Link
                              href={templatesHref(params, {
                                brand: selectedBrand.id,
                                main: mainCategory.id,
                                sub: null,
                                template: null,
                                editTemplate: null,
                              })}
                              className="inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                            >
                              View
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                    {!selectedBrandCategories.length ? (
                      <div className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                        No main categories yet for {selectedBrand.name}.
                      </div>
                    ) : null}
                  </>
                )}
                {!brandList.length ? (
                  <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                    No brands yet.{" "}
                    <Link
                      href={manageBrandsHref}
                      className="font-semibold text-emerald-900 transition hover:text-emerald-800"
                    >
                      Create a brand first.
                    </Link>
                  </p>
                ) : null}
              </div>
            </aside>
            ) : null}

            <div className="space-y-5">
              {!selectedTemplate ? (
              <>
              {selectedBrand ? (
                <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="font-semibold text-zinc-950">{selectedBrand.name}</h2>
                      <p className="mt-1 text-sm text-zinc-500">
                        {!selectedCategory
                          ? "Choose a category to open its templates."
                          : `Showing templates for ${selectedCategory.name}.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <form action={markBrandPriceListCheckedAction}>
                        <input type="hidden" name="brand_id" value={selectedBrand.id} />
                        <PendingSubmitButton
                          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                          pendingLabel="Applying..."
                        >
                          Check brand prices
                        </PendingSubmitButton>
                      </form>
                      {selectedBrandTemplates.length ? (
                        <form action={markBrandTemplatesPriceChecked}>
                          <input type="hidden" name="brand_id" value={selectedBrand.id} />
                          <ConfirmSubmitButton
                            message={`Mark all active templates under ${selectedBrand.name} as price checked now?`}
                            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                            pendingLabel="Marking checked..."
                          >
                            Mark templates checked
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                      <p>
                        Brand price list status:{" "}
                        <span className="font-semibold text-zinc-950">{brandPriceCheckState(selectedBrand).label}</span>
                      </p>
                      <p className="mt-1">
                        Last price check: {formatShortDate(selectedBrand.last_price_list_checked_at)}
                      </p>
                      <p className="mt-1">
                        Latest update: {(latestPriceListUpdateByBrand.get(selectedBrand.id) ?? null)?.title ?? "No update recorded"}
                      </p>
                    </div>
                    <details className="rounded-lg border border-zinc-200 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
                        Price list updates
                      </summary>
                      <div className="mt-3 space-y-3 text-xs leading-5 text-zinc-600">
                        <details data-state-key={`template-library-price-updates-add-${selectedBrand.id}`}>
                          <summary className="cursor-pointer rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                            Add update
                          </summary>
                          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                            <BrandPriceListUpdateForm brandId={selectedBrand.id} />
                          </div>
                        </details>
                        {(latestPriceListUpdateByBrand.get(selectedBrand.id) ?? null) ? (
                          <>
                            <details data-state-key={`template-library-price-updates-edit-${selectedBrand.id}`}>
                              <summary className="cursor-pointer rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50">
                                Edit latest
                              </summary>
                              <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                                <BrandPriceListUpdateForm
                                  brandId={selectedBrand.id}
                                  update={latestPriceListUpdateByBrand.get(selectedBrand.id) ?? undefined}
                                />
                              </div>
                            </details>
                            {(latestPriceListUpdateByBrand.get(selectedBrand.id) ?? null)?.status !== "archived" ? (
                              <form action={archiveBrandPriceListUpdate}>
                                <input type="hidden" name="id" value={(latestPriceListUpdateByBrand.get(selectedBrand.id) ?? null)?.id ?? ""} />
                                <ConfirmSubmitButton
                                  message="Archive this price list update?"
                                  className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400 hover:bg-zinc-50"
                                >
                                  Archive latest
                                </ConfirmSubmitButton>
                              </form>
                            ) : null}
                          </>
                        ) : (
                          <p>No price list updates recorded yet.</p>
                        )}
                      </div>
                    </details>
                  </div>
                </section>
              ) : null}

              {!selectedBrand ? (
                <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-10 text-center shadow-sm">
                  <h2 className="text-lg font-semibold text-zinc-950">Start from a brand</h2>
                  <p className="mt-2 text-sm text-zinc-500">
                    The library now opens in a cleaner drill-down mode. Select a brand to view its categories, then open a category to view product templates.
                  </p>
                </section>
              ) : !selectedCategory ? (
                <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-10 text-center shadow-sm">
                  <h2 className="text-lg font-semibold text-zinc-950">Choose a category</h2>
                  <p className="mt-2 text-sm text-zinc-500">
                    Showing only {selectedBrand.name} categories. Select one to open its templates.
                  </p>
                </section>
              ) : (
                <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                  <div className="border-b border-zinc-200 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className="font-semibold text-zinc-950">{selectedCategory.name}</h2>
                        <p className="mt-1 text-sm text-zinc-500">
                          Compact templates for {selectedBrand?.name} / {selectedCategory.name}
                        </p>
                      </div>
                      <Link
                        href={templatesHref(params, {
                          brand: selectedBrand?.id ?? null,
                          main: null,
                          sub: null,
                          template: null,
                          editTemplate: null,
                        })}
                        className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                      >
                        Back to categories
                      </Link>
                    </div>
                    {selectedMainCategory && selectedCategorySubcategories.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={templatesHref(params, {
                            brand: selectedBrand?.id ?? null,
                            main: selectedMainCategory.id,
                            sub: null,
                            template: null,
                            editTemplate: null,
                          })}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                            !selectedSubCategory
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                          }`}
                        >
                          All
                        </Link>
                        {selectedCategorySubcategories.map((subCategory) => (
                          <Link
                            key={subCategory.id}
                            href={templatesHref(params, {
                              brand: selectedBrand?.id ?? null,
                              main: selectedMainCategory.id,
                              sub: subCategory.id,
                              template: null,
                              editTemplate: null,
                            })}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                              selectedSubCategory?.id === subCategory.id
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
                            }`}
                          >
                            {subCategory.name}
                          </Link>
                        ))}
                        <details data-state-key={`template-library-sub-category-create-${selectedMainCategory.id}`}>
                          <summary className="cursor-pointer rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                            + Sub Category
                          </summary>
                          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                            <QuickCategoryForm
                              brandId={selectedBrand?.id ?? ""}
                              parentId={selectedMainCategory.id}
                            />
                          </div>
                        </details>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {selectedCategoryTemplates.map((template) => {
                      const firstVisibleImageSlot = proposedImageSlots.find((slot) =>
                        Boolean(templateImageValue(template, slot.field)),
                      );
                      const firstImageValue = firstVisibleImageSlot
                        ? templateImageValue(template, firstVisibleImageSlot.field)
                        : template.default_image_url;
                      const firstImageSettings = firstVisibleImageSlot
                        ? templateImageDisplaySettings(template, firstVisibleImageSlot.field)
                        : template.image_settings?.default_image_url;
                      const path = [
                        brandMap.get(template.brand_id) ?? "Unknown brand",
                        template.main_category_id
                          ? categoryMap.get(template.main_category_id) ?? "Main category"
                          : "No main category",
                        template.sub_category_id
                          ? categoryMap.get(template.sub_category_id) ?? "No sub category"
                          : "No sub category",
                      ].join(" / ");
                      const openHref = templatesHref(params, {
                        template: template.id,
                        editTemplate: null,
                        addTemplate: null,
                      });
                      const editHref = templatesHref(params, {
                        template: template.id,
                        editTemplate: template.id,
                        addTemplate: null,
                      });

                      return (
                        <article
                          key={template.id}
                          className={`flex h-full flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition hover:border-zinc-300 hover:shadow-md ${
                            template.id === openTemplateId
                              ? "border-emerald-200 bg-emerald-50/30"
                              : "border-zinc-200"
                          }`}
                        >
                          <div className="border-b border-zinc-200 bg-zinc-50 p-3">
                            <div className="flex h-36 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-white">
                              <ProductTemplateImageUploader
                                imageSettings={firstImageSettings}
                                label={template.template_name}
                                templateId={template.id}
                                value={firstImageValue}
                              />
                            </div>
                          </div>
                          <div className="flex flex-1 flex-col gap-3 p-4">
                            <div className="flex flex-wrap items-start gap-2">
                              <h3 className="min-w-0 flex-1 text-sm font-semibold text-zinc-950">
                                {template.template_name}
                              </h3>
                              <TemplateLifecycleBadge status={templateLifecycleById.get(template.id) ?? "active"} />
                            </div>
                            <p className="text-xs leading-5 text-zinc-500">{path}</p>
                            <div className="text-sm font-semibold text-zinc-950">
                              {formatMoney(template.currency, template.default_unit_price)}
                            </div>
                            <div className="text-[11px] text-zinc-500">
                              {template.template_code || template.item_code
                                ? [template.template_code, template.item_code].filter(Boolean).join(" / ")
                                : "No template or item code"}
                            </div>
                            <div>
                              <CompactPriceCheckStatus
                                actorNameById={actorNameById}
                                brandName={brandMap.get(template.brand_id)}
                                latestBrandUpdate={latestPriceListUpdateByBrand.get(template.brand_id)}
                                template={template}
                              />
                            </div>
                            <div className="mt-auto border-t border-zinc-100 pt-3">
                              <TemplateRowActions
                                editHref={editHref}
                                openHref={openHref}
                                template={template}
                              />
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!selectedCategoryTemplates.length ? (
                    <div className="p-8 text-center text-sm text-zinc-500">
                      <p>No product templates in this category yet.</p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                        <Link
                          href={manageBrandsHref}
                          className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          Manage Brands
                        </Link>
                        <Link
                          href={templatesHref(params, { addTemplate: "1" })}
                          className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                        >
                          + Add Product Template
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </section>
              )}
              </>
              ) : null}

            {(selectedTemplate ? [selectedTemplate] : []).map((template) => {
              const templateComponents = componentsByTemplate.get(template.id) ?? [];
              const templatePriceHistoryRows = priceHistoryByTemplate.get(template.id) ?? [];
              const templateDetailPriceHistoryRows = detailPriceHistoryByTemplate.get(template.id) ?? [];
              const templateAuditRows = auditHistoryByTemplate.get(template.id) ?? [];
              const templateBrandPriceListUpdates = priceListUpdatesByBrand.get(template.brand_id) ?? [];
              const templateBaseReturnTo = templatesHref(params, { template: template.id });
              const templateLibraryReturnTo = templatesHref(params, {
                template: null,
                editTemplate: null,
                addTemplate: null,
              });
              const templatePriceUpdatesReturnTo = withHash(templateBaseReturnTo, `template-${template.id}-price-updates`);
              const templateMaterialsReturnTo = withHash(templateBaseReturnTo, `template-${template.id}-materials`);
              const templateEditHref = withHash(
                templatesHref(params, {
                  template: template.id,
                  editTemplate: template.id,
                  addTemplate: null,
                }),
                `template-${template.id}`,
              );
              const visibleImageSlots = proposedImageSlots.flatMap((slot) => {
                const value = templateImageValue(template, slot.field);
                const settings = templateImageDisplaySettings(template, slot.field);

                return value
                  ? [{ ...slot, settings, value }]
                  : [];
              });
              const priceListUpdateById = new Map(templateBrandPriceListUpdates.map((update) => [update.id, update]));
              const groups = new Map<string, ProductComponent[]>();
              const hasWorkstationSizePricing = Boolean(
                template.desking_size_pricing?.some((row) => row.is_active !== false),
              );
              const activeTemplateComponents = templateComponents.filter(
                (component) =>
                  component.is_active &&
                  !(
                    hasWorkstationSizePricing &&
                    ["size_variant", "cluster_preset"].includes(component.option_type)
                  ),
              );

              for (const component of activeTemplateComponents) {
                const groupKey = `${component.option_type}:${component.component_group}`;
                const group = groups.get(groupKey) ?? [];
                group.push(component);
                groups.set(groupKey, group);
              }

              return (
                <article
                  key={template.id}
                  id={`template-${template.id}`}
                  data-preserve-anchor={`template-${template.id}`}
                  className="rounded-lg border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="border-b border-zinc-200 p-5">
                    <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href="/products"
                          className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          Back to products
                        </Link>
                        <Link
                          href={templateLibraryReturnTo}
                          className="inline-flex h-10 items-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          Back to category
                        </Link>
                      </div>
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                            <Link href={templateLibraryReturnTo} className="transition hover:text-zinc-700">
                              Product Library
                            </Link>
                            <span>/</span>
                            <Link
                              href={templatesHref(params, {
                                brand: template.brand_id,
                                main: null,
                                sub: null,
                                template: null,
                                editTemplate: null,
                                addTemplate: null,
                              })}
                              className="transition hover:text-zinc-700"
                            >
                              {brandMap.get(template.brand_id) ?? "Unknown brand"}
                            </Link>
                            {template.main_category_id ? (
                              <>
                                <span>/</span>
                                <Link
                                  href={templatesHref(params, {
                                    brand: template.brand_id,
                                    main: template.main_category_id,
                                    sub: null,
                                    template: null,
                                    editTemplate: null,
                                    addTemplate: null,
                                  })}
                                  className="transition hover:text-zinc-700"
                                >
                                  {categoryMap.get(template.main_category_id) ?? "Main category"}
                                </Link>
                              </>
                            ) : null}
                            {template.sub_category_id ? (
                              <>
                                <span>/</span>
                                <Link
                                  href={templatesHref(params, {
                                    brand: template.brand_id,
                                    main: template.main_category_id,
                                    sub: template.sub_category_id,
                                    template: null,
                                    editTemplate: null,
                                    addTemplate: null,
                                  })}
                                  className="transition hover:text-zinc-700"
                                >
                                  {categoryMap.get(template.sub_category_id) ?? "Sub category"}
                                </Link>
                              </>
                            ) : null}
                            <span>/</span>
                            <span className="font-semibold text-zinc-950">{template.template_name}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-start gap-3">
                            <h2 className="text-2xl font-semibold text-zinc-950">
                              {template.template_name}
                            </h2>
                            <TemplateLifecycleBadge status={templateLifecycleById.get(template.id) ?? "active"} />
                          </div>
                          <p className="mt-2 text-sm text-zinc-500">
                            {brandMap.get(template.brand_id) ?? "Unknown brand"}
                            {template.main_category_id
                              ? ` / ${categoryMap.get(template.main_category_id) ?? "Main category"}`
                              : ""}
                            {template.sub_category_id
                              ? ` / ${categoryMap.get(template.sub_category_id) ?? "Sub category"}`
                              : ""}
                          </p>
                          <p className="mt-2 text-sm text-zinc-500">
                            {template.item_code ? `${template.item_code} / ` : ""}
                            {template.description ?? "No description yet."}
                          </p>
                        </div>
                        <TemplateDetailHeaderActions
                          editHref={templateEditHref}
                          template={template}
                        />
                      </div>
                    </div>

                    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
                      <div className="min-w-0 space-y-5">
                        <section>
                          <TemplateDetailImageGallery
                            templateId={template.id}
                            visibleSlots={visibleImageSlots}
                          />
                        </section>
                      </div>
                      <aside className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
                        <p className="text-xs font-semibold uppercase text-zinc-500">
                          Default U.Price
                        </p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {formatMoney(template.currency, template.default_unit_price)}
                        </p>
                        <PriceCheckStatus
                          actorNameById={actorNameById}
                          brandName={brandMap.get(template.brand_id)}
                          latestBrandUpdate={latestPriceListUpdateByBrand.get(template.brand_id)}
                          template={template}
                        />
                        <form action={markTemplatePriceChecked} className="mt-3">
                          <input type="hidden" name="id" value={template.id} />
                          <input type="hidden" name="price_check_note" value="" />
                          <input type="hidden" name="return_to" value={withHash(templateBaseReturnTo, `template-${template.id}`)} />
                          <PendingSubmitButton
                            className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
                            pendingLabel="Marking checked..."
                          >
                            Mark checked now
                          </PendingSubmitButton>
                        </form>
                        <details
                          className="mt-3"
                          id={`template-${template.id}-source-price`}
                          data-state-key={`template-source-price-${template.id}`}
                        >
                          <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                            Update source price
                          </summary>
                          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                            <ProductTemplatePriceUpdateForm
                              priceListUpdates={templateBrandPriceListUpdates}
                              returnTo={withHash(templateBaseReturnTo, `template-${template.id}-source-price`)}
                              template={template}
                            />
                          </div>
                        </details>
                        {templatePriceHistoryRows.length ? (
                          <div className="mt-4 border-t border-zinc-200 pt-3">
                            <p className="text-xs font-semibold uppercase text-zinc-500">Recent price history</p>
                            <div className="mt-2 grid gap-1.5">
                              {templatePriceHistoryRows.slice(0, 3).map((history) => {
                                const priceListUpdate = history.brand_price_list_update_id
                                  ? priceListUpdateById.get(history.brand_price_list_update_id)
                                  : null;

                                return (
                                  <p key={history.id} className="text-xs leading-5 text-zinc-500">
                                    {formatShortDate(history.changed_at)} - {actorDisplayName(actorNameById, history.changed_by)} updated source price {formatMoney(history.currency ?? template.currency, Number(history.old_default_unit_price ?? 0))} {"->"} {formatMoney(history.currency ?? template.currency, Number(history.new_default_unit_price ?? 0))}
                                    {priceListUpdate ? ` - ${priceListUpdate.title}` : ""}
                                  </p>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {templateAuditRows.length ? (
                          <div className="mt-4 border-t border-zinc-200 pt-3">
                            <p className="text-xs font-semibold uppercase text-zinc-500">Recent activity</p>
                            <div className="mt-2 grid gap-1.5">
                              {templateAuditRows.slice(0, 4).map((entry) => (
                                <p key={entry.id} className="text-xs leading-5 text-zinc-500">
                                  {formatShortDate(entry.created_at)} - {actorDisplayName(actorNameById, entry.created_by, entry.metadata)} - {entry.title}
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </aside>
                    </div>

                    <details
                      className="mt-5"
                      data-state-key={`template-edit-${template.id}`}
                      open={editTemplateId === template.id}
                    >
                      <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                        Edit template details
                      </summary>
                      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                        <TemplateForm
                          brands={brandList}
                          categories={categoryList}
                          defaultBrandId={selectedBrandFilter}
                          defaultMainCategoryId={selectedMainFilter}
                          defaultSubCategoryId={selectedSubFilter}
                          returnTo={withHash(
                            templatesHref(params, {
                              template: template.id,
                              editTemplate: template.id,
                              addTemplate: null,
                            }),
                            `template-${template.id}`,
                          )}
                          template={template}
                        />
                      </div>
                    </details>
                  </div>

                  {(activeTemplateComponents.length ||
                    template.desking_size_pricing?.length ||
                    template.variant_pricing?.length ||
                    template.category_pricing?.length ||
                    template.accessory_pricing?.length ||
                    templateDetailPriceHistoryRows.length) ? (
                    <div className="border-t border-zinc-200 p-5">
                      <details
                        id={`template-${template.id}-price-updates`}
                        data-state-key={`template-detail-prices-${template.id}`}
                      >
                        <summary className="cursor-pointer list-none rounded-lg border border-zinc-200 bg-zinc-50 p-4 transition hover:border-emerald-900">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="text-sm font-semibold uppercase text-zinc-500">
                                Detailed Price Updates
                              </h3>
                              <p className="mt-1 text-sm leading-6 text-zinc-500">
                                Manual source price changes for components, options, and pricing rows. Future quotations use these source values.
                              </p>
                            </div>
                            <span className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700">
                              Show Price Rows
                            </span>
                          </div>
                        </summary>
                        <div className="mt-4 space-y-5">
                          {activeTemplateComponents.length ? (
                            <section>
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Components / Options</h4>
                              <div className="mt-2 grid gap-3">
                                {activeTemplateComponents.map((component) => (
                                  <DetailPriceRow
                                    key={component.id}
                                    form={
                                      <DetailPriceUpdateForm
                                        currency={component.currency}
                                        label={component.component_name}
                                        priceField="unit_price"
                                        priceListUpdates={templateBrandPriceListUpdates}
                                        productTemplateId={template.id}
                                        returnTo={templatePriceUpdatesReturnTo}
                                        sourceRecordId={component.id}
                                        sourceTable="product_components"
                                        value={component.unit_price}
                                      />
                                    }
                                  >
                                    <p className="font-semibold text-zinc-950">{component.component_name}</p>
                                    <p className="mt-1 text-xs">
                                      {component.component_group} / {optionTypeLabels.get(component.option_type) ?? "Other"} / {formatMoney(component.currency, component.unit_price)}
                                    </p>
                                  </DetailPriceRow>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          {template.desking_size_pricing?.length ? (
                            <section>
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Workstation Size / Base Price</h4>
                              <div className="mt-2 grid gap-3">
                                {template.desking_size_pricing.filter((row) => row.is_active !== false).map((row, index) => (
                                  <DetailPriceRow
                                    key={row.id ?? `desking-${index}`}
                                    form={
                                      <div className="grid gap-2">
                                        <DetailPriceUpdateForm
                                          currency={row.currency}
                                          label="Default price"
                                          priceField="default_price"
                                          priceListUpdates={templateBrandPriceListUpdates}
                                          productTemplateId={template.id}
                                          returnTo={templatePriceUpdatesReturnTo}
                                          sourceRecordId={row.id}
                                          sourceTable="product_templates.desking_size_pricing"
                                          value={Number(row.default_price ?? 0)}
                                        />
                                        <DetailPriceUpdateForm
                                          currency={row.currency}
                                          label="Additional price"
                                          priceField="additional_price"
                                          priceListUpdates={templateBrandPriceListUpdates}
                                          productTemplateId={template.id}
                                          returnTo={templatePriceUpdatesReturnTo}
                                          sourceRecordId={row.id}
                                          sourceTable="product_templates.desking_size_pricing"
                                          value={Number(row.additional_price ?? 0)}
                                        />
                                      </div>
                                    }
                                  >
                                    <p className="font-semibold text-zinc-950">{row.label || `${row.length ?? ""} x ${row.depth ?? ""} x ${row.height ?? ""}`}</p>
                                    <p className="mt-1 text-xs">
                                      Default {formatMoney(row.currency, Number(row.default_price ?? 0))} / Additional {formatMoney(row.currency, Number(row.additional_price ?? 0))}
                                    </p>
                                  </DetailPriceRow>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          {template.variant_pricing?.length ? (
                            <section>
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Base Size / Main Price</h4>
                              <div className="mt-2 grid gap-3">
                                {template.variant_pricing.filter((row) => row.is_active !== false).map((row, index) => (
                                  <DetailPriceRow
                                    key={row.id ?? `variant-${index}`}
                                    form={
                                      <DetailPriceUpdateForm
                                        currency={row.currency}
                                        label={row.variant_name || "Variant price"}
                                        priceField="price"
                                        priceListUpdates={templateBrandPriceListUpdates}
                                        productTemplateId={template.id}
                                        returnTo={templatePriceUpdatesReturnTo}
                                        sourceRecordId={row.id}
                                        sourceTable="product_templates.variant_pricing"
                                        value={Number(row.price ?? 0)}
                                      />
                                    }
                                  >
                                    <p className="font-semibold text-zinc-950">{row.variant_name || "Variant"}</p>
                                    <p className="mt-1 text-xs">
                                      {row.dimension || "No dimension"} / {formatMoney(row.currency, Number(row.price ?? 0))}
                                    </p>
                                  </DetailPriceRow>
                                ))}
                              </div>
                            </section>
                          ) : null}

                          {template.category_pricing?.length ? (
                            <section>
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Fabric / Leather / Finish Category Pricing</h4>
                              <div className="mt-2 grid gap-3">
                                {template.category_pricing
                                  .filter((row) => row.is_active !== false)
                                  .map((row, index) => (
                                    <DetailPriceRow
                                      key={row.id ?? `category-${index}`}
                                      form={
                                        <div className="grid gap-2">
                                          {categoryPricingColumns(template.category_pricing).map((category) => (
                                            <DetailPriceUpdateForm
                                              key={category}
                                              currency={row.currency}
                                              label={category}
                                              priceField={`prices.${category}`}
                                              priceListUpdates={templateBrandPriceListUpdates}
                                              productTemplateId={template.id}
                                              returnTo={templatePriceUpdatesReturnTo}
                                              sourceRecordId={row.id}
                                              sourceTable="product_templates.category_pricing"
                                              value={Number(row.prices?.[category] ?? 0)}
                                            />
                                          ))}
                                        </div>
                                      }
                                    >
                                      <p className="font-semibold text-zinc-950">{row.variant_name || "Category row"}</p>
                                      <p className="mt-1 text-xs">{row.dimension || "No dimension"}</p>
                                    </DetailPriceRow>
                                  ))}
                              </div>
                            </section>
                          ) : null}

                          {template.accessory_pricing?.length ? (
                            <section>
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Accessories / Optional Items</h4>
                              <div className="mt-2 grid gap-3">
                                {template.accessory_pricing
                                  .filter((group) => group.is_active !== false)
                                  .flatMap((group, groupIndex) =>
                                    (group.items ?? []).filter((item) => item.is_active !== false).map((item, itemIndex) => (
                                      <DetailPriceRow
                                        key={item.id ?? `accessory-${groupIndex}-${itemIndex}`}
                                        form={
                                          <DetailPriceUpdateForm
                                            currency={item.currency}
                                            label={item.item_name || "Add-on"}
                                            priceField="price"
                                            priceListUpdates={templateBrandPriceListUpdates}
                                            productTemplateId={template.id}
                                            returnTo={templatePriceUpdatesReturnTo}
                                            sourceRecordId={item.id}
                                            sourceTable="product_templates.accessory_pricing"
                                            value={Number(item.price ?? 0)}
                                          />
                                        }
                                      >
                                        <p className="font-semibold text-zinc-950">{item.item_name || "Add-on"}</p>
                                        <p className="mt-1 text-xs">
                                          {group.group_name || "Accessories"} / {formatMoney(item.currency, Number(item.price ?? 0))}
                                        </p>
                                      </DetailPriceRow>
                                    )),
                                  )}
                              </div>
                            </section>
                          ) : null}

                          {templateDetailPriceHistoryRows.length ? (
                            <section className="border-t border-zinc-200 pt-4">
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Recent Detail Price History</h4>
                              <div className="mt-2 grid gap-1.5">
                                {templateDetailPriceHistoryRows.slice(0, 5).map((history) => {
                                  const priceListUpdate = history.brand_price_list_update_id
                                    ? priceListUpdateById.get(history.brand_price_list_update_id)
                                    : null;
                                  const sourceLabel = history.source_table.replace("product_templates.", "").replaceAll("_", " ");

                                  return (
                                    <p key={history.id} className="text-xs leading-5 text-zinc-500">
                                      {formatShortDate(history.changed_at)} - {actorDisplayName(actorNameById, history.changed_by)} updated {sourceLabel} {history.price_field} {formatMoney(history.currency ?? template.currency, Number(history.old_price ?? 0))} {"->"} {formatMoney(history.currency ?? template.currency, history.new_price)}
                                      {priceListUpdate ? ` - ${priceListUpdate.title}` : ""}
                                    </p>
                                  );
                                })}
                              </div>
                            </section>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  ) : null}

                  <div className="border-t border-zinc-200 p-5">
                    <div
                      id={`template-${template.id}-materials`}
                      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div>
                        <h3 className="text-sm font-semibold uppercase text-zinc-500">
                          Material Groups / Finish Options
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-zinc-500">
                          Link brand finish groups allowed for this template. Finish selection in quotations comes later.
                        </p>
                      </div>
                      <details
                        className="shrink-0"
                        data-state-key={`template-material-group-create-${template.id}`}
                      >
                          <summary className="cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                            + Link Material Group
                          </summary>
                        <div className="mt-3 w-[min(960px,calc(100vw-4rem))] rounded-lg border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
                          <TemplateMaterialGroupForm
                            materials={materialList}
                            materialGroups={materialGroupList}
                            returnTo={templateMaterialsReturnTo}
                            template={template}
                          />
                        </div>
                      </details>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {(materialGroupsByTemplate.get(template.id) ?? []).map((link) => {
                        const materialGroup = materialGroupList.find(
                          (candidate) => candidate.id === link.material_group_id,
                        );
                        const selectedCount = materialGroupItemsByLink.get(link.id)?.length ?? 0;
                        const modeLabel = link.selection_mode === "selected_items"
                          ? `Selected finishes only · ${selectedCount} selected`
                          : "Full group";
                        const selectionCountLabel = "Multiple selection";

                        return (
                          <div
                            key={link.id}
                            id={`material-link-${link.id}`}
                            className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-zinc-950">
                                  {link.label_override || materialGroup?.group_name || "Material group"}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold uppercase">
                                  <span className="rounded border border-zinc-200 bg-white px-2 py-1 text-zinc-600">
                                    {selectionCountLabel}
                                  </span>
                                  <span className="rounded border border-zinc-200 bg-white px-2 py-1 text-zinc-500">
                                    {modeLabel}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">
                                  {link.is_required ? "Required" : "Optional"}. {link.show_in_specification ? "Shows in specification" : "Hidden from specification"}. {link.show_in_quotation ? "Shows in quotation" : "Hidden from quotation"}.
                                </p>
                              </div>
                              <DeactivateTemplateMaterialGroupForm
                                id={link.id}
                                returnTo={withHash(templateBaseReturnTo, `material-link-${link.id}`)}
                              />
                            </div>
                            <details
                              id={`template-${template.id}-material-link-${link.id}`}
                              className="mt-3"
                              data-state-key={`template-material-group-edit-${link.id}`}
                            >
                              <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                Edit settings
                              </summary>
                              <div className="mt-3">
                                <TemplateMaterialGroupForm
                                  link={link}
                                  linkedItemIds={new Set((materialGroupItemsByLink.get(link.id) ?? []).map((item) => item.brand_material_id))}
                                  materials={materialList}
                                  materialGroups={materialGroupList}
                                  returnTo={withHash(templateBaseReturnTo, `material-link-${link.id}`)}
                                  template={template}
                                />
                              </div>
                            </details>
                          </div>
                        );
                      })}
                      {!(materialGroupsByTemplate.get(template.id) ?? []).length ? (
                        <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                          No linked material groups yet.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="border-t border-zinc-200 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold uppercase text-zinc-500">
                          Linked Product Families / Screens & Add-ons
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-zinc-500">
                          Connect reusable product families such as screens, pedestals, cable trays, and power modules. These can be selected manually when adding this product to a quotation.
                        </p>
                      </div>
                      <details
                        className="shrink-0"
                        data-state-key={`template-linked-family-create-${template.id}`}
                      >
                         <summary className="cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                           + Link Product Family
                         </summary>
                        <div className="mt-3 w-[min(960px,calc(100vw-4rem))] rounded-lg border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
                          <LinkedProductFamilyForm
                            templateId={template.id}
                            templates={activeTemplateList}
                          />
                        </div>
                      </details>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {(linkedFamiliesByTemplate.get(template.id) ?? []).map((link) => {
                        const linkedTemplate = activeTemplateList.find(
                          (candidate) => candidate.id === link.linked_template_id,
                        );

                        return (
                          <div key={link.id} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-zinc-950">
                                  {link.label || "Linked family"} &rarr; {linkedTemplate?.template_name ?? "Unknown template"}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-zinc-500">
                                  Default qty {link.default_qty}. {link.add_to_parent_price ? "Adds price" : "Price not added"}. {link.append_to_specification ? "Appends specification" : "Specification not appended"}.
                                </p>
                              </div>
                              <DeactivateLinkedProductFamilyForm id={link.id} />
                            </div>
                            <details
                              className="mt-3"
                              data-state-key={`template-linked-family-edit-${link.id}`}
                            >
                              <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                Edit link
                              </summary>
                              <div className="mt-3">
                                <LinkedProductFamilyForm
                                  link={link}
                                  templateId={template.id}
                                  templates={activeTemplateList}
                                />
                              </div>
                            </details>
                          </div>
                        );
                      })}
                      {!(linkedFamiliesByTemplate.get(template.id) ?? []).length ? (
                        <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                          No linked product families yet.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {activeTemplateComponents.length ? (
                  <div className="border-t border-zinc-200 p-5">
                    <details>
                      <summary className="cursor-pointer list-none rounded-lg border border-zinc-200 bg-zinc-50 p-4 transition hover:border-emerald-900">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-sm font-semibold uppercase text-zinc-500">
                              Legacy Advanced Options
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-zinc-500">
                              Existing legacy options are kept for compatibility. Use only for rare custom logic, not normal accessories or price rows.
                            </p>
                          </div>
                          <span className="rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white">
                            Show Advanced Options
                          </span>
                        </div>
                      </summary>
                      <div className="mt-4 border-t border-zinc-200 pt-4">
                        <details className="mb-4">
                          <summary className="inline-flex cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                            + Add Advanced Option
                          </summary>
                          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
                            <ComponentForm templateId={template.id} />
                          </div>
                        </details>
                        <div className="space-y-4">
                          {Array.from(groups.entries()).map(([groupKey, group]) => {
                          const [optionType, groupName] = groupKey.split(":");

                          return (
                          <div
                            key={groupKey}
                            className="rounded-lg border border-zinc-200 bg-white p-4"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-semibold text-zinc-950">
                                  {groupName}
                                </h4>
                                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-500">
                                  {optionTypeLabels.get(optionType) ?? "Other"}
                                </span>
                              </div>
                              <DeactivateGroupForm
                                componentGroup={groupName}
                                optionType={optionType}
                                templateId={template.id}
                              />
                            </div>
                            <div className="mt-3 grid gap-3 lg:grid-cols-2">
                              {group.map((component) => (
                                <div
                                  key={component.id}
                                  className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                                >
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-zinc-950">
                                          {component.component_name}
                                        </p>
                                        <StatusBadge active={component.is_active} />
                                        <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-semibold text-zinc-500">
                                          {optionTypeLabels.get(component.option_type) ??
                                            "Other"}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm text-zinc-500">
                                        {component.component_code
                                          ? `${component.component_code} / `
                                          : ""}
                                        Qty {component.qty} {component.unit_label}
                                        {" / "}
                                        {formatMoney(component.currency, component.unit_price)}
                                      </p>
                                      <p className="mt-1 text-xs text-zinc-500">
                                        Price checked:{" "}
                                        {formatDate(component.last_price_checked_at)}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      <form action={markComponentPriceChecked}>
                                        <input
                                          type="hidden"
                                          name="id"
                                          value={component.id}
                                        />
                                        <PendingSubmitButton
                                          className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
                                          pendingLabel="Marking checked..."
                                        >
                                          Mark checked
                                        </PendingSubmitButton>
                                      </form>
                                      <DeactivateOptionForm id={component.id} />
                                    </div>
                                  </div>
                                  <details className="mt-3">
                                    <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                                      Edit option
                                    </summary>
                                    <div className="mt-3">
                                      <ComponentForm
                                        templateId={template.id}
                                        component={component}
                                      />
                                    </div>
                                  </details>
                                </div>
                              ))}
                            </div>
                          </div>
                          );
                        })}
                          {!activeTemplateComponents.length ? (
                            <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                              No active advanced options yet.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  </div>
                  ) : null}
                </article>
              );
            })}

            {selectedCategory && !selectedTemplate && selectedCategoryTemplates.length ? (
              <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                Open a product template to manage its images, pricing tables,
                linked product families, and advanced options.
              </section>
            ) : null}

            {!activeTemplateList.length ? (
              <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                No product templates yet. Add the first template from the toolbar.
              </section>
            ) : null}

            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 p-4">
                <h2 className="font-semibold text-zinc-950">Archive</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Archived products are hidden from active library. Unused archived records can be permanently deleted.
                </p>
              </div>
              <div className="divide-y divide-zinc-100">
                {archivedTemplateList.map((template) => {
                  const isUsedInQuotations = usedTemplateIds.has(template.id);
                  const isLinked = linkedTemplateIds.has(template.id);
                  const deleteBlocked = isUsedInQuotations || isLinked;
                  const deleteBlockedLabel = isUsedInQuotations
                    ? "Used in quotations - cannot delete"
                    : "Linked to product families - cannot delete";

                  return (
                    <div
                      key={template.id}
                      className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-zinc-950">
                            {template.template_name}
                          </h3>
                          <TemplateLifecycleBadge status="archived" />
                        </div>
                        <p className="mt-1 text-sm text-zinc-500">
                          {brandMap.get(template.brand_id) ?? "Unknown brand"} / {template.template_code ?? "No template code"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Keep archived to preserve quotation history.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <form action={restoreProductTemplate}>
                          <input type="hidden" name="id" value={template.id} />
                          <PendingSubmitButton
                            className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                            pendingLabel="Restoring..."
                          >
                            Restore
                          </PendingSubmitButton>
                        </form>
                        {deleteBlocked ? (
                          <span className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-500">
                            {deleteBlockedLabel}
                          </span>
                        ) : (
                          <form action={permanentlyDeleteProductTemplate}>
                            <input type="hidden" name="id" value={template.id} />
                            <ConfirmSubmitButton
                              message="Permanently delete this product template? This cannot be undone."
                              className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                            >
                              Delete permanently
                            </ConfirmSubmitButton>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!archivedTemplateList.length ? (
                  <p className="p-6 text-sm text-zinc-500">
                    No archived product templates.
                  </p>
                ) : null}
              </div>
              <div className="border-t border-zinc-200">
                <details>
                  <summary className="cursor-pointer px-4 py-4 font-semibold text-zinc-950">
                    Discontinued Products
                  </summary>
                  <div className="border-t border-zinc-200">
                    <div className="p-4">
                      <p className="text-sm text-zinc-500">
                        Discontinued products are hidden from new quotations but preserved for old quotation history.
                      </p>
                    </div>
                    <div className="divide-y divide-zinc-100">
                      {discontinuedTemplateList.map((template) => {
                        const isUsedInQuotations = usedTemplateIds.has(template.id);
                        const isLinked = linkedTemplateIds.has(template.id);
                        const deleteBlocked = isUsedInQuotations || isLinked;
                        const deleteBlockedLabel = isUsedInQuotations
                          ? "Used in quotations - cannot delete"
                          : "Linked to product families - cannot delete";

                        return (
                          <div
                            key={template.id}
                            className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-zinc-950">
                                  {template.template_name}
                                </h3>
                                <TemplateLifecycleBadge status="discontinued" />
                              </div>
                              <p className="mt-1 text-sm text-zinc-500">
                                {brandMap.get(template.brand_id) ?? "Unknown brand"} / {template.template_code ?? "No template code"}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 md:justify-end">
                              <form action={restoreProductTemplate}>
                                <input type="hidden" name="id" value={template.id} />
                                <PendingSubmitButton
                                  className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                                  pendingLabel="Restoring..."
                                >
                                  Reactivate
                                </PendingSubmitButton>
                              </form>
                              <form action={archiveProductTemplate}>
                                <input type="hidden" name="id" value={template.id} />
                                <PendingSubmitButton
                                  className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                                  pendingLabel="Archiving..."
                                >
                                  Move to Archive
                                </PendingSubmitButton>
                              </form>
                              {deleteBlocked ? (
                                <span className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-xs font-semibold text-zinc-500">
                                  {deleteBlockedLabel}
                                </span>
                              ) : (
                                <form action={permanentlyDeleteProductTemplate}>
                                  <input type="hidden" name="id" value={template.id} />
                                  <ConfirmSubmitButton
                                    message="Permanently delete this discontinued product template? This cannot be undone."
                                    className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                                  >
                                    Delete permanently
                                  </ConfirmSubmitButton>
                                </form>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {!discontinuedTemplateList.length ? (
                        <p className="p-6 text-sm text-zinc-500">
                          No discontinued product templates.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </details>
              </div>
              <div className="border-t border-zinc-200 p-4">
                <h3 className="font-semibold text-zinc-950">Archived Linked Families</h3>
              </div>
              <div className="divide-y divide-zinc-100">
                {archivedLinkedFamilyList.map((link) => {
                  const parentTemplate = templateList.find(
                    (template) => template.id === link.parent_template_id,
                  );
                  const linkedTemplate = templateList.find(
                    (template) => template.id === link.linked_template_id,
                  );

                  return (
                    <div
                      key={link.id}
                      className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div>
                        <h3 className="font-semibold text-zinc-950">
                          {link.label || "Linked family"}
                        </h3>
                        <p className="mt-1 text-sm text-zinc-500">
                          {parentTemplate?.template_name ?? "Unknown parent"} / {linkedTemplate?.template_name ?? "Unknown linked template"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        <form action={restoreLinkedProductFamily}>
                          <input type="hidden" name="id" value={link.id} />
                          <button
                            type="submit"
                            className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            Restore
                          </button>
                        </form>
                        <form action={permanentlyDeleteLinkedProductFamily}>
                          <input type="hidden" name="id" value={link.id} />
                          <ConfirmSubmitButton
                            message="Permanently delete this linked product family? This cannot be undone."
                            className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                          >
                            Delete permanently
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    </div>
                  );
                })}
                {!archivedLinkedFamilyList.length ? (
                  <p className="p-6 text-sm text-zinc-500">
                    No archived linked product families.
                  </p>
                ) : null}
              </div>
            </section>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
