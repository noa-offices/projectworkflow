import type { AccessoryApplicabilityTarget } from "./accessory-conditional-configuration";

/**
 * One shared priority for the Main Product targets that Required Components are evaluated against, used by
 * both the quotation selector and the add-to-quotation server action so they cannot disagree:
 * workstation size, then modular items (only when a modular item is selected), then Base / Model,
 * then Price Matrix. Candidate arrays are empty when that way is not selected. A template that offers both modular items and Base / Model
 * uses one way per line: with no modular item selected the Base / Model (or Price Matrix) targets apply.
 */
export function resolveMainAccessoryTargets(candidates: {
  workstation: AccessoryApplicabilityTarget[];
  usesModularPricing: boolean;
  modular: AccessoryApplicabilityTarget[];
  baseModel: AccessoryApplicabilityTarget[];
  priceMatrix: AccessoryApplicabilityTarget[];
}): AccessoryApplicabilityTarget[] {
  if (candidates.workstation.length) return candidates.workstation;
  if (candidates.usesModularPricing && (candidates.modular.length || !(candidates.baseModel.length || candidates.priceMatrix.length))) return candidates.modular;
  if (candidates.baseModel.length) return candidates.baseModel;
  return candidates.priceMatrix;
}
