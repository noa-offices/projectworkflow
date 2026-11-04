import { applyProjectVariation } from "@/app/quotations/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type { VariationChangeLine, VariationChangeSummary } from "@/lib/projects/project-scope";
import type { VariationPreview } from "@/lib/projects/project-variations";
import { formatRuleMoney, type PricingRule } from "@/lib/quotation-pricing";

function lineName(line: VariationChangeLine) {
  return line.item_name ?? line.item_code ?? "Line";
}

function changeDetails(line: VariationChangeLine, money: (value: unknown) => string) {
  const parts: string[] = [];
  if (line.item_name_before !== line.item_name) parts.push(`name was ${line.item_name_before ?? "blank"}`);
  if (Number(line.qty_before) !== Number(line.qty)) parts.push(`qty ${line.qty_before} -> ${line.qty}`);
  if (Number(line.unit_price_before) !== Number(line.unit_price)) parts.push(`price ${money(line.unit_price_before)} -> ${money(line.unit_price)}`);
  if (Number(line.net_total_before) !== Number(line.net_total)) parts.push(`total ${money(line.net_total_before)} -> ${money(line.net_total)}`);
  return parts.join(", ") || "details changed";
}

/** Added, removed and changed lines. Shared by the confirm step and the Project's Variations list. */
export function VariationChangeList({ currency, rule, summary }: { currency: string; rule: PricingRule; summary: VariationChangeSummary }) {
  const money = (value: unknown) => formatRuleMoney(rule, currency, value);
  const added = summary.added ?? [], removed = summary.removed ?? [], changed = summary.changed ?? [];
  if (!added.length && !removed.length && !changed.length) return <p className="text-xs text-zinc-500">No lines changed.</p>;
  return (
    <ul className="grid gap-1 text-xs text-zinc-700">
      {added.map((line, index) => <li key={`a${index}`}>Added: {lineName(line)}, qty {line.qty}, {money(line.net_total)}</li>)}
      {removed.map((line, index) => <li key={`r${index}`}>Removed: {lineName(line)}, qty {line.qty}, {money(line.net_total)}</li>)}
      {changed.map((line, index) => <li key={`c${index}`}>Changed: {lineName(line)}: {changeDetails(line, money)}</li>)}
    </ul>
  );
}

/** "AED 20,937 -> AED 25,575.90 (+AED 4,638.90)" */
export function contractChangeText(rule: PricingRule, currency: string, before: number, after: number) {
  const delta = after - before;
  return `${formatRuleMoney(rule, currency, before)} -> ${formatRuleMoney(rule, currency, after)} (${delta < 0 ? "-" : "+"}${formatRuleMoney(rule, currency, Math.abs(delta))})`;
}

/** Update Project File: the button opens the summary, and only the confirm button inside it applies. */
export function VariationApplyConfirm({ preview, returnTo, variationNo, variationQuotationId }: { preview: VariationPreview; returnTo: string; variationNo: number; variationQuotationId: string }) {
  return (
    <details className="rounded-md border border-emerald-200 bg-emerald-50/40">
      <summary className="inline-flex h-10 cursor-pointer items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white">Update Project File</summary>
      <div className="grid gap-3 p-3">
        <p className="text-sm font-semibold text-zinc-900">
          Variation V{variationNo}: {contractChangeText(preview.pricing_rule, preview.currency, Number(preview.previous_contract_total), Number(preview.new_contract_total))}
        </p>
        <VariationChangeList currency={preview.currency} rule={preview.pricing_rule} summary={preview.change_summary} />
        <p className="text-xs text-zinc-500">The Project will then show this variation&apos;s scope. The payment schedule stays as it is.</p>
        <form action={applyProjectVariation}>
          <input type="hidden" name="quotation_id" value={variationQuotationId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <PendingSubmitButton className="inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white" pendingLabel="Updating...">Confirm update</PendingSubmitButton>
        </form>
      </div>
    </details>
  );
}
