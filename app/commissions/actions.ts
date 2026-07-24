"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  calculateCommission,
  COMMISSION_BASIS_TYPES,
  COMMISSION_FORMULA_TYPES,
  type CommissionBasisType,
  type CommissionFormulaType,
  type CommissionTier,
} from "@/lib/commissions/calculation";
import {
  requireCommissionEditor,
  requireCommissionManager,
  requireCommissionViewer,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, name: string) {
  return textValue(formData, name) || null;
}

function numericText(formData: FormData, name: string) {
  const value = optionalText(formData, name);
  return value && /^\d+(?:\.\d+)?$/.test(value) ? value : null;
}

function optionalOverrideNumber(formData: FormData, name: string, label: string) {
  const value = optionalText(formData, name);
  if (value === null) return { error: null, value: null };
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    return { error: `${label} must be a valid non-negative number.`, value: null };
  }
  return { error: null, value };
}

function normalizedDecimal(value: string | null) {
  if (value === null) return null;
  const [whole, fraction = ""] = value.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function optionalTimestamp(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function commissionRedirect(path: string, message: string, type: "error" | "success" = "success"): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

function rpcErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

function isFormulaType(value: string): value is CommissionFormulaType {
  return COMMISSION_FORMULA_TYPES.includes(value as CommissionFormulaType);
}

function isBasisType(value: string): value is CommissionBasisType {
  return COMMISSION_BASIS_TYPES.includes(value as CommissionBasisType);
}

function tiersFromForm(formData: FormData): CommissionTier[] {
  const minimums = formData.getAll("tier_minimum");
  const maximums = formData.getAll("tier_maximum");
  const rates = formData.getAll("tier_rate");

  return minimums.map((minimum, index) => ({
    minimum: typeof minimum === "string" ? minimum.trim() : "",
    maximum:
      typeof maximums[index] === "string" && maximums[index].trim()
        ? maximums[index].trim()
        : null,
    rate: typeof rates[index] === "string" ? rates[index].trim() : "",
  }));
}

export async function createCommissionRuleVersion(formData: FormData) {
  await requireCommissionManager();
  const salespersonId = textValue(formData, "salesperson_id");
  const formulaTypeValue = textValue(formData, "formula_type");
  const basisValue = textValue(formData, "basis_type");
  const percentageRate = numericText(formData, "percentage_rate");
  const fixedAmount = numericText(formData, "fixed_amount");
  const fixedAmountCurrency = optionalText(formData, "fixed_amount_currency")?.toUpperCase() ?? null;
  const effectiveFrom = optionalTimestamp(optionalText(formData, "effective_from"));
  const effectiveToRaw = optionalText(formData, "effective_to");
  const effectiveTo = optionalTimestamp(effectiveToRaw);
  const notes = optionalText(formData, "notes");

  if (!salespersonId || !isFormulaType(formulaTypeValue) || !effectiveFrom) {
    commissionRedirect("/settings/commissions", "Complete the Sales Manager, formula, and effective-from fields.", "error");
  }

  if (effectiveToRaw && !effectiveTo) {
    commissionRedirect("/settings/commissions", "Effective-to date is invalid.", "error");
  }

  const basisType =
    formulaTypeValue === "fixed_amount" || formulaTypeValue === "none"
      ? null
      : isBasisType(basisValue) ? basisValue : null;
  const tiers = formulaTypeValue === "tiered_percentage" ? tiersFromForm(formData) : null;
  const preview = calculateCommission({
    basisAmount: formulaTypeValue === "fixed_amount" ? null : "100000",
    currency: fixedAmountCurrency || "AED",
    fixedAmount: formulaTypeValue === "fixed_amount" || formulaTypeValue === "percentage_plus_fixed"
      ? fixedAmount
      : null,
    fixedAmountCurrency,
    formulaType: formulaTypeValue,
    percentageRate: formulaTypeValue === "percentage" || formulaTypeValue === "percentage_plus_fixed"
      ? percentageRate
      : null,
    tierMethod: formulaTypeValue === "tiered_percentage" ? "slab" : null,
    tiers,
  });

  if (
    (formulaTypeValue !== "none" && formulaTypeValue !== "fixed_amount" && !basisType)
    || preview.validationErrors.length
  ) {
    commissionRedirect(
      "/settings/commissions",
      preview.validationErrors[0] || "Select a valid commission basis.",
      "error",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_sales_commission_rule_version", {
    p_basis_type: basisType,
    p_effective_from: effectiveFrom,
    p_effective_to: effectiveTo,
    p_fixed_amount:
      formulaTypeValue === "fixed_amount" || formulaTypeValue === "percentage_plus_fixed"
        ? fixedAmount
        : null,
    p_fixed_amount_currency:
      formulaTypeValue === "fixed_amount" || formulaTypeValue === "percentage_plus_fixed"
        ? fixedAmountCurrency
        : null,
    p_formula_type: formulaTypeValue,
    p_notes: notes,
    p_percentage_rate:
      formulaTypeValue === "percentage" || formulaTypeValue === "percentage_plus_fixed"
        ? percentageRate
        : null,
    p_salesperson_id: salespersonId,
    p_tier_configuration: tiers,
    p_tier_method: formulaTypeValue === "tiered_percentage" ? "slab" : null,
  });

  if (error) {
    commissionRedirect("/settings/commissions", rpcErrorMessage(error, "Commission rule could not be saved."), "error");
  }

  revalidatePath("/settings/commissions");
  revalidatePath("/commissions");
  commissionRedirect("/settings/commissions", "Commission rule version saved.");
}

export async function saveCommissionDraft(formData: FormData) {
  await requireCommissionEditor();
  const commissionId = textValue(formData, "commission_id");
  const ruleId = textValue(formData, "rule_id");
  const returnPath = commissionId ? `/commissions/${commissionId}` : "/commissions";

  if (!commissionId || !ruleId) {
    commissionRedirect(returnPath, "Select a commission rule.", "error");
  }

  const supabase = await createClient();
  const { data: rule } = await supabase
    .from("sales_commission_rules")
    .select("formula_type,percentage_rate,fixed_amount,fixed_amount_currency,tier_configuration,tier_method")
    .eq("id", ruleId)
    .maybeSingle<{
      formula_type: CommissionFormulaType;
      percentage_rate: number | null;
      fixed_amount: number | null;
      fixed_amount_currency: string | null;
      tier_configuration: CommissionTier[] | null;
      tier_method: "slab" | null;
    }>();
  const currency = textValue(formData, "currency");
  const baseOverrideInput = optionalOverrideNumber(formData, "base_override", "Base override");
  const rateOverrideInput = optionalOverrideNumber(
    formData,
    "percentage_rate_override",
    "Rate override",
  );
  const fixedOverrideInput = optionalOverrideNumber(
    formData,
    "fixed_amount_override",
    "Fixed override",
  );
  const finalOverrideInput = optionalOverrideNumber(
    formData,
    "final_commission_amount_override",
    "Final amount override",
  );
  const invalidOverride = [
    baseOverrideInput,
    rateOverrideInput,
    fixedOverrideInput,
    finalOverrideInput,
  ].find((input) => input.error);

  if (invalidOverride?.error) {
    commissionRedirect(returnPath, invalidOverride.error, "error");
  }

  const baseOverride = baseOverrideInput.value;
  const rateOverride = rateOverrideInput.value;
  const fixedOverride = fixedOverrideInput.value;
  const finalOverride = finalOverrideInput.value;
  const existingRuleId = optionalText(formData, "existing_rule_id");
  const financialChange =
    ruleId !== existingRuleId ||
    normalizedDecimal(baseOverride) !== normalizedDecimal(optionalText(formData, "existing_base_override")) ||
    normalizedDecimal(rateOverride) !== normalizedDecimal(optionalText(formData, "existing_rate_override")) ||
    normalizedDecimal(fixedOverride) !== normalizedDecimal(optionalText(formData, "existing_fixed_override")) ||
    normalizedDecimal(finalOverride) !== normalizedDecimal(optionalText(formData, "existing_final_override"));
  const overrideReason = optionalText(formData, "override_reason");

  if (financialChange && !overrideReason) {
    commissionRedirect(returnPath, "An override reason is required for financial changes.", "error");
  }

  if (rule) {
    const validation = calculateCommission({
      basisAmount: baseOverride || optionalText(formData, "current_basis"),
      currency,
      fixedAmount: fixedOverride || (rule.fixed_amount === null ? null : String(rule.fixed_amount)),
      fixedAmountCurrency: rule.fixed_amount_currency,
      formulaType: rule.formula_type,
      percentageRate:
        rateOverride ||
        (rule.formula_type === "tiered_percentage"
          ? null
          : (rule.percentage_rate === null ? null : String(rule.percentage_rate))),
      tierMethod: rule.tier_method,
      tiers: rule.tier_configuration,
    });
    if (validation.validationErrors.length && baseOverride) {
      commissionRedirect(returnPath, validation.validationErrors[0], "error");
    }
  }

  const { error } = await supabase.rpc("recalculate_sales_commission", {
    p_base_override: baseOverride,
    p_commission_id: commissionId,
    p_final_amount_override: finalOverride,
    p_fixed_amount_override: fixedOverride,
    p_management_notes: optionalText(formData, "management_notes"),
    p_override_reason: financialChange ? overrideReason : null,
    p_percentage_rate_override: rateOverride,
    p_rule_id: ruleId,
  });

  if (error) {
    commissionRedirect(returnPath, rpcErrorMessage(error, "Commission could not be recalculated."), "error");
  }

  revalidatePath(returnPath);
  revalidatePath("/commissions");
  commissionRedirect(returnPath, "Draft commission saved.");
}

export async function transitionCommission(formData: FormData) {
  await requireCommissionViewer();
  const commissionId = textValue(formData, "commission_id");
  const targetStatus = textValue(formData, "target_status");
  const returnPath = commissionId ? `/commissions/${commissionId}` : "/commissions";

  if (!commissionId || !targetStatus) {
    commissionRedirect(returnPath, "Commission status action is incomplete.", "error");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_sales_commission", {
    p_commission_id: commissionId,
    p_reason: optionalText(formData, "reason"),
    p_target_status: targetStatus,
  });

  if (error) {
    commissionRedirect(returnPath, rpcErrorMessage(error, "Commission status could not be changed."), "error");
  }

  revalidatePath(returnPath);
  revalidatePath("/commissions");
  commissionRedirect(returnPath, "Commission status updated.");
}
