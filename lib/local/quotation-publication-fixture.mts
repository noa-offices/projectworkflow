import { createEmptyItem, createEmptySection, createWorkspaceFromServerSnapshot } from "./quotation-workspace";
export const quotationId = "10000000-0000-4000-8000-000000000001";
export const clientId = "20000000-0000-4000-8000-000000000001";
export const projectId = "30000000-0000-4000-8000-000000000001";
export const userId = "40000000-0000-4000-8000-000000000001";
export const baseVersion = "50000000-0000-4000-8000-000000000001";
export function oldWorkspace() {
  const w = createWorkspaceFromServerSnapshot({
    quotation: {
      id: quotationId, client_id: clientId, project_id: projectId,
      quotation_no: "QN-0001-001", title: "Existing current draft", status: "draft",
      quotation_date: "2026-10-01", currency: "AED", vat_percent: 5,
      layout_mode: "standard", layout_settings: {}, overall_discount_type: "amount",
      overall_discount_value: 0,
    },
    client: { company_name: "Client" }, project: { project_name: "Project" }, sections: [], items: [],
  });
  const section = { ...createEmptySection(w, "main"), id: "60000000-0000-4000-8000-000000000001" };
  const item = {
    ...createEmptyItem(w, "custom", section.id),
    id: "70000000-0000-4000-8000-000000000001",
    qty: 2, unit_price: 100, internal_cost: 25, margin_value: 75,
  };
  return { ...w, sections: [section], items: [item], has_unsaved_changes: true };
}
