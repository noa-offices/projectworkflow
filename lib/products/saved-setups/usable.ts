/**
 * A saved setup can be USED only while its product template still exists and is active
 * (same condition as the quotation builder: is_active and lifecycle_status === "active").
 * Archived/discontinued templates make a setup "unavailable" (kept, not deleted); a deleted template
 * (template_id null) makes it "removed". Every "use" path must call this before offering a setup.
 */
export type SetupUsabilityInput = { template_id: string | null };
export type TemplateActivity = { is_active: boolean | null; lifecycle_status: string | null } | null | undefined;

export function isSetupUsable(setup: SetupUsabilityInput, template: TemplateActivity): boolean {
  if (!setup.template_id) return false;
  if (!template) return false;
  return template.is_active === true && template.lifecycle_status === "active";
}
