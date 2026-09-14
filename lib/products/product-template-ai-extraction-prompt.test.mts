import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    "MATRIX CELL AVAILABILITY",
    "unavailableCategoryIds",
    "Never infer N/A from every blank",
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
  const end = source.indexOf("\`,\n};", start);
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
  assert.deepEqual(productTemplateSetupPlanningFocuses, ["general", "chair_seating", "desk_executive", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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
  assert.deepEqual(visibleExtractionFocuses, ["base_model", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
  ["Desks / Executive Desks", "Chair & Seating", "Sofas / Lounge / Armchairs", "Meeting / Conference Tables", "Storage / Cabinets / Credenzas"].forEach((label) => assert.ok(extractionChoices.includes(`label: "${label}"`)));
  ["Base / Model Pricing", "Category / Matrix Pricing", "Full Product / Complete Extraction", "Workstation Pricing", "Modular Pricing", "Accessories / Configuration Only", "Product Details / Specifications", "Materials / Finishes"].forEach((label) => assert.ok(!extractionChoices.includes(`label: "${label}"`)));
  assert.ok(extractionChoices.includes("Extract sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration."));
  assert.ok(extractionChoices.includes("Extract complete meeting tables, terminal/intermediate systems, top-access and related cable management."));
  assert.ok(planningSection.includes('{ focus: "desk_executive", label: "Desks / Executive Desks"'));
  assert.ok(planningSection.includes("Plan desk models, sizes, returns, service units, top-access and related desk configuration."));
  assert.ok(planningSection.includes('{ focus: "sofa_lounge", label: "Sofas / Lounge / Armchairs"'));
  assert.ok(planningSection.includes("Plan sofas, lounge armchairs, modular seating, upholstery pricing and related lounge configuration."));
  assert.ok(planningSection.includes('{ focus: "meeting_conference", label: "Meeting / Conference Tables"'));
  assert.ok(planningSection.includes("Plan complete meeting tables, terminal/intermediate systems, top-access and related cable management."));
  ["general", "chair_seating", "desk_executive", "sofa_lounge", "meeting_conference", "storage_cabinets"].forEach((focus) => assert.ok(planningSection.includes(`focus: "${focus}"`)));
  assert.deepEqual([...planningSection.matchAll(/\{ focus: "([^"]+)", label:/g)].map((match) => match[1]), ["general", "chair_seating", "desk_executive", "sofa_lounge", "meeting_conference", "storage_cabinets"]);
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
