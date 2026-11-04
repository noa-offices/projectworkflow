import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { variationLinkFromLayoutSettings } from "@/lib/quotations/project-variation";

export type QuotationApprovalDisplayInput = {
  approved_salesperson_id: string | null;
  layout_settings: unknown;
  status: string;
};

export type QuotationApprovalState =
  | "project_file_pending"
  | "owner_attribution_pending"
  | "approved";

export function hasQualifyingProjectFile(layoutSettings: unknown) {
  return (
    projectFileFromLayoutSettings(layoutSettings) !== null ||
    clientApprovalDraftFromLayoutSettings(layoutSettings)?.confirmedOrder != null
  );
}

export function quotationApprovalDisplay(
  quotation: QuotationApprovalDisplayInput,
): {
  badgeClassName: string;
  label: string;
  state: QuotationApprovalState;
} | null {
  if (quotation.status !== "client_confirmed") return null;

  // A confirmed variation never needs a Project File: it belongs to an existing Project.
  if (variationLinkFromLayoutSettings(quotation.layout_settings)) {
    return { badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800", label: "Variation Confirmed", state: "approved" };
  }

  if (!hasQualifyingProjectFile(quotation.layout_settings)) {
    return {
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-800",
      label: "Client Confirmed · Project File Pending",
      state: "project_file_pending",
    };
  }

  if (!quotation.approved_salesperson_id) {
    return {
      badgeClassName: "border-amber-200 bg-amber-50 text-amber-800",
      label: "Client Approved · Owner Attribution Pending",
      state: "owner_attribution_pending",
    };
  }

  return {
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
    label: "Client Approved",
    state: "approved",
  };
}
