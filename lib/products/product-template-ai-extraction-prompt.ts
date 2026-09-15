export const extractionPromptFocuses = ["full", "base_model", "workstation", "category_matrix", "modular", "accessories", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"] as const;
export type ExtractionPromptFocus = typeof extractionPromptFocuses[number];

const relatedAccessoriesRule = "Also extract any clearly related accessories, options, companion components, required add-ons, optional add-ons, selection constraints, and applicability information found in the supplied source into optionGroups. Do not ignore them merely because the selected extraction focus is pricing.";

const globalExtractionArchitectureContract = `GLOBAL EXTRACTION ARCHITECTURE DECISION CONTRACT - APPLY BEFORE THE SELECTED FURNITURE FOCUS
First identify the manufacturer-defined commercial/product family and its source boundaries. Extract one clean selected family at a time. Do not absorb nearby unrelated families into the same ProductTemplateDraft unless the user explicitly included them in this extraction batch. For example, a Universal Cabinets batch must not absorb Pedestals, Smart Cabinets, Lockers, or Shared-side Bookcases merely because they are nearby in a Storage chapter.

GLOBAL PRICING ROUTING ORDER
Evaluate every source structure in this order: (1) BASE / MODEL, (2) CATEGORY / MATRIX, (3) MODULAR.
- BASE / MODEL is the default for every authoritative PRIMARY sellable product SKU row with its own supplier code, direct price, dimensions/configuration, and identity. The primary product is what the user would select first, such as a cabinet, pedestal, CPU holder, service unit, desk, chair, sofa, or meeting table. Multiple rows, sizes, finishes, handed variants, or catalogue headings do not justify Matrix or Modular.
- CATEGORY / MATRIX requires a genuine manufacturer-proven commercial category dimension, such as Model row x Fabric Cat A / B / C / D or explicit finish-price classes. An ordinary SKU row x one column labelled "Standard Price" is an invalid one-column fake Matrix and is explicitly forbidden. When each SKU has only one direct price, use pricing.baseModelRows. True Cat A-D prices may use pricing.priceMatrices.
- MODULAR requires source-proven component-built composition, such as terminal/intermediate/end units, sofa modules, workstation compositions, or shared-side bookcases. Ordinary size, finish, LH/RH, open/closed, accessory, and catalogue-layout variation must not trigger pricing.modularGroups. Preserve authoritative terminal/intermediate or other genuine module rows when composition is proven.

AUTHORITATIVE ROW PRESERVATION
Every directly priced source SKU remains a separate authoritative row. Preserve its supplier code, display/model name, dimensions, direct price, currency, specification, handedness/configuration, and source traceability. Never merge distinct supplier codes or replace manufacturer-priced rows with synthetic combinations.

PRIMARY PRODUCTS VERSUS SUPPORTING COMPONENTS
Do not place a separately priced supporting component in pricing.baseModelRows merely because it has its own supplier code and price. A joining ring, finishing top, side panel, handle kit, hinge kit, damper, wall-fixing kit, extra shelf, connecting bracket, cable tray, optional cushion, or feet kit normally belongs in optionGroups / Accessories / Configuration or the supported companion structure. Independently determine whether it is Required Companion, Optional / Normal Accessory, Included, or compatibility only; being a component does not prove it is required. A primary direct-priced component-like product such as a pedestal, CPU holder, or service unit may remain Base / Model when it is itself a complete independently selectable functional product, rather than merely completing, connecting, or customizing another product. For example, 1AG 967 "Joining Ring for Low Smart Cabinets" is a supporting accessory/component, not a Base / Model cabinet row; map applicability only to relevant Low Smart Cabinet rows when the source proves that mapping. Before returning JSON ask: is this row a primary usable/selectable product, or only a component used to complete/connect/customize another product? Route component-only rows to accessory/companion structures.

ROW-LEVEL IMPORTANT REQUIREMENTS
Every priced row supports this explicit contract: { ..., "specification": string | null, "importantRequirements": string[], ... }. Prefer emitting importantRequirements explicitly, including [] when no actionable requirement is supported.

HARD FIELD SEPARATION
specification contains descriptive product facts only: product type, construction, dimensions/configuration facts, handedness, ordinary compatibility, and included equipment. Examples: "Open low cabinet", "Structure depth 35 cm", "4 wooden drawers with soft-close", "Right-hand blind door with lock", "Structure for whole blind doors only", and "Wall fixing kit included".
importantRequirements contains actionable user obligations or restrictions only. Treat source wording such as must, required, mandatory, must be completed with finishing top, complete with when separately required, must be fixed to wall, cannot be used with, must be ordered separately, and required separately as candidates. Examples: "Wall fixing required for 35 cm depth to prevent overturning", "Finishing top required", "Top access required", "Must use terminal unit", "Special order required", and "Not compatible with 175° hinges". Apply this unchanged to Base / Model, Category / Matrix, Modular, Workstation, and accessory/option rows in every furniture focus.
Do not automatically move descriptive or included facts: "Wall fixing kit included" remains specification and must not become "Wall fixing kit required". Ordinary compatibility such as "Structure for whole blind doors only" remains specification unless it is explicitly an actionable restriction. A requirement represented in importantRequirements must not be repeated in specification. Important Requirements do not replace Required Companion enforcement or applicability rules.

CABINET EXAMPLE
BAD: { "specification": "Open low cabinet. Structure depth 35 cm. Must be fixed to wall to prevent overturning. Complete with finishing top (sold separately).", "importantRequirements": [] }
GOOD: { "specification": "Open low cabinet. Structure depth 35 cm.", "importantRequirements": ["Wall fixing required for 35 cm depth to prevent overturning", "Finishing top required"] }

EXHAUSTIVE COMMERCIAL EXTRACTION - NO SAMPLING
Extraction is commercially exhaustive for the supplied scope. Never return a representative sample, representative rows, example models only, selected permutations, sample formatting capacity, "omitted for brevity", "remaining rows follow the same pattern", or any equivalent sampling/summarization. Every source row with its own supplier code, price, or dimensions/configuration is an authoritative commercial row and must remain separate even when it repeats a price, dimensions, family, commercial structure, or description already extracted. This includes later widths/heights, LH/RH variants, depth variants, and "without adjustable shelves" or other seemingly repetitive variants.

OUTPUT-LIMIT PAGE BOUNDARY
If all supplied authoritative rows cannot safely fit in one JSON response, do not silently sample or claim the family is complete. Extract only complete contiguous source pages, stop at a clear page boundary, and add extractionWarning stating exactly which source pages remain and that a supplemental extraction is required; for example: "Extraction complete through printed page 46. Printed pages 47–54 remain and must be extracted in the next supplemental batch." Never stop mid-page solely for output size.

PARENT TEMPLATE IDENTITY ACROSS PARTIAL BATCHES
A page/output-limited partial batch is not a new commercial family or Product Template. Keep template.templateName, commercial family identity, and pricing architecture of the planned/source parent family; represent partial status only in extractionWarnings. For example, a low/medium-cabinet partial batch remains "Universal Cabinets", a later high-cabinet supplemental batch also targets "Universal Cabinets", 120/160 desk rows remain their parent Desk family, and 2/3-seat sofa rows remain their parent Sofa family. Never rename or split the parent template from the extracted subset unless source evidence genuinely proves a separate Product Template.

REFERENCED BUT UNSUPPLIED SUPPORT PAGES
When a supplied core page references a companion/accessory page that is not supplied (for example, "complete with finishing top — see pages 55–57"), preserve the stated requirement/reference, add an extractionWarning that the companion SKU/price is pending supplemental extraction, and do not invent its code, price, or availability.

PAGE TRACEABILITY
Preserve known source page identity for extracted commercial data wherever the ProductTemplateDraft contract permits. At minimum, sources must include meaningful pageNumber values for supplied pages when page numbers are available; do not return only pageNumber: null when source page numbers are known. For a multi-page extraction, sources must contain a distinct meaningful entry for every supplied page that materially contributes pricing rows, option/accessory items, compatibility rules, required/included relationships, or finish guidance; never collapse a multi-page batch to its first page. A single material page may use one source entry. Do not create source entries for unused pages. Each source entry should include documentName, pageNumber, region (or null), and concise rawText such as a section heading when available; never copy an entire page.

CONFIGURATION EVIDENCE
Create Included item, Required Companion, Optional Companion, allowed-item applicability, or mutual exclusion only when manufacturer evidence supports that exact relationship. "Compatible with", "suitable for", "for use with", "for X only", "for whole blind doors only", "for split blind doors", "for glass doors", "can be completed with", and "available with" prove COMPATIBILITY / ALLOWED APPLICABILITY ONLY; they do not make required=true or prove exactly-one selection. Mandatory status needs explicit evidence such as "must be completed with", "mandatory", "required", "order additionally", "cannot be used without", or "always complete with". A sold configuration described as "without shelves", "without doors", "without armrests", "without top-access", or "open cabinet" must never create the omitted component as required. "Must be fixed to wall" or "wall fixing required to prevent overturning" is an installation/safety requirement only: preserve it in row.importantRequirements (or extractionWarning when no row can safely carry it), including depth/height applicability where supported, but do not create a separately priced Required Companion. "Wall fixing kit included" is included in the base SKU and must not be duplicated as an accessory. A Required Companion is valid only when the source explicitly identifies a separate required commercial kit, for example "complete with fixing kit Art. XXX", "fixing kit must be ordered separately", or "required kit Art. XXX". "See fixing kit page X" or "compatible with fixing kit" is reference/compatibility only. If price, inclusion, requirement, compatibility, or applicability is unproven, use null, extractionWarnings, or manual-review wording as the schema permits; do not guess.

SUPPLEMENTAL BATCHES / ADD MORE JSON
The supplied source may be a later batch of components, doors, hardware, accessories, finishes, or other supporting pages. When it is clearly supplemental, extend the existing selected family, preserve existing authoritative rows, add only missing components/applicability, and return supplemental JSON suitable for + Add More JSON. Do not rename or restructure the main family or create a duplicate Product Template merely because this is a new JSON batch. Preserve source codes and identities so existing merge logic can detect duplicates.

FINISH VERSUS PRICE
Finish pages with codes, colours, or availability but no explicit price difference normally produce materialSuggestions, Manufacturer Finish Guidance, or option metadata - not pricing rows. Create a pricing Matrix only when the source explicitly proves category-based price variation.

GLOBAL EXTRACTION SELF-CHECK - CORRECT BEFORE RETURNING JSON
Verify that no direct-priced SKU was put in Matrix; no one-column "Standard Price" Matrix was created; no Modular structure was invented; no distinct supplier codes were merged; compatibility did not create Required Companion; "without X" did not make X required; no unrelated manufacturer family was included; no missing price was invented; finish codes did not become pricing without evidence; and a supplemental batch preserved the existing family. For every priced row, verify that actionable language such as must, required, mandatory, or cannot belongs in importantRequirements when it expresses an obligation/restriction; importantRequirements is present for every such supported requirement; no requirement is duplicated in specification; and included facts or ordinary compatibility were not moved incorrectly. Also verify every supplier-coded priced row in the supplied scope was extracted; no representative/sample/briefness language or behavior was used; no repetitive-looking row was omitted; any output-size stop is at a page boundary with exact remaining pages declared; a partial batch did not rename or split its parent template; referenced but unsupplied companion data was not invented; known source page numbers are present in sources; and every material source page, including supplemental pages, has a distinct sources entry with a known page number.`;

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
  storage_cabinets: `EXTRACTION FOCUS: Storage / Cabinets / Credenzas
Extract only source-supported cabinets, credenzas, pedestals, service units, lateral storage, lockers, carcasses, doors, tops, shelves, locks, hardware, and storage accessories. Ignore unrelated desks, workstations, seating, tables, and furniture.

DIRECT PRICING AND ROW IDENTITY
Use pricing.baseModelRows for every authoritative directly priced complete SKU and directly priced carcass: open cabinet, blind-door cabinet, drawer/file-drawer cabinet, pedestal, mobile pedestal, credenza, service unit, lateral storage, sliding-door cabinet, or carcass. Preserve exact source code, display name, dimensions with raw text/unit, price, source wording, and compatibility text. Do not synthesize combined cabinet SKUs. Each code, price, dimension, or LH/RH/SX/DX/Left/Right difference is a separate authoritative row. Do not infer reversibility. Ordinary cabinet size variation is never Modular. A sold "without adjustable shelves", "without shelves", "without doors", or open-cabinet SKU is a valid authoritative configuration; never create missing shelves or doors as required components.

COMPATIBILITY, REQUIREMENTS, AND INCLUDED ITEMS
"For whole blind doors only", "for split blind doors", "for glass doors", "suitable for", "compatible with", "can be completed with", "available with", and "shown with" prove allowed compatibility only. They do not prove Required Companion, required option, or exactly-one selection. Create a required relationship only for explicit mandatory completion evidence. If compatibility is clear but requirement is not, preserve narrow applicability in option metadata/specification and add extractionWarning when needed. Explicitly included components belong in the row specification and must not be duplicated as required accessories. Separately priced/coded doors, shelves, drawers, file drawers, handles, 175-degree hinges, dampers, keyed-alike cylinders, locks, and internals belong in optionGroups only with source-backed code, price, and narrow carcass/width/depth/height applicability. Preserve source incompatibilities as applicability or warning; do not invent mutually-exclusive logic.

TOPS, WALL FIXING, LOCKS, AND FINISHES
Distinguish finishing top INCLUDED, REQUIRED SEPARATE, OPTIONAL SEPARATE, NOT REQUIRED, and compatibility/reference only. "Complete with finishing top" plus a separate code/price may be Required Companion; "can also be used without finishing top" is not required. A mandatory wall-fixing instruction is a safety/configuration fact, not a priced companion unless a specific separate kit is identified. An included wall-fixing kit remains specification only; a separately coded mandatory kit may be Required Companion. Lock choices may be options; use required-exactly-one only where source explicitly requires a lock choice. Keep carcass, front/door, metal, glass, and handle finishes distinct. Finish codes sharing one price are materialSuggestions/option metadata, not pricing.priceMatrices. Use pricing.priceMatrices only for genuine row-by-category commercial pricing, such as a fabric-category priced cushion.

MODULAR AND FINAL SAFETY
Use pricing.modularGroups only for manufacturer-proven component-built composition, such as explicit start/intermediate/end shared-side storage systems. Do not route ordinary cabinets, carcasses, doors, shelves, or size variants to Modular. If structural composition rules are unclear, extract authoritative priced rows and add extractionWarning rather than inventing constraints. Bind every code to its own supplied price; use null for missing/unknown price, never infer adjacent prices. Before returning JSON verify Base/Model routing for direct rows, separate handed variants, structured/raw dimensions, conservative required evidence, included-kit non-duplication, finish-versus-price separation, narrow applicability, and warnings for ambiguous door/top/wall-kit/compatibility/composition evidence. ${relatedAccessoriesRule}`,
  meeting_conference: `EXTRACTION FOCUS: Meeting / Conference Tables
Extract only meeting, conference, boardroom, terminal/end, intermediate/central, extendable, multi-section, and genuinely related cable-management or structural table items. Ignore desks, executive desks, workstations, bench desks, coffee/side tables, storage, pedestals, unrelated cabinets, seating, screens, reception products, and unrelated furniture.

MIXED-PAGE CLASSIFICATION â€” HIGH PRIORITY
Do not exclude an entire page because it contains unrelated product sections. Classify every visible section, table, and row independently; page-level proximity never overrides an explicit rendered heading. Ignore Bench rows when Bench is outside this Meeting scope, but extract every supported row under explicit Meeting Tables, Double/Triple Meeting Tables, Double Meeting Table Configuration, Conference Tables, Boardroom Tables, or Extensions for Meeting Tables headings. A Meeting-scope row is included unless another explicit rule excludes it, even when Bench, Workstation, Desk, Storage, or Executive Desk sections share that page. If a code repeats under Bench and Meeting headings, extract the authoritative Meeting row once; reconcile by code + dimensions + price + commercial identity. Do not silently merge conflicting duplicate evidence: add extractionWarning/manual review when the apparent same SKU has different price or dimensions.

PRICING DESTINATION
Complete direct-priced meeting-table SKUs with their own code, dimensions, price, top-access state, or top/leg construction variant belong in pricing.baseModelRows. Do not route complete independent tables to Modular merely because several sizes exist. Use pricing.modularGroups only where source explicitly defines independently priced terminal/end plus intermediate/central composition units; preserve terminal and intermediate rows as distinct authoritative rows with exact code, dimensions, price, top-access state, leg/base structure, and source order.

SOURCE-DEFINED COMPOSITION FAMILY — HIGH PRIORITY
When manufacturer evidence defines terminal/end and intermediate/central rows as one extendable composition system, keep ALL authoritative rows in that system in pricing.modularGroups. This includes terminal rows usable alone, terminal-only leg styles, top-access variants, and rows resembling standalone tables. Never split one proven composition family across pricing.priceMatrices, pricing.baseModelRows, and pricing.modularGroups merely because variants differ in leg style, top access, depth, price, or visual presentation. Use source-backed Modular groups for commercially useful organization; use source wording for bridge leg, gantry, trestle, or central leg only when explicit, otherwise retain a cautious commercial distinction.

TOP ACCESS AND CABLE MANAGEMENT — HIGH PRIORITY
Separately coded/priced with/without-top-access SKUs are separate authoritative Base / Model or Modular rows, never a generic option. If source explicitly states a table SKU is with top access and cable tray, record the cable tray as INCLUDED in that row specification and do not create a separate required accessory. “Prepared for” or “suitable for” does not mean included hardware. Preserve source-supported tray, grommet, wire-manager, and electrification items with exact size-specific applicability; never apply a tray to an incompatible row.

REQUIRED ACCESSORY EVIDENCE — HIGH PRIORITY
“See Art. X”, “refer to Art. X”, “for X see Art. Y”, “can use X”, “compatible with X”, “available with X”, or “suitable for X” alone does not prove Required Companion. Use Required Companion only for explicit mandatory wording: required, mandatory, must use, must be completed with, complete with, must be ordered with, or required separate item. Otherwise preserve a clearly related item as optional/related where appropriate or add extractionWarning; never infer a requirement from proximity or commercial usefulness.

COMPONENT-BUILT LIMITS
Extract source-supported tops, beams, legs, gantries, and cable trays accurately. When structural quantities depend on composition, such as 2 tops → 4 beams, terminal/central leg counts, or tray counts, do not invent automatic companion quantities: add extractionWarning: “Manual Review — structural component quantities depend on selected table composition and cannot be derived automatically by ProductTemplateDraft v1.” If structural alternatives require exactly one type at quantity above one, preserve alternatives and add extractionWarning rather than faking the rule. Prefer a complete authoritative SKU when it already represents the sellable composition.

ROW, PRICE, DIMENSION, AND FINISH FIDELITY
Bind every row’s exact source code, name, dimensions, direct price, currency, configuration identity, top-access state, and any finish-dependent price. Follow rendered table geometry; do not shift adjacent code/price/dimension cells. Use structured dimensions plus rawText; normalize units only when safe and do not repeat routine dimensions in specification. Preserve explicit zero, blank null, and exact visible currency; never default to AED. Genuine finish price columns remain pricing structure; non-priced top, leg, frame, or cable-tray finish codes belong in materialSuggestions. Do not invent material-to-price mappings.

COMPLETENESS AND FINAL GATE
Include every supported in-scope row; do not truncate repetitive size, intermediate, or related optional cable-management rows. For every supplied page, inspect every visible product-section heading and confirm all Meeting/Conference sections and supported rows were extracted even when unrelated sections share the page. Use extractionWarnings only for real source/schema limitations, unclear requirement status, uncertain currency, ambiguous geometry, or conflicting duplicate SKU evidence. Before returning JSON verify correct Base / Model versus Modular routing, separate terminal/intermediate and top-access rows, included components not duplicated as required, required evidence, exact code/dimension/price binding, warnings for unsupported quantity formulas/structural alternatives, and finish guidance separated from price columns. ${relatedAccessoriesRule}`,
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
  sofa_lounge: `EXTRACTION FOCUS: Sofas / Lounge / Armchairs

OUTPUT AND FAMILY SCOPE
Return exactly one valid ProductTemplateDraft v1 JSON object with no prose outside JSON. Extract the selected lounge family: lounge armchairs/chairs; 1/2/3-seat and corner sofas; chaise longues; modular lounge seating; left/right/centre/corner/open/one-arm elements; poufs, ottomans, footrests, and seating stools; commercially integral cushions; lounge-specific feet/base kits/connectors; and source-supported lounge accessories. ${relatedAccessoriesRule}

Classify by commercial typology, not the word "armchair" alone. Exclude task/visitor/conference chairs, Workstations, unrelated office benches, screens/walls, pods/booths, desks, meeting tables, standalone occasional tables, storage, and unrelated accessories. Extract every supported in-scope row in the selected family exactly once, including repetitive rows; never sample, summarize, or truncate rows.

PRICING STRUCTURE DECISION — HIGH PRIORITY
Apply this decision tree before extracting rows:
1. If Sales can build one composition by selecting quantities of multiple compatible rows, use pricing.modularGroups.
2. Otherwise, if rows × upholstery/material price categories form the commercial structure, use pricing.priceMatrices.
3. Otherwise, if each row has one direct price, use pricing.baseModelRows.

A genuine configurable composition remains Modular when complete sofas are present, all rows share an upholstery matrix, or the manufacturer displays one consolidated table. Do not flatten those rows into pricing.priceMatrices, pricing.baseModelRows, or accessories. Non-modular sofas and lounge armchairs with genuine category pricing remain priceMatrices; directly priced non-matrix variants remain baseModelRows.

SHARED FABRIC / LEATHER PRICE BUCKET — HIGH PRIORITY
For multi-level Fabric/Leather headers, trust rendered physical column alignment first. If one physical source position is explicitly shared by category labels under different material-family headers, preserve BOTH logical categories with the exact value from that shared bucket and keep preceding/following categories separate. Never merge with, copy from, or drop an adjacent/final category merely to match physical-column count. A shared alias must trace to its exact physical source bucket. Example principle: if Fabric Cat. I and Leather Cat. Extra align to bucket X, both use X; Leather Cat. Super and Leather Cat. Lusso remain in their own physical buckets.

MODULAR GROUPING — HIGH PRIORITY
If a modular family contains distinct commercial item types such as sofas, side elements, centre elements, corner/chaise elements, poufs, or cushions, preserve them as separate source-backed pricing.modularGroups when pricing columns are compatible. Do not return one generic modular group unless the source itself is genuinely one undifferentiated group.

Group labels follow source typology. Complete 1/2/3-seat sofas may remain in suitable Modular groups alongside modules when they share the commercial family and compatible upholstery columns. Grouping is organizational only: each row remains pricing-authoritative and appears once. Do not duplicate or omit rows. Compatible groups reuse the same category IDs and meanings; if their column structures conflict, preserve only the schema-safe source structure and add an extractionWarning rather than inventing merged columns.

UPHOLSTERY AND PHYSICAL HEADER GEOMETRY
Determine physical numeric/null/on-request price positions from rendered rows, vertical boundaries, and merged-header geometry before deriving logical category meanings. Bind in this order: physical source position → parent material family/header → source-supported leaf meaning → logical category. Rendered geometry overrides linear OCR order; never shift prices to make header-token counts fit.

Normally one physical price bucket maps to one logical category. One bucket may map to multiple qualified logical categories only when the rendered multi-level header explicitly proves the relationship. For example, non-exhaustively, "Fabric Cat. I" and "Leather Cat. Extra" may share one proven bucket. Preserve EVERY proven qualified category, even when logical category count exceeds physical price-position count; never drop an alias merely to force those counts to match. Give aliases distinct qualified labels and the exact same value from that physical position. Verify physical position, material-family meaning, logical label, and value together. Never infer an alias from OCR, proximity, a similar price, or an adjacent/terminal bucket; ambiguity means no guess plus a concise extractionWarning.

Customer Material/COM is a valid logical pricing category only when a dedicated physical position or an explicit shared-bucket meaning is visibly established. A surcharge note or material instruction alone does not prove a price column. Never add a synthetic null column to reconcile header text with price-position count; null requires a real dedicated blank/on-request position. Preserve exact source category order and do not invent continuous ranges.

Verify at least the first, a middle, and the final relevant priced row against the rendered table. Each logical category must trace to its physical source position, and all aliases of one position must reuse that position's verified value. If representative mappings disagree, leave uncertain cells null and warn rather than preserving a guessed shift.

REQUIRED AND OPTIONAL COMPONENTS
Keep INCLUDED, PREPARED FOR, REQUIRED SEPARATE ITEM, OPTIONAL SEPARATE ITEM, and UNCONFIRMED distinct. Explicit "always complete with", "must be completed with", "required", or equivalent evidence preserves a separately priced feet kit, connector, base/support kit, or other component as required; never absorb its price into the sofa or downgrade it to optional. Preserve source-backed applicability and quantity evidence so Review & Route can target the correct Modular rows.

Cushions, castor kits, connectors, electrification, mounted tables, power kits, and finish upgrades are options only with source-supported identity, pricing, and applicability. Do not assume collection-wide compatibility. Fixed accessory quantity does NOT automatically multiply by selected Modular-row quantity. When required quantity depends on selected module quantity, preserve the rule and add: "Manual Review — required accessory quantity depends on selected modular-row quantity."

SPECIFICATION AND DIMENSIONS
Write concise, professional English row specifications that add commercially useful, row-specific facts beyond displayName. When the physical product/configuration identity is known, specification must state that identity and may add useful source-supported technical facts; do not return consumption or other measurements alone. Technical pages may enrich a row only when applicability is clear. Do not routinely repeat supplier/reference code, price, currency, pricing category, or W/D/H. Keep dimensions in row.dimensions and rawText; a useful size may remain in displayName, such as "Sofa 200 cm" or "Cushion 45×45 cm".

Style-only examples include "Complete upholstered lounge sofa", "Modular side element", "High-back lounge armchair with swivel aluminium base", and "Feather cushion". Use only source-supported facts and never invent construction details.

MATERIALS AND FINISHES
Commercial price grades remain pricing columns. Only actual source-named fabrics, leathers, finishes, colours, and finish codes belong in materialSuggestions / Manufacturer Finish Guidance. Do not convert category labels into Material Library materials or invent a material-to-price-category mapping. Customer Material remains a pricing category only with the physical source evidence defined above.

SOFA-SPECIFIC SOURCE SAFETY
Preserve Left/Right, LH/RH, and SX/DX orientation exactly; create separate rows only when source codes/evidence support them. Keep separately coded/priced fixed/swivel, high/low-back, base, and mechanism variants as model or matrix rows rather than accessories. Category-priced cushions, poufs, ottomans, and footrests remain pricing-authoritative Modular or Matrix rows when their commercial structure supports it; do not flatten them into single-price accessories.

A source-defined composition table remains Modular; a module-mounted table may be an option; a standalone occasional table is outside this focus. A relative/formula surcharge that v1 cannot calculate, including a percentage of another or Customer Material price, remains extractionWarnings/manual-review evidence: do not create a selectable null-price option or invent fixed money. Explicit fixed-money surcharges remain normal source-supported option items.

FINAL SOFA / LOUNGE GATE — DO NOT RETURN UNTIL ALL PASS
Before returning JSON verify only these highest-risk outcomes: (1) valid ProductTemplateDraft v1 JSON only; (2) correct Modular versus Matrix versus Base/Model destination; (3) source-backed Modular groups preserved; (4) exact physical price/category/value binding with no shifted or invented categories/prices; (5) required and optional components remain commercially correct; (6) dimensions remain separate and are not routinely repeated in specification; (7) every supported in-scope row appears exactly once; and (8) no Sofa-specific source fact, relationship, or rule was invented.`,
};

export function getProductTemplateAiExtractionPrompt(focus: ExtractionPromptFocus = "full") {
  return `You are extracting structured furniture product data from manufacturer source material.

Analyze only the manufacturer screenshot, PDF, image, or other source material supplied in this conversation. Use existing ProjectWorkflow context only as supporting context; never let ProjectWorkflow context override the manufacturer source.

Your task is to return exactly one valid ProductTemplateDraft v1 JSON object.

${globalExtractionArchitectureContract}

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

MATRIX CELL AVAILABILITY

For every priceMatrix or modular matrix row: numeric source price -> numeric price; expected category with genuinely missing/unclear source price -> null only; category explicitly proven unavailable/not offered for that row -> null plus that matrix column ID in unavailableCategoryIds. Use unavailableCategoryIds only when rendered source structure or explicit wording proves non-applicability: a category exists for sibling rows but is structurally absent for this row type, the source says unavailable/not available/not applicable, or a source block provides only the applicable price type while another is explicitly tied to a different construction/variant. Never infer N/A from every blank, poor scan/OCR, or uncertain extraction.

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

For modularGroups preserve Modular Group -> Module Rows -> Matrix Columns -> Price Cells. Never flatten separate modular groups into one generic matrix. Preserve the manufacturer's module hierarchy and group order. Use a row's unavailableCategoryIds only when the source clearly proves that row/category is not offered; a null price alone remains unknown/missing and must not be inferred as unavailable.

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

sources contain only supported user-provided source metadata. Do not invent internal ProjectWorkflow IDs, database IDs, URLs, manufacturer webpage URLs, document IDs, file IDs, or page numbers not actually known. When supplied source pages have known page numbers, include meaningful pageNumber values for every page that materially contributed extracted commercial data; pageNumber: null alone is invalid in that case, and one first-page entry cannot stand in for a multi-page extraction or supplemental batch. Do not add fake entries for unused pages. Include documentName, region/null, and concise source heading/rawText where available. If no reliable source metadata is available, sources = [].

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
The shape above is a field contract, not required sample content. Retain every current ProductTemplateDraft v1 nested field and row shape exactly as encoded by the software schema. Do not change, remove, or rename fields, and do not add fields beyond documented contract fields such as unavailableCategoryIds. Do not include placeholder rows merely because schema examples exist. If a collection has no supported data, return an empty array. Every included item, row, column, group, matrix, material suggestion, linked family suggestion, and source must have a valid non-empty ID.

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

export const productTemplateSetupPlanningFocuses = ["general", "chair_seating", "desk_executive", "sofa_lounge", "meeting_conference", "storage_cabinets"] as const;
export type ProductTemplateSetupPlanningFocus = typeof productTemplateSetupPlanningFocuses[number];

const globalPlanningArchitectureContract = `GLOBAL PLANNING ARCHITECTURE DECISION CONTRACT - APPLY BEFORE THE FURNITURE-SPECIFIC FOCUS
First understand the manufacturer's catalogue architecture. Identify manufacturer-defined commercial/product families before proposing Product Templates, and separate genuinely different systems even when they share a chapter. For example, Universal Cabinets, Pedestals, Service Units, Smart Cabinets, Lockers, and Shared-side Bookcases are not automatically one Storage family; Executive Desks, Operative Desks, Workstations, Meeting Tables, and Credenzas are not automatically one Desk family.

PLAN ONE CLEAN FAMILY AT A TIME
Recommend exactly which source pages belong together for each logical extraction batch and why. Identify the manufacturer section/family, precise printed catalogue pages, PDF pages where known, purpose, and whether to include now or handle separately. Separate main/core product pages from supporting components and doors/hardware. Do not merely recommend one broad page span when source evidence permits meaningful batches. Use dual PDF/printed numbering and exact ranges when available; never guess missing numbering.

FAMILY / EXTRACTION ROADMAP - MANDATORY
Before detailed PRODUCT sections, always output this compact table, including when the supplied source contains only one commercial family:
| Family | Printed pages | PDF pages | Recommended setup | Extract separately? | Priority |
| --- | ---: | ---: | --- | --- | --- |
Use one row per true commercial family, not per page heading, size, handedness, finish, accessory, or component page. Attach tops, shelves, doors, handles, hinges, and other supporting pages to their parent family unless the manufacturer treats them as an independent commercial family. Populate Printed pages and PDF pages from source evidence; write "Unavailable" in either column when its numbering system is unavailable. Recommended setup must be one of: Base / Model; Category / Matrix; Modular; Base / Model + companions; Base / Model + options; Modular + companions. Extract separately? must be Yes, No, or "Can combine with <family>". Priority must be BEST FIRST TEST, Current, Next, or Later. When multiple families exist, choose only one BEST FIRST TEST based on strongest complete evidence, architectural usefulness, manageable extraction size, and representative complexity; do not automatically choose the first PDF family. Do not replace the table with prose, omit it because detailed Product sections follow, or collapse unrelated families into one broad page span.

LAS STORAGE FAMILY CHECK
When those distinct manufacturer families are present, roadmap rows must keep Pedestals, Service Units, Lateral Storage, Nomadi, Smart Cabinets, Universal Cabinets, Lockers, and Shared-Side Bookcases separate. Universal Cabinets may be BEST FIRST TEST when its source evidence is the strongest complete, representative, manageable family; do not infer this without evidence.

FEWEST SAFE PRODUCT TEMPLATES
Prefer the FEWEST Product Templates that preserve authoritative pricing, configuration logic, commercial identity, and compatibility safety. A catalogue subsection or heading alone does not justify a Product Template. Do not split merely because dimensions, shelves, handedness, finish, headings, "without shelves", or "with doors" differ. Split only for a real architecture boundary: complete direct-priced product versus configurable carcass, genuinely different pricing mechanism, fundamentally different composition logic, different Product Library configuration workflow, or unrelated commercial family.

GLOBAL PRICING DECISION ORDER
Always evaluate (1) BASE / MODEL, then (2) CATEGORY / MATRIX, then (3) MODULAR.
- BASE / MODEL: default for authoritative commercial SKUs with their own supplier code, direct price, and dimensions/configuration. Multiple direct-priced rows do not justify Matrix.
- CATEGORY / MATRIX: only for a genuine manufacturer-proven row-by-category price dimension, such as Model x Fabric Cat A / B / C / D or explicit finish-price classes. Many SKUs, many finishes, a visual grid, or one "Standard Price" column do not justify Matrix.
- MODULAR: only for proven component-built composition such as terminal/intermediate/end units, sofa modules, workstation compositions, or shared-side bookcases. Normal size, finish, handed, open/closed, and accessory variation is not Modular.
A row with its own supplier code and direct price is commercially authoritative; preserve it rather than replacing it with synthetic combinations.

CONFIGURATION AND FINISH EVIDENCE
Keep INCLUDED, REQUIRED SEPARATE, OPTIONAL SEPARATE, COMPATIBLE ONLY, ADVISORY / INSTALLATION REQUIREMENT, and UNCONFIRMED distinct. "Compatible with", "suitable for", "for use with", "for X only", "for whole blind doors only", "for split blind doors", "for glass doors", "can be completed with", and "available with" establish compatibility / allowed applicability only, never a requirement or exactly-one rule. Required status needs explicit mandatory evidence such as "must be completed with" or "always complete with"; otherwise use Manual Decision / Warning. "Without shelves", "without doors", "without armrests", "without top-access", and "open cabinet" are valid sold configurations and never imply that the omitted component must be purchased. Treat "must be fixed to wall" or "wall fixing required to prevent overturning" as an installation/safety requirement in specification or warning, not a separately priced Required Companion; retain depth/height applicability where supported. "Wall fixing kit included" is INCLUDED in the base SKU and must not be duplicated. Only an explicit separate commercial kit, such as "complete with fixing kit Art. XXX", "fixing kit must be ordered separately", or "required kit Art. XXX", can be Required Companion. A fixing-kit page reference or compatibility wording alone is not required. Multiple finish codes at the same price belong in Finish Guidance/options; only explicit finish/category price differences justify Matrix.

UNRELATED FAMILIES
Actively identify nearby manufacturer families that must be handled separately. Put them under SEPARATE LATER with their printed/PDF page ranges when known and a short reason; do not mix them into the current extraction batch.

GLOBAL PLANNING SELF-CHECK - CORRECT THE PLAN BEFORE RETURNING
Check: Did I create Matrix where Base / Model is sufficient? Did I create Modular without real composition? Did headings alone split templates? Did compatibility become requirement? Did "without" create a missing required component? Did I mix unrelated families? Did I provide usable source page ranges and batches? Could fewer templates preserve the same commercial truth? Did I include FAMILY / EXTRACTION ROADMAP before PRODUCT sections, represent every detected commercial family, provide printed/PDF page columns, recommended setup, extract-separately guidance, and priority, choose at most one BEST FIRST TEST, and avoid a broad range covering unrelated families?

GLOBAL PLANNING OUTPUT CONTRACT
Return direct, practical output without catalogue prose. This global structure takes precedence over any narrower category output wording when they conflict:
PAGE NUMBERING NOTE
PRODUCT SETUP PLAN
Overall:
- Product Templates: X
- Families: [short list]
- Main reason: [one sentence]
FAMILY / EXTRACTION ROADMAP
| Family | Printed pages | PDF pages | Recommended setup | Extract separately? | Priority |
| --- | ---: | ---: | --- | --- | --- |
PRODUCT 1 - [Template Name]
- Primary setup: [Base / Model | Category / Matrix | Modular]
- Configuration: [one sentence]
- Required Components: [summary or None]
- Optional Components: [summary or None]
- Finish Guidance: [summary or None]
- Extraction pages: [core family pages and supporting pages as separate compact dual-numbered references; never one broad range spanning unrelated families]
- Manual Decision: [issue or None]
Repeat PRODUCT sections only for genuinely separate templates.
SOURCE / EXTRACTION BATCHES
| Batch | Section | Printed pages | PDF pages | Purpose |
SEPARATE LATER
- [Other manufacturer families and page ranges excluded from this extraction]
IGNORED
- [Commercially irrelevant source material or None]
WARNINGS
- [Critical unresolved warning or None]`;

const planningFocusInstructions: Record<ProductTemplateSetupPlanningFocus, string> = {
  general: "",
  storage_cabinets: `STORAGE / CABINETS / CREDENZAS PLANNING FOCUS
Plan cabinets, credenzas, pedestals, service units, lateral storage, lockers, doors, tops, internals, and related configuration from manufacturer evidence only. Ignore unrelated desks, workstations, seating, tables, and other furniture unless explicitly required by the storage system.

PRIMARY PRICING DESTINATION
Route complete direct-priced cabinet, open cabinet, door cabinet, drawer cabinet, credenza, pedestal, service unit, or sliding-door SKU with an authoritative supplier code to Base / Model. Preserve exact code, dimensions, handedness, and price. Width, depth, or height variation alone is Base / Model, not Modular. Use Category / Matrix only where the manufacturer explicitly shows genuine commercial category or finish pricing; finish codes or multiple finishes alone are Manufacturer Finish Guidance, not Matrix. Use Modular only when the source proves independently selectable component-built compositions. Do not force ordinary cabinet variants into Modular.

TEMPLATE BOUNDARIES
Prefer the fewest Product Templates that preserve pricing authority, compatibility safety, and configuration clarity. Do not create a new template merely because shelves are omitted, internal shelf structure differs, a subsection has a separate heading, or a cabinet is sold without adjustable shelves. Keep same-family, same Base / Model, same finish-logic, and same compatibility-architecture variants together using visual subgroups or variants. Split only for a meaningful structural/configuration boundary: complete direct-priced products versus configurable carcasses, genuinely different pricing engine, incompatible option/companion architecture, distinct composition logic, or materially different Product Library workflow. Do not split merely for catalogue organization.

CONFIGURATION EVIDENCE
Keep explicit LH/RH/SX/DX source SKUs as separate authoritative variants. Identify carcass-only, blind-door, glass-door, split-door, sliding-door, drawer, shelf, file-drawer, top, side-panel, back-panel, wall-fixing, lock, handle, and internal-accessory evidence. Compatibility wording such as "for whole blind doors only" or "for split blind doors and all types glass doors" proves compatible door types only; it does not prove a door is mandatory. Separately classify compatible door types, required door selection, optional door selection, and included door. Use Required Companion only when the source explicitly requires completion or clearly proves an incomplete carcass cannot be validly sold/used without the separate door. If ambiguous, report compatibility and use Manual Decision / Warning. Never invent combinations or required companions. Treat a complete open cabinet as a complete product unless the source explicitly requires completion.

STATUS AND FINISH RULES
For finishing tops, wall-fixing kits, shelves, drawers, file drawers, locks, and internal accessories distinguish INCLUDED, REQUIRED SEPARATE, OPTIONAL, mandatory installation instruction, advisory-only text, and UNCONFIRMED. A safety note alone does not create an accessory row. Do not make a finishing top required unless manufacturer wording establishes it. Detect mechanical, combination, or electronic lock choices, but recommend an exactly-one requirement only when the source clearly requires a lock selection. Preserve width/depth/height/carcass applicability for separately priced components.

SHARED-SIDE BOOKCASES
Treat shared-side bookcases cautiously. State whether the source proves complete direct-priced units or a genuine start/intermediate/end composition. Recommend Modular only for proven component-built composition. If safe structural selection cannot be represented, use Manual Decision / Warning; do not invent start/end rules.

FINAL STORAGE SOURCE GATE
Before returning PRODUCT SETUP PLAN, verify exact code, description, price, dimensions, handedness, component status, compatibility, and source page binding. Confirm the fewest coherent templates were chosen; without-shelves/internal-structure variants were not split without a real configuration boundary; direct-priced cabinets remain Base / Model; simple size variants were not made Modular; compatible doors were not made Required Companions without explicit mandatory evidence; complete open cabinets remain complete where supported; finish guidance was not converted to Matrix without commercial pricing evidence; and shared-side bookcases were not forced into Modular. Return only unresolved critical issues under Manual Decision or WARNINGS. Source fidelity is more important than completeness.`,
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

For beam seating inspect seat count, beam/table combinations, supports/legs and linking; explicit required legs/supports may be local Required Companion/required exactly-one only when explicit. For training inspect writing tablet, anti-panic, linking, wheels/sled, stacking and exact applicability. For lounge/outdoor distinguish dining chair, armchair, lounge, rocker, bench, pouf and cushions by sensible quotation configuration; cushions can be local or standalone based on source. For counter/stools inspect higher dimensions, footring and glides. Preserve composite-code patterns without generating theoretical combinations. Put MOQ, on-request, stackability, outdoor suitability and relevant technical notes into warning/specification guidance. Keep genuinely simple seating products simple.`,
  desk_executive: `DESKS / EXECUTIVE DESKS PLANNING FOCUS
Use this focus only for standard, executive, and managerial desks. Analyze direct-priced desk models; width, depth, and finish/material variants; LH/RH and SX/DX variants; returns/extensions; desk-linked service/support units, credenzas, and pedestals where source-proven; top-access; modesty panels; cable management; and required, included, or optional desk components.

DESK SCOPE AND TEMPLATE STRUCTURE
Strongly prefer ONE Product Template for one manufacturer desk family or collection when Sales configuration remains understandable; never create one template per SKU. Do not split merely because of different top material; standard versus ceramic top; 3D-Foil or eco-leather inserts; LH/RH or SX/DX orientation; with-hole/without-hole variants; full-leg versus short-leg/service-unit variants; different widths/depths; return/extension variants; or different finish families. These normally remain inside one coherent Product Template as Base / Model rows, Visual Subgroups, Accessories / Configuration, and Manufacturer Finish Guidance. Do not split merely to reduce row count or because one template becomes large. Do not place Workstations in a Desk template.

VISUAL SUBGROUPS BEFORE TEMPLATE SPLITTING
Before creating another Product Template, ask whether the distinction can be represented as a Visual Subgroup such as Standard, Ceramic, 3D-Foil, Eco-Leather, Rectangular / L-shaped, or Left / Right when useful. Visual Subgroups are organizational only; Base / Model rows remain pricing-authoritative. Material or construction differences are often better Visual Subgroup boundaries than Product Template boundaries. Different melamine, veneer, ceramic, glass, 3D-Foil, eco-leather insert, or equivalent constructions do not automatically justify separate Product Templates when they share the same manufacturer family, Sales use, configuration flow, compatible accessory logic, and a pricing destination that cleanly represents the models.

HANDEDNESS AND SERVICE-UNIT COHERENCE
LH/RH, SX/DX, left/right return, and left/right service-unit orientation must not by themselves cause separate Product Templates; preserve them as Base / Model rows unless the manufacturer defines completely different product families. Do not split desk-for-service-unit variants merely because they require a Required Companion: keep them in the same Desk template when applicability rules can target the relevant Base / Model rows.

REAL DESK TEMPLATE BOUNDARIES
Recommend separate Desk Product Templates only for a genuine source-supported commercial/configuration boundary: a different manufacturer family/collection, substantially different product typology, completely different pricing/configuration architecture, a fundamentally different primary pricing destination, a Sales configuration that would otherwise be confusing, or ranges the source presents as commercially independent. A single executive-desk family with standard and ceramic tops, asymmetric material inserts, handed variants, service-unit-support variants, and top-access variants should normally remain ONE Product Template when all are direct-priced Base / Model rows with coherent accessory/configuration logic; organize its construction/material families with Visual Subgroups.

WORKSTATION AND OTHER FAMILY EXCLUSION
Do not analyze Workstations, Bench systems, multi-user 2-person/4-person/6-person systems, or starter/add-on bench modules in detail. Mention only: "Ignored — separate Workstation product-family cycle." Never include their pages in Desk extraction batches and never recommend Workstation Pricing in the Desk Planning result. Ignore standalone storage cabinets, bookcases, lockers, meeting/conference tables, coffee/side tables, unrelated accessories, and other furniture families; mention them briefly under IGNORED only if useful and do not create Desk-cycle Product Templates for them. A service unit or cabinet is not automatically standalone: analyze it when the source explicitly shows the desk requires it, is supported by it, is designed for it, includes it, or must be completed with it.

DESK MODEL AND DESTINATION CLASSIFICATION
Classify source-supported differences as Base / Model rows, a genuine Category / Matrix, Accessories / Configuration, Required Companion, included component, Manufacturer Finish Guidance, or out-of-scope item. Direct-priced desk sizes/models normally use Base / Model. Do not force visual variations into accessories or material differences into a matrix. Category / Matrix requires genuine row × category pricing. Do not create Material Library records. Distinguish Manufacturer Finish Guidance from direct-priced material/model variants and genuine matrix pricing.

EXACT CODES, DIMENSIONS, AND HANDEDNESS
Bind width, depth, height, overall configuration dimensions, and return/service-unit dimensions to the exact manufacturer code; never derive missing dimensions mathematically. Preserve LH/RH, SX/DX, left/right return, left/right service unit, and left/right support panel exactly. Preserve separate manufacturer codes as separate variants. If the source says reversible, do not invent left/right codes.

RETURNS, SERVICE UNITS, AND SUPPORTS
Classify every return/extension as part of a complete direct-priced desk model, Required Companion, optional accessory, or support component using source evidence only. Classify service/support units explicitly as included in the desk price, required separately priced, optional desk-linked, or freestanding/standalone. Do not confuse freestanding service units with desk supports. Use source mappings and diagrams to verify valid support-unit codes; images alone do not prove compatibility.

TOP ACCESS, MODESTY PANELS, AND CABLE MANAGEMENT
Distinguish no hole/preparation, prepared for top access, top access included, separately purchased, required, and optional. Preserve explicit "always complete with" semantics. PREPARED FOR ≠ INCLUDED. For modesty panels verify included/optional status, required hardware/brackets, size/model applicability, and incompatibilities. For cable trays, baskets, cable-ways, risers, and flip-up/top-access systems preserve included/required/optional status and do not infer compatibility from images alone. Separately verify with-hole and without-hole rows and prices.

COMPONENT STATUS AND SHARED ACCESSORIES
For each desk-linked component assign exactly one status: INCLUDED, PREPARED FOR, REQUIRED SEPARATE ITEM, OPTIONAL SEPARATE ITEM, or UNCONFIRMED. Never combine statuses. Explicit "always complete with", "must be completed with", or "requires" means REQUIRED SEPARATE ITEM; PREPARED FOR is not included. Do not assume a shared/common accessory applies to every Desk family. Require EXPLICIT, CROSS-REFERENCED, or clearly VISUALLY CONFIRMED applicability; otherwise use MANUAL DECISION — compatibility not established by supplied source and exclude it from extraction batches.

DESK SOURCE FIDELITY
Use actual visible/rendered manufacturer pages over OCR or transcription. Preserve exact manufacturer codes; never invent code ranges. Verify exact description → code → dimensions → printed price → symbol → applicability binding and never copy an adjacent row price. Blank is not zero; an open circle or other symbol is not numeric zero. Re-read dense repeated price sequences. Unreadable or unresolved content is UNCONFIRMED / MANUAL DECISION. Preserve compact dual PDF/printed page numbering without guessing either number.

FINAL DESK SOURCE GATE — DO NOT RETURN UNTIL ALL PASS
Before returning PRODUCT SETUP PLAN, internally re-read the source and correct every resolvable issue. For every proposed split ask: "Can these differences be represented cleanly inside one Product Template using Base / Model rows, Visual Subgroups, Accessories / Configuration, and finish guidance?" If YES, keep one Product Template; split only when the answer is clearly NO based on source-supported commercial/configuration differences. Then verify template boundaries, exact codes, row/price alignment, dimensions, LH/RH and SX/DX binding, required versus optional status, PREPARED FOR versus INCLUDED, support/service-unit mapping, with-hole versus without-hole pricing, shared-accessory evidence, and dual page numbering. Confirm Workstations and standalone storage are excluded and no Workstation pages appear in Desk extraction batches. Only unresolved critical issues may appear under Manual Decision or WARNINGS. Source fidelity is more important than completeness.`,
  meeting_conference: `MEETING / CONFERENCE TABLES PLANNING FOCUS
Cover Meeting Tables, Conference Tables, Boardroom Tables, extendable terminal/intermediate systems, multi-section configurations, and source-proven cable-management or structural components. Ignore desks, workstations, bench desks, coffee/side tables, storage, pedestals, cabinets, screens, seating, reception products, and unrelated furniture unless genuinely required by the meeting-table system.

COMPLETE TABLES AND EXTENDABLE SYSTEMS
Route complete direct-priced table SKUs with their own code, dimensions, price, top-access/no-top-access, or finish/top variant to Base / Model. Separately coded/priced top-access rows remain authoritative Base / Model or Modular rows; never turn them into a generic option. Route explicitly priced terminal/end and intermediate/central extension units to Modular, preserving exact code, dimensions, price, and independent whole-number quantity. A Terminal ×1 plus Intermediate ×3 is a valid Modular composition.

COMPONENT-BUILT LIMITS
For tops, beams, terminal/central legs, gantries, and cable trays, do not claim the system derives structural quantities. If source logic requires relationships such as 2 tops → 4 beam sets, 2 terminal legs, 1 central leg, or 2 trays, return Manual Decision unless a complete authoritative SKU avoids that formula. If source requires Terminal Legs OR Gantries at quantity 2, return Manual Decision: current configuration cannot cleanly enforce exactly one structural type with fixed quantity 2.

CABLES AND FINISHES
Classify source-proven cable trays and wire-manager kits as Required Companion, Conditional Option, or optional accessory only from source evidence. Preserve size-specific applicability, for example L120 tray only for L120 rows and L160 tray only for L160 rows. Keep actual top, beam, leg, and cable-tray finish/material codes in Finish Guidance / Material Library guidance; keep pricing columns in pricing structure and do not invent component-specific finish enforcement.

REQUIRED COMPONENT EVIDENCE — HIGH PRIORITY
A related or referenced article is NOT a Required Component unless supplied source wording explicitly proves a mandatory relationship. “See Art. X”, “refer to Art. X”, “for X see Art. Y”, “compatible with X”, “can use X”, “available with X”, “suitable for X”, “accessory for X”, optional use, or a related component alone mean referenced/compatible/optional, never Required Companion. Use Required Companion only for explicit evidence such as required, mandatory, must use, must be completed with, complete with, always add, must be ordered with, or required separate item. If requirement is not proven, use Optional Components when clearly available, otherwise state requirement status not confirmed from supplied pages. Do not infer requirement from location, nearby diagrams, related article numbers, or commercial usefulness. An explicitly included SKU component remains Included, not a separate required item.

TEMPLATE BOUNDARIES
Prefer one template for one family with the same sales flow and pricing structure. Split only for a materially different configuration flow: complete direct-priced meeting tables and a terminal/intermediate Modular system may be two templates. Do not split merely for size, finish, top access, left/right, or top material when safe authoritative rows can retain them.

FINAL MEETING TABLE SOURCE GATE
Before returning PRODUCT SETUP PLAN, internally verify direct-price code/dimension/price binding, top-access row identity, terminal/intermediate modular identity, cable size applicability, explicit required versus optional status, and whether component-built quantity logic exceeds current configuration capability. Return only genuine unresolved issues under Manual Decision or WARNINGS.`,
  sofa_lounge: `SOFAS / LOUNGE / ARMCHAIRS PLANNING FOCUS
Use commercial typology to include upholstered lounge armchairs/chairs, 1-seat/2-seat/3-seat and corner sofas, chaise longues, modular lounge seating, left/right/centre/corner/open/one-arm modules, poufs, ottomans, footrests, seating stools, commercially integral cushions, lounge-specific feet/bases/connectors, upholstery pricing, and source-backed lounge accessories. Do not treat task, executive-office, visitor, or conference chairs as Lounge merely because the source says "armchair".

LOUNGE SCOPE AND EXCLUSIONS
Unless directly part of the lounge configuration, ignore task/office/visitor/conference/training chairs, beam seating, Workstation systems, independent office benches, screens, partitions, walls, pods/booths, desks, meeting tables, standalone coffee/side tables, storage/cabinets, and unrelated accessories. Mention relevant exclusions briefly under IGNORED; do not analyze them or create Lounge-cycle Product Templates. A table may remain only when it is a source-defined modular composition element or lounge-mounted accessory.

COHERENT PRODUCT TEMPLATE BOUNDARIES
Prefer ONE commercially understandable Product Template per manufacturer lounge family/collection when Sales configuration remains coherent; never create one template per SKU or module. Do not split merely for seat count, high/low back, handed modules, centre/corner/chaise modules, fixed/swivel bases, upholstery grades, fabric/leather categories, module size families, leg/base finishes, or complete-sofa versus modular rows in one coherent commercial family. Before splitting ask: "Can these products remain understandable in one Product Template using Category / Matrix, Modular Pricing, Base / Model, Visual Subgroups, and Accessories / Configuration?" If YES, keep one Product Template. Split only for an independent range, substantially different typology or pricing architecture, completely different Sales flow, or a combination that would confuse Product Library. Large row count alone is not a split reason.

SIMPLE SOFAS, ARMCHAIRS, AND BASE VARIANTS
Use Category / Matrix when genuine rows for armchairs, 2/3-seater sofas, high/low backs, or base variants cross upholstery/fabric/leather price columns. Rows retain exact model/code, dimensions, quotation-ready specification, row image/reference, and upholstery prices; do not duplicate matrix-authoritative prices into Base / Model. Use Base / Model for direct-priced variants. Different coded/priced swivel, fixed, wood, metal, four-leg, star-base, or high/low-back models are normally pricing-authoritative rows. Use Accessories / Configuration only for separately priced selectable upgrades to the same model; distinguish model-defining, selectable, included/default, and finish-guidance differences.

MODULAR LOUNGE SYSTEMS AND UPHOLSTERY
Use Modular Pricing when customers combine multiple independently priced left, right, centre, corner, chaise, open, one-arm, pouf, ottoman, or seating/stool modules. Preserve module hierarchy, exact codes, handedness, dimensions, specifications, and prices; do not flatten modules into Base / Model rows or generic accessories. Product Library supports one shared upholstery/category choice, independent whole-number quantity per module, and multiple selected modules in one composition. Modular rows are pricing-authoritative and may carry upholstery-grade columns and per-category price cells. All modular groups must use compatible shared category columns; if category sets conflict, use MANUAL DECISION rather than silently merging them. Use source-supported Modular Groups such as Complete Sofas, Side Elements, Centre Elements, Corner Elements, Chaise, Poufs, or Cushions when those groupings reflect the source; do not impose these names rigidly or over-group. Visual Subgroups remain organizational only.

SECONDARY ITEMS WITH UPHOLSTERY MATRIX
Do not automatically classify cushions, poufs, footrests, or similar secondary lounge items as Accessories / Configuration. First determine whether the item has its own manufacturer code, its own dimensions/specifications, an independently quoted price, and the same upholstery-category matrix as the main lounge family. When all are true and the item is commercially part of the same lounge system, preserve it as a Modular Pricing row/group. Recommend Normal Accessory only when it is a simple separately priced option, current Accessories / Configuration semantics can represent its pricing, and source-supported applicability exists. If its price changes by the upholstery category selected for the modular composition, preserve that matrix pricing instead of collapsing it to one accessory price.

HANDEDNESS, COMPLETE SOFAS, AND SPECIAL ELEMENTS
Preserve Left/Right, LH/RH, and SX/DX codes exactly; never invent an opposite orientation or split a reversible module. Independently selectable corner, chaise, and open elements are Modular rows, not accessories. A coherent modular lounge family may contain complete 1-seat, 2-seat, and 3-seat sofas alongside modular elements. When they belong to the same Sales family and use the same shared upholstery columns, keep them inside one coherent Modular Pricing template/group structure; do not force a separate Category / Matrix destination merely because a row is a complete sofa. Before mixing pricing destinations, prefer the simplest coherent Sales configuration. Classify poufs, ottomans, footrests, and cushions by evidence as Modular items, Base / Model or Matrix products, Normal Accessories, or standalone products; do not force every pouf into Accessories or attach every cushion to every sofa. Commercial pricing structure takes precedence over the item's generic furniture name.

REQUIRED AND OPTIONAL LOUNGE COMPONENTS
Explicit "always complete with", "must be completed with", "requires", "complete with", or "add item/code" evidence for a separately coded/priced component means REQUIRED SEPARATE ITEM and must not be downgraded to optional. Report only the manufacturer's factual requirement: for example, if the source says "must always be completed with feet", write "Required Companion — manufacturer requires the sofa to be completed with the feet kit." Do not add unsupported purpose wording such as "required for the sofa to function." ProjectWorkflow Required Companion and Conditional Option applicability can target Base / Model, Category / Matrix, and Modular rows with allowed items and a source-supported fixed quantity. Preserve feet/base-kit code, price, finish choices, applicable rows, and explicit quantity; do not absorb its price into the sofa unless included. If a Required Companion or accessory has manufacturer finish or colour codes, preserve them separately as component finish guidance; do not confuse component colour codes with upholstery pricing columns. Include cushions, castor kits, electrification, connectors, swivel tables, power kits, and other lounge accessories only with source-supported applicability.

MODULAR QUANTITY LIMITATION
Fixed accessory quantity is NOT automatically multiplied by selected modular-row quantity. If the manufacturer requires one connector per module, two feet per selected element, accessory quantity equal to selected module quantity, or another quantity rule dependent on modular quantity, return exactly: "MANUAL DECISION — quantity depends on selected modular-module quantity; current fixed-quantity rule does not multiply automatically." Do not claim automatic enforcement or invent a workaround.

COMPONENT STATUS, UPHOLSTERY, AND SURCHARGES
Classify each important component as exactly one of INCLUDED, PREPARED FOR, REQUIRED SEPARATE ITEM, OPTIONAL SEPARATE ITEM, or UNCONFIRMED. PREPARED FOR ≠ INCLUDED; do not price an included item again. Upholstery grade/category labels that determine price are pricing-authoritative columns. Labels such as B, C, D, E; grouped categories such as B-C; upholstery grades; leather price grades; SG1/SG2/SG3/HP4/LG7; Super/Extra/Lusso; and equivalent manufacturer commercial price grades must remain active Category / Matrix or Modular pricing columns whenever they change price. Do NOT recommend mapping those price-grade/category labels themselves to Material Library; they are commercial price columns, not selectable materials. Material/Finish Guidance may contain only source-supported actual fabric names, leather names, finish names/codes, colour names/codes, and allowed material/finish combinations. If only pricing-grade labels are present, do not invent Material Library guidance; return exactly: "Finish Guidance: None from supplied pages." Preserve customer-own-material and on-request conditions exactly. Preserve explicit percentage, points, or fixed fire-retardant/upholstery surcharges. When a percentage surcharge is relative to another row/category price, such as "10% of customer-material price", and current rules cannot represent that calculation cleanly, return a concise MANUAL DECISION and never invent a fixed price.

SOURCE FIDELITY AND SHARED EVIDENCE
Use rendered manufacturer pages over OCR corruption. Preserve exact codes and dimensions; never invent ranges, products, orientations, compatibility, or missing values. Verify exact row/code/price and upholstery-column binding, read legends before symbols, verify dense adjacent rows independently, and preserve dual PDF/printed page numbering. Blank is not zero and symbols/open circles are not numeric zero. A shared accessory needs EXPLICIT, CROSS-REFERENCED, or clearly VISUALLY CONFIRMED family applicability; otherwise use MANUAL DECISION — compatibility not established by supplied source and exclude its page from extraction batches. Recommend concise, source-supported quotation-ready specifications without invented construction details. Recommend only commercially useful extraction pages: prioritize model/SKU pricing, upholstery matrices, required/optional components, explicit compatibility/requirement rules, and technical descriptions that materially support Product Specification or commercial rules. Include a technical-description page in the extraction batch or compact supporting-page recommendation when it provides source-supported construction/specification, required-companion confirmation, included equipment, product dimensions, or configuration evidence; do not omit it merely because it has no main pricing table. Avoid cover pages, decorative title pages, and indexes unless they contain necessary commercial information; never include them merely because they fall inside the supplied page range.

PROJECTWORKFLOW DESTINATIONS
Recommend only Base / Model for simple direct-priced variants; Category / Matrix for Model × Upholstery Grade; Modular for multi-piece configurable lounge systems; Accessories / Configuration for source-backed optional/required components whose pricing those semantics can preserve; and Manufacturer Finish Guidance for source-supported non-price-changing material/finish information. Never recommend Workstation for lounge seating. One coherent Product Template may legitimately use several destinations, but do not create unnecessary multiple pricing destinations. When all independently selectable products/modules share the same upholstery matrix, allow the concise recommendation "Primary setup: Modular" with "Configuration: Shared upholstery-category matrix across complete sofas and modular elements."

FINAL LOUNGE SOURCE GATE — DO NOT RETURN UNTIL ALL PASS
Before returning PRODUCT SETUP PLAN, internally correct every resolvable issue. Verify commercially coherent template count; simple-sofa versus modular classification; matrix versus Modular destination; exact upholstery columns; complete-sofa versus module identity; handedness; required feet/components; cushion applicability; standalone-table and mixed-catalogue exclusions; code/price/dimension/page binding; blank/symbol semantics; and source-backed applicability. Confirm pricing grades were not converted to Material Library materials, including grouped price grades; actual material names were not invented; component finish/colour codes remain separate from upholstery pricing columns; category-priced cushions, poufs, footrests, or similar items were not flattened into single-price accessories; shared upholstery matrices remain intact across coherent complete sofas and modular elements; and the simplest coherent pricing destination was preferred. Confirm extraction pages include useful pricing, component, rule, and technical-description evidence while excluding commercially empty covers, decorative titles, and indexes. Ensure required-component wording states only the source-supported requirement without inventing its purpose. Ensure every modular quantity-dependent companion rule uses the required MANUAL DECISION warning because fixed quantity does not multiply, and every unsupported relative percentage surcharge remains a concise MANUAL DECISION without an invented fixed price. Do not output a verification report; return only unresolved critical issues under Manual Decision or WARNINGS. Source fidelity is more important than completeness.`
};

export function buildProductTemplateSetupPlanningPrompt(focus: ProductTemplateSetupPlanningFocus = "general") {
  const sharedAccessoryEvidenceInstructions = focus === "chair_seating" || focus === "desk_executive" || focus === "sofa_lounge" || focus === "meeting_conference" || focus === "storage_cabinets"
    ? `Internally verify every shared/common accessory recommendation against its affected Product Template, applicability evidence, dual-numbered source page, manufacturer evidence, configuration strategy, and any supplier-code ambiguity. Return only verified shared items that materially affect setup in SHARED / COMMON; put only unresolved critical applicability issues under Manual review.`
    : `For every shared/common accessory recommendation, output:
Accessory: [manufacturer description/code]
Affected Product Template:
Applicability evidence: EXPLICIT / CROSS-REFERENCED / VISUALLY CONFIRMED / UNCONFIRMED
Source: PDF page X / printed catalogue page Y
Evidence: short explanation of what the manufacturer actually shows/states
Recommended strategy: Include Locally / Standalone Product / Both / Manual Decision
Reason:`;
  const sharedAccessoryStrategyInstructions = focus === "chair_seating" || focus === "desk_executive" || focus === "sofa_lounge" || focus === "meeting_conference" || focus === "storage_cabinets"
    ? `For optional shared accessories, internally evaluate whether Sales needs them during the main product configuration and verify the strategy, reason, affected templates, and any duplicated or reused supplier/price-list code ambiguity. Return only items that materially affect setup or require a critical Manual Decision.`
    : `For optional shared accessories such as modesty panels, cable trays, screens, and shared accessories, evaluate whether Sales needs to select them during the main product configuration. If yes, recommend Include locally; if no, recommend Standalone product where appropriate; if uncertain, use MANUAL DECISION. Identify the strategy, reason, affected templates, and any duplicated or reused supplier/price-list code ambiguity.`;
  const batchOutputInstructions = focus === "chair_seating" || focus === "desk_executive" || focus === "sofa_lounge" || focus === "meeting_conference" || focus === "storage_cabinets"
    ? `For every template, internally verify MAIN SOURCE PAGES and SHARED / SUPPORTING PAGES and how each belongs in extraction, a later Add More JSON batch, Manufacturer Finish Guidance, an independent product, or manual inspection. Return these only through the compact Main pages, Extraction, Finish Guidance, Manual Decision, SHARED / COMMON, or WARNINGS lines.`
    : `For every template, list MAIN SOURCE PAGES and SHARED / SUPPORTING PAGES, stating whether each is included in extraction, a later Add More JSON batch, Manufacturer Finish Guidance, an independent product, or manual inspection.`;
  const outputInstructions = focus === "chair_seating" ? `Analyze thoroughly internally, but return only the shortest practical Chair & Seating setup plan needed for ProjectWorkflow decisions. Do not explain reasoning step-by-step.

Return human-readable output only, using exactly this compact structure:

==================================================
PRODUCT SETUP PLAN
==================================================

Overall:
- Product Templates: X
- Families: [short list]
- Main reason: [one short sentence]

PRODUCT 1 — [Template Name]
- Why separate: [maximum 1 short sentence]
- Main pages: [compact dual PDF / printed page references]
- Primary setup: [Base / Model / Category / Matrix / Accessories / Configuration / etc.]
- Configuration: [short pricing/configuration pattern only if useful]
- Accessories / Required Components: [short list only, or None]
- Finish Guidance: [short note, or None]
- Extraction: [Batch 1 pages; Batch 2 only if actually needed]
- Manual Decision: [critical unresolved issue only, or None]

Repeat PRODUCT sections only when genuinely separate templates are required.

SHARED / COMMON
- [Only verified shared items that materially affect setup]
- Manual review: [only unresolved shared items]

WARNINGS
- [Only critical warnings that could change setup/extraction]
- If none: None

CHAIR OUTPUT BREVITY RULES
- Why separate is a maximum of one short sentence.
- Do not list every SKU, model, or code in the Planning output.
- Do not list every accessory; include only accessories or components that affect template structure or configuration.
- Do not explain obvious destination choices.
- Do not repeat the same page reference unnecessarily.
- Do not repeat normal ProjectWorkflow workflow instructions.
- Do not return step-by-step reasoning. Prefer one-line summaries.
- For a normal Chair family, aim for roughly 10–25 concise lines total. Longer output is allowed only when the source genuinely requires multiple separate Product Templates.
- Use only one compact Configuration line when useful, for example: "Model × Upholstery Grade matrix", "Base model + upholstery surcharge", or "Direct-priced seating models + optional accessories".
- Do not return mechanism, base, arm, or castor strategy as separate sections unless one requires a critical Manual Decision.
- List accessories/components briefly with their material setup status, for example "Armrests — optional", "Headrest — model-specific", or "Footring — required for stool variant". Use the detailed component evidence fields only when a genuinely ambiguous item must appear under Manual Decision.
- Keep dual page numbering compact, for example "PDF pages 3–5 / printed catalogue pages 124–126".
- Keep extraction batches compact: identify the batch, dual page reference, and short content label. Include Batch 2 only when actually needed.
- Perform the final Chair source gate internally. Do not return a verification report when all critical checks pass; report only unresolved critical issues under Manual Decision or WARNINGS.` : focus === "desk_executive" ? `Analyze deeply internally, but return only the shortest practical Desks / Executive Desks setup plan needed for ProjectWorkflow decisions. Do not explain reasoning step-by-step.

Return human-readable output only, using exactly this compact structure:

==================================================
PRODUCT SETUP PLAN
==================================================

Overall:
- Product Templates: X
- Families: [short list]
- Main reason: [one short sentence]

PRODUCT 1 — [Template Name]
- Why separate: [maximum 1 short sentence]
- Main pages: [compact dual PDF / printed page references]
- Primary setup: [Base / Model / Category / Matrix / Modular / Accessories / Configuration]
- Configuration: [short pricing/configuration pattern only if useful]
- Accessories / Required Components: [short list only, or None]
- Finish Guidance: [short note, or None]
- Extraction: [Batch 1 pages; Batch 2 only if actually needed]
- Manual Decision: [critical unresolved issue only, or None]

Repeat PRODUCT sections only when genuinely separate Desk Product Templates are required.

IGNORED
- Workstation — separate Workstation product-family cycle.
- [Other clearly unrelated families only if relevant]

WARNINGS
- [Only critical warnings that could change setup/extraction]
- If none: None

DESK OUTPUT BREVITY RULES
- Aim for roughly 10–25 concise lines for a normal Desk family; use one-line summaries.
- Do not return long or step-by-step reasoning, a full source-verification report, or an extraction-order tutorial.
- Do not list models one by one or return accessory evidence blocks unless a critical ambiguity requires Manual Decision.
- Do not repeat page references or normal ProjectWorkflow workflow instructions.
- Do not analyze Workstations in detail or analyze standalone cabinets unless source-proven as desk-linked.
- Use only one compact Configuration line when useful, such as "Direct-priced desk sizes and LH/RH models + required top access".
- Keep extraction batches compact: identify the batch, dual page reference, and short content label; include Batch 2 only when needed.
- Perform the final Desk source gate internally. Return only unresolved critical issues under Manual Decision or WARNINGS.` : focus === "meeting_conference" ? `Analyze thoroughly internally, but return only the shortest practical Meeting / Conference Tables setup plan. Do not expose reasoning or add text before or after the plan.

Return human-readable output using exactly this structure:

PRODUCT SETUP PLAN

Overall:
- Product Templates: X
- Families: [short family/template names]
- Main reason: [one short sentence]

PRODUCT 1 â€” [Template Name]
- Primary setup: [Base / Model | Modular | Category / Matrix if genuinely justified]
- Configuration: [one short sentence]
- Required Components: [short factual summary or None]
- Optional Components: [short factual summary or None]
- Finish Guidance: [short summary]
- Extraction: [compact relevant PDF / printed page range]
- Manual Decision: [short issue or None]

Repeat PRODUCT sections only when more than one genuinely separate template is needed.

IGNORED
- [short list or None]

WARNINGS
- [only real blockers/manual risks, otherwise None]

MEETING TABLE OUTPUT BREVITY RULES
- Return ONLY the exact PRODUCT SETUP PLAN structure above; no surrounding commentary, extra sections, or text before/after it. Aim for roughly 10â€“25 concise lines for a normal family.
- Do not output PAGE NUMBERING NOTE, Markdown bold headings, long paragraphs, blank-line-heavy formatting, Why separate, Main pages, source-verification notes, evidence explanations, architecture commentary, repeated rationale, nested accessory lists, or extraction-order essays.
- Main reason, Configuration, Required Components, Optional Components, Finish Guidance, Extraction, and Manual Decision are each one short line.
- Do not list every SKU, component, or accessory. Report component-built quantity formulas and terminal-leg/gantry quantity-two alternatives only as Manual Decision when they are essential.
- Keep source-proven cable-management applicability compact and size-specific. Perform the final Meeting Table source gate internally; return only unresolved critical issues under Manual Decision or WARNINGS.` : focus === "sofa_lounge" ? `Analyze thoroughly and perform every Sofa/Lounge source and page-verification rule internally, but return only the strict short final answer below. Do not expose reasoning or add text before or after the plan.

Return human-readable output using exactly this structure and no additional headings, fields, nested sections, or explanatory paragraphs:

PRODUCT SETUP PLAN

Overall:
- Product Templates: X
- Families: [short family list]
- Main reason: [one short sentence]

PRODUCT 1 — [Template Name]
- Primary setup: [Base / Model / Category / Matrix / Modular]
- Configuration: [one short sentence]
- Required Components: [short summary or None]
- Finish Guidance: [short summary or None]
- Extraction: [compact PDF + printed page range]
- Manual Decision: [short issue or None]

Repeat PRODUCT sections only when more than one genuine Product Template is required.

IGNORED
- [short item(s), or None]

WARNINGS
- [critical unresolved warning only, or None]

STRICT SOFA/LOUNGE OUTPUT RULES
- For one Product Template, target approximately 12–15 concise content lines. Do not exceed this because the source contains more technical information.
- Do not output PAGE NUMBERING NOTE, Why separate, Main pages, Accessories / Required Components, SHARED / COMMON, SOURCE VERIFICATION SUMMARY, EXTRACTION ORDER, evidence blocks, repeated manufacturer wording, or any explanatory paragraph before or after PRODUCT SETUP PLAN. Earlier page-numbering instructions are internal verification requirements only.
- Required Components is exactly one line. State the factual requirement once, for example: "- Required Components: Kit of 4 Feet — Required Companion, exactly one kit per sofa." Do not repeat it under WARNINGS unless a separate unresolved critical risk exists.
- WARNINGS contains only unresolved critical issues. If the setup is clear and represented above, return exactly "WARNINGS\n- None"; never repeat Configuration or Required Components there.
- Extraction is exactly one compact line using verified matching spans, for example: "- Extraction: PDF 2–4 / printed 408–410." Do not include cover/title pages unless commercially necessary. Do not output an impossible or inconsistent PDF/printed span.
- Never turn non-contiguous or specially ordered manufacturer pricing categories into an invented range. Preserve the exact category order or use the source-safe compact phrase "upholstery price categories". Never write "B through H" unless the manufacturer explicitly defines that continuous range. Prefer concise wording such as "- Configuration: 1-, 2-, 3-seat models × upholstery price categories." when exact labels add no setup value.
- Keep Finish Guidance to one short line. When applicable, use concise wording such as "- Finish Guidance: Feet colour codes; upholstery category labels remain pricing columns." Do not expand actual fabric/leather details unless they materially change setup.
- Perform the final Lounge source gate internally. Return only unresolved critical issues under Manual Decision or WARNINGS.` : `Return human-readable output only, using exactly this structure:

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

==================================================
WARNINGS / MANUAL DECISIONS
==================================================
List ambiguous supplier codes, cross-template component risks, unclear required rules, unclear page relationships, potentially huge templates, matrix uncertainties, and material guidance versus actual selectable materials.`;

  const storageOutputInstructions = `Analyze thoroughly internally, but return only the shortest practical Storage / Cabinets / Credenzas setup plan. Do not expose reasoning or add text before or after the plan.

Return human-readable output using exactly this structure:

PRODUCT SETUP PLAN

Overall:
- Product Templates: X
- Families: [short family/template names]
- Main reason: [one short sentence]

PRODUCT 1 - [Template Name]
- Primary setup: [Base / Model | Category / Matrix only if commercially proven | Modular only if composition is proven]
- Configuration: [one short sentence]
- Required Components: [short factual summary or None]
- Optional Components: [short factual summary or None]
- Finish Guidance: [short summary]
- Extraction: [compact relevant PDF / printed page range]
- Manual Decision: [short issue or None]

Repeat PRODUCT sections only when more than one genuinely separate template is needed.

IGNORED
- [short list or None]

WARNINGS
- [only real blockers/manual risks, otherwise None]

STORAGE OUTPUT BREVITY RULES
- Return only the structure above; aim for roughly 10-25 concise lines for a normal family.
- Do not list every SKU, component, or finish code.
- Keep separate-carcass/door compatibility, finishing-top status, wall-fixing status, and lock choice to one factual line each only when they affect setup.
- Do not force Modular for size variants or unproven shared-side bookcase structures.
- Perform the final Storage source gate internally; return only unresolved critical issues under Manual Decision or WARNINGS.`;

  return `You are planning how a manufacturer price list should be entered into ProjectWorkflow.

DO NOT EXTRACT ProductTemplateDraft JSON. DO NOT RETURN JSON.

${globalPlanningArchitectureContract}

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

${sharedAccessoryEvidenceInstructions}

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

${sharedAccessoryStrategyInstructions}

VISUAL SUBGROUPS, IMAGES, AND FINISH GUIDANCE
Hierarchy: Pricing Type → Group → Subgroup → Row/Item. Rows/items remain pricing-authoritative; subgroups are visual/organizational only. Recommend subgroups only for source-supported shared diagrams, shapes/configurations, size families, or orientations. State the appropriate image level: Group image, Subgroup image, Row image; do not duplicate images unnecessarily.

Actual selectable materials/finishes remain controlled by ProjectWorkflow Material Library linkage. Manufacturer materialSuggestions are informational Manufacturer Finish Guidance only. Recommend “Extract as Manufacturer Finish Guidance” for finish-code tables, allowable top/leg finishes, or colour guidance unless the pages directly form pricing/category configuration. Do not create another material-selection system.

MULTIPLE BATCHES AND SHARED PAGES
External LLM limits may require multiple coherent batches for one template using + Add More JSON. Batch by commercial source structure, never equal page counts. INCLUDED components do not need a separate accessory extraction unless independently sold. Include REQUIRED SEPARATE ITEM pages in the relevant product extraction/Add More batch. Include OPTIONAL SEPARATE ITEM pages only when verified compatible and useful in the configurator. PREPARED FOR wording alone is not reason to extract the accessory page. UNCONFIRMED remains under Pages to inspect manually. Include a shared accessory page in a Product Template extraction batch only if at least one relevant item on that page has verified applicability. ${batchOutputInstructions} Good boundaries must also support future Prices Only, Selected Sections, New Item, and Not Found updates.

${focus === "storage_cabinets" ? storageOutputInstructions : outputInstructions}`;
}
