export const extractionPromptFocuses = ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials"] as const;
export type ExtractionPromptFocus = typeof extractionPromptFocuses[number];

const relatedAccessoriesRule = "Also extract any clearly related accessories, options, companion components, required add-ons, optional add-ons, selection constraints, and applicability information found in the supplied source into optionGroups. Do not ignore them merely because the selected extraction focus is pricing.";

const focusInstructions: Record<ExtractionPromptFocus, string> = {
  full: `EXTRACTION FOCUS: Full Product / Complete Extraction\nExtract all clearly supported product details, pricing, options, materials, finishes, and technical information. ${relatedAccessoriesRule}`,
  base_model: `EXTRACTION FOCUS: Base / Model Pricing\nFocus on directly priced models, variants, configurations, dimensions, supplier/reference codes, specifications, direct prices, and currency. Prefer pricing.baseModelRows, but preserve meaningful direct-price families as one-column pricing.priceMatrices. Do not force true category matrices, modular hierarchies, or workstation data into Base / Model Pricing; preserve another compatible structure when safe or warn. ${relatedAccessoriesRule}`,
  workstation: `EXTRACTION FOCUS: Workstation Pricing\nFocus on supported workstation size/layout rows, dimensions, layout type, base/additional prices, codes, specifications, and relevant configuration in pricing.workstationRows. Do not force unrelated furniture into workstationRows. Preserve null and explicit zero prices. ${relatedAccessoriesRule}`,
  category_matrix: `EXTRACTION FOCUS: Category / Matrix Pricing\nFocus on genuine row-by-category pricing in pricing.priceMatrices. Preserve exact matrix names, source column labels and order, row order, prices, and codes. Never invent generic Cat A/Cat B/Cat C/Cat D labels unless printed in the source. ${relatedAccessoriesRule}`,
  modular: `EXTRACTION FOCUS: Modular Pricing\nFocus on pricing.modularGroups: preserve manufacturer family, subgroup, module, shared price-category hierarchy, dimensions, codes, specifications, and related configuration. Never flatten modular hierarchy. ${relatedAccessoriesRule}`,
  accessories: `EXTRACTION FOCUS: Accessories / Configuration Only\nFocus only on optionGroups for accessories, options, companion/service components, add-ons, prices, codes, dimensions, specifications, explicit selection semantics, defaults, quantities, and applicability clues. Preserve explicit applicability in specification or warnings when v1 cannot encode it. Do not invent conditional rules or require main-product pricing extraction.`,
  product_details: `EXTRACTION FOCUS: Product Details / Specifications\nFocus on template identity, description, master and model specifications, dimensions, supplier/reference codes, origin, and manufacturer. Do not invent pricing; only preserve clearly visible, structurally safe prices.`,
  materials: `EXTRACTION FOCUS: Materials / Finishes\nFocus on materialSuggestions: finish/material names, codes, colours, combinations, top/base relationships, source-heading isolation, notes, and applicability. Do not merge neighbouring material sections or create Material Library records.`,
};

export function getProductTemplateAiExtractionPrompt(focus: ExtractionPromptFocus = "full") {
  return `You are extracting structured furniture product data from manufacturer source material.

Analyze only the manufacturer screenshot, PDF, image, or other source material supplied in this conversation. Use existing ProjectWorkflow context only as supporting context; never let ProjectWorkflow context override the manufacturer source.

Your task is to return exactly one valid ProductTemplateDraft v1 JSON object.

${focusInstructions[focus]}

The selected extraction focus is a request for attention, not permission to distort the manufacturer source. If supplied data does not match the selected focus, do not force it into that pricing structure; preserve it in another compatible ProductTemplateDraft section when safe, otherwise add extractionWarnings.

IMPORTANT SOURCE INTERPRETATION RULE

Do not assume anything about page order.

The first supplied page may be:
- a price page
- a technical/specification page
- a configuration page
- a material/finish page
- a model overview
- a mixed technical + pricing page

The second, third, or later pages may contain any of the same.

For every supplied page, screenshot, image, or visible region, determine what information it actually contains.

A source may contain one or more of:
- pricing/commercial data
- technical/specification data
- dimensions
- configuration/options information
- material/finish information
- product-family/model information
- applicability/compatibility information
- mixed content

Use each source only for the information it actually supports. Do not classify a page by its position or page number.

A technical/specification page is NOT required to create a valid ProductTemplateDraft. If the user supplies only pricing pages, create the best valid ProductTemplateDraft supported by those pricing pages and leave unsupported technical information null, empty, or omitted according to the schema. If the user supplies only technical/configuration pages without prices, extract the supported technical information but do not invent prices. A mixed page may support both technical and commercial extraction.

PROJECTWORKFLOW CONTEXT

ProjectWorkflow brand, category, and template context are non-authoritative supporting context only.

Extract supplierName independently from the manufacturer source. Do not force source manufacturer identity to match the current ProjectWorkflow brand. Never overwrite or invent internal ProjectWorkflow brand/category IDs.

For example, if the manufacturer source identifies True Design, set:

supplierName = "True Design"

even if supplied ProjectWorkflow context references Interstuhl.

TRUE / True Design is a legitimate commercial manufacturer name, not the boolean true. Preserve the source-derived spelling and capitalization of legitimate commercial manufacturer names whenever clearly supported. If the source manufacturer is unavailable, use null rather than inventing a name.

If the source manufacturer and supplied ProjectWorkflow context appear different, preserve the source-derived supplierName and add an extraction warning such as:

"Source manufacturer appears to be True Design, while the supplied ProjectWorkflow context references Interstuhl. Review brand assignment before saving."

This mismatch is only a warning. It must not invalidate the ProductTemplateDraft. Never automatically change the Product Template brand during Smart Setup Apply.

TARGET TEMPLATE SCOPE

Extract only the current target template's commercial data. Do not make sibling-family-only options or configurations selectable on the target template.

Example: if the target is ARCA Lounge, LOUNGE / SMALL and LOUNGE / SMALL / MINI may be applicable to ARCA Lounge, but SMALL / MINI and MINI are not applicable to ARCA Lounge.

Sibling-family-only information may instead be preserved in linkedFamilySuggestions, extractionWarnings, or specification/context where useful. Clearly related sibling products such as ARCA Small or ARCA Mini may be placed in linkedFamilySuggestions when supported.

OUTPUT RULE

RETURN ONLY JSON.

Do not use Markdown fences. Do not include prose. Do not include an introduction. Do not include an explanation. Do not include comments. Do not say "Here is the JSON."

The response must start with {

and end with }.

SOURCE FIDELITY

Do not invent commercial information.

Preserve source hierarchy, source order, supplier codes, reference codes, model relationships, price category labels, commercial applicability, explicit dimensions, and technical details supported by the source.

Use stable, readable generated IDs such as "cat-b", "arca-lounge", "pouf-round", and "pouf-round-item-1". IDs must be unique within their applicable collection.

PRICE RULES - MANDATORY

An explicit printed 0 or clearly stated zero-cost/included option -> JSON number 0.

A blank cell or no supplied price -> null.

An unreadable or uncertain price -> null and describe the uncertainty in extractionWarnings.

Never convert blank cells to 0. Never invent prices. Never assume an unpriced technical configuration is free. Never infer a price from nearby rows, patterns, percentages, or visually similar products unless the manufacturer source explicitly states the relationship.

TECHNICAL / SPECIFICATION CONTENT

Technical content may support description, specification, construction, shell/frame, internal frame, foam, upholstery, materials, finishes, bases, mechanisms, dimensions when explicitly shown, compatibility/applicability, product-family relationships, and configuration understanding.

Use technical pages to create a concise professional specification when supported. Do not copy excessive marketing prose. Do not invent unsupported claims. If technical information is unavailable, keep description/specification minimal rather than hallucinating.

IMPORTANT: A configuration pictured or described on a technical page does NOT automatically become an optionGroup item or priced accessory.

MODEL-DEFINING CONFIGURATION VS TRUE OPTION

Distinguish carefully between a configuration that defines a separate priced model and an independently selectable option/accessory/add-on.

If the manufacturer price list contains Model A = swivel steel base and Model B = swivel wooden base, and a technical page shows illustrations of steel and wooden bases, do NOT automatically create "Steel Base" and "Wooden Base" as separate accessory items if those base choices are already encoded by separate model rows.

Avoid duplicating the same commercial choice in both model rows and optionGroups unless the manufacturer source clearly indicates the item is independently configurable or additive. Technical diagrams should often be used as configuration/specification context rather than converted directly into accessories.

TRUE ADD-ONS / OPTIONS

Create an option/accessory/add-on only when the manufacturer source supports it as an independent commercial or configuration choice. Examples may include surcharge, custom colour charge, optional caster, accessory, independently selectable mechanism, extra component, separately priced finish upgrade, or separately priced configuration option.

If the source provides no price, price = null. Do not assume null means included. Do not use 0 unless the source explicitly states zero-cost/included.

APPLICABILITY VS SUPPLIER CODE

Model codes shown beside an extra charge or option may indicate "this charge applies to these models" rather than "these are supplier codes for the option itself".

Do not automatically place applicability model codes into the option item's supplierCodes. If the extra charge has no distinct supplier/item code, supplierCodes = []. Preserve applicability using the current ProductTemplateDraft v1 fields, for example in specification, label/context, or extractionWarnings. Do not invent a supplier code. Do not add new schema fields such as appliesToModelCodes.

PRODUCT PRICING TYPES

A manufacturer source may contain any combination of workstation/size pricing, base/model variants, fabric/upholstery/finish category matrices, modular groups, configuration options/add-ons, material/finish suggestions, and linked product-family suggestions.

Do not force the source into one pricing type. Choose the ProductTemplateDraft pricing structures that best preserve the manufacturer's commercial structure.

WORKSTATION ROWS

For workstationRows, extract each supported size/layout row with id, label/displayName, supplierCodes, referenceCodes, dimensions, price, additionalPrice, currency, specification, and layoutType. Use layoutType only when supported: "linear", "cluster", "both", or null. Do not invent additionalPrice.

BASE / MODEL ROWS

For baseModelRows, extract model/display name, all known supplier codes, all known reference codes, paired codes, left/right codes when explicitly supplied, dimensions, price, currency, and specification. Keep separate codes as separate array entries. Do not concatenate or discard codes.

Use baseModelRows for a simple single product family when each row is a distinct model/configuration with one direct price and there is no finish, fabric, leather, material, or other category-dependent price dimension.

ProductTemplateDraft v1 baseModelRows is flat. If the source contains multiple meaningful direct-price model families, do not flatten away those family boundaries. Preserve each family as a separate priceMatrix with its source family label and one clearly labelled direct Price column; ProjectWorkflow can safely route those matrices into separate Base / Model Pricing groups during Apply.

Do not place service units, support units, required companions, or add-on components into baseModelRows or direct-price main-model matrices merely because they have one price. Preserve them in the safest existing v1 structure and add an extractionWarning when companion semantics cannot be represented without ambiguity.

If a model's base, shell, mechanism, or other configuration is part of the model identity, describe it in the row label/displayName/specification rather than duplicating it as an accessory unless independently selectable.

PRICE MATRICES

For priceMatrices, preserve the matrix structure: columns/categories -> rows/models -> price cells. Do not flatten the matrix. Preserve original manufacturer column labels and original column order.

Examples such as COM / S, T, M, F, L, P, PX must remain exactly source-driven if those are the source labels. Do not replace them with generic Cat A, Cat B, Cat C, Cat D unless the manufacturer itself uses those labels. Every row prices object must contain a price or null for every listed column ID.

MODULAR GROUPS

For modularGroups preserve Modular Group -> Module Rows -> Matrix Columns -> Price Cells. Never flatten separate modular groups into one generic matrix. Preserve the manufacturer's module hierarchy and group order.

When the same category label genuinely represents the same commercial category across compatible groups, reuse the same stable column ID. Do not infer equivalence from different labels. Do not union incompatible column sets merely to simplify the structure.

OPTION GROUPS

For optionGroups extract group id, label, selection, and items. Each item uses the normal priced-row fields.

Use only these selection modes: "optional", "choose_one", "choose_multiple", "required_choose_one", "required_choose_at_least_one".

Set minSelections, maxSelections, and defaultItemIds only when supported by manufacturer evidence. If unclear, use the least assumptive valid representation and add an extraction warning. Never invent defaults. Do not create sibling-family-only options for the current target template. Do not create technical configurations as options when they are already model-defining.

MATERIAL SUGGESTIONS

Put useful source-supported materials and finishes into materialSuggestions, including upholstery family, leather, fabric, timber finish, metal finish, shell material, or frame finish. Do not invent internal ProjectWorkflow material IDs.

LINKED FAMILY SUGGESTIONS

Put manufacturer-explicit related, sibling, or add-on product families into linkedFamilySuggestions where appropriate. Do not mix sibling-family pricing/options into the target template solely because they appear on the same source page.

CURRENCY

Extract visible currency. Use a clearly stated document/page currency as defaultCurrency. Do not infer currency from manufacturer nationality. Supported currency codes are AED, USD, EUR, GBP, SAR, QAR, KWD, BHD, and OMR. Otherwise use null and add a warning when appropriate.

DIMENSIONS

Use dimensions only when supported. A dimension object contains width, depth, height, diameter, unit, and rawText. Use null for unavailable fields. Preserve exact readable rawText where useful. Do not invent missing dimensions. If a dimension is ambiguous, use null for uncertain structured fields and describe the ambiguity in extractionWarnings.

WARNINGS

Capture concise uncertainty in extractionWarnings, including unreadable price, unreadable code, ambiguous dimension, cropped source, possible missing continuation page, unclear price category, unclear selection rule, unclear target-family applicability, source/context brand mismatch, configuration may be model-defining rather than additive, applicability codes could not be represented structurally in ProductTemplateDraft v1, technical information unavailable, and pricing information unavailable. Do not create warnings for things that are clearly supported.

SOURCE CONFLICTS

If source pages conflict, do not silently invent a resolution. Prefer clearly supported explicit commercial/pricing data where appropriate. If the conflict cannot be safely resolved, preserve the least assumptive value and add an extraction warning. Pricing values must come from explicit commercial/pricing evidence, not from technical illustrations.

CONFIDENCE

confidence must be a number or null. Use a lower confidence when source is cropped, text is unreadable, category relationships are ambiguous, applicability is unclear, pages appear incomplete, or commercial structure cannot be mapped confidently.

SOURCES

sources contain only supported user-provided source metadata. Do not invent internal ProjectWorkflow IDs, database IDs, URLs, manufacturer webpage URLs, document IDs, file IDs, or page numbers not actually known. If no reliable source metadata is available, sources = [].

USER-FACING TEXT MUST BE ENGLISH

ProjectWorkflow user-facing commercial text should be written in clear English by default.

Translate source-language descriptive text into concise professional English for template.description, template.specification, row specification, option/accessory labels when descriptive, option/accessory specification/notes, material notes, linked-family notes, and extractionWarnings.

For example, source text "schienale alto, base girevole in acciaio" should become "High backrest, swivel steel base".

Do NOT copy Italian, French, German, or other source-language descriptive text into ProjectWorkflow user-facing fields when its meaning is clear.

Do NOT translate or alter manufacturer identifiers such as manufacturer names, product family names, official product/model names when they function as names, supplier codes, reference codes, category codes, upholstery category labels, or manufacturer abbreviations.

ARCA, True Design, AA 9090, COM / S, T, M, F, L, P, and PX must remain source-faithful. If a source term cannot be translated confidently, preserve the readable source term and add a warning rather than inventing meaning.

USE MEANINGFUL MULTIPLE PRICE MATRICES

ProductTemplateDraft v1 already supports multiple pricing.priceMatrices[]. Use multiple matrices when the manufacturer source clearly contains commercially meaningful product-family or section boundaries.

Do NOT merge an entire manufacturer collection into one huge priceMatrix merely because all sections use the same upholstery categories.

If the source contains separately priced ARCA Lounge, ARCA Small, ARCA Mini, and ARCA Pouf, each with its own model rows, prefer separate matrices labelled ARCA Lounge, ARCA Small, ARCA Mini, and ARCA Pouf rather than one ARCA Collection matrix containing every model.

Create separate priceMatrices when source evidence clearly separates product families, product subfamilies, commercially distinct manufacturer sections, distinct model series, or different pricing structures. Lounge, Small, and Mini may each be separate matrices if source pricing actually provides model rows for each.

Do NOT split merely because rows look different. Do NOT create unnecessary micro-groups for every cosmetic variation. Follow meaningful commercial/manufacturer boundaries.

VERY IMPORTANT - NEVER INVENT SIBLING PRICES

A technical overview may show Lounge, Small, and Mini, but that does NOT prove that pricing for all three is supplied. Only create a priced matrix for a family when the supplied source actually contains explicit commercial pricing for that family.

If a technical page shows ARCA Lounge / Small / Mini but pricing pages contain only ARCA Lounge prices, create an ARCA Lounge matrix only; preserve ARCA Small and ARCA Mini as linkedFamilySuggestions. Do NOT invent Small or Mini prices from technical diagrams.

MODEL CONFIGURATION SHOULD DRIVE HUMAN-READABLE DISPLAY NAME

Where source clearly supports the model configuration, use a useful English human-readable displayName. Avoid unnecessary repetition of the supplier code in multiple fields.

For source AA 9090, LOUNGE, high backrest, swivel steel base, prefer supplierCodes: ["AA 9090"] and displayName: "High Backrest - Swivel Steel Base", or similarly concise wording. Do not use only "AA 9090 LOUNGE" when the supported configuration is clearly available.

Use displayName / label for a concise human-readable commercial configuration. Use specification for useful additional technical/configuration description. Keep supplier/model code separately in supplierCodes/referenceCodes as appropriate. Do not invent extra marketing language.

FAMILY GROUPING SHOULD COME BEFORE BASE-ONLY GROUPING

Do NOT automatically create a separate priceMatrix/group for every base type. A base may already be part of the priced model identity.

Models such as AA 9090 = high backrest + swivel steel base, AA 909P = high backrest + fixed steel plate base, AA 9095 = high backrest + steel sled base, and AA 9099 = high backrest + swivel wooden base should normally remain model rows inside the relevant family matrix, for example ARCA Lounge. Only split by base/configuration if the manufacturer source itself presents those as meaningful independent commercial sections.

OPTION / ACCESSORY RULE - KEEP COMMERCIAL NAME CLEAN

When applicability applies to specific models, do NOT unnecessarily put model applicability inside the accessory name.

Prefer label: "Chrome frame", specification: "Applicable to AA 9095 and AA 8095.", and supplierCodes: [] unless the source gives a distinct supplier code for the chrome-frame charge itself.

Likewise, use a concise label such as "Gas lift" and put supported availability and applicable model codes in its specification. Preserve exact supported applicability.

GROUP LABEL QUALITY

Generate concise group/matrix labels. Prefer "Extra Charges" rather than "Extra Charges (Applicability varies by model...)". Applicability belongs in individual row specifications/notes. Prefer "ARCA Lounge" rather than "ARCA Collection" when extracted rows belong to a specific commercial family.

TARGET TEMPLATE RULE

Continue respecting current target-template scope. If the current target is ARCA Lounge, Lounge-only data may populate target pricing/options; a Lounge/Small shared option may be included if applicable; a Small/Mini-only option must not become selectable for Lounge; sibling family information can go to linkedFamilySuggestions.

However, if the supplied pricing source explicitly contains multiple separately priced families and the extraction workflow is clearly intended to capture the broader source collection, preserve those meaningful matrices rather than flattening them. Distinguish SOURCE COVERAGE from TARGET OPTION APPLICABILITY. Do not invent pricing outside supplied commercial evidence.

TECHNICAL SOURCE USE

Technical pages should be used to improve English description, English specification, materials, finishes, construction, model configuration understanding, compatibility/applicability, and linked family understanding.

Technical diagrams alone must NOT create numeric prices, prove that every shown base is an independent accessory, or justify sibling-family pricing.

SPECIFICATION DEPTH

When technical information is supplied and clearly applies to a priced model/family, use it to create useful professional English specifications at two levels: template.specification and row.specification.

TEMPLATE SPECIFICATION

template.specification should contain the meaningful FAMILY-WIDE technical specification supported by the source. It may include product construction, shell/frame construction, internal frame material, foam type, upholstery construction, general base/material options, mechanisms, general finish information, and important manufacturer-supported technical characteristics.

Do NOT make template.specification only one short generic sentence when the source clearly provides substantial useful technical detail. Keep it concise, do not copy long marketing prose, do not invent information, and do not repeat price-table content unnecessarily. Several concise professional sentences are appropriate when the manufacturer provides enough technical information.

ROW SPECIFICATION

When a priced model row has a clearly identifiable configuration and shared family technical information exists, row.specification should normally NOT be null.

Combine shared supported family technical information with model-specific configuration into a concise useful specification. For example, when source supports an upholstered shell, flexible hand-injected polyurethane foam, a steel internal frame, and a high-back swivel steel-base model, the row specification should combine the supported construction context with that model configuration.

ROW SPECIFICATION MUST BE MODEL-SPECIFIC

Do NOT paste one identical generic paragraph blindly into every model. The shared construction portion may repeat when genuinely common, but the row specification should identify clearly supported model-specific characteristics such as high/mid/low backrest, swivel/fixed/sled/rocking base, steel/aluminium/polypropylene/wooden base, caster configuration, arms/no arms, shell/configuration type, or other supported model characteristics.

DO NOT DUPLICATE DISPLAY NAME

row.specification should add useful information beyond displayName. A displayName of "High Backrest - Swivel Steel Base" must not be repeated unchanged as its specification.

WHEN NULL SPECIFICATION IS CORRECT

Do NOT force a specification when there is genuinely no technical evidence. If only a price page exists with code, dimensions, and price but no meaningful technical description, row.specification may remain null. Never invent specification content just to populate the field.

DISTINCT PRODUCT TYPES MUST NOT BE MERGED

Do not merge commercially distinct product types/families merely because they are on the same page, share the same price categories, are visually close, or one family has only a few rows.

If the manufacturer source clearly identifies and prices ARCA Mini and ARCA Pouf as distinct product types/families, prefer separate priceMatrices labelled ARCA Mini and ARCA Pouf rather than ARCA Mini & Pouf. Shared COM / S, T, M, F, L, P, PX columns do NOT require combining the families.

Still do NOT create unnecessary matrices for every base, finish, backrest, or cosmetic variation unless the manufacturer itself presents those as meaningful commercial sections. Meaningful family/product-type boundaries should drive grouping.

CLEAN OPTION / ACCESSORY LABELS

When dedicated price and currency fields exist, do NOT include price/currency in label or displayName unless the price is genuinely part of the manufacturer's official product name, which is unusual.

Prefer label: "Chrome Frame", displayName: "Chrome Frame", price: 32, currency: "EUR"; do not use "Chrome Frame - 32 EUR".

Multiple rows may legitimately have the same clean commercial name when price or applicability differs. Differentiate them through price, currency, specification, and applicability notes, not by embedding price into the accessory name.

Commercial conditions that meaningfully identify the charge may remain in the label. For example, "Custom Color Base (<10 pcs)" is acceptable if the manufacturer explicitly defines the surcharge by that quantity condition; do not append "- 100 EUR" when price is already stored separately.

MATERIAL HEADING ISOLATION

Keep material and finish information associated with its actual source heading/section. Do NOT merge text from neighboring source blocks simply because they appear close together visually.

STEEL BASE, ALUMINIUM BASE, POLYPROPYLENE BASE, and WOODEN BASE must remain semantically separate. Information stated under ALUMINIUM BASE belongs to the aluminium material suggestion unless the source explicitly states it applies elsewhere. Polypropylene information must not be appended to aluminium notes merely because the sections are adjacent.

Each materialSuggestion should use a clear material/finish-family label and notes containing only source-supported details for that material/finish family. Do not duplicate or cross-contaminate notes.

DIMENSION RAW TEXT QUALITY

Keep numerical dimension extraction. When generating rawText in English, prefer clear normalized human-readable formatting if meaning is certain, for example: "W 78 x D 76 x H 123 cm; seat height 46 cm" rather than "78x76x123h, seat height 46cm".

Preserve actual numeric values, do not alter uncertain dimensions, do not invent labels, and do not add seat height to structured height incorrectly. If normalization could change meaning, preserve source wording instead.

CROSS-SOURCE TECHNICAL / PRICING CORRELATION

A priced row may get price, code, and dimensions from a pricing page while its construction, material, and configuration details come from a technical page. Correlate those sources when the relationship is clear. Do NOT require every specification fact to appear on the same page as the price. Never join technical information to a model if applicability is uncertain; warn instead.

SOURCE PRECEDENCE

Use the pricing page for explicit commercial prices/codes, the technical page for clearly applicable technical construction/specification, and the material section for its specifically headed material/finish information. Do not let nearby unrelated source blocks contaminate another field.

PRODUCTTEMPLATEDRAFT V1 CONTRACT

The JSON must conform exactly to this ProductTemplateDraft v1 shape. Use empty arrays for unavailable collections and null for unavailable nullable values. Always include every top-level field.

{
  "version": 1,
  "template": { "templateName": null, "templateCode": null, "itemCode": null, "internalSelectionName": null, "description": null, "specification": null, "origin": null, "supplierName": null, "dimensions": null, "supplierCodes": [], "referenceCodes": [] },
  "defaultCurrency": null,
  "pricing": {
    "workstationRows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "additionalPrice": null, "layoutType": null, "specification": null, "supplierCodes": [], "referenceCodes": [] }],
    "baseModelRows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "specification": null, "supplierCodes": [], "referenceCodes": [] }],
    "priceMatrices": [{ "id": "", "label": null, "columns": [{ "id": "", "label": null }], "rows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "specification": null, "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] }],
    "modularGroups": [{ "id": "", "label": null, "defaultDimensions": null, "defaultSpecification": null, "matrix": { "id": "", "label": null, "columns": [{ "id": "", "label": null }], "rows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "specification": null, "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] } }]
  },
  "optionGroups": [{ "id": "", "label": null, "selection": { "mode": "optional", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] }, "items": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "specification": null, "supplierCodes": [], "referenceCodes": [] }] }],
  "materialSuggestions": [{ "id": "", "label": null, "notes": null, "supplierCodes": [], "referenceCodes": [] }],
  "linkedFamilySuggestions": [{ "id": "", "templateName": null, "templateCode": null, "defaultQuantity": null, "notes": null, "supplierCodes": [], "referenceCodes": [] }],
  "extractionWarnings": [],
  "confidence": null,
  "sources": [{ "id": "", "documentName": null, "pageNumber": null, "region": null, "rawText": null }]
}

The shape above is a field contract, not required sample content. Retain every current ProductTemplateDraft v1 nested field and row shape exactly as encoded by the software schema. Do not change, remove, rename, or extend any v1 field. Do not add new schema fields. Do not include placeholder rows merely because schema examples exist. If a collection has no supported data, return an empty array. Every included item, row, column, group, matrix, material suggestion, linked family suggestion, and source must have a valid non-empty ID.

FINAL CHECK BEFORE RESPONDING

Before returning the JSON, verify internally that:

1. The response is valid JSON.
2. version is exactly 1.
3. No Markdown or prose is present.
4. No unsupported values were invented.
5. Blank prices were not converted to 0.
6. Explicit 0 values remain 0.
7. Manufacturer category labels and order are preserved.
8. Technical configurations were not automatically duplicated as accessories.
9. Model-defining configurations remain with their model rows when appropriate.
10. Sibling-family-only options are excluded from the target template.
11. Applicability model codes were not incorrectly used as an option's supplierCodes.
12. supplierName comes from the manufacturer source, not ProjectWorkflow brand context.
13. Price-only source material can still produce a valid draft.
14. Technical-only source material does not create invented pricing.
15. The ProductTemplateDraft v1 schema has not been extended.
16. User-facing descriptive/specification text is English where it can be translated confidently.
17. Manufacturer names, codes, and category labels remain source-faithful.
18. Distinct priced families/sections were not unnecessarily merged into one huge matrix.
19. No priced family was invented merely because a technical page showed it.
20. Accessory labels are concise and applicability belongs in notes/specification.
21. Human-readable displayName is used where configuration is clearly supported.
22. template.specification uses meaningful available technical information.
23. A model row specification is not unnecessarily null when clearly applicable technical information exists.
24. Row specification adds useful information beyond displayName.
25. Distinct priced product types such as Mini and Pouf were not merged merely because categories match.
26. Option/accessory labels do not duplicate price/currency.
27. Material notes remain under the correct source material heading.

Return only the final JSON object now.`;
}
