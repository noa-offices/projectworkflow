# Database / Storage Health (DBH-1)

Location: Settings → System & Maintenance → Database & Storage Health.
Only an active System Owner can see the panel or invoke its report/snapshot actions.
Database RPCs independently recheck the existing Supplier capacity owner guard.

Apply `supabase/migrations/20261008045010_system_capacity_snapshots.sql` through the
normal reviewed migration process after the existing Supplier capacity/Phase F/lifecycle
migrations. It creates one small snapshot table and guarded monitoring RPCs. It does
not backfill, clean up, rewrite business data or modify the Storage schema. No live
migration was applied as part of implementation.

The System Owner can save database and Storage capacity limits from the dashboard in MB
or GB. Saved values live in the owner-only `system_capacity_settings` row and take
precedence over the optional server environment variables:

- `SYSTEM_DATABASE_CAPACITY_BYTES`
- `SYSTEM_STORAGE_CAPACITY_BYTES`

Leaving a dashboard field blank clears its saved override and restores the environment
fallback. If neither source exists, that meter remains unconfigured. Values must be
positive and the dashboard does not discover the billing plan. Database size is
PostgreSQL's physical database size, including managed schemas.
Storage usage is object metadata, excluding bandwidth and provider-side untracked objects.
Missing/invalid size metadata makes the affected totals unknown, including in snapshots.

Refresh performs one aggregate metrics RPC. Capture takes server-measured values,
inserts only into `system_capacity_snapshots`, then refreshes the report. There is no
automatic schedule: capture periodically to establish history. Owners can read snapshots
but cannot directly insert, update or delete them; service role can insert accounting
records. RPC captures cannot accept fabricated client values.

The report reuses the existing lifecycle resolver and finalized staging-chunk dry run.
Reclaimable bytes are conservative logical payload bytes for eligible finalized chunks
only. Source purges, raw row/cell compaction, source files and orphaned objects are excluded
because eligibility cannot be established from lightweight metadata alone. Reclaimed
logical bytes are not guaranteed reductions in the physical database file.

Rows are planner estimates; data includes TOAST/overhead and indexes are shown separately.
Monthly history uses the last captured sample per Dubai calendar month (up to 36 months).
The 30-day comparison uses the latest sample at or before 30 days ago, with its date shown.
No values are interpolated. Growth watch means at least 20% database growth since that
baseline; missing history cannot establish a growth rate.
