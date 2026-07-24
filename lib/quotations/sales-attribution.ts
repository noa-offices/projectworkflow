import {
  quotationOptionNoFromQuotationNo,
  quotationRootBaseNo,
} from "@/lib/quotation-options";
import { hasQualifyingProjectFile } from "@/lib/quotations/approval-display";

export type SalesAttributionQuotation = {
  created_at: string;
  id: string;
  layout_settings: unknown;
  option_no: number | null;
  quotation_no: string | null;
  revision_no: number | null;
  status: string;
  status_updated_at: string | null;
};

function quotationRevisionSequence(quotation: SalesAttributionQuotation): number {
  if (typeof quotation.revision_no === "number" && Number.isFinite(quotation.revision_no)) {
    return Math.max(Math.trunc(quotation.revision_no), 0);
  }

  const match = quotation.quotation_no?.trim().match(/-R(\d+)$/i);
  if (!match) return 0;

  const sequence = Number.parseInt(match[1], 10);
  return Number.isFinite(sequence) ? Math.max(sequence, 0) : 0;
}

function quotationOptionSequence(quotation: SalesAttributionQuotation): number {
  if (typeof quotation.option_no === "number" && Number.isFinite(quotation.option_no)) {
    return Math.max(Math.trunc(quotation.option_no), 1);
  }

  return quotationOptionNoFromQuotationNo(quotation.quotation_no) ?? 1;
}

export function quotationSalesFolderKey(
  quotation: Pick<SalesAttributionQuotation, "id" | "quotation_no">,
): string {
  return quotationRootBaseNo(quotation.quotation_no) ?? quotation.id;
}

function quotationSortTime(quotation: SalesAttributionQuotation): number {
  const statusUpdatedAt = quotation.status_updated_at
    ? new Date(quotation.status_updated_at).getTime()
    : 0;
  const createdAt = new Date(quotation.created_at).getTime();

  return Math.max(
    Number.isFinite(statusUpdatedAt) ? statusUpdatedAt : 0,
    Number.isFinite(createdAt) ? createdAt : 0,
  );
}

function primaryQuotationRank(quotation: SalesAttributionQuotation): number | null {
  const revisionBase = quotation.quotation_no?.trim().replace(/-R\d+$/i, "") ?? "";
  const hasOptionSuffix = /-(?:OPT-[A-Z]+|OPT\d+)$/i.test(revisionBase);
  const optionSequence = quotationOptionSequence(quotation);

  if (hasOptionSuffix || optionSequence > 1) return null;
  return quotation.option_no === null ? 0 : 1;
}

export function latestPrimaryQuotationsByFolder<T extends SalesAttributionQuotation>(
  quotations: T[],
): T[] {
  const byFolder = new Map<string, T[]>();

  for (const quotation of quotations) {
    const key = quotationSalesFolderKey(quotation);
    byFolder.set(key, [...(byFolder.get(key) ?? []), quotation]);
  }

  return Array.from(byFolder.entries()).map(([folderKey, folderQuotations]) => {
    const latestRevision = Math.max(...folderQuotations.map(quotationRevisionSequence));
    const latestRevisionQuotations = folderQuotations.filter(
      (quotation) => quotationRevisionSequence(quotation) === latestRevision,
    );
    const primaryQuotations = latestRevisionQuotations
      .map((quotation) => ({ quotation, rank: primaryQuotationRank(quotation) }))
      .filter((entry): entry is { quotation: T; rank: number } => entry.rank !== null)
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          quotationSortTime(right.quotation) - quotationSortTime(left.quotation),
      );

    const primaryQuotation = primaryQuotations[0]?.quotation;
    if (!primaryQuotation) {
      throw new Error(`Sales Report cannot identify a primary quotation for folder ${folderKey}.`);
    }

    return primaryQuotation;
  });
}

export function isApprovedSalesQuotation(quotation: SalesAttributionQuotation): boolean {
  return (
    quotation.status === "client_confirmed" &&
    hasQualifyingProjectFile(quotation.layout_settings)
  );
}

export function actualApprovedQuotationsByFolder<T extends SalesAttributionQuotation>(
  quotations: T[],
): T[] {
  const approvedByFolder = new Map<string, T>();

  for (const quotation of quotations.filter(isApprovedSalesQuotation)) {
    const key = quotationSalesFolderKey(quotation);
    const current = approvedByFolder.get(key);

    if (!current || quotationSortTime(quotation) > quotationSortTime(current)) {
      approvedByFolder.set(key, quotation);
    }
  }

  return Array.from(approvedByFolder.values());
}
