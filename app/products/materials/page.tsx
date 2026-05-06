import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { AppSidebar } from "@/components/app-sidebar";
import { BrandMaterialSwatchInput } from "@/components/products/brand-material-swatch-input";
import { TopBar } from "@/components/top-bar";
import { requireRecordsManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createMaterial,
  createMaterialGroup,
  deactivateMaterial,
  deactivateMaterialGroup,
  updateMaterial,
  updateMaterialGroup,
} from "./actions";

export const dynamic = "force-dynamic";

type MaterialsSearchParams = {
  brand?: string | string[];
  category?: string | string[];
  group?: string | string[];
  message?: string | string[];
  q?: string | string[];
  showInactive?: string | string[];
  sort?: string | string[];
  status?: string | string[];
  view?: string | string[];
};

type MaterialsPageProps = {
  searchParams?: Promise<MaterialsSearchParams>;
};

type Brand = {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
};

type MaterialGroup = {
  id: string;
  brand_id: string;
  group_name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type Material = {
  id: string;
  brand_id: string;
  material_group_id: string;
  material_category: string | null;
  material_code: string | null;
  material_name: string;
  color_family: string | null;
  description: string | null;
  image_url: string | null;
  signed_image_url?: string | null;
  sort_order: number;
  is_active: boolean;
};

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function materialsHref(
  params: MaterialsSearchParams,
  updates: Partial<Record<"brand" | "category" | "group" | "q" | "showInactive" | "sort" | "status" | "view", string | null>>,
) {
  const next = new URLSearchParams();

  for (const key of ["brand", "category", "group", "q", "showInactive", "sort", "status", "view"] as const) {
    const updatedValue = updates[key];
    const value = updatedValue === undefined ? stringParam(params[key]) : updatedValue;

    if (value) next.set(key, value);
  }

  const query = next.toString();
  return `/products/materials${query ? `?${query}` : ""}`;
}

function isDirectImageUrl(value: string) {
  return /^(https?:|blob:|data:|\/)/i.test(value);
}

async function signedProductImageUrl(value: string | null, supabase: Awaited<ReturnType<typeof createClient>>) {
  if (!value) return null;
  if (isDirectImageUrl(value)) return value;

  const storagePath = value.startsWith("product-images:")
    ? value.slice("product-images:".length)
    : value;
  const { data, error } = await supabase.storage
    .from("product-images")
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    console.error("BRAND MATERIAL IMAGE SIGN ERROR", error.message);
    return null;
  }

  return data.signedUrl;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-zinc-200 bg-zinc-100 text-zinc-600"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function TextInput({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ""}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
      />
    </label>
  );
}

function TextArea({
  defaultValue,
  label,
  name,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
}) {
  return (
    <label className="block md:col-span-2">
      <span className="text-xs font-semibold uppercase text-zinc-500">{label}</span>
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
        className="h-4 w-4 rounded border-zinc-300"
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

function GroupForm({
  brandId,
  group,
  returnTo,
}: {
  brandId: string;
  group?: MaterialGroup;
  returnTo: string;
}) {
  return (
    <form action={group ? updateMaterialGroup : createMaterialGroup} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="return_to" value={returnTo} />
      {group ? <input type="hidden" name="id" value={group.id} /> : null}
      <TextInput name="group_name" label="Group name" defaultValue={group?.group_name} required />
      <TextInput name="sort_order" label="Sort order" type="number" defaultValue={group?.sort_order ?? 0} />
      <TextArea name="description" label="Description" defaultValue={group?.description} />
      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <ActiveToggle defaultChecked={group?.is_active ?? true} />
        <SubmitButton label={group ? "Save group" : "Add group"} />
      </div>
    </form>
  );
}

function MaterialForm({
  brandId,
  group,
  material,
  returnTo,
}: {
  brandId: string;
  group: MaterialGroup;
  material?: Material;
  returnTo: string;
}) {
  return (
    <form action={material ? updateMaterial : createMaterial} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="brand_id" value={brandId} />
      <input type="hidden" name="material_group_id" value={group.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="description" value={material?.description ?? ""} />
      <input type="hidden" name="color_family" value={material?.color_family ?? ""} />
      <input type="hidden" name="sort_order" value={material?.sort_order ?? 0} />
      {material ? <input type="hidden" name="id" value={material.id} /> : null}
      <label className="block">
        <span className="text-xs font-semibold uppercase text-zinc-500">Group</span>
        <span className="mt-1 flex h-10 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700">
          {group.group_name}
        </span>
      </label>
      <TextInput name="material_category" label="Category / Collection" defaultValue={material?.material_category} />
      <TextInput name="material_code" label="Code" defaultValue={material?.material_code} />
      <TextInput name="material_name" label="Name" defaultValue={material?.material_name} required />
      <BrandMaterialSwatchInput brandId={brandId} groupId={group.id} defaultValue={material?.image_url} />
      <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <ActiveToggle defaultChecked={material?.is_active ?? true} />
        <SubmitButton label={material ? "Save material" : "Add material"} />
      </div>
    </form>
  );
}

function Swatch({ material, size = "md" }: { material: Material; size?: "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-24 w-full" : "h-12 w-12";

  if (!material.signed_image_url) {
    return <div className={`${sizeClass} rounded border border-zinc-200 bg-zinc-100`} />;
  }

  return (
    <a href={material.signed_image_url} target="_blank" rel="noreferrer" className="block">
      <span
        className={`block ${sizeClass} rounded border border-zinc-200 bg-cover bg-center`}
        style={{ backgroundImage: `url(${material.signed_image_url})` }}
      />
    </a>
  );
}

function groupedMaterials(materials: Material[]) {
  const categories = new Map<string, Material[]>();
  const uncategorized: Material[] = [];

  for (const material of materials) {
    const category = material.material_category?.trim();

    if (!category) {
      uncategorized.push(material);
      continue;
    }

    categories.set(category, [...(categories.get(category) ?? []), material]);
  }

  return { categories: Array.from(categories.entries()), uncategorized };
}

function categoryLabel(category: string) {
  return /^(cat|category)\s+/i.test(category) ? category : `Category ${category}`;
}

function categoryCounts(materials: Material[]) {
  const counts = new Map<string, number>();

  for (const material of materials) {
    const category = material.material_category?.trim();
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function sortMaterials(materials: Material[], sortMode: string) {
  return [...materials].sort((left, right) => {
    if (sortMode === "code") {
      return (left.material_code ?? "").localeCompare(right.material_code ?? "") ||
        left.material_name.localeCompare(right.material_name);
    }

    if (sortMode === "name") {
      return left.material_name.localeCompare(right.material_name) ||
        (left.material_code ?? "").localeCompare(right.material_code ?? "");
    }

    return left.sort_order - right.sort_order ||
      (left.material_code ?? "").localeCompare(right.material_code ?? "") ||
      left.material_name.localeCompare(right.material_name);
  });
}

function MaterialGridCard({
  brandId,
  group,
  material,
  returnTo,
  showCategoryBadge = true,
}: {
  brandId: string;
  group: MaterialGroup;
  material: Material;
  returnTo: string;
  showCategoryBadge?: boolean;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <Swatch material={material} size="lg" />
      <div className="mt-3 min-h-20">
        <div className="flex flex-wrap items-center gap-1.5">
          {showCategoryBadge && material.material_category ? (
            <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">
              {categoryLabel(material.material_category)}
            </span>
          ) : null}
          <StatusBadge active={material.is_active} />
        </div>
        <p className="mt-2 text-sm font-semibold text-zinc-950">
          {material.material_code ? `${material.material_code} | ` : ""}{material.material_name}
        </p>
        {material.description ? (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{material.description}</p>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-zinc-600 transition hover:text-zinc-950">
            Edit
          </summary>
          <div className="mt-3 w-[min(680px,calc(100vw-3rem))] rounded-md border border-zinc-200 bg-zinc-50 p-4 text-left shadow-sm">
            <MaterialForm brandId={brandId} group={group} material={material} returnTo={returnTo} />
          </div>
        </details>
        <form action={deactivateMaterial}>
          <input type="hidden" name="id" value={material.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton
            message="Deactivate this material? It will be hidden by default but not deleted."
            className="text-xs font-semibold text-red-700 transition hover:text-red-800"
          >
            Deactivate
          </ConfirmSubmitButton>
        </form>
      </div>
    </div>
  );
}

function MaterialListRow({
  brandId,
  group,
  material,
  returnTo,
  showCategoryBadge = true,
}: {
  brandId: string;
  group: MaterialGroup;
  material: Material;
  returnTo: string;
  showCategoryBadge?: boolean;
}) {
  return (
    <div className="grid gap-3 p-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start">
      <Swatch material={material} />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-zinc-950">
            {material.material_code ? `${material.material_code} | ` : ""}{material.material_name}
          </p>
          {showCategoryBadge && material.material_category ? (
            <span className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">
              {categoryLabel(material.material_category)}
            </span>
          ) : null}
          <StatusBadge active={material.is_active} />
        </div>
        {material.description ? (
          <p className="mt-1 text-sm text-zinc-500">{material.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 md:justify-end">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-zinc-600 transition hover:text-zinc-950">
            Edit
          </summary>
          <div className="mt-3 w-[min(680px,calc(100vw-3rem))] rounded-md border border-zinc-200 bg-zinc-50 p-4 text-left shadow-sm">
            <MaterialForm brandId={brandId} group={group} material={material} returnTo={returnTo} />
          </div>
        </details>
        <form action={deactivateMaterial}>
          <input type="hidden" name="id" value={material.id} />
          <input type="hidden" name="return_to" value={returnTo} />
          <ConfirmSubmitButton
            message="Deactivate this material? It will be hidden by default but not deleted."
            className="text-sm font-semibold text-red-700 transition hover:text-red-800"
          >
            Deactivate
          </ConfirmSubmitButton>
        </form>
      </div>
    </div>
  );
}

function MaterialCollection({
  brandId,
  group,
  materials,
  returnTo,
  showCategoryBadge,
  viewMode,
}: {
  brandId: string;
  group: MaterialGroup;
  materials: Material[];
  returnTo: string;
  showCategoryBadge: boolean;
  viewMode: string;
}) {
  if (viewMode === "list") {
    return (
      <div className="divide-y divide-zinc-100 rounded-md border border-zinc-100">
        {materials.map((material) => (
          <MaterialListRow key={material.id} brandId={brandId} group={group} material={material} returnTo={returnTo} showCategoryBadge={showCategoryBadge} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {materials.map((material) => (
        <MaterialGridCard key={material.id} brandId={brandId} group={group} material={material} returnTo={returnTo} showCategoryBadge={showCategoryBadge} />
      ))}
    </div>
  );
}

export default async function BrandMaterialsPage({ searchParams }: MaterialsPageProps) {
  const { user, displayName } = await requireRecordsManager();
  const params = (await searchParams) ?? {};
  const selectedBrandId = stringParam(params.brand);
  const message = stringParam(params.message);
  const searchQuery = stringParam(params.q).trim();
  const selectedGroupId = stringParam(params.group);
  const selectedCategory = stringParam(params.category);
  const legacyShowInactive = stringParam(params.showInactive) === "1";
  const statusFilter = stringParam(params.status) || (legacyShowInactive ? "all" : "active");
  const sortMode = stringParam(params.sort) || "sort_order";
  const viewMode = stringParam(params.view) === "list" ? "list" : "grid";
  const supabase = await createClient();

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id,name,code,is_active")
    .order("name", { ascending: true })
    .returns<Brand[]>();

  if (brandsError) console.error("BRAND MATERIALS BRANDS ERROR", brandsError.message);

  const brandList = brands ?? [];
  const activeBrands = brandList.filter((brand) => brand.is_active);
  const selectedBrand =
    brandList.find((brand) => brand.id === selectedBrandId) ??
    activeBrands[0] ??
    brandList[0] ??
    null;
  const normalizedParams = {
    ...params,
    brand: selectedBrand?.id ?? selectedBrandId,
    status: statusFilter,
    view: viewMode,
  };
  const returnTo = materialsHref(normalizedParams, {
    brand: selectedBrand?.id ?? null,
    category: selectedCategory || null,
    group: selectedGroupId || null,
    q: searchQuery || null,
    showInactive: null,
    sort: sortMode === "sort_order" ? null : sortMode,
    status: statusFilter === "active" ? null : statusFilter,
    view: viewMode === "grid" ? null : viewMode,
  });

  const { data: groups, error: groupsError } = selectedBrand
    ? await supabase
        .from("brand_material_groups")
        .select("id,brand_id,group_name,description,sort_order,is_active")
        .eq("brand_id", selectedBrand.id)
        .order("sort_order", { ascending: true })
        .order("group_name", { ascending: true })
        .returns<MaterialGroup[]>()
    : { data: [], error: null };

  const { data: materials, error: materialsError } = selectedBrand
    ? await supabase
        .from("brand_materials")
        .select("id,brand_id,material_group_id,material_category,material_code,material_name,color_family,description,image_url,sort_order,is_active")
        .eq("brand_id", selectedBrand.id)
        .order("material_group_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("material_name", { ascending: true })
        .returns<Material[]>()
    : { data: [], error: null };

  if (groupsError) console.error("MATERIAL GROUPS LIST ERROR", groupsError.message);
  if (materialsError) console.error("MATERIALS LIST ERROR", materialsError.message);

  const rawGroups = groups ?? [];
  const rawMaterials = materials ?? [];
  const statusMatches = (active: boolean) =>
    statusFilter === "all" ||
    (statusFilter === "active" && active) ||
    (statusFilter === "inactive" && !active);
  const navigableGroups = rawGroups.filter((group) => statusFilter === "all" || group.is_active);
  const categoryOptions = Array.from(
    new Set(
      rawMaterials
        .filter((material) => statusMatches(material.is_active))
        .filter((material) => !selectedGroupId || material.material_group_id === selectedGroupId)
        .map((material) => material.material_category?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const normalizedSearch = searchQuery.toLowerCase();
  const filteredMaterials = sortMaterials(
    rawMaterials
      .filter((material) => statusMatches(material.is_active))
      .filter((material) => !selectedGroupId || material.material_group_id === selectedGroupId)
      .filter((material) => !selectedCategory || material.material_category?.trim() === selectedCategory)
      .filter((material) => {
        if (!normalizedSearch) return true;

        return (
          (material.material_code ?? "").toLowerCase().includes(normalizedSearch) ||
          material.material_name.toLowerCase().includes(normalizedSearch)
        );
      }),
    sortMode,
  );
  const materialList = await Promise.all(
    filteredMaterials.map(async (material) => ({
      ...material,
      signed_image_url: await signedProductImageUrl(material.image_url, supabase),
    })),
  );
  const materialsByGroup = new Map<string, Material[]>();
  const allMaterialsByGroup = new Map<string, Material[]>();

  for (const material of materialList) {
    const groupMaterials = materialsByGroup.get(material.material_group_id) ?? [];
    groupMaterials.push(material);
    materialsByGroup.set(material.material_group_id, groupMaterials);
  }

  for (const material of rawMaterials.filter((item) => statusMatches(item.is_active))) {
    const groupMaterials = allMaterialsByGroup.get(material.material_group_id) ?? [];
    groupMaterials.push(material);
    allMaterialsByGroup.set(material.material_group_id, groupMaterials);
  }

  const visibleGroups = navigableGroups
    .filter((group) => !selectedGroupId || group.id === selectedGroupId)
    .filter((group) => (materialsByGroup.get(group.id)?.length ?? 0) > 0 || !searchQuery && !selectedCategory);
  const activeGroupCount = rawGroups.filter((group) => group.is_active).length;
  const activeMaterialCount = rawMaterials.filter((material) => material.is_active).length;

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Brand Material Library"
          description="Manage reusable finish groups and swatches by brand."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/products" className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800">
              Back to products
            </Link>
            {message ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {message}
              </p>
            ) : null}
          </div>

          <section className="sticky top-0 z-20 border border-zinc-200 bg-white p-4 shadow-sm">
            <form action="/products/materials" className="grid gap-3 xl:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_1fr_auto_auto] xl:items-end">
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Search</span>
                <input
                  name="q"
                  defaultValue={searchQuery}
                  placeholder="Code or name"
                  className="mt-1 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Brand</span>
                <select name="brand" defaultValue={selectedBrand?.id ?? ""} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  {brandList.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}{brand.code ? ` / ${brand.code}` : ""}{brand.is_active ? "" : " / inactive"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Group</span>
                <select name="group" defaultValue={selectedGroupId} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="">All groups</option>
                  {rawGroups.map((group) => (
                    <option key={group.id} value={group.id}>{group.group_name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Category</span>
                <select name="category" defaultValue={selectedCategory} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="">All categories</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Status</span>
                <select name="status" defaultValue={statusFilter} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="all">All</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">Sort</span>
                <select name="sort" defaultValue={sortMode} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="sort_order">Sort order</option>
                  <option value="code">Code</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">View</span>
                <select name="view" defaultValue={viewMode} className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                  <option value="grid">Grid</option>
                  <option value="list">List</option>
                </select>
              </label>
              <button type="submit" className="h-10 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800">
                Apply
              </button>
              <Link href={materialsHref(normalizedParams, { brand: selectedBrand?.id ?? null, category: null, group: null, q: null, showInactive: null, sort: null, status: null, view: null })} className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                Reset
              </Link>
            </form>
          </section>

          {selectedBrand ? (
            <section className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="self-start rounded-lg border border-zinc-200 bg-white p-5 shadow-sm xl:sticky xl:top-32">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-950">{selectedBrand.name}</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      {activeGroupCount} active groups / {activeMaterialCount} active materials
                    </p>
                  </div>
                  <StatusBadge active={selectedBrand.is_active} />
                </div>
                <details className="mt-5">
                  <summary className="cursor-pointer rounded-md bg-emerald-900 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-800">
                    + Add material group
                  </summary>
                  <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                    <GroupForm brandId={selectedBrand.id} returnTo={returnTo} />
                  </div>
                </details>

                <nav className="mt-5 border-t border-zinc-200 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-xs font-bold uppercase text-zinc-500">Groups</h3>
                    <Link href={materialsHref(normalizedParams, { group: null, category: null })} className="text-xs font-semibold text-emerald-900">
                      All
                    </Link>
                  </div>
                  <div className="space-y-2">
                    {navigableGroups.map((group) => {
                      const groupMaterials = allMaterialsByGroup.get(group.id) ?? [];
                      const groupCategoryCounts = categoryCounts(groupMaterials);

                      return (
                        <div key={group.id} className="rounded-md border border-zinc-100 bg-zinc-50 p-2">
                          <Link
                            href={`${materialsHref(normalizedParams, { group: group.id, category: null })}#group-${group.id}`}
                            className={`flex items-center justify-between gap-3 text-sm font-semibold ${selectedGroupId === group.id ? "text-emerald-900" : "text-zinc-700"}`}
                          >
                            <span>{group.group_name}</span>
                            <span className="text-xs text-zinc-500">{groupMaterials.length}</span>
                          </Link>
                          {groupCategoryCounts.length ? (
                            <div className="mt-2 space-y-1 border-l border-zinc-200 pl-3">
                              {groupCategoryCounts.map(([category, count]) => (
                                <Link
                                  key={`${group.id}-${category}`}
                                  href={`${materialsHref(normalizedParams, { group: group.id, category })}#group-${group.id}`}
                                  className={`flex items-center justify-between gap-3 text-xs ${selectedCategory === category && selectedGroupId === group.id ? "font-semibold text-emerald-900" : "text-zinc-500"}`}
                                >
                                  <span>{categoryLabel(category)}</span>
                                  <span>{count}</span>
                                </Link>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {!navigableGroups.length ? (
                      <p className="text-sm text-zinc-500">No groups yet.</p>
                    ) : null}
                  </div>
                </nav>
              </aside>

              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-sm text-zinc-600">
                    Showing <span className="font-semibold text-zinc-950">{materialList.length}</span> materials
                  </p>
                  <p className="text-xs font-semibold uppercase text-zinc-400">{viewMode} view</p>
                </div>

                {visibleGroups.map((group) => {
                  const groupMaterials = materialsByGroup.get(group.id) ?? [];
                  const { categories, uncategorized } = groupedMaterials(groupMaterials);

                  return (
                    <details id={`group-${group.id}`} key={group.id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                      <summary className="cursor-pointer list-none border-b border-zinc-200 p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-lg font-semibold text-zinc-950">{group.group_name}</h2>
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
                                {groupMaterials.length}
                              </span>
                              <StatusBadge active={group.is_active} />
                            </div>
                            {group.description ? (
                              <p className="mt-2 text-sm text-zinc-500">{group.description}</p>
                            ) : null}
                          </div>
                          <span className="text-sm font-semibold text-emerald-900">Open / close</span>
                        </div>
                      </summary>

                      <div className="space-y-5 p-5">
                        <div className="flex flex-wrap justify-end gap-3 border-b border-zinc-100 pb-4">
                          <details>
                            <summary className="cursor-pointer text-sm font-semibold text-zinc-600 transition hover:text-zinc-950">
                              Edit group
                            </summary>
                            <div className="mt-3 w-[min(620px,calc(100vw-3rem))] rounded-md border border-zinc-200 bg-zinc-50 p-4 text-left shadow-sm">
                              <GroupForm brandId={selectedBrand.id} group={group} returnTo={returnTo} />
                            </div>
                          </details>
                          <form action={deactivateMaterialGroup}>
                            <input type="hidden" name="id" value={group.id} />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <ConfirmSubmitButton
                              message="Deactivate this material group? Materials remain stored and can be shown again with inactive records."
                              className="text-sm font-semibold text-red-700 transition hover:text-red-800"
                            >
                              Deactivate
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                        {categories.map(([category, categoryMaterials]) => (
                          <section key={category}>
                            <div className="mb-3 flex items-center gap-2">
                              <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-600">{categoryLabel(category)}</h3>
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                                {categoryMaterials.length}
                              </span>
                            </div>
                            <MaterialCollection brandId={selectedBrand.id} group={group} materials={categoryMaterials} returnTo={returnTo} showCategoryBadge={false} viewMode={viewMode} />
                          </section>
                        ))}
                        {uncategorized.length ? (
                          <section>
                            {categories.length ? (
                              <div className="mb-3 flex items-center gap-2">
                                <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-600">Uncategorized</h3>
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                                  {uncategorized.length}
                                </span>
                              </div>
                            ) : null}
                            <MaterialCollection brandId={selectedBrand.id} group={group} materials={uncategorized} returnTo={returnTo} showCategoryBadge={false} viewMode={viewMode} />
                          </section>
                        ) : null}
                        {!groupMaterials.length ? (
                          <div className="text-sm text-zinc-500">No materials match the current filters.</div>
                        ) : null}
                      </div>

                      <details className="border-t border-zinc-200 p-4">
                        <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                          + Add material / swatch
                        </summary>
                        <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-4">
                          <MaterialForm brandId={selectedBrand.id} group={group} returnTo={returnTo} />
                        </div>
                      </details>
                    </details>
                  );
                })}

                {!visibleGroups.length ? (
                  <section className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                    No material groups or materials match the current filters.
                  </section>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="mt-6 rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
              Create a brand before adding material groups.
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
