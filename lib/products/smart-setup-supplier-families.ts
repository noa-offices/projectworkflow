import type { SupabaseClient } from "@supabase/supabase-js";
import { SMART_SETUP_TEMPLATE_ID } from "./smart-setup-supplier-targets";
import { supplierFamilyKey } from "./supplier-price-import";
import { supplierFamilyScope, supplierListTemplateFamilies, supplierMissingTemplateFamilies, supplierSourceFamilies } from "./supplier-price-repository";

export type SmartSetupFamilyChoice = { family: string; key: string };
export type SmartSetupSupplierFamilyState = { families: Array<SmartSetupFamilyChoice & { count: number }>; chosen: SmartSetupFamilyChoice[]; missing: SmartSetupFamilyChoice[] };

/** The matcher scope for the draft: every draft target carries one transient template id, so one entry covers the whole draft. Empty = no scope. */
export function smartSetupFamilyScope(keys: Iterable<string>): Map<string, Set<string>> | undefined {
  const set = new Set(keys);
  return set.size ? new Map([[SMART_SETUP_TEMPLATE_ID, set]]) : undefined;
}

/**
 * Family keys to compare the draft with. Names chosen on screen win (a new product has nothing saved); otherwise the families saved for the
 * template. Names the price list does not contain are dropped, never guessed. Reads only; empty when nothing is known.
 */
export async function resolveSmartSetupFamilyKeys(client: SupabaseClient, input: { definitionId: string; versionId: string; templateId?: string | null; familyNames?: string[] | null }): Promise<Set<string>> {
  const names = (input.familyNames ?? []).filter((name) => typeof name === "string" && name.trim());
  if (!names.length && !input.templateId) return new Set();
  const inList = new Set((await supplierSourceFamilies(client, input.versionId)).map((item) => item.family_key));
  const wanted = names.length ? names.map(supplierFamilyKey) : [...((await supplierFamilyScope(client, input.definitionId)).get(input.templateId!) ?? [])];
  return new Set(wanted.filter((key) => inList.has(key)));
}

/** What the family bar shows: the families in this price list, those saved for the template (if saved), and saved ones the list no longer has. */
export async function loadSmartSetupFamilyState(client: SupabaseClient, input: { definitionId: string; versionId: string; templateId?: string | null }): Promise<SmartSetupSupplierFamilyState> {
  const found = await supplierSourceFamilies(client, input.versionId);
  const families = found.map((item) => ({ family: item.family, key: item.family_key, count: item.identity_count }));
  if (!input.templateId || !families.length) return { families, chosen: [], missing: [] };
  const [saved, absent] = await Promise.all([supplierListTemplateFamilies(client, { definitionId: input.definitionId }), supplierMissingTemplateFamilies(client, input.definitionId, input.versionId)]);
  const mine = <T extends { template_id: string; family: string; family_key: string }>(rows: T[]) => rows.filter((row) => row.template_id === input.templateId).map((row) => ({ family: row.family, key: row.family_key }));
  return { families, chosen: mine(saved), missing: mine(absent) };
}
