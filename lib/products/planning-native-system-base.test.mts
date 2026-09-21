import assert from "node:assert/strict";
import test from "node:test";
import { buildProductTemplateSetupPlanningPrompt, getProductTemplateAiExtractionPrompt, productTemplateSetupPlanningFocuses } from "./product-template-ai-extraction-prompt.js";

const has = (prompt: string, ...expected: string[]) => expected.forEach((text) => assert.ok(prompt.includes(text), `Expected planning prompt to contain: ${text}`));

productTemplateSetupPlanningFocuses.forEach((focus) => {
  const prompt = buildProductTemplateSetupPlanningPrompt(focus);

  test(`${focus}: native System/Base is Base / Model, takes precedence over accessory routing and is neither Modular nor Matrix by default`, () => {
    has(prompt,
      "NATIVE SYSTEM / BASE ARCHITECTURE",
      "A native System/Base configuration still counts as Base / Model pricing.",
      "SOURCE-PROVEN PRIMARY SYSTEM PRECEDENCE",
      "Do NOT plan that same item as a Normal Accessory, Conditional Option, or Required Companion",
      "A System/Base may itself have Required Companions and optional accessories.",
      "System/Base and Main Product retain separate supplier codes, separate prices and separate commercial identity",
      "Do not merge their prices, do not create synthetic combined SKUs",
      "it is NOT Modular merely because both a System/Base and a Main Product are required",
      "Do NOT use Modular merely because System/Base + Main Product + required companion must be selected together",
      "A System/Base with multiple direct-priced Main Product SKUs is NOT a Matrix",
      "downstream Main Product rows are direct-priced rows of the same group",
      "Do NOT infer System/Base status from words alone",
    );
  });

  test(`${focus}: several System/Base groups may share one Product Template; boundaries and quantity are source-driven`, () => {
    has(prompt,
      "Multiple native System/Base groups do NOT automatically require separate Product Templates.",
      "Do NOT split merely because System/Base codes differ",
      "NATIVE SYSTEM GROUP BOUNDARIES",
      "plan separate native Base / Model groups",
      "Planning does NOT output internal group identifiers",
      "SYSTEM / BASE QUANTITY",
      "Do NOT infer Bench = 2, Desk = 1, or any other furniture-domain rule.",
      "MANUAL DECISION - System/Base quantity relationship not explicit.",
      "The current Product Library supports manual System/Base quantity selection.",
    );
  });

  test(`${focus}: required quantity separates Fixed from Follows target; user override never downgrades the required status`, () => {
    has(prompt,
      "REQUIRED COMPONENT QUANTITY BEHAVIOR",
      "(A) fixed configured quantity",
      "(B) quantity follows the selected target quantity",
      "Fixed, Follows target quantity, or User-adjustable / MANUAL DECISION",
      "do not infer follow-target behavior unless the source language explicitly supports it",
      "users can intentionally override or unselect them",
      "Do NOT downgrade the commercial status merely because the UI allows manual override",
      "a manual override is a Sales/user action, not evidence that the component is optional",
      "Quantity behavior: Fixed | Follows target quantity | User-adjustable / MANUAL DECISION | Not applicable",
      "give the Quantity only if explicitly supported",
    );
  });

  test(`${focus}: existing templates are updated through Edit in Smart Setup and + Add More JSON`, () => {
    has(prompt,
      "NEW TEMPLATE VS UPDATE EXISTING TEMPLATE",
      "Edit in Smart Setup / + Add More JSON",
      "Do NOT recommend creating a duplicate template merely because new pages or missing SKUs were discovered later",
      "For EXISTING saved templates: Product Template -> Edit in Smart Setup (no PDF required, no original extraction JSON required) -> + Add More JSON when extending the template",
      "Save Changes to the same template",
      "For NEW templates: create template -> copy planning/extraction prompt",
      "Import & Review JSON in Smart Setup -> + Add More JSON for later batches",
      "Prefer Batch 1 = System/Base + directly related Main Product core pages",
    );
  });

  test(`${focus}: output stays human-readable and the roadmap, page, accessory and status safeguards remain`, () => {
    has(prompt,
      "Native System/Base structure (only when native System/Base architecture applies; omit for ordinary products)",
      "System/Base selection: [...]",
      "Main Product families: [...]",
      "System quantity behavior: [...]",
      "Native group boundary: [...]",
      "Native System/Base -> Main Product configuration",
      "do not write System/Base in the destination column as if it were a separate ProjectWorkflow pricing destination",
      "never emit ProductTemplateDraft JSON, group identifiers, role fields, conditional configuration or target JSON",
      "System/Base rows are NOT Main Product visual subgroups",
      "For native System/Base groups, a shared accessory".replace("For native System/Base groups, a shared accessory", "For native System/Base families, a shared accessory"),
      "Do NOT automatically propagate a System-compatible accessory to every Main Product row",
      "A primary native System/Base is NOT classified under the accessory/component commercial statuses",
      "Did I misclassify a primary first-stage System/Base as an accessory?",
      "Did I distinguish fixed required-component quantity from quantity-follow-target behavior?",
      // pre-existing safeguards
      "PAGE NUMBERING NOTE", "FAMILY / EXTRACTION ROADMAP", "BEST FIRST TEST", "COMPONENT COMMERCIAL STATUS",
      "REQUIRED SEPARATE ITEM", "PREPARED FOR", "UNCONFIRMED", "SHARED/COMMON ACCESSORY APPLICABILITY EVIDENCE", "Manufacturer Finish Guidance",
    );
    assert.equal(/"groupId"|"conditionalConfiguration"\s*:/.test(prompt.split("NATIVE SYSTEM / BASE ARCHITECTURE")[1]?.split("CONFIGURATION AND FINISH EVIDENCE")[0] ?? ""), false, "the new guidance adds no JSON field names");
  });
});

test("workstation focus can still resolve to native Base / Model and keeps Workstation Pricing narrow", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("workstation");
  has(prompt,
    "A workstation/bench catalogue may contain a priced System/Base plus priced desk/bench Main Product rows.",
    "recommend native Base / Model System architecture",
    "Do NOT automatically choose Workstation Pricing, Modular, or Accessories / Configuration merely because the source describes a workstation, bench or support system",
    "Workstation Pricing remains only for the existing narrow simple complete-price workstation/bench use case",
  );
});

test("the extraction prompt is untouched by the planning guidance", () => {
  const extraction = getProductTemplateAiExtractionPrompt("full");
  assert.equal(extraction.includes("NATIVE SYSTEM GROUP BOUNDARIES"), false);
  assert.equal(extraction.includes("REQUIRED COMPONENT QUANTITY BEHAVIOR"), false);
});
