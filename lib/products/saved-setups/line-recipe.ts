/**
 * Save to My Collection from a quote LINE (PR 2). PURE: no React, no server-only, no database.
 *
 * At add time the builder writes ONE additive key into the line's source_component_data:
 *   configuration_recipe = { recipe, spec_overrides }   (the same output as buildRecipe: ids and small overrides only)
 * Nothing in the app reads this key except this file, so pricing, approval, project snapshots, duplicate and paste
 * (all of which copy source_component_data whole) are unaffected.
 * It never holds a price, total, exchange rate or line quantity: the existing guard is applied before it is attached.
 */
import {
  buildRecipe,
  hashSpecificationText,
  isUuid,
  restorePlainState,
  validateRecipeShape,
  type BuiltSavedSetup,
  type SavedSetupPlainState,
  type SavedSetupRecipeV1,
  type SavedSetupSpecOverrides,
} from "./recipe";
import { defaultSetupName } from "./default-name";

export const LINE_RECIPE_KEY = "configuration_recipe";
export const LINE_RECIPE_FORM_FIELD = "configuration_recipe";
export const LINE_ADDED_BEFORE_HINT = "Added before My Collection. Add it again to save it.";

export type LineConfigurationRecipe = { recipe: SavedSetupRecipeV1; spec_overrides: SavedSetupSpecOverrides };

export type LineLike = {
  item_type?: string | null;
  source_template_id?: string | null;
  source_component_data?: unknown;
  /** The line's CURRENT specification text (what the quote shows and the user may have edited). */
  specification_snapshot?: string | null;
  item_name_snapshot?: string | null;
};

export type LineSaveability =
  | { saveable: true }
  | { saveable: false; reason: "not_a_template_line" | "added_before"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same builder as the selector's Save button (buildRecipe), packaged for a line. */
export function lineRecipeFromBuilt(built: BuiltSavedSetup): LineConfigurationRecipe {
  return { recipe: built.recipe, spec_overrides: built.specOverrides };
}

export function buildLineConfigurationRecipe(state: SavedSetupPlainState): LineConfigurationRecipe {
  return lineRecipeFromBuilt(buildRecipe(state));
}

/**
 * Validates an untrusted recipe (client form field or a stored line): shape, price/quantity guard, 64 KB limit
 * and the template id. Returns the clean value or null.
 */
export function parseLineConfigurationRecipe(raw: unknown, expectedTemplateId: string | null | undefined): LineConfigurationRecipe | null {
  let value = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !isRecord(value.recipe) || !isRecord(value.spec_overrides)) return null;
  if (!isUuid(expectedTemplateId)) return null;
  const shape = validateRecipeShape(value.recipe, value.spec_overrides);
  if (!shape.ok) return null;
  if (shape.ok && (value.recipe as { template_id?: unknown }).template_id !== expectedTemplateId) return null;
  return { recipe: value.recipe as unknown as SavedSetupRecipeV1, spec_overrides: value.spec_overrides as unknown as SavedSetupSpecOverrides };
}

/** Additive only: returns source_component_data with configuration_recipe added; every other key is untouched. */
export function withConfigurationRecipe(
  sourceComponentData: Record<string, unknown>,
  state: SavedSetupPlainState,
): Record<string, unknown> {
  const built = buildLineConfigurationRecipe(state);
  const valid = parseLineConfigurationRecipe(built, state.templateId);
  // A recipe that fails the guard is simply not attached: the line is still added, it just cannot be saved later.
  return valid ? { ...sourceComponentData, [LINE_RECIPE_KEY]: valid } : sourceComponentData;
}

export function isLineSaveable(line: LineLike): LineSaveability {
  if (line.item_type !== "product" || !isUuid(line.source_template_id)) {
    return { saveable: false, reason: "not_a_template_line", message: "Only product lines added from the library can be saved." };
  }
  const source = isRecord(line.source_component_data) ? line.source_component_data : null;
  if (!source || !parseLineConfigurationRecipe(source[LINE_RECIPE_KEY], line.source_template_id)) {
    return { saveable: false, reason: "added_before", message: LINE_ADDED_BEFORE_HINT };
  }
  return { saveable: true };
}

export type RecipeFromLine =
  | {
      ok: true;
      templateId: string;
      defaultName: string;
      /** Plain state to send to the existing saveSetup action (it runs buildRecipe and every server check). */
      state: SavedSetupPlainState;
      recipe: SavedSetupRecipeV1;
      specOverrides: SavedSetupSpecOverrides;
    }
  | { ok: false; reason: "not_a_template_line" | "added_before"; message: string };

/**
 * Specification rule: the generated text is not stored, only its hash. If the line's current specification_snapshot
 * hashes to the same value, no override is saved; otherwise the current text is saved as the edited text, with the
 * generated hash as its base.
 */
export function recipeFromLine(line: LineLike): RecipeFromLine {
  const saveability = isLineSaveable(line);
  if (!saveability.saveable) return { ok: false, reason: saveability.reason, message: saveability.message };
  const templateId = line.source_template_id as string;
  const source = line.source_component_data as Record<string, unknown>;
  const stored = parseLineConfigurationRecipe(source[LINE_RECIPE_KEY], templateId) as LineConfigurationRecipe;

  const baseHash = stored.spec_overrides.generated_specification_hash ?? null;
  const currentText = typeof line.specification_snapshot === "string" ? line.specification_snapshot : "";
  const edited = baseHash !== null && hashSpecificationText(currentText) !== baseHash;
  const overrides: SavedSetupSpecOverrides = {
    ...stored.spec_overrides,
    specification_edited: edited,
    edited_specification: edited ? currentText : null,
  };

  const state: SavedSetupPlainState = {
    ...restorePlainState(stored.recipe, overrides),
    templateId,
    generatedSpecificationHash: baseHash,
  };
  const built = buildRecipe(state);
  const templateName =
    typeof source.template_name === "string" && source.template_name.trim() ? source.template_name : line.item_name_snapshot;
  return {
    ok: true,
    templateId,
    defaultName: defaultSetupName({ mainCode: stored.recipe.display?.main_code, templateName }),
    state,
    recipe: built.recipe,
    specOverrides: built.specOverrides,
  };
}
