import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildProductTemplateSetupPlanningPrompt, extractionPromptFocuses, getProductTemplateAiExtractionPrompt, productTemplateSetupPlanningFocuses } from "./product-template-ai-extraction-prompt.js";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups.js";
import { LEGACY_WORKSTATION_GROUP_ID, workstationPricingGroups } from "./workstation-pricing-groups.js";
import { normalizeProductTemplateDraft } from "./product-template-draft.js";

test("global planning architecture contract precedes and governs every furniture focus", () => {
  const required = [
    "Identify manufacturer-defined commercial/product families before proposing Product Templates",
    "A catalogue subsection or heading alone does not justify a Product Template",
    "SEPARATE LATER",
    "SOURCE / EXTRACTION BATCHES",
    "| Batch | Section | Printed pages | PDF pages | Purpose |",
    "Prefer the FEWEST Product Templates",
    "Always evaluate (1) BASE / MODEL, then (2) CATEGORY / MATRIX, then (3) MODULAR",
    "Multiple direct-priced rows do not justify Matrix",
    "Multiple finish codes at the same price belong in Finish Guidance/options",
    "establish compatibility / allowed applicability only, never a requirement",
    "are valid sold configurations and never imply that the omitted component must be purchased",
    "GLOBAL PLANNING SELF-CHECK",
  ];

  productTemplateSetupPlanningFocuses.forEach((focus) => {
    const prompt = buildProductTemplateSetupPlanningPrompt(focus);
    required.forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} planning prompt to contain: ${expected}`));
    const globalIndex = prompt.indexOf("GLOBAL PLANNING ARCHITECTURE DECISION CONTRACT");
    const categoryIndex = prompt.indexOf("PLANNING FOCUS");
    if (focus !== "general") assert.ok(globalIndex >= 0 && globalIndex < categoryIndex, `Expected global planning contract before ${focus} focus`);
  });
});

test("every planning focus requires a family extraction roadmap before product detail", () => {
  const required = [
    "FAMILY / EXTRACTION ROADMAP - MANDATORY",
    "including when the supplied source contains only one commercial family",
    "| Family | Printed pages | PDF pages | Recommended setup | Extract separately? | Priority |",
    "write \"Unavailable\" in either column",
    "Base / Model + companions",
    "Can combine with <family>",
    "BEST FIRST TEST, Current, Next, or Later",
    "choose only one BEST FIRST TEST",
    "Do not replace the table with prose",
    "collapse unrelated families into one broad page span",
    "LAS STORAGE FAMILY CHECK",
    "Pedestals, Service Units, Lateral Storage, Nomadi, Smart Cabinets, Universal Cabinets, Lockers, and Shared-Side Bookcases",
    "Universal Cabinets may be BEST FIRST TEST",
    "never one broad range spanning unrelated families",
  ];

  productTemplateSetupPlanningFocuses.forEach((focus) => {
    const prompt = buildProductTemplateSetupPlanningPrompt(focus);
    required.forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} planning prompt to contain: ${expected}`));
    assert.ok(prompt.indexOf("FAMILY / EXTRACTION ROADMAP\n| Family") < prompt.indexOf("PRODUCT 1 - [Template Name]"), `Expected roadmap before products in ${focus} planning prompt`);
  });
});

test("global extraction architecture contract enforces safe routing and supplemental family behavior", () => {
  const required = [
    "Extract one clean selected family at a time",
    "When each SKU has only one direct price and there is no Modular composition, use pricing.baseModelRows",
    "one column labelled \"Standard Price\" is an invalid one-column fake Matrix and is explicitly forbidden",
    "When each PRIMARY product SKU has category-dependent prices and there is NO source-proven Modular composition, use pricing.priceMatrices",
    "Ordinary size, finish, LH/RH, open/closed, accessory, and catalogue-layout variation must not trigger pricing.modularGroups",
    "Preserve authoritative terminal/intermediate or other genuine module rows",
    "Every directly priced source SKU remains a separate authoritative row",
    "PRIMARY PRODUCTS VERSUS SUPPORTING COMPONENTS",
    "cabinet, pedestal, CPU holder, service unit, desk, chair, sofa, or meeting table",
    "A joining ring, finishing top, side panel, handle kit, hinge kit, damper, wall-fixing kit, extra shelf, connecting bracket, cable tray, optional cushion, or feet kit normally belongs in optionGroups",
    "being a component does not prove it is required",
    "1AG 967 \"Joining Ring for Low Smart Cabinets\" is a supporting accessory/component, not a Base / Model cabinet row",
    "ROW-LEVEL IMPORTANT REQUIREMENTS",
    '"importantRequirements": string[]',
    "HARD FIELD SEPARATION",
    "specification contains descriptive product facts only",
    "importantRequirements contains actionable user obligations or restrictions only",
    "Wall fixing kit included\" remains specification",
    "A requirement represented in importantRequirements must not be repeated in specification",
    "Never merge distinct supplier codes",
    "prove COMPATIBILITY / ALLOWED APPLICABILITY ONLY; they do not make required=true",
    "must never create the omitted component as required",
    "extend the existing selected family, preserve existing authoritative rows",
    "return supplemental JSON suitable for + Add More JSON",
    "Do not absorb nearby unrelated families",
    "Finish pages with codes, colours, or availability but no explicit price difference normally produce materialSuggestions",
    "GLOBAL EXTRACTION SELF-CHECK",
  ];

  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    required.forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} extraction prompt to contain: ${expected}`));
    assert.ok(prompt.indexOf("GLOBAL EXTRACTION ARCHITECTURE DECISION CONTRACT") < prompt.indexOf("EXTRACTION FOCUS:"), `Expected global extraction contract before ${focus} focus`);
  });
});

test("workstation extraction keeps unsupported alternative bench completions reviewable instead of flattening them", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  ["ALTERNATIVE BENCH COMPLETIONS", "without flattening the alternatives into cumulative AND-required companions", "extractionWarning/manual-review note", "do not invent global companion rules, a generic OR rule, or a combined price"].forEach((expected) => assert.ok(prompt.includes(expected), expected));
});

test("global extraction contract routes component-only SKUs through accessories without overcorrecting primary products", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "PRIMARY PRODUCTS VERSUS SUPPORTING COMPONENTS",
      "cabinet, pedestal, CPU holder, service unit",
      "joining ring, finishing top",
      "extra shelf",
      "optionGroups / Accessories / Configuration",
      "merely because it has its own supplier code and price",
      "Independently determine whether it is Required Companion, Optional / Normal Accessory, Included, or compatibility only",
      "not a Base / Model cabinet row",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("embedded ProductTemplateDraft contract documents category-priced accessories without changing primary Matrix routing", () => {
  const prompt = getProductTemplateAiExtractionPrompt();
  [
    '"workstationRows": [{ "id": "",',
    '"importantRequirements": []',
    '"priceCategories": [{ "id": "cat-b", "label": "B" }]',
    '"prices": { "cat-b": null }',
    "ACCESSORY CATEGORY-PRICE EXAMPLE",
    "1AG 958 Cushion for pedestals",
    "category-priced accessory in optionGroups, NOT pricing.priceMatrices",
    "Ordinary accessories remain scalar-priced: use price and omit prices/priceCategories",
    "chair model × upholstery category price table remains a PRIMARY pricing.priceMatrices structure",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected synchronized contract field: ${expected}`));
  assert.ok(!prompt.includes('"optionGroups": [{ "id": "", "label": null, "selection": { "mode": "optional", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] }, "items":'));
});

test("global extraction contract separates row requirements from descriptive specifications", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      'BAD: { "specification": "Open low cabinet. Structure depth 35 cm. Must be fixed to wall to prevent overturning. Complete with finishing top (sold separately).", "importantRequirements": [] }',
      'GOOD: { "specification": "Open low cabinet. Structure depth 35 cm.", "importantRequirements": ["Wall fixing required for 35 cm depth to prevent overturning", "Finishing top required"] }',
      "Structure for whole blind doors only\" remains specification",
      "must be completed with finishing top",
      "must be fixed to wall",
      "must be ordered separately, and required separately as candidates",
      "no requirement is duplicated in specification",
      "Base / Model",
      "Category / Matrix",
      "Modular",
      "Workstation",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("global extraction contract forbids sampling and preserves exhaustive page-traceable commercial extraction", () => {
  const required = [
    "EXHAUSTIVE COMMERCIAL EXTRACTION - NO SAMPLING",
    "Never return a representative sample, representative rows, example models only, selected permutations, sample formatting capacity, \"omitted for brevity\"",
    "Every source row with its own supplier code, price, or dimensions/configuration is an authoritative commercial row and must remain separate",
    "even when it repeats a price, dimensions, family, commercial structure, or description already extracted",
    "later widths/heights, LH/RH variants, depth variants, and \"without adjustable shelves\"",
    "OUTPUT-LIMIT PAGE BOUNDARY",
    "Extract only complete contiguous source pages, stop at a clear page boundary",
    "add extractionWarning stating exactly which source pages remain and that a supplemental extraction is required",
    "Never stop mid-page solely for output size.",
    "REFERENCED BUT UNSUPPLIED SUPPORT PAGES",
    "preserve the stated requirement/reference, add an extractionWarning that the companion SKU/price is pending supplemental extraction, and do not invent its code, price, or availability.",
    "PAGE TRACEABILITY",
    "sources must include meaningful pageNumber values for supplied pages when page numbers are available",
    "sources must contain a distinct meaningful entry for every supplied page that materially contributes",
    "never collapse a multi-page batch to its first page",
    "A single material page may use one source entry.",
    "Do not create source entries for unused pages.",
    "including supplemental pages, has a distinct sources entry with a known page number.",
    "every supplier-coded priced row in the supplied scope was extracted",
    "no representative/sample/briefness language or behavior was used",
    "no repetitive-looking row was omitted",
    "known source page numbers are present in sources",
  ];

  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    required.forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} exhaustive extraction rule: ${expected}`));
  });
});

test("global traceability covers every material source page without inventing unused pages", () => {
  const required = [
    "For a multi-page extraction, sources must contain a distinct meaningful entry for every supplied page that materially contributes",
    "never collapse a multi-page batch to its first page.",
    "A single material page may use one source entry.",
    "Do not create source entries for unused pages.",
    "including supplemental pages, has a distinct sources entry with a known page number.",
  ];
  extractionPromptFocuses.forEach((focus) => required.forEach((expected) => assert.ok(getProductTemplateAiExtractionPrompt(focus).includes(expected), `Expected ${focus} page coverage rule: ${expected}`)));
});

test("partial extraction batches preserve their parent template identity", () => {
  const required = [
    "PARENT TEMPLATE IDENTITY ACROSS PARTIAL BATCHES",
    "A page/output-limited partial batch is not a new commercial family or Product Template.",
    "Keep template.templateName, commercial family identity, and pricing architecture of the planned/source parent family",
    "a low/medium-cabinet partial batch remains \"Universal Cabinets\"",
    "a later high-cabinet supplemental batch also targets \"Universal Cabinets\"",
    "represent partial status only in extractionWarnings",
    "Never rename or split the parent template from the extracted subset unless source evidence genuinely proves a separate Product Template.",
    "a partial batch did not rename or split its parent template",
  ];

  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    required.forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} parent identity rule: ${expected}`));
  });
});

test("global compatibility and wall-fixing semantics remain commercial-evidence-safe", () => {
  const planningRequired = [
    "for whole blind doors only",
    "for split blind doors",
    "for glass doors",
    "establish compatibility / allowed applicability only, never a requirement",
    "must be completed with\" or \"always complete with",
    "Treat \"must be fixed to wall\" or \"wall fixing required to prevent overturning\" as an installation/safety requirement",
    "\"Wall fixing kit included\" is INCLUDED in the base SKU and must not be duplicated",
    "\"fixing kit must be ordered separately\"",
    "A fixing-kit page reference or compatibility wording alone is not required",
  ];
  const extractionRequired = [
    "prove COMPATIBILITY / ALLOWED APPLICABILITY ONLY; they do not make required=true",
    "\"must be completed with\", \"mandatory\", \"required\", \"order additionally\", \"cannot be used without\", or \"always complete with\"",
    "\"Must be fixed to wall\" or \"wall fixing required to prevent overturning\" is an installation/safety requirement only",
    "\"Wall fixing kit included\" is included in the base SKU and must not be duplicated as an accessory",
    "\"fixing kit must be ordered separately\"",
    "\"See fixing kit page X\" or \"compatible with fixing kit\" is reference/compatibility only",
  ];

  productTemplateSetupPlanningFocuses.forEach((focus) => planningRequired.forEach((expected) => assert.ok(buildProductTemplateSetupPlanningPrompt(focus).includes(expected), `Expected ${focus} planning prompt to contain: ${expected}`)));
  extractionPromptFocuses.forEach((focus) => extractionRequired.forEach((expected) => assert.ok(getProductTemplateAiExtractionPrompt(focus).includes(expected), `Expected ${focus} extraction prompt to contain: ${expected}`)));
});

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
    "MATRIX CELL AVAILABILITY",
    "unavailableCategoryIds",
    "Never infer N/A from every blank",
    "explicit printed 0 or clearly stated zero-cost/included option -> JSON number 0",
    "Never invent prices",
    "workstationRows",
    "baseModelRows",
    "simple single product family",
    "Do NOT create a fake one-column priceMatrix to preserve these groups",
    "NATIVE BASE / MODEL SYSTEM GROUPING",
    "required companions",
    "priceMatrices",
    "For Matrix Modular preserve Modular Group -> Module Rows -> matrix columns -> row price maps",
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
    "Do not change, remove, or rename fields, and do not add fields beyond documented contract fields such as unavailableCategoryIds",
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
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "screens", "category_matrix", "modular", "accessories", "accessories_electrification", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
  const targets = { full: "Full Product / Complete Extraction", base_model: "pricing.baseModelRows", workstation: "pricing.workstationRows", screens: "EXTRACTION FOCUS: Screens / Dividers", category_matrix: "pricing.priceMatrices", modular: "pricing.modularGroups", accessories: "optionGroups", accessories_electrification: "EXTRACTION FOCUS: Accessories / Electrification", product_details: "Product Details / Specifications", materials: "materialSuggestions", chair_seating: "EXTRACTION FOCUS: Chair & Seating", sofa_lounge: "EXTRACTION FOCUS: Sofas / Lounge / Armchairs", meeting_conference: "EXTRACTION FOCUS: Meeting / Conference Tables", storage_cabinets: "EXTRACTION FOCUS: Storage / Cabinets / Credenzas" } as const;
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
  ["full", "base_model", "workstation", "category_matrix", "modular", "sofa_lounge"].forEach((focus) => assert.ok(getProductTemplateAiExtractionPrompt(focus as typeof extractionPromptFocuses[number]).includes("Also extract any clearly related accessories")));
  assert.ok(getProductTemplateAiExtractionPrompt("accessories").includes("Do not invent conditional rules"));
});

test("Screens / Dividers focus prioritizes screen-specific source evidence without duplicating the global contract", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "EXTRACTION FOCUS: Screens / Dividers",
    "front, lateral/side, desk-mounted, bench, freestanding/desktop, and floor screens/dividers",
    "acoustic, fabric, felt, glass, and melamine variants",
    "direct-priced SKUs; genuine upholstery category matrices",
    "mounting brackets/stirrups; included versus separately required hardware",
    "exact dimensions including nominal-versus-actual widths",
    "manufacturer compatibility evidence; and finish-code/composed supplier-code evidence",
    "Apply the global Screen Catalogue Extraction rules; do not duplicate them here.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens focus to include: ${expected}`));
  assert.ok(prompt.includes("ProductTemplateDraft v1"));
  assert.ok(prompt.includes("SCREEN CATALOGUE EXTRACTION"));
});

test("base model focus adds desk safeguards without changing focus registration or generic behavior", () => {
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "screens", "category_matrix", "modular", "accessories", "accessories_electrification", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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

test("sofa and lounge extraction preserves the high-risk behavioral invariants", () => {
  assert.ok(extractionPromptFocuses.includes("sofa_lounge"));
  const prompt = getProductTemplateAiExtractionPrompt("sofa_lounge");

  [
    /OUTPUT AND FAMILY SCOPE[\s\S]*one valid ProductTemplateDraft v1 JSON object/,
    /lounge armchairs\/chairs[\s\S]*1\/2\/3-seat and corner sofas[\s\S]*commercially integral cushions/,
    /Exclude task\/visitor\/conference chairs[\s\S]*Workstations[\s\S]*standalone occasional tables/,
    /every supported in-scope row[\s\S]*never sample, summarize, or truncate/,
    /If Sales can build one composition[\s\S]*pricing\.modularGroups/,
    /rows × upholstery\/material price categories[\s\S]*pricing\.priceMatrices/,
    /each row has one direct price[\s\S]*pricing\.baseModelRows/,
    /genuine configurable composition remains Modular[\s\S]*complete sofas[\s\S]*one consolidated table/,
    /Non-modular sofas[\s\S]*priceMatrices[\s\S]*directly priced non-matrix variants[\s\S]*baseModelRows/,
    /SHARED FABRIC \/ LEATHER PRICE BUCKET — HIGH PRIORITY[\s\S]*trust rendered physical column alignment first/,
    /preserve BOTH logical categories with the exact value from that shared bucket[\s\S]*keep preceding\/following categories separate/,
    /Never merge with, copy from, or drop an adjacent\/final category merely to match physical-column count/,
    /Fabric Cat\. I and Leather Cat\. Extra align to bucket X[\s\S]*Leather Cat\. Super and Leather Cat\. Lusso remain in their own physical buckets/,
    /distinct commercial item types[\s\S]*separate source-backed pricing\.modularGroups/,
    /Do not return one generic modular group unless the source itself is genuinely one undifferentiated group/,
    /Complete 1\/2\/3-seat sofas may remain[\s\S]*Modular groups alongside modules/,
    /each row remains pricing-authoritative and appears once/,
    /Compatible groups reuse the same category IDs and meanings/,
    /physical numeric\/null\/on-request price positions[\s\S]*before deriving logical category meanings/,
    /physical source position → parent material family\/header → source-supported leaf meaning → logical category/,
    /One bucket may map to multiple qualified logical categories only when[\s\S]*explicitly proves/,
    /Fabric Cat\. I[\s\S]*Leather Cat\. Extra[\s\S]*exact same value from that physical position/,
    /Preserve EVERY proven qualified category[\s\S]*logical category count exceeds physical price-position count/,
    /never drop an alias merely to force those counts to match/,
    /Never infer an alias from OCR, proximity, a similar price, or an adjacent\/terminal bucket/,
    /Customer Material\/COM is a valid logical pricing category only when[\s\S]*source/,
    /Never add a synthetic null column/,
    /first, a middle, and the final relevant priced row/,
    /REQUIRED SEPARATE ITEM[\s\S]*feet kit, connector, base\/support kit/,
    /Fixed accessory quantity does NOT automatically multiply by selected Modular-row quantity/,
    /required accessory quantity depends on selected modular-row quantity/,
    /Category-priced cushions, poufs, ottomans, and footrests remain pricing-authoritative/,
    /concise, professional English row specifications[\s\S]*beyond displayName/,
    /physical product\/configuration identity is known[\s\S]*must state that identity[\s\S]*do not return consumption or other measurements alone/,
    /Do not routinely repeat supplier\/reference code, price, currency, pricing category, or W\/D\/H/,
    /dimensions in row\.dimensions and rawText/,
    /Sofa 200 cm[\s\S]*Cushion 45×45 cm/,
    /Commercial price grades remain pricing columns/,
    /actual source-named fabrics, leathers, finishes, colours, and finish codes[\s\S]*materialSuggestions/,
    /Preserve Left\/Right, LH\/RH, and SX\/DX orientation exactly/,
    /fixed\/swivel, high\/low-back, base, and mechanism variants as model or matrix rows/,
    /standalone occasional table is outside this focus/,
    /relative\/formula surcharge[\s\S]*percentage of another or Customer Material price[\s\S]*extractionWarnings\/manual-review evidence/,
    /do not create a selectable null-price option or invent fixed money/,
    /Explicit fixed-money surcharges remain normal source-supported option items/,
    /FINAL SOFA \/ LOUNGE GATE[\s\S]*source-backed Modular groups preserved/,
  ].forEach((invariant) => assert.match(prompt, invariant, `Expected Sofa/Lounge behavioral invariant: ${invariant}`));

  [
    "NUMBER OF MATRIX COLUMNS must equal NUMBER OF SOURCE PRICE POSITIONS",
    "B-C | D-E | F-G | H | I | Super | Extra | Lusso",
    "Cat. I receives the fifth numeric value",
    "exactly N printed price positions must produce exactly N source-supported matrix columns",
    "Never populate Fabric Cat. I from an adjacent or final Leather Cat. Lusso position",
    "logical categories must equal physical price-position count",
    "selectable null-price option for formula surcharge",
    "put all rows in one generic modular group",
    "row.specification must include W/D/H",
  ].forEach((overfittedOrUnsafe) => assert.ok(!prompt.includes(overfittedOrUnsafe), `Expected compressed prompt to omit: ${overfittedOrUnsafe}`));
  assert.ok(!prompt.includes("SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS"));
});

test("compressed Sofa extraction rules remain isolated from Chair, Desk, and Planning prompts", () => {
  const sofaOnlySafeguards = [
    "PRICING STRUCTURE DECISION — HIGH PRIORITY",
    "MODULAR GROUPING — HIGH PRIORITY",
    "Do not return one generic modular group unless the source itself is genuinely one undifferentiated group",
    "FINAL SOFA / LOUNGE GATE — DO NOT RETURN UNTIL ALL PASS",
  ];
  extractionPromptFocuses
    .filter((focus) => focus !== "sofa_lounge")
    .forEach((focus) => sofaOnlySafeguards.forEach((safeguard) => assert.ok(!getProductTemplateAiExtractionPrompt(focus).includes(safeguard), `Expected ${focus} extraction prompt to remain isolated from Sofa compression: ${safeguard}`)));
  productTemplateSetupPlanningFocuses.forEach((focus) => sofaOnlySafeguards.forEach((safeguard) => assert.ok(!buildProductTemplateSetupPlanningPrompt(focus).includes(safeguard), `Expected ${focus} planning prompt to remain isolated from Sofa extraction compression: ${safeguard}`)));
});

test("Sofa family-specific extraction block stays within the compressed target", () => {
  const source = readFileSync("lib/products/product-template-ai-extraction-prompt.ts", "utf8");
  const startMarker = '  sofa_lounge: \`EXTRACTION FOCUS: Sofas / Lounge / Armchairs';
  const start = source.indexOf(startMarker);
  const end = source.indexOf("\`,\r\n};", start);
  assert.ok(start >= 0 && end > start, "Expected to locate the Sofa/Lounge extraction block");
  const familyBlock = source.slice(start, end);
  assert.ok(familyBlock.length >= 8_000, `Expected compressed Sofa block to retain sufficient safeguards; got ${familyBlock.length} characters`);
  assert.ok(familyBlock.length <= 11_000, `Expected compressed Sofa block to stay concise; got ${familyBlock.length} characters`);
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

test("planning focuses preserve general and chair planning and add desk-specific planning safely", () => {
  assert.deepEqual(productTemplateSetupPlanningFocuses, ["general", "chair_seating", "desk_executive", "workstation", "sofa_lounge", "meeting_conference", "storage_cabinets", "screens"]);
  const general = buildProductTemplateSetupPlanningPrompt();
  const chair = buildProductTemplateSetupPlanningPrompt("chair_seating");
  const desk = buildProductTemplateSetupPlanningPrompt("desk_executive");
  ["PRODUCT SETUP PLAN", "PAGE NUMBERING NOTE", "Accessories are TEMPLATE-LOCAL"].forEach((expected) => assert.ok(general.includes(expected)));
  ["CHAIR & SEATING PLANNING FOCUS", "SOURCE PRIORITY HIERARCHY", "actual visible/rendered manufacturer page", "Higher-priority evidence overrides lower-priority transcription errors", "CHAIR CONFIGURATION DECISIONS", "UPHOLSTERY AND SPECIAL SEATING", "FINAL CHAIR SOURCE GATE — DO NOT RETURN UNTIL ALL PASS", "inferred ranges are forbidden", "highest-quality visible source", "O, o, ○, open circles", "description → exact code → exact printed price/surcharge", "related codes for the same physical item", "One physical commercial choice equals one component entry", "exactly one status", "A separately priced optional item is not Required Companion", "Preserve finish meaning", "actual position in the uploaded file", "PDF page 1 / printed catalogue pages 124–125", "Pages to inspect manually", "Final consistency"].forEach((expected) => assert.ok(chair.includes(expected), "Expected Chair & Seating planning prompt to contain: " + expected));
  assert.equal(chair.split("FINAL CHAIR SOURCE GATE — DO NOT RETURN UNTIL ALL PASS").length - 1, 1);
  [
    "Analyze thoroughly internally, but return only the shortest practical Chair & Seating setup plan needed for ProjectWorkflow decisions.",
    "Overall:\n- Product Templates: X",
    "PRODUCT 1 — [Template Name]",
    "- Why separate: [maximum 1 short sentence]",
    "- Primary setup: [Base / Model / Category / Matrix / Accessories / Configuration / etc.]",
    "- Configuration: [short pricing/configuration pattern only if useful]",
    "- Accessories / Required Components: [short list only, or None]",
    "- Extraction: [Batch 1 pages; Batch 2 only if actually needed]",
    "- Manual Decision: [critical unresolved issue only, or None]",
    "SHARED / COMMON",
    "WARNINGS",
    "roughly 10–25 concise lines total",
    "Perform the final Chair source gate internally",
  ].forEach((expected) => assert.ok(chair.includes(expected), "Expected compact Chair planning output to contain: " + expected));
  [
    "CHAIR / SEATING CONFIGURATION SUMMARY",
    "SOURCE VERIFICATION SUMMARY",
    "EXTRACTION ORDER",
    "Component: [description/code]",
    "Accessory: [manufacturer description/code]",
  ].forEach((removed) => assert.ok(!chair.includes(removed), "Expected compact Chair planning output to omit: " + removed));
  assert.equal(buildProductTemplateSetupPlanningPrompt("general"), general);
  assert.ok(general.includes("Overall recommendation:\n- Number of Product Templates: X"));
  assert.ok(general.includes("SHARED / COMMON ELEMENT STRATEGY"));
  assert.ok(general.includes("EXTRACTION ORDER"));
  assert.ok(!general.includes("CHAIR & SEATING PLANNING FOCUS"));
  assert.equal(getProductTemplateAiExtractionPrompt("chair_seating").includes("Analyze thoroughly internally"), false);
  [
    "DESKS / EXECUTIVE DESKS PLANNING FOCUS",
    "standard, executive, and managerial desks",
    "Ignored — separate Workstation product-family cycle.",
    "never recommend Workstation Pricing",
    "service/support units explicitly as included",
    "LH/RH, SX/DX",
    "PREPARED FOR ≠ INCLUDED",
    "with-hole and without-hole rows and prices",
    "FINAL DESK SOURCE GATE — DO NOT RETURN UNTIL ALL PASS",
    "Overall:\n- Product Templates: X",
    "PRODUCT 1 — [Template Name]",
    "IGNORED",
    "roughly 10–25 concise lines",
    "Strongly prefer ONE Product Template for one manufacturer desk family or collection",
    "standard versus ceramic top",
    "3D-Foil or eco-leather inserts",
    "must not by themselves cause separate Product Templates",
    "Do not split desk-for-service-unit variants merely because they require a Required Companion",
    "VISUAL SUBGROUPS BEFORE TEMPLATE SPLITTING",
    "Visual Subgroups are organizational only; Base / Model rows remain pricing-authoritative",
    "Do not split merely to reduce row count or because one template becomes large",
    "ranges the source presents as commercially independent",
    "should normally remain ONE Product Template",
    "Can these differences be represented cleanly inside one Product Template using Base / Model rows, Visual Subgroups, Accessories / Configuration, and finish guidance?",
    "If YES, keep one Product Template",
  ].forEach((expected) => assert.ok(desk.includes(expected), "Expected Desk planning prompt to contain: " + expected));
  ["SOURCE VERIFICATION SUMMARY", "EXTRACTION ORDER", "Component: [description/code]", "Accessory: [manufacturer description/code]"].forEach((removed) => assert.ok(!desk.includes(removed), "Expected compact Desk planning output to omit: " + removed));
  assert.ok(!general.includes("DESKS / EXECUTIVE DESKS PLANNING FOCUS"));
  assert.ok(!chair.includes("DESKS / EXECUTIVE DESKS PLANNING FOCUS"));
  assert.equal(getProductTemplateAiExtractionPrompt("base_model").includes("DESKS / EXECUTIVE DESKS PLANNING FOCUS"), false);
});

test("Sofa and Lounge planning is source-safe, modular-aware, and compact", () => {
  const general = buildProductTemplateSetupPlanningPrompt();
  const chair = buildProductTemplateSetupPlanningPrompt("chair_seating");
  const desk = buildProductTemplateSetupPlanningPrompt("desk_executive");
  const lounge = buildProductTemplateSetupPlanningPrompt("sofa_lounge");
  [
    "SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS",
    "genuine rows for armchairs, 2/3-seater sofas",
    "swivel, fixed, wood, metal",
    "MODULAR LOUNGE SYSTEMS AND UPHOLSTERY",
    "left, right, centre, corner, chaise, open, one-arm, pouf, ottoman",
    "independent whole-number quantity per module",
    "compatible shared category columns",
    "Required Companion and Conditional Option applicability can target Base / Model, Category / Matrix, and Modular rows",
    "Fixed accessory quantity is NOT automatically multiplied",
    "MANUAL DECISION — quantity depends on selected modular-module quantity; current fixed-quantity rule does not multiply automatically.",
    "Classify poufs, ottomans, footrests, and cushions by evidence",
    "Commercial pricing structure takes precedence over the item's generic furniture name",
    "SECONDARY ITEMS WITH UPHOLSTERY MATRIX",
    "its own manufacturer code, its own dimensions/specifications, an independently quoted price, and the same upholstery-category matrix",
    "preserve it as a Modular Pricing row/group",
    "Complete Sofas, Side Elements, Centre Elements, Corner Elements, Chaise, Poufs, or Cushions",
    "complete 1-seat, 2-seat, and 3-seat sofas alongside modular elements",
    "keep them inside one coherent Modular Pricing template/group structure",
    "do not force a separate Category / Matrix destination merely because a row is a complete sofa",
    "Upholstery grade/category labels that determine price are pricing-authoritative columns",
    "grouped categories such as B-C",
    "SG1/SG2/SG3/HP4/LG7",
    "Super/Extra/Lusso",
    "must remain active Category / Matrix or Modular pricing columns whenever they change price",
    "Do NOT recommend mapping those price-grade/category labels themselves to Material Library",
    "If only pricing-grade labels are present, do not invent Material Library guidance",
    "Finish Guidance: None from supplied pages.",
    "finish names/codes, colour names/codes, and allowed material/finish combinations",
    "preserve them separately as component finish guidance",
    "do not confuse component colour codes with upholstery pricing columns",
    "If its price changes by the upholstery category selected for the modular composition, preserve that matrix pricing",
    "Primary setup: Modular",
    "Configuration: Shared upholstery-category matrix across complete sofas and modular elements.",
    "10% of customer-material price",
    "return a concise MANUAL DECISION and never invent a fixed price",
    "pricing grades were not converted to Material Library materials",
    "category-priced cushions, poufs, footrests, or similar items were not flattened into single-price accessories",
    "shared upholstery matrices remain intact",
    "simplest coherent pricing destination was preferred",
    "prioritize model/SKU pricing, upholstery matrices, required/optional components, explicit compatibility/requirement rules, and technical descriptions",
    "do not omit it merely because it has no main pricing table",
    "Avoid cover pages, decorative title pages, and indexes unless they contain necessary commercial information",
    "Required Companion — manufacturer requires the sofa to be completed with the feet kit.",
    "Do not add unsupported purpose wording such as \"required for the sofa to function.\"",
    "component finish/colour codes remain separate from upholstery pricing columns",
    "excluding commercially empty covers, decorative titles, and indexes",
    "required-component wording states only the source-supported requirement without inventing its purpose",
    "standalone coffee/side tables",
    "screens, partitions, walls, pods/booths, desks",
    "FINAL LOUNGE SOURCE GATE — DO NOT RETURN UNTIL ALL PASS",
    "Overall:\n- Product Templates: X",
    "PRODUCT 1 — [Template Name]",
    "- Primary setup: [Base / Model / Category / Matrix / Modular]",
    "- Configuration: [one short sentence]",
    "- Required Components: [short summary or None]",
    "- Finish Guidance: [short summary or None]",
    "- Extraction: [compact PDF + printed page range]",
    "- Manual Decision: [short issue or None]",
    "approximately 12–15 concise content lines",
    "Do not output PAGE NUMBERING NOTE",
    "Earlier page-numbering instructions are internal verification requirements only",
    "Required Components is exactly one line",
    "WARNINGS\n- None",
    "Extraction is exactly one compact line",
    "PDF 2–4 / printed 408–410",
    "Never turn non-contiguous or specially ordered manufacturer pricing categories into an invented range",
    "Preserve the exact category order or use the source-safe compact phrase \"upholstery price categories\"",
    "Never write \"B through H\" unless the manufacturer explicitly defines that continuous range",
    "1-, 2-, 3-seat models × upholstery price categories",
    "Feet colour codes; upholstery category labels remain pricing columns",
  ].forEach((expected) => assert.ok(lounge.includes(expected), `Expected Sofa/Lounge planning prompt to contain: ${expected}`));
  const loungeOutputContract = lounge.slice(lounge.indexOf("Return human-readable output using exactly this structure"));
  ["- Why separate:", "- Main pages:", "- Accessories / Required Components:", "=================================================="].forEach((removed) => assert.ok(!loungeOutputContract.includes(removed), `Expected strict Sofa/Lounge output contract to omit: ${removed}`));
  ["Component: [description/code]", "Accessory: [manufacturer description/code]"].forEach((removed) => assert.ok(!lounge.includes(removed), `Expected compact Sofa/Lounge output to omit evidence field: ${removed}`));
  assert.ok(!general.includes("SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS"));
  assert.ok(!chair.includes("SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS"));
  assert.ok(!desk.includes("SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS"));
  extractionPromptFocuses.forEach((focus) => assert.ok(!getProductTemplateAiExtractionPrompt(focus).includes("SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS")));
});

test("Meeting / Conference Tables planning is compact, source-safe, and isolated", () => {
  const general = buildProductTemplateSetupPlanningPrompt();
  const chair = buildProductTemplateSetupPlanningPrompt("chair_seating");
  const desk = buildProductTemplateSetupPlanningPrompt("desk_executive");
  const lounge = buildProductTemplateSetupPlanningPrompt("sofa_lounge");
  const meeting = buildProductTemplateSetupPlanningPrompt("meeting_conference");
  [
    "MEETING / CONFERENCE TABLES PLANNING FOCUS",
    "Route complete direct-priced table SKUs",
    "Base / Model",
    "Separately coded/priced top-access rows remain authoritative",
    "terminal/end and intermediate/central extension units to Modular",
    "A Terminal ×1 plus Intermediate ×3 is a valid Modular composition.",
    "2 tops → 4 beam sets",
    "return Manual Decision unless a complete authoritative SKU avoids that formula.",
    "Terminal Legs OR Gantries at quantity 2",
    "L120 tray only for L120 rows and L160 tray only for L160 rows",
    "top, beam, leg, and cable-tray finish/material codes in Finish Guidance",
    "REQUIRED COMPONENT EVIDENCE — HIGH PRIORITY",
    "“See Art. X”, “refer to Art. X”, “for X see Art. Y”, “compatible with X”, “can use X”, “available with X”",
    "never Required Companion.",
    "must use, must be completed with, complete with, always add, must be ordered with, or required separate item",
    "Do not infer requirement from location, nearby diagrams, related article numbers, or commercial usefulness.",
    "An explicitly included SKU component remains Included, not a separate required item.",
    "desks, workstations, bench desks, coffee/side tables, storage",
    "FINAL MEETING TABLE SOURCE GATE",
    "PRODUCT SETUP PLAN",
    "Overall:\n- Product Templates: X",
    "PRODUCT 1 â€” [Template Name]",
    "- Primary setup: [Base / Model | Modular | Category / Matrix if genuinely justified]",
    "- Required Components: [short factual summary or None]",
    "- Optional Components: [short factual summary or None]",
    "Return ONLY the exact PRODUCT SETUP PLAN structure above",
    "Do not output PAGE NUMBERING NOTE, Markdown bold headings, long paragraphs, blank-line-heavy formatting, Why separate, Main pages",
    "MEETING TABLE OUTPUT BREVITY RULES",
    "roughly 10â€“25 concise lines",
  ].forEach((expected) => assert.ok(meeting.includes(expected), `Expected Meeting planning prompt to contain: ${expected}`));
  const meetingOutputContract = meeting.slice(meeting.indexOf("Return human-readable output using exactly this structure"));
  ["PAGE NUMBERING NOTE", "Why separate", "Main pages", "source-verification notes", "evidence explanations", "architecture commentary", "nested accessory lists"].forEach((forbidden) => assert.ok(meetingOutputContract.includes(forbidden), `Expected Meeting output contract to forbid: ${forbidden}`));
  [general, chair, desk, lounge].forEach((prompt) => assert.ok(!prompt.includes("MEETING / CONFERENCE TABLES PLANNING FOCUS")));
  extractionPromptFocuses.forEach((focus) => assert.ok(!getProductTemplateAiExtractionPrompt(focus).includes("MEETING / CONFERENCE TABLES PLANNING FOCUS")));
});

test("Meeting / Conference Tables extraction is source-safe, complete, and isolated", () => {
  const prompt = getProductTemplateAiExtractionPrompt("meeting_conference");
  [
    "EXTRACTION FOCUS: Meeting / Conference Tables",
    "MIXED-PAGE CLASSIFICATION â€” HIGH PRIORITY",
    "Do not exclude an entire page because it contains unrelated product sections",
    "page-level proximity never overrides an explicit rendered heading",
    "Double Meeting Table Configuration",
    "extract the authoritative Meeting row once",
    "Do not silently merge conflicting duplicate evidence",
    "Complete direct-priced meeting-table SKUs",
    "pricing.baseModelRows",
    "terminal/end plus intermediate/central composition units",
    "preserve terminal and intermediate rows as distinct authoritative rows",
    "SOURCE-DEFINED COMPOSITION FAMILY — HIGH PRIORITY",
    "keep ALL authoritative rows in that system in pricing.modularGroups",
    "This includes terminal rows usable alone, terminal-only leg styles, top-access variants",
    "Never split one proven composition family across pricing.priceMatrices, pricing.baseModelRows, and pricing.modularGroups",
    "variants differ in leg style, top access, depth, price, or visual presentation",
    "use source wording for bridge leg, gantry, trestle, or central leg only when explicit",
    "Separately coded/priced with/without-top-access SKUs are separate authoritative",
    "with top access and cable tray, record the cable tray as INCLUDED",
    "“See Art. X”, “refer to Art. X”, “for X see Art. Y”, “can use X”, “compatible with X”",
    "does not prove Required Companion",
    "must be completed with, complete with, must be ordered with, or required separate item",
    "never apply a tray to an incompatible row",
    "2 tops → 4 beams",
    "cannot be derived automatically by ProductTemplateDraft v1",
    "exactly one type at quantity above one",
    "Bind every row’s exact source code, name, dimensions, direct price, currency",
    "Use structured dimensions plus rawText",
    "Genuine finish price columns remain pricing structure",
    "MATRIX CELL AVAILABILITY",
    "unavailableCategoryIds",
    "a category exists for sibling rows but is structurally absent for this row type",
    "Never infer N/A from every blank, poor scan/OCR, or uncertain extraction",
    "non-priced top, leg, frame, or cable-tray finish codes belong in materialSuggestions",
    "Include every supported in-scope row; do not truncate",
    "For every supplied page, inspect every visible product-section heading",
    "all Meeting/Conference sections and supported rows were extracted even when unrelated sections share the page",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Meeting extraction prompt to contain: ${expected}`));
  ["Chair & Seating", "DESKS / EXECUTIVE DESKS PLANNING FOCUS", "SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS"].forEach((unrelated) => assert.ok(!prompt.includes(unrelated), `Expected Meeting extraction prompt to omit: ${unrelated}`));
  ["general", "chair_seating", "desk_executive", "sofa_lounge", "meeting_conference"].forEach((focus) => assert.ok(!buildProductTemplateSetupPlanningPrompt(focus as typeof productTemplateSetupPlanningFocuses[number]).includes("EXTRACTION FOCUS: Meeting / Conference Tables")));
});

test("Meeting extraction classifies mixed Bench and Meeting pages by rendered section and row", () => {
  const prompt = getProductTemplateAiExtractionPrompt("meeting_conference");
  [
    "Classify every visible section, table, and row independently",
    "Ignore Bench rows when Bench is outside this Meeting scope",
    "extract every supported row under explicit Meeting Tables, Double/Triple Meeting Tables, Double Meeting Table Configuration, Conference Tables, Boardroom Tables, or Extensions for Meeting Tables headings",
    "even when Bench, Workstation, Desk, Storage, or Executive Desk sections share that page",
    "If a code repeats under Bench and Meeting headings, extract the authoritative Meeting row once",
    "reconcile by code + dimensions + price + commercial identity",
    "add extractionWarning/manual review when the apparent same SKU has different price or dimensions",
    "Extensions for Meeting Tables",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected mixed-page rule: ${expected}`));
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "screens", "category_matrix", "modular", "accessories", "accessories_electrification", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
});

test("matrix availability contract keeps proven N/A distinct from missing, zero, and sibling prices", () => {
  const prompt = getProductTemplateAiExtractionPrompt("meeting_conference");
  [
    "numeric source price -> numeric price",
    "expected category with genuinely missing/unclear source price -> null only",
    "category explicitly proven unavailable/not offered for that row -> null plus that matrix column ID in unavailableCategoryIds",
    "Never infer N/A from every blank, poor scan/OCR, or uncertain extraction",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected matrix availability rule: ${expected}`));
  assert.ok(prompt.includes("An explicit printed 0 or clearly stated zero-cost/included option -> JSON number 0."));
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "screens", "category_matrix", "modular", "accessories", "accessories_electrification", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
});

test("prompt choosers expose only refined extraction focuses and preserve planning focuses", () => {
  const source = readFileSync("components/products/copy-ai-extraction-prompt.tsx", "utf8");
  const [extractionChoices, planningSection] = source.split("const planningChoices");
  const visibleExtractionFocuses = [...extractionChoices.matchAll(/\{ focus: "([^"]+)", label:/g)].map((match) => match[1]);
  assert.deepEqual(visibleExtractionFocuses, ["base_model", "workstation", "screens", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets", "accessories_electrification"]);
  ["Desks / Executive Desks", "Workstations / Bench Systems", "Screens / Dividers", "Chair & Seating", "Sofas / Lounge / Armchairs", "Meeting / Conference Tables", "Storage / Cabinets / Credenzas", "Accessories / Electrification"].forEach((label) => assert.ok(extractionChoices.includes(`label: "${label}"`)));
  ["Base / Model Pricing", "Category / Matrix Pricing", "Full Product / Complete Extraction", "Workstation Pricing", "Modular Pricing", "Accessories / Configuration Only", "Product Details / Specifications", "Materials / Finishes"].forEach((label) => assert.ok(!extractionChoices.includes(`label: "${label}"`)));
  assert.ok(extractionChoices.includes("Extract sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration."));
  assert.ok(extractionChoices.includes("Extract complete meeting tables, terminal/intermediate systems, top-access and related cable management."));
  assert.ok(extractionChoices.includes('{ focus: "workstation", label: "Workstations / Bench Systems"'));
  assert.ok(extractionChoices.includes("Plan and extract workstation desks, benches, clusters, screens, required structural companions, cable management, and related storage."));
  assert.ok(extractionChoices.includes('{ focus: "screens", label: "Screens / Dividers"'));
  assert.ok(extractionChoices.includes("Extract desk, bench, side, freestanding and floor screens, acoustic/fabric variants, mounting requirements, finish pricing and screen accessories."));
  assert.ok(extractionChoices.includes('{ focus: "accessories_electrification", label: "Accessories / Electrification"'));
  assert.ok(extractionChoices.includes("Extract standalone and product-local accessories, cable management, electrification, modules, mounting requirements, compatibility and finish codes."));
  assert.ok(planningSection.includes('{ focus: "desk_executive", label: "Desks / Executive Desks"'));
  assert.ok(planningSection.includes("Plan desk models, sizes, returns, service units, top-access and related desk configuration."));
  assert.ok(planningSection.includes('{ focus: "workstation", label: "Workstations / Bench Systems"'));
  assert.ok(planningSection.includes("Plan workstation and bench families, direct-priced systems, starter/add-on architecture, required companions, screens, storage integration, and extraction batches."));
  assert.ok(planningSection.includes('{ focus: "sofa_lounge", label: "Sofas / Lounge / Armchairs"'));
  assert.ok(planningSection.includes("Plan sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration."));
  assert.ok(planningSection.includes('{ focus: "meeting_conference", label: "Meeting / Conference Tables"'));
  assert.ok(planningSection.includes("Plan complete meeting tables, terminal/intermediate systems, top-access and related cable management."));
  assert.ok(planningSection.includes('{ focus: "screens", label: "Screens / Dividers"'));
  assert.ok(planningSection.includes("Plan desk, side, framed, acoustic, freestanding and floor screens, mounting systems, required companions and related accessories."));
  ["general", "chair_seating", "desk_executive", "workstation", "screens", "sofa_lounge", "meeting_conference", "storage_cabinets"].forEach((focus) => assert.ok(planningSection.includes(`focus: "${focus}"`)));
  assert.deepEqual([...planningSection.matchAll(/\{ focus: "([^"]+)", label:/g)].map((match) => match[1]), ["general", "chair_seating", "desk_executive", "workstation", "screens", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
});

test("Storage/Cabinets extraction is conservative, row-authoritative, and isolated", () => {
  const prompt = getProductTemplateAiExtractionPrompt("storage_cabinets");
  [
    "EXTRACTION FOCUS: Storage / Cabinets / Credenzas",
    "Use pricing.baseModelRows for every authoritative directly priced complete SKU and directly priced carcass",
    "Ordinary cabinet size variation is never Modular.",
    "LH/RH/SX/DX/Left/Right difference is a separate authoritative row.",
    "They do not prove Required Companion, required option, or exactly-one selection.",
    "never create missing shelves or doors as required components.",
    "Explicitly included components belong in the row specification and must not be duplicated as required accessories.",
    "A mandatory wall-fixing instruction is a safety/configuration fact, not a priced companion",
    "Finish codes sharing one price are materialSuggestions/option metadata, not pricing.priceMatrices.",
    "fabric-category priced cushion",
    "explicit start/intermediate/end shared-side storage systems",
    "add extractionWarning rather than inventing constraints.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Storage extraction prompt to contain: ${expected}`));
  ["EXTRACTION FOCUS: Chair & Seating", "EXTRACTION FOCUS: Sofas / Lounge / Armchairs", "EXTRACTION FOCUS: Meeting / Conference Tables"].forEach((unexpected) => assert.ok(!prompt.includes(unexpected)));
});

test("Storage/Cabinets planning is source-safe and keeps generic routing decisions compact", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("storage_cabinets");
  [
    "STORAGE / CABINETS / CREDENZAS PLANNING FOCUS",
    "Base / Model",
    "Width, depth, or height variation alone is Base / Model, not Modular.",
    "LH/RH/SX/DX source SKUs as separate authoritative variants",
    "carcass-only, blind-door, glass-door, split-door",
    "Do not make a finishing top required unless manufacturer wording establishes it.",
    "A safety note alone does not create an accessory row.",
    "finish codes or multiple finishes alone are Manufacturer Finish Guidance, not Matrix",
    "shared-side bookcases cautiously",
    "PRODUCT 1 - [Template Name]",
    "STORAGE OUTPUT BREVITY RULES",
    "Do not create a new template merely because shelves are omitted",
    "same Base / Model, same finish-logic, and same compatibility-architecture variants together",
    "proves compatible door types only; it does not prove a door is mandatory.",
    "Use Required Companion only when the source explicitly requires completion",
    "Treat a complete open cabinet as a complete product",
    "If ambiguous, report compatibility and use Manual Decision / Warning.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Storage planning prompt to contain: ${expected}`));
  ["CHAIR & SEATING PLANNING FOCUS", "DESKS / EXECUTIVE DESKS PLANNING FOCUS", "SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS", "MEETING / CONFERENCE TABLES PLANNING FOCUS"].forEach((unexpected) => assert.ok(!prompt.includes(unexpected)));
});

test("global workstation routing principle applies before any furniture focus and the word workstation alone does not force workstationRows", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "GLOBAL WORKSTATION ROUTING PRINCIPLE",
      "The words \"workstation\", \"bench\", \"cluster\", and \"operative\" do not automatically mean pricing.workstationRows",
      "never move a direct-priced workstation/bench SKU into pricing.workstationRows merely because the source uses one of those words",
      // category pricing without composition -> pricing.priceMatrices
      "genuine manufacturer-proven row-by-category or finish-price-class pricing with NO source-proven structural composition belongs in pricing.priceMatrices",
      // scalar Modular composition -> Direct Modular; category-priced Modular composition -> Matrix Modular
      "source-proven component/module composition such as starter/add-on or structure-plus-top-plus-finish pricing belongs in pricing.modularGroups: use Direct Modular when module rows have scalar prices, and Matrix Modular when those same composable module rows have category/finish-dependent price maps",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain global workstation routing rule: ${expected}`));
    const globalIndex = prompt.indexOf("GLOBAL WORKSTATION ROUTING PRINCIPLE");
    const focusIndex = prompt.indexOf("EXTRACTION FOCUS:");
    assert.ok(globalIndex >= 0 && globalIndex < focusIndex, `Expected global workstation routing principle before ${focus} focus`);
  });
});

test("workstation extraction focus routes direct-priced SKUs to Base/Model and only simple complete-price families to workstationRows", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "WORKSTATION ROUTING HIERARCHY",
    "BASE / MODEL FOR COMPLETE WORKSTATION SKUS",
    "a complete L-shaped workstation SKU, separate DX/SX workstation SKUs, a complete desk-plus-service-unit SKU, or a cabinet-supported complete workstation sold as one authoritative SKU",
    "never move a direct-priced SKU into workstationRows merely because the manufacturer calls it a workstation",
    "WORKSTATION ROWS SUITABILITY",
    "no free-form starter/add-on structural composition",
    "no component-built price calculation",
    "no independent finish-price matrix",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus preserves handedness, importantRequirements, required companions, and fixed quantities", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "WORKSTATION ROW IMPORTANT REQUIREMENTS",
    "Workstation rows support importantRequirements: string[] using the same global separation rules as other priced rows",
    "HANDED WORKSTATIONS",
    "OXI 111 008 — DX and 111 009 — SX",
    "do not infer reversibility",
    "WORKSTATION REQUIRED COMPANIONS",
    "workstation-row applicability",
    "with exactly one selection and every source-supported allowed item",
    "FIXED QUANTITY",
    "always complete with 2 ART.058",
    "Never convert an explicit fixed quantity into quantity 1",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus keeps compatibility from becoming a required companion and preserves model-defining variants", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "OPTIONAL WORKSTATION ACCESSORIES",
    "Ordinary compatibility wording alone (for example \"compatible with\", \"suitable for\") does not make such an item required",
    "MODEL-DEFINING VARIANTS",
    "If the manufacturer gives separate priced codes for with/without electrification preparation, E/non-E, LH/RH, or with/without cable access, preserve those as separate authoritative priced rows.",
    "Do not automatically convert an E-suffix SKU into the corresponding non-E SKU plus an electrification option when the manufacturer prices both as distinct SKU rows.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus routes starter/add-on and component-built or finish-dependent pricing away from workstationRows", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "STARTER / ADD-ON SYSTEMS",
    "must NOT be used for true structural starter/add-on composition",
    "route them to direct Modular: pricingMode: \"direct\" with directRows, not Base/Model and not a fake one-column matrix",
    "Use role \"starter\" for a starter and \"intermediate\" for an add-on",
    "BENCH EXTENSION DISTINCTION",
    "Do not assume \"bench extension\" always means Modular",
    "COMPONENT-PRICED WORKSTATIONS",
    "do not force it into workstationRows: use Modular when manufacturer pricing is genuinely component-built",
    "FINISH-DEPENDENT PRICING",
    "use Category / Matrix for a complete product or Modular matrix pricing for a component-built system",
    "do not create an implicit finish-price mechanism inside workstationRows",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus does not invent seat counts and preserves the OXI/X3/Terra/Colan regression patterns", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "SEAT COUNT",
    "do not invent seat calculations, assume every bench base represents a fixed number of seats, or infer additional seats from an extension unless source/current supported workstation pricing explicitly proves it",
    "OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS",
    "OXI 111 008 / 111 009) must remain separate authoritative rows",
    "OXI 111 623 / 111 624 with ART.175 or ART.129",
    "preserves one Required Companion at unit price EUR 69 with conditionalConfiguration.selection \"at_least_one\" (never \"exactly_one\"), fixed_quantity: 2, and scale_with_target_quantity: true",
    "An X3-style starter/add-on bench system must NOT be flattened into workstation base/additional pricing",
    "Terra/Piem-style direct-priced complete Bench and Bench Extension SKUs are preserved",
    "A Colan-style workstation must not double count structure price, top price, screen price, and a published total set price",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus partitions Direct Modular compatibility families and does not split on width alone", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "DIRECT MODULAR COMPATIBILITY PARTITIONING",
    "manufacturer-proven structural subfamilies that are NOT safely interchangeable under the current composition model",
    "different top-depth families, different overall bench depth caused by those top depths, different middle-gap systems, different connector/interface systems, or different structural systems identified by manufacturer section A/B/etc.",
    "The source must prove the commercial/structural distinction; do NOT rely only on dimensions",
    "Width alone is not a reason to split",
    "matching 120/140/160/180 starter rows plus matching 120/140/160/180 add-on rows belonging to the same structural system may remain in one Direct Modular group",
    "Split by proven incompatibility, not by every dimension difference",
    "preserve all authoritative priced rows, use the safest supported groups possible, and add an extractionWarning describing the unsupported relationship",
    "never flatten the system to workstationRows or Base/Model merely to avoid the compatibility problem",
    "never invent a new schema field or compatibility DSL",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus applies the X3 38 mm / 215 mm plus 60/80 cm Direct Modular partition pattern and never mixes gap or top-depth systems", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "system A at a 38 mm middle gap and system B at a 215 mm middle gap",
    "each with its own separate 60 cm top-depth starter/add-on rows and 80 cm top-depth starter/add-on rows",
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops",
    'each with pricingMode: "direct", starter rows using role "starter", add-on rows using role "intermediate", and composition { minStarters: 1, maxStarters: 1 }',
    "never combine the 60 cm-top and 80 cm-top systems into one group, and never combine system A and system B",
    "because the current composition model cannot enforce same-depth or same-gap composition inside a mixed group",
    "These example gap/depth values are architectural examples only and remain governed by SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain the X3 partition pattern: ${expected}`));
});

test("workstation extraction focus keeps X3-style PTS values out of supported currency codes", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "When an X3-style source labels its commercial amount column PTS rather than a supported currency, never reinterpret PTS as EUR, USD, or any other supported currency code",
    "use defaultCurrency: null and row currency: null, preserve the explicit numeric PTS amount in price",
    "add a concise extractionWarning that source values are expressed in PTS rather than a supported monetary currency",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain PTS handling: ${expected}`));
});

test("workstation extraction focus makes same-page inset return isolation a mandatory target-scope rule for the selected Bench template", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "SAME-PAGE UNRELATED PRIMARY PRODUCT ISOLATION — MANDATORY TARGET-SCOPE RULE",
    "The current target ProductTemplateDraft must contain ONLY the selected commercial family",
    "a separately sold inset return unit, desk return, pedestal, service unit, or other adjacent primary product MUST NOT be emitted into pricing.baseModelRows, pricing.workstationRows, pricing.priceMatrices, or pricing.modularGroups of that Bench template",
    "options/surcharges that apply only to that excluded sibling product MUST also be excluded from the current template's optionGroups",
    "do NOT broaden template.templateName, template.description, or template.specification to include the excluded sibling product merely because it appears on the same source page",
    "This rule is mandatory whenever TARGET TEMPLATE SCOPE identifies one selected family. Same-page proximity never overrides target-template scope.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus still allows linkedFamilySuggestion/extractionWarning as the safe way to preserve an excluded same-page sibling product", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "When useful, preserve the excluded sibling product only as:",
    "linkedFamilySuggestions, when the relationship is clearly supported; or",
    "extractionWarnings stating that the sibling product requires a separate extraction.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation X3 regression pattern makes the same-page inset return exclusion a target-scope rule, not an optional warning, and forbids the Desks & Benches template name", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "For the same X3-style Bench extraction, if the supplied page also contains separately priced inset return units before or after the Bench tables, those return units remain outside the selected Bench ProductTemplateDraft",
    "Do not emit them into baseModelRows and do not emit their return-only surcharge/options into optionGroups",
    'The Bench template identity must remain Bench-only; do not rename it to "Desks & Benches" or otherwise broaden its description/specification to include the excluded return family',
    "This is a target-scope rule, not an optional warning.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus scopes an optional surcharge to the exact rows the manufacturer publishes it beside", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "ROW-SPECIFIC OPTIONAL SURCHARGE APPLICABILITY",
    "When a manufacturer prints an option/surcharge only beside specific priced rows, that placement is applicability evidence",
    'when starter rows show a surcharge such as "W +387" and add-on rows do NOT show that surcharge, the W surcharge must NOT become a global unrestricted option applying to the whole Modular family',
    'do NOT target add-on rows when the source only publishes the surcharge for starter rows',
    "Do not invent cardinality or automatic quantity behavior for an optional surcharge",
    "preserve the surcharge evidence in extractionWarnings, do not make it a misleading globally selectable accessory",
    "do not bake the surcharge into the authoritative base SKU price",
    "do not synthesize alternate priced SKUs unless the manufacturer itself publishes them as separate authoritative SKUs",
    "a return unit's W +193 and a bench starter's W +387 remain two separate priced option items, never one universal W value",
    "if the return unit is outside the selected Bench template, its W +193 option is also outside that Bench template",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus states the exact apply-safe JSON shape for an optional row-specific surcharge", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "OPTIONAL ROW-SPECIFIC SURCHARGE SHAPE",
    "When the source proves one optional surcharge/item available only for certain rows and no tighter cardinality is source-proven",
    'outer optionGroup.selection { "mode": "optional", "minSelections": 0, "maxSelections": 1, "defaultItemIds": [] }',
    'conditionalConfiguration { "role": "conditional_option", "selection": "unrestricted", "applicability": [ { "target": { "kind": "modular", "group_id": "<exact group id>", "row_id": "<exact row id>" }, "required": false, "visible": true, "allowed_item_ids": ["<option item id>"] } ] }',
    "with one applicability rule per exact supported row",
    'Do NOT use "exactly_one", "at_least_one", fixed_quantity, or scale_with_target_quantity for this optional row-specific case unless the manufacturer explicitly proves those semantics',
    "do NOT make the item globally available",
    "If several optional surcharge items are independently selectable and the source proves that, choose the existing appropriate apply-safe outer mode rather than inventing cardinality",
    "If the source semantics still cannot be represented safely, emit an extractionWarning instead of fabricating enforcement",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus applies the optional row-specific surcharge shape to the X3 W +387 example without leaking prompt-example data", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    'When an X3-style source prints a surcharge such as "W +387" beside starter rows only, with no equivalent marking on add-on rows',
    "extract exactly one real surcharge option item using the OPTIONAL ROW-SPECIFIC SURCHARGE SHAPE above",
    "no supplier code unless the source supplies one",
    "price 387 only when visibly supplied",
    "currency following the actual source (PTS is not a currency)",
    "applicability targeting only the starter rows, required: false, and no add-on-row targets",
    'do not extract "387" or "W" as authoritative data from this prompt\'s own example, only from the supplied source',
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus adds a final safety check covering Direct Modular partitioning, same-page isolation, surcharge scoping, and PTS", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "WORKSTATION FINAL SAFETY CHECK",
    "no incompatible Direct Modular structural families were merged into one group merely because all rows are starter/add-on rows",
    "same-family width variants were not unnecessarily split",
    "separate top-depth/gap systems were partitioned into distinct pricing.modularGroups where the current runtime cannot prevent invalid mixing",
    "that when the selected target is a Bench family, no separately sold same-page inset return, desk return, pedestal, service unit, or sibling primary product appears anywhere in the returned pricing arrays or optionGroups, and the template name/description/specification were not broadened to include that excluded sibling family",
    "a row-specific surcharge visible only beside starter rows was not made globally applicable to add-on rows",
    "PTS or other non-currency commercial units were not relabelled as a supported currency",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("the embedded ProductTemplateDraft v1 contract shows a non-null selectionFamily example on the Direct Modular group shape for every focus", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('"pricingMode": "direct", "selectionFamily": "selection-family-id", "directRows":'),
      `Expected ${focus} prompt's Direct Modular contract shape to show a non-null selectionFamily example between pricingMode and directRows`,
    );
    assert.ok(
      !prompt.includes('"pricingMode": "direct", "selectionFamily": null,'),
      `Expected ${focus} prompt's contract example to never show selectionFamily as null (the string may still appear inside the "never emit" instruction)`,
    );
  });
});

test("the prompt documents selectionFamily as an optional, source-proven cross-group exclusivity marker for every focus, and forbids null/empty values", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "DIRECT MODULAR SELECTION FAMILY",
      "pricing.modularGroups[].selectionFamily is optional and applies only when the source proves that two or more Direct Modular groups are alternative configuration families that must not be selected together within one quotation item",
      "emit the same non-empty stable selectionFamily string on every mutually exclusive Direct Modular group belonging to that alternative family",
      "groups with different selectionFamily values may coexist",
      "groups with no selectionFamily remain independent and may coexist",
      "never invent selectionFamily merely because there are multiple Modular groups",
      "never infer exclusivity only from dimensions, labels, group count, or visual proximity",
      "use selectionFamily only when manufacturer structure proves that the groups are alternative configurations rather than simultaneously usable module groups",
      "The runtime enforces that only one Direct Modular group sharing the same selectionFamily may contain selected quantities at a time",
      "Do not use selectionFamily on Matrix Modular unless future ProjectWorkflow runtime support explicitly requires it",
      // absent selectionFamily must be omitted; null/empty is forbidden
      "selectionFamily is OPTIONAL. When no source-proven cross-group exclusivity exists, OMIT selectionFamily entirely",
      'Never emit "selectionFamily": null or an empty string',
      "The non-empty value shown in the field-contract example demonstrates the field shape only and is not required content",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("FINAL CHECK item 15 confirms no undocumented ProductTemplateDraft fields were added and selectionFamily/reviewStatus follow their documented contracts", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('15. No undocumented ProductTemplateDraft fields were added; selectionFamily is used only according to the documented Direct Modular Selection Family contract, and reviewStatus/reviewReason are used only according to the documented optionGroups item review contract.'),
      `Expected ${focus} prompt's FINAL CHECK item 15 to use the new selectionFamily/reviewStatus-aware wording`,
    );
    assert.ok(!prompt.includes("15. The ProductTemplateDraft v1 schema has not been extended."), `Expected ${focus} prompt to no longer show the old FINAL CHECK item 15 wording`);
  });
});

test("FINAL CHECK item 28 confirms accessory applicability review discipline: needs_review preserved, confirmed items not over-marked, incompatible items excluded", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('28. Every commercially relevant accessory with uncertain target-family applicability was preserved as reviewStatus: "needs_review" with a concise reviewReason; confirmed accessories were not unnecessarily review-marked; and accessories explicitly proven to belong to another product type were excluded rather than preserved for review.'),
      `Expected ${focus} prompt's FINAL CHECK item 28 to document the accessory review discipline`,
    );
  });
});

test("workstation extraction focus assigns the same selectionFamily to Direct Modular groups split for proven mutual exclusivity, never merely for organization", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "When incompatible Direct Modular subfamilies are split into separate groups specifically because they are alternative configurations of the SAME selected commercial product and must not be combined in one quotation item, assign those groups the same selectionFamily value",
    "If the source proves that these are alternative configurations rather than simultaneously composable groups, all such Direct Modular groups must share one stable selectionFamily",
    "Do not use selectionFamily merely because groups were split for organization or readability. The source must prove cross-group mutual exclusivity.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation X3 regression requires one shared selectionFamily across all four partitioned groups while the four-group partitioning, W +387, and same-page isolation rules remain unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    // selectionFamily addition
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
    'Use one stable readable generated selectionFamily ID derived from the selected commercial family identity, for example "x3-bench-configuration"',
    "The mutual exclusivity relationship must be supported by the supplied manufacturer source; the generated selectionFamily ID itself is an internal ProjectWorkflow identifier and does not need to appear verbatim in the manufacturer source",
    "Prompt example strings remain non-source architectural examples.",
    "The four groups remain separate pricing.modularGroups, but their shared selectionFamily tells ProjectWorkflow that selecting quantities from one group excludes simultaneous quantities from another group in the same family",
    // four-group partitioning unchanged (item 9)
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops",
    "never combine the 60 cm-top and 80 cm-top systems into one group, and never combine system A and system B",
    // W +387 starter-only surcharge unchanged (item 10)
    'When an X3-style source prints a surcharge such as "W +387" beside starter rows only, with no equivalent marking on add-on rows',
    "applicability targeting only the starter rows, required: false, and no add-on-row targets",
    // same-page inset-return exclusion unchanged (item 11)
    "For the same X3-style Bench extraction, if the supplied page also contains separately priced inset return units before or after the Bench tables, those return units remain outside the selected Bench ProductTemplateDraft",
    "This is a target-scope rule, not an optional warning.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation final safety check verifies selectionFamily was applied to proven mutually exclusive groups and not to groups that may coexist", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "that when multiple Direct Modular groups are source-proven mutually exclusive alternative configurations of the same selected commercial family, they share one selectionFamily value",
    "that selectionFamily was not added to groups that may validly coexist",
    "no incompatible alternative groups requiring cross-group exclusivity were returned without selectionFamily merely because they had already been partitioned into separate modularGroups",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("the selectionFamily generated ID need not appear in source while the underlying exclusivity relationship still must, and the example string stays covered by the prompt-example firewall", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("The mutual exclusivity relationship must be supported by the supplied manufacturer source"));
  assert.ok(prompt.includes("the generated selectionFamily ID itself is an internal ProjectWorkflow identifier and does not need to appear verbatim in the manufacturer source"));
  assert.ok(prompt.includes("Prompt example strings remain non-source architectural examples."));
  extractionPromptFocuses.forEach((focus) => {
    assert.ok(
      getProductTemplateAiExtractionPrompt(focus).includes(
        "Every code, price, dimension, requirement, and page number shown in this prompt's own rules and regression examples (for example OXI, X3, Terra/Piem, or Colan codes) is a NON-SOURCE architectural example only, never source authority",
      ),
      `Expected ${focus} prompt to retain the general prompt-example firewall covering the selectionFamily example too`,
    );
  });
});

test("workstation extraction focus models one SKU with two finish-category prices as a matrix/category price map, never a surcharge", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "ALTERNATIVE FINISH PRICE COLUMNS",
    "When a manufacturer row has one SKU and multiple price columns aligned to finish/material/category legends",
    "model those values as Matrix Modular / Category price columns for that same row",
    "Never transform the second/full alternative price into a surcharge, an accessory, a conditional option, or a synthetic add-on SKU",
    "both values are complete alternative prices for the identical SKU, not a base price plus an addition",
    "Preserve each SKU as one row carrying its full finish-category price map",
    "row TE160 prices Standard (BL / AN): 1310, Designs: 1874; row TE160E prices Standard (BL / AN): 1454, Designs: 2148",
    "These example numbers are architectural examples only and remain subject to SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus routes a composing Bench/Extension pair to the same Modular group with starter/intermediate roles and no selectionFamily", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "STARTER PLUS EXTENSION COMPOSE TOGETHER",
    "When the source proves a Bench and its Bench Extension are components of the SAME composable configuration",
    'route the Bench rows to role "starter" and the Extension rows to role "intermediate" within the SAME Modular group',
    "composition requiring at least one starter and, when source/runtime support it, no more than one starter per run",
    "Do NOT assign selectionFamily between these starter and extension rows",
    "selectionFamily is reserved for mutually exclusive alternative configuration families that must never be combined, never for starter/add-on rows that the source proves are meant to compose together",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation extraction focus adds the Terra Office regression: one Matrix Modular group, starter/intermediate roles, min1/max1 composition, Standard/Designs matrix columns, separate E-suffix SKUs, no Designs surcharge, no selectionFamily, no pricingMode direct", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "For Terra Office-style Bench pricing where the source proves Bench and Bench Extension rows compose together (the Extension extends the Bench run rather than being an alternative product)",
    "normal and E-suffix rows are real manufacturer SKUs, and one SKU carries separate full prices for standard finishes (for example BL/AN) versus special finishes (for example designs)",
    'route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate", group composition { "minStarters": 1, "maxStarters": 1 }, Standard (BL/AN) and Designs as matrix columns/price categories on those same rows, normal and E-suffix rows preserved as separate manufacturer rows, no synthetic Designs surcharge optionGroup, no selectionFamily between the starter and extension rows, and no pricingMode: "direct" on this group.',
    "The E suffix remains a manufacturer SKU variant representing the machined/electrification-ready version and must not be converted into a surcharge",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("Terra regression composition is exactly min 1 / max 1 starter and Standard/Designs remain matrix columns rather than a direct-priced group", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('group composition { "minStarters": 1, "maxStarters": 1 }, Standard (BL/AN) and Designs as matrix columns/price categories on those same rows'));
  assert.ok(prompt.includes('and no pricingMode: "direct" on this group.'));
});

test("workstation extraction focus warns on uncertain accessory applicability instead of blindly attaching every technical-page accessory", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "ACCESSORY PAGE COVERAGE",
    "Do not blindly attach every accessory shown on a manufacturer accessories page merely because that page is part of the supplied extraction batch.",
    "A general collection-level accessory page does NOT prove that every listed accessory applies to the current target ProductTemplateDraft.",
    "include an accessory in optionGroups when the supplied source directly proves applicability to that family or its exact rows",
    "exclude an accessory when the source explicitly ties it to another family/product type",
    'when a general accessory is commercially relevant but exact target-family applicability is not proven, PRESERVE the item in optionGroups with reviewStatus: "needs_review" and a concise reviewReason instead of omitting it or making it unconditionally globally selectable.',
    "Never silently drop a relevant supplied accessory page without warning, and never invent applicability to force an item into optionGroups.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation final safety check adds Terra-specific verifications: no finish-price-to-surcharge conversion, no starter/extension selectionFamily split, matrix categories used, E-suffix rows separate, accessory uncertainty warned", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "that a full alternative finish/category price for one SKU was not converted into a surcharge, accessory, conditional option, or synthetic add-on SKU",
    "that starter and extension rows meant to compose together were not split apart by selectionFamily",
    "that Matrix Modular price categories were used when one SKU has finish-dependent alternative prices",
    "that E-suffix manufacturer SKUs remain separate rows rather than being converted into surcharges",
    'that uncertain accessory applicability produced a reviewStatus: "needs_review" optionGroups item with a concise reviewReason rather than invented applicability, a silent omission, or a mere extractionWarning/linkedFamilySuggestion substitute',
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("Terra fixes leave the X3 selectionFamily regression, OXI_P, and OXI_Q guidance unchanged, and the Matrix Modular contract stays valid", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    // X3 selectionFamily regression (item 10)
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
    'Use one stable readable generated selectionFamily ID derived from the selected commercial family identity, for example "x3-bench-configuration"',
    // OXI_P regression (item 11)
    "OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1",
    // OXI_Q regression (item 12)
    "OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129",
    "OXI 111 623 / 111 624 with ART.175 or ART.129",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged regression text: ${expected}`));

  // Matrix Modular contract remains valid (item 13) — for every focus, the embedded shape still
  // shows a Matrix Modular group with columns/rows/prices ahead of the Direct Modular group, now
  // also demonstrating the optional row.role and group.composition field shape.
  extractionPromptFocuses.forEach((focus) => {
    const focusPrompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      focusPrompt.includes(
        '"modularGroups": [{ "id": "", "label": null, "defaultDimensions": null, "defaultSpecification": null, "matrix": { "id": "", "label": null, "columns": [{ "id": "", "label": null }], "rows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "role": "starter", "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] }, "composition": { "minStarters": 1, "maxStarters": 1 } }',
      ),
      `Expected ${focus} prompt's Matrix Modular contract shape to remain valid and show optional role/composition`,
    );
  });
});

test("existing OXI_P Direct Modular and OXI_Q Base/Model/companion guidance remain unchanged after the Direct Modular partitioning additions", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1",
    "OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129",
    "OXI 111 008 / 111 009) must remain separate authoritative rows",
    "OXI 111 623 / 111 624 with ART.175 or ART.129",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged OXI regression text: ${expected}`));
});

test("generic Direct Modular guidance stays valid for sofa/lounge systems and the source-example firewall remains intact", () => {
  const sofaPrompt = getProductTemplateAiExtractionPrompt("sofa_lounge");
  assert.ok(sofaPrompt.includes("If Sales can build one composition") || sofaPrompt.includes("pricing.modularGroups"), "Expected sofa/lounge focus to retain generic Modular routing");
  assert.ok(!sofaPrompt.includes("DIRECT MODULAR COMPATIBILITY PARTITIONING"), "Expected the workstation-specific Direct Modular partitioning rule to stay isolated from sofa/lounge");

  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes(
        "Every code, price, dimension, requirement, and page number shown in this prompt's own rules and regression examples (for example OXI, X3, Terra/Piem, or Colan codes) is a NON-SOURCE architectural example only, never source authority",
      ),
      `Expected ${focus} prompt to retain the prompt-example firewall covering X3`,
    );
  });
});

test("workstation-specific regression and composition rules stay isolated from other furniture focuses and planning stays unaffected", () => {
  const workstationOnlySafeguards = [
    "OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS",
    "WORKSTATION ROUTING HIERARCHY",
    "STARTER / ADD-ON SYSTEMS",
    "BENCH EXTENSION DISTINCTION",
    "DIRECT MODULAR COMPATIBILITY PARTITIONING",
    "SAME-PAGE UNRELATED PRIMARY PRODUCT ISOLATION",
    "ROW-SPECIFIC OPTIONAL SURCHARGE APPLICABILITY",
    "WORKSTATION FINAL SAFETY CHECK",
  ];
  extractionPromptFocuses
    .filter((focus) => focus !== "workstation")
    .forEach((focus) => workstationOnlySafeguards.forEach((safeguard) => assert.ok(!getProductTemplateAiExtractionPrompt(focus).includes(safeguard), `Expected ${focus} extraction prompt to remain isolated from Workstation-specific rules: ${safeguard}`)));

  const desk = buildProductTemplateSetupPlanningPrompt("desk_executive");
  const chairExtraction = getProductTemplateAiExtractionPrompt("chair_seating");
  const sofaExtraction = getProductTemplateAiExtractionPrompt("sofa_lounge");
  const storageExtraction = getProductTemplateAiExtractionPrompt("storage_cabinets");
  assert.ok(desk.includes("Ignored — separate Workstation product-family cycle."), "Expected Desk planning to still exclude Workstations");
  assert.ok(desk.includes("never recommend Workstation Pricing"), "Expected Desk planning Workstation exclusion to remain unchanged");
  assert.ok(chairExtraction.includes("MODEL AND CODE BINDING"), "Expected Chair extraction focus to remain unchanged");
  assert.ok(sofaExtraction.includes("PRICING STRUCTURE DECISION — HIGH PRIORITY"), "Expected Sofa extraction focus to remain unchanged");
  assert.ok(storageExtraction.includes("Use pricing.baseModelRows for every authoritative directly priced complete SKU and directly priced carcass"), "Expected Storage extraction focus to remain unchanged");
});

test("planning prompts state Workstation architecture, why, and family evidence before recommending Workstation Pricing", () => {
  productTemplateSetupPlanningFocuses.forEach((focus) => {
    const prompt = buildProductTemplateSetupPlanningPrompt(focus);
    [
      "The words workstation, bench, cluster, and operative do not by themselves justify this destination",
      "first check whether the family is actually a complete direct-priced SKU (Base / Model), a genuine finish/category price dimension (Category / Matrix), or a proven starter/add-on or component-built composition (Modular) before recommending Workstation Pricing",
      "state the recommended architecture and why, whether the source shows complete SKU pricing, required companions, fixed quantities, starter/add-on composition, finish-dependent pricing, or separately priced screens/accessories",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} planning prompt to contain: ${expected}`));
  });
});

test("Workstations / Bench Systems is exposed exactly once in both focus choosers and reuses the existing workstation prompt key", () => {
  const source = readFileSync("components/products/copy-ai-extraction-prompt.tsx", "utf8");
  const [extractionChoices, planningSection] = source.split("const planningChoices");

  assert.ok(extractionPromptFocuses.includes("workstation"), "Expected extraction focus registry to already include workstation");
  assert.ok(productTemplateSetupPlanningFocuses.includes("workstation"), "Expected planning focus registry to include workstation");

  const extractionMatches = [...extractionChoices.matchAll(/\{ focus: "workstation", label: "([^"]+)"/g)];
  assert.equal(extractionMatches.length, 1, "Expected exactly one workstation entry in the extraction chooser");
  assert.equal(extractionMatches[0][1], "Workstations / Bench Systems");

  const planningMatches = [...planningSection.matchAll(/\{ focus: "workstation", label: "([^"]+)"/g)];
  assert.equal(planningMatches.length, 1, "Expected exactly one workstation entry in the planning chooser");
  assert.equal(planningMatches[0][1], "Workstations / Bench Systems");

  // Both choosers must reference the single existing "workstation" key, not a new one.
  assert.ok(!source.includes('"workstation_bench"') && !source.includes('"bench_systems"'), "Expected no duplicate/new workstation focus key to have been introduced");
});

test("selecting Workstations / Bench Systems generates the existing workstation extraction prompt with its full contract", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "EXTRACTION FOCUS: Workstation Pricing",
    "GLOBAL WORKSTATION ROUTING PRINCIPLE",
    "The words \"workstation\", \"bench\", \"cluster\", and \"operative\" do not automatically mean pricing.workstationRows",
    "WORKSTATION ROUTING HIERARCHY",
    "BASE / MODEL FOR COMPLETE WORKSTATION SKUS",
    "WORKSTATION ROWS SUITABILITY",
    "WORKSTATION REQUIRED COMPANIONS",
    "FIXED QUANTITY",
    "STARTER / ADD-ON SYSTEMS",
    "COMPONENT-PRICED WORKSTATIONS",
    "FINISH-DEPENDENT PRICING",
    "OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected copied workstation extraction prompt to contain: ${expected}`));
});

test("selecting Workstations / Bench Systems in planning generates a selectable, distinct workstation planning prompt", () => {
  const generalPrompt = buildProductTemplateSetupPlanningPrompt("general");
  const workstationPrompt = buildProductTemplateSetupPlanningPrompt("workstation");
  assert.notEqual(workstationPrompt, generalPrompt, "Expected the workstation planning prompt to be distinct from General / Auto Detect");
  [
    "WORKSTATION / BENCH SYSTEMS PLANNING FOCUS",
    "GLOBAL PLANNING ARCHITECTURE DECISION CONTRACT",
    "PROJECTWORKFLOW DESTINATIONS",
    "Workstation Pricing: only simple, complete-price workstation/bench",
  ].forEach((expected) => assert.ok(workstationPrompt.includes(expected), `Expected workstation planning prompt to contain: ${expected}`));
  const globalIndex = workstationPrompt.indexOf("GLOBAL PLANNING ARCHITECTURE DECISION CONTRACT");
  const focusIndex = workstationPrompt.indexOf("WORKSTATION / BENCH SYSTEMS PLANNING FOCUS");
  assert.ok(globalIndex >= 0 && globalIndex < focusIndex, "Expected global planning contract before the workstation planning focus");
});

test("adding Workstations / Bench Systems leaves every other extraction and planning focus option unchanged", () => {
  ["full", "base_model", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"].forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus as typeof extractionPromptFocuses[number]);
    assert.ok(!prompt.includes("OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS"), `Expected ${focus} extraction prompt to remain free of workstation-only regression rules`);
  });
  ["general", "chair_seating", "desk_executive", "sofa_lounge", "meeting_conference", "storage_cabinets"].forEach((focus) => {
    const prompt = buildProductTemplateSetupPlanningPrompt(focus as typeof productTemplateSetupPlanningFocuses[number]);
    assert.ok(!prompt.includes("WORKSTATION / BENCH SYSTEMS PLANNING FOCUS"), `Expected ${focus} planning prompt to remain free of the new workstation planning focus block`);
  });
  const desk = buildProductTemplateSetupPlanningPrompt("desk_executive");
  assert.ok(desk.includes("Ignored — separate Workstation product-family cycle."), "Expected Desk planning to still exclude Workstations");
});

test("global rule forbids synthesizing a fixed quantity into a fake bundled item or multiplied price (OXI ART.058 regression, Test A)", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "FIXED QUANTITY VS SYNTHETIC BUNDLED ITEMS",
      "Never synthesize a bundled/multiplied item such as \"2 x ART.058\", \"3 x bracket\", or \"set of 4 feet\"",
      "ART.058 at supplier code 111 058, unit price EUR 69, remains one row priced at EUR 69, never a synthesized EUR 138 item",
      "Never calculate or store unit price × required quantity as a new authoritative item price",
      "Only extract a bundle/kit/set as one priced row when the manufacturer itself sells and prices it as a single commercial kit/set SKU with its own code and price",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to forbid synthetic quantity bundling: ${expected}`));
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "preserve ART.058 as one Required Companion item at its real manufacturer unit price; never synthesize a \"2 x ART.058\" item or a doubled/multiplied price",
    "never calculate unit price × quantity into a new item price",
  ].forEach((expected) => assert.ok(workstationPrompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("global rule requires explicit pricing-routing-compatible targeting via conditionalConfiguration for a row-specific required companion (OXI 111 623/111 624, Test B)", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "ROW-SPECIFIC REQUIRED/OPTIONAL APPLICABILITY",
      "is incomplete unless the extraction emits explicit applicability naming the exact target row(s), never a vague or collection-wide requirement",
      "Use the companion optionGroup's conditionalConfiguration.applicability, with one rule per target row using target: { kind, group_id, row_id }",
      "from the exact supported target kinds base_model, price_matrix, modular, and workstation",
      "Do not create a globally required companion when the source requirement applies only to selected rows",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to require explicit row targeting: ${expected}`));
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "This is a CHOOSE-ONE COMPANION (see COMPANION SELECTION MODE below): set the outer optionGroup.selection to { \"mode\": \"required_choose_at_least_one\", \"minSelections\": 1, \"maxSelections\": null, \"defaultItemIds\": [] }",
    "and set conditionalConfiguration on that optionGroup (role \"companion\", selection \"exactly_one\") with one applicability rule per exact target row",
    "If \"oxi-q-ws-dx\" was emitted in pricing.baseModelRows as an ordinary ungrouped Base/Model row, use target: { kind: \"base_model\", group_id: \"legacy-base-model-main\", row_id: \"oxi-q-ws-dx\" }",
    "If and only if it was legitimately emitted in pricing.workstationRows, use target: { kind: \"workstation\", group_id: \"legacy-workstation-main\", row_id: \"oxi-q-ws-dx\" }",
    "row_id is the row's own draft id, never its supplierCodes entry (\"111 623\")",
    "each required true and allowed_item_ids naming ART.175 and ART.129",
    "never create a global/unscoped required companion when the source requirement applies only to selected rows",
  ].forEach((expected) => assert.ok(workstationPrompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("applicability target kind is selected after the authoritative pricing route, not from workstation wording", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "APPLICABILITY TARGETS FOLLOW ACTUAL PRICING ROUTING",
    'If the row is in pricing.baseModelRows, use target.kind "base_model"; when the row has a native groupId use group_id equal to that exact row.groupId, otherwise use group_id "legacy-base-model-main".',
    'If it is in pricing.workstationRows, use target.kind "workstation" and group_id "legacy-workstation-main".',
    'If it is in pricing.priceMatrices[n].rows, use target.kind "price_matrix" and that pricing.priceMatrices[n].id.',
    'If it is in either pricing.modularGroups[n].matrix.rows or pricing.modularGroups[n].directRows, use target.kind "modular" and that pricing.modularGroups[n].id.',
    "In every case row_id is the exact already-emitted row.id, never a supplier code.",
    "Never point a Base/Model, Matrix, or Modular row at a workstation target.",
    'for either a pricing.modularGroups[n].matrix.rows or pricing.modularGroups[n].directRows bench use { kind: "modular", group_id: "<that exact modularGroup.id>", row_id: "<that exact modular row.id>" }',
    "Never point a Modular row at a workstation target.",
    'fixed_quantity to 2',
    "ART.058 as one Required Companion item at its real manufacturer unit price",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected routing-compatible applicability instruction: ${expected}`));
  assert.ok(!prompt.includes('with target.kind "workstation", target.group_id "legacy-workstation-main", and target.row_id equal to each applicable bench/module row'));
});

test("global rule forbids extracting from prompt regression examples or unsupplied pages (OXI_T 111 026/111 027, Test C)", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL",
      "Extract only products, rows, prices, requirements, and components whose authoritative source is visibly present in the supplied extraction batch for this call",
      "Do not extract from prior planning output, examples embedded in this prompt, earlier catalogue knowledge, remembered manufacturer data, page references mentioned in instructions but not supplied, or other uploaded batches not included in this call",
      "is a NON-SOURCE architectural example only, never source authority",
      "never output a prompt example's code/price/page as authoritative extracted data",
      "Supplied extraction batch covers printed pages 10–15 and 20. Printed pages 16–19 remain unextracted.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain source-batch firewall rule: ${expected}`));
    // Simulated OXI_T codes belonging to an unsupplied page must never appear anywhere in the prompt itself.
    assert.ok(!prompt.includes("111 026"), `Expected ${focus} prompt to never leak out-of-scope OXI_T code 111 026`);
    assert.ok(!prompt.includes("111 027"), `Expected ${focus} prompt to never leak out-of-scope OXI_T code 111 027`);
  });
});

test("importantRequirements stays informational and never replaces the structural conditionalConfiguration rule (Test D)", () => {
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "Always complete with 2 Art.058 top-access units.",
    "AND set conditionalConfiguration.applicability[].fixed_quantity to 2 plus scale_with_target_quantity: true on the companion optionGroup.",
    "conditionalConfiguration.selection to \"at_least_one\" — never \"exactly_one\", which the runtime rejects together with scale_with_target_quantity",
    "Its target must follow the actual emitted row",
    "Never point a Modular row at a workstation target.",
  ].forEach((expected) => assert.ok(workstationPrompt.includes(expected), `Expected workstation prompt to contain both informational and structural evidence: ${expected}`));
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes("importantRequirements remains informational/user-facing") && prompt.includes("it does not replace conditionalConfiguration, and neither field may substitute for the other"),
      `Expected ${focus} prompt to state importantRequirements does not replace structural conditionalConfiguration`,
    );
  });
});

test("fixed-quantity and applicability rules apply globally across furniture focuses without disturbing existing routing", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("chair/sofa feet kits, cabinet wall-fixing components, handles, grommet sets, shelves, screens, and support legs"), `Expected ${focus} prompt to extend the synthetic-item rule globally`);
  });
  assert.ok(getProductTemplateAiExtractionPrompt("chair_seating").includes("MODEL AND CODE BINDING"), "Expected Chair extraction focus to remain unchanged");
  assert.ok(getProductTemplateAiExtractionPrompt("sofa_lounge").includes("PRICING STRUCTURE DECISION — HIGH PRIORITY"), "Expected Sofa extraction focus to remain unchanged");
  assert.ok(getProductTemplateAiExtractionPrompt("storage_cabinets").includes("Use pricing.baseModelRows for every authoritative directly priced complete SKU and directly priced carcass"), "Expected Storage extraction focus to remain unchanged");
});

test("visible ProductTemplateDraft v1 contract exposes the actual conditionalConfiguration/applicability structure with workstation target and fixed quantity", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      '"conditionalConfiguration": { "role": "companion", "selection": "exactly_one", "applicability": [{ "target": { "kind": "workstation", "group_id": "", "row_id": "" }, "required": true, "visible": true }] }',
      "OPTIONGROUPS.CONDITIONALCONFIGURATION - ROW-SPECIFIC ENFORCEMENT",
      "optionGroups[].conditionalConfiguration is OPTIONAL and reuses the runtime AccessoryConditionalConfiguration/AccessoryModelApplicabilityRule shape exactly",
      "Omit it entirely for an ordinary, independently selectable accessory with no row-specific requirement",
      "role: \"accessory\" | \"conditional_option\" | \"companion\"",
      "selection: \"unrestricted\" | \"exactly_one\" | \"at_least_one\" | \"choose_multiple\"",
      "target: { kind: \"base_model\" | \"price_matrix\" | \"modular\" | \"workstation\" | \"option_item\", group_id, row_id }",
      "allowed_item_ids: optional array restricting which of this group's items apply under that rule",
      "fixed_quantity: a positive integer for an explicit manufacturer-required quantity",
      "OMIT the field entirely when no fixed quantity applies; never emit \"fixed_quantity\": null",
      "never fabricate a \"N x <code>\" item to represent it",
      "Emit conditionalConfiguration IN ADDITION TO, never instead of, the informational importantRequirements text",
      "do not add fields beyond documented contract fields such as unavailableCategoryIds, conditionalConfiguration, or reviewStatus/reviewReason",
      "TARGET GROUP_ID CONVENTION",
      "row_id always equals the exact stable id already assigned to that row/item in that structure",
      "never a supplierCodes entry such as \"111 623\", and never invented from a code, label, or family name",
      "For target.kind \"base_model\": (A) when the row has a native groupId, group_id is that exact row.groupId; (B) when the row has no groupId, group_id is \"legacy-base-model-main\"",
      "use group_id: \"legacy-workstation-main\" only for an actual workstation target",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to expose conditionalConfiguration schema: ${expected}`));
  });
});

test("OXI ART.058 example in the extraction prompt targets exact workstation rows with fixed_quantity and never invents an EUR 138 bundled price", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("fixed_quantity to 2 plus scale_with_target_quantity: true on the companion optionGroup"), "Expected the prompt to instruct setting fixed_quantity=2 structurally");
  assert.ok(prompt.includes("conditionalConfiguration.selection to \"at_least_one\" — never \"exactly_one\""), "Expected the prompt to require at_least_one, never exactly_one, for the scaled ART.058 companion");
  assert.ok(prompt.includes("ART.058 at supplier code 111 058, unit price EUR 69, remains one row priced at EUR 69, never a synthesized EUR 138 item"), "Expected the prompt to explicitly forbid the EUR 138 synthetic price and preserve the real EUR 69 unit price");
});

test("every extraction prompt requires JSON-safe escaping for source strings", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "Return strict, parseable JSON only.",
      "Escape every embedded double quote inside every JSON string as",
      "escape backslashes when JSON requires it",
      "rawText, specifications, labels, warnings, notes, and every other string field",
      "Never escape underscore _.",
      "Never emit \\_ anywhere in JSON keys or string values",
      "Do not use smart substitutions, Markdown fences, or prose as a workaround.",
      '"rawText": "BENCH ... \\"OXI_P\\" ..."',
      "the exact response would be accepted by standard JSON.parse",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain JSON escaping guidance: ${expected}`));
  });
});

test("prompt documents actual confidence, direct Modular targets, and mutually exclusive Modular forms", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "confidence must be null or a number from 0 through 1.",
    "Use 0.95 for 95%, 0.8 for 80%, and 1 for 100%; never emit 95 for 95%.",
    "pricing.modularGroups[n].matrix.rows or pricing.modularGroups[n].directRows",
    'DIRECT MODULAR: pricingMode: "direct" with directRows; OMIT matrix entirely.',
    "MATRIX MODULAR: matrix with rows/prices; OMIT directRows",
    "Never emit an empty matrix as a placeholder inside a direct Modular group.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected prompt contract: ${expected}`));
  assert.ok(!prompt.includes('VALID JSON:\n"rawText": "BENCH ... \\"OXI\\_P\\" ..."'));
});

test("Phase 2 direct Modular and ART.058 scaling contract are visible to extraction", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  ["\"pricingMode\": \"direct\"", "\"directRows\"", "\"role\": \"starter\"", "\"composition\": { \"minStarters\": 1, \"maxStarters\": 1 }", "scale_with_target_quantity", "111 065", "111 069", "EUR 69"].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Phase 2 contract field ${expected}`));
  assert.ok(prompt.includes("not Base/Model and not a fake one-column matrix"));
});

test("generic Modular and workstation fixed-quantity guidance support both Modular pricing modes", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "For Matrix Modular preserve Modular Group -> Module Rows -> matrix columns -> row price maps",
    "For Direct Modular preserve Modular Group -> directRows with scalar row price, optional row role, and optional composition; there are no Matrix columns.",
    "Never flatten separate manufacturer Modular groups into one generic group or matrix.",
    "for either a pricing.modularGroups[n].matrix.rows or pricing.modularGroups[n].directRows bench use",
    "for OXI_P Direct Modular, ART.058 targets those exact directRows.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected dual-mode Modular guidance: ${expected}`));
});

test("one-column Matrix contradiction is removed: multiple direct-price families stay in baseModelRows instead of a fake Matrix", () => {
  const prompt = getProductTemplateAiExtractionPrompt("base_model");
  assert.ok(!prompt.includes("Preserve each family as a separate priceMatrix with its source family label and one clearly labelled direct Price column"), "Expected the old one-column-Matrix workaround wording to be removed");
  [
    "Do NOT create a fake one-column priceMatrix to preserve these groups",
    "a one-column \"Price\" matrix remains a forbidden fake Matrix no matter how many families exist",
    "pricing.baseModelRows remains one flat JSON array, but rows may now carry native grouping metadata: groupId and groupLabel",
    "Do NOT create an extractionWarning merely because multiple native Base/Model groups exist",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected corrected Base/Model text to contain: ${expected}`));
  extractionPromptFocuses.forEach((focus) => {
    assert.ok(getProductTemplateAiExtractionPrompt(focus).includes("no one-column \"Standard Price\" Matrix was created, including as a workaround to preserve multiple Base/Model families"), `Expected ${focus} self-check to forbid the fake-Matrix workaround`);
  });
});

test("Copy Prompt regression: the exact UI-facing builder function generates the workstation prompt with every latest contract change", () => {
  // Same import and same call signature as components/products/copy-ai-extraction-prompt.tsx's
  // CopyAiExtractionPrompt: getProductTemplateAiExtractionPrompt(focus) with focus = "workstation".
  const generated = getProductTemplateAiExtractionPrompt("workstation");

  [
    // A. optionGroup conditionalConfiguration field (no invalid "fixed_quantity": null placeholder).
    '"conditionalConfiguration": { "role": "companion", "selection": "exactly_one", "applicability": [{ "target": { "kind": "workstation", "group_id": "", "row_id": "" }, "required": true, "visible": true }] }',
    // B. exact runtime applicability field names.
    "role: \"accessory\" | \"conditional_option\" | \"companion\"",
    "selection: \"unrestricted\" | \"exactly_one\" | \"at_least_one\" | \"choose_multiple\"",
    "target: { kind: \"base_model\" | \"price_matrix\" | \"modular\" | \"workstation\" | \"option_item\", group_id, row_id }",
    "allowed_item_ids: optional array restricting which of this group's items apply under that rule",
    "required and visible: booleans",
    "fixed_quantity: a positive integer for an explicit manufacturer-required quantity",
    "OMIT the field entirely when no fixed quantity applies; never emit \"fixed_quantity\": null",
    "TARGET GROUP_ID CONVENTION",
    // C. workstation target kind and group_id reachable through the routing hierarchy and OXI example.
    "target: { kind: \"workstation\", group_id: \"legacy-workstation-main\", row_id: \"oxi-q-ws-dx\" }",
    "row_id is the row's own draft id, never its supplierCodes entry (\"111 623\")",
    // D. ART.058 unit price preserved, fixed quantity structural, no synthetic multiplied item, correct selection mode.
    "ART.058 at supplier code 111 058, unit price EUR 69, remains one row priced at EUR 69, never a synthesized EUR 138 item",
    "fixed_quantity to 2 plus scale_with_target_quantity: true on the companion optionGroup",
    "conditionalConfiguration.selection to \"at_least_one\" — never \"exactly_one\"",
    "COMPANION SELECTION MODE — CHOOSE-ONE VS QUANTITY-SCALED",
    "Never synthesize a bundled/multiplied item such as \"2 x ART.058\"",
    "Never calculate or store unit price × required quantity as a new authoritative item price",
    // E. source-example firewall (near the top banner plus the full section).
    "IMPORTANT: Codes, prices, dimensions, page numbers, and manufacturer examples appearing inside this prompt (including its regression examples) are architectural examples only. They are NEVER extraction evidence.",
    "SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL",
    // F. current-batch-only authority.
    "Extract only products, rows, prices, requirements, and components whose authoritative source is visibly present in the supplied extraction batch for this call",
    "If a required or referenced component/row lies outside the supplied pages",
  ].forEach((expected) => assert.ok(generated.includes(expected), `Expected the UI-generated workstation prompt to contain: ${expected}`));

  // G. no instruction anywhere recommending a fake one-column direct-price Matrix.
  assert.ok(!generated.includes("one clearly labelled direct Price column"), "Expected the generated prompt to no longer contain the legacy one-column fake-Matrix phrase");
  assert.ok(!generated.includes("Preserve each family as a separate priceMatrix with its source family label"), "Expected the generated prompt to no longer instruct a separate one-column priceMatrix per family");
});

test("target-identity audit 1-2: the JSON contract example never shows an invalid fixed_quantity: null placeholder, and prose says to omit it instead", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    const contractStart = prompt.indexOf("PRODUCTTEMPLATEDRAFT V1 CONTRACT");
    const contractEnd = prompt.indexOf("The shape above is a field contract", contractStart);
    assert.ok(contractStart >= 0 && contractEnd > contractStart, `Expected ${focus} prompt to contain the PRODUCTTEMPLATEDRAFT V1 CONTRACT block`);
    const contractBlock = prompt.slice(contractStart, contractEnd);
    assert.ok(!contractBlock.includes('"fixed_quantity"'), `Expected ${focus} prompt's JSON contract example to omit the optional, non-nullable fixed_quantity field entirely rather than showing an invalid null placeholder`);
    // The prohibition may still be stated in prose elsewhere (quoting the forbidden literal to forbid it).
    assert.ok(prompt.includes('OMIT the field entirely when no fixed quantity applies; never emit "fixed_quantity": null'), `Expected ${focus} prompt to instruct omitting fixed_quantity instead of nulling it`);
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(workstationPrompt.includes('never emit "fixed_quantity": null — omit the field when no fixed quantity applies'), "Expected the workstation FIXED QUANTITY section to repeat the omit-not-null rule");
});

test("target-identity audit 3: row_id must reference the extracted row's own draft id, never a supplier code", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes("row_id always equals the exact stable id already assigned to that row/item in that structure") && prompt.includes('never a supplierCodes entry such as "111 623", and never invented from a code, label, or family name'),
      `Expected ${focus} prompt to forbid using a supplier code as row_id`,
    );
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(workstationPrompt.includes('row_id is the row\'s own draft id, never its supplierCodes entry ("111 623")'), "Expected the workstation companion example to contrast row_id against the supplier code");
});

test("target-identity audit 4: the workstation target example always includes group_id alongside kind and row_id", () => {
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(workstationPrompt.includes('target: { kind: "workstation", group_id: "legacy-workstation-main", row_id: "oxi-q-ws-dx" }'), "Expected the OXI companion example target to include group_id");
  assert.ok(!workstationPrompt.includes('target: { kind: "workstation", row_id:'), "Expected no workstation target example to omit group_id");
  extractionPromptFocuses.forEach((focus) => {
    assert.ok(getProductTemplateAiExtractionPrompt(focus).includes('target: { kind: "base_model" | "price_matrix" | "modular" | "workstation" | "option_item", group_id, row_id }'), `Expected ${focus} prompt's generic target shape to require group_id`);
  });
});

test("target-identity audit 5-6: Base/Model and Workstation group_id guidance matches the actual Apply-time adapter constants", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes(`(B) when the row has no groupId, group_id is "${LEGACY_BASE_MODEL_GROUP_ID}"`) && prompt.includes(`use group_id: "${LEGACY_WORKSTATION_GROUP_ID}" only for an actual workstation target`), `Expected ${focus} prompt to cite the real runtime sentinel group ids by import, not a hardcoded guess`);
  });
  // Prove the cited sentinels are exactly what the Apply-time normalizers synthesize for a flat, group-less row list —
  // the same shape pricing.baseModelRows[] / pricing.workstationRows[] always are in ProductTemplateDraft v1.
  const workstationGroups = workstationPricingGroups([{ id: "oxi-q-ws-dx", label: "OXI Q Workstation DX", price: 1200 }]);
  assert.equal(workstationGroups[0]?.id, LEGACY_WORKSTATION_GROUP_ID, "Expected the synthesized workstation group id to equal the prompt's cited sentinel");
  assert.equal(workstationGroups[0]?.items[0]?.id, "oxi-q-ws-dx", "Expected the row's own id to be preserved unchanged into the synthesized group");
});

test("target-identity audit 7: a generated conditionalConfiguration survives normalization and needs no identity repair before Apply", () => {
  const draft = {
    version: 1,
    template: { templateName: "OXI" },
    defaultCurrency: "EUR",
    pricing: {
      workstationRows: [{ id: "oxi-q-ws-dx", label: "OXI Q Workstation DX", price: 1200, supplierCodes: ["111 623"] }],
      baseModelRows: [], priceMatrices: [], modularGroups: [],
    },
    optionGroups: [{
      id: "leg-choice", label: "Required Leg",
      selection: { mode: "required_choose_one", minSelections: 1, maxSelections: 1, defaultItemIds: [] },
      items: [
        { id: "art-175", label: "ART.175", price: 45, supplierCodes: ["ART.175"] },
        { id: "art-129", label: "ART.129", price: 52, supplierCodes: ["ART.129"] },
      ],
      conditionalConfiguration: {
        role: "companion",
        selection: "exactly_one",
        applicability: [{ target: { kind: "workstation", group_id: LEGACY_WORKSTATION_GROUP_ID, row_id: "oxi-q-ws-dx" }, required: true, visible: true, allowed_item_ids: ["art-175", "art-129"] }],
      },
    }],
    materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
  };

  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true, `Expected the draft to normalize cleanly: ${JSON.stringify(result.errors)}`);
  const rule = result.draft?.optionGroups[0].conditionalConfiguration?.applicability[0];
  assert.equal(rule?.target?.kind, "workstation");
  assert.equal(rule?.target?.group_id, LEGACY_WORKSTATION_GROUP_ID);
  assert.equal(rule?.target?.row_id, "oxi-q-ws-dx");

  // Prove the target's group_id/row_id already match what Apply will synthesize from the same flat workstationRows —
  // no identity repair/rewrite is needed between extraction and Apply.
  const appliedGroups = workstationPricingGroups(result.draft?.pricing.workstationRows ?? []);
  assert.equal(appliedGroups[0]?.id, rule?.target?.group_id, "Expected the emitted group_id to already equal the group id Apply will synthesize");
  assert.ok(appliedGroups[0]?.items.some((item) => item.id === rule?.target?.row_id), "Expected the emitted row_id to already match a row Apply will preserve");
});

test.skip("target-identity audit 8: existing Matrix/Modular target representability is unchanged (superseded by routing-compatible target coverage)", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("for target.kind \"price_matrix\" or \"modular\", group_id is the exact pricing.priceMatrices[].id or pricing.modularGroups[].id that this draft already assigns to that matrix/group — both are already representable today, so reuse them exactly"), `Expected ${focus} prompt to keep Matrix/Modular group_id guidance unchanged`);
  });
});

// ---------------------------------------------------------------------------
// Matrix Modular role/composition contract (source-proven starter/add-on
// composition on top of category-dependent matrix pricing, e.g. Terra Office).
// ---------------------------------------------------------------------------

test("1: Matrix Modular contract shape exposes row.role for every focus", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('"currency": null, "role": "starter", "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] }, "composition"'),
      `Expected ${focus} prompt's Matrix Modular contract row to show role ahead of the group's composition field`,
    );
  });
});

test("2: Matrix Modular contract shape exposes group.composition for every focus", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('"prices": { "column-id": null } }] }, "composition": { "minStarters": 1, "maxStarters": 1 } }, { "id": "", "label": null, "defaultDimensions": null, "defaultSpecification": null, "pricingMode": "direct"'),
      `Expected ${focus} prompt's Matrix Modular group to show composition, immediately followed by the separate Direct Modular group`,
    );
  });
});

test("3: Matrix Modular contract example never pairs pricingMode: direct with the matrix shape", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(!prompt.includes('"matrix": { "id": "", "label": null, "columns": [{ "id": "", "label": null }], "rows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "role": "starter", "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] }, "pricingMode"'));
    assert.ok(
      prompt.includes('Never add pricingMode: "direct" to a Matrix Modular group merely because it carries role/composition; pricingMode: "direct" remains exclusive to Direct Modular groups that use directRows.'),
      `Expected ${focus} prompt to explicitly forbid pricingMode: "direct" on Matrix Modular`,
    );
  });
});

test("4: Matrix Modular role and composition are documented as optional, source-proven-only fields", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "MATRIX MODULAR COMPOSITION",
      "Matrix Modular may carry the same optional structural role/composition semantics as Direct Modular when the manufacturer proves genuine composition.",
      "Matrix Modular row.role may use the existing supported Modular roles such as starter, intermediate, and terminal.",
      'Matrix Modular group.composition may use { "minStarters": ..., "maxStarters": ... }, the same shape as Direct Modular composition.',
      "Do not add role or composition merely because a product uses matrix pricing.",
      "A Matrix Modular family with no source-proven starter/add-on structure must omit role and composition entirely and behave exactly as ordinary Matrix Modular.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("5: source-proven Modular composition plus category-dependent module prices routes to Matrix Modular, not top-level priceMatrices", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "MATRIX MODULAR VERSUS TOP-LEVEL PRICEMATRICES — ROUTING PRECEDENCE",
    "When BOTH (A) the family has genuine source-proven Modular composition such as starter plus extension/add-on rows, AND (B) those same module rows have manufacturer-proven finish/material/category-dependent prices, use Matrix Modular (pricing.modularGroups with a matrix).",
    "Do NOT route such a family to top-level pricing.priceMatrices merely because category-dependent pricing exists.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("6: ordinary non-Modular category-dependent pricing still routes to top-level pricing.priceMatrices", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "Top-level pricing.priceMatrices is for non-Modular primary row-by-category pricing, where no source-proven starter/add-on structural composition exists.",
    "Matrix Modular is for Modular composition whose module rows themselves carry category-dependent price maps.",
    "CATEGORY / MATRIX requires a genuine manufacturer-proven commercial category dimension",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("7: an ordinary Matrix Modular group without role/composition still normalizes as a valid draft", () => {
  const draft = {
    version: 1,
    template: { templateName: "Plain Matrix Modular", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "EUR",
    pricing: {
      workstationRows: [], baseModelRows: [], priceMatrices: [],
      modularGroups: [{
        id: "plain-matrix-modular",
        label: "Plain Modular Family",
        defaultDimensions: null,
        defaultSpecification: null,
        matrix: {
          id: "plain-matrix",
          label: null,
          columns: [{ id: "std", label: "Standard" }],
          rows: [{ id: "row-1", label: null, displayName: "Module A", dimensions: null, currency: "EUR", specification: null, importantRequirements: [], supplierCodes: [], referenceCodes: [], prices: { std: 100 } }],
        },
      }],
    },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: 0.9, sources: [],
  };
  const result = normalizeProductTemplateDraft(draft);
  assert.equal(result.valid, true, `Expected an ordinary Matrix Modular group with no role/composition to remain valid: ${JSON.stringify(result.errors)}`);
  const group = result.draft?.pricing.modularGroups[0];
  assert.equal(group?.composition, undefined);
  assert.equal(group?.matrix?.rows[0].role, undefined);
});

test("8: Terra regression requires exactly one Matrix Modular group for the Bench/Bench Extension family", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate"'));
});

test("9: Terra regression assigns Bench rows role starter", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('Bench rows with role "starter"'));
});

test("10: Terra regression assigns Bench Extension rows role intermediate", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('Bench Extension rows with role "intermediate"'));
});

test("11: Terra regression composition is exactly minStarters 1 / maxStarters 1", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('group composition { "minStarters": 1, "maxStarters": 1 }'));
});

test("12: Terra regression keeps Standard/BL-AN and Designs as matrix columns on the module rows", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("Standard (BL/AN) and Designs as matrix columns/price categories on those same rows"));
});

test("13: Terra regression keeps normal and E-suffix rows as separate manufacturer rows", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("normal and E-suffix rows preserved as separate manufacturer rows"));
  assert.ok(prompt.includes("The E suffix remains a manufacturer SKU variant representing the machined/electrification-ready version and must not be converted into a surcharge"));
});

test("14: Terra regression forbids a synthetic Designs surcharge optionGroup", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("no synthetic Designs surcharge optionGroup"));
});

test("15: Terra regression forbids selectionFamily between starter/extension rows and forbids pricingMode direct on this group", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("no selectionFamily between the starter and extension rows, and no pricingMode: \"direct\" on this group."));
});

test("16: OXI_P Direct Modular regression is unchanged by the Matrix Modular role/composition additions", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1"));
});

test("17: X3 Direct Modular + selectionFamily regression is unchanged by the Matrix Modular role/composition additions", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops, each with pricingMode: \"direct\"",
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged X3 regression text: ${expected}`));
});

test("18: OXI_Q Base/Model + Required Companion regression is unchanged by the Matrix Modular role/composition additions", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129"));
  assert.ok(prompt.includes("OXI 111 623 / 111 624 with ART.175 or ART.129"));
});

test("final safety check confirms Matrix Modular routing precedence and role/composition discipline", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('that a family with source-proven Modular composition plus manufacturer-proven category-dependent module prices was routed to Matrix Modular rather than top-level pricing.priceMatrices; that Matrix Modular row.role/group.composition were emitted only when composition is source-proven and never given pricingMode: "direct";'),
      `Expected ${focus} prompt's global self-check to include the Matrix Modular routing/role/composition verification`,
    );
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "that a family with both source-proven Modular composition and manufacturer-proven category-dependent module prices was routed to Matrix Modular rather than top-level pricing.priceMatrices",
    'that Matrix Modular row.role and group.composition were emitted only when the source proves starter/add-on composition, and were never invented for an ordinary Matrix Modular family with no proven composition',
    'that Matrix Modular was never given pricingMode: "direct"',
  ].forEach((expected) => assert.ok(workstationPrompt.includes(expected), `Expected workstation final safety check to contain: ${expected}`));
});

// ---------------------------------------------------------------------------
// Global routing text: category pricing without Modular composition stays
// top-level, but the same rows under proven Modular composition route to
// Matrix Modular (scalar module prices still use Direct Modular instead).
// ---------------------------------------------------------------------------

test("1: category-dependent pricing without Modular composition routes to top-level pricing.priceMatrices", () => {
  const prompt = getProductTemplateAiExtractionPrompt("full");
  assert.ok(prompt.includes('When each PRIMARY product SKU has category-dependent prices and there is NO source-proven Modular composition, use pricing.priceMatrices.'));
  assert.ok(prompt.includes('When each SKU has only one direct price and there is no Modular composition, use pricing.baseModelRows.'));
});

test("2: scalar-priced Modular composition routes to Direct Modular", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('(4) source-proven component/module composition, including starter/add-on systems, routes to pricing.modularGroups: scalar module prices use Direct Modular, while category/finish-dependent module prices use Matrix Modular.'));
});

test("3: category/finish-dependent Modular composition routes to Matrix Modular", () => {
  const prompt = getProductTemplateAiExtractionPrompt("full");
  assert.ok(prompt.includes('When the SAME category-priced rows also participate in source-proven Modular composition such as starter + extension/add-on, do NOT stop at top-level pricing.priceMatrices; route the family to Matrix Modular under pricing.modularGroups so both the category-dependent price map and the structural role/composition are preserved.'));
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(workstationPrompt.includes('(3) genuine manufacturer-proven row-by-category or finish-price-class pricing with NO source-proven structural composition routes to pricing.priceMatrices;'));
});

test("4: Terra regression remains unchanged by the routing-text replacements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate", group composition { "minStarters": 1, "maxStarters": 1 }, Standard (BL/AN) and Designs as matrix columns/price categories on those same rows, normal and E-suffix rows preserved as separate manufacturer rows, no synthetic Designs surcharge optionGroup, no selectionFamily between the starter and extension rows, and no pricingMode: "direct" on this group.'));
});

test("5: OXI_P regression remains unchanged by the routing-text replacements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1"));
});

test("6: X3 regression remains unchanged by the routing-text replacements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops, each with pricingMode: \"direct\"",
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged X3 regression text: ${expected}`));
});

test("7: OXI_Q regression remains unchanged by the routing-text replacements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129"));
  assert.ok(prompt.includes("OXI 111 623 / 111 624 with ART.175 or ART.129"));
});

// ---------------------------------------------------------------------------
// Accessory target-scope tightening (general collection pages vs. proven
// Bench applicability) and E-suffix "machined/prepared for electrification"
// wording, plus the Bench/Workstation row-specification quality rule.
// ---------------------------------------------------------------------------

test("1: a general collection accessory page alone does NOT prove target-family applicability", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "Do not blindly attach every accessory shown on a manufacturer accessories page merely because that page is part of the supplied extraction batch.",
    "A general collection-level accessory page does NOT prove that every listed accessory applies to the current target ProductTemplateDraft.",
    "general electrification, cable tray, cable, and ancillary items shown only on a collection-wide accessory page must not automatically become confirmed Bench optionGroups unless the supplied source proves Bench applicability",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test('2: "drilled for bench" is valid Bench applicability evidence', () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('Explicit wording such as "drilled for bench", "for bench", "for meeting tables", "for operative desks", "for extension", or an accessory printed directly inside the selected family\'s own pricing block is strong applicability evidence and must be respected literally.'));
  assert.ok(prompt.includes('a cable grommet item explicitly marked "drilled for bench" may be included for the Bench target'));
});

test('3: "for meeting tables" is excluded from the Bench target', () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('an item explicitly marked "center drill for meeting tables" must NOT be included as a selectable Bench option'));
  assert.ok(prompt.includes("exclude items explicitly assigned to other product types such as meeting tables"));
});

test("4: unresolved general accessory applicability becomes a needs_review optionGroups item, never a silently omitted warning-only item or an unconditional global optionGroup", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    'when a general accessory is commercially relevant but exact target-family applicability is not proven, PRESERVE the item in optionGroups with reviewStatus: "needs_review" and a concise reviewReason instead of omitting it or making it unconditionally globally selectable.',
    'If such general accessories appear commercially relevant but exact Bench applicability is unresolved, PRESERVE them in optionGroups with reviewStatus: "needs_review" and a concise reviewReason instead of omitting them or making them freely selectable as confirmed items.',
    'preserve unresolved general accessory applicability as optionGroups items with reviewStatus: "needs_review" and a concise reviewReason, rather than omitting them, silently attaching them as confirmed, or downgrading them to an extractionWarning alone.',
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("5: Terra E-suffix wording describes machined/prepared for electrification", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    'When the source defines the E suffix as a top machined/prepared for electrification, describe that row as "Machined for Electrification" or equivalent source-faithful wording.',
    "For Terra Office-style target scope, an E-suffix row means the top is machined/prepared for electrification when that is what the supplied technical source states",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test('6: Terra E-suffix is not described as fully "Electrified" unless the source explicitly says so', () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('Do NOT call the complete product "Electrified" unless the source explicitly proves that electrical hardware is included in that SKU.'));
  assert.ok(prompt.includes('do not label the complete Bench "Electrified" unless electrical hardware is explicitly included'));
});

test("7: separate electrification accessories are not assumed included/required for E-suffix rows", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("Do not infer that separate electrification accessories are included with, required by, or automatically compatible with an E-suffix row unless the supplied source explicitly proves that relationship."));
});

test("8: Terra Matrix Modular routing remains unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate"'));
});

test("9: Terra Standard/Designs matrix columns remain unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("Standard (BL/AN) and Designs as matrix columns/price categories on those same rows"));
});

test("10: Terra starter/intermediate roles remain unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('Bench rows with role "starter"'));
  assert.ok(prompt.includes('Bench Extension rows with role "intermediate"'));
});

test("11: Terra composition remains unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('group composition { "minStarters": 1, "maxStarters": 1 }'));
});

test("12: OXI_P regression remains unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1"));
});

test("13: OXI_Q regression remains unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129"));
  assert.ok(prompt.includes("OXI 111 623 / 111 624 with ART.175 or ART.129"));
});

test("14: X3 regression remains unchanged", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops, each with pricingMode: \"direct\"",
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged X3 regression text: ${expected}`));
});

test("15: row specification quality rule exists for technical-page-supported Bench/Workstation rows", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "WORKSTATION / BENCH ROW SPECIFICATION QUALITY",
    'When a supplied technical page clearly provides family-wide construction for the same priced Bench/Workstation family, row.specification should normally combine that supported shared construction with the row-specific configuration/dimensions instead of using only a minimal phrase such as "Bench starter unit."',
    "if the source proves a 25 mm MDP top, tubular steel legs, levellers, and the row's exact dimensions, a Bench row specification may combine those supported facts concisely with whether the row is a starter, extension, or machined-for-electrification variant",
    "Do not duplicate long family text mechanically. Keep row specifications concise, model-specific, and source-faithful.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("workstation final safety check adds E-suffix, general accessory page, and target-type exclusion verifications", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "that an E-suffix row defined only as machined/prepared for electrification was not mislabeled as fully electrified",
    "that a general collection accessory page was not treated as proof that every accessory applies to the selected Bench family",
    "that accessories explicitly assigned to another product type were excluded from the target template entirely rather than marked needs_review",
    "that unresolved general accessory applicability was preserved as a needs_review optionGroups item rather than omitted or made globally selectable as confirmed",
    "that reviewStatus/reviewReason were never invented for an accessory whose applicability the source already proves or already excludes",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation final safety check to contain: ${expected}`));
});

// ---------------------------------------------------------------------------
// Smart Setup applicability-review layer: optionGroups[].items may carry an
// optional reviewStatus/reviewReason so a commercially relevant, uncertain
// accessory is PRESERVED for human review instead of silently omitted.
// ---------------------------------------------------------------------------

test("the embedded ProductTemplateDraft v1 contract shows the optional reviewStatus/reviewReason field shape on optionGroups items for every focus", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('"referenceCodes": [], "reviewStatus": "needs_review", "reviewReason": "Exact target-family applicability is not proven by the supplied source." }] }, { "id": "", "label": null, "selection": { "mode": "required_choose_at_least_one"'),
      `Expected ${focus} prompt's optionGroups contract to show reviewStatus/reviewReason field shape`,
    );
  });
});

test("OPTIONGROUPS.ITEMS REVIEW STATUS documents reviewStatus/reviewReason as optional, review-boundary-only, and never invented for proven or excluded items", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "OPTIONGROUPS.ITEMS REVIEW STATUS",
      'Every optionGroups[].items entry may optionally carry reviewStatus: "confirmed" | "needs_review" and a short reviewReason string.',
      "it never affects price, prices, dimensions, supplier codes, conditionalConfiguration, role, quantity, or selection mode",
      "it never persists into saved Product Template pricing JSON, Product Library, or quotation data",
      'OMIT reviewStatus/reviewReason entirely, or use reviewStatus: "confirmed", for an ordinary accessory whose applicability the supplied source proves or that needs no review. Missing reviewStatus behaves as confirmed; never invent reviewReason for a confirmed item.',
      'Use reviewStatus: "needs_review" plus a concise, trimmed, non-empty reviewReason only for the PRESERVE + NEEDS REVIEW case',
      "Do NOT invent conditionalConfiguration/applicability for a needs_review item merely to justify including it.",
      'Do NOT use reviewStatus: "needs_review" for an item the source explicitly assigns to another product type; that item is excluded from the target template entirely, not preserved with any reviewStatus.',
      'Never emit any reviewStatus value other than "confirmed" or "needs_review", and never emit an empty reviewReason string',
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("ACCESSORY PAGE COVERAGE requires PRESERVE + NEEDS REVIEW for uncertain applicability instead of OMIT + WARNING ONLY", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "UNCERTAIN case: PRESERVE + NEEDS REVIEW, never OMIT + WARNING ONLY.",
    'A commercially relevant, plausibly related accessory whose exact applicability is unproven must reach optionGroups as a reviewStatus: "needs_review" item so a human can confirm or exclude it in Smart Setup; it must not be silently dropped and replaced with only an extractionWarning or a linkedFamilySuggestion.',
    'when a general accessory is commercially relevant but exact target-family applicability is not proven, PRESERVE the item in optionGroups with reviewStatus: "needs_review" and a concise reviewReason instead of omitting it or making it unconditionally globally selectable.',
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("14: an explicitly incompatible accessory (another product type) remains excluded entirely, never marked needs_review", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    'exclude an accessory when the source explicitly ties it to another family/product type; do NOT use reviewStatus: "needs_review" as a way to bypass that clear incompatibility;',
    'an item explicitly marked "center drill for meeting tables" must NOT be included as a selectable Bench option, and must NOT be preserved as needs_review either — it is excluded entirely;',
    'exclude items explicitly assigned to other product types such as meeting tables entirely, never as needs_review;',
    "When the source explicitly assigns the item to another product type:\n- exclude it from the selected target template\n- do NOT use needs_review as a way to bypass clear incompatibility",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

// ---------------------------------------------------------------------------
// Companion furniture family preservation: a separately priced cabinet,
// pedestal, service unit, return, support storage, bridge, or similar
// component must never be silently dropped merely because it sits beside the
// selected primary family, and it must never distort that family's pricing
// architecture unless genuine Modular composition is proven.
// ---------------------------------------------------------------------------

test("1/5: COMPANION FURNITURE FAMILY PRESERVATION requires every separately priced companion (cabinet, pedestal, service unit, return, etc.) to be preserved, never omitted, and never merged into the primary row price", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "COMPANION FURNITURE FAMILY PRESERVATION",
      "When the selected primary family is commercially defined by another separately priced furniture component shown in the same supplied source block, do not silently omit that companion merely because it has its own supplier codes, dimensions, images, and prices.",
      "- cabinet",
      "- pedestal",
      "- service unit",
      "- under-top storage",
      "- return",
      "- bridge",
      "- support storage",
      "- support cabinet",
      "- extension furniture",
      "- separately priced structural support component",
      "Preserve the primary family and companion family as separate commercial entities.",
      "Never flatten a separately priced furniture companion into a normal small accessory merely because it appears beside the primary family.",
      "Never add the companion price to the primary row price unless the source explicitly defines one complete combined price.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("2: a required companion relationship is emitted only when the source proves requiredness", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("If the supplied source explicitly proves the companion is REQUIRED for the selected primary family:"), `Expected ${focus} prompt to gate required companion preservation on explicit source proof`);
    assert.ok(prompt.includes("preserve the companion relationship as required/companion configuration using the existing supported linked/companion mechanisms;"));
    assert.ok(prompt.includes("do not merge the companion price into the primary SKU unless the manufacturer explicitly prices them as one complete SKU."));
  });
});

test("3: an optional companion relationship is emitted only when the source proves optionality", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("If the supplied source explicitly proves the companion is OPTIONAL:"), `Expected ${focus} prompt to gate optional companion preservation on explicit source proof`);
    assert.ok(prompt.includes("preserve it as an optional linked/companion family using the existing supported mechanisms."));
  });
});

test("4: an unresolved companion relationship is preserved for review / as a linked suggestion, never omitted or invented", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "If the commercial relationship is clear from the supplied source, but exact requiredness, compatibility, or row-level applicability is not fully proven:",
      "- do NOT omit the companion;",
      "- preserve it as a linkedFamilySuggestion or other existing reviewable companion representation;",
      "- if available within the current draft contract, mark the unresolved applicability for user review rather than inventing a required rule.",
      "If the source explicitly proves the separately priced item belongs to another unrelated product type:\n- exclude it from the selected target family.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("6/7: a complete primary SKU is not routed to Modular solely because a companion family exists, but genuine starter/add-on systems still route to Modular", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "PRIMARY FAMILY VS COMPANION ROUTING",
      "A separately priced companion furniture family must not change the pricing architecture of the primary family unless the source proves genuine modular composition.",
      "- complete category-priced desk/bench rows + separately priced cabinet companion\n  -> primary rows remain complete category-priced primary SKUs;\n  -> cabinet remains a separate linked/companion family.",
      "- complete direct-priced desk + separately priced pedestal/service unit\n  -> desk remains Base/Model or the correct complete-SKU architecture;\n  -> pedestal/service unit remains a separate linked/companion family.",
      "- genuine starter/add-on/module system\n  -> use Modular pricing only when the source proves true structural composition between those rows.",
      "Do not route a complete primary SKU family to Modular merely because a separately priced companion cabinet, pedestal, return, or service unit is shown nearby.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("8: SAME-PAGE UNRELATED PRIMARY PRODUCT ISOLATION does not incorrectly exclude a commercially linked companion furniture item", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("A separately priced furniture item that is commercially part of the selected system as a cabinet, pedestal, service unit, return, support storage, bridge, or other companion must NOT be treated as an unrelated same-page primary product merely because it has separate supplier codes and prices; apply COMPANION FURNITURE FAMILY PRESERVATION instead."));
  // Still part of the SAME-PAGE UNRELATED PRIMARY PRODUCT ISOLATION section, right after its existing closing sentence.
  assert.ok(prompt.includes("This rule is mandatory whenever TARGET TEMPLATE SCOPE identifies one selected family. Same-page proximity never overrides target-template scope. A separately priced furniture item"));
});

test("9/10/11: Terra Bench-for-Cabinet regression preserves complete primary Bench rows and a separate, review-safe cabinet companion", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    'For a Terra Office-style "Bench for Cabinet" source block, complete Bench-for-Cabinet rows such as normal and E-suffix Bench SKUs remain complete primary priced rows with their manufacturer-proven category/finish price columns.',
    "They must not be forced into starter/intermediate Modular composition merely because a separately priced cabinet family is shown in the same commercial block.",
    "A separately priced cabinet family shown directly under the Bench-for-Cabinet commercial section must not be silently omitted.",
    'If that same supplied source visibly provides the cabinet family\'s own SKU codes, dimensions, and prices, those authoritative cabinet rows must also be preserved as reviewable companion commercial rows; a linkedFamilySuggestion alone is insufficient because it loses the cabinet\'s commercial pricing data.',
    "Preserve each supplied cabinet SKU separately using an optionGroup or the safest currently supported companion structure.",
    'If exact Bench-row compatibility or requiredness is not fully proven, mark the cabinet items reviewStatus: "needs_review" with a concise reviewReason instead of inventing conditionalConfiguration.',
    "Do not merge cabinet price into the Bench price. Preserve that cabinet family separately as a linked/companion furniture candidate.",
    "If the supplied source explicitly proves the cabinet is required, preserve it as a required companion; if exact requiredness or row compatibility is not fully proven, preserve it for user review rather than inventing the rule.",
    "The cabinet price must never be merged into the Bench price unless the manufacturer explicitly provides one combined complete price.",
    "This Terra example is regression guidance only. Codes, labels, dimensions, prices, and compatibility must still come from the supplied source.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("12: Terra standard Bench starter/intermediate Matrix Modular regression remains unchanged by the companion-family rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate", group composition { "minStarters": 1, "maxStarters": 1 }, Standard (BL/AN) and Designs as matrix columns/price categories on those same rows, normal and E-suffix rows preserved as separate manufacturer rows, no synthetic Designs surcharge optionGroup, no selectionFamily between the starter and extension rows, and no pricingMode: "direct" on this group.'));
});

test("13: X3 regression remains unchanged by the companion-family rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops, each with pricingMode: \"direct\"",
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged X3 regression text: ${expected}`));
});

test("14: OXI_P regression remains unchanged by the companion-family rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1"));
});

test("15: OXI_Q regression remains unchanged by the companion-family rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129"));
  assert.ok(prompt.includes("OXI 111 623 / 111 624 with ART.175 or ART.129"));
});

test("16: accessory needs_review rules remain unchanged by the companion-family rules", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes('Every optionGroups[].items entry may optionally carry reviewStatus: "confirmed" | "needs_review" and a short reviewReason string.'));
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(workstationPrompt.includes('preserve unresolved general accessory applicability as optionGroups items with reviewStatus: "needs_review" and a concise reviewReason'));
});

test("workstation final safety check adds companion-family preservation verifications", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "that a separately priced cabinet, pedestal, service unit, return, support storage, bridge, or other companion furniture family shown as part of the selected commercial system was not silently omitted",
    "that complete primary SKUs were not incorrectly routed to Modular merely because a companion family was present",
    "that companion prices were not merged into primary SKU prices without explicit manufacturer proof",
    "and that unresolved companion applicability or requiredness was preserved for review rather than invented",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation final safety check to contain: ${expected}`));
});

test("FINAL CHECK item 29 documents companion furniture family preservation", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('29. Every separately priced companion furniture family that is commercially part of the selected target system was preserved separately rather than silently omitted or flattened into a normal accessory; exact required/optional relationships were emitted only when proven by the source, unresolved relationships were preserved for review, and companion prices were not merged into primary SKU prices unless explicitly combined by the manufacturer.'),
      `Expected ${focus} prompt's FINAL CHECK to include item 29 on companion furniture family preservation`,
    );
  });
});

// ---------------------------------------------------------------------------
// Companion commercial row preservation: a linkedFamilySuggestion alone is
// insufficient when the companion family has its own authoritative SKU
// rows — those rows (code, dimensions, price, spec) must be preserved too,
// as reviewable optionGroup items when requiredness/applicability is not
// yet proven, or as a Required Companion when it explicitly is proven.
// ---------------------------------------------------------------------------

test("1: a linkedFamilySuggestion alone is documented as insufficient when the companion has authoritative priced rows", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "When the companion family itself has authoritative commercial rows in the supplied source — for example its own supplier codes, dimensions, prices, specifications, images, or finish/category prices — preserving only a linkedFamilySuggestion is NOT sufficient because that would discard the companion's commercial data.",
      "COMPANION COMMERCIAL ROW PRESERVATION",
      "A linkedFamilySuggestion preserves relationship/context only. It does NOT replace extraction of authoritative companion commercial rows when those rows are visibly supplied.",
      "linkedFamilySuggestions are relationship metadata only. They must not be used as the sole representation of a separately priced companion family when the supplied source includes authoritative companion SKU rows with prices/dimensions/codes. In that case preserve the linked-family relationship if useful, but also preserve the actual commercial companion rows according to COMPANION COMMERCIAL ROW PRESERVATION.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("2/3/4: companion supplier code, dimensions, and price are all named as fields that must be preserved on each companion row", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "1. Preserve each distinct companion SKU row separately.",
      "2. Preserve its:\n   - supplier code\n   - display name / label\n   - dimensions\n   - currency\n   - authoritative price or price map\n   - specification\n   - importantRequirements\n   - source-supported image/reference information where the current contract permits it.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("5: multiple companion SKUs must remain separate rows, never collapsed into one generic suggestion", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes("3. Never collapse several companion SKUs into one generic linked-family suggestion if doing so would lose prices, dimensions, or row identity."), `Expected ${focus} prompt to contain the multi-SKU preservation rule`);
  });
});

test("6/7: unresolved companion rows use reviewStatus: needs_review and must not invent conditionalConfiguration", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      'when the companion rows are reviewable separately priced furniture and exact requiredness/applicability is not yet proven, preserve them in an optionGroup using the ordinary priced-item fields;',
      'mark each unresolved companion item reviewStatus: "needs_review";',
      "use a concise reviewReason explaining that the commercial relationship is clear but exact requiredness and/or row applicability is not fully proven;",
      "do NOT invent conditionalConfiguration while the relationship remains unresolved;",
      "allow the user to confirm or exclude the companion in Smart Setup.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("8: explicitly proven required companions may use the supported Required Companion / conditionalConfiguration structure instead of needs_review", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "If the source explicitly proves exact requiredness and row applicability and the current supported companion structure can safely encode it:",
      "- use the supported Required Companion / conditionalConfiguration structure instead of needs_review;",
      "- preserve fixed quantity only when explicitly proven.",
      "If the companion is explicitly unrelated to the target family:\n- exclude it entirely.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
});

test("9: companion price is never merged into the primary SKU price unless the manufacturer publishes one combined price", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "4. Never merge the companion price into the primary SKU price unless the manufacturer explicitly publishes one combined complete price.",
      "5. Never move a substantial separately priced furniture companion into primary pricing simply because it has a price.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to contain: ${expected}`));
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(workstationPrompt.includes("Do not merge cabinet price into the Bench price."));
  assert.ok(workstationPrompt.includes("  -> when cabinet SKU rows and prices are supplied, preserve those cabinet commercial rows separately as well; do not reduce them to relationship metadata only."));
});

test("10: Terra Bench-for-Cabinet cabinet rows are preserved commercially (code, dimensions, price), not just as a linkedFamilySuggestion", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    'If that same supplied source visibly provides the cabinet family\'s own SKU codes, dimensions, and prices, those authoritative cabinet rows must also be preserved as reviewable companion commercial rows; a linkedFamilySuggestion alone is insufficient because it loses the cabinet\'s commercial pricing data.',
    "Preserve each supplied cabinet SKU separately using an optionGroup or the safest currently supported companion structure.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation prompt to contain: ${expected}`));
});

test("11: Terra cabinet linkedFamilySuggestion may coexist with priced reviewable rows, and unresolved cabinet rows use needs_review, never invented conditionalConfiguration", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('If exact Bench-row compatibility or requiredness is not fully proven, mark the cabinet items reviewStatus: "needs_review" with a concise reviewReason instead of inventing conditionalConfiguration.'));
  assert.ok(prompt.includes("preserve linkedFamilySuggestions when useful for family-level relationship/context;"));
  assert.ok(prompt.includes("ALSO preserve the actual supplied companion commercial rows using an existing ProductTemplateDraft structure that can retain their code, dimensions, price, currency, specification, and review state;"));
});

test("12: Terra standard Bench starter/intermediate Matrix Modular regression remains unchanged by the companion commercial-row rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes('route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate", group composition { "minStarters": 1, "maxStarters": 1 }, Standard (BL/AN) and Designs as matrix columns/price categories on those same rows, normal and E-suffix rows preserved as separate manufacturer rows, no synthetic Designs surcharge optionGroup, no selectionFamily between the starter and extension rows, and no pricingMode: "direct" on this group.'));
});

test("13: X3 regression remains unchanged by the companion commercial-row rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops, each with pricingMode: \"direct\"",
    "Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected unchanged X3 regression text: ${expected}`));
});

test("14: OXI_P regression remains unchanged by the companion commercial-row rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1"));
});

test("15: OXI_Q regression remains unchanged by the companion commercial-row rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  assert.ok(prompt.includes("OXI extracted id \"oxi-q-ws-dx\" with supplierCodes [\"111 623\"], always complete with either ART.175 or ART.129"));
  assert.ok(prompt.includes("OXI 111 623 / 111 624 with ART.175 or ART.129"));
});

test("16: accessory needs_review contract rules remain unchanged by the companion commercial-row rules", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes('Every optionGroups[].items entry may optionally carry reviewStatus: "confirmed" | "needs_review" and a short reviewReason string.'));
    assert.ok(prompt.includes('Do NOT use reviewStatus: "needs_review" for an item the source explicitly assigns to another product type; that item is excluded from the target template entirely, not preserved with any reviewStatus.'));
  });
});

test("workstation final safety check adds companion commercial-row preservation verifications", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "that a supplied companion furniture family with authoritative priced SKU rows was not represented only as a linkedFamilySuggestion while its prices/dimensions/codes were lost",
    "that each supplied companion SKU row was preserved separately",
    "that unresolved companion rows were surfaced for user review without invented applicability",
    "and that no companion commercial price was merged into the primary SKU price without explicit manufacturer proof",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected workstation final safety check to contain: ${expected}`));
});

test("FINAL CHECK item 30 documents companion commercial-row preservation", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(
      prompt.includes('30. Every supplied separately priced companion furniture SKU retained its authoritative commercial row data — including code, dimensions, currency, price or price map, and supported specification — rather than being reduced only to linkedFamilySuggestions; unresolved companion applicability/requiredness was preserved for user review, and no companion price was merged into the primary SKU unless the manufacturer explicitly publishes a combined price.'),
      `Expected ${focus} prompt's FINAL CHECK to include item 30 on companion commercial-row preservation`,
    );
  });
});

test("structural-support and option-item dependency contract is documented without changing existing routing examples", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    '"structural_support"',
    '"base_model" | "price_matrix" | "modular" | "workstation" | "option_item"',
    '"kind": "option_item"',
    "<exact optionGroups[].id containing the trigger item>",
    "not as a normal optional accessory",
    "Do NOT infer structural support from cabinet/storage/support words alone",
    "fixed_quantity only when explicitly proven",
    "Arbitrary recursive/deeper dependency graphs remain unsupported",
    "WORKSTATION FINAL SAFETY CHECK",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected structural-support prompt guidance: ${expected}`));
  ["base_model", "price_matrix", "modular", "workstation", "OXI_P starter rows", "Terra Office-style"].forEach((expected) => assert.ok(prompt.includes(expected), `Expected existing regression/routing guidance: ${expected}`));
});

test("source-proven structural support precedes Base/Model fallback and keeps scaling safe", () => {
  const prompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "SOURCE-PROVEN STRUCTURAL SUPPORT PRECEDENCE",
    'route it as an optionGroups item with role "structural_support" even if it has a direct price',
    "takes precedence over the ordinary direct-priced primary SKU -> Base/Model fallback",
    "Do not put it in pricing.baseModelRows",
    'dependent companion uses target.kind "option_item"',
    "scale_with_target_quantity: true is supported only for modular or option_item targets",
    "Never emit it for base_model, price_matrix, or workstation",
    "35. A source-proven structural-support item was routed to optionGroups",
    "36. No structural-support item was duplicated",
    "37. scale_with_target_quantity is used only for supported target kinds",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected structural routing precedence: ${expected}`));
  ["direct-priced primary SKU", "OXI_P starter rows", "Terra Office-style", "X3-style"].forEach((expected) => assert.ok(prompt.includes(expected), `Expected existing routing regression: ${expected}`));
});

test("ProductTemplateDraft v1 contract visibly documents compatibleTargets on optionGroups[].items[], only for structural_support", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      `"role": "structural_support", "compatibleTargets": [{ "kind": "base_model", "group_id": "${LEGACY_BASE_MODEL_GROUP_ID}", "row_id": "example-main-row-id" }] }] }],`,
      "optionGroups[].items[].compatibleTargets is OPTIONAL and meaningful only for an option item with role \"structural_support\"",
      "omit it for every other item, including a normal or companion item",
      "Do not imply every structural support requires compatibleTargets",
      "compatibleTargets belongs on optionGroups[].items[] only; do not add it to baseModelRows, workstationRows, priceMatrices rows, modular rows, or conditionalConfiguration",
      "do not add fields beyond documented contract fields such as unavailableCategoryIds, conditionalConfiguration, or reviewStatus/reviewReason",
      "Documented optional optionGroups[].items[] fields also include role and compatibleTargets",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} contract to document compatibleTargets: ${expected}`));
  });
});

test("extraction emits row-level base_model compatibility only, with the exact group_id, and forbids base_model_subgroup / non-row ids", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "AI extraction emits row-level base_model compatibility targets only: { \"kind\": \"base_model\", \"group_id\": \"<exact Base/Model row groupId, or " + LEGACY_BASE_MODEL_GROUP_ID + " for an ordinary ungrouped row>\", \"row_id\": \"<exact already-emitted pricing.baseModelRows[].id>\" }",
      "group_id is exactly the target row's native groupId when it has one, and exactly \"" + LEGACY_BASE_MODEL_GROUP_ID + "\" for an ordinary ungrouped Base/Model row",
      "row_id is the exact already-emitted pricing.baseModelRows[].id; never use supplierCodes as row_id; never invent subgroup IDs during extraction",
      "base_model_subgroup is runtime/Smart Setup metadata only and must not be emitted by the extractor",
      "EXTRACTION-TIME COMPATIBILITY TARGETS",
      "DO NOT EMIT: base_model_subgroup; Smart Setup visual subgroup ids; generated auto subgroup ids; labels as row_id; supplier codes as row_id; name-based compatibility references",
      "Smart Setup may later collapse multiple compatible Base/Model row targets into subgroup targets",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to limit extraction-time targets: ${expected}`));
  });
});

test("structural support -> compatible main products is documented as a distinct relationship from required companion, and both may coexist", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "STRUCTURAL SUPPORT / COMPATIBLE MAIN PRODUCTS",
      "When manufacturer evidence proves that a structural-support item is intended for specific complete Base/Model products in the selected system, preserve that compatibility on the structural-support option item using compatibleTargets",
      "Emit one target per exact supported main row",
      "Do NOT emit manufacturer codes from this prompt example",
      "Emit compatibleTargets only when manufacturer evidence proves that the main product belongs to / integrates with / is designed for / fixes to / uses that exact structural-support system",
      "Do NOT infer compatibility from: same catalogue chapter; nearby page placement; matching finish; dimensions; visual similarity; code sequence; naming coincidence; generic cabinet/support wording alone",
      "preserve the structural-support item, do NOT invent compatibleTargets, and add extractionWarning/manual-review wording when useful",
      "(A) Structural support -> required companion uses conditionalConfiguration with target.kind \"option_item\"",
      "(B) Structural support -> compatible main products uses item.compatibleTargets",
      "Do NOT encode main-product compatibility using conditionalConfiguration",
      "Do NOT use option_item for support -> main-product compatibility",
      "Do NOT use compatibleTargets for required companion enforcement",
      "Both relationships may coexist on the same structural-support item",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to document compatible-main-products guidance: ${expected}`));
  });
});

test("structural support routing precedence extends to compatibleTargets without moving compatible main rows out of Base/Model", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "After routing the structural-support item to optionGroups, if the supplied source also proves which Base/Model products use that structural support, emit compatibleTargets on that support item pointing to those exact already-emitted Base/Model row IDs",
      "The primary products themselves remain normal pricing.baseModelRows",
      "Do not move compatible main desk/bench rows into optionGroups",
      "Do not move the structural-support item back into Base/Model merely to express compatibility",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to extend structural-support precedence: ${expected}`));
  });
  // SOURCE-PROVEN STRUCTURAL SUPPORT PRECEDENCE itself remains intact.
  assert.ok(getProductTemplateAiExtractionPrompt("workstation").includes("SOURCE-PROVEN STRUCTURAL SUPPORT PRECEDENCE"));
});

test("Base / Model rows and Service Cabinet / Storage sections document compatibleTargets without changing routing", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "When complete direct-priced Base/Model rows are explicitly designed for a separately priced structural-support option item, the rows remain authoritative pricing.baseModelRows",
      "Their compatibility with the structural support is represented from the structural-support item's compatibleTargets",
      "Do not duplicate that relationship by changing the main row's pricing type",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt Base/Model compatibility guidance: ${expected}`));
  });
  const workstationPrompt = getProductTemplateAiExtractionPrompt("workstation");
  [
    "When manufacturer evidence proves that a genuine structural_support service cabinet/support item (not a native system_base row) is structural support for specific Base/Model workstation rows, emit compatibleTargets on that structural-support item for those exact rows",
    "Do NOT infer compatibility with every desk in the template",
    "Do NOT filter by product names in extraction",
    "Do NOT use a generic global compatibility flag",
  ].forEach((expected) => assert.ok(workstationPrompt.includes(expected), `Expected workstation prompt Service Cabinet compatibility guidance: ${expected}`));
});

test("companion furniture family preservation documents compatibleTargets as stronger than linkedFamilySuggestion, and main rows stay non-Modular", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "preserve BOTH role: \"structural_support\" and compatibleTargets pointing to those exact Base/Model rows",
      "This relationship is stronger than a linkedFamilySuggestion and must not be reduced to relationship metadata only when exact supported main rows are known",
      "Complete desk/bench rows that depend on a structural support remain complete primary pricing rows",
      "This compatibility relationship does NOT make the desk/bench Modular",
      "It does NOT merge support price into the main row price",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt companion-family compatibility guidance: ${expected}`));
  });
});

test("self-check and final checks 38-42 verify compatibleTargets usage without name/proximity inference", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "a source-proven structural-support item with proven exact main-product compatibility was not returned without compatibleTargets",
      "that compatibleTargets points only to exact already-emitted Base/Model row ids, never a supplier code or an invented Smart Setup subgroup id",
      "that support -> main compatibility was not incorrectly encoded as option_item conditionalConfiguration",
      "that support -> required companion and support -> compatible main products were kept as separate relationships",
      "that a main desk/bench row remained in Base/Model rather than being moved into optionGroups merely because it uses structural support",
      "38. When exact structural-support -> Base/Model compatibility is source-proven, the structural-support item carries compatibleTargets for those exact main rows.",
      "39. Every extraction-time compatibleTargets entry uses kind \"base_model\"; group_id is the exact target Base/Model row groupId when that row has a native groupId, otherwise group_id is exactly \"" + LEGACY_BASE_MODEL_GROUP_ID + "\" for an ungrouped Base/Model row; row_id is the exact already-emitted Base/Model row id.",
      "40. No extraction-time compatibleTargets entry uses a Smart Setup subgroup id, generated auto subgroup id, supplier code, label, or invented row id.",
      "41. Structural-support -> required companion remains encoded with option_item conditionalConfiguration, while structural-support -> compatible main products remains encoded with compatibleTargets; the two relationships were not conflated.",
      "42. Base/Model rows compatible with structural support remained authoritative Base/Model rows and were not moved into optionGroups or Modular pricing merely because of that dependency.",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} self-check/final-check guidance: ${expected}`));
  });
  assert.ok(getProductTemplateAiExtractionPrompt("workstation").includes("Verify that when the supplied source proves a workstation/desk/bench is designed for a particular structural-support item, that support item carries row-level compatibleTargets for the exact Base/Model rows"));
});

test("scale_with_target_quantity guidance consistently says modular or option_item, never base_model/price_matrix/workstation", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "scale_with_target_quantity: true is supported only for modular or option_item targets. Never emit it for base_model, price_matrix, or workstation; those targets may use fixed_quantity only.",
      "scale_with_target_quantity: optional boolean, allowed only for a modular or option_item target with fixed_quantity and selection other than exactly_one",
      "Do NOT permit it for base_model, price_matrix, or workstation targets",
      "For option_item, use it only with an explicit fixed_quantity and a supported non-exactly-one selection mode",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt to consistently scope scale_with_target_quantity: ${expected}`));
    assert.ok(!prompt.includes("optional boolean, only for a Modular target with fixed_quantity"), `Expected ${focus} prompt to no longer carry the stale Modular-only wording`);
  });
});

test("allowed_item_ids self-reference warning exists for a required-companion group triggered by option_item", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    [
      "do NOT emit allowed_item_ids merely to name the companion item itself when that group already contains the dependent item",
      "allowed_item_ids is only for restricting which items in a multi-item companion/option group are valid for a given applicability rule",
      "Do NOT add \"allowed_item_ids\": [\"top-b\"] merely to repeat that Top B is the sole item in its group",
      "This prevents the malformed pattern previously seen where the validator reports that allowed_item_ids references an invalid/current-group item",
    ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected ${focus} prompt allowed_item_ids self-reference warning: ${expected}`));
  });
});

// ---- Native System / Base architecture (Phase A + B runtime) ----
const nativeSystemPrompts = () => extractionPromptFocuses.map((focus) => [focus, getProductTemplateAiExtractionPrompt(focus)] as const);
const expectAll = (expected: string[]) => nativeSystemPrompts().forEach(([focus, prompt]) => expected.forEach((text) => assert.ok(prompt.includes(text), `Expected ${focus} prompt to include: ${text}`)));

test("Base/Model contract documents optional groupId, groupLabel and role system_base on baseModelRows only", () => {
  expectAll([
    "\"baseModelRows\": [{ \"id\": \"\", \"groupId\": \"system-family-id\", \"groupLabel\": \"System Family\", \"role\": \"system_base\", \"label\": null",
    "pricing.baseModelRows[].groupId, pricing.baseModelRows[].groupLabel and pricing.baseModelRows[].role are OPTIONAL native Base/Model fields",
    "the only supported Base/Model row role is \"system_base\", and ordinary Main Product rows OMIT role (never emit \"main_product\")",
    "do NOT add Base/Model group fields to workstationRows, priceMatrices rows, modular rows, or optionGroups items",
    "demonstrates field shape only, not default content",
    "never conflate the two role systems",
  ]);
  nativeSystemPrompts().forEach(([focus, prompt]) => {
    assert.ok(prompt.includes("\"normal\" | \"companion\" | \"structural_support\""), `Expected ${focus} optionGroups role namespace to stay independent`);
    assert.ok(prompt.includes("do NOT emit \"role\": \"main_product\""), `Expected ${focus} prompt to forbid a main_product role`);
  });
});

test("native System/Base precedence exists before the structural_support fallback and requires source proof", () => {
  nativeSystemPrompts().forEach(([focus, prompt]) => {
    const native = prompt.indexOf("NATIVE SYSTEM / BASE PRECEDENCE");
    const fallback = prompt.indexOf("SOURCE-PROVEN STRUCTURAL SUPPORT PRECEDENCE");
    assert.ok(native >= 0 && fallback > native, `Expected ${focus} native precedence before structural_support precedence`);
  });
  expectAll([
    "route that item into pricing.baseModelRows with role \"system_base\", and assign it a native groupId/groupLabel together with its compatible Main Product Base/Model rows",
    "takes precedence over the structural_support option-item workaround",
    "Do NOT infer system_base merely from words such as cabinet, storage, service unit, support, base, pedestal, return, or bridge",
    "Do NOT emit the same item as BOTH a role \"system_base\" Base/Model row AND a role \"structural_support\" option item",
    "This section applies only when the item is NOT a native first-stage System/Base",
    "Use optionGroups item role \"structural_support\" only when the item is instead genuinely a supporting/companion item",
  ]);
});

test("native System group membership, structural compatibility, and independent prices", () => {
  expectAll([
    "NATIVE SYSTEM GROUP MEMBERSHIP",
    "Every System/Base row and every Main Product row belonging to that System uses the same groupId",
    "\"groupId\": \"system-a\" and \"groupLabel\": \"System A\"",
    "Ordinary Main Product rows omit role; never emit \"main_product\"",
    "Do NOT invent subgroup IDs during extraction",
    "A native System group may contain multiple role \"system_base\" rows",
    "if their downstream Main Product families differ, use separate groupIds",
    "For native System/Base groups, compatibility is expressed by group membership",
    "Do NOT emit compatibleTargets for a native system_base row",
    "do NOT use option_item for it",
    "compatibleTargets remains only for the older/genuine structural_support option-item architecture",
    "the System/Base price and the Main Product price are TWO independent authoritative prices",
    "do NOT emit a synthetic combined SKU",
    "Do NOT create a fake one-column priceMatrix to preserve these groups",
  ]);
});

test("grouped base_model targets use the exact groupId while ungrouped rows keep the legacy id; system_base companions target base_model", () => {
  expectAll([
    "use group_id equal to that exact row.groupId, otherwise use group_id \"" + LEGACY_BASE_MODEL_GROUP_ID + "\"",
    "(A) when the row has a native groupId, group_id is that exact row.groupId; (B) when the row has no groupId, group_id is \"" + LEGACY_BASE_MODEL_GROUP_ID + "\"",
    "target: { \"kind\": \"base_model\", \"group_id\": \"<exact native System groupId>\", \"row_id\": \"<exact system_base row.id>\" }",
    "Do NOT use target.kind \"option_item\" for a native system_base row",
    "do NOT use group_id \"" + LEGACY_BASE_MODEL_GROUP_ID + "\" when the target row has a native groupId",
  ]);
  assert.ok(getProductTemplateAiExtractionPrompt("workstation").includes("as an ordinary ungrouped Base/Model row, use target: { kind: \"base_model\", group_id: \"" + LEGACY_BASE_MODEL_GROUP_ID + "\", row_id: \"oxi-q-ws-dx\" }"));
});

test("structural_support / compatibleTargets remain a fallback and stale grouping-unsupported text is gone", () => {
  expectAll([
    "This section applies ONLY to genuine option-item structural_support architecture. It does NOT apply to native Base/Model system_base rows",
    "compatibleTargets remains valid in the contract for genuine structural_support items",
    "\"<exact Base/Model row group id or legacy id>\"",
    "if compatibleTargets point to a native grouped Base/Model row, group_id must be that exact row.groupId",
    "DO NOT EMIT: base_model_subgroup; Smart Setup visual subgroup ids; generated auto subgroup ids; labels as row_id; supplier codes as row_id",
  ]);
  nativeSystemPrompts().forEach(([focus, prompt]) => {
    ["when ProjectWorkflow supports it", "ProductTemplateDraft v1 baseModelRows is flat", "Review & Route can split them", "have no group wrapper in this draft"].forEach((stale) => {
      assert.ok(!prompt.includes(stale), `Expected ${focus} prompt to drop stale grouping guidance: ${stale}`);
    });
  });
});

test("service cabinet guidance prefers system_base when first-stage semantics are proven; same-page scope preserves the relationship", () => {
  [
    "First determine whether the cabinet/storage/service unit is a native primary System/Base selection",
    "route it to pricing.baseModelRows with role \"system_base\" and a native groupId/groupLabel shared by its Main Product rows",
    "Do not infer either role from name alone",
    "the System/Base was emitted as a native grouped Base/Model row with role \"system_base\"",
    "is NOT an unrelated sibling when the source proves those Main Products are explicitly designed for that System",
    "preserve them together inside one native Base/Model System group",
    "Same-page proximity alone is still insufficient",
  ].forEach((expected) => assert.ok(getProductTemplateAiExtractionPrompt("workstation").includes(expected), `Expected workstation prompt to include: ${expected}`));
  expectAll([
    "is actually the primary first-stage System/Base is NOT a companion merely because it sits beside the desk/bench pages",
    "Do NOT use Modular merely because System + Main are both required to complete the configured product",
  ]);
});

test("self-check and final checklist 43-50 cover native System/Base", () => {
  expectAll([
    "Native System/Base self-check: verify that a source-proven PRIMARY first-stage priced System/Base was not incorrectly routed to optionGroups structural_support",
    "that structural_support remains used only for genuine support/companion architecture",
    "43. A source-proven primary first-stage priced System/Base was emitted as a Base/Model row with role \"system_base\", not as a structural_support accessory.",
    "44. Every native System/Base row and its compatible Main Product Base/Model rows share the same exact groupId and groupLabel.",
    "45. Ordinary Main Product rows in a native System group omit role; \"main_product\" was not invented.",
    "46. Native System -> Main Product compatibility is represented by Base/Model group membership",
    "47. A required companion triggered by a native System/Base uses target.kind \"base_model\"",
    "48. System/Base price and Main Product price remain separate authoritative source prices",
    "49. No fake one-column Matrix or invented Smart Setup subgroup ID was created to preserve native System grouping.",
    "50. structural_support / compatibleTargets remains reserved for genuine option-item support/companion architecture",
  ]);
});

test("native system_base required companion (base_model target, fixed_quantity 1) never emits or recommends scale_with_target_quantity", () => {
  expectAll([
    "For target.kind \"base_model\": NEVER emit scale_with_target_quantity (the runtime permits it only for modular or option_item targets)",
    "use fixed_quantity when the source proves a fixed required quantity",
    "quotation-item quantity already multiplies the configured complete product later",
    "omit scale_with_target_quantity entirely and do not emit false",
    "A required companion targeting a native system_base/base_model row does not contain scale_with_target_quantity.",
    "51. A required companion targeting a native system_base/base_model row does not contain scale_with_target_quantity.",
  ]);
  nativeSystemPrompts().forEach(([focus, prompt]) => {
    const section = prompt.slice(prompt.indexOf("SYSTEM_BASE REQUIRED COMPANIONS"), prompt.indexOf("NATIVE SYSTEM PRICES ARE INDEPENDENT"));
    assert.ok(section.includes("\"kind\": \"base_model\"") && section.includes("fixed_quantity"), `Expected ${focus} system_base companion section to use base_model + fixed_quantity`);
    assert.ok(!/scale_with_target_quantity"?\s*[:=]\s*true/i.test(section), `Expected ${focus} system_base companion section not to recommend scale_with_target_quantity: true`);
  });
});

test("supplier code cleaning: adjacent finish/footnote markers such as (*) never stay inside supplierCodes", () => {
  expectAll([
    "SUPPLIER CODE CLEANING / ADJACENT MARKERS",
    "store only the actual commercial code",
    "Do NOT include adjacent finish-reference markers, typography markers, footnote markers, or decorative symbols that are not part of the article code",
    "(*), ( ), *, †, ‡",
    "source \"1AJ M45 (*)\" must emit \"supplierCodes\": [\"1AJ M45\"], NOT \"supplierCodes\": [\"1AJ M45 (*)\"]",
    "source \"1AJ M33 (*)\" must emit \"supplierCodes\": [\"1AJ M33\"]",
    "Preserve the supplier prefix and article token exactly; do not remove letters/numbers that are actually part of the code, and do not normalize away legitimate suffix letters/numbers",
    "only strip adjacent non-code finish/footnote markers",
    "Finish-reference symbols belong in finish/material guidance if relevant, not supplierCodes",
    "This rule is generic (not specific to any manufacturer) and applies globally to Base/Model, Workstation, Matrix, Modular, Option/Accessory, and linked/companion supplier codes",
    "Supplier codes contain only the commercial article code and do not include adjacent finish/footnote markers such as (*).",
  ]);
});

test("existing OXI, OXI_P, X3, Terra/Piem, structural_support and scale_with_target_quantity regressions are preserved", () => {
  [
    "oxi-q-ws-dx",
    "OXI_P starter rows 111 065, 111 066, 111 067, and 111 068",
    "OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS",
  ].forEach((expected) => assert.ok(getProductTemplateAiExtractionPrompt("workstation").includes(expected), `Expected workstation prompt to keep regression: ${expected}`));
  expectAll([
    "selectionFamily",
    "Matrix Modular",
    "scale_with_target_quantity is used only for supported target kinds (modular or option_item)",
    "role \"structural_support\"",
    "STRUCTURAL SUPPORT / COMPATIBLE MAIN PRODUCTS",
    "EXTRACTION-TIME COMPATIBILITY TARGETS",
  ]);
});

test("screen catalogue contract preserves source truth without inventing unsupported runtime relationships", () => {
  const required = [
    "SCREEN CATALOGUE EXTRACTION",
    "front, lateral/side, desk-mounted, bench, freestanding/desktop, floor, modesty",
    "Each authoritative direct-priced screen SKU",
    "Use pricing.priceMatrices only for a real source-proven screen row × price-category dimension",
    "upholstery categories B/C/D/E/F/G/I",
    "preserve each family in its correct pricing destination",
    "INCLUDED: preserve it as specification/source evidence and never add a Required Companion",
    "Art.881 OR Art.882",
    "Art.880 PLUS one of Art.881/Art.882, emit TWO independent Required Companion groups",
    "CONFIGURATION-DEPENDENT - MANUAL DECISION",
    "only when linked",
    "Do not create cross-template conditionalConfiguration rules",
    "reusable Linked Product candidate; linking is not an extraction-time decision",
    "COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED",
    "actual 1725 mm screen for an 1800 mm desk",
    "direct-priced screens stayed Base/Model; real upholstery columns stayed Matrix",
  ];

  const prompt = getProductTemplateAiExtractionPrompt("screens");
  required.forEach((expected) => assert.ok(prompt.includes(expected), `Expected screens screen contract to include: ${expected}`));
  assert.ok(prompt.indexOf("SCREEN CATALOGUE EXTRACTION") < prompt.indexOf("EXTRACTION FOCUS:"), "Expected screen contract before the screens focus");
});

test("screen catalogue contract structurally enforces supplied hardware, cover quantities, code warnings, and source-page scope", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "importantRequirements alone is insufficient: MUST emit row-specific conditionalConfiguration",
    "Use role \"companion\", required true, visible true, and one applicability rule per exact target row.",
    "outer selection \"required_choose_at_least_one\", conditionalConfiguration.selection \"exactly_one\", and source-supported allowed_item_ids [\"art-881\", \"art-882\"]",
    "TWO independent Required Companion groups: one for Art.880 and one exactly-one alternatives group for Art.881/Art.882",
    "Use fixed_quantity: 1 for a one-bar row and fixed_quantity: 2 for a two-bar row only when the source proves that count.",
    "every applicability rule MUST use allowed_item_ids to restrict that target row to the exact source-supported matching cover SKU or SKUs.",
    "W100 one-bar screen -> allowed_item_ids contains only the W100 cover; fixed_quantity: 1",
    "W100 two-bar screen -> allowed_item_ids contains only the W100 cover; fixed_quantity: 2",
    "conditionalConfiguration.selection = \"exactly_one\"",
    "NEVER emit scale_with_target_quantity for base_model or price_matrix targets",
    "never multiply its source price, synthesize a multi-cover SKU, or leave a source-required cover optional.",
    "The extraction MUST include",
    "this warning is mandatory, not optional.",
    "sources[] may contain only supplied pages that materially contributed data to this extraction call.",
    "A page referenced by a supplied page is not itself supplied evidence.",
    "Every sources[].pageNumber is from the actual source batch supplied for this extraction call.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
  assert.ok(!prompt.includes("CONFIGURATION-DEPENDENT â€” MANUAL DECISION"));
  assert.ok(!prompt.includes("COMPOSED SUPPLIER CODE â€” RUNTIME SUPPORT REQUIRED"));
});

test("screen catalogue contract preserves multiple required companions, unresolved mounting warnings, and supplied-page boundaries", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "If a screen row explicitly requires multiple separately priced components, every source-proven component relationship that the current schema can represent MUST be emitted structurally.",
    "Angular felt screen",
    "This MUST produce TWO separate Required Companion optionGroups/rules:",
    "A. Art.880 group:",
    "allowed_item_ids contains only art-880",
    "B. Art.881 / Art.882 group:",
    "allowed_item_ids = [art-881, art-882]",
    "Do not leave either relationship only in importantRequirements.",
    "W100 felt modesty",
    "W120-W180 felt modesty",
    "-> Art.888 required",
    "Use separate Required Companion groups for independent required items. Do not leave Art.880 or Art.888 as prose-only requirements.",
    "This warning is mandatory whenever at least one supplied screen mounting requirement remains unresolved because the current schema cannot express the deciding context.",
    "Do not omit the warning merely because other screen rows have valid conditionalConfiguration.",
    "sources[] MUST be a subset of that supplied batch.",
    "A page outside the supplied batch must never appear in sources[]",
    "For every sources[].pageNumber, verify that page number was explicitly included in the current extraction batch.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
  assert.ok(prompt.includes("CONFIGURATION-DEPENDENT - MANUAL DECISION"));
});

test("screen mounting rule requires independent Required Companion groups for simultaneous requirements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Do not place all mounting hardware into one universal Required Companion optionGroup when the same screen row can require more than one independent mounting component simultaneously.",
    "If selecting one screen row requires Component family A PLUS Component family B, then A and B MUST be separate optionGroups so both groups can become active for the same target row.",
    "A single optionGroup with conditionalConfiguration.selection = \"exactly_one\" can never represent A PLUS B.",
    "A. Front-stirrup group - items may include Art.880 and Art.462; use exact allowed_item_ids per target row.",
    "B. Lateral-stirrup group - items Art.881 and Art.882; use conditionalConfiguration.selection = \"exactly_one\".",
    "C. Felt alignment / central-stirrup group - item Art.888.",
    "D. Freestanding-support group - item Art.886.",
    "Do NOT create one global \"Mounting Stirrups & Brackets\" Required Companion group when doing so prevents simultaneous independent requirements.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("angular felt screen activates both front-stirrup and lateral-stirrup companion groups simultaneously", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "For a source-proven angular screen requiring front mounting PLUS a lateral mount choice: activate the Front-stirrup companion group for the exact angular row, restricted to Art.880; independently activate the Lateral-stirrup companion group for that same row, restricted to Art.881 and Art.882; both rules required = true and visible = true.",
    "The same target row appearing in two different Required Companion groups is correct and necessary. Never reduce this to importantRequirements only.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("felt modesty pattern activates Art.880 group plus Art.888 group as separate row-specific rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "W100 felt modesty",
    "-> Art.880 required",
    "W120-W180 felt modesty",
    "-> Art.888 required",
    "Each requirement must have its own row-specific applicability rule. Do not merge Art.880 and Art.888 into one exactly-one group.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("unresolved screen mounting context mandates the exact CONFIGURATION-DEPENDENT warning and explicit page-range allow-list", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "If at least one extracted screen row has an explicit mounting requirement but its exact hardware choice cannot be structurally resolved because the decision depends on external desk/bench/system context, extractionWarnings MUST contain exactly \"CONFIGURATION-DEPENDENT - MANUAL DECISION\".",
    "This warning is required even when other screen rows have successfully resolved conditionalConfiguration rules.",
    "When the extraction call declares an explicit supplied page range, such as pages 9-31, treat that range as a hard allow-list for sources[].",
    "No source entry may have pageNumber < first supplied page or pageNumber > last supplied page.",
    "Do not use an adjacent continuation page such as page 32 merely because it is present in the same uploaded PDF or earlier conversation context.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("screen contract requires accounting for every authoritative priced row in a supplied commercial batch and caps confidence when incomplete", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "When supplied commercial pages contain multiple authoritative priced rows, the extractor MUST account for every materially distinct row/family in the supplied batch unless it explicitly explains why a row is excluded.",
    "when the source provides separate authoritative supplier codes and prices.",
    "verify each authoritative priced supplier code is either:",
    "A. emitted in pricing/optionGroups, or",
    "B. intentionally excluded with an extraction warning/reason",
    "If many authoritative priced rows are omitted, do not claim high confidence.",
    "Do not set confidence above 0.90 when authoritative priced rows from the supplied batch are knowingly incomplete or unresolved.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("screen contract routes installation rails and cable-tray mounting systems away from primary Base/Model", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Do not route desk rails, cable-management rails, flap assemblies, screen-support rails, mounting assemblies, or cable-tray mounting systems to pricing.baseModelRows merely because they have their own supplier codes and prices.",
    "then preserve them as configuration/support/accessory structures rather than primary Screen products.",
    "Primary Base/Model should be used for the independently sold screen/divider SKU itself.",
    "Only treat a rail/support assembly as a main Base/Model product if the source clearly presents it as the primary commercial product rather than an installation/support component.",
    "an \"SCBD...\" style desk rail -> installation/support configuration",
    "an \"SCBV...\" style cable-tray rail -> installation/support configuration",
    "an \"SCSS...\" / \"SCSB...\" style flap + cable tray -> installation/support configuration",
    "an \"SCRS...\" / \"SCBS...\" / \"SCRB...\" style framed-screen mounting/cable system -> installation/support configuration",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("screen requiring separately ordered mounting hardware cannot be downgraded to ordinary optional accessories", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "When a primary screen row explicitly states \"mounting brackets not included\" or \"must be ordered separately\", the extraction MUST NOT leave all compatible mounting hardware as ordinary optional accessories if the source proves the screen cannot be installed without separate mounting hardware.",
    "preserve the mounting-system items; keep the main screen as the primary Base/Model row; preserve the \"mounting required separately\" requirement; emit \"CONFIGURATION-DEPENDENT - MANUAL DECISION\"; do NOT invent one universal mounting SKU; and do NOT downgrade the relationship to a normal optional accessory.",
    "If exact applicability can be expressed safely with current schema and supplied evidence, use row-specific Required Companion rules instead.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("included mounting hardware rows must remain distinct from required-separate rows without a duplicate charge", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "INCLUDED MOUNTING HARDWARE MUST SURVIVE EXTRACTION",
    "that status MUST be preserved on the exact authoritative SKU row.",
    "Do not omit such rows merely because a visually similar non-included family exists.",
    "Do not add any separate required mounting charge to those included-hardware rows.",
    "the extractor MUST preserve both commercial families independently.",
    "verify that at least one INCLUDED-hardware row remains structurally distinct from otherwise-similar REQUIRED-SEPARATE-hardware rows when both are present in the supplied source.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("explicit discontinued and shortly-discontinued status must survive screen extraction", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "If the source explicitly labels a row/family THIS ITEM WILL SHORTLY BE DISCONTINUED, discontinued, obsolete, while stocks last, or no longer replenished, preserve that status on the affected row/family.",
    "Do not silently drop the status.",
    "preserve it in importantRequirements and/or extractionWarnings without removing the authoritative row.",
    "Final check: every source-marked discontinued/shortly-discontinued SKU remains present with its status preserved.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("composed supplier-code warning requires explicit source proof of code composition, not finish/RAL/material codes alone", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Emit \"COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED\" ONLY when the supplied source explicitly proves that the final commercial order code is formed by combining multiple code parts, for example base article code + finish/material suffix = complete order code.",
    "Finish codes, RAL codes, colour codes, or material codes by themselves are NOT sufficient evidence of supplier-code composition.",
    "Do not emit the composed-code warning merely because a row has a supplier code, finishes have their own codes, frame finishes use A/I/R, or RAL/NCS references exist.",
    "The manufacturer must explicitly state or demonstrate the composition rule.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("PTS / non-currency screen pricing stays raw with currency null and requires a conversion warning", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "SCREEN PTS / NON-CURRENCY PRICING",
    "preserve the raw numeric values exactly; keep currency null; do not assume EUR/AED/USD; and add an extraction warning explaining that a point-to-price conversion rule is required before treating the values as monetary prices.",
    "Do not multiply or convert PTS during extraction.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("one screen extraction batch uses one consistent source page-numbering convention without weakening the supplied-page firewall", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "For sources[].pageNumber, use the page numbering system actually supplied for the current extraction batch consistently.",
    "Do not mix PDF page index, printed catalogue page number, and earlier-conversation page numbering within one extraction.",
    "If the supplied split PDF preserves printed catalogue numbers and the model uses those, use printed catalogue numbers consistently for every source in that batch.",
    "This does not change the existing hard supplied-page firewall.",
    "sources[] MUST be a subset of that supplied batch.",
    "No source entry may have pageNumber < first supplied page or pageNumber > last supplied page.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("a discontinued marker between two families binds to the preceding family's visual table block, not parsed-text adjacency", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "When a discontinued / shortly-discontinued / obsolete / while-stocks-last notice appears between commercial families, bind the notice to the exact visual table/family block supported by its placement.",
    "A status printed directly after the final rows of one family and before the heading/rows of the next family belongs to the preceding family unless the source explicitly indicates otherwise.",
    "Do NOT attach a discontinued notice to the following family merely because PDF text extraction places the notice immediately before that family's text.",
    "Use page layout, headings, row boundaries, spacing, and table grouping as evidence.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("discontinued status must never propagate into an adjacent family, and the binding self-check is mandatory", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Never propagate one family's discontinued status into an adjacent family.",
    "Final self-check: every discontinued status is attached to the exact visual family/table that the source marks, not merely the nearest row in parsed-text reading order.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("included mounting hardware cannot be inherited from an adjacent family", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Mounting commercial status is family/row-specific source evidence.",
    "Do NOT inherit mounting clamps included, brackets included, brackets not included, or mounting required separately from a preceding or following visually similar family.",
    "If Family A explicitly says \"includes pair of mounting clamps\" and adjacent Family B does not state an included/separate mounting status, do not assume Family B has the same status.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("required-separate mounting hardware cannot be inherited from an adjacent family", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Likewise, if another adjacent family says \"mounting brackets not included\", do not apply that requirement to Family B without exact source evidence.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("source-silent mounting status remains un-invented and is marked for review when necessary", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "When the exact family is silent: preserve the authoritative SKU/price normally; do not invent included hardware; do not invent a separately-required mounting component; preserve any broader installation guidance that is genuinely source-backed; mark the mounting relationship for review/manual decision if necessary.",
    "Final self-check: every INCLUDED or REQUIRED-SEPARATE mounting statement must be supported by the exact target family/row source block.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("source-silent mounting status is explicitly declared UNKNOWN / UNSPECIFIED", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "SOURCE-SILENT MOUNTING STATUS IS NEUTRAL",
    "If the exact visual commercial row/family block does NOT explicitly state an included or separately-required mounting status, mounting commercial status for that row/family is UNKNOWN / UNSPECIFIED.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("exact source-silent families must not receive included or required-separate mounting phrases without explicit block-level evidence", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "For an exact source-silent row/family, NEVER emit phrases such as:",
    "- \"Includes mounting clamps\"",
    "- \"Mounting brackets not included\"",
    "- \"Mounting hardware required separately\"",
    "unless that exact commercial row/family block visibly supports the statement.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("general installation diagrams and neighbouring families cannot establish row-level INCLUDED or REQUIRED-SEPARATE status", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Do NOT derive row-level mounting commercial status from:",
    "- a general installation diagram",
    "- a family-wide installation page",
    "- the previous commercial family",
    "- the following commercial family",
    "- page layout proximity",
    "General installation guidance may still be preserved as configuration context, compatibility evidence, or extractionWarnings when genuinely supported, but it MUST NOT be rewritten as INCLUDED or REQUIRED-SEPARATE commercial status for a source-silent SKU family.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("page completeness requires exact authoritative supplier-code accounting, not merely appearing in sources[]", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "EXACT SUPPLIER-CODE ACCOUNTING BEFORE PAGE COMPLETENESS",
    "A commercial page is complete only when EVERY authoritative priced supplier code visible on that page has been accounted for.",
    "1. Read every commercial table on that supplied page.",
    "2. Build an internal checklist of every authoritative priced supplier code.",
    "A. emitted exactly once in the correct structure,",
    "B. explicitly identified in extractionWarnings as not yet extracted.",
    "A page appearing in sources[] does NOT prove that page is commercially complete.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("missing earlier supplier codes prevent claiming extraction complete through a later printed page", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "Never emit wording such as \"Extraction complete through printed page X\" unless every authoritative priced supplier code on every supplied commercial page up to X has been accounted for.",
    "If any earlier supplied page still contains unextracted supplier codes: do NOT claim completion through a later page; identify the earliest incomplete printed page or commercial family; state that supplemental extraction is still required from that point.",
    "Do not use family-level wording such as \"SCBD family extracted\" when only some supplier codes from that family were emitted. Completeness is evaluated at authoritative supplier-code row level, not merely family-name level.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("installation sibling families sharing the same mounting role may not be sampled for brevity", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "INSTALLATION FAMILY EXTRACTION MUST ALSO BE EXHAUSTIVE",
    "When one supplied installation-options page contains several separately priced supplier-code families, preserve every authoritative priced family and every row.",
    "- one-flap versus two-flap systems",
    "- framed-screen mounting/cable assemblies",
    "when other separately priced sibling families are visibly present.",
    "Different supplier-code families with different commercial conditions remain separate option/configuration rows even when they perform a similar mounting function.",
    "Do not sample sibling installation families for brevity.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("screen final check requires per-page code-by-code verification and exactly-once supplier-code emission", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "a source-silent mounting family did not inherit commercial mounting status from a neighbouring family or general installation diagram",
    "every supplied commercial page was checked code-by-code, not merely listed in sources[]",
    "every authoritative priced supplier code is emitted exactly once or named explicitly as still unextracted",
    "no \"complete through page X\" warning is emitted while an earlier supplied page still has unaccounted authoritative supplier codes",
    "separately priced sibling installation families were not sampled or collapsed merely because they share the same mounting role.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens contract to include: ${expected}`));
});

test("planning focus registry adds a dedicated Screens / Dividers focus", () => {
  assert.ok(productTemplateSetupPlanningFocuses.includes("screens"), "Expected planning focus registry to include screens");
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  ["SCREENS / DIVIDERS PLANNING FOCUS", "SCREEN PRODUCT SETUP PLAN"].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning routes direct-priced SKUs to Base/Model and real upholstery categories to Matrix", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Recommend Base / Model when the manufacturer publishes an authoritative direct price for each screen SKU/configuration",
    "Do NOT recommend Matrix merely because several materials, widths, heights, finishes, or screen forms exist.",
    "Recommend Category / Matrix only when the source contains a real commercial price-category dimension, typically screen model/size x fabric/upholstery category (B/C/D/E/F/G/I) with different prices.",
    "Finish colours with the same price are NOT Matrix columns.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning forbids artificial template splitting for the mixed Base/Model + Matrix runtime gap", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Do NOT split templates solely because today's Product Library cannot yet mix two supported pricing destinations",
    "preserve that intended template structure in the plan and flag the runtime gap instead of splitting.",
    "do NOT recommend artificial template splitting merely to avoid this limitation.",
    "MIXED PRIMARY PRICING FAMILY SELECTION REQUIRED",
    "Identify this as a generic runtime improvement, not a manufacturer-specific hack.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning keeps installation/mounting systems out of primary Base/Model", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Desk rails, cable-management rails, flap assemblies, cable trays, mounting brackets, clamps, and similar installation systems are normally NOT primary Screen products.",
    "Do not recommend Base/Model for installation systems merely because they have direct supplier codes and prices.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning distinguishes included versus required-separate mounting hardware", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "INCLUDED (for example \"supplied with mounting brackets\") stays included in the primary SKU with no extra Required Companion and no duplicate price",
    "REQUIRED SEPARATELY (for example \"mounting brackets not included; order separately\") becomes a Required Companion when exact applicability can be represented safely, otherwise configuration-dependent/manual decision",
    "Do not downgrade REQUIRED-SEPARATE hardware to an ordinary optional accessory.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning covers required alternative mounting rules and simultaneous required-component separation", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "For a pattern such as screen -> exactly one of Mount A / Mount B, recommend a Required Companion group with exactly_one selection and allowed compatible mounting items",
    "For screen -> Mount A REQUIRED PLUS exactly one of Mount B / Mount C REQUIRED, recommend separate Required Companion groups",
    "never recommend one global mounting group if doing so prevents independent requirements from being active simultaneously.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning routes unresolved configuration-dependent mounting to manual decision", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "If current ProjectWorkflow cannot express the condition exactly, planning must say MANUAL DECISION / CONFIGURATION-CONTEXT GAP rather than manufacture a universal Required Companion",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning preserves floor-screen linking and stabilizing-support context without inventing fixed rules", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Treat floor screens as independently configurable Screen products.",
    "linked screens -> hinge kit required",
    "freestanding compositions -> stabilizing legs/flat bases",
    "Do not recommend unconditional companion rules when those conditions are not represented by current runtime; use MANUAL DECISION / CONFIGURATION-CONTEXT GAP where necessary.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning flags dynamic supplier-code composition only when source-proven", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "DYNAMIC SUPPLIER CODE COMPOSITION REQUIRED",
    "Do NOT recommend duplicate pricing rows for every finish, synthetic pre-composed SKUs, or manual price duplication by finish",
    "Only flag this when manufacturer source explicitly proves code composition.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning handles PTS/point pricing without assuming currency", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "If source pricing is in PTS/points rather than currency, planning must explicitly state the source price basis is PTS, that no currency should be assumed, and that point-to-monetary conversion must be configured before quotation use.",
    "Do not recommend treating PTS directly as EUR/AED/USD.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning identifies reusable Linked Product candidacy without duplicating pricing into desks", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Identify when Screens is a good reusable Linked Product candidate.",
    "Do NOT duplicate Screen SKUs/pricing into a desk template, make every Screen a desk-local accessory, create synthetic desk+screen SKUs, or automatically persist cross-template links during Planning.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning flags the linked-child full-configurator limitation as a later runtime improvement", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Current known linked-product limitation: linked Product Templates can currently expose only a narrowed child configuration and do not reuse the full child Product Library configuration.",
    "LINKED CHILD FULL CONFIGURATOR EXTENSION REQUIRED",
    "do not block standalone Screen Product Setup because of this.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning output stays compact with the SCREEN PRODUCT SETUP PLAN structure", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "SCREEN PRODUCT SETUP PLAN",
    "1. PRODUCT TEMPLATES",
    "2. FAMILY / EXTRACTION ROADMAP",
    "3. TEMPLATE STRUCTURE",
    "4. SOURCE / EXTRACTION BATCHES",
    "5. MANUAL DECISIONS",
    "6. ARCHITECTURE GAPS",
    "7. SEPARATE LATER",
    "8. EXTRACTION / SOURCE WARNINGS",
    "9. PLANNING RESULT",
    "READY AFTER ARCHITECTURE GAP",
    "NEED MORE SOURCE",
    "Do NOT output long essays, implementation code, database schema, speculative redesign, or duplicated extraction JSON.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning output includes the dual page-numbering note before the compact plan", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "PAGE NUMBERING NOTE",
    "[PDF / printed-page relationship, or \"Unavailable\" where not known]",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
  assert.ok(prompt.indexOf("PAGE NUMBERING NOTE") < prompt.indexOf("SCREEN PRODUCT SETUP PLAN"), "Expected the page numbering note before the compact plan");
});

test("screens planning output includes FAMILY / EXTRACTION ROADMAP and SOURCE / EXTRACTION BATCHES tables", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "| Family | Printed pages | PDF pages | Recommended setup | Extract separately? | Priority |",
    "Use one row per true manufacturer Screen family.",
    "Use only the existing Priority values: BEST FIRST TEST, Current, Next, Later.",
    "| Batch | Section | Printed pages | PDF pages | Purpose |",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning output states manufacturer families and ProjectWorkflow consolidation separately", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Manufacturer families:",
    "- <source-defined family>",
    "ProjectWorkflow consolidation:",
    "- <why these manufacturer families belong in this Product Template>",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning output includes SEPARATE LATER and does not emit the generic PRODUCT 1 / PRODUCT 2 prose structure", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "7. SEPARATE LATER",
    "nearby manufacturer families that should not enter the current Product Template, or None",
    "Do not emit the separate generic PRODUCT 1 / PRODUCT 2 prose structure for Screens when this dedicated compact Screens structure is active.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning describes ordinary Base/Model organization as commercial family / visual subgroup, not Native System/Base", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "Where manufacturer commercial families are meaningful, recommend Base/Model commercial families / visual subgroups to keep the selector understandable.",
    "These are ordinary Base/Model family/subgroup organization unless the source independently proves a genuine first-stage System/Base architecture.",
    "Do NOT call an ordinary Screen family a native System/Base group.",
    "Reserve Native System/Base only for the existing source-proven System/Base -> Main Product architecture",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
  assert.ok(!prompt.includes("recommend native Base/Model groups to keep the selector understandable"), "Expected the old native Base/Model group wording to be removed from Screens planning");
});

test("screens planning defines Planning Result precedence: NEED MORE SOURCE over architecture-gap readiness, READY requires complete-enough source", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "SCREEN PLANNING RESULT PRECEDENCE",
    "1. NEED MORE SOURCE",
    "Source incompleteness takes precedence over architecture-gap readiness.",
    "2. READY AFTER ARCHITECTURE GAP",
    "Use only when source coverage is sufficiently complete to define the intended Product Setup, but one or more real generic ProjectWorkflow runtime gaps must be implemented before that intended setup can work safely.",
    "3. READY",
    "Use when source coverage is sufficiently complete and the intended Product Setup can be represented safely with current ProjectWorkflow architecture.",
    "A future optional enhancement such as richer Linked Product UX does not by itself force READY AFTER ARCHITECTURE GAP when the standalone Screens template is already usable.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning final source gate enforces cross-section consistency between roadmap, templates, and batches", () => {
  const prompt = buildProductTemplateSetupPlanningPrompt("screens");
  [
    "every manufacturer family in FAMILY / EXTRACTION ROADMAP appears in exactly the intended Product Template, Separate Later, or an explicit source warning",
    "no family marked Extract separately = Yes appears in another template's Add More batch",
    "SOURCE / EXTRACTION BATCHES matches the template boundaries stated in PRODUCT TEMPLATES and TEMPLATE STRUCTURE",
    "Base/Model visual family/subgroup organization was not confused with Native System/Base architecture",
    "NEED MORE SOURCE takes precedence when commercial source coverage is still incomplete",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens planning prompt to include: ${expected}`));
});

test("screens planning preserves existing planning focuses for other product families", () => {
  [
    ["chair_seating", "CHAIR & SEATING PLANNING FOCUS"],
    ["desk_executive", "DESKS / EXECUTIVE DESKS PLANNING FOCUS"],
    ["workstation", "WORKSTATION / BENCH SYSTEMS PLANNING FOCUS"],
    ["sofa_lounge", "SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS"],
    ["meeting_conference", "MEETING / CONFERENCE TABLES PLANNING FOCUS"],
    ["storage_cabinets", "STORAGE / CABINETS / CREDENZAS PLANNING FOCUS"],
  ].forEach(([focus, expected]) => assert.ok(buildProductTemplateSetupPlanningPrompt(focus as typeof productTemplateSetupPlanningFocuses[number]).includes(expected), `Expected ${focus} planning prompt to still include: ${expected}`));
});

test("1: Accessories / Electrification extraction focus exists", () => {
  assert.ok(extractionPromptFocuses.includes("accessories_electrification"), "Expected extractionPromptFocuses to include accessories_electrification");
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  ["EXTRACTION FOCUS: Accessories / Electrification", "ACCESSORIES / ELECTRIFICATION CATALOGUE EXTRACTION"].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("2: standalone direct-priced accessories route to Base/Model", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "When an accessory is independently sold, directly priced, and commercially usable as its own quotation item, extract it as Base / Model.",
    "monitor arms, desk lamps, CPU holders, footrests, waste bins, coat stands",
    "Do NOT force independently sold accessories into optionGroups merely because the manufacturer catalogue calls them \"Accessories\".",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("3: product-local optional items route to optionGroups with the correct commercial role, only when a local parent/trigger exists", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "When an accessory exists specifically to be selected while configuring another product, route it to optionGroups ONLY when its parent/trigger can be represented inside the CURRENT ProductTemplateDraft, using the correct commercial role: Normal Accessory, Conditional Option, or Required Companion.",
    "Do not convert every accessory catalogue item into a local option.",
    "Examples of valid local triggers: an already-emitted Base/Model row; an already-emitted Matrix row; an already-emitted Modular row; an already-emitted Workstation row; an already-emitted optionGroups item.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("4: accessory -> required accessory via option_item targeting", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ProjectWorkflow supports option_item targeting.",
    "Monitor Arm -> Through-Desk Clamp required, or Data Module -> compatible Cover required, emit the required dependent item using target.kind = option_item.",
    "Do not duplicate the parent accessory as a synthetic combined SKU.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("5: power unit -> module -> required cover chain stays authoritative, not flattened", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "A supported generic pattern is: Main Power Unit -> selectable connector/data module(s) -> required compatible cover/adapter for the selected module.",
    "A. Independently sold Main Power Unit -> Base/Model direct-priced row.",
    "B. Independently selectable USB / HDMI / RJ45 / Audio module -> optionGroups item.",
    "C. Cover or adapter explicitly required because that exact module was selected -> Required Companion using target.kind = 'option_item' targeting that exact already-emitted module item.",
    "This is one option_item-triggered required-companion relationship.",
    "Do NOT flatten all possible combinations into synthetic SKU rows.",
    "Do NOT pre-compose Power Unit + HDMI + Cover as one fake commercial SKU unless the manufacturer itself publishes that combination as an authoritative priced SKU.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("7b: no artificial priced 'slot' item is created from configuration capacity alone", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Do NOT manufacture an additional artificial \"Custom Module Slot\" priced item when the source only shows the slot/capacity as part of the Power Unit construction.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("8b: unsupported recursive electrification dependency chains remain forbidden", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Recognize configurable electrification without inventing arbitrary recursive dependency graphs.",
    "Do NOT invent recursive chains such as Power Unit -> Slot -> Module -> Adapter -> Cover unless every independently priced commercial item and every dependency is explicitly source-proven AND supported by the current draft contract.",
    "When deeper dependency behavior cannot be represented safely: preserve all authoritative commercial rows; preserve their source relationship; add \"CONFIGURATION-DEPENDENT - MANUAL DECISION\"; do not synthesize combined SKUs.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("6: multi-select accessories/modules preserve individual quantities and source-supported maximums", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "When source allows multiple distinct modules/components, use a multi-selection architecture.",
    "Preserve multiple different items, individual quantity per item, and source-supported maximums where explicitly stated.",
    "Do not force exactly_one unless source requires exactly one.",
    "If source says \"up to 3 modules\", preserve that maximum.",
    "Do not infer a maximum from a drawing alone.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("7: included hardware is preserved without a duplicate accessory charge", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "INCLUDED: explicitly supplied as part of the selected commercial item (for example mounting brackets included, clamp included, cables included, power lead included).",
    "Do NOT create another priced accessory charge for an INCLUDED component.",
    "PREPARED FOR: holes provided, cutout provided, pre-drilled, or provision for module — preserve preparation status and do NOT assume the accessory itself is included.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("1b: INCLUDED accessory facts belong in specification, never importantRequirements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Preserve INCLUDED facts in specification.",
    "Do NOT place a purely included fact in importantRequirements; importantRequirements is only for a separate actionable obligation or restriction.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("2b: 'Mounting brackets included' example does not create an obligation in importantRequirements", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Source: \"Mounting brackets included\"",
    "Correct: specification = \"... Mounting brackets included.\" ; importantRequirements = []",
    "Incorrect: importantRequirements = [\"Mounting brackets included\"]",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("4: an external desk/chair/product family cannot become an unscoped local optionGroup target", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "If the accessory belongs to an EXTERNAL Product Template or named external product family that is not represented in the current draft: do NOT invent an unscoped optionGroup applicability rule; do NOT create cross-template conditionalConfiguration;",
    "Extraction must not pretend an external parent is a local target.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("5b: direct-priced external-compatible accessory commercial rows are preserved, not discarded, merely because the parent template is external", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "preserve the authoritative accessory SKU/code/price as commercial data when the supplied source directly prices it and it is commercially relevant to the Accessories catalogue;",
    "preserve the external family compatibility/restriction in specification, planning evidence, linkedFamilySuggestions, or extractionWarnings as the existing contract permits;",
    "add \"CONFIGURATION-DEPENDENT - MANUAL DECISION\" when configuration depends on that external context and cannot be safely represented.",
    "Planning later decides Standalone Product, Include Locally in the parent template, Both, or Manual Decision.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("final accessories validation now also verifies local optionGroup parent/trigger scoping", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "product-local optionGroups were created only when their parent/trigger exists inside the current ProductTemplateDraft",
    "external-product compatibility did not create an unscoped local option group.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("8: explicit required-separate items remain Required Companion, not downgraded", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "REQUIRED SEPARATE ITEM: explicit source wording such as must be ordered separately, always complete with, requires, or add Art.X — use Required Companion when exact applicability is safely representable.",
    "If a module explicitly requires one cover, one of two compatible covers, an adapter, a clamp, or a fixing kit, extract the dependency structurally when supported.",
    "Use separate Required Companion groups when independent components are simultaneously required.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("9: free-form attribute/external-context compatibility routes to MANUAL DECISION, never invented rules", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "If compatibility depends on a condition that is NOT represented by an exact current row/item identity, do not invent conditionalConfiguration.",
    "desktop thickness = 18 mm, glass vs melamine top, external desk range X1/X3/X5, desk vs bench in another Product Template, mounting position, or external cable-tray state",
    "flag \"CONFIGURATION-DEPENDENT - MANUAL DECISION\" unless the condition maps to a discrete extracted row/item in the current template",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("10: cross-template product-range compatibility stays evidence/planning guidance, never a local rule", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Accessories may explicitly support or exclude named product ranges.",
    "Do NOT create cross-template conditional rules and do NOT duplicate external parent products into the Accessories template; preserve this as compatibility evidence / planning guidance.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("11: cutout/drilling services may be extracted as separate commercial items", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Some catalogues separately price factory cutout, drilling, routing, or hole preparation. Preserve these as commercial items when they have authoritative codes/prices.",
    "Do NOT classify the cutout as INCLUDED when the source says \"cutout not included\".",
    "If a specific accessory explicitly requires the cutout, use Required Companion / option_item dependency when safely representable.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("12: electrical market variants (Schuko/UNEL/UK/US) remain authoritative variants, not finishes", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Preserve market-specific variants such as Schuko, UNEL, UK, and US as authoritative separately priced variants when source gives different codes/prices.",
    "Do not merge them into finishes.",
    "Do not convert them into Category/Matrix unless the manufacturer genuinely uses a row × market-category price matrix.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("13: an authoritative zero price is preserved, never treated as missing", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "A source value of 0 is not null.",
    "If an authoritative accessory row explicitly has 0 / 0.00 / 0 PTS, preserve zero.",
    "Do not remove the row or convert zero to missing price.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("14: PTS/point pricing stays raw with currency null", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "If source prices are PTS / points, preserve numeric values exactly, keep currency null, do not assume EUR/AED/USD, and add a warning that point-to-price conversion is required.",
    "Do not convert during extraction.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("15: composed supplier-code warning requires explicit source proof of composition", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Some accessory catalogues explicitly require base article code + finish code = complete commercial order code.",
    "do NOT duplicate pricing rows per finish, do NOT invent concatenated codes, and add \"COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED\"",
    "This warning is mandatory when explicit source evidence proves composition.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("16: finish codes alone do not trigger the composed supplier-code warning", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Finish codes by themselves are NOT sufficient evidence.",
    "Distinguish finish/material code, supplier article code, and complete commercial order code.",
    "Finish code alone does not justify a separate pricing row when price is the same.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("17: source-silent accessory commercial status cannot be inherited from an adjacent family", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Never inherit accessory commercial status from an adjacent family.",
    "If Family A says \"brackets included\" and Family B is silent, do not mark Family B as included.",
    "do not inherit required separately, optional, prepared for, discontinued, or compatible status from neighbouring rows/families",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("18: discontinued accessory rows remain present with status preserved", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Preserve source-marked discontinued, shortly discontinued, obsolete, or while stocks last status.",
    "Do not remove authoritative commercial rows solely because they are discontinued; preserve the status/warning.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("19: every supplied priced accessory code must be accounted for exactly once or named unextracted", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "For every supplied commercial page, account for every authoritative priced supplier code.",
    "Each must be emitted exactly once in pricing/optionGroups, or explicitly named as still unextracted in extractionWarnings.",
    "Do not sample representative accessory rows.",
    "Do not claim \"complete through page X\" while earlier supplied pages still contain unaccounted commercial codes.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("20: sources[] obeys the supplied-page firewall for Accessories / Electrification", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "sources[] must contain only pages supplied in the current extraction call.",
    "Do not use adjacent PDF pages, previous conversation pages, or remembered catalogue pages.",
    "If required context is outside the supplied batch, add a supplemental-extraction warning.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("Accessories / Electrification final validation checklist is present", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "standalone accessory SKUs were not forced into optionGroups",
    "product-local accessories were not incorrectly made standalone rows",
    "INCLUDED items are not double charged",
    "PREPARED FOR is not treated as INCLUDED",
    "required separate items remain required",
    "option_item dependencies preserve accessory -> accessory relationships",
    "configurable electrification was not flattened into fake SKU combinations",
    "multi-select modules remain multi-select where source supports them",
    "attribute/external conditions were not invented as row rules",
    "cross-template compatibility remains evidence/manual guidance only",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories/Electrification prompt to include: ${expected}`));
});

test("Accessories / Electrification preserves existing extraction focuses unchanged", () => {
  [
    ["screens", "SCREEN CATALOGUE EXTRACTION"],
    ["base_model", "EXTRACTION FOCUS: Base / Model Pricing"],
    ["workstation", "EXTRACTION FOCUS: Workstation Pricing"],
    ["chair_seating", "EXTRACTION FOCUS: Chair & Seating"],
    ["sofa_lounge", "EXTRACTION FOCUS: Sofas / Lounge / Armchairs"],
    ["meeting_conference", "EXTRACTION FOCUS: Meeting / Conference Tables"],
    ["storage_cabinets", "EXTRACTION FOCUS: Storage / Cabinets / Credenzas"],
    ["accessories", "EXTRACTION FOCUS: Accessories / Configuration Only"],
  ].forEach(([focus, expected]) => assert.ok(getProductTemplateAiExtractionPrompt(focus as typeof extractionPromptFocuses[number]).includes(expected), `Expected ${focus} extraction prompt to still include: ${expected}`));
});

test("prompt composition: Accessories / Electrification focus contains only its own dedicated contract, not the Screens contract", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "EXTRACTION FOCUS: Accessories / Electrification",
    "ACCESSORIES / ELECTRIFICATION CATALOGUE EXTRACTION",
    "STANDALONE VS PRODUCT-LOCAL ACCESSORIES",
    "ACCESSORY COMMERCIAL STATUS",
    "ACCESSORY -> REQUIRED ACCESSORY",
    "CONFIGURABLE ELECTRIFICATION",
    "FINAL ACCESSORIES VALIDATION",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
  [
    "SCREEN CATALOGUE EXTRACTION",
    "SCREEN PRICING",
    "REQUIRED SCREEN COVER QUANTITIES",
    "SCREEN CONTEXT, COMPATIBILITY, AND FLOOR COMPOSITIONS",
    "SCREEN FINAL CHECK",
  ].forEach((forbidden) => assert.ok(!prompt.includes(forbidden), `Expected Accessories / Electrification prompt to NOT include: ${forbidden}`));
});

test("prompt composition: Screens focus keeps the complete Screens contract and does not gain the Accessories contract", () => {
  const prompt = getProductTemplateAiExtractionPrompt("screens");
  [
    "SCREEN CATALOGUE EXTRACTION",
    "SCREEN PRICING",
    "SCREEN COMMERCIAL ROW COMPLETENESS",
    "SCREEN INSTALLATION / MOUNTING SYSTEMS ARE NOT AUTOMATICALLY PRIMARY PRODUCTS",
    "MOUNTING AND COMPONENT COMMERCIAL STATUS",
    "REQUIRED SCREEN COVER QUANTITIES",
    "SCREEN CONTEXT, COMPATIBILITY, AND FLOOR COMPOSITIONS",
    "SCREEN FINISHES, CODES, DIMENSIONS, AND STATUS",
    "SCREEN PTS / NON-CURRENCY PRICING",
    "SCREEN SOURCE-BATCH PAGE FIREWALL",
    "SCREEN FINAL CHECK",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Screens prompt to include: ${expected}`));
  assert.ok(!prompt.includes("ACCESSORIES / ELECTRIFICATION CATALOGUE EXTRACTION"), "Expected Screens prompt to NOT include the Accessories / Electrification contract");
});

test("prompt composition: shared GLOBAL extraction contracts remain present in both the Screens and Accessories prompts", () => {
  const shared = [
    "GLOBAL EXTRACTION ARCHITECTURE DECISION CONTRACT",
    "GLOBAL PRICING ROUTING ORDER",
    "HARD FIELD SEPARATION",
  ];
  const screensPrompt = getProductTemplateAiExtractionPrompt("screens");
  const accessoriesPrompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  shared.forEach((expected) => {
    assert.ok(screensPrompt.includes(expected), `Expected Screens prompt to still include global contract: ${expected}`);
    assert.ok(accessoriesPrompt.includes(expected), `Expected Accessories prompt to still include global contract: ${expected}`);
  });
});

test("prompt composition: every other extraction focus still generates successfully and stays free of the Screens-specific contract", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.length > 0, `Expected ${focus} extraction prompt to generate non-empty output`);
    if (focus === "screens") return;
    assert.ok(!prompt.includes("SCREEN CATALOGUE EXTRACTION"), `Expected ${focus} extraction prompt to NOT include the Screens-specific contract`);
  });
});

test("Accessories: accessory visual block binding prevents cross-assigning neighbouring technical facts", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORY VISUAL BLOCK BINDING",
    "Do NOT transfer a technical fact from a preceding or following accessory row merely because parsed PDF text places the fact nearby.",
    "A fact shown inside Product A's visual block belongs to Product A unless the source explicitly states that it applies more broadly.",
    "Final check: Technical facts from neighbouring accessory rows were not cross-assigned.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: variable/range dimensions become null structured fields, never collapsed to a min/max scalar", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "VARIABLE / RANGE DIMENSIONS",
    "NEVER convert that range to the minimum value, the maximum value, an average, or any arbitrary endpoint as though it were a fixed product dimension.",
    "set the structured dimension field to null; preserve the complete exact range in dimensions.rawText;",
    "Correct structured dimensions: width = null, depth = 24, height = null",
    "Do NOT store width = 26.4 or height = 54 merely because they are the upper limits.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected extraction prompt to include: ${expected}`));
});

test("Accessories: source-supported sibling count/size distinctions remain visible in displayName/specification", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORY SIBLING DISTINCTIONS",
    "When sibling accessory rows are differentiated by a clearly source-supported commercial count, width, size, capacity, hook count, tray width, or similar identity, preserve that distinction in displayName and specification.",
    "\"Wall Clothes Hanger - 2 Hooks\"",
    "\"Wall Clothes Hanger - 3 Hooks\"",
    "\"Keyboard Tray - W56 cm\"",
    "\"Keyboard Tray - W58 cm\"",
    "Do NOT reduce a clearly differentiated sibling row to a generic name when doing so loses its source-supported commercial distinction.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected extraction prompt to include: ${expected}`));
});

test("Accessories: a collection/range name alone does not populate supplierName", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "COLLECTION / RANGE NAME VS SUPPLIER IDENTITY",
    "Do NOT treat a collection name, catalogue range name, chapter name, or product-family heading as supplierName merely because it appears prominently on every supplied page.",
    "preserve the collection/range in templateName, description, or other source-faithful family fields; set supplierName = null.",
    "Only populate supplierName when the supplied source itself visibly identifies the manufacturer/supplier.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected extraction prompt to include: ${expected}`));
});

test("Accessories: different finish sets must not be merged and presented as universally available", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORY FINISH AVAILABILITY SCOPE",
    "do NOT create one broad materialSuggestion whose wording implies that every listed finish applies to every accessory.",
    "do not merge A + B and present the union as universally available.",
    "Do NOT state or imply universal finish availability unless the supplied source proves it.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: final validation explicitly checks JSON escaping for inch marks and quoted product/model names", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORIES JSON ESCAPING CHECK",
    "Manufacturer inch marks and quoted product/model names MUST be valid JSON string content.",
    "Example source text: 15\" to 24\"",
    "Valid JSON string content: 15\\\" to 24\\\"",
    "Example source product name: PORTA-ABITO \"LOOP\"",
    "Valid JSON: \"label\": \"PORTA-ABITO \\\"LOOP\\\"\"",
    "Never return an otherwise-correct Accessories extraction that fails JSON.parse because an inch mark or quoted manufacturer/model name was copied without JSON escaping.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: an explicit JSON.parse hard gate is required immediately before returning the response", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORIES JSON.PARSE HARD GATE",
    "Immediately before returning the final Accessories JSON, perform this final logical validation: (1) treat the complete response as the exact text that will be passed to standard JSON.parse;",
    "if the response would fail JSON.parse, DO NOT return it until corrected.",
    "THE EXACT RETURNED ACCESSORIES RESPONSE MUST BE ACCEPTED BY JSON.parse.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: raw embedded double quotes are stated as invalid final JSON, escaped quotes as valid final JSON", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Examples of INVALID final JSON:",
    "\"specification\": \"Suitable for 15\" to 24\" screens.\"",
    "\"label\": \"PORTA-ABITO \"LOOP\"\"",
    "Examples of VALID final JSON:",
    "\"specification\": \"Suitable for 15\\\" to 24\\\" screens.\"",
    "The JSON escaping requirement applies to the FINAL SERIALIZED JSON, not merely to the internal meaning of the string.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: multi-product visual fact ownership is checked row-by-row, and parsed-text sequence alone is insufficient", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "SAME-PAGE FACT OWNERSHIP MUST BE VERIFIED ROW BY ROW",
    "When a page contains Product A, Product B, and Product C vertically in separate commercial blocks, do not assign a technical fact to a product until its visual ownership is confirmed.",
    "FACT -> identify the illustration/text block containing the fact -> identify the commercial supplier-code row belonging to that block -> attach the fact ONLY to that row.",
    "Never use parsed-text sequence alone.",
    "If one fact visually sits below Product A's commercial row but inside Product B's illustrated block, it belongs to Product B.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: uncertain fact ownership is omitted/warned rather than copied to both neighbouring products", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "If ownership cannot be established confidently: omit the uncertain fact from the row specification; add an extractionWarning if commercially important.",
    "Do not copy the fact to both neighbouring products as a hedge.",
    "Final mandatory check: For every multi-product source page, re-check each row's specification against its own visual block before returning JSON.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: every sibling row must preserve visible count/size/configuration distinctions", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "When two or more authoritative accessory rows share the same generic source product heading but the source visibly distinguishes them by hook count, number of positions, width, capacity, size, or configuration, the extraction MUST preserve those distinguishing facts for EVERY sibling row.",
    "Before returning the family: (1) compare sibling displayNames; (2) compare sibling dimensions; (3) verify that each visible source distinction is retained;",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: a generic duplicate sibling name with missing dimensions is explicitly invalid when source distinctions are visible", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Row A: Wall Clothes Hanger - 2 Hooks, W35 cm",
    "Row B: Wall Clothes Hanger - 3 Hooks, W52 cm",
    "Returning Row B only as \"Wall Clothes Hanger\" with dimensions = null is INVALID when 3 hooks and W52 cm are visibly supplied.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: FINAL ACCESSORIES VALIDATION contains the hard-fail-before-return block", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "HARD FAIL BEFORE RETURN:",
    "Do not return the Accessories JSON until all are true: the exact serialized response passes JSON.parse; no unescaped inch mark or quoted manufacturer/product name remains inside a JSON string;",
    "every technical fact on a multi-product page has been bound to its own visual commercial block;",
    "no VESA, clamp range, desktop-thickness range, load, cable, plug, or other technical fact leaked into an adjacent product;",
    "every visibly supplied sibling count/size/configuration distinction is preserved in the relevant row.",
    "If any one of these checks fails, correct the draft before output.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: ordinary standalone accessory families must omit groupId/groupLabel", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Ordinary standalone accessory commercial families remain ordinary pricing.baseModelRows.",
    "Do NOT use pricing.baseModelRows[].groupId or groupLabel merely to organize Accessories into visual families such as Monitor Arms, CPU Holders, Cable Management, Waste Bins, Clothes Hangers, Desk Accessories, or Electrification.",
    "For ordinary Accessories: emit normal Base/Model rows with NO groupId; emit NO groupLabel; emit NO role = 'system_base'; preserve manufacturer family identity through labels/specification/source evidence; Smart Setup / Planning may create visual commercial families/subgroups later.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: groupId/groupLabel remain reserved for genuine Native System/Base only", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "pricing.baseModelRows[].groupId and groupLabel are reserved for the existing Native System/Base architecture only, where the source proves a genuine first-stage priced System/Base selection with downstream Main Products.",
    "Do not use Native System/Base metadata as a generic visual-grouping mechanism.",
    "Also verify that ordinary Accessories Base/Model rows do NOT contain groupId or groupLabel merely for visual/commercial family grouping.",
    "groupId/groupLabel are present only if the manufacturer source independently proves genuine Native System/Base architecture.",
    "Examples such as Monitor Arms, CPU Holders, Waste Bins, Clothes Hangers, Cable Management, and Desk Accessories are ordinary commercial families, not System/Base groups by name alone.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: visual family organization is deferred to Smart Setup/Planning, not extraction-time grouping metadata", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Smart Setup / Planning may create visual commercial families/subgroups later.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: composed supplier-code warning requires the composition instruction to be visible in the CURRENT supplied batch", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "The explicit code-composition instruction itself must be visibly present in the CURRENT supplied extraction batch.",
    "Do not emit \"COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED\" merely because current pages show article codes; current pages show finish codes; an earlier catalogue page or previous extraction batch proved composition.",
    "If the current supplied batch does not contain the explicit composition instruction, omit the warning and request/support that rule only when the relevant page is supplied.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: earlier-batch composition evidence alone cannot trigger the composed supplier-code warning", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  assert.ok(prompt.includes("an earlier catalogue page or previous extraction batch proved composition."), "Expected the prompt to explicitly reject earlier-batch-only evidence as sufficient");
});

test("Accessories: templateCode and internalSelectionName must not be invented", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Do not invent template.templateCode or template.internalSelectionName.",
    "If the current manufacturer source does not explicitly provide an authoritative template/product-family code suitable for templateCode, use null.",
    "If internalSelectionName is not source-proven or supplied by ProjectWorkflow context for this extraction call, use null.",
    "Generated convenience identifiers belong in row/group IDs, not authoritative templateCode/internalSelectionName fields.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: W/D/H/CODE/PTS strict column binding exists", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORY COMMERCIAL TABLE COLUMN BINDING",
    "When the source presents a dense commercial table with columns such as W | D | H | CODE | PTS or equivalent translated headings, bind values strictly by the visible column headers and row alignment.",
    "For every commercial row, read in this order: (1) W / width; (2) D / depth; (3) H / height; (4) CODE / supplier article code; (5) PTS / price.",
    "Never shift a numeric value into an adjacent field.",
    "using PTS as width, depth, or height; using width as price; using height as price; moving one row's price into the next row; reversing W/D/H merely because the product illustration is rotated; assuming the largest number is the price; assuming the final numeric value before CODE is price.",
    "The visible table column boundaries are authoritative.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: zero PTS remains zero and a neighbouring row's price cannot replace it", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ZERO PRICE COLUMN VERIFICATION",
    "When the PTS/price column visibly contains 0, 0.0, or 0.00, preserve price = 0.",
    "Do not: replace it with a neighbouring row's price; replace it with a width/height value; treat it as missing; skip the row.",
    "For every zero-price row, explicitly re-check the same visual row across CODE -> PTS before returning JSON.",
    "A visible zero price is a hard commercial value.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: O vs 0 supplier-code fidelity is explicitly required, and visible table wins over conflicting parsed text", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "SUPPLIER CODE CHARACTER FIDELITY",
    "Supplier article codes must preserve every character exactly as printed.",
    "letter O vs digit 0; letter I vs digit 1; letter S vs digit 5; letter B vs digit 8.",
    "Never normalize or guess these characters.",
    "If a source code visibly contains ...O..., do not emit ...0..., and vice versa.",
    "When OCR/parsed text conflicts with the visible table image, use the visible commercial table as authority.",
    "Do not silently repair a supplier code by pattern matching against neighbouring codes.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: a PTS value cannot be reused as a dimension, nor a dimension reused as PTS", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "NUMERIC CROSS-FIELD COLLISION CHECK",
    "Before returning each row, verify that a numeric source value was not reused in two unrelated fields merely because of table-reading ambiguity.",
    "Example: if source shows W 12.5, D 12.5, H blank, CODE ABC123, PTS 211, then: width = 12.5; depth = 12.5; height = null; price = 211.",
    "Do NOT emit height = 211 or price = 211 as the same value unless the source independently prints 211 in both columns.",
    "Likewise, do not use a PTS value as a dimension or a dimension as PTS.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: W/D/H direct-order mapping to width/depth/height exists, with no reordering by orientation or convention", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORY TABLE DIMENSION ORDER",
    "For Accessories commercial tables whose visible headers are W / D / H, map them directly to width / depth / height in that exact order.",
    "Do not reorder axes based on product orientation, illustration, English prose word order, or assumed furniture conventions.",
    "If the source row is 27 | 27 | 48 under W | D | H, emit width = 27, depth = 27, height = 48, not any permutation of those values.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected extraction prompt to include: ${expected}`));
});

test("Accessories: every used source page must appear in sources[]", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "SOURCE PAGE ACCOUNTING MUST MATCH EMITTED ROWS",
    "Every emitted commercial row must be backed by at least one page present in sources[] from the CURRENT supplied batch.",
    "If rows from supplied PDF page 10 are extracted, sources[] must include that page.",
    "extract rows from a page and omit that page from sources[]; claim a 9-page source list while emitting commercial data from page 10; use remembered/adjacent pages.",
    "(1) identify the highest/lowest supplied page actually used; (2) verify every used page is represented in sources[]; (3) verify no sources[] page lies outside the supplied batch.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: a module stating 'does not require cover' must not receive the cover companion rule", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "If one module explicitly states \"does not require cover\", do NOT attach the required-cover companion rule to that module.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: cover-required sibling modules retain their exact option_item dependency without generalizing across siblings", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "If another module explicitly states \"Cover X or Cover Y not included, to be ordered separately\", preserve module -> exactly one compatible cover using option_item applicability when representable.",
    "Never generalize one module's cover requirement across all sibling modules.",
    "For independently priced data/media modules and covers: preserve exact supplier codes character-for-character; do not confuse the letter O with zero in module codes; verify every dependency against the exact source item.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: high confidence is prohibited when commercial ambiguity remains", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORIES CONFIDENCE DISCIPLINE",
    "Do not return confidence above 0.90 if any of these remain unresolved: supplier-code character uncertainty; table-column ambiguity; unverified zero price; missing source-page accounting; uncertain commercial row ownership; incomplete accessory rows.",
    "A confidence such as 0.95 or 0.98 is inappropriate when authoritative commercial values remain uncertain.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: final hard checks cover column binding, cross-field reuse, zero price, code fidelity, page accounting, and cover generalization", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "W/D/H/CODE/PTS were bound from their exact visible columns; no PTS value was reused as width/depth/height; no dimension value was reused as price; every visible 0 price remains exactly 0; supplier codes preserve O versus 0 exactly; every extracted page contributing commercial rows exists in sources[]; module-specific \"cover required\" versus \"no cover required\" behavior was not generalized across sibling modules.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: row-token ledger uses the exact W/D/H/CODE/PTS order", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "ACCESSORY ROW TOKEN LEDGER",
    "For every dense commercial table row, build this internal row ledger BEFORE creating JSON: SOURCE ROW TOKENS: [W] [D] [H] [CODE] [PTS] [OPTIONS] [CBM] [KGS] [PARCELS]. Bind each visible cell exactly once.",
    "Before returning each row, reconstruct: width | depth | height | supplierCode | price and compare it back to the same visible source line.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: 200/60/18/CODE/39 cannot become 60/18/39/200", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Example: 200 | 60 | 18 | ABCO001 | 39 | ... must become: width = 200; depth = 60; height = 18; supplierCode = \"ABCO001\"; price = 39.",
    "It is INVALID to rotate or shift this into: width = 60; depth = 18; height = 39; price = 200.",
    "Do not reinterpret a row based on product orientation or numeric magnitude.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: blank H stays null and PTS cannot fill the blank dimension cell", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "BLANK DIMENSION CELL PRESERVATION",
    "If a visible commercial row contains fewer W/D/H numbers before CODE, preserve the missing axis as null.",
    "Example: 12.5 | 12.5 | [blank] | ABCO123 | 211 must become: width = 12.5; depth = 12.5; height = null; price = 211.",
    "Never move PTS into the blank H field.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: a zero price is locked against a following sibling's non-zero price", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "When a row has price = 0, lock that row's price before reading the next commercial row. A following sibling price must never overwrite or replace the zero.",
    "Example source sequence: CODE-A -> 0; CODE-B -> 198; CODE-C -> 227 must remain: CODE-A price = 0; CODE-B price = 198; CODE-C price = 227.",
    "Never propagate the first non-zero sibling price backward.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: O versus 0 supplier-code mutation is explicitly prohibited", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "For every code containing an O/0-like glyph, compare the character against the visible source image before final output.",
    "Do not infer code characters from generated ID patterns.",
    "Generated row/item IDs may normalize formatting for internal stability, but supplierCodes MUST preserve the manufacturer code exactly.",
    "The following transformation pattern is explicitly prohibited: ABCO001 -> ABC0001, or: ABCO03 -> ABC003, unless the printed source itself contains zero.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: a price/height collision requires explicit independent source evidence in both columns", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Add a final suspicious-collision check: If price equals one of width/depth/height, verify the source independently prints the same numeric value in both columns.",
    "If the source prints W55 D55 H174 CODE XYZ PRICE86, the extraction must be: width = 55; depth = 55; height = 174; price = 86. Not: price = 174.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: used multi-page batches require page-by-page sources[] coverage, not a collapsed null page entry", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "For every supplied page that contributes at least one emitted commercial row or option item, sources[] MUST contain a page entry for that exact page.",
    "If a 10-page supplied batch contributes data from all 10 pages, sources[] must account for all 10 pages.",
    "Do not collapse multi-page evidence into one source entry with pageNumber = null when page numbers are available from the supplied PDF.",
    "Before output, build an internal page -> emitted supplier codes ledger and verify every used page is represented in sources[].",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: one-slot main units cannot inherit maxSelections=3 from a shared optionGroup", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "CUSTOM MODULE SLOT CAPACITY MUST MATCH THE SELECTED MAIN UNIT",
    "If manufacturer Base/Model rows explicitly provide different module capacities, such as Main Unit A -> 1 custom module slot, Main Unit B -> 3 custom module slots, do NOT use one shared optionGroup with maxSelections = 3 for both units.",
    "Do not let a 1-slot product select 2 or 3 modules.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: one-slot and three-slot units require capacity-safe separate configuration, or MANUAL DECISION when it cannot be expressed safely", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Use separate applicability/configuration groups where necessary so that: 1-slot units allow maximum 1 selected custom module; 3-slot units allow maximum 3 selected custom modules.",
    "The same manufacturer module family may be represented in separate configuration groups only when required to enforce these source-proven, mutually exclusive slot capacities.",
    "Do not invent a priced \"slot\" item.",
    "If current draft structure cannot express different limits safely without duplicating configuration items, emit \"CONFIGURATION-DEPENDENT - MANUAL DECISION\" rather than applying the broader maxSelections to every unit.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: quoted model names are explicitly checked for JSON escaping in the hard gate", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Before returning, explicitly scan label and displayName for manufacturer names wrapped in quotation marks.",
    "Example source name: \"Catch\" must serialize as: \\\"Catch\\\" inside the final JSON string.",
    "The exact returned text must still pass JSON.parse.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});

test("Accessories: confidence above 0.90 requires every listed commercial validation gate to pass", () => {
  const prompt = getProductTemplateAiExtractionPrompt("accessories_electrification");
  [
    "Confidence above 0.90 is allowed only after ALL of these pass: exact W/D/H/CODE/PTS row reconstruction; zero-price verification; O/0 supplier-code verification; page-by-page source accounting; option-slot capacity verification; final JSON.parse validity.",
    "If any one fails or remains uncertain, confidence must be <= 0.90.",
  ].forEach((expected) => assert.ok(prompt.includes(expected), `Expected Accessories / Electrification prompt to include: ${expected}`));
});
