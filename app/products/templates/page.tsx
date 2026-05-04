import Link from "next/link";
import { randomUUID } from "crypto";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  DeskingSizePricingTable,
  type DeskingSizePricingRow,
} from "@/components/products/desking-size-pricing-table";
import {
  DeactivateGroupForm,
  DeactivateOptionForm,
} from "@/components/products/option-deactivate-controls";
import { ProductTemplateImageUploader } from "@/components/products/product-template-image-uploader";
import { TopBar } from "@/components/top-bar";
import { requireSettingsManager } from "@/lib/auth";
import { defaultCurrency, formatMoney, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { createClient } from "@/lib/supabase/server";
import {
  createProductComponent,
  createProductTemplate,
  markComponentPriceChecked,
  markTemplatePriceChecked,
  updateProductComponent,
  updateProductTemplate,
} from "./actions";

export const dynamic = "force-dynamic";

type TemplatesPageProps = {
  searchParams?: Promise<{ message?: string }>;
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

const optionTypes = [
  { value: "material_finish", label: "Material / Finish" },
  { value: "fabric_category", label: "Fabric Category" },
  { value: "size_variant", label: "Size Variant" },
  { value: "cluster_preset", label: "Cluster Preset" },
  { value: "linked_addon", label: "Linked Add-on" },
  { value: "other", label: "Other" },
];

const optionTypeLabels = new Map(
  optionTypes.map((optionType) => [optionType.value, optionType.label]),
);

const proposedImageSlots = [
  { field: "proposed_image_url_1", label: "Image 1" },
  { field: "proposed_image_url_2", label: "Image 2" },
  { field: "proposed_image_url_3", label: "Image 3" },
] as const;

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

function TemplateForm({
  brands,
  categories,
  template,
}: {
  brands: Brand[];
  categories: Category[];
  template?: ProductTemplate;
}) {
  const templateId = template?.id ?? randomUUID();

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
            defaultValue={template?.brand_id ?? ""}
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
        </label>
        <CategorySelect
          name="main_category_id"
          label="Main Category"
          categories={categories.filter((category) => !category.parent_id)}
          defaultValue={template?.main_category_id}
        />
        <CategorySelect
          name="sub_category_id"
          label="Sub Category"
          categories={categories.filter((category) => category.parent_id)}
          defaultValue={template?.sub_category_id}
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
        title="Workstation Size Pricing"
        description="Use this for workstation/desking sizes. Default price is the base CL2 price. Additional price is for each extra CL2."
      >
        <DeskingSizePricingTable rows={template?.desking_size_pricing} />
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
        {optionTypes.map((optionType) => (
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
  const message = (await searchParams)?.message;
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name")
    .order("name", { ascending: true })
    .returns<Brand[]>();

  const { data: categories, error: categoriesError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name")
    .order("brand_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<Category[]>();

  const { data: templates, error: templatesError } = await supabase
    .from("product_templates")
    .select(
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,origin,supplier_name,default_image_url,reference_image_url,proposed_image_url_1,proposed_image_url_2,proposed_image_url_3,desking_size_pricing,image_settings,unit_label,currency,default_unit_price,is_active,last_price_checked_at,price_notes",
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

  if (brandsError) console.error("TEMPLATE BRANDS LIST ERROR", brandsError.message);
  if (categoriesError) console.error("TEMPLATE CATEGORIES LIST ERROR", categoriesError.message);
  if (templatesError) console.error("PRODUCT TEMPLATES LIST ERROR", templatesError.message);
  if (componentsError) console.error("PRODUCT COMPONENTS LIST ERROR", componentsError.message);

  const brandMap = new Map((brands ?? []).map((brand) => [brand.id, brand.name]));
  const categoryMap = new Map(
    (categories ?? []).map((category) => [category.id, category.name]),
  );
  const componentsByTemplate = new Map<string, ProductComponent[]>();

  for (const component of components ?? []) {
    const templateComponents = componentsByTemplate.get(component.template_id) ?? [];
    templateComponents.push(component);
    componentsByTemplate.set(component.template_id, templateComponents);
  }

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

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  Product template library
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Manage reusable product data that quotations copy into editable rows.
                </p>
              </div>
              <details>
                <summary className="inline-flex cursor-pointer rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800">
                  + Add Product Template
                </summary>
                <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:w-[min(980px,calc(100vw-4rem))]">
                  <TemplateForm brands={brands ?? []} categories={categories ?? []} />
                </div>
              </details>
            </div>
          </section>

          <section className="mt-6 space-y-5">
            {(templates ?? []).map((template) => {
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
                          {template.item_code ? `${template.item_code} · ` : ""}
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

                    <details className="mt-5">
                      <summary className="inline-flex cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-900 hover:text-emerald-900">
                        Edit template details
                      </summary>
                      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                        <TemplateForm
                          brands={brands ?? []}
                          categories={categories ?? []}
                          template={template}
                        />
                      </div>
                    </details>
                  </div>

                  <div className="p-5">
                    <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold uppercase text-zinc-500">
                          Template options
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-zinc-500">
                          Use Template Options for finishes, fabrics, accessories, and add-ons.
                          Workstation size/default/additional pricing is managed in Workstation Size Pricing above.
                        </p>
                      </div>
                      <details className="shrink-0">
                        <summary className="cursor-pointer rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800">
                          + Add option
                        </summary>
                        <div className="mt-3 w-[min(960px,calc(100vw-4rem))] rounded-lg border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
                          <ComponentForm templateId={template.id} />
                        </div>
                      </details>
                    </div>
                    <div>
                      <div className="mt-3 space-y-4">
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
                                          ? `${component.component_code} · `
                                          : ""}
                                        Qty {component.qty} {component.unit_label}
                                        {" · "}
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
                            No active options yet.
                          </p>
                        ) : null}
                      </div>
                    </div>

                  </div>
                </article>
              );
            })}

            {!templates?.length ? (
              <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                No product templates yet. Add the first template above.
              </section>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
