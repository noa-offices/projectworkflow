// layout_settings for a revision, an option or a new-enquiry copy. Both start from the source's settings, so its pricing_rule goes with it.
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function branchLayoutSettings(layoutSettings: unknown, branch: Record<string, unknown>) {
  return {
    ...(record(layoutSettings) ?? {}),
    quotationBranch: {
      ...(record(record(layoutSettings)?.quotationBranch) ?? {}),
      ...branch,
    },
  };
}

export function newEnquiryCopyLayoutSettings(layoutSettings: unknown) {
  const nextLayoutSettings = { ...(record(layoutSettings) ?? {}) };

  delete nextLayoutSettings.clientApprovalDraft;
  delete nextLayoutSettings.projectFile;
  delete nextLayoutSettings.quotationBranch;
  delete nextLayoutSettings.procurementRfq;
  delete nextLayoutSettings.purchaseOrder;
  delete nextLayoutSettings.orderConfirmation;
  delete nextLayoutSettings.deliveryNote;

  return nextLayoutSettings;
}
