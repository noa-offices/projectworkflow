# ProjectWorkflow Summary

## What This Project Is

ProjectWorkflow is a Next.js 16 ERP-style web app for managing the full sales-to-delivery workflow of a business that creates quotations, project files, procurement folders, product libraries, and internal admin records.

The app starts at `/dashboard` and uses Supabase for authentication and data storage.

## Main Purpose

- Manage client enquiries and quotations
- Build quotation documents and presentation exports
- Convert approved quotations into project files
- Track procurement folders, purchase orders, and vendor milestones
- Maintain a product/template library with pricing and materials
- Support admin, HR, user management, and company settings

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase Auth + Postgres
- Recharts for charts
- Dexie for local browser storage
- ExcelJS, PPTXGenJS, html-to-image, Playwright, Puppeteer, Sharp for document and export features

## Authentication And Roles

The app uses Supabase auth plus profile-based access control.

Roles defined in the app:

- `system_owner`
- `admin_manager`
- `procurement_manager`
- `sales_designer`
- `designer`
- `viewer`

Account statuses:

- `pending`
- `active`
- `disabled`

Access checks are handled in `lib/auth.ts`.

## Key Workflows

### Dashboard

- Central ERP overview
- Shows active projects, sales data, monthly data, and HR alerts for managers

### Sales And Quotations

- Quotations are the main starting point for new enquiries
- Users can create clients and quotations from the quotations screen
- Quotation folders support revisions, options, documents, and builder actions
- There are document routes for PDF, presentation, delivery note, order confirmation, procurement RFQ, purchase order, and specification exports

### Projects

- Projects appear to be tied to approved quotations
- Project files are created after client approval
- There are completed and order/project views under `app/projects`

### Procurement

- Procurement workspace is built from confirmed project files
- Supports multi-vendor procurement folders
- Includes procurement orders and completed procurement views

### Products

- Product templates, materials, brands, and price updates
- Price checks and pricing status tracking
- Product library and template management are major parts of the system

### Sales

- Enquiries, opportunities, approvals, and quotations
- `opportunities` is now marked as deprecated in the UI and redirects users toward quotations

### Clients

- Client management
- Client project pages and client-linked quotations

### Settings

- Company profile used in documents
- Document defaults such as quotation notes
- My Profile
- User management
- HR management
- Workers directory

## Important UI/UX Notes

- The app uses an ERP shell layout with sidebar/top bar components
- It is built as a PWA with service worker registration and manifest metadata
- The design is focused on admin/business workflows rather than consumer-facing marketing pages

## Important Files

- [app/layout.tsx](./app/layout.tsx)
- [app/page.tsx](./app/page.tsx)
- [lib/auth.ts](./lib/auth.ts)
- [lib/supabase/types.ts](./lib/supabase/types.ts)
- [app/dashboard/page.tsx](./app/dashboard/page.tsx)
- [app/quotations/page.tsx](./app/quotations/page.tsx)
- [app/procurement/orders/page.tsx](./app/procurement/orders/page.tsx)
- [app/products/page.tsx](./app/products/page.tsx)
- [app/settings/page.tsx](./app/settings/page.tsx)

## Useful Commands

- `npm run dev` - start local development
- `npm run build` - production build
- `npm start` - run production server
- `npm run lint` - lint the codebase

## Short Prompt You Can Reuse

ProjectWorkflow is a Next.js 16 + Supabase ERP app for quotation management, project files, procurement, product libraries, clients, sales, settings, and HR. It uses role-based access control, generates documents like PDFs and presentations, and starts at `/dashboard`. Quotation workflow is the core entry point, while procurement and project views follow from approved quotations.
