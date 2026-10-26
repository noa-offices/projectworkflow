import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageReviewDecisions, isSourceId, validateDecisionInput, type SavedReviewDecision } from "./supplier-review-decisions";

type Dependencies = { getProfile: () => Promise<{ role?: string | null; account_status?: string | null } | null>; getClient: () => Promise<SupabaseClient> };
async function requireManager(deps: Dependencies) {
  const profile = await deps.getProfile();
  if (!canManageReviewDecisions(profile?.role, profile?.account_status)) throw Error("Only System Owner and Admin Manager can access review decisions.");
}
export async function listReviewDecisions(deps: Dependencies, sourceId: unknown): Promise<SavedReviewDecision[]> {
  await requireManager(deps);
  if (!isSourceId(sourceId)) throw Error("Choose a valid supplier price list.");
  const { data, error } = await (await deps.getClient()).rpc("list_supplier_price_decisions", { p_supplier_source_id: sourceId });
  if (error) throw Error("Saved decisions could not be loaded. Try again before making changes.");
  return data as SavedReviewDecision[];
}
export async function saveReviewDecisions(deps: Dependencies, values: unknown): Promise<SavedReviewDecision[]> {
  await requireManager(deps);
  if (!Array.isArray(values) || values.length < 1 || values.length > 200) throw Error("Save between 1 and 200 decisions at a time.");
  const decisions = values.map(validateDecisionInput);
  if (new Set(decisions.map((r) => JSON.stringify([r.supplier_source_id, r.model_code, r.price_field]))).size !== decisions.length) throw Error("Each model code and price field can have only one decision per price list.");
  const { data, error } = await (await deps.getClient()).rpc("save_supplier_price_decisions", { p_decisions: decisions });
  if (error) throw Error("Decisions could not be saved. Your changes are still here; try again.");
  return data as SavedReviewDecision[];
}
