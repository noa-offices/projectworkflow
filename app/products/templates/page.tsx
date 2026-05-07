import Link from "next/link";
import { randomUUID } from "crypto";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  DeskingSizePricingTable,
  type DeskingSizePricingRow,
} from "@/components/products/desking-size-pricing-table";
import {
  DeactivateGroupForm,
  DeactivateOptionForm,
} from "@/components/products/option-deactivate-controls";
import {
  type AccessoryPricingRow,
  CategoryPricingTable,
  type CategoryPricingRow,
  VariantPricingTable,
  type VariantPricingRow,
} from "@/components/products/variant-pricing-tables";
import { ProductTemplateImageUploader } from "@/components/products/product-template-image-uploader";
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
  createBrandPriceListUpdate,
  createMainCategoryFromTemplates,
  createProductTemplateMaterialGroup,
  createProductTemplate,
  createSubCategoryFromTemplates,
  deactivateLinkedProductFamily,
  deactivateProductTemplateMaterialGroup,
  deactivateProductTemplate,
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
  desking_size_pricing: DeskingSizePricingRow[] | null;
  variant_pricing: VariantPricingRow[] | null;
  category_pricing: CategoryPricingRow[] | null;
  accessory_pricing: AccessoryPricingRow[] | null;
  image_settings: {
    default_image_url?: {
      fit?: "contain" | "cover";
      zoom?: number;
      positionX?: number;
      positionY?: number;
    };
    proposed_image_url_1?: {
      fit?: "contain" | "cover";
      zoom?: number;
      positionX?: number;
      positionY?: number;
    };
    proposed_image_url_2?: {
      fit?: "contain" | "cover";
      zoom?: number;
      positionX?: number;
      positionY?: number;
    };
    proposed_image_url_3?: {
      fit?: "contain" | "cover";
      zoom?: number;
      positionX?: number;
      positionY?: number;
    };
  } | null;
  unit_label: string;
  currency: string;
  default_unit_price: number;
  is_active: boolean;
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
] as const;

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

function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="h-10 rounded-md bg-emerald-900 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </button>
  );
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
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
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

function QuickCategoryForm({
  brandId,
  parentId,
  returnMode = "library",
  title,
}: {
  brandId: string;
  parentId?: string | null;
  returnMode?: "add-template" | "library";
  title: string;
}) {
  return (
    <form
      action={
        parentId ? createSubCategoryFromTemplates : createMainCategoryFromTemplates
      }
      className="grid gap-3 md:grid-cols-2"
    >
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="parent_id" value={parentId ?? ""} />
      <input type="hidden" name="return_mode" value={returnMode} />
      <Field name="name" label={title} required />
      <Field name="code" label="Code" />
      <TextArea name="description" label="Description" />
      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <Checkbox name="is_active" label="Active" defaultChecked />
        <SubmitButton label="Save" />
      </div>
    </form>
  );
}

function TemplateForm({
  brands,
  categories,
  defaultBrandId,
  defaultMainCategoryId,
  defaultSubCategoryId,
  template,
}: {
  brands: Brand[];
  categories: Category[];
  defaultBrandId?: string;
  defaultMainCategoryId?: string;
  defaultSubCategoryId?: string;
  template?: ProductTemplate;
}) {
  const templateId = template?.id ?? randomUUID();
  const selectedBrandId = template?.brand_id ?? defaultBrandId ?? "";
  const selectedMainCategoryId =
    template?.main_category_id ?? defaultMainCategoryId ?? "";
  const selectedSubCategoryId =
    template?.sub_category_id ?? defaultSubCategoryId ?? "";
  const mainCategoryOptions = categories.filter(
    (category) =>
      !category.parent_id &&
      (!selectedBrandId || category.brand_id === selectedBrandId),
  );
  const subCategoryOptions = categories.filter(
    (category) =>
      category.parent_id &&
      (!selectedBrandId || category.brand_id === selectedBrandId) &&
      (!selectedMainCategoryId || category.parent_id === selectedMainCategoryId),
  );
  const allowQuickCreate = !template;

  return (
    <form
      action={template ? updateProductTemplate : createProductTemplate}
      className="space-y-4"
    >
      <input type="hidden" name="id" value={templateId} />
      <FormSection title="Product Identity">
        <label className="block">
          <span className="text-xs font-semibold uppercase text-zinc-500">
            Brand
          </span>
          <select
            name="brand_id"
            defaultValue={selectedBrandId}
            required
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            <option value="">Select brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
          {!brands.length ? (
            <span className="mt-1 block text-xs text-zinc-500">
              Create a brand first.
            </span>
          ) : null}
        </label>
        <div className="space-y-2">
          <CategorySelect
            name="main_category_id"
            label="Main Category"
            categories={mainCategoryOptions}
            defaultValue={selectedMainCategoryId}
          />
          {allowQuickCreate && selectedBrandId ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                + New Main Category
              </summary>
              <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <QuickCategoryForm
                  brandId={selectedBrandId}
                  returnMode="add-template"
                  title="Category Name"
                />
              </div>
            </details>
          ) : allowQuickCreate ? (
            <p className="text-xs text-zinc-500">
              Select a brand in the toolbar to quick-create a main category.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <CategorySelect
            name="sub_category_id"
            label="Sub Category"
            categories={subCategoryOptions}
            defaultValue={selectedSubCategoryId}
          />
          {allowQuickCreate && selectedBrandId && selectedMainCategoryId ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                + New Sub Category
              </summary>
              <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <QuickCategoryForm
                  brandId={selectedBrandId}
                  parentId={selectedMainCategoryId}
                  returnMode="add-template"
                  title="Sub Category Name"
                />
              </div>
            </details>
          ) : allowQuickCreate ? (
            <p className="text-xs text-zinc-500">
              Select a main category in the toolbar to quick-create a
              subcategory.
            </p>
          ) : null}
        </div>
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
      </FormSection>

      <FormSection title="Quotation Row Defaults">
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
      </FormSection>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <FormSection title="Pricing">
          <Field
            name="unit_label"
            label="Unit"
            defaultValue={template?.unit_label ?? "Pc"}
          />
          <CurrencySelect defaultValue={template?.currency} />
          <Field
            name="default_unit_price"
            label="Default U.Price"
            type="number"
            defaultValue={template?.default_unit_price ?? 0}
          />
          <div className="flex items-end">
            <Checkbox
              name="is_active"
              label="Active"
              defaultChecked={template?.is_active ?? true}
            />
          </div>
        </FormSection>

        <FormSection title="Proposed Item Reference Images">
          <input
            type="hidden"
            name="reference_image_url"
            defaultValue={template?.reference_image_url ?? ""}
          />
          <div className="md:col-span-2 xl:col-span-3">
            <div className="grid gap-4 md:grid-cols-3">
              {proposedImageSlots.map((slot) => {
                const value =
                  template?.[slot.field] ??
                  (slot.field === "proposed_image_url_1"
                    ? template?.default_image_url
                    : null);
                const settings =
                  template?.image_settings?.[slot.field] ??
                  (slot.field === "proposed_image_url_1"
                    ? template?.image_settings?.default_image_url
                    : undefined);

                return (
                  <div key={slot.field}>
                    <input
                      type="hidden"
                      name={slot.field}
                      defaultValue={value ?? ""}
                    />
                    <input
                      type="hidden"
                      name={`image_settings_${slot.field}`}
                      defaultValue={settings ? JSON.stringify(settings) : ""}
                    />
                    <span className="text-xs font-semibold uppercase text-zinc-500">
                      {slot.label}
                    </span>
                    <div className="mt-2">
                      <ProductTemplateImageUploader
                        canEdit
                        field={slot.field}
                        formOnly={!template}
                        imageSettings={settings}
                        label={`${slot.label} proposed item reference image`}
                        templateId={templateId}
                        value={value ?? null}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </FormSection>
      </div>

      <FormSection title="Notes">
        <TextArea name="description" label="Description" defaultValue={template?.description} />
        <TextArea
          name="price_notes"
          label="Pricing / Formula Notes"
          defaultValue={template?.price_notes}
        />
      </FormSection>

      <FormSection
        title="Pricing / Variant Tables"
        description="Use these tables for product sizes, fabric/leather pricing, and workstation pricing. Linked Product Families below are for reusable screens, pedestals, cable trays, and power modules."
      >
        <input type="hidden" name="accessory_pricing" value={JSON.stringify(template?.accessory_pricing ?? [])} />
        <div className="md:col-span-2 xl:col-span-3">
          <h4 className="mb-2 text-xs font-bold uppercase text-zinc-500">
            Size / Model Variant Pricing
          </h4>
          <VariantPricingTable rows={template?.variant_pricing} />
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <h4 className="mb-2 mt-5 text-xs font-bold uppercase text-zinc-500">
            Fabric / Leather Category Pricing
          </h4>
          <CategoryPricingTable rows={template?.category_pricing} />
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <h4 className="mb-2 mt-5 text-xs font-bold uppercase text-zinc-500">
            Workstation Size Pricing
          </h4>
          <p className="mb-2 text-xs leading-5 text-zinc-500">
            Default price is the base CL2 price. Additional price is for each extra CL2.
          </p>
        <DeskingSizePricingTable rows={template?.desking_size_pricing} />
        </div>
      </FormSection>

      <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/products/templates"
          className="text-sm font-semibold text-zinc-500 transition hover:text-zinc-950"
        >
          Cancel
        </Link>
        <SubmitButton label={template ? "Save template" : "Add template"} />
      </div>
    </form>
  );
}

function CategorySelect({
  name,
  label,
  categories,
  defaultValue,
}: {
  name: string;
  label: string;
  categories: Category[];
  defaultValue?: string | null;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      >
        <option value="">None</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </label>
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
        <Checkbox name="allow_multiple" label="Allow multiple" defaultChecked={link?.allow_multiple ?? false} />
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

function BrandPriceCheckStatus({
  actorNameById,
  brand,
}: {
  actorNameById: Map<string, string>;
  brand: Brand;
}) {
  const status = brandPriceCheckState(brand);
  const className = status.tone === "ok"
    ? "inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900"
    : "inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900";

  return (
    <div className="grid gap-1">
      <span className={className}>{status.label}</span>
      <p className="text-xs text-zinc-500">
        {brand.last_price_list_checked_at
          ? `Price checked by ${actorDisplayName(actorNameById, brand.last_price_list_checked_by)} on ${formatDate(brand.last_price_list_checked_at)}`
          : status.detail}
      </p>
      {brand.price_list_check_note ? (
        <p className="line-clamp-2 text-xs text-zinc-500">{brand.price_list_check_note}</p>
      ) : null}
    </div>
  );
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
    .select("id,name,last_price_list_checked_at,last_price_list_checked_by,price_list_check_interval_days,price_list_check_note")
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
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,image_settings,unit_label,currency,default_unit_price,is_active,last_price_checked_at,last_price_checked_by,price_check_interval_days,price_check_note,price_notes",
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
  if (materialGroupsError) console.error("BRAND MATERIAL GROUPS LIST ERROR", materialGroupsError.message);
  if (materialsError) console.error("BRAND MATERIALS LIST ERROR", materialsError.message);
  if (templateMaterialGroupsError) console.error("TEMPLATE MATERIAL GROUPS LIST ERROR", templateMaterialGroupsError.message);
  if (templateMaterialGroupItemsError) console.error("TEMPLATE MATERIAL GROUP ITEMS LIST ERROR", templateMaterialGroupItemsError.message);
  if (brandPriceListUpdatesError) console.error("BRAND PRICE LIST UPDATES ERROR", brandPriceListUpdatesError.message);
  if (templatePriceHistoryError) console.error("TEMPLATE PRICE HISTORY ERROR", templatePriceHistoryError.message);
  if (templateDetailPriceHistoryError) console.error("TEMPLATE DETAIL PRICE HISTORY ERROR", templateDetailPriceHistoryError.message);
  if (auditActivityError) console.error("AUDIT ACTIVITY LOG ERROR", auditActivityError.message);

  const brandList = brands ?? [];
  const categoryList = categories ?? [];
  const templateList = templates ?? [];
  const activeTemplateList = templateList.filter((template) => template.is_active);
  const archivedTemplateList = templateList.filter((template) => !template.is_active);
  const archivedLinkedFamilyList = (linkedFamilies ?? []).filter((link) => !link.is_active);
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
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
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
                  <button
                    type="submit"
                    className="h-10 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    Apply
                  </button>
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
                  >
                    Mark visible templates checked now
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>
          </section>

          <section className="mt-6 grid gap-6 2xl:grid-cols-[360px_1fr]">
            <aside className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 p-4">
                <h2 className="font-semibold text-zinc-950">Library Structure</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {filteredTemplates.length} of {activeTemplateList.length} templates
                </p>
              </div>
              <div className="max-h-[720px] space-y-3 overflow-auto p-4">
                {brandList.map((brand) => {
                    const brandTemplates = filteredTemplates.filter(
                      (template) => template.brand_id === brand.id,
                    );
                    const activeBrandTemplates = activeTemplateList.filter(
                      (template) => template.brand_id === brand.id,
                    );
                    const brandPriceSummary = activeBrandTemplates.reduce(
                      (summary, template) => {
                        const key = priceCheckState(
                          template,
                          latestPriceListUpdateByBrand.get(template.brand_id),
                          brand.name,
                        ).key;

                        return {
                          ...summary,
                          [key]: summary[key] + 1,
                          total: summary.total + 1,
                        };
                      },
                      { checked: 0, due: 0, not_checked: 0, scheduled: 0, total: 0 },
                    );
                    const brandMainCategories = mainCategories.filter(
                      (category) => category.brand_id === brand.id,
                    );
                    const uncategorizedCount = brandTemplates.filter(
                      (template) => !template.main_category_id,
                    ).length;
                    const latestPriceListUpdate = latestPriceListUpdateByBrand.get(brand.id) ?? null;

                    return (
                      <details
                        key={brand.id}
                        open
                        className="rounded-md border border-zinc-200"
                      >
                        <summary className="cursor-pointer bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-950">
                          <span className="flex items-center justify-between gap-3">
                            <span>
                              {brand.name}{" "}
                              <span className="font-medium text-zinc-500">
                                ({brandTemplates.length})
                              </span>
                            </span>
                            <Link
                              href={templatesHref(params, {
                                brand: brand.id,
                                main: null,
                                sub: null,
                                template: null,
                                editTemplate: null,
                              })}
                              className="text-xs font-semibold text-emerald-900"
                            >
                              View
                            </Link>
                          </span>
                        </summary>
                        <div className="space-y-2 p-3">
                          <div className="rounded-md border border-zinc-200 bg-white p-3">
                            <BrandPriceCheckStatus actorNameById={actorNameById} brand={brand} />
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-600">Templates: {brandPriceSummary.total}</span>
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900">Not checked: {brandPriceSummary.not_checked}</span>
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900">Due: {brandPriceSummary.due}</span>
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-900">Scheduled: {brandPriceSummary.scheduled}</span>
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-900">Checked: {brandPriceSummary.checked}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <form action={markBrandPriceListCheckedAction}>
                                <input type="hidden" name="brand_id" value={brand.id} />
                                <button
                                  type="submit"
                                  className="rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900 transition hover:border-emerald-700"
                                >
                                  Mark brand price list checked
                                </button>
                              </form>
                              {activeBrandTemplates.length ? (
                                <form action={markBrandTemplatesPriceChecked}>
                                  <input type="hidden" name="brand_id" value={brand.id} />
                                  <ConfirmSubmitButton
                                    message={`Mark all active templates under ${brand.name} as price checked now?`}
                                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400"
                                  >
                                    Mark all templates checked
                                  </ConfirmSubmitButton>
                                </form>
                              ) : null}
                            </div>
                          </div>
                          <div className="rounded-md border border-zinc-200 bg-white p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-xs font-semibold uppercase text-zinc-500">Latest price list</p>
                                {latestPriceListUpdate ? (
                                  <div className="mt-1 text-xs leading-5 text-zinc-600">
                                    <p className="font-semibold text-zinc-950">{latestPriceListUpdate.title}</p>
                                    <p>Effective from: {formatShortDate(latestPriceListUpdate.effective_from)}</p>
                                    <p>Status: {latestPriceListUpdate.status}</p>
                                    {latestPriceListUpdate.reference_no ? <p>Ref: {latestPriceListUpdate.reference_no}</p> : null}
                                    <p>
                                      Added by {actorDisplayName(actorNameById, latestPriceListUpdate.created_by)} on {formatDate(latestPriceListUpdate.created_at)}
                                    </p>
                                    {(() => {
                                      const latestEditEntry = (auditHistoryByPriceListUpdate.get(latestPriceListUpdate.id) ?? [])
                                        .find((entry) => entry.action === "updated" || entry.action === "archived");

                                      return latestEditEntry ? (
                                        <p>
                                          Last edited by {actorDisplayName(actorNameById, latestEditEntry.created_by, latestEditEntry.metadata)} on {formatDate(latestEditEntry.created_at)}
                                        </p>
                                      ) : null;
                                    })()}
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs text-zinc-500">No price list updates recorded.</p>
                                )}
                              </div>
                              {latestPriceListUpdate && latestPriceListUpdate.status !== "archived" ? (
                                <form action={archiveBrandPriceListUpdate}>
                                  <input type="hidden" name="id" value={latestPriceListUpdate.id} />
                                  <ConfirmSubmitButton
                                    message="Archive this price list update?"
                                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:border-zinc-400"
                                  >
                                    Archive
                                  </ConfirmSubmitButton>
                                </form>
                              ) : null}
                            </div>
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                                + Add price list update
                              </summary>
                              <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                                <BrandPriceListUpdateForm brandId={brand.id} />
                              </div>
                            </details>
                            {latestPriceListUpdate ? (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs font-semibold text-zinc-600">
                                  Edit latest price list update
                                </summary>
                                <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                                  <BrandPriceListUpdateForm brandId={brand.id} update={latestPriceListUpdate} />
                                </div>
                              </details>
                            ) : null}
                          </div>
                          <details>
                            <summary className="cursor-pointer text-xs font-semibold text-emerald-900">
                              + Main Category
                            </summary>
                            <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                              <QuickCategoryForm
                                brandId={brand.id}
                                title="Category Name"
                              />
                            </div>
                          </details>
                          {brandMainCategories.map((mainCategory) => {
                            const mainTemplates = brandTemplates.filter(
                              (template) =>
                                template.main_category_id === mainCategory.id,
                            );
                            const mainSubCategories = subCategories.filter(
                              (category) =>
                                category.parent_id === mainCategory.id,
                            );
                            const withoutSubCount = mainTemplates.filter(
                              (template) => !template.sub_category_id,
                            ).length;

                            return (
                              <details key={mainCategory.id} open>
                                <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                                  <span className="flex items-center justify-between gap-3">
                                    <span>
                                      {mainCategory.name}{" "}
                                      <span className="text-zinc-500">
                                        ({mainTemplates.length})
                                      </span>
                                    </span>
                                    <Link
                                      href={templatesHref(params, {
                                        brand: brand.id,
                                        main: mainCategory.id,
                                        sub: null,
                                        template: null,
                                        editTemplate: null,
                                      })}
                                      className="text-xs font-semibold text-emerald-900"
                                    >
                                      View
                                    </Link>
                                  </span>
                                </summary>
                                <div className="mt-2 space-y-1 border-l border-zinc-200 pl-3">
                                  <details>
                                    <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold text-emerald-900">
                                      + Sub Category
                                    </summary>
                                    <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                                      <QuickCategoryForm
                                        brandId={brand.id}
                                        parentId={mainCategory.id}
                                        title="Sub Category Name"
                                      />
                                    </div>
                                  </details>
                                  {mainSubCategories.map((subCategory) => {
                                    const count = mainTemplates.filter(
                                      (template) =>
                                        template.sub_category_id ===
                                        subCategory.id,
                                    ).length;

                                    return (
                                      <Link
                                        key={subCategory.id}
                                        href={templatesHref(params, {
                                          brand: brand.id,
                                          main: mainCategory.id,
                                          sub: subCategory.id,
                                          template: null,
                                          editTemplate: null,
                                        })}
                                        className="block rounded-md px-2 py-1.5 text-sm text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-900"
                                      >
                                        {subCategory.name} ({count})
                                      </Link>
                                      );
                                  })}
                                  {!mainSubCategories.length ? (
                                    <p className="px-2 py-1.5 text-sm text-zinc-500">
                                      No subcategories yet.
                                    </p>
                                  ) : null}
                                  {withoutSubCount ? (
                                    <Link
                                      href={templatesHref(params, {
                                        brand: brand.id,
                                        main: mainCategory.id,
                                        sub: null,
                                        template: null,
                                        editTemplate: null,
                                      })}
                                      className="block rounded-md px-2 py-1.5 text-sm text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-900"
                                    >
                                      No sub category ({withoutSubCount})
                                    </Link>
                                  ) : null}
                                </div>
                              </details>
                            );
                          })}
                          {!brandMainCategories.length ? (
                            <p className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-500">
                              No main categories yet.
                            </p>
                          ) : null}
                          {uncategorizedCount ? (
                            <p className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-500">
                              No main category ({uncategorizedCount})
                            </p>
                          ) : null}
                        </div>
                      </details>
                    );
                  })}
                {!brandList.length ? (
                  <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                    No brands yet. Create a brand first.
                  </p>
                ) : null}
              </div>
            </aside>

            <div className="space-y-5">
              <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 p-4">
                  <h2 className="font-semibold text-zinc-950">
                    Product Templates
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Compact rows for the current hierarchy and filters.
                  </p>
                </div>
                <div className="divide-y divide-zinc-100">
                  {filteredTemplates.map((template) => {
                    const firstImageValue =
                      template.proposed_image_url_1 ?? template.default_image_url;
                    const firstImageSettings =
                      template.image_settings?.proposed_image_url_1 ??
                      template.image_settings?.default_image_url;
                    const path = [
                      brandMap.get(template.brand_id) ?? "Unknown brand",
                      template.main_category_id
                        ? categoryMap.get(template.main_category_id) ??
                          "Main category"
                        : "No main category",
                      template.sub_category_id
                        ? categoryMap.get(template.sub_category_id) ??
                          "Sub category"
                        : "No sub category",
                    ].join(" / ");

                    return (
                      <div
                        key={template.id}
                        className={`grid gap-4 p-4 md:grid-cols-[auto_1fr_auto] md:items-center ${
                          template.id === selectedTemplate?.id
                            ? "bg-emerald-50/60"
                            : ""
                        }`}
                      >
                        <ProductTemplateImageUploader
                          imageSettings={firstImageSettings}
                          label={template.template_name}
                          templateId={template.id}
                          value={firstImageValue}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-zinc-950">
                              {template.template_name}
                            </h3>
                            <StatusBadge active={template.is_active} />
                          </div>
                          <p className="mt-1 text-sm text-zinc-500">{path}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {template.template_code ?? "No template code"} /{" "}
                            {template.item_code ?? "No item code"} /{" "}
                            {formatMoney(
                              template.currency,
                              template.default_unit_price,
                            )}
                          </p>
                          <PriceCheckStatus
                            actorNameById={actorNameById}
                            brandName={brandMap.get(template.brand_id)}
                            latestBrandUpdate={latestPriceListUpdateByBrand.get(template.brand_id)}
                            template={template}
                          />
                        </div>
                        <div className="flex flex-wrap gap-3 md:justify-end">
                          <Link
                            href={templatesHref(params, {
                              template: template.id,
                              editTemplate: null,
                              addTemplate: null,
                            })}
                            className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                          >
                            Open
                          </Link>
                          <Link
                            href={templatesHref(params, {
                              template: template.id,
                              editTemplate: template.id,
                              addTemplate: null,
                            })}
                            className="text-sm font-semibold text-zinc-600 transition hover:text-zinc-950"
                          >
                            Edit
                          </Link>
                          <form action={markTemplatePriceChecked}>
                            <input type="hidden" name="id" value={template.id} />
                            <button
                              type="submit"
                              className="text-sm font-semibold text-zinc-600 transition hover:text-zinc-950"
                            >
                              Mark checked now
                            </button>
                          </form>
                          <form action={deactivateProductTemplate}>
                            <input type="hidden" name="id" value={template.id} />
                            <ConfirmSubmitButton
                              message="This will move the product template to Archive. You can restore it later."
                              className="text-sm font-semibold text-red-700 transition hover:text-red-800"
                            >
                              Delete
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!filteredTemplates.length ? (
                  <div className="p-8 text-center text-sm text-zinc-500">
                    <p>No product templates in this selection yet.</p>
                    <Link
                      href={templatesHref(params, { addTemplate: "1" })}
                      className="mt-3 inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                      + Add Product Template
                    </Link>
                  </div>
                ) : null}
              </section>

            {(selectedTemplate ? [selectedTemplate] : []).map((template) => {
              const templateComponents = componentsByTemplate.get(template.id) ?? [];
              const templatePriceHistoryRows = priceHistoryByTemplate.get(template.id) ?? [];
              const templateDetailPriceHistoryRows = detailPriceHistoryByTemplate.get(template.id) ?? [];
              const templateAuditRows = auditHistoryByTemplate.get(template.id) ?? [];
              const templateBrandPriceListUpdates = priceListUpdatesByBrand.get(template.brand_id) ?? [];
              const templateBaseReturnTo = templatesHref(params, { template: template.id });
              const templatePriceUpdatesReturnTo = withHash(templateBaseReturnTo, `template-${template.id}-price-updates`);
              const templateMaterialsReturnTo = withHash(templateBaseReturnTo, `template-${template.id}-materials`);
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
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
                        <div className="flex shrink-0 gap-2">
                          {proposedImageSlots.map((slot) => {
                            const value =
                              template[slot.field] ??
                              (slot.field === "proposed_image_url_1"
                                ? template.default_image_url
                                : null);
                            const settings =
                              template.image_settings?.[slot.field] ??
                              (slot.field === "proposed_image_url_1"
                                ? template.image_settings?.default_image_url
                                : undefined);

                            return (
                              <ProductTemplateImageUploader
                                key={slot.field}
                                imageSettings={settings}
                                label={slot.label}
                                templateId={template.id}
                                value={value}
                              />
                            );
                          })}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold text-zinc-950">
                            {template.template_name}
                          </h2>
                          <StatusBadge active={template.is_active} />
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
                          <p className="mt-1 text-sm text-zinc-500">
                          {template.item_code ? `${template.item_code} / ` : ""}
                          {template.description ?? "No description yet."}
                          </p>
                        </div>
                      </div>
                      <div className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm xl:w-72">
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
                          <button
                            type="submit"
                            className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
                          >
                            Mark checked now
                          </button>
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
                      </div>
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
                            <span className="rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white">
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
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Desking / Size Pricing</h4>
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
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Size / Model Variants</h4>
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
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Fabric / Leather Categories</h4>
                              <div className="mt-2 grid gap-3">
                                {template.category_pricing.filter((row) => row.is_active !== false).map((row, index) => (
                                  <DetailPriceRow
                                    key={row.id ?? `category-${index}`}
                                    form={
                                      <div className="grid gap-2">
                                        {["Cat A", "Cat B", "Cat C", "Cat D"].map((category) => (
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
                              <h4 className="text-xs font-bold uppercase text-zinc-500">Options / Add-ons</h4>
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
                        <summary className="cursor-pointer rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800">
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
                                <p className="mt-1 text-xs leading-5 text-zinc-500">
                                  {modeLabel}. {link.is_required ? "Required" : "Optional"}. {link.allow_multiple ? "Allows multiple" : "Single selection"}. {link.show_in_specification ? "Shows in specification" : "Hidden from specification"}. {link.show_in_quotation ? "Shows in quotation" : "Hidden from quotation"}.
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
                          Linked Product Families
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-zinc-500">
                          Connect reusable product families such as screens, pedestals, cable trays, and power modules. These can be selected manually when adding this product to a quotation.
                        </p>
                      </div>
                      <details
                        className="shrink-0"
                        data-state-key={`template-linked-family-create-${template.id}`}
                      >
                        <summary className="cursor-pointer rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800">
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
                          <summary className="inline-flex cursor-pointer rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800">
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
                                        <button
                                          type="submit"
                                          className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
                                        >
                                          Mark checked
                                        </button>
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

            {!selectedTemplate && activeTemplateList.length ? (
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
                  Restore archived product templates, or permanently delete unused templates.
                </p>
              </div>
              <div className="divide-y divide-zinc-100">
                {archivedTemplateList.map((template) => (
                  <div
                    key={template.id}
                    className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div>
                      <h3 className="font-semibold text-zinc-950">
                        {template.template_name}
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        {brandMap.get(template.brand_id) ?? "Unknown brand"} / {template.template_code ?? "No template code"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <form action={restoreProductTemplate}>
                        <input type="hidden" name="id" value={template.id} />
                        <button
                          type="submit"
                          className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                        >
                          Restore
                        </button>
                      </form>
                      <form action={permanentlyDeleteProductTemplate}>
                        <input type="hidden" name="id" value={template.id} />
                        <ConfirmSubmitButton
                          message="Permanently delete this product template? This cannot be undone."
                          className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                        >
                          Delete permanently
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  </div>
                ))}
                {!archivedTemplateList.length ? (
                  <p className="p-6 text-sm text-zinc-500">
                    No archived product templates.
                  </p>
                ) : null}
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
