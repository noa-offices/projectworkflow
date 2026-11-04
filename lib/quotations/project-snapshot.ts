import { ceilToNearest, roundExact2, type PricingRule } from "../quotation-pricing";

// Step B1: the Project's frozen copy of the approved quotation. The tables and functions are in
// supabase/migrations/20261107100000_project_snapshots.sql; nothing reads them until B2.

export type ProjectSnapshotSourceMethod = "created_with_project_file" | "backfilled_from_live_quotation";

export type ProjectSnapshotHeader = {
  id: string;
  quotation_id: string;
  order_no: string;
  quotation_no: string;
  revision_no: number;
  pricing_rule: PricingRule;
  currency: string;
  vat_percent: number;
  subtotal: number;
  discount_total: number;
  overall_discount_type: string | null;
  overall_discount_value: number;
  net_total: number;
  vat_amount: number;
  grand_total: number;
  contract_total: number;
  source_method: ProjectSnapshotSourceMethod;
};

export type ProjectSnapshotLine = {
  original_item_id: string;
  item_type: string;
  line_style: string;
  is_rate_only: boolean;
  is_optional: boolean;
  include_in_total: boolean;
  qty: number;
  net_total: number;
};

export type SnapshotTotalsInput = {
  lines: ProjectSnapshotLine[];
  overallDiscountType: string | null;
  overallDiscountValue: number;
  vatPercent: number;
  /** layout_settings.price_rounding.rounded_net_prices: a rounded line counts at its rounded net. */
  roundedNetPrices?: Record<string, unknown>;
};

const up5 = (value: number) => ceilToNearest(value, 5);

/** The lines that count towards totals, as in recalculateQuotationTotals. */
export function snapshotPricedLines(lines: ProjectSnapshotLine[]) {
  return lines.filter((line) =>
    !line.is_rate_only &&
    (!line.is_optional || line.include_in_total) &&
    !["rate_only", "no_quote", "note", "heading"].includes(line.line_style) &&
    !["note", "blank", "subtotal"].includes(line.item_type));
}

/** The grand total the items produce, both ways a stored total can have been calculated. Mirrors project_snapshot_item_grands. */
export function snapshotItemGrands(input: SnapshotTotalsInput) {
  const nets = snapshotPricedLines(input.lines).map((line) => {
    const rounded = input.roundedNetPrices?.[line.original_item_id];
    return typeof rounded === "number" ? rounded * line.qty : line.net_total;
  });
  const percent = input.overallDiscountType === "percent";
  const value = input.overallDiscountValue;

  const roundedNet = up5(nets.reduce((total, net) => total + up5(net), 0));
  const roundedOverall = up5(percent ? roundedNet * value / 100 : value);
  const roundedTaxable = up5(Math.max(roundedNet - roundedOverall, 0));
  const rounded = up5(roundedTaxable + up5(roundedTaxable * input.vatPercent / 100));

  const exactNet = roundExact2(nets.reduce((total, net) => total + roundExact2(net), 0));
  const exactBase = roundExact2(percent ? exactNet * Math.min(Math.max(value, 0), 100) / 100 : Math.max(value, 0));
  const exactTaxable = roundExact2(Math.max(exactNet - Math.min(exactBase, exactNet), 0));
  const exact = roundExact2(exactTaxable + roundExact2(exactTaxable * Math.max(input.vatPercent, 0) / 100));

  return { rounded, exact };
}

/**
 * Do the copied items reach this stored total? Mirrors project_snapshot_total_matches.
 * Whole AED: the exact total, to the cent. Legacy has two calculations: the shared builder rounds up to 5, and the local builder is exact but in
 * binary fractions, so it may be 0.01 away. A legacy Project File total is that exact total rounded up to 5, which also counts.
 */
export function snapshotTotalsMatch(rule: PricingRule, grands: { rounded: number; exact: number }, target: number) {
  const stored = roundExact2(target);
  if (rule === "whole_aed_v1") return grands.exact === stored;
  return grands.rounded === stored || Math.abs(roundExact2(grands.exact - stored)) <= 0.01 || up5(grands.exact) === stored;
}

export type ProjectSnapshotAttempt = "created" | "existed" | "function_missing" | "failed";

/** PostgREST and Postgres codes for a function that does not exist: the migration is not applied yet. */
export function isMissingFunctionError(error: { code?: string | null } | null | undefined) {
  return error?.code === "PGRST202" || error?.code === "42883";
}

type SnapshotRpcClient = { rpc(name: "create_project_snapshot", args: { p_quotation_id: string }): PromiseLike<{ data: unknown; error: { code?: string | null; message?: string | null } | null }> };

/** Never throws: the Project File is already saved and must stay saved. Anything missed is picked up by backfill_project_snapshots. */
export async function saveProjectSnapshot(supabase: SnapshotRpcClient, quotationId: string): Promise<ProjectSnapshotAttempt> {
  try {
    const { data, error } = await supabase.rpc("create_project_snapshot", { p_quotation_id: quotationId });
    if (isMissingFunctionError(error)) {
      console.warn("PROJECT SNAPSHOT FUNCTION NOT AVAILABLE", { quotationId });
      return "function_missing";
    }
    if (error) {
      console.error("PROJECT SNAPSHOT ERROR", { quotationId, code: error.code, message: error.message });
      return "failed";
    }
    return (data as { created?: unknown } | null)?.created === true ? "created" : "existed";
  } catch (error) {
    console.error("PROJECT SNAPSHOT ERROR", { quotationId, message: error instanceof Error ? error.message : String(error) });
    return "failed";
  }
}

/** The only thing a user can ever see from the snapshot: a small note when a real attempt failed. A migration not yet applied shows nothing. */
export function projectSnapshotNotice(attempt: ProjectSnapshotAttempt) {
  return attempt === "failed" ? " The Project copy will be made later." : "";
}
