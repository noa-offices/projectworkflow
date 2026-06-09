"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPPORTUNITIES_STORAGE_KEY = "projectworkflow.sales.opportunities.v1";

function clean(value: string | null) {
  return value?.trim() ?? "";
}

export function OpportunityQuotationLinkSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const opportunityId = clean(searchParams.get("linkedOpportunityId"));
  const quotationId = clean(searchParams.get("linkedQuotationId"));
  const quotationNo = clean(searchParams.get("linkedQuotationNo"));

  useEffect(() => {
    if (!opportunityId || !quotationId) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(OPPORTUNITIES_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;

      if (Array.isArray(parsed)) {
        const now = new Date().toISOString();
        const next = parsed.map((item) => {
          if (!item || typeof item !== "object") {
            return item;
          }

          const record = item as Record<string, unknown>;
          if (record.id !== opportunityId) {
            return item;
          }

          return {
            ...record,
            linkedQuotationId: quotationId,
            linkedQuotationNo: quotationNo || quotationId,
            updatedAt: now,
            localSyncStatus: record.localSyncStatus === "synced" ? "pending" : record.localSyncStatus,
          };
        });

        window.localStorage.setItem(OPPORTUNITIES_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // Local opportunity sync is best-effort; the quotation has already been created.
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("linkedOpportunityId");
    nextParams.delete("linkedOpportunityNo");
    nextParams.delete("linkedQuotationId");
    nextParams.delete("linkedQuotationNo");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [opportunityId, pathname, quotationId, quotationNo, router, searchParams]);

  return null;
}
