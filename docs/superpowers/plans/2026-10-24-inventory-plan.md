# Inventory review edits and reservations implementation plan

**Goal:** Implement the supplied three-part inventory specification.
**Spec:** `2026-10-24-inventory-spec.md` in this directory is the binding user request.
**Architecture:** Extend existing atomic inventory functions and signed-in actions. Reuse existing inventory forms and dialog. Serialize reservation changes with the product lock.
**Tech stack:** Next.js 16.2.4, React 19, Supabase Postgres, TypeScript, PGlite and Node tests.

## Constraints

- No live database calls. Migration files are for user review and application.
- Separate migration files and commits for each numbered part.
- Phone-first at 390px; reuse inventory visual styling.
- Costs are available only to managers. Never use service role in actions.
- Keep NOA architecture untouched.

## Tasks

- [ ] Part 1: Add initial stock validation, review edits SQL and offline assertions; reuse add-item form for complete editable review with read-only photos; validate changed fields and rejection note; verify and commit.
- [ ] Part 2: Apply manager submissions immediately and return linked IDs; upload manager photos against product; update labels; verify and commit.
- [ ] Part 3: Add locked reservations, project visibility and lifecycle SQL, role/availability tests; extend read layer, actions, forms, cards, overview, detail and preview; verify and commit.
- [ ] Review the whole branch, run lint, TypeScript and all offline tests, capture four phone screenshots and open one PR.

## Review focus

- Two concurrent reservations or stock writes must serialize on the same product.
- Partial quantity/stock edits must validate the resulting request atomically.
- Project selection must respect caller RLS even inside definer functions.
- Manager photo failure must retain the created product and report failed uploads.
- Expired reservations must not reduce availability; fulfilment must bypass only its own reservation.

## Progress

Initial repository clean on main. Created requested branch from freshly fetched origin/main. Read AGENTS.md and installed Next.js forms documentation. Existing SQL tests use PGlite, allowing verification without a live database.
