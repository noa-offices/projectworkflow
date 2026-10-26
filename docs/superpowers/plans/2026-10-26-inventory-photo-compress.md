# Task 10b implementation plan

**Goal:** Compress every newly selected Inventory photo on-device, before upload; no database changes.
**Architecture:** A shared browser helper handles orientation-aware decoding, bounded WebP/JPEG quality/dimension loops and size labels. Both pickers process files sequentially and prevent submission/upload while processing. Upload reuses prepared Files, preserving existing owner paths and ordering. Server registration independently checks Storage-reported size/type and actual byte signatures.
**Constraints:** Existing PW UI, mobile 360/390/430 px, no dependencies, unchanged uploaded photos/reports/links/path structure.

- [x] Write failing compression-loop, format fallback, cleanup/error and server-limit tests.
- [x] Implement shared helper; integrate both pickers and upload metadata without duplicate conversion.
- [x] Enforce 2 MiB and allowed types on the server using actual Storage metadata; preserve permission/order/count checks.
- [x] Verify unit/UI/SQL tests, typecheck, scoped lint, synthetic large/rotated/multiple browser images and mobile layouts; review and document limits.

Decisions: 2 MB means 2*1024*1024 bytes, matching existing storage units; WebP quality .82 down to .42, then up to five 20% dimension reductions. Decode sequentially to bound memory. Keep existing JPEG/PNG/WebP input support; HEIC is outside existing pickers.
