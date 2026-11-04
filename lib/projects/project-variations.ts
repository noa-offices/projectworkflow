import { buildEffectiveDocumentGroups } from "../quotations/document-grouping";
import { projectFileFromLayoutSettings } from "../quotations/project-file";
import { variationNoFromQuotationNo, variationLinkFromLayoutSettings } from "../quotations/project-variation";
import { variationAppliedFromLayoutSettings } from "../quotations/quotation-lock";
import { quotationRootBaseNo } from "../quotation-options";
import type { PricingRule } from "../quotation-pricing";
import type { AppliedVariation, VariationChangeLine, VariationChangeSummary } from "./project-scope";

// Step C2a: reads around applying a variation to its Project. What a Project's scope IS stays in project-scope.ts.

export type VariationPreview = {
  change_summary: VariationChangeSummary;
  previous_contract_total: number;
  new_contract_total: number;
  contract_delta: number;
  currency: string;
  pricing_rule: PricingRule;
};

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type Client = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): { select(columns: string): { eq(column: string, value: unknown): { ilike(column: string, value: string): PromiseLike<RpcResult> } } };
};

/** What Update Project File would do. Null when it cannot be previewed, such as before the migration is applied. */
export async function loadVariationPreview(supabase: object, variationQuotationId: string): Promise<VariationPreview | null> {
  const { data, error } = await (supabase as Client).rpc("project_variation_preview", { p_variation_quotation_id: variationQuotationId });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("VARIATION PREVIEW ERROR", { variationQuotationId, code: error.code, message: error.message });
    return null;
  }
  return data as VariationPreview;
}

export type ConfirmedVariation = { id: string; quotationNo: string; variationNo: number; preview: VariationPreview };

/** The Client Confirmed variations of a Project that have not reached it yet, with their previews. */
export async function loadConfirmedVariations(supabase: object, projectQuotationNo: string, clientId: string): Promise<ConfirmedVariation[]> {
  const root = quotationRootBaseNo(projectQuotationNo);
  if (!root) return [];
  const { data, error } = await (supabase as Client).from("quotations").select("id,quotation_no,status,is_active,layout_settings").eq("client_id", clientId).ilike("quotation_no", `${root}-V%`);
  if (error) {
    console.error("CONFIRMED VARIATIONS READ ERROR", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{ id: string; quotation_no: string | null; status: string; is_active: boolean; layout_settings: unknown }>;
  const waiting = rows
    .filter((row) => row.is_active && row.status === "client_confirmed" && variationLinkFromLayoutSettings(row.layout_settings) && !variationAppliedFromLayoutSettings(row.layout_settings))
    .sort((a, b) => (variationNoFromQuotationNo(a.quotation_no) ?? 0) - (variationNoFromQuotationNo(b.quotation_no) ?? 0));
  const previews = await Promise.all(waiting.map(async (row) => ({ row, preview: await loadVariationPreview(supabase, row.id) })));
  return previews.flatMap(({ row, preview }) => preview ? [{ id: row.id, quotationNo: row.quotation_no ?? "", variationNo: variationNoFromQuotationNo(row.quotation_no) ?? 0, preview }] : []);
}

/**
 * Order number -> revised contract total, for lists. The lists already hold every quotation's settings, so only Projects that really have an applied
 * variation are asked about: usually none, and then there is no extra read. A failed read keeps the Project File total.
 */
export async function loadRevisedContractTotals(supabase: object, quotations: Array<{ id: string; layout_settings: unknown }>) {
  const totals = new Map<string, number>();
  const projectIds = [...new Set(quotations.flatMap((row) => variationAppliedFromLayoutSettings(row.layout_settings) ? [variationLinkFromLayoutSettings(row.layout_settings)?.projectQuotationId ?? ""] : []).filter(Boolean))];
  if (!projectIds.length) return totals;
  const orderNos = new Map(quotations.flatMap((row) => {
    const file = projectFileFromLayoutSettings(row.layout_settings);
    return file && file.quotationId === row.id ? [[row.id, file.orderNo] as const] : [];
  }));
  const chunks = Array.from({ length: Math.ceil(projectIds.length / 50) }, (_, index) => projectIds.slice(index * 50, index * 50 + 50));
  const results = await Promise.all(chunks.map((ids) => (supabase as Client).rpc("project_variation_state", { p_quotation_ids: ids })));
  for (const { data, error } of results) {
    if (error) { console.error("VARIATION STATE ERROR", error.message); continue; }
    for (const row of (data ?? []) as Array<{ quotation_id: string; contract_total: number | null }>) {
      const orderNo = orderNos.get(row.quotation_id);
      if (orderNo && row.contract_total !== null && row.contract_total !== undefined) totals.set(orderNo, Number(row.contract_total));
    }
  }
  return totals;
}

export function currentScopeNote(applied: Array<Pick<AppliedVariation, "variationNo">>) {
  return `Current scope includes ${applied.map((variation) => `V${variation.variationNo}`).join(", ")}`;
}

/** Vendor groups that already have procurement progress and whose lines a variation changed, so nobody forgets an order already placed. */
export function vendorsWithChangedLines(applied: Array<Pick<AppliedVariation, "variationNo" | "changeSummary">>, vendorsWithProgress: Set<string>) {
  const lines = applied.flatMap(({ variationNo, changeSummary }) => {
    const tagged = (line: VariationChangeLine, change: string, before = false) => ({
      supplier_name_snapshot: (before ? line.supplier_name_before : line.supplier_name) ?? null,
      brand_name_snapshot: (before ? line.brand_name_before : line.brand_name) ?? null,
      note: `V${variationNo}: ${change} ${line.item_name ?? line.item_code ?? "line"}`,
    });
    return [
      ...(changeSummary.added ?? []).map((line) => tagged(line, "added")),
      ...(changeSummary.removed ?? []).map((line) => tagged(line, "removed")),
      ...(changeSummary.changed ?? []).flatMap((line) => [tagged(line, "changed"), tagged(line, "changed", true)]),
    ];
  });
  return buildEffectiveDocumentGroups(lines)
    .filter((group) => vendorsWithProgress.has(group.dedupeKey))
    .map((group) => ({ vendorLabel: group.displayLabel, notes: [...new Set(group.items.map((line) => line.note))] }));
}
