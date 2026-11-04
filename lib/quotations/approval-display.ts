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
  | "folder_has_project"
  | "approved";

export function hasQualifyingProjectFile(layoutSettings: unknown) {
  return (
    projectFileFromLayoutSettings(layoutSettings) !== null ||
    clientApprovalDraftFromLayoutSettings(layoutSettings)?.confirmedOrder != null
  );
}

/**
 * folderOrderNo: the Project number of the quotation's folder, when the caller knows it (folderProjectOrderNo). An old revision or option that is
 * Client Confirmed in a folder that already has a Project is not waiting for a Project File.
 */
export function quotationApprovalDisplay(
  quotation: QuotationApprovalDisplayInput,
  folderOrderNo?: string | null,
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
    if (folderOrderNo) {
      return {
        badgeClassName: "border-zinc-200 bg-zinc-100 text-zinc-600",
        label: `Client Confirmed · Folder has Project ${folderOrderNo}`,
        state: "folder_has_project",
      };
    }
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
