export const COMMISSION_FORMULA_TYPES = [
  "percentage",
  "fixed_amount",
  "tiered_percentage",
  "percentage_plus_fixed",
  "none",
] as const;

export const COMMISSION_BASIS_TYPES = [
  "approved_total_including_vat",
  "approved_total_excluding_vat",
] as const;

export type CommissionFormulaType = (typeof COMMISSION_FORMULA_TYPES)[number];
export type CommissionBasisType = (typeof COMMISSION_BASIS_TYPES)[number];

export type CommissionTier = {
  maximum: number | string | null;
  minimum: number | string;
  rate: number | string;
};

export type CommissionCalculationInput = {
  basisAmount: string | null;
  currency: string;
  fixedAmount?: string | null;
  fixedAmountCurrency?: string | null;
  formulaType: CommissionFormulaType;
  percentageRate?: string | null;
  tierMethod?: "slab" | null;
  tiers?: CommissionTier[] | null;
};

export type CommissionCalculationResult = {
  commissionableBase: string | null;
  currency: string;
  fixedComponent: string;
  matchedTier: CommissionTier | null;
  originalCalculatedAmount: string;
  percentageComponent: string;
  validationErrors: string[];
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const MAX_RATE = BigInt(1000000);

function parseScaledDecimal(value: number | string | null | undefined, scale: number): bigint | null {
  const normalized = value === null || value === undefined ? "" : String(value).trim();
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return null;

  const [whole, fraction = ""] = normalized.split(".");
  const padded = `${fraction}${"0".repeat(scale)}`.slice(0, scale);
  const discarded = fraction.slice(scale);
  let scaled = BigInt(whole) * (TEN ** BigInt(scale)) + BigInt(padded || "0");

  if (discarded && Number(discarded[0]) >= 5) {
    scaled += ONE;
  }

  return scaled;
}

function formatScaledDecimal(value: bigint, scale: number) {
  const divisor = TEN ** BigInt(scale);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(scale, "0");
  return `${whole}.${fraction}`;
}

function roundedDivide(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / TWO) / denominator;
}

function validateTiers(tiers: CommissionTier[] | null | undefined) {
  const errors: string[] = [];
  if (!tiers?.length) return ["Add at least one commission tier."];

  let expectedMinimum = ZERO;
  let openEndedTiers = 0;

  tiers.forEach((tier, index) => {
    const minimum = parseScaledDecimal(tier.minimum, 2);
    const maximum = tier.maximum === null ? null : parseScaledDecimal(tier.maximum, 2);
    const rate = parseScaledDecimal(tier.rate, 4);

    if (minimum === null || rate === null) {
      errors.push(`Tier ${index + 1} contains an invalid number.`);
      return;
    }
    if (minimum !== expectedMinimum) {
      errors.push(`Tier ${index + 1} must start at ${formatScaledDecimal(expectedMinimum, 2)}.`);
    }
    if (rate > MAX_RATE) {
      errors.push(`Tier ${index + 1} rate cannot exceed 100%.`);
    }
    if (maximum === null) {
      openEndedTiers += 1;
      if (index !== tiers.length - 1) {
        errors.push("Only the final tier can be open-ended.");
      }
    } else if (maximum <= minimum) {
      errors.push(`Tier ${index + 1} maximum must be greater than its minimum.`);
    } else {
      expectedMinimum = maximum;
    }
  });

  if (openEndedTiers !== 1) {
    errors.push("The final tier must be the single open-ended tier.");
  }

  return errors;
}

export function calculateCommission(
  input: CommissionCalculationInput,
): CommissionCalculationResult {
  const errors: string[] = [];
  const basis = parseScaledDecimal(input.basisAmount, 2);
  const rate = parseScaledDecimal(input.percentageRate, 4);
  const fixed = parseScaledDecimal(input.fixedAmount, 2);
  let matchedTier: CommissionTier | null = null;
  let percentageComponent = ZERO;
  let fixedComponent = ZERO;

  if (input.formulaType !== "none" && input.formulaType !== "fixed_amount" && basis === null) {
    errors.push("A valid commission basis is required.");
  }

  if (input.formulaType === "percentage" || input.formulaType === "percentage_plus_fixed") {
    if (rate === null) {
      errors.push("A valid percentage rate is required.");
    } else if (rate > MAX_RATE) {
      errors.push("Percentage rate cannot exceed 100%.");
    } else if (basis !== null) {
      percentageComponent = roundedDivide(basis * rate, MAX_RATE);
    }
  }

  if (input.formulaType === "fixed_amount" || input.formulaType === "percentage_plus_fixed") {
    if (fixed === null) {
      errors.push("A valid fixed amount is required.");
    } else if (
      !input.fixedAmountCurrency ||
      input.fixedAmountCurrency.trim().toUpperCase() !== input.currency.trim().toUpperCase()
    ) {
      errors.push("Fixed amount currency does not match the approval currency.");
    } else {
      fixedComponent = fixed;
    }
  }

  if (input.formulaType === "tiered_percentage") {
    if (input.tierMethod !== "slab") {
      errors.push("Tier method must be slab.");
    }
    errors.push(...validateTiers(input.tiers));

    if (basis !== null && errors.length === 0) {
      matchedTier = input.tiers?.find((tier) => {
        const minimum = parseScaledDecimal(tier.minimum, 2);
        const maximum = tier.maximum === null ? null : parseScaledDecimal(tier.maximum, 2);
        return minimum !== null && basis >= minimum && (maximum === null || basis < maximum);
      }) ?? null;

      const tierRate =
        parseScaledDecimal(input.percentageRate, 4) ??
        parseScaledDecimal(matchedTier?.rate, 4);
      if (!matchedTier || tierRate === null) {
        errors.push("No tier matches the commission basis.");
      } else if (tierRate > MAX_RATE) {
        errors.push("Percentage rate cannot exceed 100%.");
      } else {
        percentageComponent = roundedDivide(basis * tierRate, MAX_RATE);
      }
    }
  }

  const originalAmount =
    errors.length || input.formulaType === "none"
      ? ZERO
      : percentageComponent + fixedComponent;

  return {
    commissionableBase: basis === null ? null : formatScaledDecimal(basis, 2),
    currency: input.currency.trim().toUpperCase(),
    fixedComponent: formatScaledDecimal(fixedComponent, 2),
    matchedTier,
    originalCalculatedAmount: formatScaledDecimal(originalAmount, 2),
    percentageComponent: formatScaledDecimal(percentageComponent, 2),
    validationErrors: errors,
  };
}
