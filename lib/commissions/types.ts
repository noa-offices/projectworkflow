import type {
  CommissionBasisType,
  CommissionFormulaType,
  CommissionTier,
} from "@/lib/commissions/calculation";

export type CommissionStatus =
  | "draft"
  | "requires_review"
  | "pending_approval"
  | "approved"
  | "paid"
  | "cancelled"
  | "reversed";

export type CommissionRuleRow = {
  basis_type: CommissionBasisType | null;
  created_at: string;
  effective_from: string;
  effective_to: string | null;
  fixed_amount: number | null;
  fixed_amount_currency: string | null;
  formula_type: CommissionFormulaType;
  id: string;
  is_enabled: boolean;
  notes: string | null;
  percentage_rate: number | null;
  salesperson_id: string;
  tier_configuration: CommissionTier[] | null;
  tier_method: "slab" | null;
};

export type SalesManagerOption = {
  account_status: "pending" | "active" | "disabled";
  display_name: string;
  id: string;
};

export type SalesCommissionRow = {
  approval_snapshot_id: string;
  approved_at: string | null;
  approved_total_excluding_vat: number | null;
  approved_total_including_vat: number;
  basis_type_snapshot: CommissionBasisType | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  commissionable_base: number | null;
  commissionable_base_override: number | null;
  created_at: string;
  currency: string;
  earned_at: string;
  final_commission_amount: number;
  fixed_amount_currency_snapshot: string | null;
  fixed_amount_override: number | null;
  fixed_amount_snapshot: number | null;
  fixed_component: number;
  formula_configuration_snapshot: Record<string, unknown>;
  formula_type_snapshot: CommissionFormulaType | null;
  id: string;
  management_notes: string | null;
  matched_tier_snapshot: CommissionTier | null;
  original_calculated_amount: number;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  percentage_component: number;
  percentage_rate_override: number | null;
  percentage_rate_snapshot: number | null;
  quotation_folder_key: string;
  quotation_id: string;
  review_reason: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  rule_id: string | null;
  salesperson_id: string;
  source_type: string;
  status: CommissionStatus;
  submitted_by: string | null;
  submitted_at: string | null;
  tier_configuration_snapshot: CommissionTier[] | null;
  tier_method_snapshot: "slab" | null;
  updated_at: string;
  vat_amount: number | null;
};

export function commissionFormulaLabel(formula: CommissionFormulaType | null) {
  switch (formula) {
    case "percentage": return "Percentage";
    case "fixed_amount": return "Fixed amount";
    case "tiered_percentage": return "Tiered percentage";
    case "percentage_plus_fixed": return "Percentage + fixed";
    case "none": return "None";
    default: return "Rule required";
  }
}

export function commissionBasisLabel(basis: CommissionBasisType | null) {
  switch (basis) {
    case "approved_total_including_vat": return "Approved total incl. VAT";
    case "approved_total_excluding_vat": return "Approved total excl. VAT";
    default: return "Not applicable";
  }
}

export function commissionStatusLabel(status: CommissionStatus) {
  return status.split("_").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
}
