# Verification

The inventory flow runs from an add/review/stock form through signed-in server actions to atomic inventory functions, then returns the created identifiers and refreshed product/reservation data.

- Inventory and SQL regression suite: **82 passed, 0 failed**.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Inventory lint: `node node_modules/eslint/bin/eslint.js lib/inventory components/inventory app/inventory app/dev/inventory-preview` passed.
- Full repository offline suite: **4,448 passed, 64 failed, 2 skipped** (4,514 total).
- Re-ran the 32 failing files against an untouched archive of `origin/main`: **the same 64 failure names**, with 405 other assertions passing in those files. These failures are outside the inventory change.
- Full repository lint retains 5 existing errors in the notification bell, notification page, notification tabs and resolved avatar components. These components were not changed.
- Browser checks: actual inventory components at 390px with offline adapters, sample data and server-action stubs; see [phone previews](README.md).
- Independent code review covered locking, stale approvals, project visibility, permissions, cost edits, photo ownership and the review form. Findings about booking metadata and archived brands were fixed.

SQL tests run against disposable PGlite instances, applying the existing inventory schema, policies, stock functions and photo migration before each new migration chain. Assertions cover review rollback, partial costs, photo relinking, one movement per nonzero initial location, role permissions, reservation lifecycle and availability rules.

No live database was accessed. Applying migrations in Supabase, real authenticated/storage requests, deployed project policies, and simultaneous transactions across separate database sessions remain unverified offline. Migrations are left for the user to apply after review.
