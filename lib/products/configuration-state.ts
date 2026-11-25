import type { SavedSetupPlainState } from "./saved-setups/recipe";

export type Configuration = SavedSetupPlainState & { familyKey?: string };
export type ProductConfigurations = Record<string, Configuration>;

/** Undefined clears a choice so the configurator can use its normal default. */
export function updateConfiguration(
  configurations: ProductConfigurations,
  templateId: string,
  changes: Partial<Omit<Configuration, "templateId">>,
): ProductConfigurations {
  const next = { ...configurations[templateId], templateId, ...changes };
  for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
    if (changes[key] === undefined) delete next[key];
  }
  return { ...configurations, [templateId]: next };
}
