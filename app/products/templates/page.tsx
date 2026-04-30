import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireSettingsManager } from "@/lib/auth";
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
  default_image_url: string | null;
  reference_image_url: string | null;
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
  last_price_checked_at: string | null;
  price_notes: string | null;
};

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

function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </button>
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
  return (
    <form
      action={template ? updateProductTemplate : createProductTemplate}
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
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
        label="Main category"
        categories={categories.filter((category) => !category.parent_id)}
        defaultValue={template?.main_category_id}
      />
      <CategorySelect
        name="sub_category_id"
        label="Sub category"
        categories={categories.filter((category) => category.parent_id)}
        defaultValue={template?.sub_category_id}
      />
      <Field
        name="template_name"
        label="Template name"
        defaultValue={template?.template_name}
        required
      />
      <Field
        name="template_code"
        label="Template code"
        defaultValue={template?.template_code}
      />
      <Field name="item_code" label="Item code" defaultValue={template?.item_code} />
      <Field
        name="unit_label"
        label="Unit"
        defaultValue={template?.unit_label ?? "Pc"}
      />
      <Field
        name="currency"
        label="Currency"
        defaultValue={template?.currency ?? "AED"}
      />
      <Field
        name="default_unit_price"
        label="Default unit price"
        type="number"
        defaultValue={template?.default_unit_price ?? 0}
      />
      <Field
        name="default_image_url"
        label="Default image URL"
        defaultValue={template?.default_image_url}
      />
      <Field
        name="reference_image_url"
        label="Reference image URL"
        defaultValue={template?.reference_image_url}
      />
      <div className="flex items-end">
        <Checkbox
          name="is_active"
          label="Active"
          defaultChecked={template?.is_active ?? true}
        />
      </div>
      <TextArea name="description" label="Description" defaultValue={template?.description} />
      <TextArea
        name="default_specification"
        label="Default specification"
        defaultValue={template?.default_specification}
      />
      <TextArea
        name="price_notes"
        label="Pricing notes / formula notes"
        defaultValue={template?.price_notes}
      />
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
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
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {component ? <input type="hidden" name="id" value={component.id} /> : null}
      <input type="hidden" name="template_id" value={templateId} />
      <Field
        name="component_group"
        label="Group"
        defaultValue={component?.component_group}
        required
      />
      <Field
        name="component_name"
        label="Component name"
        defaultValue={component?.component_name}
        required
      />
      <Field
        name="component_code"
        label="Code"
        defaultValue={component?.component_code}
      />
      <Field name="qty" label="Qty" type="number" defaultValue={component?.qty ?? 1} />
      <Field
        name="unit_label"
        label="Unit"
        defaultValue={component?.unit_label ?? "Pc"}
      />
      <Field
        name="unit_price"
        label="Unit price"
        type="number"
        defaultValue={component?.unit_price ?? 0}
      />
      <Field
        name="currency"
        label="Currency"
        defaultValue={component?.currency ?? "AED"}
      />
      <Field
        name="sort_order"
        label="Sort order"
        type="number"
        defaultValue={component?.sort_order ?? 0}
      />
      <div className="flex flex-wrap items-end gap-4">
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
        label="Pricing notes / formula notes"
        defaultValue={component?.price_notes}
      />
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
        <SubmitButton label={component ? "Save component" : "Add component"} />
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
      "id,brand_id,main_category_id,sub_category_id,template_code,template_name,item_code,description,default_specification,default_image_url,reference_image_url,unit_label,currency,default_unit_price,is_active,last_price_checked_at,price_notes",
    )
    .order("brand_id", { ascending: true })
    .order("template_name", { ascending: true })
    .returns<ProductTemplate[]>();

  const { data: components, error: componentsError } = await supabase
    .from("product_components")
    .select(
      "id,template_id,component_group,component_code,component_name,description,qty,unit_label,unit_price,currency,is_optional,is_default_selected,sort_order,is_active,last_price_checked_at,price_notes",
    )
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
          description="Manage reusable product templates and their price components."
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
            <h2 className="text-lg font-semibold text-zinc-950">
              Add product template
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Templates are reusable starting points; quotations will snapshot them later.
            </p>
            <div className="mt-5">
              <TemplateForm brands={brands ?? []} categories={categories ?? []} />
            </div>
          </section>

          <section className="mt-6 space-y-5">
            {(templates ?? []).map((template) => {
              const templateComponents = componentsByTemplate.get(template.id) ?? [];
              const groups = new Map<string, ProductComponent[]>();

              for (const component of templateComponents) {
                const group = groups.get(component.component_group) ?? [];
                group.push(component);
                groups.set(component.component_group, group);
              }

              return (
                <article
                  key={template.id}
                  className="rounded-lg border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="border-b border-zinc-200 p-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div>
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
                      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
                        <p className="font-semibold text-zinc-950">
                          {template.currency} {template.default_unit_price.toFixed(2)}
                        </p>
                        <p className="mt-1 text-zinc-500">
                          Price checked: {formatDate(template.last_price_checked_at)}
                        </p>
                        <form action={markTemplatePriceChecked} className="mt-3">
                          <input type="hidden" name="id" value={template.id} />
                          <button
                            type="submit"
                            className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                          >
                            Mark checked now
                          </button>
                        </form>
                      </div>
                    </div>

                    <details className="mt-5">
                      <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                        Edit template details
                      </summary>
                      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                        <TemplateForm
                          brands={brands ?? []}
                          categories={categories ?? []}
                          template={template}
                        />
                      </div>
                    </details>
                  </div>

                  <div className="grid gap-5 p-5 xl:grid-cols-[1fr_420px]">
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-zinc-500">
                        Price components
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-zinc-500">
                        Use components for base prices, optional accessories, or
                        incremental pricing. Example: Starter CL2 + Additional
                        cluster x 2 = CL6 price.
                      </p>
                      <div className="mt-3 space-y-4">
                        {Array.from(groups.entries()).map(([groupName, group]) => (
                          <div
                            key={groupName}
                            className="rounded-lg border border-zinc-200 p-4"
                          >
                            <h4 className="font-semibold text-zinc-950">
                              {groupName}
                            </h4>
                            <div className="mt-3 space-y-3">
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
                                      </div>
                                      <p className="mt-1 text-sm text-zinc-500">
                                        {component.component_code
                                          ? `${component.component_code} · `
                                          : ""}
                                        Qty {component.qty} {component.unit_label}
                                        {" · "}
                                        {component.currency}{" "}
                                        {component.unit_price.toFixed(2)}
                                      </p>
                                      <p className="mt-1 text-xs text-zinc-500">
                                        Price checked:{" "}
                                        {formatDate(component.last_price_checked_at)}
                                      </p>
                                    </div>
                                    <form action={markComponentPriceChecked}>
                                      <input
                                        type="hidden"
                                        name="id"
                                        value={component.id}
                                      />
                                      <button
                                        type="submit"
                                        className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
                                      >
                                        Mark checked
                                      </button>
                                    </form>
                                  </div>
                                  <details className="mt-3">
                                    <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                                      Edit component
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
                        ))}
                        {!templateComponents.length ? (
                          <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                            No components yet.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <aside className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                      <h3 className="text-sm font-semibold uppercase text-zinc-500">
                        Add component
                      </h3>
                      <div className="mt-4">
                        <ComponentForm templateId={template.id} />
                      </div>
                    </aside>
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
