import assert from "node:assert/strict";
import test from "node:test";
import { buildProductTemplateSetupPlanningPrompt, getProductTemplateAiExtractionPrompt, productTemplateSetupPlanningFocuses } from "./product-template-ai-extraction-prompt.js";

const has = (prompt: string, ...expected: string[]) => expected.forEach((text) => assert.ok(prompt.includes(text), `Expected planning prompt to contain: ${text}`));

productTemplateSetupPlanningFocuses.forEach((focus) => {
  const prompt = buildProductTemplateSetupPlanningPrompt(focus);

  test(`${focus}: a separate Product Template never enters another template's Add More batch; boundaries are cross-checked`, () => {
    has(prompt,
      "PLAN CONSISTENCY ACROSS SECTIONS",
      "do NOT later place that family's pages into another Product Template's + Add More JSON batch",
      "its pages must never appear in an Add More JSON batch for PRODUCT 1",
      "they must describe the same Product Template boundaries",
      "Does every extraction batch and every Extraction Order step preserve the Product Template boundaries declared earlier in the plan?",
    );
  });

  test(`${focus}: a mandatory rule does not propagate across families; direct-priced "with feature" rows get a double-charge check`, () => {
    has(prompt,
      "SCOPE OF A MANDATORY RULE",
      "applies ONLY to the rows/family explicitly covered by that evidence",
      "both products have a similar feature",
      "their drawings look similar",
      "another family explicitly requires it",
      "do NOT infer that Family B also needs 2 Art.X",
      "treat the Family B commercial row as pricing-authoritative",
      "Did I copy a Required Companion rule from one family onto another family without explicit/cross-referenced evidence?",
      "DIRECT-PRICED FEATURE SAFETY CHECK",
      "first determine whether that feature is already represented in the row's commercial price",
      "Do NOT add the same feature again as a Required Companion",
      "MANUAL DECISION - possible double charge.",
    );
  });

  test(`${focus}: page numbering is verified at start, middle and end and never exceeds the PDF page count`, () => {
    has(prompt,
      "PAGE NUMBERING VERIFICATION",
      "Do NOT infer that PDF and printed numbering remain 1:1 throughout the document because early pages match",
      "beginning, the middle, and the end / last available pages",
      "Never output a PDF page number greater than the actual PDF page count",
      "report the actual mapping instead of copying the printed number into the PDF column",
      "Does every stated PDF page actually exist in the supplied PDF?",
    );
  });

  test(`${focus}: shared/common pages cannot become an unverified catch-all batch`, () => {
    has(prompt,
      "SHARED SUPPORTING PAGES AND BATCHES",
      'Do NOT create one catch-all "Shared Elements / Technical Info" extraction batch',
      "required companion pages, verified optional accessory pages, Manufacturer Finish Guidance, and manual-inspection-only pages",
      "unconfirmed common elements must not automatically be included in an extraction batch",
      "is invalid unless every included page has a verified reason to be extracted for that same Product Template",
    );
  });

  test(`${focus}: roadmap Priority is a closed enum; manufacturer families are distinguished from ProjectWorkflow consolidation; final reconciliation is required`, () => {
    has(prompt,
      "ROADMAP PRIORITY VALUES",
      "may contain ONLY: BEST FIRST TEST, Current, Next, or Later",
      "Never output Separate catalogue, Future, Excluded, N/A, or any other value",
      "should normally use Later",
      "MANUFACTURER FAMILY VERSUS PROJECTWORKFLOW CONSOLIDATION",
      "Manufacturer families: [A, B, C]",
      "ProjectWorkflow consolidation: ONE Product Template because they share the same pricing and configuration flow.",
      "keep one row per true manufacturer family even when several rows later combine into one Product Template",
      "FINAL CROSS-SECTION CONSISTENCY CHECK",
      "(1) roadmap family, (2) assigned Product Template, (3) source pages, (4) supporting pages, (5) extraction batch, and (6) extraction-order destination",
      "All six must agree.",
      "No family marked separate may silently enter another template later.",
      "No PDF page may exceed the supplied PDF page count.",
    );
  });
});

test("the extraction prompt is untouched by the planning safeguards", () => {
  const extraction = getProductTemplateAiExtractionPrompt("full");
  assert.equal(extraction.includes("PLAN CONSISTENCY ACROSS SECTIONS"), false);
  assert.equal(extraction.includes("DIRECT-PRICED FEATURE SAFETY CHECK"), false);
});
