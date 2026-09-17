"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accessoryPricingErrorMessage = accessoryPricingErrorMessage;
const messages = {
    unknown_base_model_reference: "Required option configuration refers to a model that is no longer available in Base/Model pricing.",
    unknown_workstation_reference: "Required option configuration refers to a workstation configuration that is no longer available.",
    unknown_modular_reference: "Required option configuration refers to a modular item that is no longer available.",
    unknown_price_matrix_reference: "Required option configuration refers to a price-matrix row that is no longer available.",
    fixed_quantity_mismatch: "The required quantity for this option does not match the selected configuration.",
    invalid_cardinality: "The required option selection rule is not satisfied.",
    missing_required_companion: "A required companion item is missing.",
    incompatible_selected_option: "The selected option is not valid for this model or configuration.",
};
function accessoryPricingErrorMessage(issue) {
    const code = issue?.code ?? "unknown";
    const primary = messages[code] ?? issue?.message ?? "Invalid accessory pricing data.";
    const detail = [issue?.message, issue?.path].filter(Boolean).join(" Details: ");
    return detail && messages[code] ? `${primary} Details: Issue: ${code}. ${detail}` : primary;
}
