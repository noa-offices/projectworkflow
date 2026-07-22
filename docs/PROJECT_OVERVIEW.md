# Project Overview

ProjectWorkflow is a Next.js 16 ERP-style application for an office-furniture business workflow. It centers on quotations and then fans out into projects, procurement, product library management, client records, and internal admin/HR settings.

## Purpose

- Create and manage clients, projects, and quotations
- Convert approved quotations into project files and procurement folders
- Generate document outputs such as PDFs, presentations, RFQs, POs, and delivery notes
- Maintain product templates, materials, price updates, and brand libraries
- Support internal administration, HR, user approval, and company settings

## Main Modules

- Dashboard and KPI overview
- Sales and quotations
- Projects
- Procurement
- Products and product library
- Clients
- Settings, users, HR, and workers
- Authentication and approval flows

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase Auth, Postgres, and Storage
- Recharts, Dexie, ExcelJS, PptxGenJS, Playwright, Puppeteer, Sharp

## Business Workflow

1. User signs in and is checked against profile status and role.
2. User lands on the dashboard.
3. Quotations are created from clients and projects, then edited with document builders.
4. Approved quotations become project files and drive procurement.
5. Procurement folders produce vendor documents and purchase orders.
6. Product library data feeds quotation building and document generation.

## Current Implementation Status

- Core quotation, product, procurement, and settings flows are implemented.
- The UI shows some planned settings areas that are not finished yet.
- The `opportunities` page is marked as deprecated in favor of quotations.
- Some exact downstream business behavior is not fully verified without broader inspection.

## Entry Point

- Root route redirects to `/dashboard`
- Main app shell and metadata live in `app/layout.tsx`

## Overall Architecture

- App Router-based structure with server components and route handlers
- Supabase-backed data access with RLS-enforced permissions
- Server actions for create/update mutations
- Dedicated document generation path for PDF, PPTX, and Excel exports

## Important Files

- `app/layout.tsx`
- `app/page.tsx`
- `app/dashboard/page.tsx`
- `app/quotations/page.tsx`
- `lib/auth.ts`
- `lib/supabase/server.ts`
- `supabase/migrations/001_profiles_roles_rls.sql`
- `supabase/migrations/005_clients_projects.sql`
- `supabase/migrations/008_quotations.sql`
