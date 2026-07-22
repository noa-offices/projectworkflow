# Business Workflows

## Authentication

Flow:

`Login -> Profile -> Role -> Dashboard`

### Main Pages

- `/login`
- `/signup`
- `/forgot-password`
- `/reset-password`
- `/pending-approval`
- `/auth/callback`

### Main Tables

- `profiles`
- `profiles_hr`

### Status Changes

- New users start as `pending`
- Active users can access the app
- Disabled users are signed out
- Inactive or unapproved users are redirected to pending approval

### Important Components

- `lib/auth.ts`
- `app/auth/actions.ts`
- `app/layout.tsx`

### Missing Pieces

- The exact approval lifecycle outside the active/disabled/pending flow was not fully verified.

## Quotation

Flow:

`Client -> Quotation -> Approval -> Project`

### Main Pages

- `/quotations`
- `/quotations/[id]`
- `/quotations/[id]/builder`
- `/quotations/[id]/pdf`
- `/quotations/[id]/presentation`
- `/quotations/[id]/procurement-rfq`
- `/quotations/[id]/purchase-order`
- `/quotations/[id]/order-confirmation`
- `/quotations/[id]/delivery-note`
- `/quotations/[id]/specification`

### Main Tables

- `clients`
- `projects`
- `quotations`
- `quotation_sections`
- `quotation_items`
- `quotation_pdfs`
- `quotation_presentations`
- `quotation_procurement_rfqs`
- `quotation_purchase_orders`
- `quotation_order_confirmations`
- `quotation_delivery_notes`

### Status Changes

- Quotation status moves through draft and approval-related states
- Later migration adds `internal_review`, `revision_required`, `ready_to_send`, `sent_to_client`, `client_confirmed`, `cancelled`, `archived`
- `quotations.project_id` can be null for opportunity-style records

### Important Components

- `QuotationListLiveFilter`
- `local-quotation-builder`
- `quotation-row-editor`
- `product-library-selector`
- document editors for PDF, presentation, RFQ, PO, and delivery note

### Missing Pieces

- Approval routing beyond the client-confirmed workflow was not fully traced
- The legacy `opportunities` route is now just a notice page

## Procurement

Flow:

`Project -> Procurement Folder -> Vendor -> Purchase Order -> Completion`

### Main Pages

- `/procurement/orders`
- `/procurement/completed`
- procurement-related quotation document pages

### Main Tables

- `project_purchase_orders`
- `procurement_vendor_docs`
- `procurement_vendor_progress`
- `quotation_procurement_rfqs`
- `quotation_purchase_orders`

### Status Changes

- Approved quotations create confirmed project-file data
- Procurement folders track vendor docs and progress
- Completion is reflected through project/quotation workflow state

### Important Components

- `ProcurementOrdersTable`
- `vendor-controls-panel`
- `procurement-rfq-editor`
- `purchase-order-editor`

### Missing Pieces

- A dedicated vendor-facing portal was not verified

## Products

Flow:

`Product Library -> Templates -> Quotation`

### Main Pages

- `/products`
- `/products/templates`
- `/products/materials`
- `/products/brands`
- `/products/price-updates`
- `/products/manage`
- `/products/management`

### Main Tables

- `brands`
- `product_categories`
- `product_templates`
- `product_components`
- `brand_material_groups`
- `brand_materials`
- `brand_price_list_updates`
- `product_template_price_history`

### Status Changes

- Template lifecycle can move between active, archived, and discontinued
- Price checks and price-list updates track freshness and review status

### Important Components

- `product-template-form`
- `template-category-fields`
- `template-pricing-sections`
- `material-library-dialogs`
- `price-updates-review`

### Missing Pieces

- `product_template_linked_families` exists in migrations but was not fully inspected

## Notes

- These workflows are mostly server-driven
- The core user journey is quotation-first, then project, then procurement
