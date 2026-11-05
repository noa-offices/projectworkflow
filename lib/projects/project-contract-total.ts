import { projectFileFromLayoutSettings } from "../quotations/project-file";
import { clientApprovalDraftFromLayoutSettings } from "../quotations/client-approval-draft";

export type ProjectContractState = { applied_variation_no?: number | null; contract_total?: number | null };
export type ProjectContractTotal = { originalTotal: number; currentTotal: number; appliedVariationNo: number | null; variationDelta: number };
export type ProjectContractStates = ReadonlyMap<string, ProjectContractState>;

/** The stored original is authoritative until a complete applied variation state is available. */
export function projectContractTotal(originalTotal: number, state?: ProjectContractState | readonly ProjectContractState[] | null): ProjectContractTotal {
  const rows: readonly ProjectContractState[] = Array.isArray(state) ? state : state ? [state as ProjectContractState] : [];
  const latest = rows
    .filter((row) => Number.isInteger(row.applied_variation_no) && row.applied_variation_no! > 0 && typeof row.contract_total === "number" && Number.isFinite(row.contract_total))
    .reduce<ProjectContractState | null>((last, row) => !last || row.applied_variation_no! > last.applied_variation_no! ? row : last, null);
  if (!latest) return { originalTotal, currentTotal: originalTotal, appliedVariationNo: null, variationDelta: 0 };
  const currentTotal = latest.contract_total!;
  return { originalTotal, currentTotal, appliedVariationNo: latest.applied_variation_no!, variationDelta: Number((currentTotal - originalTotal).toFixed(2)) };
}

type RpcClient = { rpc(name: string, args: { p_quotation_ids: string[] }): PromiseLike<{ data: unknown; error: unknown }> };

/** RLS stays with the caller's client. A missing/failed state read never makes a screen fail. */
export async function loadProjectContractTotals(supabase: object, quotationIds: readonly string[]): Promise<Map<string, ProjectContractState>> {
  const ids = [...new Set(quotationIds.filter(Boolean))];
  const states = new Map<string, ProjectContractState>();
  if (!ids.length || typeof (supabase as Partial<RpcClient>).rpc !== "function") return states;
  try {
    const batches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
    const results = await Promise.all(batches.map((batch) => (supabase as RpcClient).rpc("project_variation_state", { p_quotation_ids: batch })));
    if (results.some((result) => result.error || !Array.isArray(result.data))) return states;
    const requested = new Set(ids);
    for (const result of results) for (const value of result.data as unknown[]) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const id = typeof row.quotation_id === "string" ? row.quotation_id : "";
      if (!requested.has(id) || row.applied_variation_no == null || row.contract_total == null) continue;
      const state = { applied_variation_no: Number(row.applied_variation_no), contract_total: Number(row.contract_total) };
      if (!Number.isInteger(state.applied_variation_no) || state.applied_variation_no < 1 || !Number.isFinite(state.contract_total)) continue;
      if ((states.get(id)?.applied_variation_no ?? 0) < state.applied_variation_no) states.set(id, state);
    }
    return states;
  } catch {
    return new Map();
  }
}

type Quotation = { id: string; layout_settings?: unknown; grand_total?: number | null };
export function projectContractForQuotation(quotation: Quotation, states: ProjectContractStates): ProjectContractTotal | null {
  const order = projectFileFromLayoutSettings(quotation.layout_settings) ?? clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder;
  return order ? projectContractTotal(order.total, states.get(quotation.id)) : null;
}
/** Use only for Project/approved contract values; the quotation's own total stays separate. */
export function projectContractValue(quotation: Quotation, states: ProjectContractStates) {
  return projectContractForQuotation(quotation, states)?.currentTotal ?? quotation.grand_total ?? 0;
}
export function projectContractQuotationIds(quotations: readonly Quotation[]) {
  return quotations.filter((row) => projectContractForQuotation(row, new Map()) !== null).map((row) => row.id);
}

/** Adapter for the existing order-number keyed Project/procurement lists. */
export async function loadProjectContractTotalsByOrder(supabase: object, quotations: readonly Quotation[]) {
  const states = await loadProjectContractTotals(supabase, projectContractQuotationIds(quotations));
  return new Map(quotations.flatMap((row) => {
    const order = projectFileFromLayoutSettings(row.layout_settings) ?? clientApprovalDraftFromLayoutSettings(row.layout_settings)?.confirmedOrder;
    return order ? [[order.orderNo, projectContractTotal(order.total, states.get(row.id)).currentTotal] as const] : [];
  }));
}
