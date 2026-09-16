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
    "When each SKU has only one direct price, use pricing.baseModelRows",
    "one column labelled \"Standard Price\" is an invalid one-column fake Matrix and is explicitly forbidden",
    "When each PRIMARY product SKU has category-dependent prices, use pricing.priceMatrices",
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
    "do not create a fake one-column priceMatrix merely to preserve them",
    "separate Base / Model Pricing groups",
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
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
  const targets = { full: "Full Product / Complete Extraction", base_model: "pricing.baseModelRows", workstation: "pricing.workstationRows", category_matrix: "pricing.priceMatrices", modular: "pricing.modularGroups", accessories: "optionGroups", product_details: "Product Details / Specifications", materials: "materialSuggestions", chair_seating: "EXTRACTION FOCUS: Chair & Seating", sofa_lounge: "EXTRACTION FOCUS: Sofas / Lounge / Armchairs", meeting_conference: "EXTRACTION FOCUS: Meeting / Conference Tables", storage_cabinets: "EXTRACTION FOCUS: Storage / Cabinets / Credenzas" } as const;
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

test("base model focus adds desk safeguards without changing focus registration or generic behavior", () => {
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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
  assert.deepEqual(productTemplateSetupPlanningFocuses, ["general", "chair_seating", "desk_executive", "workstation", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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
  assert.deepEqual(extractionPromptFocuses, ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
});

test("prompt choosers expose only refined extraction focuses and preserve planning focuses", () => {
  const source = readFileSync("components/products/copy-ai-extraction-prompt.tsx", "utf8");
  const [extractionChoices, planningSection] = source.split("const planningChoices");
  const visibleExtractionFocuses = [...extractionChoices.matchAll(/\{ focus: "([^"]+)", label:/g)].map((match) => match[1]);
  assert.deepEqual(visibleExtractionFocuses, ["base_model", "workstation", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
  ["Desks / Executive Desks", "Workstations / Bench Systems", "Chair & Seating", "Sofas / Lounge / Armchairs", "Meeting / Conference Tables", "Storage / Cabinets / Credenzas"].forEach((label) => assert.ok(extractionChoices.includes(`label: "${label}"`)));
  ["Base / Model Pricing", "Category / Matrix Pricing", "Full Product / Complete Extraction", "Workstation Pricing", "Modular Pricing", "Accessories / Configuration Only", "Product Details / Specifications", "Materials / Finishes"].forEach((label) => assert.ok(!extractionChoices.includes(`label: "${label}"`)));
  assert.ok(extractionChoices.includes("Extract sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration."));
  assert.ok(extractionChoices.includes("Extract complete meeting tables, terminal/intermediate systems, top-access and related cable management."));
  assert.ok(extractionChoices.includes('{ focus: "workstation", label: "Workstations / Bench Systems"'));
  assert.ok(extractionChoices.includes("Plan and extract workstation desks, benches, clusters, screens, required structural companions, cable management, and related storage."));
  assert.ok(planningSection.includes('{ focus: "desk_executive", label: "Desks / Executive Desks"'));
  assert.ok(planningSection.includes("Plan desk models, sizes, returns, service units, top-access and related desk configuration."));
  assert.ok(planningSection.includes('{ focus: "workstation", label: "Workstations / Bench Systems"'));
  assert.ok(planningSection.includes("Plan workstation and bench families, direct-priced systems, starter/add-on architecture, required companions, screens, storage integration, and extraction batches."));
  assert.ok(planningSection.includes('{ focus: "sofa_lounge", label: "Sofas / Lounge / Armchairs"'));
  assert.ok(planningSection.includes("Plan sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration."));
  assert.ok(planningSection.includes('{ focus: "meeting_conference", label: "Meeting / Conference Tables"'));
  assert.ok(planningSection.includes("Plan complete meeting tables, terminal/intermediate systems, top-access and related cable management."));
  ["general", "chair_seating", "desk_executive", "workstation", "sofa_lounge", "meeting_conference", "storage_cabinets"].forEach((focus) => assert.ok(planningSection.includes(`focus: "${focus}"`)));
  assert.deepEqual([...planningSection.matchAll(/\{ focus: "([^"]+)", label:/g)].map((match) => match[1]), ["general", "chair_seating", "desk_executive", "workstation", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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
    "TE160 and TE160E",
    "Do not automatically convert TE160E into TE160 plus an electrification option when the manufacturer prices both as distinct SKU rows",
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

test("workstation-specific regression and composition rules stay isolated from other furniture focuses and planning stays unaffected", () => {
  const workstationOnlySafeguards = [
    "OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS",
    "WORKSTATION ROUTING HIERARCHY",
    "STARTER / ADD-ON SYSTEMS",
    "BENCH EXTENSION DISTINCTION",
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
    "If \"oxi-q-ws-dx\" was emitted in pricing.baseModelRows, use target: { kind: \"base_model\", group_id: \"legacy-base-model-main\", row_id: \"oxi-q-ws-dx\" }",
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
    'If the row is in pricing.baseModelRows, use target.kind "base_model" and group_id "legacy-base-model-main".',
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
      "target: { kind: \"base_model\" | \"price_matrix\" | \"modular\" | \"workstation\", group_id, row_id }",
      "allowed_item_ids: optional array restricting which of this group's items apply under that rule",
      "fixed_quantity: a positive integer for an explicit manufacturer-required quantity",
      "OMIT the field entirely when no fixed quantity applies; never emit \"fixed_quantity\": null",
      "never fabricate a \"N x <code>\" item to represent it",
      "Emit conditionalConfiguration IN ADDITION TO, never instead of, the informational importantRequirements text",
      "do not add fields beyond documented contract fields such as unavailableCategoryIds or conditionalConfiguration",
      "TARGET GROUP_ID CONVENTION",
      "row_id always equals the exact stable id already assigned to that row/item in that structure",
      "never a supplierCodes entry such as \"111 623\", and never invented from a code, label, or family name",
      "use group_id: \"legacy-base-model-main\" only for an actual base_model target and group_id: \"legacy-workstation-main\" only for an actual workstation target",
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
    "do not create a fake one-column priceMatrix merely to preserve them",
    "a one-column \"Price\" matrix remains a forbidden fake Matrix no matter how many families exist",
    "keep every row in pricing.baseModelRows",
    "add an extractionWarning naming the distinct families present",
    "Never restore a fake Matrix to represent that grouping",
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
    "target: { kind: \"base_model\" | \"price_matrix\" | \"modular\" | \"workstation\", group_id, row_id }",
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
    assert.ok(getProductTemplateAiExtractionPrompt(focus).includes('target: { kind: "base_model" | "price_matrix" | "modular" | "workstation", group_id, row_id }'), `Expected ${focus} prompt's generic target shape to require group_id`);
  });
});

test("target-identity audit 5-6: Base/Model and Workstation group_id guidance matches the actual Apply-time adapter constants", () => {
  extractionPromptFocuses.forEach((focus) => {
    const prompt = getProductTemplateAiExtractionPrompt(focus);
    assert.ok(prompt.includes(`use group_id: "${LEGACY_BASE_MODEL_GROUP_ID}" only for an actual base_model target and group_id: "${LEGACY_WORKSTATION_GROUP_ID}" only for an actual workstation target`), `Expected ${focus} prompt to cite the real runtime sentinel group ids by import, not a hardcoded guess`);
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
