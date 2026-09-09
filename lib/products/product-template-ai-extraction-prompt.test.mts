import assert from "node:assert/strict";
import test from "node:test";
import { buildProductTemplateSetupPlanningPrompt, extractionPromptFocuses, getProductTemplateAiExtractionPrompt, productTemplateSetupPlanningFocuses } from "./product-template-ai-extraction-prompt.js";

test("AI extraction prompt preserves the approved ProductTemplateDraft v1 extraction rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt();
  [
    "ProductTemplateDraft v1",
    "RETURN ONLY JSON",
    "Do not use Markdown fences",
    "Do not assume anything about page order",
    "determine what information it actually contains",
    "only pricing pages",
    "technical/configuration pages without prices",
    "mixed page may support both technical and commercial extraction",
    "A configuration pictured or described on a technical page does NOT automatically become an optionGroup item or priced accessory",
    "MODEL-DEFINING CONFIGURATION VS TRUE OPTION",
    "Sibling-family-only information",
    "APPLICABILITY VS SUPPLIER CODE",
    "Do not automatically place applicability model codes into the option item's supplierCodes",
    "A blank cell or no supplied price -> null",
    "explicit printed 0 or clearly stated zero-cost/included option -> JSON number 0",
    "Never invent prices",
    "workstationRows",
    "baseModelRows",
    "simple single product family",
    "one clearly labelled direct Price column",
    "separate Base / Model Pricing groups",
    "required companions",
    "priceMatrices",
    "Modular Group -> Module Rows -> Matrix Columns -> Price Cells",
    "optionGroups",
    "supplierCodes",
    "referenceCodes",
    "materialSuggestions",
    "linkedFamilySuggestions",
    "extractionWarnings",
    "sources contain only supported user-provided source metadata",
    "Do not invent internal ProjectWorkflow IDs, database IDs, URLs",
    "ProjectWorkflow brand, category, and template context are non-authoritative supporting context only",
    "Extract supplierName independently from the manufacturer source",
    "True Design",
    "not the boolean true",
    "Source manufacturer appears to be True Design, while the supplied ProjectWorkflow context references Interstuhl",
    "must not invalidate the ProductTemplateDraft",
    "Never automatically change the Product Template brand during Smart Setup Apply",
    "The response must start with {",
    "The shape above is a field contract",
    "Do not change, remove, rename, or extend any v1 field",
    "USER-FACING TEXT MUST BE ENGLISH",
    "ProjectWorkflow user-facing commercial text should be written in clear English by default",
    "Do NOT translate or alter manufacturer identifiers",
    "USE MEANINGFUL MULTIPLE PRICE MATRICES",
    "Do NOT merge an entire manufacturer collection into one huge priceMatrix",
    "VERY IMPORTANT - NEVER INVENT SIBLING PRICES",
    "Do NOT invent Small or Mini prices from technical diagrams",
    "MODEL CONFIGURATION SHOULD DRIVE HUMAN-READABLE DISPLAY NAME",
    "High Backrest - Swivel Steel Base",
    "FAMILY GROUPING SHOULD COME BEFORE BASE-ONLY GROUPING",
    "OPTION / ACCESSORY RULE - KEEP COMMERCIAL NAME CLEAN",
    "label: \"Chrome frame\"",
    "GROUP LABEL QUALITY",
    "Prefer \"Extra Charges\"",
    "Technical diagrams alone must NOT create numeric prices",
    "SPECIFICATION DEPTH",
    "QUOTATION-READY SPECIFICATIONS",
    "client-facing furniture descriptions suitable for direct commercial quotations",
    "VISIBLE MODEL AND ACCESSORY NAMES",
    "label: \"Service Unit W123.6 - Right\"",
    "template.specification should contain the meaningful FAMILY-WIDE technical specification",
    "row.specification should normally NOT be null",
    "ROW SPECIFICATION MUST BE MODEL-SPECIFIC",
    "row.specification should add useful information beyond displayName",
    "row.specification may remain null",
    "CROSS-SOURCE TECHNICAL / PRICING CORRELATION",
    "DISTINCT PRODUCT TYPES MUST NOT BE MERGED",
    "ARCA Mini and ARCA Pouf",
    "Shared COM / S, T, M, F, L, P, PX columns do NOT require combining the families",
    "CLEAN OPTION / ACCESSORY LABELS",
    "do NOT include price/currency in label or displayName",
    "Custom Color Base (<10 pcs)",
    "MATERIAL HEADING ISOLATION",
    "must not be appended to aluminium notes",
    "DIMENSION RAW TEXT QUALITY",
    "W 78 x D 76 x H 123 cm; seat height 46 cm",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected prompt to contain: ${expected}`));
});

test("focused prompts retain the v1 contract, price safety, source fidelity, and relevant target", () => {
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating"]);
  const targets = { full: "Full Product / Complete Extraction", base_model: "pricing.baseModelRows", workstation: "pricing.workstationRows", category_matrix: "pricing.priceMatrices", modular: "pricing.modularGroups", accessories: "optionGroups", product_details: "Product Details / Specifications", materials: "materialSuggestions", chair_seating: "EXTRACTION FOCUS: Chair & Seating" } as const;
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("ProductTemplateDraft v1"));
    assert.ok(prompt.includes("A blank cell or no supplied price -> null"));
    assert.ok(prompt.includes("explicit printed 0 or clearly stated zero-cost/included option -> JSON number 0"));
    assert.ok(prompt.includes("request for attention, not permission to distort the manufacturer source"));
    assert.ok(prompt.includes("QUOTATION-READY SPECIFICATIONS"));
    assert.ok(prompt.includes("VISIBLE MODEL AND ACCESSORY NAMES"));
    assert.ok(prompt.includes(targets[focus]));
  });
  ["full", "base_model", "workstation", "category_matrix", "modular"].forEach((focus) => assert.ok(getProductTemplateAiExtractionPrompt(focus as typeof extractionPromptFocuses[number]).includes("Also extract any clearly related accessories")));
  assert.ok(getProductTemplateAiExtractionPrompt("accessories").includes("Do not invent conditional rules"));
});

test("base model focus adds desk safeguards without changing focus registration or generic behavior", () => {
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating"]);
  const prompt = getProductTemplateAiExtractionPrompt("base_model");
  [
    "Focus on directly priced models, variants, configurations, dimensions",
    "one direct price per manufacturer code",
    "one-column matrix whose only column is a generic \"Price\" is not a genuine Category / Matrix structure",
    "never flatten a genuine matrix into Base/Model",
    "SOURCE ROW COMPLETENESS",
    "Never intentionally omit, abbreviate, sample, summarize, or truncate",
    "representative rows only",
    "DESKS / EXECUTIVE DESKS",
    "standard, executive, or managerial desks",
    "LH/RH, SX/DX, left/right or reversible orientation",
    "standard/ceramic/3D-foil/eco-leather",
    "DENSE DESK ROW PRICE BINDING",
    "Every numeric price must be verified against its own code row",
    "Same width plus similar description does not mean same price",
    "compare the full visible code-and-price sequence",
    "complete desk-with-return code/price may be a Base/Model row",
    "included service/support unit",
    "Explicit required wording must never be downgraded to optional",
    "complete alternative code set",
    "SUPPORTING VS FREESTANDING SERVICE UNITS",
    "only those mapped codes are support-service candidates",
    "must not be merged into the support-unit group",
    "do not expand the support set beyond those codes",
    "always complete with 1 top access",
    "WITHOUT-hole and WITH-hole desks",
    "never inherit the no-hole price onto the with-hole code",
    "REFERENCED COMPONENT CODE COMPLETENESS",
    "ART.041-042-043",
    "extractionWarning naming the missing referenced code",
    "Ignored — separate Workstation product-family cycle",
    "FINAL DESK SAFETY CHECK",
    "direct single-price rows use pricing.baseModelRows rather than artificial one-column priceMatrices",
    "no relevant row was intentionally truncated",
    "every direct-price row has its own code -> price verification",
    "freestanding units were not silently treated as required support units",
    "referenced component code sets were checked completely",
    "explicit printed zero is 0; blank is null",
    "symbols/open circles are not automatically zero",
    "visible source evidence overrides OCR assumptions",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Base / Model prompt to contain: ${expected}`));
  assert.ok(!prompt.includes("CHAIR ROW SPECIFICATION QUALITY"));
});

test("chair and seating focus preserves seating-specific source rules without changing v1", () => {
  const prompt = getProductTemplateAiExtractionPrompt("chair_seating");
  [
    "MODEL AND CODE BINDING", "Preserve model/article, upholstery-grade", "LEGEND AND PRICE SEMANTICS",
    "locate and read the manufacturer legend", "STANDARD, INCLUDED, AND UPGRADES", "double-charge",
    "Model × Upholstery Grade", "Upholstery price grades are not actual selected Material Library",
    "MODEL-DEFINING VS CONFIGURABLE", "Mechanism alternatives", "Armrests, castors, and glides",
    "APPLICABILITY, COMPANIONS, AND EXCLUSIONS", "no complete cross-option exclusion graph",
    "MOQ/minimum-order and on-request", "beam/waiting seating", "training/multipurpose seating",
    "lounge/outdoor/bench/pouf", "Keep simple sources simple", "extractionWarnings",
    "DENSE OPTION TABLE ROW BINDING", "description → exact supplier code → printed numeric price/surcharge",
    "are markers, not prices by themselves", "Only an actual printed numeric 0", "blank/no supplied price as null",
    "second-pass verify label ↔ supplier code ↔ printed price ↔ row position", "never preserve a guessed shift",
    "MODEL APPLICABILITY AND FUNCTION GROUPS", "must not inherit normal swivel-chair castors",
    "never assume unrestricted simultaneous compatibility", "Template-level specification must remain true",
    "CHAIR ROW SPECIFICATION QUALITY", "concise quotation-ready commercial description",
    "medium-high versus high-back, headrest, comfort seat, or counter-chair configuration",
    "Detailed dimensions belong in the dimensions field", "JSON/Smart Setup language",
    "CHAIR ACCESSORY SPECIFICATION QUALITY", "usually 3–10 words",
    "Black floor glides for hard-floor surfaces", "Keep applicability, compatibility, exclusions",
    "it must not replace the short item specification",
    "FINAL CHAIR JSON VALIDATION GATE — DO NOT RETURN UNTIL ALL PASS",
    "column id ↔ source code ↔ label", "every row.price key matches its final column id exactly",
    "Search final JSON for every price 0", "O/open-circle/option marker alone never justifies zero",
    "Compare dense-table numeric sequences with the visible source", "Template-level description/specification must stay true",
    "Do not emit unrestricted maxSelections: null", "supplierName must be explicitly established",
    "supplierName: null", "no marker-alone zero or row shift remains",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Chair & Seating prompt to contain: ${expected}`));
  assert.ok(prompt.includes("ProductTemplateDraft v1"));
  assert.ok(!getProductTemplateAiExtractionPrompt("full").includes("CHAIR ROW SPECIFICATION QUALITY"));
});

test("setup planning prompt is human-readable, source-faithful, and separate from extraction JSON", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt();
  [
    "DO NOT EXTRACT ProductTemplateDraft JSON",
    "DO NOT RETURN JSON",
    "USER LANGUAGE AND MANUFACTURER TERMINOLOGY",
    "same language as the user's request",
    "default to English",
    "Translate manufacturer descriptions from any source language",
    "Manufacturer term:",
    "Never translate, modify, or replace supplier codes",
    "official manufacturer family identifiers",
    "retain the exact original code",
    "first state the plain-language meaning",
    "Italian, German, French, Spanish, Chinese, Arabic",
    "Always use ProjectWorkflow labels consistently in English exactly",
    "Base / Model Pricing",
    "Workstation Pricing",
    "Category / Matrix Pricing",
    "Modular Pricing",
    "Accessories / Configuration",
    "Required Companion",
    "Conditional Option",
    "Accessories are TEMPLATE-LOCAL",
    "cannot use an accessory stored in another Product Template",
    "Pricing Type → Group → Subgroup → Row/Item",
    "Group image, Subgroup image, Row image",
    "Manufacturer Finish Guidance",
    "+ Add More JSON",
    "actual PDF viewer page numbers",
    "PAGE NUMBERING NOTE",
    "PDF page 3 / printed catalogue page 12",
    "Never provide only “Page 12”",
    "Do not guess either number",
    "Include locally",
    "Standalone product",
    "Both",
    "Configuration strategy",
    "MANUAL DECISION — applicability not explicit in source",
    "ONLY proves that it exists in the manufacturer range",
    "Never infer applicability solely because an accessory appears in a shared/common section",
    "EXPLICIT (manufacturer directly states compatibility)",
    "CROSS-REFERENCED (the relevant family page directly points",
    "VISUALLY CONFIRMED (a manufacturer diagram clearly",
    "UNCONFIRMED must become MANUAL DECISION",
    "Overview pages listing modesty panels",
    "Source: PDF page X / printed catalogue page Y",
    "VERIFIED SHARED ACCESSORIES",
    "POSSIBLE SHARED ACCESSORIES — MANUAL DECISION",
    "Pages to inspect manually",
    "always complete with",
    "COMPONENT COMMERCIAL STATUS",
    "INCLUDED: the component is explicitly included",
    "PREPARED FOR: the product has holes",
    "REQUIRED SEPARATE ITEM: the manufacturer explicitly says",
    "OPTIONAL SEPARATE ITEM: compatible/available",
    "PREPARED FOR, not INCLUDED",
    "POTENTIAL DOUBLE CHARGE",
    "PREPARED FOR ≠ INCLUDED",
    "Map REQUIRED SEPARATE ITEM to Required Companion",
    "verified OPTIONAL SEPARATE ITEM to Normal Accessory",
    "Commercial status: INCLUDED / PREPARED FOR",
    "SHARED / SUPPORTING PAGES",
    "PRODUCT SETUP PLAN",
    "EXTRACTION ORDER",
    "WARNINGS / MANUAL DECISIONS",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected planning prompt to contain: ${expected}`));
  assert.notEqual(prompt, getProductTemplateAiExtractionPrompt());
});

test("planning focuses preserve general planning and add chair-specific planning safely", () => {
  assert.deepEqual(productTemplateSetupPlanningFocuses, ["general", "chair_seating"]);
  const general = buildProductTemplateSetupPlanningPrompt();
  const chair = buildProductTemplateSetupPlanningPrompt("chair_seating");
  ["PRODUCT SETUP PLAN", "PAGE NUMBERING NOTE", "Accessories are TEMPLATE-LOCAL"].forEach((expected) => assert.ok(general.includes(expected)));
  ["CHAIR & SEATING PLANNING FOCUS", "SOURCE PRIORITY HIERARCHY", "actual visible/rendered manufacturer page", "Higher-priority evidence overrides lower-priority transcription errors", "CHAIR CONFIGURATION DECISIONS", "UPHOLSTERY AND SPECIAL SEATING", "FINAL CHAIR SOURCE GATE — DO NOT RETURN UNTIL ALL PASS", "inferred ranges are forbidden", "highest-quality visible source", "O, o, ○, open circles", "description → exact code → exact printed price/surcharge", "related codes for the same physical item", "One physical commercial choice equals one component entry", "exactly one status", "A separately priced optional item is not Required Companion", "Preserve finish meaning", "actual position in the uploaded file", "PDF page 1 / printed catalogue pages 124–125", "Pages to inspect manually", "Final consistency"].forEach((expected) => assert.ok(chair.includes(expected), "Expected Chair & Seating planning prompt to contain: " + expected));
  assert.equal(chair.split("FINAL CHAIR SOURCE GATE — DO NOT RETURN UNTIL ALL PASS").length - 1, 1);
  assert.ok(!general.includes("CHAIR & SEATING PLANNING FOCUS"));
});
