import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireSettingsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createBrand,
  createCategory,
  updateBrand,
  updateCategory,
} from "./actions";

export const dynamic = "force-dynamic";

type BrandsPageProps = {
  searchParams?: Promise<{
    message?: string;
  }>;
};

type Brand = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  website: string | null;
  logo_url: string | null;
  is_active: boolean;
};

type ProductCategory = {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
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

function TextInput({
  name,
  label,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <input
        name={name}
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

function ActiveToggle({ defaultChecked = true }: { defaultChecked?: boolean }) {
  return (
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700">
      <input
        name="is_active"
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-zinc-300 text-emerald-900"
      />
      Active
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

function BrandForm({ brand }: { brand?: Brand }) {
  return (
    <form
      action={brand ? updateBrand : createBrand}
      className="grid gap-3 md:grid-cols-2"
    >
      {brand ? <input type="hidden" name="id" value={brand.id} /> : null}
      <TextInput
        name="name"
        label="Brand name"
        defaultValue={brand?.name}
        required
      />
      <TextInput name="code" label="Code" defaultValue={brand?.code} />
      <TextInput name="website" label="Website" defaultValue={brand?.website} />
      <TextInput
        name="logo_url"
        label="Logo URL"
        defaultValue={brand?.logo_url}
      />
      <TextArea
        name="description"
        label="Description"
        defaultValue={brand?.description}
      />
      <div className="flex items-end justify-between gap-3 md:col-span-2">
        <ActiveToggle defaultChecked={brand?.is_active ?? true} />
        <SubmitButton label={brand ? "Save brand" : "Add brand"} />
      </div>
    </form>
  );
}

function CategoryForm({
  brandId,
  parentId,
  category,
  submitLabel,
}: {
  brandId: string;
  parentId?: string | null;
  category?: ProductCategory;
  submitLabel: string;
}) {
  return (
    <form
      action={category ? updateCategory : createCategory}
      className="grid gap-3 md:grid-cols-2"
    >
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="parent_id" value={parentId ?? ""} />
      <TextInput
        name="name"
        label="Category name"
        defaultValue={category?.name}
        required
      />
      <TextInput name="code" label="Code" defaultValue={category?.code} />
      <TextInput
        name="sort_order"
        label="Sort order"
        defaultValue={String(category?.sort_order ?? 0)}
      />
      <div className="flex items-end">
        <ActiveToggle defaultChecked={category?.is_active ?? true} />
      </div>
      <TextArea
        name="description"
        label="Description"
        defaultValue={category?.description}
      />
      <div className="flex justify-end md:col-span-2">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const { user, displayName } = await requireSettingsManager();
  const message = (await searchParams)?.message;
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name,code,description,website,logo_url,is_active")
    .order("name", { ascending: true })
    .returns<Brand[]>();

  const { data: categories, error: categoriesError } = await supabase
    .from("product_categories")
    .select("id,brand_id,parent_id,name,code,description,is_active,sort_order")
    .order("brand_id", { ascending: true })
    .order("parent_id", { ascending: true, nullsFirst: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<ProductCategory[]>();

  if (brandsError) {
    console.error("BRANDS LIST ERROR", brandsError.message);
  }

  if (categoriesError) {
    console.error("CATEGORIES LIST ERROR", categoriesError.message);
  }

  const categoryList = categories ?? [];
  const mainCategoriesByBrand = new Map<string, ProductCategory[]>();
  const subCategoriesByParent = new Map<string, ProductCategory[]>();

  for (const category of categoryList) {
    if (category.parent_id) {
      const siblings = subCategoriesByParent.get(category.parent_id) ?? [];
      siblings.push(category);
      subCategoriesByParent.set(category.parent_id, siblings);
    } else {
      const siblings = mainCategoriesByBrand.get(category.brand_id) ?? [];
      siblings.push(category);
      mainCategoriesByBrand.set(category.brand_id, siblings);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Brands & Categories"
          description="Manage product brands, main categories, and sub categories."
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
            <h2 className="text-lg font-semibold text-zinc-950">Add brand</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Create the brand first, then add main categories and sub categories.
            </p>
            <div className="mt-5">
              <BrandForm />
            </div>
          </section>

          <section className="mt-6 space-y-5">
            {(brands ?? []).map((brand) => {
              const mainCategories = mainCategoriesByBrand.get(brand.id) ?? [];

              return (
                <article
                  key={brand.id}
                  className="rounded-lg border border-zinc-200 bg-white shadow-sm"
                >
                  <div className="border-b border-zinc-200 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold text-zinc-950">
                            {brand.name}
                          </h2>
                          <StatusBadge active={brand.is_active} />
                        </div>
                        <p className="mt-1 text-sm text-zinc-500">
                          {brand.code ? `${brand.code} · ` : ""}
                          {brand.description ?? "No description yet."}
                        </p>
                      </div>
                    </div>

                    <details className="mt-5">
                      <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                        Edit brand
                      </summary>
                      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                        <BrandForm brand={brand} />
                      </div>
                    </details>
                  </div>

                  <div className="grid gap-5 p-5 xl:grid-cols-[1fr_360px]">
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-zinc-500">
                        Main categories
                      </h3>
                      <div className="mt-3 space-y-4">
                        {mainCategories.map((category) => {
                          const subCategories =
                            subCategoriesByParent.get(category.id) ?? [];

                          return (
                            <div
                              key={category.id}
                              className="rounded-lg border border-zinc-200 p-4"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-semibold text-zinc-950">
                                      {category.name}
                                    </h4>
                                    <StatusBadge active={category.is_active} />
                                  </div>
                                  <p className="mt-1 text-sm text-zinc-500">
                                    {category.code ? `${category.code} · ` : ""}
                                    {category.description ??
                                      "No description yet."}
                                  </p>
                                </div>
                                <p className="text-xs font-medium text-zinc-500">
                                  Sort {category.sort_order}
                                </p>
                              </div>

                              <details className="mt-4">
                                <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                                  Edit main category
                                </summary>
                                <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                                  <CategoryForm
                                    brandId={brand.id}
                                    category={category}
                                    submitLabel="Save category"
                                  />
                                </div>
                              </details>

                              <div className="mt-4 border-l border-zinc-200 pl-4">
                                <h5 className="text-sm font-semibold text-zinc-800">
                                  Sub categories
                                </h5>
                                <div className="mt-3 space-y-3">
                                  {subCategories.map((subCategory) => (
                                    <div
                                      key={subCategory.id}
                                      className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
                                    >
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-medium text-zinc-950">
                                              {subCategory.name}
                                            </p>
                                            <StatusBadge
                                              active={subCategory.is_active}
                                            />
                                          </div>
                                          <p className="mt-1 text-sm text-zinc-500">
                                            {subCategory.code
                                              ? `${subCategory.code} · `
                                              : ""}
                                            {subCategory.description ??
                                              "No description yet."}
                                          </p>
                                        </div>
                                        <p className="text-xs font-medium text-zinc-500">
                                          Sort {subCategory.sort_order}
                                        </p>
                                      </div>
                                      <details className="mt-3">
                                        <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                                          Edit sub category
                                        </summary>
                                        <div className="mt-3">
                                          <CategoryForm
                                            brandId={brand.id}
                                            parentId={category.id}
                                            category={subCategory}
                                            submitLabel="Save sub category"
                                          />
                                        </div>
                                      </details>
                                    </div>
                                  ))}
                                  {!subCategories.length ? (
                                    <p className="text-sm text-zinc-500">
                                      No sub categories yet.
                                    </p>
                                  ) : null}
                                </div>

                                <details className="mt-4">
                                  <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                                    Add sub category
                                  </summary>
                                  <div className="mt-3 rounded-md border border-zinc-200 bg-white p-4">
                                    <CategoryForm
                                      brandId={brand.id}
                                      parentId={category.id}
                                      submitLabel="Add sub category"
                                    />
                                  </div>
                                </details>
                              </div>
                            </div>
                          );
                        })}
                        {!mainCategories.length ? (
                          <p className="rounded-md border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
                            No main categories yet.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <aside className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                      <h3 className="text-sm font-semibold uppercase text-zinc-500">
                        Add main category
                      </h3>
                      <div className="mt-4">
                        <CategoryForm
                          brandId={brand.id}
                          submitLabel="Add main category"
                        />
                      </div>
                    </aside>
                  </div>
                </article>
              );
            })}

            {!brands?.length ? (
              <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                No brands yet. Add your first brand above.
              </section>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
