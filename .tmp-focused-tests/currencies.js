"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportedCurrencies = exports.defaultCurrency = void 0;
exports.normalizeCurrency = normalizeCurrency;
exports.formatMoney = formatMoney;
exports.defaultCurrency = "AED";
exports.supportedCurrencies = [
    { code: "AED", label: "AED - UAE Dirham" },
    { code: "EUR", label: "EUR - Euro" },
    { code: "USD", label: "USD - US Dollar" },
];
// TODO: Future currency conversion phase should add an exchange_rates table
// with AED as base currency, source currency, rate to AED, rate date, manual
// admin updates, later optional live API sync, and quotation item original
// currency plus converted AED amount.
const supportedCurrencyCodes = new Set(exports.supportedCurrencies.map((currency) => currency.code));
function normalizeCurrency(value) {
    const code = value?.trim().toUpperCase() ?? "";
    return supportedCurrencyCodes.has(code) ? code : exports.defaultCurrency;
}
function formatMoney(currency, value, options) {
    return `${normalizeCurrency(currency)} ${value.toLocaleString("en-US", {
        minimumFractionDigits: options?.minimumFractionDigits ?? 2,
        maximumFractionDigits: options?.maximumFractionDigits ?? 2,
        ...options,
    })}`;
}
