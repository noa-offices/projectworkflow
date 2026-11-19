/**
 * The two pricing modes of the Product Library configurator, and which choosers each one leaves available. Pure: it only combines flags
 * and selections the selector, the server action and replay already have.
 *
 * A template can offer BOTH modes (for example modular bench items AND a Base / Model list, maybe a Price Matrix). All choosers are shown,
 * but one line can use only ONE mode:
 *   (a) modular / workstation: modular items with a quantity above 0, or a workstation size;
 *   (b) base: a Base / Model row, or a Price Matrix choice.
 * Choosing in one mode disables the other mode's choosers (visible, greyed) and clears its values; clearing the selection enables both again.
 * A template that offers only one mode is never constrained. System / Base, accessories, required components, options and finishes are
 * not part of this decision.
 */
export const MODULAR_SELECTED_NOTE = "Modular items selected. Choose a model / size as a separate product.";
export const WORKSTATION_SELECTED_NOTE = "Workstation size selected. Choose a model / size as a separate product.";
export const BASE_SELECTED_NOTE = "Model / size selected. Clear it to configure modular items.";
export const MODES_COMBINED_MESSAGE = "Modular items (or a workstation size) and a model / size cannot be combined in one line. Clear one of them, or add the product again as a separate line.";
export const MODULAR_REQUIRED_MESSAGE = "Select at least one modular item before adding this product.";
export const MODULAR_OR_BASE_REQUIRED_MESSAGE = "Select at least one modular item or a model / size before adding this product.";

export type ConfiguratorModeInput = {
  /** The template has active modular rows. */
  hasModularRows: boolean;
  /** The template has workstation sizes. */
  hasWorkstationRows: boolean;
  /** The template offers a Base / Model chooser (Base / Model rows, and not the workstation flow, where those rows are workstation variants). */
  hasBaseModelRows: boolean;
  /** The template offers a Price Matrix chooser. */
  hasPriceMatrixRows: boolean;
  /** A modular row has a quantity above 0. */
  modularSelected: boolean;
  /** A workstation size is selected. */
  workstationSelected: boolean;
  /** A Base / Model row is selected. */
  baseModelSelected: boolean;
  /** A Price Matrix choice was made by the user. */
  priceMatrixSelected: boolean;
};

export type ConfiguratorModes = {
  /** "none": nothing selected; "modular": modular items or a workstation size; "base": a Base / Model row or a Price Matrix choice. */
  mode: "none" | "modular" | "base";
  /** The template offers both modes, so one disables the other. When false nothing is ever disabled (a one-mode template behaves as before). */
  exclusive: boolean;
  modularDisabled: boolean;
  workstationDisabled: boolean;
  baseModelDisabled: boolean;
  priceMatrixDisabled: boolean;
  /** The short note to show in the disabled mode, or null. */
  reason: string | null;
  /** What the line prices and saves from. A value from the other mode is ignored (the selector also clears it). */
  useModular: boolean;
  useWorkstation: boolean;
  useBaseModel: boolean;
  usePriceMatrix: boolean;
};

export function configuratorModes(input: ConfiguratorModeInput): ConfiguratorModes {
  const modularSide = input.hasModularRows || input.hasWorkstationRows;
  const baseSide = input.hasBaseModelRows || input.hasPriceMatrixRows;
  const exclusive = modularSide && baseSide;
  const modularChosen = input.modularSelected || input.workstationSelected;
  const baseChosen = input.baseModelSelected || input.priceMatrixSelected;
  // A saved line that somehow carries both keeps the MODULAR side (it priced from the modular rows before): the base values are ignored.
  const mode: ConfiguratorModes["mode"] = modularChosen ? "modular" : baseChosen ? "base" : "none";
  const modularMode = exclusive && mode === "modular";
  const baseMode = exclusive && mode === "base";
  return {
    mode,
    exclusive,
    modularDisabled: baseMode,
    workstationDisabled: baseMode,
    baseModelDisabled: modularMode,
    priceMatrixDisabled: modularMode,
    reason: modularMode ? (input.modularSelected ? MODULAR_SELECTED_NOTE : WORKSTATION_SELECTED_NOTE) : baseMode ? BASE_SELECTED_NOTE : null,
    useModular: !baseMode && input.modularSelected,
    useWorkstation: !baseMode && input.workstationSelected,
    useBaseModel: !modularMode && input.baseModelSelected,
    usePriceMatrix: !modularMode && input.priceMatrixSelected,
  };
}

/**
 * Server-authoritative check: a payload that carries BOTH modes with positive values is rejected (never silently pick one). Only a template
 * that offers both modes is constrained; a one-mode template is never affected.
 */
export function pricingModesProblem(input: { exclusive: boolean; modularSelected: boolean; workstationSelected: boolean; baseSelected: boolean }): string | null {
  return input.exclusive && (input.modularSelected || input.workstationSelected) && input.baseSelected ? MODES_COMBINED_MESSAGE : null;
}

/** The "nothing selected" error for a modular template: extended with "or a model / size" when the template also has Base / Model rows. */
export function modularMissingMessage(hasBaseModelRows: boolean): string {
  return hasBaseModelRows ? MODULAR_OR_BASE_REQUIRED_MESSAGE : MODULAR_REQUIRED_MESSAGE;
}
