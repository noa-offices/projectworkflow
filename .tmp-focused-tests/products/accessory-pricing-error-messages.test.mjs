import assert from "node:assert/strict";
import test from "node:test";
import { accessoryPricingErrorMessage } from "./accessory-pricing-error-messages.js";
test("maps known accessory pricing issues while retaining technical detail", () => {
    const message = accessoryPricingErrorMessage({ code: "unknown_base_model_reference", message: "Base/Model reference 'legacy-base-model-main / oxi-q-ws-dx' does not exist.", path: "optionGroups[0]" });
    assert.ok(message.startsWith("Required option configuration refers"));
    assert.ok(message.includes("unknown_base_model_reference"));
    assert.ok(message.includes("legacy-base-model-main / oxi-q-ws-dx"));
    assert.equal(accessoryPricingErrorMessage({ code: "unknown_modular_reference", message: "raw" }), "Required option configuration refers to a modular item that is no longer available. Details: Issue: unknown_modular_reference. raw");
    assert.equal(accessoryPricingErrorMessage({ code: "other", message: "raw validator message" }), "raw validator message");
});
