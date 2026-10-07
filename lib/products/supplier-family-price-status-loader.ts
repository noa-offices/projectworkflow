import type { SupabaseClient } from "@supabase/supabase-js";
import { supplierBusinessDate, supplierFamilyReviewFacts } from "./supplier-price-repository";
import {
  resolveSupplierFamilyPriceStatus,
  type SupplierFamilyPriceStatus,
  type SupplierResponsibilityInput,
  type SupplierVersionRef,
} from "./supplier-family-status";

type FamilyInput = { id: string; brand_id: string };
type DefinitionRow = { id: string; brand_id: string; name: string };
type DefinitionFamilyRow = { definition_id: string; template_id: string };
type VersionRow = SupplierVersionRef & { definition_id: string | null };

/** Batched read for all supplied Families; individual Product cards never read Supplier tables. */
export async function loadSupplierFamilyPriceStatusMap(client: SupabaseClient, families: FamilyInput[]): Promise<Map<string, SupplierFamilyPriceStatus>> {
  if (!families.length) return new Map();
  const brandIds = [...new Set(families.map((family) => family.brand_id))];
  const definitionsResult = await client.from("supplier_source_definitions").select("id,brand_id,name").in("brand_id", brandIds).eq("is_active", true).returns<DefinitionRow[]>();
  if (definitionsResult.error) throw Error(definitionsResult.error.message);
  const definitions = definitionsResult.data ?? [];
  const definitionIds = definitions.map((definition) => definition.id);
  const [familiesResult, versionsResult, factsByBrand] = await Promise.all([
    definitionIds.length ? client.from("supplier_source_definition_families").select("definition_id,template_id").in("definition_id", definitionIds).returns<DefinitionFamilyRow[]>() : Promise.resolve({ data: [], error: null }),
    definitionIds.length ? client.from("supplier_source_versions").select("id,title,status,effective_from,created_at,definition_id").in("definition_id", definitionIds).eq("status", "imported").returns<VersionRow[]>() : Promise.resolve({ data: [], error: null }),
    Promise.all(brandIds.map(async (brandId) => [brandId, await supplierFamilyReviewFacts(client, brandId)] as const)),
  ]);
  if (familiesResult.error) throw Error(familiesResult.error.message);
  if (versionsResult.error) throw Error(versionsResult.error.message);
  const selectedIds = new Set(families.map((family) => family.id));
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const versionsByDefinition = new Map<string, SupplierVersionRef[]>();
  for (const version of versionsResult.data ?? []) if (version.definition_id) versionsByDefinition.set(version.definition_id, [...(versionsByDefinition.get(version.definition_id) ?? []), version]);
  const responsibilities: SupplierResponsibilityInput[] = (familiesResult.data ?? []).flatMap((family) => {
    const definition = definitionsById.get(family.definition_id);
    return definition && selectedIds.has(family.template_id) ? [{ templateId: family.template_id, definitionId: definition.id, definitionName: definition.name, versions: versionsByDefinition.get(definition.id) ?? [] }] : [];
  });
  const statuses = resolveSupplierFamilyPriceStatus({ businessDate: supplierBusinessDate(), families: families.map((family) => ({ templateId: family.id, brandId: family.brand_id })), responsibilities, facts: factsByBrand.flatMap(([, facts]) => facts) });
  return new Map(statuses.map((status) => [status.familyId, status]));
}
