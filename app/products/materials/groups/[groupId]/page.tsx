import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ListPageSkeleton } from "@/components/layout/list-page-skeleton";
import {
  MaterialGroupView,
  type MaterialGroupCard,
  type MaterialGroupSwatch,
} from "@/components/products/material-group-view";
import { requireProductLibraryManager } from "@/lib/auth";
import { compareSubgroups } from "@/lib/products/material-sort";
import { readProductPages } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";
import {
  activateMaterialSubgroup,
  createMaterialSubgroup,
  deactivateMaterial,
  deactivateMaterialSubgroup,
  updateMaterialGroup,
  updateMaterialSubgroup,
} from "../../actions";

export const dynamic = "force-dynamic";

type GroupPageProps = {
  params: Promise<{ groupId: string }>;
  searchParams?: Promise<{ message?: string | string[]; sub?: string | string[] }>;
};

type Group = { id: string; brand_id: string; group_name: string; description: string | null; sort_order: number; is_active: boolean };
type Subgroup = { id: string; name: string; grade: string | null; sort_order: number; is_active: boolean };
type MaterialRow = {
  color_family: string | null;
  created_at: string | null;
  description: string | null;
  id: string;
  image_url: string | null;
  material_collection: string | null;
  is_active: boolean;
  material_code: string | null;
  material_category: string | null;
  material_name: string;
  review_status: string | null;
  sort_order: number;
  subgroup_id: string | null;
};

const stringParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] ?? "" : value ?? "");
const isDirectImageUrl = (value: string) => /^(https?:|blob:|data:|\/)/i.test(value);
const storagePath = (value: string) => (value.startsWith("product-images:") ? value.slice("product-images:".length) : value);
const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s-])(\w)/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
const subgroupTitle = (subgroup: Subgroup) => [subgroup.grade?.trim(), titleCase(subgroup.name.trim())].filter(Boolean).join(" · ");
const byOrder = (left: MaterialRow, right: MaterialRow) => left.sort_order - right.sort_order || left.material_name.localeCompare(right.material_name);

export default async function MaterialGroupPage({ params, searchParams }: GroupPageProps) {
  // Same auth and role check as the Material Library page, before the Suspense boundary.
  const auth = await requireProductLibraryManager();
  const { user, profile, displayName } = auth;

  return (
    <ErpAppShell
      eyebrow="ProjectWorkflow"
      title="Brand Material Library"
      description="Manage reusable finish groups and swatches by brand."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <Suspense fallback={<ListPageSkeleton />}>
        <MaterialGroupContent params={params} searchParams={searchParams} />
      </Suspense>
    </ErpAppShell>
  );
}

async function MaterialGroupContent({ params, searchParams }: GroupPageProps) {
  const { groupId } = await params;
  const query = (await searchParams) ?? {};
  const sub = stringParam(query.sub);
  const message = stringParam(query.message);
  const supabase = await createClient();

  const { data: group, error: groupError } = await supabase
    .from("brand_material_groups")
    .select("id,brand_id,group_name,description,sort_order,is_active")
    .eq("id", groupId)
    .maybeSingle<Group>();
  if (groupError) console.error("MATERIAL GROUP PAGE GROUP ERROR", groupError.message);
  if (!group) notFound();

  const [brandResult, subgroupsResult, materialsResult] = await Promise.all([
    supabase.from("brands").select("id,name").eq("id", group.brand_id).maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("brand_material_subgroups")
      .select("id,name,grade,sort_order,is_active")
      .eq("material_group_id", group.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .returns<Subgroup[]>(),
    readProductPages((from, to) => supabase
      .from("brand_materials")
      .select("id,material_code,material_name,material_category,material_collection,color_family,description,image_url,sort_order,is_active,subgroup_id,review_status,created_at")
      .eq("material_group_id", group.id)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<MaterialRow[]>()),
  ]);
  if (subgroupsResult.error) console.error("MATERIAL GROUP PAGE SUBGROUPS ERROR", subgroupsResult.error.message);
  if (materialsResult.error) console.error("MATERIAL GROUP PAGE MATERIALS ERROR", materialsResult.error.message);

  // Natural order (sort order, then grade, then name) so "CAT 2" comes before "CAT 10".
  const subgroups = [...(subgroupsResult.data ?? [])].sort(compareSubgroups);
  const materials = [...(materialsResult.data ?? [])].sort(byOrder);
  const subgroupById = new Map(subgroups.map((item) => [item.id, item]));
  const needsReviewCount = materials.filter((material) => material.is_active && material.review_status === "needs_review").length;

  // Which part of the group is shown: the sub-group cards, or the swatch grid of one sub-group / the directly-held materials / everything.
  const activeSub = subgroupById.get(sub) ?? null;
  const showDirect = sub === "none";
  const showCards = subgroups.length > 0 && !activeSub && !showDirect;
  const visibleMaterials = showCards
    ? []
    : activeSub
      ? materials.filter((material) => material.subgroup_id === activeSub.id)
      : showDirect
        ? materials.filter((material) => !material.subgroup_id)
        : materials;

  // ONE signing call per page: first 4 images of each sub-group in the card view, only the visible materials in the swatch view.
  const cardThumbs = new Map<string, MaterialRow[]>();
  if (showCards) {
    for (const material of materials) {
      if (!material.is_active || !material.image_url) continue;
      const key = material.subgroup_id ?? "none";
      const list = cardThumbs.get(key) ?? [];
      if (list.length < 4) cardThumbs.set(key, [...list, material]);
    }
  }
  const toSign = showCards ? Array.from(cardThumbs.values()).flat() : visibleMaterials;
  const paths = Array.from(new Set(toSign.filter((material) => material.image_url && !isDirectImageUrl(material.image_url)).map((material) => storagePath(material.image_url as string))));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage.from("product-images").createSignedUrls(paths, 60 * 60);
    if (error) console.error("MATERIAL GROUP PAGE SIGN ERROR", error.message);
    for (const item of data ?? []) if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  const urlFor = (material: MaterialRow) => (material.image_url ? (isDirectImageUrl(material.image_url) ? material.image_url : signed.get(storagePath(material.image_url)) ?? null) : null);

  const cardFor = (id: string, title: string, items: MaterialRow[], meta?: Subgroup): MaterialGroupCard => {
    const active = items.filter((material) => material.is_active);
    return {
      count: active.length,
      editable: Boolean(meta),
      grade: meta?.grade ?? "",
      id,
      isActive: meta ? meta.is_active : true,
      name: meta?.name ?? "",
      sortOrder: meta?.sort_order ?? 0,
      needsReview: active.filter((material) => material.review_status === "needs_review").length,
      thumbs: (cardThumbs.get(id) ?? []).map(urlFor),
      title,
    };
  };
  const cards: MaterialGroupCard[] = showCards
    ? [
        ...subgroups.map((item) => cardFor(item.id, subgroupTitle(item), materials.filter((material) => material.subgroup_id === item.id), item)),
        ...(materials.some((material) => !material.subgroup_id && material.is_active)
          ? [cardFor("none", "No sub-group", materials.filter((material) => !material.subgroup_id))]
          : []),
      ]
    : [];
  const swatches: MaterialGroupSwatch[] = visibleMaterials.map((material) => ({
    code: material.material_code ?? "",
    createdAt: material.created_at ?? "",
    grade: (activeSub ? activeSub.grade : subgroupById.get(material.subgroup_id ?? "")?.grade) ?? material.material_category ?? "",
    id: material.id,
    isActive: material.is_active,
    name: material.material_name,
    needsReview: material.review_status === "needs_review",
    record: {
      color_family: material.color_family,
      description: material.description,
      id: material.id,
      image_url: material.image_url,
      is_active: material.is_active,
      material_category: material.material_category,
      material_code: material.material_code,
      material_collection: material.material_collection,
      material_group_id: group.id,
      material_name: material.material_name,
      sort_order: material.sort_order,
      subgroup_id: material.subgroup_id,
    },
    url: urlFor(material),
  }));
  const subgroupOptions = subgroups.filter((item) => item.is_active).map((item) => ({ id: item.id, label: subgroupTitle(item) }));

  return (
    <MaterialGroupView
      brandId={group.brand_id}
      brandName={brandResult.data?.name ?? "Unknown brand"}
      activateSubgroupAction={activateMaterialSubgroup}
      cards={cards}
      createSubgroupAction={createMaterialSubgroup}
      deactivateMaterialAction={deactivateMaterial}
      deactivateSubgroupAction={deactivateMaterialSubgroup}
      group={{ description: group.description ?? "", id: group.id, isActive: group.is_active, name: group.group_name, sortOrder: group.sort_order }}
      message={message}
      mode={showCards ? "cards" : "swatches"}
      needsReviewCount={needsReviewCount}
      sub={activeSub ? { grade: activeSub.grade ?? "", id: activeSub.id, name: activeSub.name, title: subgroupTitle(activeSub) } : showDirect ? { grade: "", id: "none", name: "", title: "No sub-group" } : null}
      subgroupOptions={subgroupOptions}
      swatches={swatches}
      updateGroupAction={updateMaterialGroup}
      updateSubgroupAction={updateMaterialSubgroup}
    />
  );
}
