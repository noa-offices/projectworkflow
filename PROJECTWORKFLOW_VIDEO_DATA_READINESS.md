# ProjectWorkflow — Video Data Readiness Audit

Audit date: 2026-10-30 · Environment: local `npm run dev` (Turbopack) on `localhost:3000`, signed in as System Owner, Supabase project `ProjectWorkflow` (same project the app's `.env.local` points to).
Mode: read-only. No business records were created, edited, approved or deleted. No downloads were generated. No code, env, schema or packages were touched.

**Evidence labels used below**
- **UI** = seen in the live app this session.
- **DB** = row counts read with `SELECT` against the app's own database (read-only).
- **SRC** = seen in source only.
- **NOT VERIFIED** = not reached in this session.

---

## 1. Executive summary

The application is functional and the features that matter for a cinematic video largely exist, but **the data is not ready**. The database holds one TEST quotation, zero Project Files, zero procurement or delivery documents, five inventory products (three with casual desk-snapshot photos), and no pending approvals. The dashboard renders zeros.

What is genuinely strong:
- **One quotation renders well** in the Quotation PDF preview and the Presentation (dark editorial, 11 slides, large product renders). Verified in the UI.
- **Supplier price-matching data is large** (4,431 source rows, 2,702 matches, 336 decisions, 490 materials across 2 brands) — good raw material for a "price update" scene. The UI for it was not reached.
- **NOA works** and returned correct, source-tagged answers for quotations and inventory.

What blocks capture: no Client Confirmed quotation, no Project File, no procurement chain, thin inventory, and a mostly empty dashboard.

**Recommendation: WAIT** (details in section 10).

---

## 2. Readiness table

| # | Module | Accessible | Real data | Varied | Visually useful | Cinematic | Status |
|---|---|---|---|---|---|---|---|
| 1 | Dashboard | Yes (UI) | No — all zeros, 1 draft folder | No | Layout fine, content empty | No | **NOT READY** |
| 2 | Clients & Quotations | Yes (UI) | 6 clients, 1 quotation (TEST, `sent_to_client`), 6 sections, 10 item rows | No — single status | Yes for that one quote | Yes for 1 quote | **PARTIALLY READY** |
| 3 | Product Library | UI **NOT VERIFIED** | 6 templates (Every, Jera ×2, Jera Meeting, Monolith ×2), 2 brands, 490 materials; 0 categories; default prices all 0.00 | Low | Template images exist (DB flags), UI not viewed | Unknown | **PARTIALLY READY** |
| 4 | Quotation outputs | Partly (UI) | One quote only | n/a | PDF + Presentation good | Yes | **PARTIALLY READY** (see §4) |
| 5 | Project Files & Procurement | UI **NOT VERIFIED** | 0 projects, 0 procurement/vendor docs, 0 POs | None | n/a | n/a | **NOT READY** |
| 6 | Inventory | Yes (UI) | 5 products, 20 units, 8 movements, 5 approved product requests, 1 approved movement request, 0 reservations | Low | Dashboard/movements good; photos weak | Partly | **PARTIALLY READY** (see §5) |
| 7 | Material Library & Price Updates | UI **NOT VERIFIED** | 490 materials, 48 subgroups, 11 supplier profiles, 4,431 source rows, 2,702 matches, 336 decisions, 0 bindings | Good | Unknown | Unknown | **PARTIALLY READY** (data yes, UI not seen) |
| 8 | NOA AI | Yes (UI) | Live answers from real records | Moderate | Good (chat + source chips) | Yes | **PARTIALLY READY** (see §6) |
| 9 | HR & Leave | Yes (UI) | 8 staff, 1 field worker, 7 leave requests (3 approved, 4 cancelled, 0 pending) | Low | Functional, shows personal data | Partly | **PARTIALLY READY** |
| 10 | PDF Extractor | **NOT VERIFIED** | No evidence in this repo/session | — | — | — | **NOT VERIFIED** |

---

## 3. Strongest existing quotation and project examples

**Quotation:** `QF-0006-001` / `QN-0006-001` — "TEST Office Fit-out 10 Workstations", client "TEST Al Noor Trading LLC", salesperson "Noa Offices", status Sent to Client, Oct 27 2026.
- Items: Every (Interstuhl), Jera ×2 and Monolith ×2 (Las Mobili) — real product images, specs, origin/supplier, discounts.
- Totals: UI shows subtotal AED 72,350, item discount AED 5,900, VAT 5% AED 3,325, **final AED 69,775**.
- Weaknesses: client and title say "TEST"; section header reads "Sub Section"; `finish_snapshot` is empty on every item (no finishes shown in the PDF rows); the quotation is not Client Confirmed, so the workflow cannot progress to a Project File.

**Project example:** none. `projects` has 0 rows; the dashboard shows 0 active and 0 completed projects.

**Data inconsistencies noticed (fix or avoid on camera)**
- Quotation total appears as **AED 69,775** (folder page), **AED 69,772.50** (database `grand_total` and NOA's answer). Rounding differs between surfaces; a viewer comparing scenes would notice.
- Dashboard "Quotation Workflow" counts the quotation as **Draft: 1**, while the quotation list and folder show **Sent to Client**.
- The quotation table stores 10 item rows; the UI reports 6 active items. The extra rows look like inactive duplicates; confirm before relying on counts.

---

## 4. Document-generation capabilities

Distinguishing: exists in code / visible in app / verified with existing data. "Verified" here means the preview rendered with real data. **No file download was triggered**, so output files themselves are unverified.

| Output | In source | Visible in app | Verified with data | Notes |
|---|---|---|---|---|
| Quotation PDF | Yes | Yes — Documents tab: Preview + Download PDF; Documents menu: Download Quotation PDF | **Preview verified** (3 pages, images, specs, prices). Download not run. | PDF settings panel (layout, density, image size, notes, closing, planner) is a good UI scene. |
| Excel export | Yes | Yes — "Export Excel" in Documents menu and PDF settings | **NOT VERIFIED** (not downloaded) | |
| Presentation (on screen) | Yes | Yes — Documents tab Preview | **Verified** (11 slides, 6 items, dark editorial design, swatches) | Best cinematic asset found. |
| Presentation PDF | Yes (`download-presentation` route) | Yes — "Download PDF" button | **NOT VERIFIED** | |
| PowerPoint (.pptx) | **No evidence** | Not seen | **NOT VERIFIED** | Not found in the Documents tab or menus. Do not claim PPTX export without confirming. |
| Specification Sheet | Yes | Yes — Documents tab: Preview + Download PDF | **NOT VERIFIED** — route compile did not finish in this session | |
| Supplier RFQ | Route and settings API exist (SRC) | On the quotation page it appears only as a **"future document"** placeholder after a Project File exists ("Available after Project File creation in a future phase") | **NOT VERIFIED** | Route `/quotations/[id]/procurement-rfq` derives from quotation data; not opened. |
| Purchase Order | Route exists (SRC); permission-gated | Placeholder "Future procurement document" | **NOT VERIFIED** | DB: 0 rows. |
| Order Confirmation | Route exists (SRC) | Placeholder "Future client order document" on the quotation page; also linked from Project File page (SRC) | **NOT VERIFIED** | DB: 0 rows. |
| Delivery Note | Route + download route exist (SRC) | Not seen in the Documents tab | **NOT VERIFIED** | DB: 0 rows. |

Do **not** describe these as one-click. On the quotation folder, three documents are available directly (Quotation, Specification, Presentation); RFQ, PO and Order Confirmation are shown as future/placeholder rows and only after a Project File exists.

---

## 5. Inventory readiness (mandatory module)

**Verdict: PARTIALLY READY — accessible and coherent, but too thin and visually uneven for a major video segment.**

| Area | Evidence | Assessment |
|---|---|---|
| Overview dashboard | UI + DB: Units **20**, Products **5**, chips Accessories 2 / Temporary 1, Reserved 0, Pending product requests 0, Pending movement requests 0 | Clean and animatable; the two zero "pending" cards look empty. |
| Quantity by location | UI: Warehouse 11 (4 products), Dubai Showroom 1, Abu Dhabi Showroom 1, Mockup 5, Temporary Out 2, Sold 0 | Good six-tile layout. Numbers are small; "Sold" is 0. |
| Products | UI: 5 cards with brand badge (IKEA, LAS MOBILI, INTERSTUHL), stock ref, live/available counts, location chips | Card grid works. **Photos are weak**: "Screen test" and "Top test" show desk clutter (a cable, a water bottle); only "desk top" (chair) and "test every" (bench seating) look like products. Names include "test", "Top test", "ZZ Test Item". |
| Stock movements | UI + DB: 8 movements 24–27 Oct 2026 (receive stock ×6 across warehouse/Dubai/Abu Dhabi/mockup/temporary-out, one internal transfer of 8 units Temporary Out → Warehouse) | Ledger table with product thumbnails, from→to, before/after totals, requester/approver. Usable. |
| Requests and approvals | UI: Product requests → Approved shows 5 (one requested by Subair, approved by Junais KP); Movement requests: 1 approved (move, qty 8) | Demonstrates the requester → approver chain. **0 pending**, so no live approve/reject moment can be filmed. |
| Holds / reservations | DB: `inventory.reservations` = 0; UI: Reserved 0 | **Missing.** |
| Reports | UI: Reports page with Current inventory (filters, Excel/PDF, photo options) and Movements history | Accessible. **Downloads not generated/verified.** |
| Categories | DB: 62 categories exist; only 4 used by products | Fine. |
| Mobile views | **NOT VERIFIED** (not tested; viewport not resized) | |
| Photos | DB: 6 image rows for 5 products | Needs real product photography. |

---

## 6. NOA AI demonstration readiness

NOA opens from the floating assistant on any page, shows a "V2" badge and source chips (e.g. "Insights · Calculated from authorized quotation records", "Inventory"). Three read-only questions were asked this session; they only wrote conversation state (`noa_sessions`).

| Question | Result | Verified against |
|---|---|---|
| "What is the status of my quotations?" | "You have 1 quotation this month, currently with the status Sent To Client. No quotations have been confirmed by the client yet. The total quoted value is AED 69,772.5." (took ~40 s on first call, dev-server compile) | Matches the DB (`sent_to_client`, 69,772.50). |
| "How many units do we have in the warehouse?" | "There are 11 units currently in the warehouse across 4 different inventory items." | Matches Inventory page (Warehouse 11, 4 products). |
| "What is the price of the Jera desk?" | "I couldn't find a matching product in the Product Library." | Template names are "Jera"/"Jera Meeting"; template default prices are 0.00. **Fails.** |
| "Jera" | "I found more than one matching product… provide a more specific product name or code." | 3 Jera templates exist; clarification works. |

**Most compelling verified conversation (≈15–20 s):** the two-turn pair — quotation status, then warehouse units. Both are correct, source-tagged and short. It is honest and does not need invented output.

**Do not feature:** product price questions (currently fail), and any multi-turn project drill-down (the pilot case needs a Client Confirmed quotation and Project File that do not exist; not tested here). Suggested chips on the welcome screen (Needs attention, Configure product, Pending quotations, Active projects) were not exercised.

---

## 7. Missing records needed before capture

1. **Client Confirmed quotation(s):** none. Only status present is `sent_to_client`.
2. **Project Files:** 0.
3. **Procurement chain:** 0 vendor docs, 0 POs, 0 RFQs, 0 order confirmations, 0 delivery notes, 0 payments/installments.
4. **Dashboard data:** all KPIs zero because there are no confirmed quotations or projects; also no "upcoming deliveries".
5. **Inventory depth:** 5 products, 3 with poor photos, 0 reservations, 0 pending requests.
6. **Finishes on quotation lines:** every item's finish field is empty.
7. **Demo-quality naming:** "TEST", "ZZ Test Item", "Top test", "Screen test" visible on screens.
8. **Product Library defaults:** template default prices are 0.00 and the `product_categories` table is empty (only 2 brands exist).
9. **HR:** no pending leave request for an approval scene.
10. **Commissions/payments:** `sales_commissions`, `client_payment_*` all 0 (only matters if the video touches them).

---

## 8. Suggested minimum additional data to enter

1. Add **one quotation with 6–8 products** (use at least 3 brands/templates), each with a **finish selected from the material library**, qty ≥ 2 on some lines, using a non-"TEST" client name. Mark it **Client Confirmed** and then **create its Project File**.
2. Add **two more quotations** in other statuses so the status chart varies: one **Draft**, one **Ready to Send**, and one more **Client Confirmed** with a different salesperson.
3. For the Project File, **create at least one RFQ → Purchase Order → Order Confirmation → Delivery Note**, and fill vendor progress so Procurement and "Upcoming deliveries" are populated.
4. Add **at least 8–10 more inventory products** with **real studio-quality photos**, spread across Warehouse, Dubai Showroom, Abu Dhabi Showroom and Mockup; include **one low-stock item**, **one reservation/hold** against a project, **one pending product request** and **one pending movement request** (so an approval can be filmed live).
5. Add **one pending leave request** (annual leave) so an HR approve scene exists; blur or replace personal emails and ID-expiry dates.
6. Rename test records: client "TEST Al Noor Trading LLC", project title "TEST Office Fit-out…", inventory "ZZ Test Item", "Top test", "Screen test".
7. Set real **default prices** on the 6 product templates (they are all 0.00), so NOA's price answers can work.
8. Open the material library and price-update review once to confirm a **pending supplier price update** is available to demonstrate (data exists; UI not viewed).

---

## 9. Recommended video scenes based on current evidence

Only scenes that can already be filmed truthfully:

| Scene | Content | Status |
|---|---|---|
| Quotation PDF preview | Scroll the 3-page PDF with product images; show PDF settings panel | Ready (rename "Sub Section", fix "TEST") |
| Presentation | Dark editorial slide deck, product hero shots, finishes strip | Ready — strongest visual |
| Inventory overview + location tiles | Units 20, six location tiles | Usable |
| Stock movement ledger | Receive stock, internal transfer, requester/approver | Usable |
| Request approval history | Approved product requests (Subair → Junais KP) | Usable, no live approval |
| NOA reveal | Quotation status, then warehouse units | Ready |
| Supplier price matching | Large dataset exists | **Capture only after UI is viewed** |

Not yet filmable: Dashboard hero, Client Confirmed → Project File → Procurement → Documents flow, reservations, RFQ/PO/OC/Delivery Note, HR approval, PDF Extractor handoff, mobile inventory.

---

## 10. Final recommendation

**WAIT** before starting UI capture.

Reason: the central story (Quotation → Client Confirmation → Project File → Procurement → Documents) cannot be shown because no record past `sent_to_client` exists, and Inventory (mandatory) has too little and visually inconsistent data. Capturing now would force re-capture of the Dashboard, Quotations list, Inventory and Procurement scenes.

Before capture starts, also:
- **Use a production build or pre-warm routes.** On this machine the dev server took 1–5 minutes to compile each route on first visit (specification, RFQ, PO, Order Confirmation, Delivery Note, Products Library, Material Library, Price Updates, Projects and Procurement pages were not reached in this session for that reason). Capture from `next build && next start`, or visit every route once beforehand.
- Run a short follow-up audit of the unreached screens once the data is entered.

### Not verified this session
Specification Sheet preview, RFQ/PO/Order Confirmation/Delivery Note previews, Excel and PDF file downloads, PowerPoint export, Product Library and Material Library screens, Price Update review UI, Projects and Procurement screens, Inventory mobile view, PDF Extractor, and NOA multi-turn ResultSet drill-down.
