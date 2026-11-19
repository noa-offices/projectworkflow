/**
 * Which choosers the Product Library configurator offers. Pure: it only combines the flags the selector already computes.
 *
 * Modular items and base items are separate. When the configuration is driven by MODULAR items or by a WORKSTATION, Base / Model and
 * Price Matrix are not offered (the price order is workstation, modular, Base / Model, Price Matrix, so they could not change the price
 * anyway). usesVariantPricing already excludes the workstation flow and usesCategoryPricing already excludes modular pricing, so only the
 * remaining overlaps are removed here. Nothing here changes a price. System / Base, accessories, required components, options and
 * finishes are not part of this decision.
 */
export function configuratorChoosers(flags: {
  usesWorkstationFlow: boolean;
  usesVariantPricing: boolean;
  usesModularPricing: boolean;
  usesCategoryPricing: boolean;
}): { showBaseModelChooser: boolean; showPriceMatrixChooser: boolean } {
  return {
    showBaseModelChooser: flags.usesVariantPricing && !flags.usesModularPricing && !flags.usesWorkstationFlow,
    showPriceMatrixChooser: flags.usesCategoryPricing && !flags.usesModularPricing && !flags.usesWorkstationFlow,
  };
}
