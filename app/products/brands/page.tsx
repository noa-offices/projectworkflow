import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { requireProductLibraryManager } from "@/lib/auth";
import { defaultCurrency, normalizeCurrency, supportedCurrencies } from "@/lib/currencies";
import { ensureDefaultProductCategoryTree } from "@/lib/product-default-category-tree";
import { createClient } from "@/lib/supabase/server";
import {
  archiveBrand,
  archiveCategory,
  createBrand,
  createCategory,
  permanentlyDeleteBrand,
  permanentlyDeleteCategory,
  restoreBrand,
  restoreCategory,
  updateBrand,
  updateCategory,
} from "./actions";

export const dynamic = "force-dynamic";

type BrandsSearchParams = {
  message?: string | string[];
  q?: string | string[];
  status?: string | string[];
  brand?: string | string[];
  category?: string | string[];
  addBrand?: string | string[];
  editBrand?: string | string[];
};

type BrandsPageProps = {
  searchParams?: Promise<BrandsSearchParams>;
};

type Brand = {
  id: string;
  name: string;
  code: string | null;
  default_currency: string;
  origin: string | null;
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

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function brandsHref(
  params: BrandsSearchParams,
  updates: Partial<
    Record<
      "q" | "status" | "brand" | "category" | "addBrand" | "editBrand",
      string | null
    >
  >,
) {
  const next = new URLSearchParams();

  for (const key of [
    "q",
    "status",
    "brand",
    "category",
    "addBrand",
    "editBrand",
  ] as const) {
    const updatedValue = updates[key];
    const value =
      updatedValue === undefined ? stringParam(params[key]) : updates[key];

    if (value) {
      next.set(key, value);
    }
  }

  const query = next.toString();
  return `/products/brands${query ? `?${query}` : ""}`;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${
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

function CurrencySelect({
  defaultValue,
  label = "Default currency",
  name = "default_currency",
}: {
  defaultValue?: string | null;
  label?: string;
  name?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
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
      className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
      pendingLabel={pendingLabel}
    >
      {label}
    </PendingSubmitButton>
  );
}

function PrimaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
    >
      {label}
    </Link>
  );
}

function SecondaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      {label}
    </Link>
  );
}

function ActionLink({
  href,
  label,
  tone = "default",
}: {
  href: string;
  label: string;
  tone?: "default" | "primary";
}) {
  return (
    <Link
      href={href}
      className={`inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-semibold transition ${
        tone === "primary"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
      }`}
    >
      {label}
    </Link>
  );
}

function BrandForm({ brand, cancelHref }: { brand?: Brand; cancelHref?: string }) {
  return (
    <form action={brand ? updateBrand : createBrand} className="grid gap-3 md:grid-cols-2">
      {brand ? <input type="hidden" name="id" value={brand.id} /> : null}
      <TextInput name="name" label="Brand name" defaultValue={brand?.name} required />
      <TextInput name="code" label="Code" defaultValue={brand?.code} />
      <CurrencySelect defaultValue={brand?.default_currency} />
      <TextInput
        name="origin"
        label="Origin / Country"
        defaultValue={brand?.origin}
      />
      <TextInput name="website" label="Website" defaultValue={brand?.website} />
      <TextInput name="logo_url" label="Logo URL" defaultValue={brand?.logo_url} />
      <TextArea
        name="description"
        label="Description"
        defaultValue={brand?.description}
      />
      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-end sm:justify-between">
        <ActiveToggle defaultChecked={brand?.is_active ?? true} />
        <div className="flex gap-2">
          {cancelHref ? <SecondaryLink href={cancelHref} label="Cancel" /> : null}
          <SubmitButton label="Save" pendingLabel={brand ? "Saving brand..." : "Creating brand..."} />
        </div>
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
    <form action={category ? updateCategory : createCategory} className="grid gap-3 md:grid-cols-2">
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="parent_id" value={parentId ?? ""} />
      <TextInput name="name" label="Category name" defaultValue={category?.name} required />
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
        <SubmitButton
          label={submitLabel}
          pendingLabel={category ? "Saving category..." : parentId ? "Creating subcategory..." : "Creating category..."}
        />
      </div>
    </form>
  );
}

function subcategoryCountLabel(count: number) {
  return `${count} ${count === 1 ? "subcategory" : "subcategories"}`;
}

function BrandListCard({
  archiveHrefId,
  brand,
  isSelected,
  mainCount,
  openHref,
  editHref,
  subCount,
}: {
  archiveHrefId: string;
  brand: Brand;
  isSelected: boolean;
  mainCount: number;
  openHref: string;
  editHref: string;
  subCount: number;
}) {
  return (
    <article
      className={`rounded-lg border p-4 shadow-sm transition ${
        isSelected
          ? "border-emerald-200 bg-emerald-50/70"
          : "border-zinc-200 bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-zinc-950">
              {brand.name}
            </h3>
            {brand.code ? (
              <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                Code: {brand.code}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Origin: {brand.origin ?? "-"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {mainCount} categories · {subCount} subcategories
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <StatusBadge active={brand.is_active} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <ActionLink href={openHref} label="Open" tone="primary" />
        <ActionLink href={editHref} label="Edit" />
        <form action={archiveBrand}>
          <input type="hidden" name="id" value={archiveHrefId} />
          <ConfirmSubmitButton
            message="This will move the brand to Archive. You can restore it later."
            className="inline-flex h-8 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
          >
            Archive
          </ConfirmSubmitButton>
        </form>
      </div>
    </article>
  );
}

type ArchiveItem = {
  id: string;
  label: string;
  meta: string;
  restoreAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

export default async function BrandsPage({ searchParams }: BrandsPageProps) {
  const { user, profile, displayName } = await requireProductLibraryManager();
  const params = (await searchParams) ?? {};
  const message = stringParam(params.message);
  const searchQuery = stringParam(params.q).trim();
  const statusFilter = stringParam(params.status);
  const selectedBrandId = stringParam(params.brand);
  const selectedCategoryId = stringParam(params.category);
  const showAddBrand = stringParam(params.addBrand) === "1";
  const editBrandId = stringParam(params.editBrand);
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name,code,default_currency,origin,description,website,logo_url,is_active")
    .order("name", { ascending: true })
    .returns<Brand[]>();

  if ((brands ?? []).length) {
    try {
      await ensureDefaultProductCategoryTree({
        supabase,
        brandIds: (brands ?? []).map((brand) => brand.id),
        userId: user.id,
      });
    } catch (seedError) {
      console.error("DEFAULT PRODUCT CATEGORY BACKFILL ERROR", seedError);
    }
  }

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

  const brandList = brands ?? [];
  const categoryList = categories ?? [];
  const activeBrandList = brandList.filter((brand) => brand.is_active);
  const archivedBrandList = brandList.filter((brand) => !brand.is_active);
  const activeCategoryList = categoryList.filter((category) => category.is_active);
  const archivedMainCategories = categoryList.filter(
    (category) => !category.is_active && !category.parent_id,
  );
  const archivedSubCategories = categoryList.filter(
    (category) => !category.is_active && category.parent_id,
  );
  const mainCategoriesByBrand = new Map<string, ProductCategory[]>();
  const subCategoriesByParent = new Map<string, ProductCategory[]>();

  for (const category of activeCategoryList) {
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

  const subcategoryCountByBrand = new Map<string, number>();
  for (const [brandId, mainCategories] of mainCategoriesByBrand.entries()) {
    const count = mainCategories.reduce(
      (total, category) =>
        total + (subCategoriesByParent.get(category.id)?.length ?? 0),
      0,
    );
    subcategoryCountByBrand.set(brandId, count);
  }

  const normalizedSearch = searchQuery.toLowerCase();
  const visibleBrandList =
    statusFilter === "inactive" || statusFilter === "archive"
      ? archivedBrandList
      : activeBrandList;
  const filteredBrands = visibleBrandList.filter((brand) => {
    const matchesSearch =
      !normalizedSearch ||
      brand.name.toLowerCase().includes(normalizedSearch) ||
      (brand.origin ?? "").toLowerCase().includes(normalizedSearch);
    const matchesStatus =
      !statusFilter ||
      statusFilter === "all" ||
      statusFilter === "archive" ||
      (statusFilter === "active" && brand.is_active) ||
      (statusFilter === "inactive" && !brand.is_active);

    return matchesSearch && matchesStatus;
  });

  const selectedBrand = brandList.find((brand) => brand.id === selectedBrandId) ?? null;
  const selectedMainCategories = selectedBrand
    ? mainCategoriesByBrand.get(selectedBrand.id) ?? []
    : [];
  const selectedCategory =
    selectedMainCategories.find((category) => category.id === selectedCategoryId) ?? null;
  const selectedSubCategories = selectedCategory
    ? subCategoriesByParent.get(selectedCategory.id) ?? []
    : [];

  const archiveItems: ArchiveItem[] = [
    ...archivedBrandList.map((item) => ({
      id: item.id,
      label: item.name,
      meta: "Brand",
      restoreAction: restoreBrand,
      deleteAction: permanentlyDeleteBrand,
    })),
    ...archivedMainCategories.map((item) => ({
      id: item.id,
      label: item.name,
      meta: `Main Category / ${brandList.find((brand) => brand.id === item.brand_id)?.name ?? "Unknown brand"}`,
      restoreAction: restoreCategory,
      deleteAction: permanentlyDeleteCategory,
    })),
    ...archivedSubCategories.map((item) => ({
      id: item.id,
      label: item.name,
      meta: `Sub Category / ${brandList.find((brand) => brand.id === item.brand_id)?.name ?? "Unknown brand"}`,
      restoreAction: restoreCategory,
      deleteAction: permanentlyDeleteCategory,
    })),
  ];

  return (
    <ErpAppShell
      title="Brands"
      description="Manage brands, origins, categories, and subcategories used by products and materials."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">
          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                  Brands
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                  Manage brands, origins, categories, and subcategories used by
                  products and materials.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <SecondaryLink href="/products" label="Back to products" />
                <PrimaryLink
                  href={brandsHref(params, { addBrand: "1", editBrand: null })}
                  label="+ Add Brand"
                />
              </div>
            </div>
            {message ? (
              <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {message}
              </p>
            ) : null}
          </section>

          <section className="mt-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <form
                action="/products/brands"
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] xl:min-w-[720px]"
              >
                <input
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Search brands or origin"
                  className="h-10 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
                <select
                  name="status"
                  defaultValue={statusFilter || "all"}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                <button
                  type="submit"
                  className="h-10 rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  Search
                </button>
              </form>
              {!showAddBrand ? (
                <PrimaryLink
                  href={brandsHref(params, { addBrand: "1", editBrand: null })}
                  label="+ Add Brand"
                />
              ) : null}
            </div>

            {showAddBrand ? (
              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-zinc-950">Add Brand</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Create the brand, then open it to manage categories and
                      subcategories.
                    </p>
                  </div>
                  <SecondaryLink
                    href={brandsHref(params, { addBrand: null, editBrand: null })}
                    label="Cancel"
                  />
                </div>
                <BrandForm
                  cancelHref={brandsHref(params, {
                    addBrand: null,
                    editBrand: null,
                  })}
                />
              </div>
            ) : null}
          </section>

          <section className="mt-6 grid gap-6 2xl:grid-cols-[minmax(420px,540px)_1fr]">
            <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-5 py-4">
                <h2 className="font-semibold text-zinc-950">Brand list</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {filteredBrands.length} of {brandList.length} shown
                </p>
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-2">
                {filteredBrands.map((brand) => {
                  const mainCount = mainCategoriesByBrand.get(brand.id)?.length ?? 0;
                  const subCount = subcategoryCountByBrand.get(brand.id) ?? 0;
                  const isSelected = brand.id === selectedBrand?.id;

                  return (
                    <BrandListCard
                      key={brand.id}
                      archiveHrefId={brand.id}
                      brand={brand}
                      editHref={brandsHref(params, {
                        brand: brand.id,
                        category: null,
                        addBrand: null,
                        editBrand: brand.id,
                      })}
                      isSelected={isSelected}
                      mainCount={mainCount}
                      openHref={brandsHref(params, {
                        brand: brand.id,
                        category: null,
                        addBrand: null,
                        editBrand: null,
                      })}
                      subCount={subCount}
                    />
                  );
                })}
              </div>

              {!filteredBrands.length ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  <p>{brandList.length ? "No brands match the current search." : "No brands yet."}</p>
                  {!brandList.length ? (
                    <>
                      <p className="mt-2">
                        Create a brand to start adding product templates, material groups, and finishes.
                      </p>
                      <div className="mt-4">
                        <PrimaryLink
                          href={brandsHref(params, { addBrand: "1", editBrand: null })}
                          label="+ Add Brand"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>

            <div className="space-y-5">
              {selectedBrand ? (
                <>
                  <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold text-zinc-950">
                            {selectedBrand.name}
                          </h2>
                          <StatusBadge active={selectedBrand.is_active} />
                        </div>
                        <dl className="mt-3 grid gap-3 text-sm text-zinc-600 sm:grid-cols-3">
                          <div>
                            <dt className="text-xs font-semibold uppercase text-zinc-400">
                              Code
                            </dt>
                            <dd>{selectedBrand.code ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase text-zinc-400">
                              Origin
                            </dt>
                            <dd>{selectedBrand.origin ?? "-"}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase text-zinc-400">
                              Default currency
                            </dt>
                            <dd>{selectedBrand.default_currency}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase text-zinc-400">
                              Website
                            </dt>
                            <dd className="truncate">
                              {selectedBrand.website ? (
                                <a
                                  href={selectedBrand.website}
                                  className="font-medium text-emerald-900 hover:text-emerald-800"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {selectedBrand.website}
                                </a>
                              ) : (
                                "-"
                              )}
                            </dd>
                          </div>
                        </dl>
                        {selectedBrand.description ? (
                          <p className="mt-3 text-sm text-zinc-500">
                            {selectedBrand.description}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <details className="mt-5" open={editBrandId === selectedBrand.id}>
                      <summary className="inline-flex cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                        Edit Brand
                      </summary>
                      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                        <BrandForm brand={selectedBrand} />
                      </div>
                    </details>
                  </section>

                  <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-semibold text-zinc-950">Main Categories</h2>
                        <p className="mt-1 text-sm text-zinc-500">
                          Open a category to manage its subcategories.
                        </p>
                      </div>
                      <details className="sm:min-w-[320px]">
                        <summary className="cursor-pointer rounded-md bg-emerald-900 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-800">
                          + Add Main Category
                        </summary>
                        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                          <CategoryForm brandId={selectedBrand.id} submitLabel="Save" />
                        </div>
                      </details>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-left text-sm">
                        <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Category</th>
                            <th className="px-4 py-3 font-semibold">Code</th>
                            <th className="px-4 py-3 font-semibold">Subcategories</th>
                            <th className="px-4 py-3 font-semibold">Status</th>
                            <th className="px-4 py-3 text-right font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {selectedMainCategories.map((category) => {
                            const subCount =
                              subCategoriesByParent.get(category.id)?.length ?? 0;
                            const isOpen = category.id === selectedCategory?.id;

                            return (
                              <tr
                                key={category.id}
                                className={isOpen ? "bg-emerald-50/60" : ""}
                              >
                                <td className="px-4 py-3 font-semibold text-zinc-950">
                                  {category.name}
                                </td>
                                <td className="px-4 py-3 text-zinc-600">
                                  {category.code ?? "-"}
                                </td>
                                <td className="px-4 py-3 text-zinc-600">
                                  {subcategoryCountLabel(subCount)}
                                </td>
                                <td className="px-4 py-3">
                                  <StatusBadge active={category.is_active} />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex justify-end gap-2">
                                    <ActionLink
                                      href={brandsHref(params, {
                                        brand: selectedBrand.id,
                                        category: category.id,
                                        editBrand: null,
                                      })}
                                      label="Open"
                                      tone="primary"
                                    />
                                    <ActionLink
                                      href={brandsHref(params, {
                                        brand: selectedBrand.id,
                                        category: category.id,
                                        editBrand: null,
                                      })}
                                      label="+ Subcategory"
                                    />
                                    <details>
                                      <summary className="inline-flex h-8 cursor-pointer list-none items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                                        Edit
                                      </summary>
                                      <div className="absolute right-8 z-10 mt-2 w-[min(560px,calc(100vw-3rem))] rounded-md border border-zinc-200 bg-white p-4 text-left shadow-lg">
                                        <CategoryForm
                                          brandId={selectedBrand.id}
                                          category={category}
                                          submitLabel="Save"
                                        />
                                      </div>
                                    </details>
                                    <form action={archiveCategory}>
                                      <input type="hidden" name="id" value={category.id} />
                                      <ConfirmSubmitButton
                                        message="This will move the category to Archive. You can restore it later."
                                        className="inline-flex h-8 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                                      >
                                        Archive
                                      </ConfirmSubmitButton>
                                    </form>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {!selectedMainCategories.length ? (
                      <div className="p-8 text-center text-sm text-zinc-500">
                        No main categories yet.
                      </div>
                    ) : null}
                  </section>

                  {selectedCategory ? (
                    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                      <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h2 className="font-semibold text-zinc-950">
                            {selectedCategory.name} Subcategories
                          </h2>
                          <p className="mt-1 text-sm text-zinc-500">
                            {selectedCategory.code ?? "No code"} /{" "}
                            {subcategoryCountLabel(selectedSubCategories.length)}
                          </p>
                        </div>
                        <details className="lg:min-w-[320px]">
                          <summary className="cursor-pointer rounded-md bg-emerald-900 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-800">
                            + Add Subcategory
                          </summary>
                          <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                            <CategoryForm
                              brandId={selectedBrand.id}
                              parentId={selectedCategory.id}
                              submitLabel="Save"
                            />
                          </div>
                        </details>
                      </div>

                      <div className="divide-y divide-zinc-100">
                        {selectedSubCategories.map((subCategory) => (
                          <div
                            key={subCategory.id}
                            className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_120px_120px_auto]"
                          >
                            <div>
                              <p className="font-semibold text-zinc-950">
                                {subCategory.name}
                              </p>
                              {subCategory.description ? (
                                <p className="mt-1 text-zinc-500">
                                  {subCategory.description}
                                </p>
                              ) : null}
                            </div>
                            <p className="text-zinc-600">
                              {subCategory.code ?? "-"}
                            </p>
                            <StatusBadge active={subCategory.is_active} />
                            <div className="flex gap-2 justify-self-start md:justify-self-end">
                              <details>
                                <summary className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                                  Edit
                                </summary>
                                <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 md:w-[560px]">
                                  <CategoryForm
                                    brandId={selectedBrand.id}
                                    parentId={selectedCategory.id}
                                    category={subCategory}
                                    submitLabel="Save"
                                  />
                                </div>
                              </details>
                              <form action={archiveCategory}>
                                <input type="hidden" name="id" value={subCategory.id} />
                                <ConfirmSubmitButton
                                  message="This will move the subcategory to Archive. You can restore it later."
                                  className="inline-flex h-8 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                                >
                                  Archive
                                </ConfirmSubmitButton>
                              </form>
                            </div>
                          </div>
                        ))}
                      </div>

                      {!selectedSubCategories.length ? (
                        <div className="p-8 text-center text-sm text-zinc-500">
                          No subcategories yet.
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : (
                <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                  <h2 className="text-base font-semibold text-zinc-900">
                    Open a brand to manage its details
                  </h2>
                  <p className="mt-2">
                    Select a brand to review metadata, edit its details, and
                    manage categories and subcategories.
                  </p>
                </section>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 p-4">
              <h2 className="font-semibold text-zinc-950">Archive</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Restore archived brands and categories, or permanently delete
                unused records.
              </p>
            </div>
            <div className="divide-y divide-zinc-100">
              {archiveItems.map((item) => (
                <div
                  key={`${item.meta}-${item.id}`}
                  className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div>
                    <h3 className="font-semibold text-zinc-950">{item.label}</h3>
                    <p className="mt-1 text-sm text-zinc-500">{item.meta}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <form action={item.restoreAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button
                        type="submit"
                        className="inline-flex h-8 items-center rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50"
                      >
                        Restore
                      </button>
                    </form>
                    <form action={item.deleteAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <ConfirmSubmitButton
                        message="Permanently delete this item? This cannot be undone."
                        className="inline-flex h-8 items-center rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                      >
                        Delete permanently
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </div>
              ))}
              {!archiveItems.length ? (
                <p className="p-6 text-sm text-zinc-500">
                  No archived brands or categories.
                </p>
              ) : null}
            </div>
          </section>
      </div>
    </ErpAppShell>
  );
}
