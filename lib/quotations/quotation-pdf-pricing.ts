import { roundExact2, type PricingRule } from "../quotation-pricing";

type PdfLine = { unit_price: number; discount_type: string; discount_value: number; net_price: number; net_total: number; qty: number };
type PdfQuotation = { subtotal: number; discount_total: number; vat_amount: number; grand_total: number; overall_discount_type: string; overall_discount_value: number };

export function pdfLineAmounts(rule: PricingRule | null | undefined, item: PdfLine) {
  return {
    unitPrice: item.unit_price,
    discountAmount: rule === "whole_aed_v1" ? roundExact2(item.unit_price - item.net_price) : item.discount_type === "percent" ? item.unit_price * item.qty - item.net_total : item.discount_value,
    netPrice: item.net_price,
    netTotal: item.net_total,
  };
}

export function pdfTotals(rule: PricingRule | null | undefined, quotation: PdfQuotation) {
  const itemNetTotal = Math.max(quotation.subtotal - quotation.discount_total, 0);
  const rawOverall = quotation.overall_discount_type === "percent" ? itemNetTotal * quotation.overall_discount_value / 100 : quotation.overall_discount_value;
  const overallDiscount = rule === "whole_aed_v1" ? roundExact2(Math.min(Math.max(rawOverall, 0), itemNetTotal)) : rawOverall;
  return {
    subtotal: quotation.subtotal,
    itemDiscount: quotation.discount_total,
    overallDiscount,
    netAfterDiscount: rule === "whole_aed_v1" ? roundExact2(itemNetTotal - overallDiscount) : itemNetTotal - overallDiscount,
    vat: quotation.vat_amount,
    grandTotal: quotation.grand_total,
  };
}
