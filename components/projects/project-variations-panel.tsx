import Link from "next/link";
import { contractChangeText, VariationApplyConfirm, VariationChangeList } from "@/components/projects/variation-apply-confirm";
import type { AppliedVariation } from "@/lib/projects/project-scope";
import type { ConfirmedVariation } from "@/lib/projects/project-variations";
import { formatRuleMoney, type PricingRule } from "@/lib/quotation-pricing";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

/** The Project's contract and its variations: what was agreed first, what each variation changed, and what stands now. */
export function ProjectVariationsPanel({ applied, confirmed, contractCurrency, originalContractTotal, originalPricingRule, returnTo, revisedContractTotal, vendorWarnings }: {
  applied: AppliedVariation[];
  confirmed: ConfirmedVariation[];
  contractCurrency: string;
  originalContractTotal: number;
  originalPricingRule: PricingRule;
  returnTo: string;
  revisedContractTotal: number;
  vendorWarnings: Array<{ vendorLabel: string; notes: string[] }>;
}) {
  const money = (rule: PricingRule, value: number) => formatRuleMoney(rule, contractCurrency, value);
  const signed = (rule: PricingRule, value: number) => `${value < 0 ? "-" : "+"}${money(rule, Math.abs(value))}`;
  return (
    <section className="mb-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">Variations</h2>
      {applied.length ? (
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-zinc-500">Original contract</dt><dd className="font-semibold text-zinc-900">{money(originalPricingRule, originalContractTotal)}</dd></div>
          {applied.map((variation) => (
            <div key={variation.id} className="flex justify-between gap-3"><dt className="text-zinc-500">V{variation.variationNo}</dt><dd className="font-semibold text-zinc-900">{signed(variation.pricingRule, variation.contractDelta)}</dd></div>
          ))}
          <div className="flex justify-between gap-3 border-t border-zinc-100 pt-2"><dt className="font-semibold text-zinc-700">Revised contract total</dt><dd className="font-semibold text-zinc-950">{money(applied.at(-1)!.pricingRule, revisedContractTotal)}</dd></div>
        </dl>
      ) : null}
      {vendorWarnings.length ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <p className="font-semibold">Check orders already placed: these vendors have procurement progress and their lines changed.</p>
          <ul className="mt-1 grid gap-1">
            {vendorWarnings.map((vendor) => <li key={vendor.vendorLabel}>{vendor.vendorLabel}: {vendor.notes.join("; ")}</li>)}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3">
        {confirmed.map((variation) => (
          <div key={variation.id} className="grid gap-2 rounded-md border border-zinc-200 p-3">
            <p className="text-sm font-semibold text-zinc-900">
              V{variation.variationNo} is Client Confirmed. <Link className="text-emerald-900 underline" href={`/quotations/${variation.id}`}>{variation.quotationNo}</Link>
            </p>
            <VariationApplyConfirm preview={variation.preview} returnTo={returnTo} variationNo={variation.variationNo} variationQuotationId={variation.id} />
          </div>
        ))}
        {applied.map((variation) => (
          <details key={variation.id} className="rounded-md border border-zinc-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
              V{variation.variationNo}, R{variation.baseRevisionNo} · V{variation.variationNo}: {contractChangeText(variation.pricingRule, variation.currency, variation.previousContractTotal, variation.newContractTotal)}
            </summary>
            <p className="mt-2 text-xs text-zinc-500">
              Applied {formatDate(variation.appliedAt)}{variation.appliedByName ? ` by ${variation.appliedByName}` : ""}. <Link className="text-emerald-900 underline" href={`/quotations/${variation.variationQuotationId}`}>{variation.variationQuotationNo}</Link>
            </p>
            <div className="mt-2"><VariationChangeList currency={variation.currency} rule={variation.pricingRule} summary={variation.changeSummary} /></div>
          </details>
        ))}
      </div>
    </section>
  );
}
