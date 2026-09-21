export type SmartSetupApplySection = "workstation" | "baseModel" | "category" | "modular" | "accessory";
export type SmartSetupSectionAction = "apply" | "clear" | "skip";

/**
 * Decides, per pricing section, whether Smart Setup Apply replaces, clears, or leaves the form section alone.
 * - Fresh import (incremental=false): only sections with content are applied; an import that lacks a section never clears it.
 * - Existing-template edit (incremental=true): only sections the review actually changed participate. A changed section that
 *   is now empty was intentionally emptied and is cleared; untouched sections are never applied or cleared.
 * - `blocked` sections (for example incompatible Modular data that cannot be applied safely) are always skipped.
 */
export function smartSetupSectionActions(input: {
  incremental: boolean;
  changedSections: readonly SmartSetupApplySection[];
  hasContent: Record<SmartSetupApplySection, boolean>;
  blocked?: Partial<Record<SmartSetupApplySection, boolean>>;
}): Record<SmartSetupApplySection, SmartSetupSectionAction> {
  const sections: SmartSetupApplySection[] = ["workstation", "baseModel", "category", "modular", "accessory"];
  return Object.fromEntries(sections.map((section) => {
    if (input.blocked?.[section]) return [section, "skip"];
    if (input.incremental && !input.changedSections.includes(section)) return [section, "skip"];
    if (input.hasContent[section]) return [section, "apply"];
    return [section, input.incremental ? "clear" : "skip"];
  })) as Record<SmartSetupApplySection, SmartSetupSectionAction>;
}

/**
 * Tracks an existing-template "Save Changes" handoff. `expected` maps each replaced section to the replacement
 * version that was set for it. The tracker is ready only once every expected section has reported that exact
 * version as committed to its form inputs; stale or unknown reports are ignored, and readiness is reported once.
 * No expected sections (nothing changed) is ready immediately.
 */
export function createSmartSaveTracker(expected: Partial<Record<SmartSetupApplySection, number>>) {
  const remaining = new Map(Object.entries(expected) as Array<[SmartSetupApplySection, number]>);
  let announced = false;
  const consumeReady = () => { if (announced || remaining.size > 0) return false; announced = true; return true; };
  return {
    /** Returns true exactly once: when the last expected section has committed. */
    committed(section: string, version: number) {
      if (remaining.get(section as SmartSetupApplySection) !== version) return false;
      remaining.delete(section as SmartSetupApplySection);
      return consumeReady();
    },
    /** Returns true (once) when nothing was expected, so the caller can submit without waiting. */
    readyNow: consumeReady,
    pendingSections: () => [...remaining.keys()],
  };
}
