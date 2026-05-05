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
import { createClient } from "@/lib/supabase/server";
import {
  createProductComponent,
  createLinkedProductFamily,
  createMainCategoryFromTemplates,
  createProductTemplate,
  createSubCategoryFromTemplates,
  deactivateLinkedProductFamily,
  deactivateProductTemplate,
  markComponentPriceChecked,
  markTemplatePriceChecked,
  permanentlyDeleteLinkedProductFamily,
  permanentlyDeleteProductTemplate,
  restoreLinkedProductFamily,
  restoreProductTemplate,
  updateLinkedProductFamily,
  updateProductComponent,
  updateProductTemplate,
} from "./actions";

export const dynamic = "force-dynamic";

type TemplatesSearchParams = {
  message?: string | string[];
  q?: string | string[];
  brand?: string | string[];
  main?: string | string[];
  sub?: string | string[];
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

export default async function TemplatesPage({ searchParams }: TemplatesPageProps) {
  const { user, displayName } = await requireSettingsManager();
  const params = (await searchParams) ?? {};
  const message = stringParam(params.message);
  const searchQuery = stringParam(params.q).trim();
  const selectedBrandFilter = stringParam(params.brand);
  const selectedMainFilter = stringParam(params.main);
  const selectedSubFilter = stringParam(params.sub);
  const openTemplateId = stringParam(params.template);
  const showAddTemplate = stringParam(params.addTemplate) === "1";
  const editTemplateId = stringParam(params.editTemplate);
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name")
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
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,desking_size_pricing,variant_pricing,category_pricing,accessory_pricing,image_settings,unit_label,currency,default_unit_price,is_active,last_price_checked_at,price_notes",
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

  if (brandsError) console.error("TEMPLATE BRANDS LIST ERROR", brandsError.message);
  if (categoriesError) console.error("TEMPLATE CATEGORIES LIST ERROR", categoriesError.message);
  if (templatesError) console.error("PRODUCT TEMPLATES LIST ERROR", templatesError.message);
  if (componentsError) console.error("PRODUCT COMPONENTS LIST ERROR", componentsError.message);
  if (linkedFamiliesError) console.error("LINKED PRODUCT FAMILIES LIST ERROR", linkedFamiliesError.message);

  const brandList = brands ?? [];
  const categoryList = categories ?? [];
  const templateList = templates ?? [];
  const activeTemplateList = templateList.filter((template) => template.is_active);
  const archivedTemplateList = templateList.filter((template) => !template.is_active);
  const archivedLinkedFamilyList = (linkedFamilies ?? []).filter((link) => !link.is_active);
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

  const normalizedSearch = searchQuery.toLowerCase();
  const filteredTemplates = activeTemplateList.filter((template) => {
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
                className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_180px_190px_190px_auto]"
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
                    const brandMainCategories = mainCategories.filter(
                      (category) => category.brand_id === brand.id,
                    );
                    const uncategorizedCount = brandTemplates.filter(
                      (template) => !template.main_category_id,
                    ).length;

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
                        <p className="mt-1 text-zinc-500">
                          Price checked: {formatDate(template.last_price_checked_at)}
                        </p>
                        <form action={markTemplatePriceChecked} className="mt-3">
                          <input type="hidden" name="id" value={template.id} />
                          <button
                            type="submit"
                            className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700"
                          >
                            Mark checked now
                          </button>
                        </form>
                      </div>
                    </div>

                    <details className="mt-5" open={editTemplateId === template.id}>
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
                      <details className="shrink-0">
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
                            <details className="mt-3">
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
