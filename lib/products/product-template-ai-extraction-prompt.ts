import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups";

export const extractionPromptFocuses = ["full", "base_model", "workstation", "screens", "category_matrix", "modular", "accessories", "accessories_electrification", "product_details", "materials", "chair_seating", "sofa_lounge", "meeting_conference", "storage_cabinets"] as const;
export type ExtractionPromptFocus = typeof extractionPromptFocuses[number];

const relatedAccessoriesRule = "Also extract any clearly related accessories, options, companion components, required add-ons, optional add-ons, selection constraints, and applicability information found in the supplied source into optionGroups. Do not ignore them merely because the selected extraction focus is pricing.";

const screenExtractionContract = `SCREEN CATALOGUE EXTRACTION
Preserve manufacturer-defined screen family/type identity in group/family naming (for example front, lateral/side, desk-mounted, bench, freestanding/desktop, floor, modesty, acoustic, upholstered, felt, glass, framed/frameless, or mixed-material). Do not automatically split Product Templates, merge commercially distinct front/lateral/floor forms, or let similar material/finish erase distinct codes, dimensions, prices, mounting requirements, or compatibility.

SCREEN PRICING
Each authoritative direct-priced screen SKU (one code per width, width/height, material, or construction) belongs in pricing.baseModelRows. Several widths, materials, finishes, or adjacent similar rows do not make a Matrix. Use pricing.priceMatrices only for a real source-proven screen row × price-category dimension, such as upholstery categories B/C/D/E/F/G/I with different prices. Keep source category labels exactly. Finish colours/material choices sharing the same row price are Manufacturer Finish Guidance/material selections, not Matrix columns. When one supplied screen catalogue contains direct-priced families and genuine category-priced families, preserve each family in its correct pricing destination; do not manufacture fake matrices merely to make the catalogue uniform.

SCREEN COMMERCIAL ROW COMPLETENESS
When supplied commercial pages contain multiple authoritative priced rows, the extractor MUST account for every materially distinct row/family in the supplied batch unless it explicitly explains why a row is excluded.

Do not emit only a representative subset of:
- widths
- heights
- material variants
- framed/frameless variants
- side-screen variants
- floor-screen variants
- mounting-system rows
- accessories

when the source provides separate authoritative supplier codes and prices.

Before final output:
- scan every supplied commercial table page
- verify each authoritative priced supplier code is either:
  A. emitted in pricing/optionGroups, or
  B. intentionally excluded with an extraction warning/reason

If many authoritative priced rows are omitted, do not claim high confidence. Do not set confidence above 0.90 when authoritative priced rows from the supplied batch are knowingly incomplete or unresolved.

EXACT SUPPLIER-CODE ACCOUNTING BEFORE PAGE COMPLETENESS

A commercial page is complete only when EVERY authoritative priced supplier code visible on that page has been accounted for.

Before claiming a page or page range complete:

1. Read every commercial table on that supplied page.
2. Build an internal checklist of every authoritative priced supplier code.
3. Compare that checklist against all emitted:
   - pricing.baseModelRows
   - pricing.workstationRows
   - pricing.priceMatrices rows
   - pricing.modularGroups rows
   - optionGroups items
4. Every authoritative priced supplier code must be:
   A. emitted exactly once in the correct structure,
   OR
   B. explicitly identified in extractionWarnings as not yet extracted.

A page appearing in sources[] does NOT prove that page is commercially complete.

Never emit wording such as "Extraction complete through printed page X" unless every authoritative priced supplier code on every supplied commercial page up to X has been accounted for.

If any earlier supplied page still contains unextracted supplier codes: do NOT claim completion through a later page; identify the earliest incomplete printed page or commercial family; state that supplemental extraction is still required from that point.

Do not use family-level wording such as "SCBD family extracted" when only some supplier codes from that family were emitted. Completeness is evaluated at authoritative supplier-code row level, not merely family-name level.

SCREEN INSTALLATION / MOUNTING SYSTEMS ARE NOT AUTOMATICALLY PRIMARY PRODUCTS
Do not route desk rails, cable-management rails, flap assemblies, screen-support rails, mounting assemblies, or cable-tray mounting systems to pricing.baseModelRows merely because they have their own supplier codes and prices.

If the source presents them as:
- installation options
- support systems
- mounting systems
- desk rails
- cable-tray assemblies used to mount screens

then preserve them as configuration/support/accessory structures rather than primary Screen products.

Primary Base/Model should be used for the independently sold screen/divider SKU itself.

Only treat a rail/support assembly as a main Base/Model product if the source clearly presents it as the primary commercial product rather than an installation/support component.

Architectural examples only, never extraction evidence:
- an "SCBD..." style desk rail -> installation/support configuration
- an "SCBV..." style cable-tray rail -> installation/support configuration
- an "SCSS..." / "SCSB..." style flap + cable tray -> installation/support configuration
- an "SCRS..." / "SCBS..." / "SCRB..." style framed-screen mounting/cable system -> installation/support configuration

INSTALLATION FAMILY EXTRACTION MUST ALSO BE EXHAUSTIVE

When one supplied installation-options page contains several separately priced supplier-code families, preserve every authoritative priced family and every row.

Do NOT extract only one representative family for:
- one desktop thickness
- one desk type
- one bench type
- one middle-gap condition
- rail-only
- rail + cable tray
- flap + cable tray
- one-flap versus two-flap systems
- framed-screen mounting/cable assemblies

when other separately priced sibling families are visibly present.

Different supplier-code families with different commercial conditions remain separate option/configuration rows even when they perform a similar mounting function.

Do not sample sibling installation families for brevity.

MOUNTING AND COMPONENT COMMERCIAL STATUS
If a screen row explicitly requires multiple separately priced components, every source-proven component relationship that the current schema can represent MUST be emitted structurally.

Example architecture only:

Angular felt screen
-> required Art.880
PLUS
-> required exactly one of Art.881 / Art.882

This MUST produce TWO separate Required Companion optionGroups/rules:

A. Art.880 group:
- outer mode = required_choose_at_least_one
- conditionalConfiguration.role = companion
- conditionalConfiguration.selection = exactly_one
- target exact angular screen row
- allowed_item_ids contains only art-880
- required true
- visible true

B. Art.881 / Art.882 group:
- outer mode = required_choose_at_least_one
- conditionalConfiguration.role = companion
- conditionalConfiguration.selection = exactly_one
- target exact same angular screen row
- allowed_item_ids = [art-881, art-882]
- required true
- visible true

Do not leave either relationship only in importantRequirements.

Do not place all mounting hardware into one universal Required Companion optionGroup when the same screen row can require more than one independent mounting component simultaneously. Before emitting conditionalConfiguration, partition mounting components by independent selection requirement. If selecting one screen row requires Component family A PLUS Component family B, then A and B MUST be separate optionGroups so both groups can become active for the same target row. A single optionGroup with conditionalConfiguration.selection = "exactly_one" can never represent A PLUS B.

Architectural examples only:
A. Front-stirrup group - items may include Art.880 and Art.462; use exact allowed_item_ids per target row.
B. Lateral-stirrup group - items Art.881 and Art.882; use conditionalConfiguration.selection = "exactly_one".
C. Felt alignment / central-stirrup group - item Art.888.
D. Freestanding-support group - item Art.886.

Do NOT create one global "Mounting Stirrups & Brackets" Required Companion group when doing so prevents simultaneous independent requirements.

For a source-proven angular screen requiring front mounting PLUS a lateral mount choice: activate the Front-stirrup companion group for the exact angular row, restricted to Art.880; independently activate the Lateral-stirrup companion group for that same row, restricted to Art.881 and Art.882; both rules required = true and visible = true. The same target row appearing in two different Required Companion groups is correct and necessary. Never reduce this to importantRequirements only.

"Supplied with brackets", "brackets/clamps/support included", or equivalent is INCLUDED: preserve it as specification/source evidence and never add a Required Companion, synthetic mounting charge, or duplicate price. "Brackets not included", "order separately", "always complete with stirrups/mounting kit", or equivalent is a REQUIRED SEPARATE ITEM only for the exact source-supported screen rows. When separately priced required hardware and its exact target screen rows are both supplied and already extracted, importantRequirements alone is insufficient: MUST emit row-specific conditionalConfiguration whenever the current schema safely represents it. Use role "companion", required true, visible true, and one applicability rule per exact target row. For one required alternative set such as Art.881 OR Art.882, use a companion group with outer selection "required_choose_at_least_one", conditionalConfiguration.selection "exactly_one", and source-supported allowed_item_ids ["art-881", "art-882"]; do not auto-choose without a deterministic source rule. A separately required single item (for example Art.462 for an exact S7b row, or Art.886 where an exact freestanding row says "complete always with") needs its own required companion group/rule targeted only to those exact rows. For Art.880 PLUS one of Art.881/Art.882, emit TWO independent Required Companion groups: one for Art.880 and one exactly-one alternatives group for Art.881/Art.882; never collapse this into one global mounting group or artificial combined accessory row. Direct-priced variants such as screen with one/two accessory rails, or a single screen-and-modesty SKU, remain their own authoritative rows; do not additionally charge included rails or synthesize separate products.

INCLUDED MOUNTING HARDWARE MUST SURVIVE EXTRACTION
When a source row explicitly says includes mounting clamps, supplied with mounting brackets, brackets included, or mounting hardware included, that status MUST be preserved on the exact authoritative SKU row. Do not omit such rows merely because a visually similar non-included family exists. Do not add any separate required mounting charge to those included-hardware rows. For mixed catalogues containing both screen rows with included hardware and screen rows requiring separate hardware, the extractor MUST preserve both commercial families independently.

Final check: verify that at least one INCLUDED-hardware row remains structurally distinct from otherwise-similar REQUIRED-SEPARATE-hardware rows when both are present in the supplied source.

Mounting commercial status is family/row-specific source evidence. Do NOT inherit mounting clamps included, brackets included, brackets not included, or mounting required separately from a preceding or following visually similar family. If Family A explicitly says "includes pair of mounting clamps" and adjacent Family B does not state an included/separate mounting status, do not assume Family B has the same status. Likewise, if another adjacent family says "mounting brackets not included", do not apply that requirement to Family B without exact source evidence. When the exact family is silent: preserve the authoritative SKU/price normally; do not invent included hardware; do not invent a separately-required mounting component; preserve any broader installation guidance that is genuinely source-backed; mark the mounting relationship for review/manual decision if necessary. Final self-check: every INCLUDED or REQUIRED-SEPARATE mounting statement must be supported by the exact target family/row source block.

SOURCE-SILENT MOUNTING STATUS IS NEUTRAL

If the exact visual commercial row/family block does NOT explicitly state an included or separately-required mounting status, mounting commercial status for that row/family is UNKNOWN / UNSPECIFIED.

For an exact source-silent row/family, NEVER emit phrases such as:
- "Includes mounting clamps"
- "Includes mounting brackets"
- "Mounting brackets not included"
- "Mounting brackets must be ordered separately"
- "Mounting hardware included"
- "Mounting hardware required separately"

in:
- specification
- importantRequirements
- conditionalConfiguration
- Required Companion rules

unless that exact commercial row/family block visibly supports the statement.

Do NOT derive row-level mounting commercial status from:
- a general installation diagram
- a family-wide installation page
- the previous commercial family
- the following commercial family
- the same material at another height
- the same height in another material
- a neighbouring table
- page layout proximity
- a repeated chapter heading

General installation guidance may still be preserved as configuration context, compatibility evidence, or extractionWarnings when genuinely supported, but it MUST NOT be rewritten as INCLUDED or REQUIRED-SEPARATE commercial status for a source-silent SKU family.

Final self-check: For every row whose specification or importantRequirements contains an included-mounting or separately-required-mounting statement, verify that the same exact commercial family/table block contains explicit manufacturer evidence for that status. If not, remove that row-level status before returning JSON.

REQUIRED SCREEN COVER QUANTITIES
When supplied source evidence explicitly requires a matching cover for an exact screen/modesty row and the cover SKUs are supplied in the extraction batch, preserve each real cover SKU and its unit price as a Required Companion, not an ordinary optional accessory. Target each exact compatible row with conditionalConfiguration. Use fixed_quantity: 1 for a one-bar row and fixed_quantity: 2 for a two-bar row only when the source proves that count. The manufacturer cover remains one unit-priced item: never multiply its source price, synthesize a multi-cover SKU, or leave a source-required cover optional. When one required cover companion group contains multiple cover SKUs for different screen widths or configurations, every applicability rule MUST use allowed_item_ids to restrict that target row to the exact source-supported matching cover SKU or SKUs. A different-width cover must never remain selectable merely because it belongs to the same cover group.

Example architecture only:
- W100 one-bar screen -> allowed_item_ids contains only the W100 cover; fixed_quantity: 1
- W100 two-bar screen -> allowed_item_ids contains only the W100 cover; fixed_quantity: 2

For a single required mounting or cover item targeting a base_model or price_matrix row:
- outer optionGroup.selection.mode = "required_choose_at_least_one"
- minSelections = 1
- maxSelections = null
- defaultItemIds = []
- conditionalConfiguration.role = "companion"
- conditionalConfiguration.selection = "exactly_one"
- applicability.required = true
- applicability.visible = true
- fixed_quantity only when explicitly source-proven
- NEVER emit scale_with_target_quantity for base_model or price_matrix targets

SCREEN CONTEXT, COMPATIBILITY, AND FLOOR COMPOSITIONS
When the source explicitly proves a screen/modesty row requires one specific mounting kit, or one mounting kit plus an additional alignment/central stirrup, emit each required component structurally whenever the supplied component SKU and exact target row are both available.

Example architecture only:

W100 felt modesty
-> Art.880 required

W120-W180 felt modesty
-> Art.880 required
PLUS
-> Art.888 required

Use separate Required Companion groups for independent required items. Do not leave Art.880 or Art.888 as prose-only requirements. Each requirement must have its own row-specific applicability rule. Do not merge Art.880 and Art.888 into one exactly-one group.

When a screen row explicitly requires mounting hardware, but the exact hardware choice depends on external configuration such as desk system, bench system, central bar, crossbeam, fixed top, sliding top, or other context the current ProductTemplateDraft cannot express, do NOT invent an unconditional companion. Instead: keep the requirement in importantRequirements; preserve the supplied compatible hardware items; and add extractionWarnings entry containing exactly "CONFIGURATION-DEPENDENT - MANUAL DECISION". This warning is mandatory whenever at least one supplied screen mounting requirement remains unresolved because the current schema cannot express the deciding context. Do not omit the warning merely because other screen rows have valid conditionalConfiguration. If at least one extracted screen row has an explicit mounting requirement but its exact hardware choice cannot be structurally resolved because the decision depends on external desk/bench/system context, extractionWarnings MUST contain exactly "CONFIGURATION-DEPENDENT - MANUAL DECISION". This warning is required even when other screen rows have successfully resolved conditionalConfiguration rules.

Requirements depending on desk versus bench, desktop thickness, centre gap, cable tray/flap, desk system, connected screen count, height, fixed/sliding desktop, rail/crossbeam, or freestanding stability must not become unconditional companions. If the exact condition cannot be represented in the current draft schema, preserve requirement text, supplier/reference codes, applicability evidence, and source condition, then add the clear extraction warning "CONFIGURATION-DEPENDENT - MANUAL DECISION".

When a primary screen row explicitly states "mounting brackets not included" or "must be ordered separately", the extraction MUST NOT leave all compatible mounting hardware as ordinary optional accessories if the source proves the screen cannot be installed without separate mounting hardware. If the exact mounting choice depends on external context such as desktop thickness, desk range, bench vs single desk, centre gap, or flap/cable-tray condition, then: preserve the mounting-system items; keep the main screen as the primary Base/Model row; preserve the "mounting required separately" requirement; emit "CONFIGURATION-DEPENDENT - MANUAL DECISION"; do NOT invent one universal mounting SKU; and do NOT downgrade the relationship to a normal optional accessory. If exact applicability can be expressed safely with current schema and supplied evidence, use row-specific Required Companion rules instead.

For linked floor screens, preserve each hinge kit, kit quantity if stated, height condition, and "only when linked" condition; never make it universally required. For stabilizing legs/bases, preserve explicit end/middle/shared-leg, flat-base, spacing, and composition-threshold evidence, but do not infer fixed quantities from layout.

Preserve explicit external desk/workstation compatibility or incompatibility (for example OXI, 5TH ELEMENT, SIGMA, UP, SEGUO, FIL ROUGE, X5, X4) as source evidence for later Planning/Linked Product decisions. Do not create cross-template conditionalConfiguration rules, duplicate the desk/workstation into the Screen template, or automatically persist a linked product. If the Screen is independently configurable and intended to accompany another family, preserve a planning/source note that it is a reusable Linked Product candidate; linking is not an extraction-time decision.

SCREEN FINISHES, CODES, DIMENSIONS, AND STATUS
Keep finish/material colour, commercial price category, and supplier/order-code suffix separate. When the manufacturer explicitly states base article + finish code = complete order code, retain the base article as the row supplier code unless that exact row prints a complete code; retain the finish code in finish/material source data and preserve the manufacturer composition instruction. Do not duplicate pricing rows per finish, synthesize/concatenate a code, or include finish/footnote/superscript markers such as (*) in supplier codes. The extraction MUST include "COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED" in extractionWarnings whenever that commercial-code composition is source-proven; this warning is mandatory, not optional.

Emit "COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED" ONLY when the supplied source explicitly proves that the final commercial order code is formed by combining multiple code parts, for example base article code + finish/material suffix = complete order code. Finish codes, RAL codes, colour codes, or material codes by themselves are NOT sufficient evidence of supplier-code composition. Do not emit the composed-code warning merely because a row has a supplier code, finishes have their own codes, frame finishes use A/I/R, or RAL/NCS references exist. The manufacturer must explicitly state or demonstrate the composition rule.

Bind actual screen dimensions to their exact row/code. Preserve nominal desk-size relationships as guidance (for example actual 1725 mm screen for an 1800 mm desk), never overwrite the actual screen dimension with the nominal desk dimension. Preserve source-backed screen-type/height/material finish restrictions without treating them as price differences unless prices differ. Ordinary hooks, holders, trays, panels, covers, and similar screen accessories remain optional unless source explicitly makes them mandatory. Preserve discontinued/obsolete/while-stocks-last status as row/source warning rather than silently removing an authoritative row.

If the source explicitly labels a row/family THIS ITEM WILL SHORTLY BE DISCONTINUED, discontinued, obsolete, while stocks last, or no longer replenished, preserve that status on the affected row/family. Do not silently drop the status. If current ProductTemplateDraft has no exact dedicated discontinued field, preserve it in importantRequirements and/or extractionWarnings without removing the authoritative row. Final check: every source-marked discontinued/shortly-discontinued SKU remains present with its status preserved.

When a discontinued / shortly-discontinued / obsolete / while-stocks-last notice appears between commercial families, bind the notice to the exact visual table/family block supported by its placement. A status printed directly after the final rows of one family and before the heading/rows of the next family belongs to the preceding family unless the source explicitly indicates otherwise. Do NOT attach a discontinued notice to the following family merely because PDF text extraction places the notice immediately before that family's text. Use page layout, headings, row boundaries, spacing, and table grouping as evidence. Never propagate one family's discontinued status into an adjacent family. Final self-check: every discontinued status is attached to the exact visual family/table that the source marks, not merely the nearest row in parsed-text reading order.

SCREEN PTS / NON-CURRENCY PRICING
When the manufacturer labels commercial values as PTS / points rather than a currency: preserve the raw numeric values exactly; keep currency null; do not assume EUR/AED/USD; and add an extraction warning explaining that a point-to-price conversion rule is required before treating the values as monetary prices. Do not multiply or convert PTS during extraction.

SCREEN SOURCE-BATCH PAGE FIREWALL
If the user supplies a declared page range or selected page batch, sources[] MUST be a subset of that supplied batch.

When the extraction call declares an explicit supplied page range, such as pages 9-31, treat that range as a hard allow-list for sources[]. No source entry may have pageNumber < first supplied page or pageNumber > last supplied page. Do not use an adjacent continuation page such as page 32 merely because it is present in the same uploaded PDF or earlier conversation context. If useful data exists outside the range: omit that data from the extraction; add a supplemental extraction warning instead.

A page outside the supplied batch must never appear in sources[] even when:
- it belongs to the same uploaded PDF
- it was visible in earlier conversation context
- it is adjacent to the supplied range
- it contains commercially relevant continuation content

If such a page is needed, add an extractionWarning requesting supplemental extraction instead of using it.

Final self-check: For every sources[].pageNumber, verify that page number was explicitly included in the current extraction batch.

sources[] may contain only supplied pages that materially contributed data to this extraction call. Never include a TOC, preceding page, remembered catalogue page, prompt example, prior-context page, or any other unsupplied page. A page referenced by a supplied page is not itself supplied evidence. If a needed companion page is unsupplied, preserve only its reference, add a supplemental-extraction warning, and do not extract its code or price. Before returning JSON self-check: Every sources[].pageNumber is from the actual source batch supplied for this extraction call.

For sources[].pageNumber, use the page numbering system actually supplied for the current extraction batch consistently. Do not mix PDF page index, printed catalogue page number, and earlier-conversation page numbering within one extraction. If the supplied split PDF preserves printed catalogue numbers and the model uses those, use printed catalogue numbers consistently for every source in that batch. This does not change the existing hard supplied-page firewall.

SCREEN FINAL CHECK
Before returning JSON verify: direct-priced screens stayed Base/Model; real upholstery columns stayed Matrix; included hardware was not charged; supplied separately required hardware has row-specific conditionalConfiguration whenever exact target rows are expressible; required cover quantities use fixed_quantity without multiplied price; alternatives were not auto-selected; configuration-dependent hinges/bases were not made unconditional; source-proven commercial article-plus-finish composition has the mandatory runtime-support warning; sources[] contains no unsupplied pages; article and finish codes remain separate; actual versus nominal dimensions remain distinct; no external compatibility or cross-template relationship was invented; every authoritative priced row from the supplied batch was emitted or explicitly excluded with a reason and confidence was not overstated; installation/mounting rails and cable-tray assemblies were not routed as primary Base/Model products unless the source proves they are the primary commercial product; INCLUDED-hardware rows remain distinct from REQUIRED-SEPARATE-hardware rows; discontinued/shortly-discontinued status was preserved; the composed supplier-code warning was emitted only with explicit source proof of code composition; PTS/point values stayed raw and unconverted with currency null; sources[].pageNumber used one consistent numbering system for the batch; every discontinued status is bound to the exact visual family/table block the source marks, not parsed-text adjacency; every INCLUDED or REQUIRED-SEPARATE mounting statement is supported by its own exact target family/row source block, never inherited from an adjacent family; every row-level INCLUDED or REQUIRED-SEPARATE mounting statement has explicit evidence in that exact commercial row/family block; a source-silent mounting family did not inherit commercial mounting status from a neighbouring family or general installation diagram; every supplied commercial page was checked code-by-code, not merely listed in sources[]; every authoritative priced supplier code is emitted exactly once or named explicitly as still unextracted; no "complete through page X" warning is emitted while an earlier supplied page still has unaccounted authoritative supplier codes; and separately priced sibling installation families were not sampled or collapsed merely because they share the same mounting role.`;

const accessoriesElectrificationExtractionContract = `ACCESSORIES / ELECTRIFICATION CATALOGUE EXTRACTION
Accessories may be standalone direct-priced products, product-local optional accessories, required separate companions, conditional options, installation/support components, configurable electrification systems, accessories with their own required components, included parts, compatibility-restricted accessories, or manufacturer-finish-coded accessories. Preserve manufacturer truth; do not force every item into one commercial behavior.

ACCESSORY COMMERCIAL TABLE COLUMN BINDING
When the source presents a dense commercial table with columns such as W | D | H | CODE | PTS or equivalent translated headings, bind values strictly by the visible column headers and row alignment.

For every commercial row, read in this order: (1) W / width; (2) D / depth; (3) H / height; (4) CODE / supplier article code; (5) PTS / price.

Never shift a numeric value into an adjacent field.

Examples of prohibited extraction errors: using PTS as width, depth, or height; using width as price; using height as price; moving one row's price into the next row; reversing W/D/H merely because the product illustration is rotated; assuming the largest number is the price; assuming the final numeric value before CODE is price.

The visible table column boundaries are authoritative.

Before emitting each Accessories commercial row, verify: source dimensions -> structured dimensions; source CODE -> supplierCodes; source PTS -> price. Do not derive one field from another.

ACCESSORY ROW TOKEN LEDGER
For every dense commercial table row, build this internal row ledger BEFORE creating JSON: SOURCE ROW TOKENS: [W] [D] [H] [CODE] [PTS] [OPTIONS] [CBM] [KGS] [PARCELS]. Bind each visible cell exactly once.

Example: 200 | 60 | 18 | ABCO001 | 39 | ... must become: width = 200; depth = 60; height = 18; supplierCode = "ABCO001"; price = 39.

It is INVALID to rotate or shift this into: width = 60; depth = 18; height = 39; price = 200. Do not reinterpret a row based on product orientation or numeric magnitude.

Before returning each row, reconstruct: width | depth | height | supplierCode | price and compare it back to the same visible source line.

BLANK DIMENSION CELL PRESERVATION
If a visible commercial row contains fewer W/D/H numbers before CODE, preserve the missing axis as null.

Example: 12.5 | 12.5 | [blank] | ABCO123 | 211 must become: width = 12.5; depth = 12.5; height = null; price = 211. Never move PTS into the blank H field.

NUMERIC CROSS-FIELD COLLISION CHECK
Before returning each row, verify that a numeric source value was not reused in two unrelated fields merely because of table-reading ambiguity.

Example: if source shows W 12.5, D 12.5, H blank, CODE ABC123, PTS 211, then: width = 12.5; depth = 12.5; height = null; price = 211. Do NOT emit height = 211 or price = 211 as the same value unless the source independently prints 211 in both columns.

Likewise, do not use a PTS value as a dimension or a dimension as PTS.

Add a final suspicious-collision check: If price equals one of width/depth/height, verify the source independently prints the same numeric value in both columns.

If the source prints W55 D55 H174 CODE XYZ PRICE86, the extraction must be: width = 55; depth = 55; height = 174; price = 86. Not: price = 174.

SUPPLIER CODE CHARACTER FIDELITY
Supplier article codes must preserve every character exactly as printed. Pay special attention to visually similar characters: letter O vs digit 0; letter I vs digit 1; letter S vs digit 5; letter B vs digit 8. Never normalize or guess these characters. If a source code visibly contains ...O..., do not emit ...0..., and vice versa.

Before returning each supplier code: (1) compare the complete extracted code against the same visible source row; (2) verify every alphabetic/numeric character; (3) preserve original capitalization.

When OCR/parsed text conflicts with the visible table image, use the visible commercial table as authority. Do not silently repair a supplier code by pattern matching against neighbouring codes.

For every code containing an O/0-like glyph, compare the character against the visible source image before final output. Do not infer code characters from generated ID patterns. Generated row/item IDs may normalize formatting for internal stability, but supplierCodes MUST preserve the manufacturer code exactly.

The following transformation pattern is explicitly prohibited: ABCO001 -> ABC0001, or: ABCO03 -> ABC003, unless the printed source itself contains zero.

ACCESSORY VISUAL BLOCK BINDING
When one supplied catalogue page contains several accessory products with adjacent diagrams, dimensions, capacities, clamp ranges, VESA references, cable lengths, technical callouts, or other annotations, bind every fact to the exact visual commercial product block that owns it.

Determine ownership using: table-row boundaries; product-heading boundaries; illustration boundaries; leader lines; horizontal/vertical alignment; spacing; source grouping.

Do NOT transfer a technical fact from a preceding or following accessory row merely because parsed PDF text places the fact nearby. A fact shown inside Product A's visual block belongs to Product A unless the source explicitly states that it applies more broadly.

Before returning each accessory row, verify that every technical fact in specification, dimensions, and displayName belongs to that exact commercial row/family block.

Final check: Technical facts from neighbouring accessory rows were not cross-assigned.

SAME-PAGE FACT OWNERSHIP MUST BE VERIFIED ROW BY ROW
When a page contains Product A, Product B, and Product C vertically in separate commercial blocks, do not assign a technical fact to a product until its visual ownership is confirmed.

For EACH technical fact such as VESA size, screen-size range, maximum load, maximum desktop thickness, clamp opening range, cable length, wattage, colour temperature, plug type, or adjustment range, perform this check: FACT -> identify the illustration/text block containing the fact -> identify the commercial supplier-code row belonging to that block -> attach the fact ONLY to that row. Never use parsed-text sequence alone.

If one fact visually sits below Product A's commercial row but inside Product B's illustrated block, it belongs to Product B.

If ownership cannot be established confidently: omit the uncertain fact from the row specification; add an extractionWarning if commercially important. Do not copy the fact to both neighbouring products as a hedge.

Final mandatory check: For every multi-product source page, re-check each row's specification against its own visual block before returning JSON.

STANDALONE VS PRODUCT-LOCAL ACCESSORIES
When an accessory is independently sold, directly priced, and commercially usable as its own quotation item, extract it as Base / Model. Typical examples: monitor arms, desk lamps, CPU holders, footrests, waste bins, coat stands, coat hooks, desktop organizers, standalone electrical units, and freestanding cable-management items. Do NOT force independently sold accessories into optionGroups merely because the manufacturer catalogue calls them "Accessories".

Ordinary standalone accessory commercial families remain ordinary pricing.baseModelRows. Do NOT use pricing.baseModelRows[].groupId or groupLabel merely to organize Accessories into visual families such as Monitor Arms, CPU Holders, Cable Management, Waste Bins, Clothes Hangers, Desk Accessories, or Electrification. pricing.baseModelRows[].groupId and groupLabel are reserved for the existing Native System/Base architecture only, where the source proves a genuine first-stage priced System/Base selection with downstream Main Products. For ordinary Accessories: emit normal Base/Model rows with NO groupId; emit NO groupLabel; emit NO role = 'system_base'; preserve manufacturer family identity through labels/specification/source evidence; Smart Setup / Planning may create visual commercial families/subgroups later. Do not use Native System/Base metadata as a generic visual-grouping mechanism.

When an accessory exists specifically to be selected while configuring another product, route it to optionGroups ONLY when its parent/trigger can be represented inside the CURRENT ProductTemplateDraft, using the correct commercial role: Normal Accessory, Conditional Option, or Required Companion. Do not convert every accessory catalogue item into a local option.

Examples of valid local triggers: an already-emitted Base/Model row; an already-emitted Matrix row; an already-emitted Modular row; an already-emitted Workstation row; an already-emitted optionGroups item.

If the accessory belongs to an EXTERNAL Product Template or named external product family that is not represented in the current draft: do NOT invent an unscoped optionGroup applicability rule; do NOT create cross-template conditionalConfiguration; preserve the authoritative accessory SKU/code/price as commercial data when the supplied source directly prices it and it is commercially relevant to the Accessories catalogue; preserve the external family compatibility/restriction in specification, planning evidence, linkedFamilySuggestions, or extractionWarnings as the existing contract permits; add "CONFIGURATION-DEPENDENT - MANUAL DECISION" when configuration depends on that external context and cannot be safely represented.

Planning later decides Standalone Product, Include Locally in the parent template, Both, or Manual Decision. Extraction must not pretend an external parent is a local target. Extraction should preserve enough evidence for Planning to later decide Standalone Product, Include Locally, Both, or Manual Decision; extraction itself must not duplicate the same item automatically.

ACCESSORY COMMERCIAL STATUS
Classify accessory/component status exactly. INCLUDED: explicitly supplied as part of the selected commercial item (for example mounting brackets included, clamp included, cables included, power lead included). Preserve INCLUDED facts in specification. Do NOT place a purely included fact in importantRequirements; importantRequirements is only for a separate actionable obligation or restriction. Do NOT create another priced accessory charge for an INCLUDED component.

Example:
Source: "Mounting brackets included"
Correct: specification = "... Mounting brackets included." ; importantRequirements = []
Incorrect: importantRequirements = ["Mounting brackets included"]

PREPARED FOR: holes provided, cutout provided, pre-drilled, or provision for module — preserve preparation status and do NOT assume the accessory itself is included. REQUIRED SEPARATE ITEM: explicit source wording such as must be ordered separately, always complete with, requires, or add Art.X — use Required Companion when exact applicability is safely representable. OPTIONAL SEPARATE ITEM: source-supported compatible/optional item — use Normal Accessory or Conditional Option as appropriate. UNCONFIRMED: if source evidence is unclear, do not guess; preserve warning/manual decision.

ACCESSORY -> REQUIRED ACCESSORY
ProjectWorkflow supports option_item targeting. When a selected accessory itself requires another component, for example Monitor Arm -> Through-Desk Clamp required, or Data Module -> compatible Cover required, emit the required dependent item using target.kind = option_item. Do not duplicate the parent accessory as a synthetic combined SKU.

CONFIGURABLE ELECTRIFICATION
Recognize configurable electrification without inventing arbitrary recursive dependency graphs. A supported generic pattern is: Main Power Unit -> selectable connector/data module(s) -> required compatible cover/adapter for the selected module.

Recommended extraction shape:
A. Independently sold Main Power Unit -> Base/Model direct-priced row.
B. Independently selectable USB / HDMI / RJ45 / Audio module -> optionGroups item.
C. Cover or adapter explicitly required because that exact module was selected -> Required Companion using target.kind = 'option_item' targeting that exact already-emitted module item.

This is one option_item-triggered required-companion relationship. Do NOT manufacture an additional artificial "Custom Module Slot" priced item when the source only shows the slot/capacity as part of the Power Unit construction. Do NOT invent recursive chains such as Power Unit -> Slot -> Module -> Adapter -> Cover unless every independently priced commercial item and every dependency is explicitly source-proven AND supported by the current draft contract. When deeper dependency behavior cannot be represented safely: preserve all authoritative commercial rows; preserve their source relationship; add "CONFIGURATION-DEPENDENT - MANUAL DECISION"; do not synthesize combined SKUs.

CUSTOM MODULE SLOT CAPACITY MUST MATCH THE SELECTED MAIN UNIT
If manufacturer Base/Model rows explicitly provide different module capacities, such as Main Unit A -> 1 custom module slot, Main Unit B -> 3 custom module slots, do NOT use one shared optionGroup with maxSelections = 3 for both units. Preserve the capacity structurally.

Use separate applicability/configuration groups where necessary so that: 1-slot units allow maximum 1 selected custom module; 3-slot units allow maximum 3 selected custom modules. The same manufacturer module family may be represented in separate configuration groups only when required to enforce these source-proven, mutually exclusive slot capacities.

Do not let a 1-slot product select 2 or 3 modules. Do not invent a priced "slot" item. If current draft structure cannot express different limits safely without duplicating configuration items, emit "CONFIGURATION-DEPENDENT - MANUAL DECISION" rather than applying the broader maxSelections to every unit.

Do NOT pre-compose Power Unit + HDMI + Cover as one fake commercial SKU unless the manufacturer itself publishes that combination as an authoritative priced SKU. Do NOT flatten all possible combinations into synthetic SKU rows.

For independently priced data/media modules and covers: preserve exact supplier codes character-for-character; do not confuse the letter O with zero in module codes; verify every dependency against the exact source item.

If one module explicitly states "does not require cover", do NOT attach the required-cover companion rule to that module. If another module explicitly states "Cover X or Cover Y not included, to be ordered separately", preserve module -> exactly one compatible cover using option_item applicability when representable. Never generalize one module's cover requirement across all sibling modules.

MULTIPLE MODULE SELECTION
When source allows multiple distinct modules/components, use a multi-selection architecture. Preserve multiple different items, individual quantity per item, and source-supported maximums where explicitly stated. Do not force exactly_one unless source requires exactly one. If source says "up to 3 modules", preserve that maximum. Do not infer a maximum from a drawing alone.

REQUIRED COVER / ADAPTER RELATIONSHIPS
If a module explicitly requires one cover, one of two compatible covers, an adapter, a clamp, or a fixing kit, extract the dependency structurally when supported. Example architecture only: Module A -> Cover X required; Module B -> exactly one of Cover X / Cover Y. Use separate Required Companion groups when independent components are simultaneously required.

COMPATIBILITY BY DISCRETE ROW/ITEM
If manufacturer compatibility maps to an actual extracted row or option item, use exact applicability: a specific accessory only for one Base/Model row, one clamp required when a particular option item is selected, or an accessory available only with one exact product variant. Do not broaden compatibility beyond source evidence.

ATTRIBUTE / EXTERNAL-CONTEXT LIMITATION
If compatibility depends on a condition that is NOT represented by an exact current row/item identity, do not invent conditionalConfiguration. Examples: desktop thickness = 18 mm, glass vs melamine top, external desk range X1/X3/X5, desk vs bench in another Product Template, mounting position, or external cable-tray state. Preserve the manufacturer condition, compatible item codes, and exclusions, and flag "CONFIGURATION-DEPENDENT - MANUAL DECISION" unless the condition maps to a discrete extracted row/item in the current template.

EXTERNAL PRODUCT COMPATIBILITY
Accessories may explicitly support or exclude named product ranges. Preserve statements such as for X1 / X3 / X5, not for X4, not for glass tops, only for bench, or only for meeting tables. Do NOT create cross-template conditional rules and do NOT duplicate external parent products into the Accessories template; preserve this as compatibility evidence / planning guidance.

INSTALLATION / SUPPORT ITEMS
Recognize support items such as clamps, brackets, cutouts, drilling services, cable trays, risers, cable spines, cable towers, desk rails, and fixing kits. Do not treat an installation/support item as the main product merely because it has its own code and price. However, if the item is genuinely independently sold and quoted, preserve its authoritative commercial row; Planning will decide Standalone vs Local strategy.

CUTOUT / DRILLING SERVICES
Some catalogues separately price factory cutout, drilling, routing, or hole preparation. Preserve these as commercial items when they have authoritative codes/prices. Do NOT classify the cutout as INCLUDED when the source says "cutout not included". If a specific accessory explicitly requires the cutout, use Required Companion / option_item dependency when safely representable. If installation position or parent-product geometry is external context, preserve as MANUAL DECISION.

ELECTRICAL MARKET VARIANTS
Preserve market-specific variants such as Schuko, UNEL, UK, and US as authoritative separately priced variants when source gives different codes/prices. Do not merge them into finishes. Do not convert them into Category/Matrix unless the manufacturer genuinely uses a row × market-category price matrix.

ZERO PRICE
A source value of 0 is not null. If an authoritative accessory row explicitly has 0 / 0.00 / 0 PTS, preserve zero. Do not remove the row or convert zero to missing price.

ZERO PRICE COLUMN VERIFICATION
When the PTS/price column visibly contains 0, 0.0, or 0.00, preserve price = 0. Do not: replace it with a neighbouring row's price; replace it with a width/height value; treat it as missing; skip the row. For every zero-price row, explicitly re-check the same visual row across CODE -> PTS before returning JSON. A visible zero price is a hard commercial value.

When a row has price = 0, lock that row's price before reading the next commercial row. A following sibling price must never overwrite or replace the zero.

Example source sequence: CODE-A -> 0; CODE-B -> 198; CODE-C -> 227 must remain: CODE-A price = 0; CODE-B price = 198; CODE-C price = 227. Never propagate the first non-zero sibling price backward.

ACCESSORIES PTS / POINT PRICING
If source prices are PTS / points, preserve numeric values exactly, keep currency null, do not assume EUR/AED/USD, and add a warning that point-to-price conversion is required. Do not convert during extraction.

FINISH CODES
Distinguish finish/material code, supplier article code, and complete commercial order code. Finish code alone does not justify a separate pricing row when price is the same. Preserve finish options as Manufacturer Finish Guidance / finish data.

ACCESSORY FINISH AVAILABILITY SCOPE
When different accessory rows/families visibly support different finish-code sets, do NOT create one broad materialSuggestion whose wording implies that every listed finish applies to every accessory. Preserve finish applicability only to the scope supported by the source. When Product A supports finish set A and Product B supports finish set B, do not merge A + B and present the union as universally available.

Use one of these safe approaches:
A. Create separate materialSuggestions for meaningful source-supported accessory families/finish sets.
OR
B. If a batch-level summary is genuinely useful, use neutral wording such as: "Finish codes observed across the supplied accessory batch; availability varies by accessory row/family."

Do NOT state or imply universal finish availability unless the supplied source proves it.

ACCESSORIES COMPOSED SUPPLIER CODE
Some accessory catalogues explicitly require base article code + finish code = complete commercial order code. If and only if source explicitly proves this: preserve base article code, preserve finish code separately, do NOT duplicate pricing rows per finish, do NOT invent concatenated codes, and add "COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED". This warning is mandatory when explicit source evidence proves composition. Finish codes by themselves are NOT sufficient evidence.

The explicit code-composition instruction itself must be visibly present in the CURRENT supplied extraction batch. Do not emit "COMPOSED SUPPLIER CODE - RUNTIME SUPPORT REQUIRED" merely because current pages show article codes; current pages show finish codes; an earlier catalogue page or previous extraction batch proved composition. If the current supplied batch does not contain the explicit composition instruction, omit the warning and request/support that rule only when the relevant page is supplied.

ACCESSORY COMMERCIAL FAMILIES
Preserve manufacturer-defined families such as Desk Accessories, Monitor Arms, CPU Holders, Cable Management, Cable Trays, Cable Risers, Electrification, Power/Data Modules, Storage Accessories, Coat Stands, Waste Bins, Locks / Keys, and Modesty Panels. Do not automatically create one Product Template per family: extraction preserves commercial identity, and Planning decides template consolidation.

MODESTY PANELS / LARGE ACCESSORIES
Some catalogues place substantial furniture-like products under Accessories, for example modesty panels, wall shelves, and desk-mounted panels. If they have authoritative direct SKU pricing, preserve them as direct commercial rows. Do not downgrade them to a small option merely because the chapter heading says Accessories. Preserve INCLUDED brackets exactly when stated.

ACCESSORY SOURCE-SILENT STATUS
Never inherit accessory commercial status from an adjacent family. If Family A says "brackets included" and Family B is silent, do not mark Family B as included. Likewise do not inherit required separately, optional, prepared for, discontinued, or compatible status from neighbouring rows/families. Exact visual family/table evidence controls.

ACCESSORY DISCONTINUED ITEMS
Preserve source-marked discontinued, shortly discontinued, obsolete, or while stocks last status. Do not remove authoritative commercial rows solely because they are discontinued; preserve the status/warning.

ACCESSORY SOURCE COMPLETENESS
For every supplied commercial page, account for every authoritative priced supplier code. Each must be emitted exactly once in pricing/optionGroups, or explicitly named as still unextracted in extractionWarnings. Do not sample representative accessory rows. Do not claim "complete through page X" while earlier supplied pages still contain unaccounted commercial codes.

SOURCE PAGE ACCOUNTING MUST MATCH EMITTED ROWS
For every supplied page that contributes at least one emitted commercial row or option item, sources[] MUST contain a page entry for that exact page. If a 10-page supplied batch contributes data from all 10 pages, sources[] must account for all 10 pages.

Do not collapse multi-page evidence into one source entry with pageNumber = null when page numbers are available from the supplied PDF.

Before output, build an internal page -> emitted supplier codes ledger and verify every used page is represented in sources[].

Every emitted commercial row must be backed by at least one page present in sources[] from the CURRENT supplied batch. If rows from supplied PDF page 10 are extracted, sources[] must include that page.

Do not: extract rows from a page and omit that page from sources[]; claim a 9-page source list while emitting commercial data from page 10; use remembered/adjacent pages.

Before returning JSON: (1) identify the highest/lowest supplied page actually used; (2) verify every used page is represented in sources[]; (3) verify no sources[] page lies outside the supplied batch.

ACCESSORIES SOURCE PAGE FIREWALL
sources[] must contain only pages supplied in the current extraction call. Do not use adjacent PDF pages, previous conversation pages, or remembered catalogue pages. If required context is outside the supplied batch, add a supplemental-extraction warning.

FINAL ACCESSORIES VALIDATION
Before output verify: standalone accessory SKUs were not forced into optionGroups; product-local accessories were not incorrectly made standalone rows; INCLUDED items are not double charged; PREPARED FOR is not treated as INCLUDED; required separate items remain required; option_item dependencies preserve accessory -> accessory relationships; configurable electrification was not flattened into fake SKU combinations; multi-select modules remain multi-select where source supports them; attribute/external conditions were not invented as row rules; cross-template compatibility remains evidence/manual guidance only; cutout/drilling charges remain separate when source prices them separately; electrical market variants remain authoritative variants; zero price remains zero; PTS is not treated as currency; finish codes are not mistaken for price categories; the composed supplier-code warning appears only with explicit evidence; source-silent status was not inherited from adjacent families; discontinued rows remain present; every supplied priced code is accounted for; sources[] obeys the supplied-page firewall; product-local optionGroups were created only when their parent/trigger exists inside the current ProductTemplateDraft; and external-product compatibility did not create an unscoped local option group.

ACCESSORIES JSON ESCAPING CHECK
Before returning JSON, inspect every Accessories-generated label, displayName, specification, importantRequirements string, materialSuggestion text, linkedFamilySuggestion text, extractionWarning, and sources[].rawText for literal double quotes. Manufacturer inch marks and quoted product/model names MUST be valid JSON string content.

Example source text: 15" to 24"
Valid JSON string content: 15\\" to 24\\"

Example source product name: PORTA-ABITO "LOOP"
Valid JSON: "label": "PORTA-ABITO \\"LOOP\\""

Never return an otherwise-correct Accessories extraction that fails JSON.parse because an inch mark or quoted manufacturer/model name was copied without JSON escaping. Do NOT change the existing global STRICT JSON STRING ESCAPING contract.

ACCESSORIES JSON.PARSE HARD GATE
Immediately before returning the final Accessories JSON, perform this final logical validation: (1) treat the complete response as the exact text that will be passed to standard JSON.parse; (2) inspect every JSON string for unescaped literal double quote characters; (3) correct every embedded manufacturer inch mark or quoted commercial name before returning the response; (4) if the response would fail JSON.parse, DO NOT return it until corrected.

Examples of INVALID final JSON:
"specification": "Suitable for 15" to 24" screens."
"label": "PORTA-ABITO "LOOP""

Examples of VALID final JSON:
"specification": "Suitable for 15\\" to 24\\" screens."
"label": "PORTA-ABITO \\"LOOP\\""

The JSON escaping requirement applies to the FINAL SERIALIZED JSON, not merely to the internal meaning of the string.

Final mandatory check: THE EXACT RETURNED ACCESSORIES RESPONSE MUST BE ACCEPTED BY JSON.parse.

Before returning, explicitly scan label and displayName for manufacturer names wrapped in quotation marks. Example source name: "Catch" must serialize as: \\"Catch\\" inside the final JSON string. The exact returned text must still pass JSON.parse.

Also verify: no technical fact from an adjacent accessory row was assigned to the wrong product; no variable/range dimension was collapsed into a single scalar minimum or maximum; all variable ranges remain preserved in dimensions.rawText and/or specification; source-supported sibling count/size distinctions remain visible; a collection/range heading was not used as supplierName without explicit manufacturer/supplier evidence; finish-code availability was not broadened beyond the exact source-supported row/family scope.

HARD FAIL BEFORE RETURN:
Do not return the Accessories JSON until all are true: the exact serialized response passes JSON.parse; no unescaped inch mark or quoted manufacturer/product name remains inside a JSON string; every technical fact on a multi-product page has been bound to its own visual commercial block; no VESA, clamp range, desktop-thickness range, load, cable, plug, or other technical fact leaked into an adjacent product; every visibly supplied sibling count/size/configuration distinction is preserved in the relevant row. If any one of these checks fails, correct the draft before output.

Also verify that ordinary Accessories Base/Model rows do NOT contain groupId or groupLabel merely for visual/commercial family grouping. groupId/groupLabel are present only if the manufacturer source independently proves genuine Native System/Base architecture. Examples such as Monitor Arms, CPU Holders, Waste Bins, Clothes Hangers, Cable Management, and Desk Accessories are ordinary commercial families, not System/Base groups by name alone.

Do not invent template.templateCode or template.internalSelectionName. If the current manufacturer source does not explicitly provide an authoritative template/product-family code suitable for templateCode, use null. If internalSelectionName is not source-proven or supplied by ProjectWorkflow context for this extraction call, use null. Generated convenience identifiers belong in row/group IDs, not authoritative templateCode/internalSelectionName fields.

ACCESSORIES CONFIDENCE DISCIPLINE
Do not return confidence above 0.90 if any of these remain unresolved: supplier-code character uncertainty; table-column ambiguity; unverified zero price; missing source-page accounting; uncertain commercial row ownership; incomplete accessory rows. A confidence such as 0.95 or 0.98 is inappropriate when authoritative commercial values remain uncertain.

Confidence above 0.90 is allowed only after ALL of these pass: exact W/D/H/CODE/PTS row reconstruction; zero-price verification; O/0 supplier-code verification; page-by-page source accounting; option-slot capacity verification; final JSON.parse validity. If any one fails or remains uncertain, confidence must be <= 0.90.

Also verify before return: W/D/H/CODE/PTS were bound from their exact visible columns; no PTS value was reused as width/depth/height; no dimension value was reused as price; every visible 0 price remains exactly 0; supplier codes preserve O versus 0 exactly; every extracted page contributing commercial rows exists in sources[]; module-specific "cover required" versus "no cover required" behavior was not generalized across sibling modules.`;

const globalExtractionArchitectureContract = `GLOBAL EXTRACTION ARCHITECTURE DECISION CONTRACT - APPLY BEFORE THE SELECTED FURNITURE FOCUS
First identify the manufacturer-defined commercial/product family and its source boundaries. Extract one clean selected family at a time. Do not absorb nearby unrelated families into the same ProductTemplateDraft unless the user explicitly included them in this extraction batch. For example, a Universal Cabinets batch must not absorb Pedestals, Smart Cabinets, Lockers, or Shared-side Bookcases merely because they are nearby in a Storage chapter.

GLOBAL PRICING ROUTING ORDER
Evaluate every source structure in this order: (1) BASE / MODEL, (2) CATEGORY / MATRIX, (3) MODULAR.
- BASE / MODEL may also represent a native multi-stage System family when all commercial rows have direct scalar prices and no Matrix/Modular pricing is required: a native System group holds one or more role "system_base" rows plus ordinary Main Product rows, and this remains Base/Model pricing. Do NOT use Modular merely because System + Main are both required to complete the configured product; Modular still requires actual source-proven component/module composition.
- BASE / MODEL is the default for every authoritative PRIMARY sellable product SKU row with its own supplier code, direct price, dimensions/configuration, and identity. The primary product is what the user would select first, such as a cabinet, pedestal, CPU holder, service unit, desk, chair, sofa, or meeting table. Multiple rows, sizes, finishes, handed variants, or catalogue headings do not justify Matrix or Modular.
- CATEGORY / MATRIX requires a genuine manufacturer-proven commercial category dimension, such as Model row x Fabric Cat A / B / C / D or explicit finish-price classes. An ordinary SKU row x one column labelled "Standard Price" is an invalid one-column fake Matrix and is explicitly forbidden. When each PRIMARY product SKU has category-dependent prices and there is NO source-proven Modular composition, use pricing.priceMatrices. When the SAME category-priced rows also participate in source-proven Modular composition such as starter + extension/add-on, do NOT stop at top-level pricing.priceMatrices; route the family to Matrix Modular under pricing.modularGroups so both the category-dependent price map and the structural role/composition are preserved. When a SUPPORTING accessory has category-dependent prices, keep it in optionGroups with priceCategories and item prices. When each SKU has only one direct price and there is no Modular composition, use pricing.baseModelRows.
- MODULAR requires source-proven component-built composition, such as terminal/intermediate/end units, sofa modules, workstation compositions, or shared-side bookcases. Ordinary size, finish, LH/RH, open/closed, accessory, and catalogue-layout variation must not trigger pricing.modularGroups. Preserve authoritative terminal/intermediate or other genuine module rows when composition is proven.

GLOBAL WORKSTATION ROUTING PRINCIPLE
The words "workstation", "bench", "cluster", and "operative" do not automatically mean pricing.workstationRows. First identify the manufacturer's actual commercial pricing architecture for that family, evaluating in this order: (1) a complete direct-priced SKU with one direct authoritative price and no source-proven structural composition belongs in pricing.baseModelRows even when the manufacturer calls it a workstation, bench, cluster, or operative desk; (2) simple supported Workstation/bench pricing that fits the current narrow pricing.workstationRows model uses an authoritative complete row price, optional supported additional/cluster price, and no free-form starter/add-on composition; (3) genuine manufacturer-proven row-by-category or finish-price-class pricing with NO source-proven structural composition belongs in pricing.priceMatrices; (4) source-proven component/module composition such as starter/add-on or structure-plus-top-plus-finish pricing belongs in pricing.modularGroups: use Direct Modular when module rows have scalar prices, and Matrix Modular when those same composable module rows have category/finish-dependent price maps. Use the structure that preserves manufacturer truth with the least unnecessary complexity, and never move a direct-priced workstation/bench SKU into pricing.workstationRows merely because the source uses one of those words.

NATIVE SYSTEM / BASE PRECEDENCE
When manufacturer evidence proves that a separately priced furniture item is a PRIMARY first-stage commercial System/Base selection that determines which downstream Main Products are available, route that item into pricing.baseModelRows with role "system_base", and assign it a native groupId/groupLabel together with its compatible Main Product Base/Model rows. This native System/Base routing takes precedence over the structural_support option-item workaround. Indicators may include manufacturer evidence that: the user first chooses a base/system/service structure; specific desks/benches/products are explicitly "for" that system; main products fix to or integrate with that system; the system/base itself has its own authoritative SKU/code/price; the system choice determines the downstream Main Product family. Do NOT infer system_base merely from words such as cabinet, storage, service unit, support, base, pedestal, return, or bridge; source evidence must prove it is the primary first-stage priced system selection. Use native role "system_base" when the item is a primary first-stage priced System/Base selection, independently selected before the Main Product, that structurally/commercially defines the downstream Main Product family. Use optionGroups item role "structural_support" only when the item is instead genuinely a supporting/companion item, not the primary first-stage commercial system selection, attached to an otherwise independently selected Main Product, and appropriately modeled through the existing accessory/companion runtime. Do NOT emit the same item as BOTH a role "system_base" Base/Model row AND a role "structural_support" option item; native system_base takes precedence when its evidence criteria are satisfied.

NATIVE SYSTEM GROUP MEMBERSHIP
pricing.baseModelRows stays one flat array; native grouping is expressed with the optional row fields groupId and groupLabel. Every System/Base row and every Main Product row belonging to that System uses the same groupId (for example, System A: one System/Base row A plus Main Product rows A1 and A2 all carry "groupId": "system-a" and "groupLabel": "System A"; System B rows carry a different groupId). Use one concise, stable generated groupId derived from the source-supported System identity and a concise source-faithful groupLabel. Row IDs remain globally unique within pricing.baseModelRows. A native System group may contain multiple role "system_base" rows when those System variants (for example different System widths, handed System variants, or alternative System/Base SKUs) share the same downstream Main Product families; if their downstream Main Product families differ, use separate groupIds. Do not invent cross-row compatibility metadata. Ordinary Main Product rows omit role; never emit "main_product". Do NOT invent subgroup IDs during extraction; Main Product visual subgroups are created and reviewed later in Smart Setup. Do not create a fake one-column priceMatrix to preserve System groups, and do not raise an extractionWarning merely because several native Base/Model groups exist; grouping is supported. Rows without groupId remain valid legacy Base/Model rows.

NATIVE SYSTEM COMPATIBILITY IS STRUCTURAL
For native System/Base groups, compatibility is expressed by group membership: System A and its Main Product rows share groupId "system-a". Do NOT emit compatibleTargets for a native system_base row. Do NOT encode native System -> Main Product compatibility through conditionalConfiguration, and do NOT use option_item for it. compatibleTargets remains only for the older/genuine structural_support option-item architecture.

SYSTEM_BASE REQUIRED COMPANIONS
When the source explicitly requires a separately priced companion because a native System/Base row was selected, keep the System/Base row in pricing.baseModelRows and encode the required companion with the existing optionGroup conditionalConfiguration using target: { "kind": "base_model", "group_id": "<exact native System groupId>", "row_id": "<exact system_base row.id>" }, required true, visible true, and fixed_quantity only when source-proven. Do NOT use target.kind "option_item" for a native system_base row, and do NOT use group_id "${LEGACY_BASE_MODEL_GROUP_ID}" when the target row has a native groupId. For target.kind "base_model": NEVER emit scale_with_target_quantity (the runtime permits it only for modular or option_item targets); use fixed_quantity when the source proves a fixed required quantity; quotation-item quantity already multiplies the configured complete product later; omit scale_with_target_quantity entirely and do not emit false.

NATIVE SYSTEM PRICES ARE INDEPENDENT
Under native System/Base architecture the System/Base price and the Main Product price are TWO independent authoritative prices. Do NOT calculate System price + Main price inside extraction, do NOT emit a synthetic combined SKU, and do NOT merge the System/Base price into the Main row price; ProjectWorkflow runtime sums both selected rows later. A priced System/Base plus separately priced Main Product rows explicitly designed for that System are one native Base/Model group (System row role "system_base", Main rows ordinary with the same groupId). Do NOT convert the System to an accessory, create compatibleTargets, create a fake Matrix, or make the relationship Modular unless actual modular composition is separately proven.

APPLICABILITY TARGETS FOLLOW ACTUAL PRICING ROUTING
SOURCE-PROVEN STRUCTURAL SUPPORT PRECEDENCE
This section applies only when the item is NOT a native first-stage System/Base (see NATIVE SYSTEM / BASE PRECEDENCE above). When manufacturer evidence proves that a separately priced furniture item is genuinely a supporting/companion item that acts as structural support/base equipment for the target commercial system, route it as an optionGroups item with role "structural_support" even if it has a direct price, dimensions, or supplier code. This takes precedence over the ordinary direct-priced primary SKU -> Base/Model fallback. Do not put it in pricing.baseModelRows, pricing.workstationRows, pricing.priceMatrices, or pricing.modularGroups unless the source proves it is itself the primary independently selectable product family (a primary first-stage System/Base is a native role "system_base" Base/Model row). Apply this only when explicit wording or construction/completion logic proves the target system integrates with, fixes to, rests on, or is completed by that support; never infer it from cabinet, pedestal, storage, service unit, support, return, bridge, nearby placement, visual proximity, or similar names. If the structural-support item explicitly requires another separately priced item, keep both in optionGroups: the dependent companion uses target.kind "option_item" with the exact structural-support group/item IDs and source-proven fixed_quantity. Do not target the support as base_model merely to express the dependency. After routing the structural-support item to optionGroups, if the supplied source also proves which Base/Model products use that structural support, emit compatibleTargets on that support item pointing to those exact already-emitted Base/Model row IDs (see STRUCTURAL SUPPORT / COMPATIBLE MAIN PRODUCTS below). The primary products themselves remain normal pricing.baseModelRows. Do not move compatible main desk/bench rows into optionGroups. Do not move the structural-support item back into Base/Model merely to express compatibility.
option_item is the supported exception when the dependency trigger is an already-emitted optionGroups item rather than a pricing row: group_id is that exact optionGroups[].id, row_id is that exact optionGroups[].items[].id, never supplierCodes. Never use option_item for Base/Model, Workstation, Matrix, or Modular pricing rows.
Choose target.kind only AFTER the authoritative row has been emitted into its final pricing structure; never infer target.kind from product words such as workstation, bench, or module. If the row is in pricing.baseModelRows, use target.kind "base_model"; when the row has a native groupId use group_id equal to that exact row.groupId, otherwise use group_id "${LEGACY_BASE_MODEL_GROUP_ID}". If it is in pricing.workstationRows, use target.kind "workstation" and group_id "${LEGACY_WORKSTATION_GROUP_ID}". If it is in pricing.priceMatrices[n].rows, use target.kind "price_matrix" and that pricing.priceMatrices[n].id. If it is in either pricing.modularGroups[n].matrix.rows or pricing.modularGroups[n].directRows, use target.kind "modular" and that pricing.modularGroups[n].id. In every case row_id is the exact already-emitted row.id, never a supplier code. Never point a Base/Model, Matrix, or Modular row at a workstation target.

AUTHORITATIVE ROW PRESERVATION
Every directly priced source SKU remains a separate authoritative row. Preserve its supplier code, display/model name, dimensions, direct price, currency, specification, handedness/configuration, and source traceability. Never merge distinct supplier codes or replace manufacturer-priced rows with synthetic combinations.

SUPPLIER CODE CLEANING / ADJACENT MARKERS
When extracting supplier/article codes, store only the actual commercial code. Do NOT include adjacent finish-reference markers, typography markers, footnote markers, or decorative symbols that are not part of the article code. Examples of markers to exclude when they appear adjacent to the code: (*), ( ), *, †, ‡. For example, source "1AJ M45 (*)" must emit "supplierCodes": ["1AJ M45"], NOT "supplierCodes": ["1AJ M45 (*)"]; likewise source "1AJ M33 (*)" must emit "supplierCodes": ["1AJ M33"]. Preserve the supplier prefix and article token exactly; do not remove letters/numbers that are actually part of the code, and do not normalize away legitimate suffix letters/numbers; only strip adjacent non-code finish/footnote markers. Finish-reference symbols belong in finish/material guidance if relevant, not supplierCodes. This rule is generic (not specific to any manufacturer) and applies globally to Base/Model, Workstation, Matrix, Modular, Option/Accessory, and linked/companion supplier codes.

PRIMARY PRODUCTS VERSUS SUPPORTING COMPONENTS
Do not place a separately priced supporting component in pricing.baseModelRows merely because it has its own supplier code and price. A joining ring, finishing top, side panel, handle kit, hinge kit, damper, wall-fixing kit, extra shelf, connecting bracket, cable tray, optional cushion, or feet kit normally belongs in optionGroups / Accessories / Configuration or the supported companion structure. Independently determine whether it is Required Companion, Optional / Normal Accessory, Included, or compatibility only; being a component does not prove it is required. A primary direct-priced component-like product such as a pedestal, CPU holder, or service unit may remain Base / Model when it is itself a complete independently selectable functional product, rather than merely completing, connecting, or customizing another product. For example, 1AG 967 "Joining Ring for Low Smart Cabinets" is a supporting accessory/component, not a Base / Model cabinet row; map applicability only to relevant Low Smart Cabinet rows when the source proves that mapping. Before returning JSON ask: is this row a primary usable/selectable product, or only a component used to complete/connect/customize another product? Route component-only rows to accessory/companion structures. A separately priced cabinet/service unit that is proven to be the primary first-stage System/Base selection is not a mere component; see NATIVE SYSTEM / BASE PRECEDENCE.

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

STRICT JSON STRING ESCAPING - MANDATORY
Return strict, parseable JSON only. Escape every embedded double quote inside every JSON string as \\"; escape backslashes when JSON requires it; and never paste manufacturer or source text verbatim in a way that breaks JSON. This applies to rawText, specifications, labels, warnings, notes, and every other string field. Never escape underscore _. Never emit \\_ anywhere in JSON keys or string values: "OXI\\_P", "group\\_id", and "fixed\\_quantity" are INVALID; "OXI_P", "group_id", and "fixed_quantity" are VALID. Do not use smart substitutions, Markdown fences, or prose as a workaround.

SOURCE TEXT:
BENCH ... "OXI_P" ...
VALID JSON:
"rawText": "BENCH ... \\"OXI_P\\" ..."
INVALID JSON:
"rawText": "BENCH ... "OXI\\_P" ..."

PARENT TEMPLATE IDENTITY ACROSS PARTIAL BATCHES
A page/output-limited partial batch is not a new commercial family or Product Template. Keep template.templateName, commercial family identity, and pricing architecture of the planned/source parent family; represent partial status only in extractionWarnings. For example, a low/medium-cabinet partial batch remains "Universal Cabinets", a later high-cabinet supplemental batch also targets "Universal Cabinets", 120/160 desk rows remain their parent Desk family, and 2/3-seat sofa rows remain their parent Sofa family. Never rename or split the parent template from the extracted subset unless source evidence genuinely proves a separate Product Template.

REFERENCED BUT UNSUPPLIED SUPPORT PAGES
When a supplied core page references a companion/accessory page that is not supplied (for example, "complete with finishing top — see pages 55–57"), preserve the stated requirement/reference, add an extractionWarning that the companion SKU/price is pending supplemental extraction, and do not invent its code, price, or availability.

PAGE TRACEABILITY
Preserve known source page identity for extracted commercial data wherever the ProductTemplateDraft contract permits. At minimum, sources must include meaningful pageNumber values for supplied pages when page numbers are available; do not return only pageNumber: null when source page numbers are known. For a multi-page extraction, sources must contain a distinct meaningful entry for every supplied page that materially contributes pricing rows, option/accessory items, compatibility rules, required/included relationships, or finish guidance; never collapse a multi-page batch to its first page. A single material page may use one source entry. Do not create source entries for unused pages. Each source entry should include documentName, pageNumber, region (or null), and concise rawText such as a section heading when available; never copy an entire page.

CONFIGURATION EVIDENCE
Create Included item, Required Companion, Optional Companion, allowed-item applicability, or mutual exclusion only when manufacturer evidence supports that exact relationship. "Compatible with", "suitable for", "for use with", "for X only", "for whole blind doors only", "for split blind doors", "for glass doors", "can be completed with", and "available with" prove COMPATIBILITY / ALLOWED APPLICABILITY ONLY; they do not make required=true or prove exactly-one selection. Mandatory status needs explicit evidence such as "must be completed with", "mandatory", "required", "order additionally", "cannot be used without", or "always complete with". A sold configuration described as "without shelves", "without doors", "without armrests", "without top-access", or "open cabinet" must never create the omitted component as required. "Must be fixed to wall" or "wall fixing required to prevent overturning" is an installation/safety requirement only: preserve it in row.importantRequirements (or extractionWarning when no row can safely carry it), including depth/height applicability where supported, but do not create a separately priced Required Companion. "Wall fixing kit included" is included in the base SKU and must not be duplicated as an accessory. A Required Companion is valid only when the source explicitly identifies a separate required commercial kit, for example "complete with fixing kit Art. XXX", "fixing kit must be ordered separately", or "required kit Art. XXX". "See fixing kit page X" or "compatible with fixing kit" is reference/compatibility only. If price, inclusion, requirement, compatibility, or applicability is unproven, use null, extractionWarnings, or manual-review wording as the schema permits; do not guess.

FIXED QUANTITY VS SYNTHETIC BUNDLED ITEMS
Never synthesize a bundled/multiplied item such as "2 x ART.058", "3 x bracket", or "set of 4 feet" when the manufacturer publishes a single unit SKU and separately states a required quantity, for example "always complete with 2 ART.058". Preserve the manufacturer's original item identity, supplier code, and unit price unchanged: ART.058 at supplier code 111 058, unit price EUR 69, remains one row priced at EUR 69, never a synthesized EUR 138 item. Only extract a bundle/kit/set as one priced row when the manufacturer itself sells and prices it as a single commercial kit/set SKU with its own code and price. Never calculate or store unit price × required quantity as a new authoritative item price. Preserve the required quantity in the companion optionGroup's conditionalConfiguration.applicability[].fixed_quantity (see OPTIONGROUPS.CONDITIONALCONFIGURATION - ROW-SPECIFIC ENFORCEMENT) and in importantRequirements; it must never be baked into a new item price or a duplicated/multiplied row. This rule applies to every furniture focus, including chair/sofa feet kits, cabinet wall-fixing components, handles, grommet sets, shelves, screens, and support legs, without changing existing furniture-specific routing logic.

ROW-SPECIFIC REQUIRED/OPTIONAL APPLICABILITY
A Required Companion or Conditional Option may target base_model, price_matrix, modular, or workstation pricing rows, or option_item only when an already-emitted optionGroups item is the dependency trigger.
A Required Companion, Conditional Option, or optional accessory whose compatibility is limited to specific Base/Model, Category/Matrix, Modular, or Workstation rows is incomplete unless the extraction emits explicit applicability naming the exact target row(s), never a vague or collection-wide requirement. Use the companion optionGroup's conditionalConfiguration.applicability, with one rule per target row using target: { kind, group_id, row_id } from the exact supported target kinds base_model, price_matrix, modular, and workstation (see OPTIONGROUPS.CONDITIONALCONFIGURATION - ROW-SPECIFIC ENFORCEMENT), for example a rule targeting workstation rows 111 623 and 111 624, plus allowed_item_ids and fixed_quantity when the source proves them. Do not create a globally required companion when the source requirement applies only to selected rows, and do not rely on generic wording such as "applicable rows" without naming them structurally. importantRequirements remains informational/user-facing (for example "Always complete with 2 Art.058 top-access units.") and must still be emitted for every such obligation; it does not replace conditionalConfiguration, and neither field may substitute for the other.

SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL
Extract only products, rows, prices, requirements, and components whose authoritative source is visibly present in the supplied extraction batch for this call. Do not extract from prior planning output, examples embedded in this prompt, earlier catalogue knowledge, remembered manufacturer data, page references mentioned in instructions but not supplied, or other uploaded batches not included in this call. Every code, price, dimension, requirement, and page number shown in this prompt's own rules and regression examples (for example OXI, X3, Terra/Piem, or Colan codes) is a NON-SOURCE architectural example only, never source authority; re-read and verify every extracted value against the supplied source files, and never output a prompt example's code/price/page as authoritative extracted data. If a required or referenced component/row lies outside the supplied pages, preserve the reference in specification/importantRequirements/extractionWarning, do not invent its code/price/details, and request supplemental extraction naming the exact missing page range. When the supplied batch covers non-contiguous pages, for example printed pages 10–15 and 20, extraction coverage must reflect exactly those supplied pages; add an extractionWarning naming the exact unsupplied pages still needed, for example "Supplied extraction batch covers printed pages 10–15 and 20. Printed pages 16–19 remain unextracted.", and never imply that an unsupplied page in between was covered.

SUPPLEMENTAL BATCHES / ADD MORE JSON
The supplied source may be a later batch of components, doors, hardware, accessories, finishes, or other supporting pages. When it is clearly supplemental, extend the existing selected family, preserve existing authoritative rows, add only missing components/applicability, and return supplemental JSON suitable for + Add More JSON. Do not rename or restructure the main family or create a duplicate Product Template merely because this is a new JSON batch. Preserve source codes and identities so existing merge logic can detect duplicates.

FINISH VERSUS PRICE
Finish pages with codes, colours, or availability but no explicit price difference normally produce materialSuggestions, Manufacturer Finish Guidance, or option metadata - not pricing rows. Create a pricing Matrix only when the source explicitly proves category-based price variation.

GLOBAL EXTRACTION SELF-CHECK - CORRECT BEFORE RETURNING JSON
Also verify that a source-proven structural-support item was not emitted in pricing.baseModelRows merely because it has a direct price, is emitted once only rather than duplicated in pricing rows and optionGroups, its required companion targets that exact option item, and scale_with_target_quantity was not emitted for an unsupported target kind. Also verify that a source-proven structural-support item with proven exact main-product compatibility was not returned without compatibleTargets; that compatibleTargets points only to exact already-emitted Base/Model row ids, never a supplier code or an invented Smart Setup subgroup id; that support -> main compatibility was not incorrectly encoded as option_item conditionalConfiguration; that support -> required companion and support -> compatible main products were kept as separate relationships; and that a main desk/bench row remained in Base/Model rather than being moved into optionGroups merely because it uses structural support.
Native System/Base self-check: verify that a source-proven PRIMARY first-stage priced System/Base was not incorrectly routed to optionGroups structural_support; that a native System/Base row uses role "system_base"; that every native System/Base and its Main Product rows share the correct groupId; that Main Product rows did not receive role "system_base"; that ordinary Main Product rows did not receive an invented role "main_product"; that native System compatibility was represented structurally through groupId, not compatibleTargets; that a required companion triggered by system_base targets kind "base_model" with the exact native groupId and row id; that System/Base and Main Product prices were preserved independently with no synthetic combined System+Main price; that no fake one-column Matrix was created for System grouping; that subgroup ids were not invented during extraction; and that structural_support remains used only for genuine support/companion architecture. A required companion targeting a native system_base/base_model row does not contain scale_with_target_quantity. Supplier codes contain only the commercial article code and do not include adjacent finish/footnote markers such as (*).
Also verify that source-proven structural support was not left as a normal unrestricted accessory; structural_support was not inferred from type/name/proximity; an explicitly required support-triggered companion uses exact option_item group_id/row_id when safely supported; its unit price was not merged or multiplied; and no arbitrary multi-level chain was invented.
Verify that no direct-priced SKU was put in Matrix; no one-column "Standard Price" Matrix was created, including as a workaround to preserve multiple Base/Model families; no Modular structure was invented; that a family with source-proven Modular composition plus manufacturer-proven category-dependent module prices was routed to Matrix Modular rather than top-level pricing.priceMatrices; that Matrix Modular row.role/group.composition were emitted only when composition is source-proven and never given pricingMode: "direct"; no distinct supplier codes were merged; compatibility did not create Required Companion; "without X" did not make X required; no unrelated manufacturer family was included; no missing price was invented; finish codes did not become pricing without evidence; and a supplemental batch preserved the existing family. For every priced row, verify that actionable language such as must, required, mandatory, or cannot belongs in importantRequirements when it expresses an obligation/restriction; importantRequirements is present for every such supported requirement; no requirement is duplicated in specification; and included facts or ordinary compatibility were not moved incorrectly. Also verify every supplier-coded priced row in the supplied scope was extracted; no representative/sample/briefness language or behavior was used; no repetitive-looking row was omitted; any output-size stop is at a page boundary with exact remaining pages declared; a partial batch did not rename or split its parent template; referenced but unsupplied companion data was not invented; known source page numbers are present in sources; and every material source page, including supplemental pages, has a distinct sources entry with a known page number. Finally verify that no synthetic bundled/quantity-multiplied item or price was created for an explicit fixed-quantity requirement; every row-specific Required Companion or Conditional Option states its exact target row identity for Review & Route instead of a global/unscoped rule; importantRequirements was emitted alongside, not instead of, that structural targeting evidence; no data was extracted from this prompt's own regression examples, unsupplied pages, or other batches outside the supplied extraction scope; and the exact response would be accepted by standard JSON.parse: no \\_, arbitrary Markdown escapes, Markdown fences, comments, trailing commas, or invalid backslash escape sequences, and embedded quotes use \\".`;

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
  workstation: `EXTRACTION FOCUS: Workstation Pricing
Focus on supported workstation/bench size/layout rows, dimensions, layout type, base/additional prices, codes, specifications, importantRequirements, and relevant configuration in pricing.workstationRows. Apply the GLOBAL WORKSTATION ROUTING PRINCIPLE before extracting: the words workstation, bench, cluster, and operative do not by themselves mean pricing.workstationRows. Do not force unrelated furniture into workstationRows. Preserve null and explicit zero prices. ${relatedAccessoriesRule}

WORKSTATION ROUTING HIERARCHY
Evaluate in this order: (1) a complete direct-priced SKU with its own supplier code and one authoritative price routes to pricing.baseModelRows, even when the manufacturer calls it a workstation, bench, DX/SX unit, or complete desk-plus-service-unit SKU; (2) a simple, complete-price workstation/bench family that fits the current narrow workstationRows model (authoritative complete row price, optional supported additional/cluster price, no free-form composition) routes to pricing.workstationRows; (3) genuine manufacturer-proven row-by-category or finish-price-class pricing with NO source-proven structural composition routes to pricing.priceMatrices; (4) source-proven component/module composition, including starter/add-on systems, routes to pricing.modularGroups: scalar module prices use Direct Modular, while category/finish-dependent module prices use Matrix Modular. Use the structure that preserves manufacturer truth with the least unnecessary complexity.

ALTERNATIVE BENCH COMPLETIONS
When the supplied source presents two complete bench configurations as alternatives (for example, one desk/screen/cabinet completion versus another desk-and-extension completion), preserve the authoritative rows and their source relationship without flattening the alternatives into cumulative AND-required companions. Use an existing supported alternative/composition structure only when it can express the exact relationship. If it cannot, keep the rows separate, add one concise extractionWarning/manual-review note naming the unresolved alternative relationship, and do not invent global companion rules, a generic OR rule, or a combined price.

BASE / MODEL FOR COMPLETE WORKSTATION SKUS
Use pricing.baseModelRows when the manufacturer sells a complete, independently selectable workstation/desk SKU with one direct authoritative price and no need for the workstation cluster calculator: a complete L-shaped workstation SKU, separate DX/SX workstation SKUs, a complete desk-plus-service-unit SKU, or a cabinet-supported complete workstation sold as one authoritative SKU. Preserve each code separately; never move a direct-priced SKU into workstationRows merely because the manufacturer calls it a workstation.

WORKSTATION ROWS SUITABILITY
Use pricing.workstationRows only for simple, complete-price workstation/bench families that fit the current model: authoritative complete workstation/bench rows, simple size/layout rows, one base workstation price, an optional supported repeatable additional/cluster price only where the source explicitly provides it, no free-form starter/add-on structural composition, no component-built price calculation, and no independent finish-price matrix. Every row must preserve stable id, label/display name, supplier codes, dimensions, currency, base price, additionalPrice only if explicitly source-supported, layoutType when genuinely supported, specification, and importantRequirements. Do not invent additionalPrice from another SKU.

WORKSTATION ROW IMPORTANT REQUIREMENTS
Workstation rows support importantRequirements: string[] using the same global separation rules as other priced rows: specification stays descriptive ("Panel-base bench with holes for top-access and cable tray"), while an actionable obligation such as "Always complete with 2 Art.058" belongs in importantRequirements, never duplicated in specification.

WORKSTATION REQUIRED COMPANIONS
When the source explicitly requires a separate commercial component to complete a workstation/direct-product row (for example, OXI extracted id "oxi-q-ws-dx" with supplierCodes ["111 623"], always complete with either ART.175 or ART.129), extract the primary row plus a Required Companion optionGroup item using the item's real manufacturer code and price, with exactly one selection and every source-supported allowed item. This is a CHOOSE-ONE COMPANION (see COMPANION SELECTION MODE below): set the outer optionGroup.selection to { "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] } and set conditionalConfiguration on that optionGroup (role "companion", selection "exactly_one") with one applicability rule per exact target row, each required true and allowed_item_ids naming ART.175 and ART.129 (see OPTIONGROUPS.CONDITIONALCONFIGURATION - ROW-SPECIFIC ENFORCEMENT and TARGET GROUP_ID CONVENTION). If "oxi-q-ws-dx" was emitted in pricing.baseModelRows as an ordinary ungrouped Base/Model row, use target: { kind: "base_model", group_id: "${LEGACY_BASE_MODEL_GROUP_ID}", row_id: "oxi-q-ws-dx" } (a native grouped Base/Model row would instead use its exact groupId; these OXI rows stay ordinary legacy Base/Model rows unless the source proves native System grouping). If and only if it was legitimately emitted in pricing.workstationRows, use target: { kind: "workstation", group_id: "${LEGACY_WORKSTATION_GROUP_ID}", row_id: "oxi-q-ws-dx" }. row_id is the row's own draft id, never its supplierCodes entry ("111 623"). A single prose statement such as "Required Companion ART.175/ART.129 — targets rows 111 623 and 111 624 only" is not enough; emit the structural target matching the row's actual pricing routing. Do not place a supporting component such as ART.175/129 into primary pricing rows, and never create a global/unscoped required companion when the source requirement applies only to selected rows.

FIXED QUANTITY
When the source explicitly requires a quantity, such as "always complete with 2 ART.058", preserve ART.058 as one Required Companion item at its real manufacturer unit price; never synthesize a "2 x ART.058" item or a doubled/multiplied price. This is a QUANTITY-SCALED REQUIRED COMPANION (see COMPANION SELECTION MODE below), never a choose-one companion: set the outer optionGroup.selection to { "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] } and set conditionalConfiguration.selection to "at_least_one" — never "exactly_one", which the runtime rejects together with scale_with_target_quantity. State the exact fixed quantity and its target bench/module rows in importantRequirements (for example "Always complete with 2 Art.058 top-access units.") AND set conditionalConfiguration.applicability[].fixed_quantity to 2 plus scale_with_target_quantity: true on the companion optionGroup. Its target must follow the actual emitted row: for either a pricing.modularGroups[n].matrix.rows or pricing.modularGroups[n].directRows bench use { kind: "modular", group_id: "<that exact modularGroup.id>", row_id: "<that exact modular row.id>" }; for OXI_P Direct Modular, ART.058 targets those exact directRows. Only for a legitimate pricing.workstationRows bench use { kind: "workstation", group_id: "${LEGACY_WORKSTATION_GROUP_ID}", row_id: "<that exact workstation row.id>" }. Never point a Modular row at a workstation target. Never convert an explicit fixed quantity into quantity 1, never calculate unit price × quantity into a new item price, and never emit "fixed_quantity": null — omit the field when no fixed quantity applies.

OPTIONAL WORKSTATION ACCESSORIES
Source-supported items such as screens, dividers, cable trays, modesty panels, electrification, grommets, monitor arms, pedestals, and lateral storage belong in option/accessory/companion structures when independently selectable, using workstation-row applicability where the source proves compatibility. Ordinary compatibility wording alone (for example "compatible with", "suitable for") does not make such an item required.

ACCESSORY PAGE COVERAGE
Do not blindly attach every accessory shown on a manufacturer accessories page merely because that page is part of the supplied extraction batch. A general collection-level accessory page does NOT prove that every listed accessory applies to the current target ProductTemplateDraft.

For the selected target family:
- include an accessory in optionGroups when the supplied source directly proves applicability to that family or its exact rows; omit reviewStatus/reviewReason, or set reviewStatus: "confirmed", for this proven case;
- exclude an accessory when the source explicitly ties it to another family/product type; do NOT use reviewStatus: "needs_review" as a way to bypass that clear incompatibility;
- when a general accessory is commercially relevant but exact target-family applicability is not proven, PRESERVE the item in optionGroups with reviewStatus: "needs_review" and a concise reviewReason instead of omitting it or making it unconditionally globally selectable. Do NOT invent conditionalConfiguration/applicability for it, and do NOT mark it confirmed.

UNCERTAIN case: PRESERVE + NEEDS REVIEW, never OMIT + WARNING ONLY. A commercially relevant, plausibly related accessory whose exact applicability is unproven must reach optionGroups as a reviewStatus: "needs_review" item so a human can confirm or exclude it in Smart Setup; it must not be silently dropped and replaced with only an extractionWarning or a linkedFamilySuggestion.

Explicit wording such as "drilled for bench", "for bench", "for meeting tables", "for operative desks", "for extension", or an accessory printed directly inside the selected family's own pricing block is strong applicability evidence and must be respected literally.

An item explicitly marked for another product type must never become selectable on the current target template merely because it appears on the same accessory page.

Never silently drop a relevant supplied accessory page without warning, and never invent applicability to force an item into optionGroups.

BENCH ACCESSORY TARGET-SCOPE EXAMPLE
For a Terra Office-style Bench extraction:
- a cable grommet item explicitly marked "drilled for bench" may be included for the Bench target, confirmed (reviewStatus omitted or "confirmed");
- a simple cable grommet cover printed directly in the Bench / Bench Extensions pricing section as "sold separately" may be included, confirmed;
- a vertical intermediate leg cover printed directly under the Bench Extensions section may be included when clearly presented as part of that Bench commercial block, confirmed;
- an item explicitly marked "center drill for meeting tables" must NOT be included as a selectable Bench option, and must NOT be preserved as needs_review either — it is excluded entirely;
- general electrification, cable tray, cable, and ancillary items shown only on a collection-wide accessory page must not automatically become confirmed Bench optionGroups unless the supplied source proves Bench applicability.

If such general accessories appear commercially relevant but exact Bench applicability is unresolved, PRESERVE them in optionGroups with reviewStatus: "needs_review" and a concise reviewReason instead of omitting them or making them freely selectable as confirmed items.

This example is architectural guidance only. Codes, prices, and labels must still come from the supplied source.

ROW-SPECIFIC OPTIONAL SURCHARGE APPLICABILITY
When a manufacturer prints an option/surcharge only beside specific priced rows, that placement is applicability evidence. For example, when starter rows show a surcharge such as "W +387" and add-on rows do NOT show that surcharge, the W surcharge must NOT become a global unrestricted option applying to the whole Modular family: keep it as an option/conditional option targeted only at the exact rows where the manufacturer visibly publishes it, with required: false, visible: true, allowed_item_ids as appropriate, and supplierCodes: [] when the surcharge has no distinct manufacturer option code. For Modular rows target { kind: "modular", group_id: "<exact modular group id>", row_id: "<exact direct row id>" }; do NOT target add-on rows when the source only publishes the surcharge for starter rows.

OPTIONAL ROW-SPECIFIC SURCHARGE SHAPE
When the source proves one optional surcharge/item available only for certain rows and no tighter cardinality is source-proven, use exactly this apply-safe shape: outer optionGroup.selection { "mode": "optional", "minSelections": 0, "maxSelections": 1, "defaultItemIds": [] }, and conditionalConfiguration { "role": "conditional_option", "selection": "unrestricted", "applicability": [ { "target": { "kind": "modular", "group_id": "<exact group id>", "row_id": "<exact row id>" }, "required": false, "visible": true, "allowed_item_ids": ["<option item id>"] } ] }, with one applicability rule per exact supported row. Do NOT use "exactly_one", "at_least_one", fixed_quantity, or scale_with_target_quantity for this optional row-specific case unless the manufacturer explicitly proves those semantics, and do NOT make the item globally available. If several optional surcharge items are independently selectable and the source proves that, choose the existing appropriate apply-safe outer mode rather than inventing cardinality. If the source semantics still cannot be represented safely, emit an extractionWarning instead of fabricating enforcement.

Do not invent cardinality or automatic quantity behavior for an optional surcharge; if the manufacturer's surcharge semantics cannot be represented safely with the current optional/conditional option runtime, preserve the surcharge evidence in extractionWarnings, do not make it a misleading globally selectable accessory, do not bake the surcharge into the authoritative base SKU price, and do not synthesize alternate priced SKUs unless the manufacturer itself publishes them as separate authoritative SKUs. If the same manufacturer option symbol has different surcharge values for different product types, preserve those distinctions: for example a return unit's W +193 and a bench starter's W +387 remain two separate priced option items, never one universal W value; if the return unit is outside the selected Bench template, its W +193 option is also outside that Bench template.

MODEL-DEFINING VARIANTS
If the manufacturer gives separate priced codes for with/without electrification preparation, E/non-E, LH/RH, or with/without cable access, preserve those as separate authoritative priced rows. Do not automatically convert an E-suffix SKU into the corresponding non-E SKU plus an electrification option when the manufacturer prices both as distinct SKU rows.

When the source defines the E suffix as a top machined/prepared for electrification, describe that row as "Machined for Electrification" or equivalent source-faithful wording. Do NOT call the complete product "Electrified" unless the source explicitly proves that electrical hardware is included in that SKU.

Do not infer that separate electrification accessories are included with, required by, or automatically compatible with an E-suffix row unless the supplied source explicitly proves that relationship.

ALTERNATIVE FINISH PRICE COLUMNS
When a manufacturer row has one SKU and multiple price columns aligned to finish/material/category legends (for example separate columns for standard finishes such as BL/AN versus special finishes such as designs), model those values as Matrix Modular / Category price columns for that same row. Never transform the second/full alternative price into a surcharge, an accessory, a conditional option, or a synthetic add-on SKU: both values are complete alternative prices for the identical SKU, not a base price plus an addition. Preserve each SKU as one row carrying its full finish-category price map. Example architectural mapping: row TE160 prices Standard (BL / AN): 1310, Designs: 1874; row TE160E prices Standard (BL / AN): 1454, Designs: 2148. These example numbers are architectural examples only and remain subject to SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL.

HANDED WORKSTATIONS
Separate manufacturer DX/SX or LH/RH codes (for example OXI 111 008 — DX and 111 009 — SX) remain separate authoritative rows; do not infer reversibility. Handedness may remain visible in label/display name and specification and through separate row identity; do not invent a new schema field.

STARTER / ADD-ON SYSTEMS
Current pricing.workstationRows must NOT be used for true structural starter/add-on composition, such as an X3 or OXI 2-person bench starter plus a 2-person bench add-on that structurally extends a run. When those authoritative SKUs have scalar prices, route them to direct Modular: pricingMode: "direct" with directRows, not Base/Model and not a fake one-column matrix. Use role "starter" for a starter and "intermediate" for an add-on; use composition { minStarters: 1, maxStarters: 1 } where source proves one starter per run. If the current ProductTemplateDraft cannot safely encode a required structural rule, preserve authoritative module rows and add an extractionWarning; never flatten starter and add-on into workstation basePrice/additionalPrice merely because it looks similar.

DIRECT MODULAR COMPATIBILITY PARTITIONING
When a starter/add-on or other Direct Modular family contains manufacturer-proven structural subfamilies that are NOT safely interchangeable under the current composition model, split them into separate pricing.modularGroups. Do this whenever mixing rows inside one group could permit a physically/commercially invalid configuration that ProductTemplateDraft v1 cannot otherwise prevent, for example different top-depth families, different overall bench depth caused by those top depths, different middle-gap systems, different connector/interface systems, or different structural systems identified by manufacturer section A/B/etc. The source must prove the commercial/structural distinction; do NOT rely only on dimensions. Width alone is not a reason to split: matching 120/140/160/180 starter rows plus matching 120/140/160/180 add-on rows belonging to the same structural system may remain in one Direct Modular group when they can safely compose. Split by proven incompatibility, not by every dimension difference. If the source proves starter/add-on composition but safe compatibility cannot be represented even after meaningful Modular group partitioning, preserve all authoritative priced rows, use the safest supported groups possible, and add an extractionWarning describing the unsupported relationship; never flatten the system to workstationRows or Base/Model merely to avoid the compatibility problem, and never invent a new schema field or compatibility DSL.

When incompatible Direct Modular subfamilies are split into separate groups specifically because they are alternative configurations of the SAME selected commercial product and must not be combined in one quotation item, assign those groups the same selectionFamily value.

Example concept:
- structural system A / shallow depth
- structural system A / deep depth
- structural system B / shallow depth
- structural system B / deep depth

If the source proves that these are alternative configurations rather than simultaneously composable groups, all such Direct Modular groups must share one stable selectionFamily.

Do not use selectionFamily merely because groups were split for organization or readability. The source must prove cross-group mutual exclusivity.

SAME-PAGE UNRELATED PRIMARY PRODUCT ISOLATION — MANDATORY TARGET-SCOPE RULE
The current target ProductTemplateDraft must contain ONLY the selected commercial family. A separately sold primary product that appears on the same supplied page is OUT OF SCOPE unless the user explicitly selected that product/family as part of the current target template.

For a selected Bench / Bench Desks family:
- bench starter/add-on rows belong to the Bench template;
- a separately sold inset return unit, desk return, pedestal, service unit, or other adjacent primary product MUST NOT be emitted into pricing.baseModelRows, pricing.workstationRows, pricing.priceMatrices, or pricing.modularGroups of that Bench template;
- options/surcharges that apply only to that excluded sibling product MUST also be excluded from the current template's optionGroups;
- do NOT broaden template.templateName, template.description, or template.specification to include the excluded sibling product merely because it appears on the same source page.

Example architectural rule:
If the selected target is an X3-style Bench family and the same page also contains separately priced inset return units, the returned draft must remain the Bench family only. The inset return rows and their return-only surcharge/options are not part of the Bench draft.

When useful, preserve the excluded sibling product only as:
- linkedFamilySuggestions, when the relationship is clearly supported; or
- extractionWarnings stating that the sibling product requires a separate extraction.

This rule is mandatory whenever TARGET TEMPLATE SCOPE identifies one selected family. Same-page proximity never overrides target-template scope. A separately priced furniture item that is commercially part of the selected system as a cabinet, pedestal, service unit, return, support storage, bridge, or other companion must NOT be treated as an unrelated same-page primary product merely because it has separate supplier codes and prices; apply COMPANION FURNITURE FAMILY PRESERVATION instead. A separately priced system/base shown alongside Main Product rows is NOT an unrelated sibling when the source proves those Main Products are explicitly designed for that System; in that case preserve them together inside one native Base/Model System group (NATIVE SYSTEM / BASE PRECEDENCE). Same-page proximity alone is still insufficient.

BENCH EXTENSION DISTINCTION
Do not assume "bench extension" always means Modular. Determine from the source whether the extension is a structural module that cannot stand alone (Modular), or simply another independently priced authoritative commercial SKU (Base/Model or another appropriate direct-price structure); preserve source semantics either way.

STARTER PLUS EXTENSION COMPOSE TOGETHER
When the source proves a Bench and its Bench Extension are components of the SAME composable configuration — the Extension is used to extend the Bench run, not an alternative product family — route the Bench rows to role "starter" and the Extension rows to role "intermediate" within the SAME Modular group, with composition requiring at least one starter and, when source/runtime support it, no more than one starter per run. Do NOT assign selectionFamily between these starter and extension rows: selectionFamily is reserved for mutually exclusive alternative configuration families that must never be combined, never for starter/add-on rows that the source proves are meant to compose together in the same quotation item.

COMPONENT-PRICED WORKSTATIONS
If the final workstation price is built from separately priced components such as structure, top, finish/material, screen, and electrification, do not force it into workstationRows: use Modular when manufacturer pricing is genuinely component-built. If the source publishes both a complete total and a component breakdown, choose one authoritative pricing architecture and preserve the other information as supporting metadata/warning rather than charging both.

FINISH-DEPENDENT PRICING
If workstation price changes by genuine manufacturer material/finish category, use Category / Matrix for a complete product or Modular matrix pricing for a component-built system; do not create an implicit finish-price mechanism inside workstationRows. Finish codes with no price difference remain Manufacturer Finish Guidance.

MATRIX MODULAR VERSUS TOP-LEVEL PRICEMATRICES — ROUTING PRECEDENCE
When BOTH (A) the family has genuine source-proven Modular composition such as starter plus extension/add-on rows, AND (B) those same module rows have manufacturer-proven finish/material/category-dependent prices, use Matrix Modular (pricing.modularGroups with a matrix). Do NOT route such a family to top-level pricing.priceMatrices merely because category-dependent pricing exists. Top-level pricing.priceMatrices is for non-Modular primary row-by-category pricing, where no source-proven starter/add-on structural composition exists. Matrix Modular is for Modular composition whose module rows themselves carry category-dependent price maps.

SEAT COUNT
The current runtime does not have a generalized structured seat-count composition engine: preserve manufacturer-supported seat count in label/specification where useful, but do not invent seat calculations, assume every bench base represents a fixed number of seats, or infer additional seats from an extension unless source/current supported workstation pricing explicitly proves it.

LAYOUT TYPE
Use workstation layoutType only according to the current supported values ("linear", "cluster", "both", or null). Do not misuse layoutType to represent handedness, starter/add-on role, seat count, service cabinet, screen type, or finish; if the source does not fit supported layout semantics, use null and preserve meaning in row label/specification.

SERVICE CABINET / STORAGE
First determine whether the cabinet/storage/service unit is a native primary System/Base selection. If the source proves it is separately priced, selected as the first-stage system/base, and downstream desks/benches/products are explicitly designed for that exact system, route it to pricing.baseModelRows with role "system_base" and a native groupId/groupLabel shared by its Main Product rows. Otherwise, if it is genuinely a supporting/companion furniture item rather than the primary System selection, use the structural_support/companion architecture when proven. Do not infer either role from name alone.
When manufacturer evidence proves that a separately priced service cabinet, storage unit, or support item is not a native System/Base but acts as structural support/base equipment for the selected system, preserve that option item with role "structural_support" rather than presenting it as an ordinary optional accessory. If another supplied item is explicitly mandatory because that structural-support item is selected, encode that dependency using target.kind "option_item". Do NOT infer structural support from cabinet/storage/support words alone, desk filtering, or desk-to-cabinet quantity unless separately proven.
If a workstation requires a separately priced service cabinet or storage unit, use companion/accessory/linked-product structures only when manufacturer evidence proves the relationship. If the workstation is sold as one complete SKU already including/integrating that storage, keep it as one authoritative main row; do not double-charge the storage.
When manufacturer evidence proves that a genuine structural_support service cabinet/support item (not a native system_base row) is structural support for specific Base/Model workstation rows, emit compatibleTargets on that structural-support item for those exact rows. For example conceptually: Service Support A -> Desk Row 1 -> Desk Row 2. Do NOT infer compatibility with every desk in the template. Do NOT filter by product names in extraction. Do NOT use a generic global compatibility flag.

MULTI-LEVEL DEPENDENCIES
ProjectWorkflow supports one level of option-item dependency: selected option item -> required companion option item through target.kind "option_item". Arbitrary recursive/deeper dependency graphs remain unsupported. When deeper dependency is source-proven but unsafe to represent, preserve authoritative rows and add extractionWarning/manual-review wording rather than fabricating nested enforcement.

OXI, X3, TERRA/PIEM, AND COLAN REGRESSION PATTERNS
Direct LH/RH workstation rows (OXI 111 008 / 111 009) must remain separate authoritative rows. Rows requiring one structural companion (OXI 111 623 / 111 624 with ART.175 or ART.129) preserve direct product pricing plus a Required Companion with exactly one allowed structural component when the source proves it, targeted according to the row's actual emitted pricing structure. OXI_P starter rows 111 065, 111 066, 111 067, and 111 068 plus intermediate rows 111 069, 111 070, 111 071, and 111 072 are a direct Modular composition when pages 14–15 prove that structure: use directRows with the respective starter/intermediate roles and composition minStarters: 1, maxStarters: 1. A bench requiring 2 × ART.058 preserves one Required Companion at unit price EUR 69 with conditionalConfiguration.selection "at_least_one" (never "exactly_one"), fixed_quantity: 2, and scale_with_target_quantity: true, targeted at exact emitted Modular rows; never synthesize EUR 138. An X3-style starter/add-on bench system must NOT be flattened into workstation base/additional pricing unless the source exactly matches the supported calculator; prefer Modular for genuine structural composition. When an X3-style source proves two structural middle-gap systems, such as system A at a 38 mm middle gap and system B at a 215 mm middle gap, each with its own separate 60 cm top-depth starter/add-on rows and 80 cm top-depth starter/add-on rows, partition into four separate direct Modular groups instead of one mixed group: A/38 mm/60 cm tops, A/38 mm/80 cm tops, B/215 mm/60 cm tops, and B/215 mm/80 cm tops, each with pricingMode: "direct", starter rows using role "starter", add-on rows using role "intermediate", and composition { minStarters: 1, maxStarters: 1 }; never combine the 60 cm-top and 80 cm-top systems into one group, and never combine system A and system B, because the current composition model cannot enforce same-depth or same-gap composition inside a mixed group. Because these four X3-style groups represent alternative structural bench configurations that must not be combined within one quotation item, emit the SAME selectionFamily value on all four Direct Modular groups. Use one stable readable generated selectionFamily ID derived from the selected commercial family identity, for example "x3-bench-configuration". The mutual exclusivity relationship must be supported by the supplied manufacturer source; the generated selectionFamily ID itself is an internal ProjectWorkflow identifier and does not need to appear verbatim in the manufacturer source. Prompt example strings remain non-source architectural examples. The four groups remain separate pricing.modularGroups, but their shared selectionFamily tells ProjectWorkflow that selecting quantities from one group excludes simultaneous quantities from another group in the same family. These example gap/depth values are architectural examples only and remain governed by SOURCE-BATCH AUTHORITY AND PROMPT EXAMPLE FIREWALL. For the same X3-style Bench extraction, if the supplied page also contains separately priced inset return units before or after the Bench tables, those return units remain outside the selected Bench ProductTemplateDraft. Do not emit them into baseModelRows and do not emit their return-only surcharge/options into optionGroups. The Bench template identity must remain Bench-only; do not rename it to "Desks & Benches" or otherwise broaden its description/specification to include the excluded return family. This is a target-scope rule, not an optional warning. When an X3-style source labels its commercial amount column PTS rather than a supported currency, never reinterpret PTS as EUR, USD, or any other supported currency code: use defaultCurrency: null and row currency: null, preserve the explicit numeric PTS amount in price, and add a concise extractionWarning that source values are expressed in PTS rather than a supported monetary currency. When an X3-style source prints a surcharge such as "W +387" beside starter rows only, with no equivalent marking on add-on rows, extract exactly one real surcharge option item using the OPTIONAL ROW-SPECIFIC SURCHARGE SHAPE above: no supplier code unless the source supplies one, price 387 only when visibly supplied, currency following the actual source (PTS is not a currency), applicability targeting only the starter rows, required: false, and no add-on-row targets; do not extract "387" or "W" as authoritative data from this prompt's own example, only from the supplied source. Terra/Piem-style direct-priced complete Bench and Bench Extension SKUs are preserved per manufacturer semantics, with E-coded electrified variants remaining distinct authoritative rows when explicitly separately priced, and separately sold grommet covers/accessories remaining accessories. For Terra Office-style Bench pricing where the source proves Bench and Bench Extension rows compose together (the Extension extends the Bench run rather than being an alternative product), normal and E-suffix rows are real manufacturer SKUs, and one SKU carries separate full prices for standard finishes (for example BL/AN) versus special finishes (for example designs), route as Matrix Modular: exactly ONE Matrix Modular group containing Bench rows with role "starter" and Bench Extension rows with role "intermediate", group composition { "minStarters": 1, "maxStarters": 1 }, Standard (BL/AN) and Designs as matrix columns/price categories on those same rows, normal and E-suffix rows preserved as separate manufacturer rows, no synthetic Designs surcharge optionGroup, no selectionFamily between the starter and extension rows, and no pricingMode: "direct" on this group. The E suffix remains a manufacturer SKU variant representing the machined/electrification-ready version and must not be converted into a surcharge. For Terra Office-style target scope, an E-suffix row means the top is machined/prepared for electrification when that is what the supplied technical source states; do not label the complete Bench "Electrified" unless electrical hardware is explicitly included. General collection-level accessory pages do not make every grommet, electrification unit, cable tray, cable, or ancillary item applicable to Terra Bench. Include only accessories whose Bench applicability is directly proven as confirmed items; exclude items explicitly assigned to other product types such as meeting tables entirely, never as needs_review; preserve unresolved general accessory applicability as optionGroups items with reviewStatus: "needs_review" and a concise reviewReason, rather than omitting them, silently attaching them as confirmed, or downgrading them to an extractionWarning alone. For a Terra Office-style "Bench for Cabinet" source block, complete Bench-for-Cabinet rows such as normal and E-suffix Bench SKUs remain complete primary priced rows with their manufacturer-proven category/finish price columns. They must not be forced into starter/intermediate Modular composition merely because a separately priced cabinet family is shown in the same commercial block. A separately priced cabinet family shown directly under the Bench-for-Cabinet commercial section must not be silently omitted. If that same supplied source visibly provides the cabinet family's own SKU codes, dimensions, and prices, those authoritative cabinet rows must also be preserved as reviewable companion commercial rows; a linkedFamilySuggestion alone is insufficient because it loses the cabinet's commercial pricing data. Preserve each supplied cabinet SKU separately using an optionGroup or the safest currently supported companion structure. If exact Bench-row compatibility or requiredness is not fully proven, mark the cabinet items reviewStatus: "needs_review" with a concise reviewReason instead of inventing conditionalConfiguration. Do not merge cabinet price into the Bench price. Preserve that cabinet family separately as a linked/companion furniture candidate. If the supplied source explicitly proves the cabinet is required, preserve it as a required companion; if exact requiredness or row compatibility is not fully proven, preserve it for user review rather than inventing the rule. The cabinet price must never be merged into the Bench price unless the manufacturer explicitly provides one combined complete price. This Terra example is regression guidance only. Codes, labels, dimensions, prices, and compatibility must still come from the supplied source. A Colan-style workstation must not double count structure price, top price, screen price, and a published total set price: use Modular/component architecture when component-priced, or the published authoritative total when the manufacturer defines components as options; finish-dependent top prices must not become ordinary workstationRows pricing.

WORKSTATION FINAL SAFETY CHECK
Verify that a source-proven separately priced structural support item was not rendered as an ordinary optional accessory; any explicitly required support-triggered companion uses exact option_item option-group/item IDs; no relationship was invented from naming or proximity; and no unsupported deeper dependency graph was fabricated. Verify that when the supplied source proves a workstation/desk/bench is designed for a particular structural-support item, that support item carries row-level compatibleTargets for the exact Base/Model rows; that compatibility was not inferred from names/proximity; that no unsupported subgroup id was invented during extraction; and that support-to-main compatibility was not confused with option_item required-companion enforcement.
When the supplied workstation/desk source proves a separately priced first-stage System/Base plus downstream Main Product rows designed for that System, verify that the System/Base was emitted as a native grouped Base/Model row with role "system_base", that downstream Main rows share its groupId, that prices remain separate, and that the relationship was not downgraded to structural_support/compatibleTargets merely because the System is a cabinet/service/storage item.
Before returning JSON for this focus, verify that no incompatible Direct Modular structural families were merged into one group merely because all rows are starter/add-on rows; that same-family width variants were not unnecessarily split; that separate top-depth/gap systems were partitioned into distinct pricing.modularGroups where the current runtime cannot prevent invalid mixing; that when multiple Direct Modular groups are source-proven mutually exclusive alternative configurations of the same selected commercial family, they share one selectionFamily value; that selectionFamily was not added to groups that may validly coexist; and that no incompatible alternative groups requiring cross-group exclusivity were returned without selectionFamily merely because they had already been partitioned into separate modularGroups; that when the selected target is a Bench family, no separately sold same-page inset return, desk return, pedestal, service unit, or sibling primary product appears anywhere in the returned pricing arrays or optionGroups, and the template name/description/specification were not broadened to include that excluded sibling family; that a row-specific surcharge visible only beside starter rows was not made globally applicable to add-on rows; and that PTS or other non-currency commercial units were not relabelled as a supported currency; that a full alternative finish/category price for one SKU was not converted into a surcharge, accessory, conditional option, or synthetic add-on SKU; that starter and extension rows meant to compose together were not split apart by selectionFamily; that Matrix Modular price categories were used when one SKU has finish-dependent alternative prices; that E-suffix manufacturer SKUs remain separate rows rather than being converted into surcharges; that a family with both source-proven Modular composition and manufacturer-proven category-dependent module prices was routed to Matrix Modular rather than top-level pricing.priceMatrices; that Matrix Modular row.role and group.composition were emitted only when the source proves starter/add-on composition, and were never invented for an ordinary Matrix Modular family with no proven composition; that Matrix Modular was never given pricingMode: "direct"; and that uncertain accessory applicability produced a reviewStatus: "needs_review" optionGroups item with a concise reviewReason rather than invented applicability, a silent omission, or a mere extractionWarning/linkedFamilySuggestion substitute; that an E-suffix row defined only as machined/prepared for electrification was not mislabeled as fully electrified; that a general collection accessory page was not treated as proof that every accessory applies to the selected Bench family; that accessories explicitly assigned to another product type were excluded from the target template entirely rather than marked needs_review; that unresolved general accessory applicability was preserved as a needs_review optionGroups item rather than omitted or made globally selectable as confirmed; and that reviewStatus/reviewReason were never invented for an accessory whose applicability the source already proves or already excludes; that a separately priced cabinet, pedestal, service unit, return, support storage, bridge, or other companion furniture family shown as part of the selected commercial system was not silently omitted; that complete primary SKUs were not incorrectly routed to Modular merely because a companion family was present; that companion prices were not merged into primary SKU prices without explicit manufacturer proof; and that unresolved companion applicability or requiredness was preserved for review rather than invented; that a supplied companion furniture family with authoritative priced SKU rows was not represented only as a linkedFamilySuggestion while its prices/dimensions/codes were lost; that each supplied companion SKU row was preserved separately; that unresolved companion rows were surfaced for user review without invented applicability; and that no companion commercial price was merged into the primary SKU price without explicit manufacturer proof.`,
  screens: `EXTRACTION FOCUS: Screens / Dividers
Prioritize front, lateral/side, desk-mounted, bench, freestanding/desktop, and floor screens/dividers; acoustic, fabric, felt, glass, and melamine variants; direct-priced SKUs; genuine upholstery category matrices; mounting brackets/stirrups; included versus separately required hardware; screen accessories; exact dimensions including nominal-versus-actual widths; manufacturer compatibility evidence; and finish-code/composed supplier-code evidence. Apply the global Screen Catalogue Extraction rules; do not duplicate them here. ${relatedAccessoriesRule}`,
  category_matrix: `EXTRACTION FOCUS: Category / Matrix Pricing\nFocus on genuine row-by-category pricing in pricing.priceMatrices. Preserve exact matrix names, source column labels and order, row order, prices, and codes. Never invent generic Cat A/Cat B/Cat C/Cat D labels unless printed in the source. ${relatedAccessoriesRule}`,
  modular: `EXTRACTION FOCUS: Modular Pricing\nFocus on pricing.modularGroups: preserve manufacturer family, subgroup, module, shared price-category hierarchy, dimensions, codes, specifications, and related configuration. Never flatten modular hierarchy. ${relatedAccessoriesRule}`,
  accessories: `EXTRACTION FOCUS: Accessories / Configuration Only\nFocus only on optionGroups for accessories, options, companion/service components, add-ons, prices, codes, dimensions, specifications, explicit selection semantics, defaults, quantities, and applicability clues. Preserve explicit applicability in specification or warnings when v1 cannot encode it. Do not invent conditional rules or require main-product pricing extraction.`,
  accessories_electrification: `EXTRACTION FOCUS: Accessories / Electrification
Extract standalone and product-local accessories, cable management, electrification, modules, mounting requirements, compatibility, and finish codes. ${accessoriesElectrificationExtractionContract} ${relatedAccessoriesRule}`,
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

IMPORTANT: Codes, prices, dimensions, page numbers, and manufacturer examples appearing inside this prompt (including its regression examples) are architectural examples only. They are NEVER extraction evidence. Every commercial value returned in JSON must be visibly verified in the manufacturer source files supplied for THIS extraction call. Do not extract a row merely because its code/value appears in this prompt, planning output, previous extraction JSON, earlier conversation context, or remembered catalogue knowledge.

${globalExtractionArchitectureContract}

${focus === "screens" ? screenExtractionContract : ""}

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

COLLECTION / RANGE NAME VS SUPPLIER IDENTITY
Do NOT treat a collection name, catalogue range name, chapter name, or product-family heading as supplierName merely because it appears prominently on every supplied page.

If the supplied pages prove a collection/range name but do NOT visibly identify manufacturer, company, or supplier, then: preserve the collection/range in templateName, description, or other source-faithful family fields; set supplierName = null.

Only populate supplierName when the supplied source itself visibly identifies the manufacturer/supplier. Do not infer supplier identity from product-range branding alone, file name, prior conversation context, or ProjectWorkflow brand context, unless that identity is visibly supported in the current extraction source.

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

WORKSTATION / BENCH ROW SPECIFICATION QUALITY
When a supplied technical page clearly provides family-wide construction for the same priced Bench/Workstation family, row.specification should normally combine that supported shared construction with the row-specific configuration/dimensions instead of using only a minimal phrase such as "Bench starter unit."

For example, if the source proves a 25 mm MDP top, tubular steel legs, levellers, and the row's exact dimensions, a Bench row specification may combine those supported facts concisely with whether the row is a starter, extension, or machined-for-electrification variant.

Do not duplicate long family text mechanically. Keep row specifications concise, model-specific, and source-faithful.

VISIBLE MODEL AND ACCESSORY NAMES

displayName and accessory label must be human-readable and identifiable. Do not use a supplier/price-list code as the visible name when the source provides enough descriptive information; keep codes only in supplierCodes/referenceCodes. Include the minimum supported distinction between siblings, such as size, orientation, configuration, top-access condition, service-unit compatibility, or seat count. Example: label: "Service Unit W123.6 - Right", supplierCodes: ["1AF 090"], not label: "1AF 090".

IMPORTANT: A configuration pictured or described on a technical page does NOT automatically become an optionGroup item or priced accessory.

ACCESSORY SIBLING DISTINCTIONS
When sibling accessory rows are differentiated by a clearly source-supported commercial count, width, size, capacity, hook count, tray width, or similar identity, preserve that distinction in displayName and specification.

Examples of correct naming patterns:
"Wall Clothes Hanger - 2 Hooks"
"Wall Clothes Hanger - 3 Hooks"
"Keyboard Tray - W56 cm"
"Keyboard Tray - W58 cm"

If the source visibly gives a meaningful size such as W35 cm versus W52 cm, preserve that size in dimensions where safely structured and/or in displayName/specification. Do NOT reduce a clearly differentiated sibling row to a generic name when doing so loses its source-supported commercial distinction.

When two or more authoritative accessory rows share the same generic source product heading but the source visibly distinguishes them by hook count, number of positions, width, capacity, size, or configuration, the extraction MUST preserve those distinguishing facts for EVERY sibling row.

Before returning the family: (1) compare sibling displayNames; (2) compare sibling dimensions; (3) verify that each visible source distinction is retained; (4) a sibling must not remain a generic duplicate name when the catalogue visibly identifies its count/size/configuration.

Example architectural pattern:
Row A: Wall Clothes Hanger - 2 Hooks, W35 cm
Row B: Wall Clothes Hanger - 3 Hooks, W52 cm

Returning Row B only as "Wall Clothes Hanger" with dimensions = null is INVALID when 3 hooks and W52 cm are visibly supplied.

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

pricing.workstationRows is intentionally narrow: it holds only simple, complete-price workstation/bench families with one base price and, where the source explicitly supports it, one repeatable additional/cluster price. It is not a generic composition engine and must never encode starter/add-on structural composition, component-built pricing, or a finish-price matrix. Apply the GLOBAL WORKSTATION ROUTING PRINCIPLE before using this structure.

For workstationRows, extract each supported size/layout row with id, label/displayName, supplierCodes, referenceCodes, dimensions, price, additionalPrice, currency, specification, importantRequirements, and layoutType. Use layoutType only when supported: "linear", "cluster", "both", or null; never misuse layoutType to represent handedness, starter/add-on role, seat count, service cabinet, screen type, or finish, and use null when the source does not fit those supported values, preserving the meaning in label/specification instead. Do not invent additionalPrice from another SKU or from a different row's price. Preserve manufacturer-supported seat count in label/specification only when explicitly proven; do not invent seat-count calculations or assume a bench base always represents a fixed number of seats. Preserve separate LH/RH, SX/DX, or E/non-E priced SKU codes as separate authoritative rows; do not infer a missing handed or electrified variant.

BASE / MODEL ROWS

For baseModelRows, extract model/display name, all known supplier codes, all known reference codes, paired codes, left/right codes when explicitly supplied, dimensions, price, currency, and specification. Keep separate codes as separate array entries. Do not concatenate or discard codes.

Use baseModelRows for a simple single product family when each row is a distinct model/configuration with one direct price and there is no finish, fabric, leather, material, or other category-dependent price dimension.

NATIVE BASE / MODEL SYSTEM GROUPING
pricing.baseModelRows remains one flat JSON array, but rows may now carry native grouping metadata: groupId and groupLabel. When the supplied manufacturer source proves distinct direct-priced System/Base families inside one connected Product Template, assign every Base/Model row belonging to one System family the same stable groupId and groupLabel (System A rows: "groupId": "system-a", "groupLabel": "System A"; System B rows receive a different groupId). Do NOT create a fake one-column priceMatrix to preserve these groups: a one-column "Price" matrix remains a forbidden fake Matrix no matter how many families exist. Do NOT create an extractionWarning merely because multiple native Base/Model groups exist; grouping is supported. Rows without groupId remain valid legacy Base/Model rows, and groupId is not required for a single ordinary family.

groupId and groupLabel preserve manufacturer-defined System-family boundaries. role: "system_base" identifies only the first-stage priced System/Base row (see NATIVE SYSTEM / BASE PRECEDENCE). Ordinary Base/Model main rows must omit role; do NOT emit "role": "main_product", because the runtime intentionally treats a missing role as an ordinary Main Product row. Under native System/Base architecture the System/Base price and Main Product price remain two independent authoritative prices; never merge them.

Do not place service units, support units, required companions, or add-on components into baseModelRows or direct-price main-model matrices merely because they have one price. Preserve them in the safest existing v1 structure and add an extractionWarning when companion semantics cannot be represented without ambiguity.

When complete direct-priced Base/Model rows are explicitly designed for a separately priced structural-support option item, the rows remain authoritative pricing.baseModelRows. Their compatibility with the structural support is represented from the structural-support item's compatibleTargets. Do not duplicate that relationship by changing the main row's pricing type.

If a model's base, shell, mechanism, or other configuration is part of the model identity, describe it in the row label/displayName/specification rather than duplicating it as an accessory unless independently selectable.

PRICE MATRICES

For priceMatrices, preserve the matrix structure: columns/categories -> rows/models -> price cells. Do not flatten the matrix. Preserve original manufacturer column labels and original column order.

Examples such as COM / S, T, M, F, L, P, PX must remain exactly source-driven if those are the source labels. Do not replace them with generic Cat A, Cat B, Cat C, Cat D unless the manufacturer itself uses those labels. Every row prices object must contain a price or null for every listed column ID.

MODULAR GROUPS

For Matrix Modular preserve Modular Group -> Module Rows -> matrix columns -> row price maps, including unavailableCategoryIds only when the source clearly proves that row/category is not offered; a null price alone remains unknown/missing and must not be inferred as unavailable. For Direct Modular preserve Modular Group -> directRows with scalar row price, optional row role, and optional composition; there are no Matrix columns. Never flatten separate manufacturer Modular groups into one generic group or matrix. Preserve the manufacturer's module hierarchy and group order.

When the same category label genuinely represents the same commercial category across compatible groups, reuse the same stable column ID. Do not infer equivalence from different labels. Do not union incompatible column sets merely to simplify the structure.

MATRIX MODULAR COMPOSITION
Matrix Modular may carry the same optional structural role/composition semantics as Direct Modular when the manufacturer proves genuine composition.

Matrix Modular row.role may use the existing supported Modular roles such as starter, intermediate, and terminal.

Matrix Modular group.composition may use { "minStarters": ..., "maxStarters": ... }, the same shape as Direct Modular composition.

Use these fields only when source evidence proves structural composition, such as a starter Bench plus an intermediate Bench Extension that also carry finish/category-dependent prices. Do not add role or composition merely because a product uses matrix pricing. A Matrix Modular family with no source-proven starter/add-on structure must omit role and composition entirely and behave exactly as ordinary Matrix Modular.

OPTION GROUPS

For optionGroups extract group id, label, selection, and items. Each item uses the normal priced-row fields. For category-priced accessories, include priceCategories: [{ id, label }] in printed order and item prices keyed by category id; preserve null/unavailable cells and keep the accessory out of primary priceMatrices.

OUTER OPTIONGROUP.SELECTION — APPLY-SAFE SHAPES ONLY
The schema defines five modes ("optional", "choose_one", "choose_multiple", "required_choose_one", "required_choose_at_least_one"), but ProjectWorkflow can only apply three exact shapes. Emit one of these and nothing else, or the entire option group is discarded during Apply:
- { "mode": "optional", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] } or the same with "maxSelections": 1 — an ordinary, independently selectable accessory.
- { "mode": "choose_multiple", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] } — several independently selectable items.
- { "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] } — any Required Companion, including both companion shapes in COMPANION SELECTION MODE below.
Never emit "choose_one" or "required_choose_one", and never emit a non-empty defaultItemIds: each makes the group unapplyable regardless of how correct its items or conditionalConfiguration are. Cardinality that these three shapes cannot express belongs in conditionalConfiguration.selection, never in the outer mode.

Choose between those three shapes only from manufacturer evidence; if unclear, use the least assumptive applicable shape and add an extraction warning. Never invent defaults, and keep defaultItemIds empty. Preserve a source-proven default or a tighter cardinality in the row/item specification or an extractionWarning instead of in an unapplyable outer selection. Do not create sibling-family-only options for the current target template. Do not create technical configurations as options when they are already model-defining.

MATERIAL SUGGESTIONS

Put useful source-supported materials and finishes into materialSuggestions, including upholstery family, leather, fabric, timber finish, metal finish, shell material, or frame finish. Do not invent internal ProjectWorkflow material IDs.

LINKED FAMILY SUGGESTIONS

Put manufacturer-explicit related, sibling, or add-on product families into linkedFamilySuggestions where appropriate. Do not mix sibling-family pricing/options into the target template solely because they appear on the same source page.

linkedFamilySuggestions are relationship metadata only. They must not be used as the sole representation of a separately priced companion family when the supplied source includes authoritative companion SKU rows with prices/dimensions/codes. In that case preserve the linked-family relationship if useful, but also preserve the actual commercial companion rows according to COMPANION COMMERCIAL ROW PRESERVATION.

COMPANION FURNITURE FAMILY PRESERVATION
A separately priced cabinet/service unit/support furniture item that is actually the primary first-stage System/Base is NOT a companion merely because it sits beside the desk/bench pages; native System/Base routing (NATIVE SYSTEM / BASE PRECEDENCE) takes precedence. Use companion preservation only when the source proves the item is truly a companion/supporting furniture family rather than the primary System/Base choice.
When the selected primary family is commercially defined by another separately priced furniture component shown in the same supplied source block, do not silently omit that companion merely because it has its own supplier codes, dimensions, images, and prices.

Examples of such separately priced companion furniture may include:
- cabinet
- pedestal
- service unit
- under-top storage
- return
- bridge
- support storage
- support cabinet
- extension furniture
- separately priced structural support component

Preserve the primary family and companion family as separate commercial entities.

When the companion family itself has authoritative commercial rows in the supplied source — for example its own supplier codes, dimensions, prices, specifications, images, or finish/category prices — preserving only a linkedFamilySuggestion is NOT sufficient because that would discard the companion's commercial data.

In that case:
- preserve linkedFamilySuggestions when useful for family-level relationship/context;
- ALSO preserve the actual supplied companion commercial rows using an existing ProductTemplateDraft structure that can retain their code, dimensions, price, currency, specification, and review state;
- for V1, when the companion is separately selectable/reviewable furniture and no safer dedicated primary-family structure exists inside the current target draft, use an optionGroup as the reviewable companion-commercial-row carrier;
- do not discard authoritative companion price/dimension/code data merely because the companion is a separate family.

When a preserved companion item is source-proven structural support, use the STRUCTURAL SUPPORT / ITEM-TO-ITEM REQUIRED COMPANION rule rather than treating it as an ordinary optional accessory.

When a preserved companion furniture item is source-proven structural support and the supplied source also identifies the exact main products built for that support, preserve BOTH role: "structural_support" and compatibleTargets pointing to those exact Base/Model rows. This relationship is stronger than a linkedFamilySuggestion and must not be reduced to relationship metadata only when exact supported main rows are known.

Complete desk/bench rows that depend on a structural support remain complete primary pricing rows. The structural support carries compatibleTargets to those rows. This compatibility relationship does NOT make the desk/bench Modular. It does NOT merge support price into the main row price.

COMPANION COMMERCIAL ROW PRESERVATION
Native System/Base precedence applies here too: a separately priced item proven to be the primary first-stage System/Base is emitted as a role "system_base" Base/Model row, not as a companion commercial row.
A linkedFamilySuggestion preserves relationship/context only. It does NOT replace extraction of authoritative companion commercial rows when those rows are visibly supplied.

When a separately priced companion family is commercially related to the selected primary family and the supplied source provides actual companion SKU rows:

1. Preserve each distinct companion SKU row separately.
2. Preserve its:
   - supplier code
   - display name / label
   - dimensions
   - currency
   - authoritative price or price map
   - specification
   - importantRequirements
   - source-supported image/reference information where the current contract permits it.
3. Never collapse several companion SKUs into one generic linked-family suggestion if doing so would lose prices, dimensions, or row identity.
4. Never merge the companion price into the primary SKU price unless the manufacturer explicitly publishes one combined complete price.
5. Never move a substantial separately priced furniture companion into primary pricing simply because it has a price.

For ProductTemplateDraft v1:
- when the companion rows are reviewable separately priced furniture and exact requiredness/applicability is not yet proven, preserve them in an optionGroup using the ordinary priced-item fields;
- mark each unresolved companion item reviewStatus: "needs_review";
- use a concise reviewReason explaining that the commercial relationship is clear but exact requiredness and/or row applicability is not fully proven;
- do NOT invent conditionalConfiguration while the relationship remains unresolved;
- allow the user to confirm or exclude the companion in Smart Setup.

If the source explicitly proves exact requiredness and row applicability and the current supported companion structure can safely encode it:
- use the supported Required Companion / conditionalConfiguration structure instead of needs_review;
- preserve fixed quantity only when explicitly proven.

If the companion is explicitly unrelated to the target family:
- exclude it entirely.

If the supplied source explicitly proves the companion is REQUIRED for the selected primary family:
- preserve the companion relationship as required/companion configuration using the existing supported linked/companion mechanisms;
- do not merge the companion price into the primary SKU unless the manufacturer explicitly prices them as one complete SKU.

If the supplied source explicitly proves the companion is OPTIONAL:
- preserve it as an optional linked/companion family using the existing supported mechanisms.

If the commercial relationship is clear from the supplied source, but exact requiredness, compatibility, or row-level applicability is not fully proven:
- do NOT omit the companion;
- preserve it as a linkedFamilySuggestion or other existing reviewable companion representation;
- if available within the current draft contract, mark the unresolved applicability for user review rather than inventing a required rule.

If the source explicitly proves the separately priced item belongs to another unrelated product type:
- exclude it from the selected target family.

Never flatten a separately priced furniture companion into a normal small accessory merely because it appears beside the primary family.

Never add the companion price to the primary row price unless the source explicitly defines one complete combined price.

PRIMARY FAMILY VS COMPANION ROUTING
A separately priced companion furniture family must not change the pricing architecture of the primary family unless the source proves genuine modular composition.

Examples:

- complete category-priced desk/bench rows + separately priced cabinet companion
  -> primary rows remain complete category-priced primary SKUs;
  -> cabinet remains a separate linked/companion family.
  -> when cabinet SKU rows and prices are supplied, preserve those cabinet commercial rows separately as well; do not reduce them to relationship metadata only.

- complete direct-priced desk + separately priced pedestal/service unit
  -> desk remains Base/Model or the correct complete-SKU architecture;
  -> pedestal/service unit remains a separate linked/companion family.

- genuine starter/add-on/module system
  -> use Modular pricing only when the source proves true structural composition between those rows.

Do not route a complete primary SKU family to Modular merely because a separately priced companion cabinet, pedestal, return, or service unit is shown nearby.

CURRENCY

Extract visible currency. Use a clearly stated document/page currency as defaultCurrency. Do not infer currency from manufacturer nationality. Supported currency codes are AED, USD, EUR, GBP, SAR, QAR, KWD, BHD, and OMR. Otherwise use null and add a warning when appropriate.

DIMENSIONS

Use dimensions only when supported. A dimension object contains width, depth, height, diameter, unit, and rawText. Use null for unavailable fields. Preserve exact readable rawText where useful. Do not invent missing dimensions. If a dimension is ambiguous, use null for uncertain structured fields and describe the ambiguity in extractionWarnings.

VARIABLE / RANGE DIMENSIONS
When the manufacturer gives a variable or adjustable dimension range and the current structured dimension field can store only one scalar value, NEVER convert that range to the minimum value, the maximum value, an average, or any arbitrary endpoint as though it were a fixed product dimension.

Examples of source patterns: W 16.4-26.4 cm; H 34-54 cm; H 9-12 cm.

For each ranged axis: set the structured dimension field to null; preserve the complete exact range in dimensions.rawText; preserve useful source-supported range information in specification. Fixed axes may still use numeric structured values normally.

Example:
Source: W 16.4-26.4 x D 24 x H 34-54 cm
Correct structured dimensions: width = null, depth = 24, height = null
Correct rawText: "W 16.4-26.4 x D 24 x H 34-54 cm"

Do NOT store width = 26.4 or height = 54 merely because they are the upper limits.

ACCESSORY TABLE DIMENSION ORDER
For Accessories commercial tables whose visible headers are W / D / H, map them directly to width / depth / height in that exact order. Do not reorder axes based on product orientation, illustration, English prose word order, or assumed furniture conventions.

If the source row is 27 | 27 | 48 under W | D | H, emit width = 27, depth = 27, height = 48, not any permutation of those values.

WARNINGS

Capture concise uncertainty in extractionWarnings, including unreadable price, unreadable code, ambiguous dimension, cropped source, possible missing continuation page, unclear price category, unclear selection rule, unclear target-family applicability, source/context brand mismatch, configuration may be model-defining rather than additive, applicability codes could not be represented structurally in ProductTemplateDraft v1, technical information unavailable, and pricing information unavailable. Do not create warnings for things that are clearly supported.

SOURCE CONFLICTS

If source pages conflict, do not silently invent a resolution. Prefer clearly supported explicit commercial/pricing data where appropriate. If the conflict cannot be safely resolved, preserve the least assumptive value and add an extraction warning. Pricing values must come from explicit commercial/pricing evidence, not from technical illustrations.

CONFIDENCE

confidence must be null or a number from 0 through 1. Use 0.95 for 95%, 0.8 for 80%, and 1 for 100%; never emit 95 for 95%. Use a lower confidence when source is cropped, text is unreadable, category relationships are ambiguous, applicability is unclear, pages appear incomplete, or commercial structure cannot be mapped confidently.

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
    "workstationRows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "additionalPrice": null, "layoutType": null, "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [] }],
    "baseModelRows": [{ "id": "", "groupId": "system-family-id", "groupLabel": "System Family", "role": "system_base", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [] }],
    "priceMatrices": [{ "id": "", "label": null, "columns": [{ "id": "", "label": null }], "rows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] }],
    "modularGroups": [{ "id": "", "label": null, "defaultDimensions": null, "defaultSpecification": null, "matrix": { "id": "", "label": null, "columns": [{ "id": "", "label": null }], "rows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "role": "starter", "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "prices": { "column-id": null } }] }, "composition": { "minStarters": 1, "maxStarters": 1 } }, { "id": "", "label": null, "defaultDimensions": null, "defaultSpecification": null, "pricingMode": "direct", "selectionFamily": "selection-family-id", "directRows": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "role": "starter", "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [] }], "composition": { "minStarters": 1, "maxStarters": 1 } }]
  },
  "optionGroups": [{ "id": "", "label": null, "selection": { "mode": "optional", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] }, "priceCategories": [{ "id": "cat-b", "label": "B" }], "items": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "prices": { "cat-b": null }, "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "reviewStatus": "needs_review", "reviewReason": "Exact target-family applicability is not proven by the supplied source." }] }, { "id": "", "label": null, "selection": { "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] }, "items": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [] }], "conditionalConfiguration": { "role": "companion", "selection": "exactly_one", "applicability": [{ "target": { "kind": "workstation", "group_id": "", "row_id": "" }, "required": true, "visible": true }] } }, { "id": "", "label": null, "selection": { "mode": "optional", "minSelections": 0, "maxSelections": null, "defaultItemIds": [] }, "items": [{ "id": "", "label": null, "displayName": null, "dimensions": null, "currency": null, "price": null, "specification": null, "importantRequirements": [], "supplierCodes": [], "referenceCodes": [], "role": "structural_support", "compatibleTargets": [{ "kind": "base_model", "group_id": "${LEGACY_BASE_MODEL_GROUP_ID}", "row_id": "example-main-row-id" }] }] }],
  "materialSuggestions": [{ "id": "", "label": null, "notes": null, "supplierCodes": [], "referenceCodes": [] }],
  "linkedFamilySuggestions": [{ "id": "", "templateName": null, "templateCode": null, "defaultQuantity": null, "notes": null, "supplierCodes": [], "referenceCodes": [] }],
  "extractionWarnings": [],
  "confidence": null,
  "sources": [{ "id": "", "documentName": null, "pageNumber": null, "region": null, "rawText": null }]
}
The shape above is a field contract, not required sample content. Retain every current ProductTemplateDraft v1 nested field and row shape exactly as encoded by the software schema. Each collection shows one entry per distinct shape, never a shape you must combine: pricing.modularGroups shows a Matrix Modular group followed by a Direct Modular group, and optionGroups shows an ordinary category-priced accessory (no conditionalConfiguration), a Required Companion (outer required_choose_at_least_one plus conditionalConfiguration), and a structural-support item demonstrating role and compatibleTargets field shape only. Emit only the shapes the source actually proves, and take business combinations from the dedicated sections below, not from this field contract. DIRECT MODULAR: pricingMode: "direct" with directRows; OMIT matrix entirely. MATRIX MODULAR: matrix with rows/prices; OMIT directRows, and follow the current matrix convention by omitting pricingMode. The Matrix Modular group's row.role and group.composition shown above demonstrate field shape only, exactly like Direct Modular's role/composition; they are OPTIONAL and must be emitted only when the source proves genuine starter/add-on structural composition (see MATRIX MODULAR COMPOSITION below). Never add pricingMode: "direct" to a Matrix Modular group merely because it carries role/composition; pricingMode: "direct" remains exclusive to Direct Modular groups that use directRows. Never emit an empty matrix as a placeholder inside a direct Modular group. The first optionGroups item's reviewStatus/reviewReason shown above also demonstrate field shape only, exactly like role/composition; they are OPTIONAL on every optionGroups[].items entry and must be emitted only for the specific PRESERVE + NEEDS REVIEW case documented in OPTIONGROUPS.ITEMS REVIEW STATUS below, never invented for an ordinary confirmed accessory. Do not change, remove, or rename fields, and do not add fields beyond documented contract fields such as unavailableCategoryIds, conditionalConfiguration, or reviewStatus/reviewReason. Documented optional optionGroups[].items[] fields also include role and compatibleTargets. Do not include placeholder rows merely because schema examples exist. If a collection has no supported data, return an empty array. Every included item, row, column, group, matrix, material suggestion, linked family suggestion, and source must have a valid non-empty ID.

OPTIONGROUPS.ITEMS REVIEW STATUS
optionGroups[].items[].role is optional. Supported values are "normal" | "companion" | "structural_support"; omit it when source evidence does not prove one of those meanings. Contract examples demonstrate shape only, not default content. Documented contract fields include optionGroups[].items[].role and target.kind "option_item"; do not add other fields.

pricing.baseModelRows[].groupId, pricing.baseModelRows[].groupLabel and pricing.baseModelRows[].role are OPTIONAL native Base/Model fields; the only supported Base/Model row role is "system_base", and ordinary Main Product rows OMIT role (never emit "main_product"). These fields belong only to pricing.baseModelRows: do NOT add Base/Model group fields to workstationRows, priceMatrices rows, modular rows, or optionGroups items, and do not imply they exist on generic priced rows. The baseModelRows example above demonstrates field shape only, not default content. The optionGroups item role remains the independent "normal" | "companion" | "structural_support" namespace; never conflate the two role systems.
optionGroups[].items[].compatibleTargets is OPTIONAL and meaningful only for an option item with role "structural_support"; omit it for every other item, including a normal or companion item. Do not imply every structural support requires compatibleTargets: only emit it when manufacturer evidence proves exact main-product compatibility (see STRUCTURAL SUPPORT / COMPATIBLE MAIN PRODUCTS below). AI extraction emits row-level base_model compatibility targets only: { "kind": "base_model", "group_id": "<exact Base/Model row groupId, or ${LEGACY_BASE_MODEL_GROUP_ID} for an ordinary ungrouped row>", "row_id": "<exact already-emitted pricing.baseModelRows[].id>" }. group_id is exactly the target row's native groupId when it has one, and exactly "${LEGACY_BASE_MODEL_GROUP_ID}" for an ordinary ungrouped Base/Model row; row_id is the exact already-emitted pricing.baseModelRows[].id; never use supplierCodes as row_id; never invent subgroup IDs during extraction. base_model_subgroup is runtime/Smart Setup metadata only and must not be emitted by the extractor. compatibleTargets belongs on optionGroups[].items[] only; do not add it to baseModelRows, workstationRows, priceMatrices rows, modular rows, or conditionalConfiguration.
Every optionGroups[].items entry may optionally carry reviewStatus: "confirmed" | "needs_review" and a short reviewReason string. This is a Smart Setup review-boundary field, not a pricing/commercial field: it never affects price, prices, dimensions, supplier codes, conditionalConfiguration, role, quantity, or selection mode, and it never persists into saved Product Template pricing JSON, Product Library, or quotation data — Smart Setup strips it before Apply.

- OMIT reviewStatus/reviewReason entirely, or use reviewStatus: "confirmed", for an ordinary accessory whose applicability the supplied source proves or that needs no review. Missing reviewStatus behaves as confirmed; never invent reviewReason for a confirmed item.
- Use reviewStatus: "needs_review" plus a concise, trimmed, non-empty reviewReason only for the PRESERVE + NEEDS REVIEW case: a commercially relevant, plausibly related accessory whose exact target-family/row applicability the supplied source does not fully prove. Example reviewReason: "Exact target-family applicability is not proven by the supplied source."
- Do NOT invent conditionalConfiguration/applicability for a needs_review item merely to justify including it.
- Do NOT use reviewStatus: "needs_review" for an item the source explicitly assigns to another product type; that item is excluded from the target template entirely, not preserved with any reviewStatus.
- Never emit any reviewStatus value other than "confirmed" or "needs_review", and never emit an empty reviewReason string — omit reviewReason when there is nothing concise to state.

GLOBAL ACCESSORY APPLICABILITY REVIEW RULE
When an accessory/option is commercially relevant to the supplied manufacturer collection and plausibly related to the selected target family, but exact target-family or row applicability is not proven:
- preserve the item
- mark reviewStatus: "needs_review"
- add a concise reviewReason
- do NOT invent conditionalConfiguration/applicability
- do NOT mark it confirmed

When the source explicitly proves applicability:
- omit reviewStatus/reviewReason or treat it as confirmed

When the source explicitly assigns the item to another product type:
- exclude it from the selected target template
- do NOT use needs_review as a way to bypass clear incompatibility

DIRECT MODULAR SELECTION FAMILY
pricing.modularGroups[].selectionFamily is optional and applies only when the source proves that two or more Direct Modular groups are alternative configuration families that must not be selected together within one quotation item.

selectionFamily is OPTIONAL. When no source-proven cross-group exclusivity exists, OMIT selectionFamily entirely. Never emit "selectionFamily": null or an empty string. The non-empty value shown in the field-contract example demonstrates the field shape only and is not required content.

When used:
- emit the same non-empty stable selectionFamily string on every mutually exclusive Direct Modular group belonging to that alternative family;
- groups with different selectionFamily values may coexist;
- groups with no selectionFamily remain independent and may coexist;
- never invent selectionFamily merely because there are multiple Modular groups;
- never infer exclusivity only from dimensions, labels, group count, or visual proximity;
- use selectionFamily only when manufacturer structure proves that the groups are alternative configurations rather than simultaneously usable module groups.

The runtime enforces that only one Direct Modular group sharing the same selectionFamily may contain selected quantities at a time.

Do not use selectionFamily on Matrix Modular unless future ProjectWorkflow runtime support explicitly requires it.

STRUCTURAL SUPPORT / ITEM-TO-ITEM REQUIRED COMPANION
Structural-support routing takes precedence over the generic Base/Model routing fallback when the same source-proven item would otherwise qualify as a direct-priced row.
When manufacturer evidence proves that a separately priced companion furniture item acts as structural support/base equipment for the selected commercial system, preserve that optionGroups item with "role": "structural_support", not as a normal optional accessory. Only when the source also explicitly proves another separately priced item is mandatory because that structural-support item is selected, preserve the dependent item as a required companion with target: { "kind": "option_item", "group_id": "<structural support optionGroup id>", "row_id": "<structural support item id>" }, required: true, visible: true, and fixed_quantity only when explicitly proven. Preserve the manufacturer's real companion unit price unchanged. Never merge prices, make the required companion independently optional, create name-based dependencies, infer structural_support from visual proximity or furniture names, or invent dependency from compatibility alone. If exact trigger identity is unsafe, preserve rows and add extractionWarning/manual-review wording instead. This is one-level only.

STRUCTURAL SUPPORT / COMPATIBLE MAIN PRODUCTS
This section applies ONLY to genuine option-item structural_support architecture. It does NOT apply to native Base/Model system_base rows: for native system_base, compatibility is group membership. compatibleTargets remains valid in the contract for genuine structural_support items.
When manufacturer evidence proves that a structural-support item is intended for specific complete Base/Model products in the selected system, preserve that compatibility on the structural-support option item using compatibleTargets. For each compatible main product row already emitted in pricing.baseModelRows, emit { "kind": "base_model", "group_id": "${LEGACY_BASE_MODEL_GROUP_ID}", "row_id": "<exact pricing.baseModelRows row.id>" } (for an ordinary ungrouped row; if the compatible row has a native groupId, group_id is that exact row.groupId). Emit one target per exact supported main row. Example architecture only: Support A -> compatible with Main Row 1 -> compatible with Main Row 2 means Support A receives "role": "structural_support", "compatibleTargets": [{ "kind": "base_model", "group_id": "${LEGACY_BASE_MODEL_GROUP_ID}", "row_id": "main-row-1" }, { "kind": "base_model", "group_id": "${LEGACY_BASE_MODEL_GROUP_ID}", "row_id": "main-row-2" }]. Do NOT emit manufacturer codes from this prompt example.

Emit compatibleTargets only when manufacturer evidence proves that the main product belongs to / integrates with / is designed for / fixes to / uses that exact structural-support system. Strong evidence includes wording such as conceptually: desk for [support system]; bench for [support system]; designed for service cabinet [X]; bracket/stirrup for fixing to [support system] included; explicitly drawn/configured with a named structural support. Do NOT infer compatibility from: same catalogue chapter; nearby page placement; matching finish; dimensions; visual similarity; code sequence; naming coincidence; generic cabinet/support wording alone. If compatibility is unclear, preserve the structural-support item, do NOT invent compatibleTargets, and add extractionWarning/manual-review wording when useful.

Structural support -> required companion and structural support -> compatible main products are TWO independent relationships. (A) Structural support -> required companion uses conditionalConfiguration with target.kind "option_item" (example concept: Support A -> required Top B). (B) Structural support -> compatible main products uses item.compatibleTargets (example concept: Support A -> Main Desk C -> Main Desk D). Do NOT encode main-product compatibility using conditionalConfiguration. Do NOT use option_item for support -> main-product compatibility. Do NOT use compatibleTargets for required companion enforcement. Both relationships may coexist on the same structural-support item.

EXTRACTION-TIME COMPATIBILITY TARGETS
During AI extraction, SUPPORTED: { "kind": "base_model", "group_id": "<exact Base/Model row group id or legacy id>", "row_id": "<already-emitted baseModelRows id>" }. "${LEGACY_BASE_MODEL_GROUP_ID}" is used there only when the compatible Main Product rows are ordinary ungrouped Base/Model rows; if compatibleTargets point to a native grouped Base/Model row, group_id must be that exact row.groupId. DO NOT EMIT: base_model_subgroup; Smart Setup visual subgroup ids; generated auto subgroup ids; labels as row_id; supplier codes as row_id; name-based compatibility references. Reason: visual subgroup identities are created/reviewed later in Smart Setup. Smart Setup may later collapse multiple compatible Base/Model row targets into subgroup targets.

OPTIONGROUPS.CONDITIONALCONFIGURATION - ROW-SPECIFIC ENFORCEMENT
scale_with_target_quantity: true is supported only for modular or option_item targets. Never emit it for base_model, price_matrix, or workstation; those targets may use fixed_quantity only.
optionGroups[].conditionalConfiguration is OPTIONAL and reuses the runtime AccessoryConditionalConfiguration/AccessoryModelApplicabilityRule shape exactly; do not rename its fields, change them to camelCase, or invent additional ones. Omit it entirely for an ordinary, independently selectable accessory with no row-specific requirement. Include it only when the source proves the option/companion is a Required Companion or Conditional Option limited to specific rows, mandatory for those rows, or bound to an explicit fixed quantity.
- role: "accessory" | "conditional_option" | "companion". structural_support is an optionGroups[].items[].role only; use it only when manufacturer evidence proves the item itself is a separately priced structural/supporting component that triggers another required companion.
- selection: "unrestricted" | "exactly_one" | "at_least_one" | "choose_multiple" — the runtime enforcement cardinality, separate from the outer optionGroup.selection.mode.
- applicability: an array of rules, one per exact applicable row; each rule needs a COMPLETE target: { kind: "base_model" | "price_matrix" | "modular" | "workstation" | "option_item", group_id, row_id } naming the precise target. For option_item use { "kind": "option_item", "group_id": "<exact optionGroups[].id containing the trigger item>", "row_id": "<exact already-emitted optionGroups[].items[].id>" }; never use supplier code as row_id, invent a group id, use option_item unless its trigger is an already-emitted option item, or use it for a pricing row. Never leave a row-specific rule without a target, omit group_id, or create one unscoped/global rule when the source names specific rows.
- allowed_item_ids: optional array restricting which of this group's items apply under that rule (for example ["art-175","art-129"] for an exactly-one choice between two allowed legs); omit only when every item in the group is allowed.
- required and visible: booleans stating whether the rule is mandatory and shown for its target row.
- fixed_quantity: a positive integer for an explicit manufacturer-required quantity (for example 2 for "always complete with 2 ART.058"). Preserve the item's real unit price unchanged and put the quantity only in fixed_quantity; never multiply price by quantity into a new item price, and never fabricate a "N x <code>" item to represent it. fixed_quantity is optional and never nullable: OMIT the field entirely when no fixed quantity applies; never emit "fixed_quantity": null.
- scale_with_target_quantity: optional boolean, allowed only for a modular or option_item target with fixed_quantity and selection other than exactly_one — use "at_least_one" for this shape, never "exactly_one" (the runtime rejects that combination). Do NOT permit it for base_model, price_matrix, or workstation targets. For option_item, use it only with an explicit fixed_quantity and a supported non-exactly-one selection mode. When true, multiply fixed_quantity by the selected target-row quantity. For ART.058 at EUR 69, use conditionalConfiguration.selection "at_least_one" with fixed_quantity: 2 and scale_with_target_quantity: true: one selected starter needs 2, starter plus one intermediate needs 4, and starter plus two intermediates needs 6; never create an EUR 138 synthetic item.

COMPANION SELECTION MODE — CHOOSE-ONE VS QUANTITY-SCALED
Never default a Required Companion to conditionalConfiguration.selection "exactly_one" without checking which of these two shapes the source actually describes; picking the wrong one produces an invalid combination the runtime rejects.
A. CHOOSE-ONE COMPANION — the source requires exactly one of several alternative items (for example ART.175 OR ART.129, or one of several leg/base options). Use outer optionGroup.selection = { "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] } and conditionalConfiguration.selection = "exactly_one". Do not set scale_with_target_quantity.
B. QUANTITY-SCALED REQUIRED COMPANION — the source requires N units of one single SKU for every applicable row (for example 2 × ART.058 per bench module). Use the SAME outer optionGroup.selection = { "mode": "required_choose_at_least_one", "minSelections": 1, "maxSelections": null, "defaultItemIds": [] }, but conditionalConfiguration.selection = "at_least_one" (never "exactly_one" — the runtime rejects scale_with_target_quantity combined with "exactly_one"). Set fixed_quantity to the manufacturer's per-row quantity and scale_with_target_quantity: true on each targeted rule so the aggregated required quantity multiplies by the selected quantity of that target row.
Both shapes use the identical outer optionGroup.selection; only conditionalConfiguration.selection (and scale_with_target_quantity) differs. Never use outer optionGroup.selection.mode "required_choose_one" or "choose_one" for a Required Companion group — the runtime treats that outer shape as unsafe and drops the entire group rather than applying it, regardless of what the inner conditionalConfiguration says.

For a required companion group triggered by an option_item, do NOT emit allowed_item_ids merely to name the companion item itself when that group already contains the dependent item. allowed_item_ids is only for restricting which items in a multi-item companion/option group are valid for a given applicability rule. Example: Support A -> required single Top B. The rule targets Support A. Do NOT add "allowed_item_ids": ["top-b"] merely to repeat that Top B is the sole item in its group. This prevents the malformed pattern previously seen where the validator reports that allowed_item_ids references an invalid/current-group item.

TARGET GROUP_ID CONVENTION — REQUIRED FOR EVERY TARGET
Choose target.kind and group_id only after routing the authoritative row into its final pricing structure. row_id always equals the exact stable id already assigned to that row/item in that structure (for example "oxi-q-ws-dx") — never a supplierCodes entry such as "111 623", and never invented from a code, label, or family name. For target.kind "price_matrix" or "modular", group_id is the exact pricing.priceMatrices[].id or pricing.modularGroups[].id that contains that row. For target.kind "base_model": (A) when the row has a native groupId, group_id is that exact row.groupId; (B) when the row has no groupId, group_id is "${LEGACY_BASE_MODEL_GROUP_ID}". In both cases row_id is the exact already-emitted pricing.baseModelRows[].id, never a supplier code, group label, or invented subgroup id. pricing.workstationRows is a flat array with no group wrapper in this draft; use group_id: "${LEGACY_WORKSTATION_GROUP_ID}" only for an actual workstation target. Use these exact fixed strings verbatim; do not invent a different group_id, leave it blank, or derive one from the row/family name.
Emit conditionalConfiguration IN ADDITION TO, never instead of, the informational importantRequirements text on the affected priced row; each carries a different audience (importantRequirements is user-facing prose, conditionalConfiguration is the structural rule ProjectWorkflow enforces).

ACCESSORY CATEGORY-PRICE EXAMPLE: A CUSHIONS optionGroup may use priceCategories in source order [{ id: "B", label: "B" }, { id: "C", label: "C" }, { id: "D", label: "D" }, { id: "E", label: "E" }, { id: "F", label: "F" }, { id: "G", label: "G" }, { id: "SUPREME", label: "SUPREME" }]. For 1AG 958 Cushion for pedestals, use prices { "B": 93, "C": 99, "D": 105, "E": 110, "F": 115, "G": 121, "SUPREME": 162 } in that option item. This is a category-priced accessory in optionGroups, NOT pricing.priceMatrices. Ordinary accessories remain scalar-priced: use price and omit prices/priceCategories. A chair model × upholstery category price table remains a PRIMARY pricing.priceMatrices structure.

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
15. No undocumented ProductTemplateDraft fields were added; selectionFamily is used only according to the documented Direct Modular Selection Family contract, and reviewStatus/reviewReason are used only according to the documented optionGroups item review contract.
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
28. Every commercially relevant accessory with uncertain target-family applicability was preserved as reviewStatus: "needs_review" with a concise reviewReason; confirmed accessories were not unnecessarily review-marked; and accessories explicitly proven to belong to another product type were excluded rather than preserved for review.
29. Every separately priced companion furniture family that is commercially part of the selected target system was preserved separately rather than silently omitted or flattened into a normal accessory; exact required/optional relationships were emitted only when proven by the source, unresolved relationships were preserved for review, and companion prices were not merged into primary SKU prices unless explicitly combined by the manufacturer.
30. Every supplied separately priced companion furniture SKU retained its authoritative commercial row data — including code, dimensions, currency, price or price map, and supported specification — rather than being reduced only to linkedFamilySuggestions; unresolved companion applicability/requiredness was preserved for user review, and no companion price was merged into the primary SKU unless the manufacturer explicitly publishes a combined price.

31. A source-proven structural-support companion item uses role "structural_support" rather than being flattened into a normal optional accessory.
32. Any option_item applicability target uses the exact already-emitted optionGroup id and option item id, never supplier code or a pricing-row legacy group id.
33. An item-to-item required companion relationship was emitted only when manufacturer evidence proves that selecting the structural-support item requires the dependent item.
34. No unsupported recursive/multi-level dependency graph was invented beyond the supported one-level option-item -> required companion relationship.
35. A source-proven structural-support item was routed to optionGroups with role "structural_support" before applying ordinary Base/Model fallback logic.
36. No structural-support item was duplicated in both pricing rows and optionGroups.
37. scale_with_target_quantity is used only for supported target kinds (modular or option_item).

38. When exact structural-support -> Base/Model compatibility is source-proven, the structural-support item carries compatibleTargets for those exact main rows.
39. Every extraction-time compatibleTargets entry uses kind "base_model"; group_id is the exact target Base/Model row groupId when that row has a native groupId, otherwise group_id is exactly "${LEGACY_BASE_MODEL_GROUP_ID}" for an ungrouped Base/Model row; row_id is the exact already-emitted Base/Model row id.
40. No extraction-time compatibleTargets entry uses a Smart Setup subgroup id, generated auto subgroup id, supplier code, label, or invented row id.
41. Structural-support -> required companion remains encoded with option_item conditionalConfiguration, while structural-support -> compatible main products remains encoded with compatibleTargets; the two relationships were not conflated.
42. Base/Model rows compatible with structural support remained authoritative Base/Model rows and were not moved into optionGroups or Modular pricing merely because of that dependency.
43. A source-proven primary first-stage priced System/Base was emitted as a Base/Model row with role "system_base", not as a structural_support accessory.
44. Every native System/Base row and its compatible Main Product Base/Model rows share the same exact groupId and groupLabel.
45. Ordinary Main Product rows in a native System group omit role; "main_product" was not invented.
46. Native System -> Main Product compatibility is represented by Base/Model group membership, not compatibleTargets, conditionalConfiguration, option_item, or name-based filtering.
47. A required companion triggered by a native System/Base uses target.kind "base_model", the exact native groupId, and the exact system_base row id.
48. System/Base price and Main Product price remain separate authoritative source prices; no synthetic combined row or merged price was created.
49. No fake one-column Matrix or invented Smart Setup subgroup ID was created to preserve native System grouping.
50. structural_support / compatibleTargets remains reserved for genuine option-item support/companion architecture where the support is not the primary first-stage System/Base selection.
51. A required companion targeting a native system_base/base_model row does not contain scale_with_target_quantity.

Return only the final JSON object now.`;
}

export const productTemplateSetupPlanningFocuses = ["general", "chair_seating", "desk_executive", "workstation", "sofa_lounge", "meeting_conference", "storage_cabinets", "screens"] as const;
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

Multiple native System/Base groups do NOT automatically require separate Product Templates. Keep several System/Base groups inside ONE Product Template when ALL are true: they belong to one coherent manufacturer commercial family; they use the same overall pricing/configuration architecture; Product Library should present the user with System/Base -> Main Product -> Model; their Main Product families are commercially related; and keeping them together remains understandable and safe. Example concept: one manufacturer family may contain System A and System B as separate native Base / Model groups inside one Product Template. Split into separate Product Templates when the systems are unrelated commercial families, Sales would never configure them together, pricing mechanisms differ materially, composition/configuration logic differs materially, or compatibility boundaries would become unsafe or confusing. Do NOT split merely because System/Base codes differ, System/Base dimensions differ, one System serves desks and another serves benches, or the catalogue gives them separate page headings.

GLOBAL PRICING DECISION ORDER
Always evaluate (1) BASE / MODEL, then (2) CATEGORY / MATRIX, then (3) MODULAR.
- BASE / MODEL: default for authoritative direct-priced commercial SKUs. It also supports native multi-stage System/Base families: a first-stage priced System/Base row and its compatible direct-priced Main Product rows may remain in the same Base / Model Product Template/group structure. System/Base and Main Product retain separate supplier codes, separate prices and separate commercial identity. Do not merge their prices, do not create synthetic combined SKUs, do not classify the relationship as Modular unless manufacturer evidence proves genuine component/module composition, and do not classify the System/Base as an accessory merely because it is a cabinet, service unit, base, support or storage element. A native System/Base configuration still counts as Base / Model pricing. Multiple direct-priced rows do not justify Matrix.
- CATEGORY / MATRIX: only for a genuine manufacturer-proven row-by-category price dimension, such as Model x Fabric Cat A / B / C / D or explicit finish-price classes. Many SKUs, many finishes, a visual grid, or one "Standard Price" column do not justify Matrix. A System/Base with multiple direct-priced Main Product SKUs is NOT a Matrix merely because one System supports many Main rows, rows appear in a large catalogue grid, or there are multiple families/configurations; Matrix still requires genuine row x price-category semantics, and native System/Base groups remain Base / Model when every commercial row has its own direct price.
- MODULAR: only for proven component-built composition such as terminal/intermediate/end units, sofa modules, workstation compositions, or shared-side bookcases. Normal size, finish, handed, open/closed, and accessory variation is not Modular. Do NOT use Modular merely because System/Base + Main Product + required companion must be selected together; that is not sufficient modular evidence. Use Modular only when manufacturer pricing/composition is genuinely built from modules/components whose quantities/composition form the sellable product.
A row with its own supplier code and direct price is commercially authoritative; preserve it rather than replacing it with synthetic combinations.

NATIVE SYSTEM / BASE ARCHITECTURE
ProjectWorkflow supports native multi-stage Base / Model configuration. A Product Template may contain several native Base / Model groups. Within one native group, one or more rows are the first-stage System/Base selection, and the downstream Main Product rows are direct-priced rows of the same group. The Product Library flow is System / Base -> Main Product Family / Configuration -> Model / Size -> Required Components -> Optional Accessories. System/Base and Main Product prices are separate authoritative source prices summed at quotation time, and System/Base quantity is separately selectable. Compatibility is structural through native group membership. This is NOT Accessories / Configuration, and it is NOT Modular merely because both a System/Base and a Main Product are required.
When manufacturer evidence proves that a separately priced item is the PRIMARY first-stage commercial System/Base selection and downstream desks, benches, tables, storage, worktops or other Main Products are explicitly designed for that System/Base, recommend native Base / Model System architecture. Planning output must identify: the System/Base commercial item(s); the compatible Main Product family/families; whether several System/Base variants share the same Main Product families; whether different System/Base selections require separate native groups; whether System/Base quantity can vary; required companions of the System/Base; optional accessories; and the source evidence proving the relationship.
Do NOT infer System/Base status from words alone such as cabinet, storage, support, service unit, pedestal, base, return, or bridge. The source must show that the item is the first-stage commercial selection controlling downstream Main Product choice. If it is merely a support/companion item attached to an independently selected Main Product, keep using Accessories / Configuration / companion logic instead. Genuine structural/support furniture that is not the primary first-stage System may still use accessory/companion architecture.

SOURCE-PROVEN PRIMARY SYSTEM PRECEDENCE
If an item is separately priced, commercially selected first, has its own authoritative supplier code/SKU, and determines which downstream Main Products may be chosen, plan it as native Base / Model System/Base. Do NOT plan that same item as a Normal Accessory, Conditional Option, or Required Companion unless the source shows it is actually a supporting item rather than the primary System/Base. A System/Base may itself have Required Companions and optional accessories. A primary native System/Base is NOT classified under the accessory/component commercial statuses relative to its Main Product; it is a first-stage Base / Model commercial selection.

NATIVE SYSTEM GROUP BOUNDARIES
When several System/Base variants exist: if they share the same downstream Main Product families, they may belong to one native System group; if their downstream Main Product families differ, plan separate native Base / Model groups. Planning does NOT output internal group identifiers; it only identifies the commercial grouping that extraction should preserve. Do not invent Smart Setup subgroup identifiers during planning.

SYSTEM / BASE QUANTITY
For a native System/Base family, always inspect whether the selected Main Product requires one System/Base unit, multiple System/Base units, a source-dependent quantity, a user-selected quantity, or whether the source is unclear. Do NOT infer Bench = 2, Desk = 1, or any other furniture-domain rule. Only state an automatic required System/Base quantity when manufacturer evidence explicitly supports it. Otherwise write: MANUAL DECISION - System/Base quantity relationship not explicit. The current Product Library supports manual System/Base quantity selection.

REQUIRED COMPONENT QUANTITY BEHAVIOR
For a REQUIRED SEPARATE ITEM, distinguish: (A) fixed configured quantity, for example "always complete with 1 Art.X"; (B) quantity follows the selected target quantity, for example "1 Art.X for each selected System/Base"; (C) manually adjustable or unclear quantity. State the Quantity behavior as Fixed, Follows target quantity, or User-adjustable / MANUAL DECISION. Do not collapse all required companions into one fixed-quantity concept, and do not infer follow-target behavior unless the source language explicitly supports it. ProjectWorkflow may auto-select source-proven Required Companions and calculate their recommended quantity, but users can intentionally override or unselect them. Planning output should therefore preserve the source-required status, the source-required/recommended quantity, and whether the quantity follows another selected target. Do NOT downgrade the commercial status merely because the UI allows manual override: Required still means manufacturer-required, and a manual override is a Sales/user action, not evidence that the component is optional.

SHARED ACCESSORIES IN NATIVE SYSTEM FAMILIES
For native System/Base families, a shared accessory may apply to the System/Base itself, one Main Product family, selected Main Product rows, or the whole native System family. Planning must identify which level the manufacturer evidence supports. Do NOT automatically propagate a System-compatible accessory to every Main Product row unless the source supports that.

NEW TEMPLATE VS UPDATE EXISTING TEMPLATE
When planning additional manufacturer pages that belong to an already-created coherent Product Template, recommend updating the existing Product Template via Edit in Smart Setup / + Add More JSON. Do NOT recommend creating a duplicate template merely because new pages or missing SKUs were discovered later. Create a new Product Template only when the normal Product Template splitting rules justify it.
Smart Setup workflow. For NEW templates: create template -> copy planning/extraction prompt -> extract Batch 1 -> Import & Review JSON in Smart Setup -> + Add More JSON for later batches -> review System/Base groups, Main Product families, required components and accessories -> Apply to Product Template -> save. For EXISTING saved templates: Product Template -> Edit in Smart Setup (no PDF required, no original extraction JSON required) -> + Add More JSON when extending the template -> review -> Save Changes to the same template. Do not imply every update requires a fresh Product Template.

NATIVE SYSTEM EXTRACTION BATCHING
For native System/Base templates keep commercial relationships together. Prefer Batch 1 = System/Base + directly related Main Product core pages, and a later batch = verified required companions / accessories / supporting pages, when token/page limits require splitting. Do NOT extract the System/Base in one isolated template/batch and its Main Product family into another Product Template when they belong to one native configuration; use + Add More JSON to extend the same template.

NATIVE SYSTEM PLANNING ROADMAP WORDING
In the FAMILY / EXTRACTION ROADMAP the Recommended setup value stays Base / Model; do not invent a new destination name and do not write System/Base in the destination column as if it were a separate ProjectWorkflow pricing destination. Explain it in the PRODUCT section as: Native System/Base -> Main Product configuration. Keep planning output human-readable: never emit ProductTemplateDraft JSON, group identifiers, role fields, conditional configuration or target JSON.

CONFIGURATION AND FINISH EVIDENCE
Keep INCLUDED, REQUIRED SEPARATE, OPTIONAL SEPARATE, COMPATIBLE ONLY, ADVISORY / INSTALLATION REQUIREMENT, and UNCONFIRMED distinct. "Compatible with", "suitable for", "for use with", "for X only", "for whole blind doors only", "for split blind doors", "for glass doors", "can be completed with", and "available with" establish compatibility / allowed applicability only, never a requirement or exactly-one rule. Required status needs explicit mandatory evidence such as "must be completed with" or "always complete with"; otherwise use Manual Decision / Warning. "Without shelves", "without doors", "without armrests", "without top-access", and "open cabinet" are valid sold configurations and never imply that the omitted component must be purchased. Treat "must be fixed to wall" or "wall fixing required to prevent overturning" as an installation/safety requirement in specification or warning, not a separately priced Required Companion; retain depth/height applicability where supported. "Wall fixing kit included" is INCLUDED in the base SKU and must not be duplicated. Only an explicit separate commercial kit, such as "complete with fixing kit Art. XXX", "fixing kit must be ordered separately", or "required kit Art. XXX", can be Required Companion. A fixing-kit page reference or compatibility wording alone is not required. Multiple finish codes at the same price belong in Finish Guidance/options; only explicit finish/category price differences justify Matrix.

SCOPE OF A MANDATORY RULE
A mandatory statement proved on one manufacturer family/page applies ONLY to the rows/family explicitly covered by that evidence. Do NOT propagate "always complete with", a fixed quantity, Required Companion, INCLUDED, or PREPARED FOR to another family merely because both products have a similar feature, both are desks or benches, both show top-access, both use the same accessory elsewhere, their drawings look similar, the accessory is listed on a shared page, or another family explicitly requires it. A directly priced row labelled "with X" may already include X in that commercial SKU/price. If Family A says "always complete with 2 Art.X" but Family B has separately priced rows "with X" and does NOT repeat the mandatory instruction, do NOT infer that Family B also needs 2 Art.X: treat the Family B commercial row as pricing-authoritative, and use MANUAL DECISION only if inclusion remains genuinely unclear.

DIRECT-PRICED FEATURE SAFETY CHECK
When a commercial SKU/row is explicitly sold as with top-access, with doors, with cable management, with screen, with extension, or with another named component/feature, and has its own direct price, first determine whether that feature is already represented in the row's commercial price. Do NOT add the same feature again as a Required Companion merely because the component also has an independent article number elsewhere. Only add it separately when the source explicitly says the direct-priced row must ALSO be completed with that separately priced article. If unclear: MANUAL DECISION - possible double charge.

PLAN CONSISTENCY ACROSS SECTIONS
If a family is declared as a separate PRODUCT section, or its roadmap row says "Extract separately? Yes", do NOT later place that family's pages into another Product Template's + Add More JSON batch. Example: if Panel Base System is PRODUCT 2 and is marked Extract separately = Yes, its pages must never appear in an Add More JSON batch for PRODUCT 1. Before returning, cross-check the FAMILY / EXTRACTION ROADMAP, the PRODUCT sections, SOURCE / EXTRACTION BATCHES, and the extraction-order steps when present: they must describe the same Product Template boundaries.

PAGE NUMBERING VERIFICATION
Do NOT infer that PDF and printed numbering remain 1:1 throughout the document because early pages match. Verify numbering at the beginning, the middle, and the end / last available pages before declaring a global offset or 1:1 relationship. Never output a PDF page number greater than the actual PDF page count. If printed pages continue beyond the PDF viewer page count, report the actual mapping instead of copying the printed number into the PDF column.

SHARED SUPPORTING PAGES AND BATCHES
Do NOT create one catch-all "Shared Elements / Technical Info" extraction batch covering many common pages merely because they are in one catalogue section. For each Product Template, supporting extraction pages must be limited to items whose applicability to that template is verified. Split supporting work by purpose: required companion pages, verified optional accessory pages, Manufacturer Finish Guidance, and manual-inspection-only pages. Technical descriptions, generic diagrams, unrelated shared accessories and unconfirmed common elements must not automatically be included in an extraction batch. A broad range such as "pages 42-67 shared elements" is invalid unless every included page has a verified reason to be extracted for that same Product Template.

ROADMAP PRIORITY VALUES
The Priority column may contain ONLY: BEST FIRST TEST, Current, Next, or Later. Never output Separate catalogue, Future, Excluded, N/A, or any other value. A family handled from another catalogue should normally use Later, and the catalogue separation is explained in Extract separately?, SEPARATE LATER, or WARNINGS.

MANUFACTURER FAMILY VERSUS PROJECTWORKFLOW CONSOLIDATION
When several manufacturer-defined families are intentionally combined into one Product Template for ProjectWorkflow usability, say so explicitly. Distinguish "Manufacturer families: [A, B, C]" from "ProjectWorkflow consolidation: ONE Product Template because they share the same pricing and configuration flow." Do not rewrite several manufacturer-defined families as though the manufacturer itself defines them as one family. In the FAMILY / EXTRACTION ROADMAP keep one row per true manufacturer family even when several rows later combine into one Product Template.

FINAL CROSS-SECTION CONSISTENCY CHECK
Immediately before returning the plan, reconcile every family across: (1) roadmap family, (2) assigned Product Template, (3) source pages, (4) supporting pages, (5) extraction batch, and (6) extraction-order destination. All six must agree. No family marked separate may silently enter another template later. No required accessory may appear without family-specific evidence. No PDF page may exceed the supplied PDF page count.

UNRELATED FAMILIES
Actively identify nearby manufacturer families that must be handled separately. Put them under SEPARATE LATER with their printed/PDF page ranges when known and a short reason; do not mix them into the current extraction batch.

GLOBAL PLANNING SELF-CHECK - CORRECT THE PLAN BEFORE RETURNING
Check: Did I create Matrix where Base / Model is sufficient? Did I create Modular without real composition? Did headings alone split templates? Did compatibility become requirement? Did "without" create a missing required component? Did I mix unrelated families? Did I provide usable source page ranges and batches? Could fewer templates preserve the same commercial truth? Did I misclassify a primary first-stage System/Base as an accessory? Did I split one coherent native System family into unnecessary Product Templates? Did I merge unrelated System families merely because they share a chapter? Did I incorrectly choose Modular just because System/Base + Main Product must both be selected? Did I incorrectly choose Workstation Pricing where native Base / Model System architecture fits better? Did I preserve separate System/Base and Main Product prices? Did I identify source-supported System/Base quantity behavior without guessing? Did I distinguish fixed required-component quantity from quantity-follow-target behavior? Did I plan new pages as Add More JSON to an existing template where appropriate? Does every extraction batch and every Extraction Order step preserve the Product Template boundaries declared earlier in the plan? Did I copy a Required Companion rule from one family onto another family without explicit/cross-referenced evidence? Did I add a separately priced component to a direct-priced "with feature" row that may already include it? Does every stated PDF page actually exist in the supplied PDF? Did I include FAMILY / EXTRACTION ROADMAP before PRODUCT sections, represent every detected commercial family, provide printed/PDF page columns, recommended setup, extract-separately guidance, and priority, choose at most one BEST FIRST TEST, and avoid a broad range covering unrelated families?

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
- Configuration: [one sentence; for native System/Base architecture: Native System/Base -> Main Product Family -> Model / Size]
- System/Base: [commercial System/Base family/items; only for native System/Base architecture]
- Main Product families: [family list; only for native System/Base architecture]
- System/Base quantity: [Fixed | user-selectable | source-defined | MANUAL DECISION; only for native System/Base architecture]
- Required Components: [summary or None; for each Required Companion state Quantity behavior: Fixed | Follows target quantity | User-adjustable / MANUAL DECISION | Not applicable, and give the Quantity only if explicitly supported]
- Optional Components: [summary or None]
- Finish Guidance: [summary or None]
- Native System/Base structure (only when native System/Base architecture applies; omit for ordinary products):
  - System/Base selection: [...]
  - Main Product families: [...]
  - System quantity behavior: [...]
  - Native group boundary: [...]
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
  workstation: `WORKSTATION / BENCH SYSTEMS PLANNING FOCUS
Plan workstation and bench families using the PROJECTWORKFLOW DESTINATIONS Workstation Pricing routing guidance below: a complete direct-priced workstation/bench SKU is Base / Model, a simple complete-price workstation/bench family fits Workstation Pricing, genuine finish/category pricing is Category / Matrix, and a proven starter/add-on or component-built composition is Modular. For every workstation family state the recommended architecture and why, and note whether the source shows complete SKU pricing, required companions, fixed quantities, starter/add-on composition, finish-dependent pricing, or separately priced screens/accessories/storage integration. Ignore unrelated desks, seating, tables, and storage families unless the source explicitly ties them to the workstation/bench system.
A workstation/bench catalogue may contain a priced System/Base plus priced desk/bench Main Product rows. If the System/Base is a first-stage commercial choice and the desk/bench rows are complete direct-priced Main Products designed for it, recommend native Base / Model System architecture. Do NOT automatically choose Workstation Pricing, Modular, or Accessories / Configuration merely because the source describes a workstation, bench or support system. Workstation Pricing remains only for the existing narrow simple complete-price workstation/bench use case, and Modular remains only for proven starter/add-on/component composition.`,
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
  screens: `SCREENS / DIVIDERS PLANNING FOCUS
Use this focus for front screens, lateral/side screens, desk-mounted screens, bench screens, frameless screens, framed screens, acoustic screens, felt screens, upholstered screens, glass/acrylic screens, freestanding desktop screens, floor screens/room dividers, modesty-screen combinations, and mixed-material floor screens. Transform reviewed manufacturer extraction JSON plus manufacturer source evidence into a concise Product Setup Plan: how many Product Templates are appropriate and why, which manufacturer screen families belong in each, the correct pricing destination for each family, Base/Model group structure, Matrix groups, installation/support systems, required companions, ordinary accessories, finish/material guidance, configuration-dependent/manual rules, reusable Linked Product candidacy, and architecture/runtime gaps that should be solved generically. Preserve manufacturer truth even when today's runtime has a gap.

SCREEN TEMPLATE BOUNDARY PRINCIPLE
Do NOT automatically create one Product Template per material, height, width, front vs lateral, acoustic variant, mounting style, or finish family. First identify the manufacturer's real commercial family structure. Prefer ONE reusable Screens Product Template when several screen families belong to one manufacturer screen collection, share one sales/product purpose, can reasonably be navigated through family/group selection, share finishes/accessories/mounting ecosystem, and remain independently understandable inside that template. Split into separate Product Templates only when the source proves genuinely separate commercial families or when the resulting configuration would become commercially misleading. Do NOT split templates solely because today's Product Library cannot yet mix two supported pricing destinations: if one manufacturer Screen template naturally requires both direct Base/Model families and genuine Category/Matrix families, preserve that intended template structure in the plan and flag the runtime gap instead of splitting.

SCREEN COMMERCIAL FAMILY IDENTIFICATION
Recognize useful manufacturer family boundaries such as front screens, lateral/side screens, desk-mounted screens, bench screens, frameless screens, framed screens, acoustic screens, felt screens, upholstered screens, glass/acrylic screens, freestanding desktop screens, floor screens/room dividers, modesty-screen combinations, and mixed-material floor screens. These may become Base/Model groups, Matrix groups, or Product Template family/subgroup structure depending on source pricing. Do not merge commercially distinct rows merely because they use the same material.

BASE / MODEL PLANNING
Recommend Base / Model when the manufacturer publishes an authoritative direct price for each screen SKU/configuration, typically material/construction -> width/height -> authoritative supplier code -> direct price (for example melamine screen by width, glass screen by width, framed screen by width, floor screen by width/height/material, or a side screen with its own authoritative SKU). Do NOT recommend Matrix merely because several materials, widths, heights, finishes, or screen forms exist. Where manufacturer commercial families are meaningful, recommend Base/Model commercial families / visual subgroups to keep the selector understandable.

Examples may include:
- Frameless Front Screens
- Frameless Side Screens
- Framed Desk Screens
- Floor Screens

These are ordinary Base/Model family/subgroup organization unless the source independently proves a genuine first-stage System/Base architecture. Do NOT call an ordinary Screen family a native System/Base group. Reserve Native System/Base only for the existing source-proven System/Base -> Main Product architecture; only use grouping when it helps preserve a real manufacturer family boundary.

CATEGORY / MATRIX PLANNING
Recommend Category / Matrix only when the source contains a real commercial price-category dimension, typically screen model/size x fabric/upholstery category (B/C/D/E/F/G/I) with different prices. Finish colours with the same price are NOT Matrix columns. If one Screens Product Template contains some Base/Model groups and some Category/Matrix groups, plan both correctly; do NOT force one pricing type across the entire template.

MIXED BASE/MODEL + MATRIX RUNTIME GAP
Current known ProjectWorkflow limitation: Product Template persistence can contain Base/Model and Category/Matrix structures together, but current Product Library primary pricing selection effectively chooses one route and cannot safely expose independent Base/Model and Matrix screen families side-by-side in one template. When the manufacturer source naturally requires both, do NOT recommend artificial template splitting merely to avoid this limitation. Instead include in Architecture Gaps: "MIXED PRIMARY PRICING FAMILY SELECTION REQUIRED", explaining concisely that Product Library should let the user choose the commercial screen family first, after which that family can use its native pricing mode (for example Family -> S1 Melamine -> Base/Model; S2 Fabric -> Matrix; S3 Acoustic -> Matrix; S5 Felt -> Base/Model). Identify this as a generic runtime improvement, not a manufacturer-specific hack.

INSTALLATION / MOUNTING SYSTEMS
Desk rails, cable-management rails, flap assemblies, cable trays, mounting brackets, clamps, and similar installation systems are normally NOT primary Screen products. Plan them under Accessories / Configuration / Required Companion as appropriate. Do not recommend Base/Model for installation systems merely because they have direct supplier codes and prices. Preserve meaningful installation families such as rail for 18mm top, rail for 25mm top, rail for 30mm top, bench rail, cable-tray rail, full-length flap, framed-screen bracket, or framed-screen clamp without collapsing distinct authoritative SKUs.

INCLUDED VS REQUIRED SEPARATE HARDWARE
Distinguish exactly: INCLUDED (for example "supplied with mounting brackets") stays included in the primary SKU with no extra Required Companion and no duplicate price; REQUIRED SEPARATELY (for example "mounting brackets not included; order separately") becomes a Required Companion when exact applicability can be represented safely, otherwise configuration-dependent/manual decision; OPTIONAL applies only when source genuinely says the hardware/accessory is optional. Do not downgrade REQUIRED-SEPARATE hardware to an ordinary optional accessory.

REQUIRED COMPANION ALTERNATIVES AND SIMULTANEOUS REQUIREMENTS
For a pattern such as screen -> exactly one of Mount A / Mount B, recommend a Required Companion group with exactly_one selection and allowed compatible mounting items; do not select one automatically unless source gives deterministic evidence. For screen -> Mount A REQUIRED PLUS exactly one of Mount B / Mount C REQUIRED, recommend separate Required Companion groups; never recommend one global mounting group if doing so prevents independent requirements from being active simultaneously.

CONFIGURATION-DEPENDENT MOUNTING
Some mounting requirements depend on information outside the Screen SKU, such as desk vs bench, desktop thickness, middle gap, cable tray, flap, desk range/system, central crossbeam, fixed/sliding top, or external workstation construction. If current ProjectWorkflow cannot express the condition exactly, planning must say MANUAL DECISION / CONFIGURATION-CONTEXT GAP rather than manufacture a universal Required Companion; preserve compatible mounting items, manufacturer conditions, exclusions, and screen-family applicability.

FLOOR SCREEN COMPOSITIONS
Treat floor screens as independently configurable Screen products. Recognize relationships such as linked screens -> hinge kit required, where hinge selection may depend on screen height or connection state, and freestanding compositions -> stabilizing legs/flat bases, where quantity or type may depend on number of linked screens, end position, middle/shared position, wall length, or composition geometry. Do not recommend unconditional companion rules when those conditions are not represented by current runtime; use MANUAL DECISION / CONFIGURATION-CONTEXT GAP where necessary.

SCREEN ACCESSORIES
Ordinary accessories may include tool bars, document trays, pen holders, phone/tablet holders, hooks, flower holders, accessory rails, plinths, optional panels, and desk-to-floor-screen fixing sets. Keep them optional unless manufacturer evidence makes them required, and preserve exact compatibility when source proves it.

DIRECT SKU WITH INCLUDED FEATURE
When the manufacturer sells separate direct-priced SKUs such as screen, screen with one accessory rail, and screen with two accessory rails, retain the authoritative SKUs. Do not recommend base screen + duplicate priced rail when the rail is already included in the priced SKU; avoid double charging.

SUPPLIER CODE COMPOSITION
Some manufacturers define base article code + selected finish code = final commercial/order code (for example article 123456 + finish 789 = 123456789). If source explicitly proves this relationship, planning must preserve the base article, finish code, and composition rule, and flag: DYNAMIC SUPPLIER CODE COMPOSITION REQUIRED, because current runtime does not natively compose the final supplier code. Do NOT recommend duplicate pricing rows for every finish, synthetic pre-composed SKUs, or manual price duplication by finish; the recommended future generic architecture is an explicit supplier-code composition policy evaluated when configuration is selected and persisted in quotation snapshot/repricing. Only flag this when manufacturer source explicitly proves code composition.

PTS / POINT PRICING
If source pricing is in PTS/points rather than currency, planning must explicitly state the source price basis is PTS, that no currency should be assumed, and that point-to-monetary conversion must be configured before quotation use. Do not recommend treating PTS directly as EUR/AED/USD. This is commercial setup guidance, not a pricing-architecture reason to split templates.

FINISH / MATERIAL PLANNING
Separate finish/material colour, upholstery price category, and supplier/order-code suffix; do not confuse them. Recommend Material/Finish Guidance for source-supported melamine finishes, fabric families, acoustic upholstery, frame colours, and glass/acrylic finishes. Only recommend Matrix where price changes by source category.

SCREEN AS REUSABLE LINKED PRODUCT
A Screen Product Template may be independently configured and reused from desk/workstation Product Templates (conceptually: Desk family -> Linked Product -> Screens -> select Screen family/configuration). Identify when Screens is a good reusable Linked Product candidate. Do NOT duplicate Screen SKUs/pricing into a desk template, make every Screen a desk-local accessory, create synthetic desk+screen SKUs, or automatically persist cross-template links during Planning. Current known linked-product limitation: linked Product Templates can currently expose only a narrowed child configuration and do not reuse the full child Product Library configuration. If full Screen child configuration is required, flag: LINKED CHILD FULL CONFIGURATOR EXTENSION REQUIRED, as a later runtime improvement; do not block standalone Screen Product Setup because of this.

EXTERNAL PRODUCT COMPATIBILITY
Preserve explicit manufacturer compatibility such as suitable for named desk ranges, not compatible with a named range, only for bench, only for a particular top thickness, or only for middle workstation positions. Do not automatically convert those relationships into cross-template rules; use them for planning notes, future Linked Product compatibility, or manual sales guidance unless exact current runtime support exists.

ARCHITECTURE GAP DISCIPLINE
Distinguish A. PRODUCT SETUP (can be represented with current architecture); B. SMALL GENERIC RUNTIME GAP (current architecture concept is correct but runtime needs a small extension); C. MANUAL DECISION (manufacturer rule depends on context current schema/runtime cannot evaluate); D. FUTURE ENHANCEMENT (useful but not required to create the standalone Screens template). Do NOT recommend schema redesign unless existing structures genuinely cannot preserve manufacturer truth. Known likely Screen gaps: mixed Base/Model + Matrix family selection; dynamic supplier-code composition; linked-child full configurator; external/configuration-context rules. Treat these separately.

SCREEN PLANNING RESULT PRECEDENCE
Choose the final Planning Result in this order:

1. NEED MORE SOURCE
Use when authoritative commercial source coverage is incomplete, required pages/rows are still missing, pricing evidence is incomplete, or the current extraction explicitly says additional source extraction is required. Source incompleteness takes precedence over architecture-gap readiness.

2. READY AFTER ARCHITECTURE GAP
Use only when source coverage is sufficiently complete to define the intended Product Setup, but one or more real generic ProjectWorkflow runtime gaps must be implemented before that intended setup can work safely. Examples may include mixed Base/Model + Matrix family selection or source-proven dynamic supplier-code composition.

3. READY
Use when source coverage is sufficiently complete and the intended Product Setup can be represented safely with current ProjectWorkflow architecture. A future optional enhancement such as richer Linked Product UX does not by itself force READY AFTER ARCHITECTURE GAP when the standalone Screens template is already usable.

FINAL SCREEN SOURCE GATE
Before returning the plan verify: direct authoritative Screen SKUs are not turned into fake Matrix rows; real upholstery/category pricing remains Matrix; mixed Base/Model + Matrix does not cause artificial template splitting; installation rails/support systems are not primary Screens; included hardware is not charged twice; required-separate hardware is not treated as optional; alternative mounts preserve exactly-one behavior; multiple simultaneous requirements stay separate; context-dependent mounting is not made unconditional; floor-screen hinges/bases are not made universally required; finish colours are not confused with price categories; supplier-code composition is flagged only when source-proven; PTS is not treated as currency; Linked Product candidacy does not duplicate Screen pricing into desks; architecture gaps are generic ProjectWorkflow gaps, not catalogue hacks; manufacturer family boundaries remain understandable in Product Library; every manufacturer family in FAMILY / EXTRACTION ROADMAP appears in exactly the intended Product Template, Separate Later, or an explicit source warning; no family marked Extract separately = Yes appears in another template's Add More batch; SOURCE / EXTRACTION BATCHES matches the template boundaries stated in PRODUCT TEMPLATES and TEMPLATE STRUCTURE; Base/Model visual family/subgroup organization was not confused with Native System/Base architecture; NEED MORE SOURCE takes precedence when commercial source coverage is still incomplete; and the plan is concise and implementation-oriented.`,
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
  const sharedAccessoryEvidenceInstructions = focus === "chair_seating" || focus === "desk_executive" || focus === "sofa_lounge" || focus === "meeting_conference" || focus === "storage_cabinets" || focus === "screens"
    ? `Internally verify every shared/common accessory recommendation against its affected Product Template, applicability evidence, dual-numbered source page, manufacturer evidence, configuration strategy, and any supplier-code ambiguity. Return only verified shared items that materially affect setup in SHARED / COMMON; put only unresolved critical applicability issues under Manual review.`
    : `For every shared/common accessory recommendation, output:
Accessory: [manufacturer description/code]
Affected Product Template:
Applicability evidence: EXPLICIT / CROSS-REFERENCED / VISUALLY CONFIRMED / UNCONFIRMED
Source: PDF page X / printed catalogue page Y
Evidence: short explanation of what the manufacturer actually shows/states
Recommended strategy: Include Locally / Standalone Product / Both / Manual Decision
Reason:`;
  const sharedAccessoryStrategyInstructions = focus === "chair_seating" || focus === "desk_executive" || focus === "sofa_lounge" || focus === "meeting_conference" || focus === "storage_cabinets" || focus === "screens"
    ? `For optional shared accessories, internally evaluate whether Sales needs them during the main product configuration and verify the strategy, reason, affected templates, and any duplicated or reused supplier/price-list code ambiguity. Return only items that materially affect setup or require a critical Manual Decision.`
    : `For optional shared accessories such as modesty panels, cable trays, screens, and shared accessories, evaluate whether Sales needs to select them during the main product configuration. If yes, recommend Include locally; if no, recommend Standalone product where appropriate; if uncertain, use MANUAL DECISION. Identify the strategy, reason, affected templates, and any duplicated or reused supplier/price-list code ambiguity.`;
  const batchOutputInstructions = focus === "chair_seating" || focus === "desk_executive" || focus === "sofa_lounge" || focus === "meeting_conference" || focus === "storage_cabinets" || focus === "screens"
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

Native System/Base structure (only when native System/Base architecture applies; omit for ordinary products):
- System/Base selection: [...]
- Main Product families: [...]
- System quantity behavior: [...]
- Native group boundary: [...]

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
Quantity behavior: Fixed / Follows target quantity / User-adjustable / Manual Decision / Not applicable
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
Every step must keep the Product Template boundaries declared in the roadmap and PRODUCT sections.
Provide numbered steps using the real workflow. templates: create template -> copy planning/extraction prompt -> extract Batch 1 using dual PDF/printed page references -> Import & Review JSON in Smart Setup -> + Add More JSON for later batches -> review System/Base groups, Main Product families, required components and accessories -> Apply to Product Template -> save.
For EXISTING saved templates: Product Template -> Edit in Smart Setup (no PDF required, no original extraction JSON required) -> + Add More JSON when extending the template -> review -> Save Changes to the same template. Do not imply every update requires a fresh Product Template.

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

  const screenOutputInstructions = `Analyze thoroughly internally, but return only the shortest practical Screens / Dividers setup plan. Do not expose reasoning or add text before or after the plan.

Return human-readable output using exactly this structure:

PAGE NUMBERING NOTE
- [PDF / printed-page relationship, or "Unavailable" where not known]

SCREEN PRODUCT SETUP PLAN

1. PRODUCT TEMPLATES
- Number:
- Template names:
- Why:

2. FAMILY / EXTRACTION ROADMAP
| Family | Printed pages | PDF pages | Recommended setup | Extract separately? | Priority |
| --- | ---: | ---: | --- | --- | --- |

Use one row per true manufacturer Screen family. Recommended setup must use the existing global allowed values. Use only the existing Priority values: BEST FIRST TEST, Current, Next, Later.

3. TEMPLATE STRUCTURE

For each Product Template:

Template: <name>

Manufacturer families:
- <source-defined family>
- <source-defined family>

ProjectWorkflow consolidation:
- <why these manufacturer families belong in this Product Template>

Families:
- <family> -> Base/Model
- <family> -> Category/Matrix
- <family> -> etc.

Required Companions:
- concise source-backed rules only

Installation / Configuration:
- concise mounting/support groups

Optional Accessories:
- concise groups

Finishes:
- concise finish/material guidance

Linked Product:
- Yes / No / Candidate
- target families only when source-supported

Extraction:
- Core pages:
- Add More / supporting pages:

4. SOURCE / EXTRACTION BATCHES
| Batch | Section | Printed pages | PDF pages | Purpose |
| --- | --- | ---: | ---: | --- |

5. MANUAL DECISIONS
- only configuration-dependent source rules that current runtime cannot safely automate

6. ARCHITECTURE GAPS
- only real generic ProjectWorkflow gaps exposed by this manufacturer

7. SEPARATE LATER
- nearby manufacturer families that should not enter the current Product Template, or None

8. EXTRACTION / SOURCE WARNINGS
- missing pages
- incomplete commercial rows
- PTS conversion
- unresolved commercial evidence

9. PLANNING RESULT
- READY
or
- READY AFTER ARCHITECTURE GAP
or
- NEED MORE SOURCE

This compact Screens structure satisfies the global mandatory roadmap, dual-page-numbering, batching, manufacturer-family/consolidation, and cross-section consistency contracts. Do not emit the separate generic PRODUCT 1 / PRODUCT 2 prose structure for Screens when this dedicated compact Screens structure is active.

SCREEN OUTPUT BREVITY RULES
- Do NOT output long essays, implementation code, database schema, speculative redesign, or duplicated extraction JSON.
- Do not manufacture fake templates, fake matrices, synthetic SKUs, or duplicated finish-price rows to work around current runtime limitations.
- Do not recommend one Product Template per material, height, width, front vs lateral, acoustic variant, mounting style, or finish family.
- Do not split a template merely to avoid the mixed Base/Model + Matrix runtime gap; flag it under ARCHITECTURE GAPS instead.
- Only flag MIXED PRIMARY PRICING FAMILY SELECTION REQUIRED, DYNAMIC SUPPLIER CODE COMPOSITION REQUIRED, or LINKED CHILD FULL CONFIGURATOR EXTENSION REQUIRED when the manufacturer source actually exposes that gap.
- Perform the final Screen source gate internally; return only unresolved critical issues under 5. MANUAL DECISIONS or 8. EXTRACTION / SOURCE WARNINGS.`;

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
Do NOT infer that PDF and printed numbering remain 1:1 throughout the document because early pages match. Verify numbering at the beginning, the middle, and the end / last available pages before declaring a global offset or 1:1 relationship. Never output a PDF page number greater than the actual PDF page count. If printed pages continue beyond the PDF viewer page count, report the actual mapping instead of copying the printed number into the PDF column.
First determine whether the document contains printed catalogue page numbers. When both PDF viewer and printed catalogue numbering can be identified, ALWAYS provide both in every page reference using this exact form: “PDF page 3 / printed catalogue page 12”; for ranges, “PDF pages 3–5 / printed catalogue pages 12–14”. Never provide only “Page 12” when PDF and printed numbering differ. If only one numbering system is genuinely available, state that explicitly: “PDF page 12 / printed catalogue page not shown” or “PDF page unavailable / printed catalogue page 42”. Do not guess either number. If PDF page 1 does not correspond to printed catalogue page 1, detect the offset and place a PAGE NUMBERING NOTE near the top of the plan explaining the relationship and confirming that all references below use both numbering systems. Use the same dual-number format in Main source pages, Shared/supporting pages, extraction batches, Shared / Common Element Strategy, and Extraction Order.

PRODUCT TEMPLATE SPLITTING
Prefer one commercially understandable product family per Product Template. Do not create one template per SKU, a giant template for unrelated families, or arbitrary page-count splits. A coherent family may contain many sizes/models. Consider separate templates for distinct typologies, structures, configuration logic, pricing structures, or very large independent ranges. Keep quotation configuration understandable.

PROJECTWORKFLOW DESTINATIONS
- Base / Model Pricing: direct-priced model/SKU/size variants and normal model tables, including native System/Base -> Main Product configurations (System/Base rows and Main Product rows keep separate prices and supplier codes). Supports groups, rows/models, price/currency, dimensions, specifications, visual subgroups, and images. Quotation flow is Family → Configuration/Subgroup → Model; for native System/Base groups it is System / Base → Main Product Family → Model / Size.
- Workstation Pricing: only simple, complete-price workstation/bench size/layout/orientation rows with base and, where explicitly supported, one repeatable additional/cluster price. The words workstation, bench, cluster, and operative do not by themselves justify this destination: first check whether the family is actually a complete direct-priced SKU (Base / Model), a genuine finish/category price dimension (Category / Matrix), or a proven starter/add-on or component-built composition (Modular) before recommending Workstation Pricing. For every Workstation family, state the recommended architecture and why, whether the source shows complete SKU pricing, required companions, fixed quantities, starter/add-on composition, finish-dependent pricing, or separately priced screens/accessories.
- Category / Matrix Pricing: only a genuine row × category/finish/fabric pricing matrix with meaningful ordered rows and columns; a visual table alone is insufficient.
- Modular Pricing: only genuine modular families with hierarchy/modules and shared price columns. Do not flatten modular structure. Not for a System/Base + Main Product + required companion selection on its own.
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
A mandatory statement proved on one manufacturer family/page applies ONLY to the rows/family explicitly covered by that evidence; never propagate REQUIRED SEPARATE ITEM, fixed quantity, INCLUDED, or PREPARED FOR to another family by similarity, shared listing or visual resemblance. A directly priced row labelled "with X" may already include X: do not add X again unless the source says the row must ALSO be completed with that article; otherwise MANUAL DECISION - possible double charge.
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
For native System/Base groups, System/Base rows are NOT Main Product visual subgroups. Main Product visual families should normally organize downstream direct-priced rows by commercial family, for example Desk, Desk + Top Access, Bench, Bench + Top Access, left/right structure families, or other manufacturer-proven configurations. Do NOT make visual subgroups merely from width, depth, individual SKU, or code sequence unless that is the true manufacturer commercial family distinction. System/Base remains the first-stage selection; Main Product subgroups are selection/display organization only.
Hierarchy: Pricing Type → Group → Subgroup → Row/Item. Rows/items remain pricing-authoritative; subgroups are visual/organizational only. Recommend subgroups only for source-supported shared diagrams, shapes/configurations, size families, or orientations. State the appropriate image level: Group image, Subgroup image, Row image; do not duplicate images unnecessarily.

Actual selectable materials/finishes remain controlled by ProjectWorkflow Material Library linkage. Manufacturer materialSuggestions are informational Manufacturer Finish Guidance only. Recommend “Extract as Manufacturer Finish Guidance” for finish-code tables, allowable top/leg finishes, or colour guidance unless the pages directly form pricing/category configuration. Do not create another material-selection system.

MULTIPLE BATCHES AND SHARED PAGES
Do NOT create one catch-all "Shared Elements / Technical Info" extraction batch covering many common pages merely because they are in one catalogue section. For each Product Template, supporting extraction pages must be limited to items whose applicability to that template is verified. Split supporting work by purpose: required companion pages, verified optional accessory pages, Manufacturer Finish Guidance, and manual-inspection-only pages. Technical descriptions, generic diagrams, unrelated shared accessories and unconfirmed common elements must not automatically be included in an extraction batch. A broad range such as "pages 42-67 shared elements" is invalid unless every included page has a verified reason to be extracted for that same Product Template.
A family declared as a separate PRODUCT or marked Extract separately = Yes must never appear in another Product Template's + Add More JSON batch.
For a template that already exists, additional pages are added through Edit in Smart Setup and + Add More JSON rather than a new Product Template. For native System/Base templates keep the System/Base and its directly related Main Product pages together in Batch 1 and verified required companions/accessories in a later batch.
External LLM limits may require multiple coherent batches for one template using + Add More JSON. Batch by commercial source structure, never equal page counts. INCLUDED components do not need a separate accessory extraction unless independently sold. Include REQUIRED SEPARATE ITEM pages in the relevant product extraction/Add More batch. Include OPTIONAL SEPARATE ITEM pages only when verified compatible and useful in the configurator. PREPARED FOR wording alone is not reason to extract the accessory page. UNCONFIRMED remains under Pages to inspect manually. Include a shared accessory page in a Product Template extraction batch only if at least one relevant item on that page has verified applicability. ${batchOutputInstructions} Good boundaries must also support future Prices Only, Selected Sections, New Item, and Not Found updates.

${focus === "storage_cabinets" ? storageOutputInstructions : focus === "screens" ? screenOutputInstructions : outputInstructions}`;
}
