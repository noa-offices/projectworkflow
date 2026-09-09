export const extractionPromptFocuses = ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating"] as const;
export type ExtractionPromptFocus = typeof extractionPromptFocuses[number];

const relatedAccessoriesRule = "Also extract any clearly related accessories, options, companion components, required add-ons, optional add-ons, selection constraints, and applicability information found in the supplied source into optionGroups. Do not ignore them merely because the selected extraction focus is pricing.";

const focusInstructions: Record<ExtractionPromptFocus, string> = {
  full: `EXTRACTION FOCUS: Full Product / Complete Extraction\nExtract all clearly supported product details, pricing, options, materials, finishes, and technical information. ${relatedAccessoriesRule}`,
  base_model: `EXTRACTION FOCUS: Base / Model Pricing
Focus on directly priced models, variants, configurations, dimensions, supplier/reference codes, specifications, direct prices, and currency. A source row with one direct price per manufacturer code and no genuine category dimension must normally use pricing.baseModelRows. A one-column matrix whose only column is a generic "Price" is not a genuine Category / Matrix structure and must not be created merely to hold direct prices. Use pricing.priceMatrices only for genuine row-by-category pricing such as upholstery, finish, or material categories, or multiple commercial price columns tied to the same row identity; never flatten a genuine matrix into Base/Model. Do not force modular hierarchies or workstation data into Base / Model Pricing; preserve another compatible structure when safe or warn. ${relatedAccessoriesRule}

SOURCE ROW COMPLETENESS
Never intentionally omit, abbreviate, sample, summarize, or truncate clearly supported in-scope source rows to make the JSON shorter. Do not use "truncated to maintain focused draft size", "representative rows only", "remaining rows follow same structure", "omitted for brevity", or equivalent behavior. Extract every supported in-scope row from the supplied pages, including repetitive rows. If a value is unreadable, keep the row, use null where applicable, and add a specific extractionWarning.

DESKS / EXECUTIVE DESKS
When the source contains standard, executive, or managerial desks, keep this focus generic while treating direct-priced desk models, width/depth variants, LH/RH configurations, returns/extensions, desk-linked service/support units, top-access variants, modesty panels, cable-management items, and directly related required/optional components as relevant. Do not pull in standalone storage/general cabinet ranges, meeting or coffee tables, unrelated accessories, or other furniture families merely because they share a catalogue. A cabinet/service unit remains relevant only when the source explicitly includes it with, requires it for, supports the desk with it, or identifies it as designed for the desk.

For every Desk Base/Model candidate bind exact description -> manufacturer code -> printed width -> depth -> height -> LH/RH, SX/DX, left/right or reversible orientation when present -> direct price -> concise quotation-ready row specification -> supplier/reference codes. Never shift values between dense rows, derive unprinted dimensions, synthesize code ranges, invent the opposite handed version, or split one explicitly reversible item into fictional LH/RH codes. Direct-coded/priced desk sizes are flat pricing.baseModelRows; do not invent nested Base/Model groups. Consider every visibly supported width/size, handedness, with/without top-access preparation, standard/ceramic/3D-foil/eco-leather or equivalent source-defined construction, and normal/service-unit-support variant. Do not fabricate combinations, but do not skip a combination/code visibly supplied by the source.

DENSE DESK ROW PRICE BINDING
For each Desk row trace and visually re-bind this complete sequence independently: description/configuration -> orientation -> dimension -> manufacturer code -> numeric price -> requirement/footnote. Every numeric price must be verified against its own code row. When adjacent rows share dimensions or similar descriptions but differ by without/with top-access hole, standard/service-unit version, LH/RH, or material/construction, never copy, carry forward, or propagate the previous row's price unless the visible source explicitly prints the same price for both. Same width plus similar description does not mean same price. Before output, compare the full visible code-and-price sequence across adjacent structurally similar rows and correct any repeated-price shift; if an individual binding remains unreadable, use null plus extractionWarning rather than a neighbouring price.

Follow the source for returns and extensions: a complete desk-with-return code/price may be a Base/Model row, while a separately priced option, required companion, or support component belongs in optionGroups with its evidence preserved. Distinguish an included service/support unit from a separately priced required unit, optional desk-linked unit, and unrelated standalone storage. Preserve exact evidence such as "always complete with", "must complete with", "required", "necessary with", "use together with", "for service unit", "supporting pedestal", "side cabinet included", and "does not include". Never double-price an included unit or silently drop a required one. Explicit required wording must never be downgraded to optional because ProductTemplateDraft lacks final applicability fields: preserve the requirement in supported selection semantics and in specification/source wording or extractionWarnings for Review & Route. Do not invent raw applicability or fixed-quantity fields. When one item is required from several explicit alternatives, retain the required-one semantics, every source-supported candidate, and the complete alternative code set; never make the group unrestricted optional.

SUPPORTING VS FREESTANDING SERVICE UNITS
When the source explicitly maps article codes to desks with support service units, supporting units, or desk-supported units, only those mapped codes are support-service candidates. A nearby item labelled freestanding, standalone, right-or-left freestanding, or independent must not be merged into the support-unit group merely because it appears on the same page. Keep it in a separate optional group when desk relevance is explicit, or outside the support group otherwise. If a diagram or compatibility page maps DX/RH and SX/LH desk-support configurations to exact article sets, use that explicit mapping to validate later tables and do not expand the support set beyond those codes without source evidence.

Distinguish no top-access preparation, prepared/hole only, included top access, separately purchased top access, mandatory completion, and optional top access. WITHOUT-hole and WITH-hole desks with separate manufacturer codes are separate commercial rows whose prices must be bound and verified independently; never inherit the no-hole price onto the with-hole code. Preserve an explicit requirement such as "always complete with 1 top access" in specification/evidence and extractionWarnings for Review & Route; do not invent unsupported ProductTemplateDraft applicability or quantity fields. Likewise preserve included/optional/size-specific modesty panels, mandatory brackets, cable trays/baskets/ways/risers, and explicit incompatibilities. Separate accessory prices belong in optionGroups unless included in a complete directly priced configuration.

Keep INCLUDED, REQUIRED BUT SEPARATELY PRICED, OPTIONAL, and OUT OF SCOPE commercially distinct. Do not infer requirements from images. Preserve finish/material evidence without flattening genuine pricing structure: unpriced finish information belongs in materialSuggestions, separate directly coded/priced constructions may be Base/Model rows, and genuine row-by-category finish pricing remains pricing.priceMatrices.

Desk row specifications must be concise, factual, and quotation-ready, such as the source-supported desk type, top/construction, and orientation. Do not put compatibility instructions into the Product Specification or invent features.

REFERENCED COMPONENT CODE COMPLETENESS
When a Desk row references a component/article set such as ART.041-042-043, check every referenced code against the supplied material and handle every located source-supported item. Never silently extract only part of the set. If a referenced code cannot be found or read on the supplied pages, do not invent it; add an extractionWarning naming the missing referenced code.

WORKSTATION EXCLUSION FOR DESK SOURCES
When using this focus for Desk analysis, do not extract Workstations, bench systems, 2-person/4-person/6-person configurations, starter/add-on benches, or other multi-user desk systems into Base / Model Pricing. Mark them "Ignored — separate Workstation product-family cycle" and do not analyze their pricing further.

FINAL DESK SAFETY CHECK
For Desk source material, verify that direct single-price rows use pricing.baseModelRows rather than artificial one-column priceMatrices; genuine matrices remain matrices; no relevant row was intentionally truncated; every visible size, LH/RH, top-access, and material/construction variant was considered; every direct-price row has its own code -> price verification; adjacent similar rows did not inherit earlier prices automatically; WITH-hole and WITHOUT-hole rows were independently price-bound; explicit support-unit compatibility code sets were respected; freestanding units were not silently treated as required support units; row/code/price and dimension binding is correct; no Workstation/Bench or unrelated storage/meeting/coffee row was mixed in; included components were not double-priced; "always complete with" and other required service/support relationships were not downgraded to optional; referenced component code sets were checked completely; and no unsupported code, item, compatibility, or quantity rule was invented. Preserve source fidelity: explicit printed zero is 0; blank is null; unreadable or uncertain is null plus extractionWarning; symbols/open circles are not automatically zero; visible source evidence overrides OCR assumptions; and prices, codes, supplier/reference codes, and manufacturer code ranges must never be invented.`,
  workstation: `EXTRACTION FOCUS: Workstation Pricing\nFocus on supported workstation size/layout rows, dimensions, layout type, base/additional prices, codes, specifications, and relevant configuration in pricing.workstationRows. Do not force unrelated furniture into workstationRows. Preserve null and explicit zero prices. ${relatedAccessoriesRule}`,
  category_matrix: `EXTRACTION FOCUS: Category / Matrix Pricing\nFocus on genuine row-by-category pricing in pricing.priceMatrices. Preserve exact matrix names, source column labels and order, row order, prices, and codes. Never invent generic Cat A/Cat B/Cat C/Cat D labels unless printed in the source. ${relatedAccessoriesRule}`,
  modular: `EXTRACTION FOCUS: Modular Pricing\nFocus on pricing.modularGroups: preserve manufacturer family, subgroup, module, shared price-category hierarchy, dimensions, codes, specifications, and related configuration. Never flatten modular hierarchy. ${relatedAccessoriesRule}`,
  accessories: `EXTRACTION FOCUS: Accessories / Configuration Only\nFocus only on optionGroups for accessories, options, companion/service components, add-ons, prices, codes, dimensions, specifications, explicit selection semantics, defaults, quantities, and applicability clues. Preserve explicit applicability in specification or warnings when v1 cannot encode it. Do not invent conditional rules or require main-product pricing extraction.`,
  product_details: `EXTRACTION FOCUS: Product Details / Specifications\nFocus on template identity, description, master and model specifications, dimensions, supplier/reference codes, origin, and manufacturer. Do not invent pricing; only preserve clearly visible, structurally safe prices.`,
  materials: `EXTRACTION FOCUS: Materials / Finishes\nFocus on materialSuggestions: finish/material names, codes, colours, combinations, top/base relationships, source-heading isolation, notes, and applicability. Do not merge neighbouring material sections or create Material Library records.`,
  chair_seating: `EXTRACTION FOCUS: Chair & Seating
Use this focus when the supplied source primarily contains chairs, seating, benches, stools, waiting seating, lounge seating, or related seating systems. Extract supplied pages faithfully; do not force all seating into one template.

MODEL AND CODE BINDING
For every model, bind its exact manufacturer model/article code, description, back type, base/frame, model-defining mechanism, dimensions, specification, and printed price/matrix row. Read each model header independently: never shift descriptions between neighbouring rows/columns or infer them from visual order, nearby images, or naming patterns. Preserve model/article, upholstery-grade, fabric/leather-grade, mechanism, armrest, base, castor/glide, shell/frame finish, delivery, composite-code fragments, and reference codes exactly; never normalize, correct, complete, or generate theoretical code permutations.

LEGEND AND PRICE SEMANTICS
Before interpreting filled/open circles, bullets, equals signs, dashes, blanks, plus prices, +PTS, or footnotes, locate and read the manufacturer legend. Symbol meaning is not universal. If unclear, keep an uncertain value null where applicable and add a specific extractionWarning. Explicit complete model price is the printed row/matrix price; “+52”, “+52 PTS”, or equivalent is an additive option price, not a full model price. “=” means included/no surcharge only when the legend says so. Blank is null; explicit 0 is 0; a dash needs legend-supported unavailable/not-applicable/no-price treatment or a warning.

DENSE OPTION TABLE ROW BINDING
For every Chair & Seating option row, extract one bound source row in this exact order: description → exact supplier code → printed numeric price/surcharge → symbol/marker → applicable model columns → footnote/restriction. Never borrow a price, symbol, or applicability from an adjacent row or column. O, o, open circles, bullets, =, and dashes are markers, not prices by themselves; interpret them from the legend and table context. A row with an option marker plus 30 has price 30, not 0. Only an actual printed numeric 0, 0.00, €0, 0 PTS, or equivalent may become JSON number 0. Keep blank/no supplied price as null; use null plus a specific extractionWarning for unreadable or uncertain price.

Before finalizing each dense option group, second-pass verify label ↔ supplier code ↔ printed price ↔ row position and compare consecutive numeric rows with the visible source sequence. If a symbol or blank caused a one-row shift, correct it from the source. If alignment remains uncertain, set the affected price to null and add extractionWarning; never preserve a guessed shift. Do not turn an open-circle marker into a zero-cost warning.

STANDARD, INCLUDED, AND UPGRADES
Establish each model/family's standard/included equipment before paid options: mechanism, base/frame, arms, castors/glides, shell, delivery, and back type where supported. Put included equipment in model/template description or specification; do not add it again as a priced accessory. A separately priced verified upgrade is an option only for applicable models. Do not make standard and paid alternatives equal paid accessories or double-charge. “Prepared for” is not included or a priced accessory.

UPHOLSTERY AND MATERIALS
For a complete Model × Upholstery Grade table, use pricing.priceMatrices and preserve exact grade labels/codes and every row/column price/null cell. For base model + separate upholstery surcharge, preserve base model pricing plus a separately priced supported configuration/option; never invent a fake complete-price matrix. For a no-price fabric/finish list, use materialSuggestions/guidance, not a matrix. Preserve COM/customer-own-material terminology exactly: use a priced category only when explicit; otherwise retain it in specification/material guidance and warning as needed. Upholstery price grades are not actual selected Material Library fabrics/colours and must not become accessory items.

MODEL-DEFINING VS CONFIGURABLE
If a different back, base/frame, height, shell, or seat structure has a different manufacturer model/article code, use Base / Model or matrix rows. If the same code has a separately coded/priced selectable alternative, use Accessories / Configuration. Back types and four-leg/sled/cantilever/pyramid/four-star/five-star/counter bases are normally model-defining when separately coded. Mechanism alternatives for the same model must be one logically exclusive option group; standard mechanism is included/default information and paid alternatives are options. Armrests, castors, and glides are included characteristics, options, or model rows according to source evidence; never make them available to every seating model.

APPLICABILITY, COMPANIONS, AND EXCLUSIONS
Preserve explicit “only for”, “only with”, “not for”, “not available with”, “except”, article/model lists, retrofit restrictions, and other applicability in current routing-compatible option information where possible. Explicit “always complete with”, “must be completed with”, or “requires” rules should express required option/companion intent using optionGroups selection metadata where supported. Never infer required relationships. PDT v1 has no complete cross-option exclusion graph: preserve incompatibilities, non-retrofittable items, linking restrictions, and stacking restrictions in specification plus clear extractionWarnings; do not silently discard them.

MODEL APPLICABILITY AND FUNCTION GROUPS
Do not expose an option to every chair model merely because it shares a family table. Preserve exact model applicability, especially among swivel, counter, fixed-base/cantilever, and mechanism variants. Counter chairs with dedicated footrings, glides, columns, or bases must not inherit normal swivel-chair castors, columns, or incompatible options. Chair function rows (seat depth, inclination, lumbar, combined packages) must be classified from source as mutually exclusive, additive, bundled, or model-specific; never assume unrestricted simultaneous compatibility. When PDT v1 cannot safely represent applicability or function compatibility, retain the source-supported option and add extractionWarning for Smart Setup manual routing.

SPECIAL SEATING
Handle beam/waiting seating (seat count, beam length, seat/table combinations, supports/legs, linking); training/multipurpose seating (writing tablet, antipanic joint, wheels/sled, row connector, stacking, arms); lounge/outdoor/bench/pouf/cushion families; and counter/stool seating (height, footring, glides/castors, counter dimensions) as source-supported distinct products/configurations. Required beam legs/supports may be required companion intent only when explicit. Do not apply normal office-chair options without source support. Keep simple sources simple: two direct-priced chairs, shell colours, and one cushion do not justify fake matrices, conditional options, or excessive groups.

TECHNICAL CONTENT AND WARNINGS
Put useful stackability, consumption, carton, weight/volume, certification, outdoor, and fire notes in specification when supported; use warnings when manual configuration/commercial review is needed. Preserve MOQ/minimum-order and on-request conditions in specification and/or warnings; on-request is not unavailable, included, or zero price. Use visual subgroups and image/reference suggestions only where source-supported configurations share meaningful diagrams. Chair specifications should prioritize seating/back/upholstery, mechanism, arms, base/frame, castors/glides, headrest/lumbar, stackability/outdoor use, and dimensions. Template-level specification must remain true for the whole product family and future Add More JSON batches: keep batch/model-specific mechanisms at row level. Add specific warnings for unclear legend, standard-vs-option uncertainty, ambiguous matrix columns, code/description mismatch risk, unsupported exclusions, MOQ/on-request review, incomplete composite codes, and incompletely represented option applicability.

CHAIR ROW SPECIFICATION QUALITY
For every clearly identified chair/seating priced row, write row.specification as a concise quotation-ready commercial description, not a fragment such as "Synchronous mechanism. Armrests optional." Combine only source-supported facts: seating type/configuration; backrest type or height; upholstery, mesh, Chillback, or equivalent manufacturer term; mechanism; comfort-seat, headrest, armrest, counter/stool, footring, glides, and significant standard construction/equipment where model-defining. Make sibling row differences clear: for example medium-high versus high-back, headrest, comfort seat, or counter-chair configuration. Do not include price, currency, supplier/reference codes, JSON/Smart Setup language, or internal applicability wording. Detailed dimensions belong in the dimensions field; mention dimensions only where commercially necessary to distinguish the model, such as counter height or a source-emphasized back/overall size. Keep template.specification family-wide and safe for other mechanisms or configurations in future batches. If useful source facts are absent, do not invent them.

CHAIR ACCESSORY SPECIFICATION QUALITY
For every Chair & Seating optionGroups.items[].specification, write a short quotation-friendly phrase, usually 3–10 words, stating what the accessory/option is. Use only source-supported distinguishing facts such as colour, hard- or soft-floor use, 2D/3D/4D adjustment, polished aluminium, high/low column, adjustable support, headrest, or footring. Examples: "With black coat hanger", "Black floor glides for hard-floor surfaces", "2D T-armrests with width and height adjustment", and "5-star polished aluminium chair base". Describe included/default equipment too; never use vague wording such as "Basic equipment." Do not write a paragraph or include price, currency, supplier/reference code, JSON/internal terminology, or marketing text. Keep applicability, compatibility, exclusions, and required/optional selection information in routing-compatible option fields or extractionWarnings; it must not replace the short item specification. Make sibling accessory items clearly distinguishable using only supported facts.

FINAL CHAIR JSON VALIDATION GATE — DO NOT RETURN UNTIL ALL PASS
Before returning ProductTemplateDraft JSON, correct every resolvable failure. Re-read each final pricing matrix column character-by-character from the highest-quality visible source: column id ↔ source code ↔ label. Never substitute a different manufacturer grade; if the visible source cannot resolve a conflict, use a stable generated column id with an exact supported readable label, or mark affected pricing uncertain with extractionWarning. Then verify every row.price key matches its final column id exactly; no stale key may remain after correction.

Search final JSON for every price 0, including matrix values. Zero requires explicit printed numeric 0/0.00/€0/0 PTS, explicit included/standard with no surcharge, or a legend that clearly establishes a no-surcharge selectable alternative. O/open-circle/option marker alone never justifies zero. For each priced option verify description → exact supplier code → numeric surcharge → symbol → model applicability; a numeric surcharge on that visible row wins. Compare dense-table numeric sequences with the visible source and re-read any mismatch; if unresolved, set affected price(s) to null plus extractionWarning rather than preserve a row shift.

Template-level description/specification must stay true for the whole family and future Add More JSON batches: keep batch/model-specific mechanisms at row level. Do not emit unrestricted maxSelections: null for function packages unless the source proves independent additive compatibility; otherwise use the safest supported selection metadata and/or extractionWarning for Smart Setup manual routing. Preserve model-specific restrictions, including counter-chair glides/footrings, swivel castors, coat hangers, and column/base choices; retain wording and extractionWarnings when PDT cannot encode them fully. supplierName must be explicitly established by the supplied manufacturer source; never infer it from recognition, filename, or context. Otherwise use supplierName: null and, where useful, extractionWarning.

Final consistency: matrix codes and row keys agree; every zero is source-justified; no marker-alone zero or row shift remains; template specification is family-wide; function compatibility is not overstated; supplierName is source-supported; and warnings state unresolved facts rather than justify guesses. If source remains uncertain, null plus extractionWarning is preferred over a guessed commercial value.`,
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

QUOTATION-READY SPECIFICATIONS

Write template.specification and row.specification as concise, professional, client-facing furniture descriptions suitable for direct commercial quotations. Rewrite supported manufacturer facts into clear English rather than repeating fragmented table wording. Prefer 1–4 short sentences or lines covering, where supported: product/configuration, main construction/materials, functional features, included components, mechanisms/adjustments/hardware, dimensions, and manufacturer/country of origin.

template.specification is the common family-wide commercial specification. row.specification is a complete quotation-ready description for that exact priced model/configuration: combine applicable family construction with the supported model-specific difference, dimensions, and origin. Do not reduce a row specification to only a difference phrase. Cross-reference technical and pricing pages only when their relationship to the same model/code is clear.

Do not put price, currency, supplier/price-list code, internal selection language, compatibility restrictions, or rules such as "required exactly one" in quotation specifications. Preserve configuration/applicability in option/group/rule fields or extractionWarnings when v1 cannot encode it safely. A specification may describe the resulting physical configuration when supported.

VISIBLE MODEL AND ACCESSORY NAMES

displayName and accessory label must be human-readable and identifiable. Do not use a supplier/price-list code as the visible name when the source provides enough descriptive information; keep codes only in supplierCodes/referenceCodes. Include the minimum supported distinction between siblings, such as size, orientation, configuration, top-access condition, service-unit compatibility, or seat count. Example: label: "Service Unit W123.6 - Right", supplierCodes: ["1AF 090"], not label: "1AF 090".

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

export const productTemplateSetupPlanningFocuses = ["general", "chair_seating"] as const;
export type ProductTemplateSetupPlanningFocus = typeof productTemplateSetupPlanningFocuses[number];

const planningFocusInstructions: Record<ProductTemplateSetupPlanningFocus, string> = {
  general: "",
  chair_seating: `CHAIR & SEATING PLANNING FOCUS
Use this focus for task, executive, visitor, conference, training, beam/waiting, lounge, outdoor, stool, and related seating ranges. First classify each supplied seating section as simple direct-price seating, encoded/composite finish family, Model × upholstery-grade matrix, base price plus surcharge, one shell across base architectures, beam/waiting, training/multipurpose, lounge/outdoor, or counter/stool. One source can contain several patterns; do not force every chair range into an upholstery matrix.

CHAIR TEMPLATE STRUCTURE
One Product Template normally represents one commercially understandable seating family with coherent configuration logic. Do not split merely for high/mid/low back, mesh/upholstered variants, upholstery grades, base choices, or comfort-seat variants when one Sales configurator remains coherent. Split substantially different office/task, conference, visitor/cantilever, dining, lounge, bench/pouf, or rule systems when a combined template would confuse Sales. Never make one template per SKU.

For every seating model referenced in the plan, bind exact model/article code → source description → back type → base/frame → main dimensions → standard equipment. Manufacturer codes are immutable source identifiers: copy character-by-character; never normalize, infer from neighbouring rows, or translate model, upholstery-grade, mechanism, base, armrest, castor/glide, shell/frame, delivery, or composite-code fragments. For example, SG3 must never become 803, S03, or SG-3 unless explicitly printed. Cross-check every short pricing/category code against the nearest source table header, legend, category heading, or model heading. Read the manufacturer legend before interpreting circles, bullets, =, dashes, blanks, +PTS/+price, or footnotes; symbol meaning is not universal.

SOURCE PRIORITY HIERARCHY
When representations conflict, use this evidence order: actual visible/rendered manufacturer page; clear table/header text visible on that page; reliable embedded PDF text; extracted text; OCR-like/transcribed text. Higher-priority evidence overrides lower-priority transcription errors. Do not preserve obvious OCR corruption when a visible manufacturer header clearly resolves it: use the visible source value. Use UNCONFIRMED CODE only when the highest-quality available source itself is genuinely unclear, not merely because OCR/extracted text differs. Apply this hierarchy in the final pass to model and upholstery codes, option codes, prices, symbols, footnotes, dimensions, dense-table associations, and page references.

CHAIR CONFIGURATION DECISIONS
Identify standard/included mechanism, base/frame, arms, castors/glides, back/frame, and delivery before alternatives; never recommend an included item as another priced accessory. Different model/article code for back/base/frame/height/shell/seat structure normally means Base / Model or matrix row. Same code with separately priced selectable alternative normally means Accessories / Configuration. Alternative mechanisms are usually one mutually exclusive configuration group. Classify armrests as included, optional for the same model, or model-defining; check castor/glide applicability by exact model and do not apply task-chair choices to sled, cantilever, fixed four-leg, or counter chairs without source evidence. Actively surface not retrofittable, cannot combine, not available with, only for, exceptions, and stacking restrictions as WARNING / MANUAL REVIEW with their plain-English meaning when current rules cannot represent them.

UPHOLSTERY AND SPECIAL SEATING
Complete Model × Upholstery Grade pricing → Category / Matrix as PRIMARY PRICING DESTINATION. Its matrix rows are pricing-authoritative model rows: retain exact model code, readable name, dimensions, specification, and row image/reference where available; do not duplicate these model prices into Base / Model pricing merely to retain identity. Base / Model may be noted conceptually only. Base model plus upholstery surcharge → base model plus supported option/configuration; no-price upholstery list → Manufacturer Finish Guidance; COM/customer-own material retains exact pricing/conditions or becomes warning/specification. Pricing grades such as SG2 / SG3 / HP4 belong to active Category / Matrix columns, not Manufacturer Finish Guidance. Actual fabric/material names belong to Manufacturer Finish Guidance or later Material Library selection. Price grades are not accessory items. Surface “only for”, exclusions, retrofitting, stacking, footring/glide, and article-specific restrictions; recommend existing rules when representable or MANUAL DECISION / warning when not.

FINAL CHAIR SOURCE GATE — DO NOT RETURN UNTIL ALL PASS
Before returning PRODUCT SETUP PLAN, re-read the supplied source using the source-priority hierarchy and correct every resolvable failure; do not merely warn about it. (1) Search the final answer for manufacturer identifiers joined by -, –, —, to, through, from, or ...: inferred ranges are forbidden because identifiers are not numeric sequences. Use exact verified codes, or source-safe wording such as “all explicitly listed upholstered-back models on printed catalogue pages X–Y”; use a range only when the manufacturer explicitly defines it. (2) Re-read every final pricing-grade/category/matrix code from the highest-quality visible source; do not output OCR corruption such as S01, 562, or LGG when the rendered source clearly shows SG1, SG2, SG3, HP4, LG6, or LG7. Use UNCONFIRMED CODE only when that highest-quality source is genuinely unclear. (3) O, o, ○, open circles, and option markers are not numeric zero: establish zero only from an actual printed 0, 0.00, €0, 0 PTS, or equivalent, and read symbol + printed price + legend together. Never classify NO-COST ALTERNATIVE from an O/open-circle alone. (4) For every important component, verify description → exact code → exact printed price/surcharge → applicable model column → symbol → footnote; never borrow an adjacent value. If unverified, use UNCONFIRMED / MANUAL DECISION. (5) Do not claim a price conflict, duplicate price, discrepancy, or double-charge risk until both compared rows are independently re-read. Check whether a configuration code and boxed order code are related codes for the same physical item; if their description and verified price align, report that relationship rather than a conflict. (6) One physical commercial choice equals one component entry. Split distinct finish roles, armrest types, codes, prices, or statuses. Give each entry exactly one status: INCLUDED / STANDARD, NO-COST ALTERNATIVE, PAID UPGRADE, REQUIRED SEPARATE ITEM, OPTIONAL SEPARATE ITEM, ON REQUEST, or UNCONFIRMED. Never combine statuses; mark Required only with explicit required/must/always complete with/requires evidence. A separately priced optional item is not Required Companion. (7) Preserve finish meaning: “components remain black” is not an exclusion or availability restriction. (8) PDF page is the actual position in the uploaded file, never a printed label or calculated offset. Keep it within known file page count; a spread may be “PDF page 1 / printed catalogue pages 124–125”. If unavailable, say “PDF page unavailable / printed catalogue page X”. (9) Re-scan refer to, see, accessories overview, fabric chart, see collection, see page, and equivalents; put missing referenced content under Pages to inspect manually and do not invent a page. (10) Final consistency: template count, code/grade spelling, page mappings, pricing destination/batches, matrix authority, and standard-versus-paid statuses must agree. No inferred ranges, out-of-file PDF pages, duplicate matrix/Base-Model prices, or unsupported zero-price assumptions may remain. If unresolved from source, use UNCONFIRMED / MANUAL DECISION. Source fidelity is more important than completeness.

For beam seating inspect seat count, beam/table combinations, supports/legs and linking; explicit required legs/supports may be local Required Companion/required exactly-one only when explicit. For training inspect writing tablet, anti-panic, linking, wheels/sled, stacking and exact applicability. For lounge/outdoor distinguish dining chair, armchair, lounge, rocker, bench, pouf and cushions by sensible quotation configuration; cushions can be local or standalone based on source. For counter/stools inspect higher dimensions, footring and glides. Preserve composite-code patterns without generating theoretical combinations. Put MOQ, on-request, stackability, outdoor suitability and relevant technical notes into warning/specification guidance. Keep genuinely simple seating products simple.`
};

export function buildProductTemplateSetupPlanningPrompt(focus: ProductTemplateSetupPlanningFocus = "general") {
  return `You are planning how a manufacturer price list should be entered into ProjectWorkflow.

DO NOT EXTRACT ProductTemplateDraft JSON. DO NOT RETURN JSON.

${planningFocusInstructions[focus]}

Analyze the complete supplied manufacturer PDF/document and produce a practical, human-readable setup plan before extraction. Use only source-supported products, prices, compatibility, requirements, relationships, and actual PDF viewer page numbers. Do not invent data or guess page relationships. Separate explicit manufacturer facts from recommendations; label uncertainty as MANUAL DECISION. If a source shows an accessory but does not explicitly establish its applicability to every family, do not assume it applies to all Product Templates: label MANUAL DECISION — applicability not explicit in source.

USER LANGUAGE AND MANUFACTURER TERMINOLOGY
Write the entire PRODUCT SETUP PLAN in the same language as the user's request; if that language cannot be reliably determined, default to English. English is preferred unless the user asks otherwise. Use simple, clear commercial English suitable for Sales, estimators, designers, and procurement users; do not make foreign-language catalogue wording the primary explanation.

Translate manufacturer descriptions from any source language into the user's language. Put the clear translated description first and show the original manufacturer term secondarily only where useful for verification, for example: “Cable Tray” followed by “Manufacturer term: ‘[original term]’”, or “Panel-Base Workstation” followed by “Source label: ‘[original term]’”. Do not repeatedly show original terms that add no verification value. Apply this equally to Italian, German, French, Spanish, Chinese, Arabic, and other languages.

Never translate, modify, or replace supplier codes, article numbers, reference codes, finish codes, model codes, or official manufacturer family identifiers. Keep official families/codes as commercial identifiers, but pair them with a clear translated description, for example “[official family] — [clear English family description]”. For finishes, prefer the English name plus the original manufacturer name/code where useful; retain the exact original code and prefer a manufacturer's official English translation where provided.

When quoting manufacturer instructions, first state the plain-language meaning, then include Source wording only if useful for verification. For component evidence, explain what the manufacturer shows/states in the user's language first and place any original-language wording secondarily. Always use ProjectWorkflow labels consistently in English exactly as follows: Base / Model; Workstation; Category / Matrix; Modular; Accessories / Configuration; Manufacturer Finish Guidance; Normal Accessory; Conditional Option; Required Companion; Include Locally; Standalone Product; Both; Manual Decision; INCLUDED; PREPARED FOR; REQUIRED SEPARATE ITEM; OPTIONAL SEPARATE ITEM; UNCONFIRMED.

PAGE NUMBERING
First determine whether the document contains printed catalogue page numbers. When both PDF viewer and printed catalogue numbering can be identified, ALWAYS provide both in every page reference using this exact form: “PDF page 3 / printed catalogue page 12”; for ranges, “PDF pages 3–5 / printed catalogue pages 12–14”. Never provide only “Page 12” when PDF and printed numbering differ. If only one numbering system is genuinely available, state that explicitly: “PDF page 12 / printed catalogue page not shown” or “PDF page unavailable / printed catalogue page 42”. Do not guess either number. If PDF page 1 does not correspond to printed catalogue page 1, detect the offset and place a PAGE NUMBERING NOTE near the top of the plan explaining the relationship and confirming that all references below use both numbering systems. Use the same dual-number format in Main source pages, Shared/supporting pages, extraction batches, Shared / Common Element Strategy, and Extraction Order.

PRODUCT TEMPLATE SPLITTING
Prefer one commercially understandable product family per Product Template. Do not create one template per SKU, a giant template for unrelated families, or arbitrary page-count splits. A coherent family may contain many sizes/models. Consider separate templates for distinct typologies, structures, configuration logic, pricing structures, or very large independent ranges. Keep quotation configuration understandable.

PROJECTWORKFLOW DESTINATIONS
- Base / Model Pricing: direct-priced model/SKU/size variants and normal model tables. Supports groups, rows/models, price/currency, dimensions, specifications, visual subgroups, and images. Quotation flow is Family → Configuration/Subgroup → Model.
- Workstation Pricing: only workstation size/layout/orientation rows with base and, where supported, additional price.
- Category / Matrix Pricing: only a genuine row × category/finish/fabric pricing matrix with meaningful ordered rows and columns; a visual table alone is insufficient.
- Modular Pricing: only genuine modular families with hierarchy/modules and shared price columns. Do not flatten modular structure.
- Accessories / Configuration: optional accessories, required components, conditional options, and companion parts. Supports Normal Accessory, Conditional Option, Required Companion, selection rules, applicable Base/Model rows, allowed items, fixed quantity, subgroups, and images.

ACCESSORY RULES AND TEMPLATE-LOCAL LIMITATION
Recommend an accessory rule only when source-supported. An explicit “always complete with” may be Required Companion; an explicit mutually exclusive supported choice may be REQUIRED / EXACTLY ONE; an optional item may be Normal Accessory. Otherwise use MANUAL DECISION.

Accessories are TEMPLATE-LOCAL. A Product Template cannot use an accessory stored in another Product Template as its own configuration choice, and Required Companion/Conditional Option rules cannot reference another template. If Product A requires Art.X during Product A configuration, Art.X must exist locally within Product A. This is a valid reason for local inclusion/duplication.

SHARED/COMMON ACCESSORY APPLICABILITY EVIDENCE
An item appearing in Shared Elements, Common Elements, Accessories, General Accessories, Common Components, a shared price table, or an overview/index page ONLY proves that it exists in the manufacturer range. It does NOT prove compatibility with every Product Template/family. Never infer applicability solely because an accessory appears in a shared/common section.

Before recommending an accessory as Include Locally, Required Companion, Conditional Option, or Normal Accessory, find manufacturer-source evidence connecting it to the relevant family/configuration. Acceptable evidence is: EXPLICIT (manufacturer directly states compatibility); CROSS-REFERENCED (the relevant family page directly points to the accessory/common page); VISUALLY CONFIRMED (a manufacturer diagram clearly and unambiguously shows the relationship); or UNCONFIRMED (the accessory exists in a shared/common section but applicability is not established). Only EXPLICIT, CROSS-REFERENCED, or clearly VISUALLY CONFIRMED accessories may normally be recommended for local inclusion. UNCONFIRMED must become MANUAL DECISION — compatibility not established by supplied source.

For every shared/common accessory recommendation, output:
Accessory: [manufacturer description/code]
Affected Product Template:
Applicability evidence: EXPLICIT / CROSS-REFERENCED / VISUALLY CONFIRMED / UNCONFIRMED
Source: PDF page X / printed catalogue page Y
Evidence: short explanation of what the manufacturer actually shows/states
Recommended strategy: Include Locally / Standalone Product / Both / Manual Decision
Reason:

Overview pages listing modesty panels, cable trays, central covers, tops, partitions, screens, accessories, or meeting tables are document-navigation clues only. Do not automatically propagate those items to every family shown. Follow referenced pages and verify compatibility; even a family-page cross-reference means inspect the referenced page to determine which rows/items actually apply. Do not infer compatibility from visual similarity or furniture-domain assumptions. If a structural relationship appears redundant, use it only as a reason to flag MANUAL DECISION, never as proof.

Before completing each Product Template section, ask: “For every accessory I am recommending inside this Product Template, what source evidence proves that it belongs to this family?” If no defensible evidence exists, remove the recommendation or mark MANUAL DECISION — compatibility not established by supplied source. It is better to omit an uncertain accessory than to incorrectly attach it to a Product Template.

COMPONENT COMMERCIAL STATUS
For every accessory/component relationship, classify exactly one commercial status. Do not collapse these into a generic “accessory”:
- INCLUDED: the component is explicitly included in the listed product price/package.
- PREPARED FOR: the product has holes, cut-outs, brackets, wiring/mounting provision, recesses, or similar provision for the component, but the source does not state that the component itself is included.
- REQUIRED SEPARATE ITEM: the manufacturer explicitly says “always complete with”, “must be completed with”, “requires”, “add Art.X”, “complete with quantity X”, or equivalent, and the component has its own code/price.
- OPTIONAL SEPARATE ITEM: compatible/available and separately selectable or priced, but not mandatory.
- UNCONFIRMED: the relationship is not clear enough.

Do not assume INCLUDED merely because a drawing shows the accessory, the product is “with holes for”, “prepared for”, “provision for”, “pre-drilled for”, “cut-out for”, “suitable for mounting”, or “cable passage provided for”, the accessory appears in the same diagram, or it appears in a shared/common section. Those phrases normally mean PREPARED FOR, not INCLUDED; preparedness is not itself a priced accessory. Classify INCLUDED only with explicit manufacturer evidence that the component is part of the supplied product/package/price. If uncertain, use UNCONFIRMED / MANUAL DECISION.

If an item is INCLUDED, do not recommend adding it again as a priced accessory: mention it only in the specification/description where useful and flag POTENTIAL DOUBLE CHARGE if it could be added separately. If status is PREPARED FOR, do not add the accessory automatically; determine separately whether the actual accessory is REQUIRED SEPARATE ITEM, OPTIONAL SEPARATE ITEM, or UNCONFIRMED. Flag PREPARED FOR ≠ INCLUDED where wording could be misunderstood.

Map REQUIRED SEPARATE ITEM to Required Companion or an appropriate supported required selection rule. Map a verified OPTIONAL SEPARATE ITEM to Normal Accessory only for the applicable product/configuration; do not auto-select it or treat it as included. Quantity is permitted only when explicitly supported.

Generic example: “bench with holes for top-access and cable tray” means PREPARED FOR top-access and cable tray. “always complete with 2 Art.X” means Art.X is REQUIRED SEPARATE ITEM, Qty 2. A cable tray appearing elsewhere with its own price but no mandatory language is OPTIONAL SEPARATE ITEM. Do not hardcode supplier names or real codes.

For each shared accessory, choose a configuration strategy rather than automatically recommending duplication merely because it appears on a shared/common page:
- Include locally: required companion, conditional option, normal accessory that Sales should select while configuring that product, or an item on which internal configuration depends.
- Standalone product: genuinely quoted independently, no in-template rule depends on it, and it does not need to appear as an option in another Product Template.
- Both: only when commercially justified because a local configurator copy is required and the item is also sold independently.
- Manual decision: applicability or Sales configuration need is not explicit in the source.

For optional shared accessories such as modesty panels, cable trays, screens, and shared accessories, evaluate whether Sales needs to select them during the main product configuration. If yes, recommend Include locally; if no, recommend Standalone product where appropriate; if uncertain, use MANUAL DECISION. Identify the strategy, reason, affected templates, and any duplicated or reused supplier/price-list code ambiguity.

VISUAL SUBGROUPS, IMAGES, AND FINISH GUIDANCE
Hierarchy: Pricing Type → Group → Subgroup → Row/Item. Rows/items remain pricing-authoritative; subgroups are visual/organizational only. Recommend subgroups only for source-supported shared diagrams, shapes/configurations, size families, or orientations. State the appropriate image level: Group image, Subgroup image, Row image; do not duplicate images unnecessarily.

Actual selectable materials/finishes remain controlled by ProjectWorkflow Material Library linkage. Manufacturer materialSuggestions are informational Manufacturer Finish Guidance only. Recommend “Extract as Manufacturer Finish Guidance” for finish-code tables, allowable top/leg finishes, or colour guidance unless the pages directly form pricing/category configuration. Do not create another material-selection system.

MULTIPLE BATCHES AND SHARED PAGES
External LLM limits may require multiple coherent batches for one template using + Add More JSON. Batch by commercial source structure, never equal page counts. INCLUDED components do not need a separate accessory extraction unless independently sold. Include REQUIRED SEPARATE ITEM pages in the relevant product extraction/Add More batch. Include OPTIONAL SEPARATE ITEM pages only when verified compatible and useful in the configurator. PREPARED FOR wording alone is not reason to extract the accessory page. UNCONFIRMED remains under Pages to inspect manually. Include a shared accessory page in a Product Template extraction batch only if at least one relevant item on that page has verified applicability. For every template, list MAIN SOURCE PAGES and SHARED / SUPPORTING PAGES, stating whether each is included in extraction, a later Add More JSON batch, Manufacturer Finish Guidance, an independent product, or manual inspection. Good boundaries must also support future Prices Only, Selected Sections, New Item, and Not Found updates.

Return human-readable output only, using exactly this structure:

==================================================
PRODUCT SETUP PLAN
==================================================
Overall recommendation:
- Number of Product Templates: X
- Short explanation

--------------------------------------------
PRODUCT 1 — [Template Name]
--------------------------------------------
Why this should be a separate Product Template:

Main source pages:
- PDF page X / printed catalogue page Y

Shared/supporting pages:
- PDF page X / printed catalogue page Y

Pages to inspect manually:

Recommended ProjectWorkflow setup:
- Base / Model:
- Workstation:
- Category / Matrix:
- Modular:
- Accessories / Configuration:
- Manufacturer Finish Guidance:

Recommended visual subgroups and images:

Accessory / Required Companion strategy:

Component/accessory recommendations:
Component: [description/code]
Affected Product Template:
Commercial status: INCLUDED / PREPARED FOR / REQUIRED SEPARATE ITEM / OPTIONAL SEPARATE ITEM / UNCONFIRMED
Applicability evidence: EXPLICIT / CROSS-REFERENCED / VISUALLY CONFIRMED / UNCONFIRMED
Source: PDF page X / printed catalogue page Y
Evidence: short manufacturer-supported explanation
ProjectWorkflow treatment: No separate item / Information only / Required Companion / Conditional Option / Normal Accessory / Manual Decision
Quantity: only if explicitly supported

Extraction batches:
Batch 1 — [name]
PDF pages:
Printed catalogue pages:
Purpose:
Recommended AI extraction focus:

Batch 2 — [name]
PDF pages:
Printed catalogue pages:
Purpose:
Recommended AI extraction focus:

Important manual decisions:

${focus === "chair_seating" ? `CHAIR / SEATING CONFIGURATION SUMMARY
- Seating subtype:
- Pricing pattern:
- Primary pricing destination:
- Pricing-authoritative structure:
- Pricing grades:
- Actual material/finish guidance:
- Model-defining features:
- Standard equipment:
- Paid alternatives:
- Commercial option statuses:
- Upholstery pricing method:
- Mechanism strategy:
- Base/frame strategy:
- Armrest strategy:
- Castor/glide strategy:
- Applicability/exclusions:
- MOQ/on-request notes:
- Referenced supporting pages:
- Restrictions/manual-review warnings:
- SOURCE VERIFICATION SUMMARY
- Verified critical items:
- Unconfirmed critical items:
- Manual decisions:
` : ""}

Repeat PRODUCT sections as needed.

==================================================
SHARED / COMMON ELEMENT STRATEGY
==================================================
VERIFIED SHARED ACCESSORIES
For each accessory whose compatibility is established, use dual PDF/printed page references and state: Accessory; affected templates; Applicability evidence; Source; Evidence; Configuration strategy (Include locally, Standalone product, Both, or Manual decision); reason; whether it is only Manufacturer Finish Guidance; and any supplier-code ambiguity.

POSSIBLE SHARED ACCESSORIES — MANUAL DECISION
List items that exist in a manufacturer shared section but whose family compatibility is not proven. Do not put their pages into an extraction batch; list them as Pages to inspect manually instead. Do not use blanket duplication wording.

==================================================
EXTRACTION ORDER
==================================================
Provide numbered steps using the real workflow: create template, copy the appropriate extraction prompt, extract Batch 1 using dual PDF/printed page references, import to Smart Setup, use + Add More JSON for later batches, review destinations/rules, apply locally, and save.

${focus === "chair_seating" ? `==================================================
SOURCE VERIFICATION SUMMARY
==================================================
Verified critical items:

Unconfirmed critical items:

` : ""}==================================================
WARNINGS / MANUAL DECISIONS
==================================================
List ambiguous supplier codes, cross-template component risks, unclear required rules, unclear page relationships, potentially huge templates, matrix uncertainties, and material guidance versus actual selectable materials.`;
}
