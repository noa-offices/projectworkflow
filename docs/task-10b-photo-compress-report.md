# Task 10b: Browser photo compression

Branch: `phase-10b/photo-compress`, created after updating main. No database/schema/bucket changes, no migration created or applied, no new dependencies.

## Implemented

- One shared browser compression helper decodes orientation, caps the longest edge at 2000 px, starts WebP at quality 0.82, lowers quality through 0.42, then retries at progressively smaller dimensions. Maximum output is 2 MiB. Unsupported WebP encoding falls back to JPEG, flattening transparency onto white.
- Both Inventory photo pickers compress when selected. Every photo shows Compressing... then its original/upload size. Add-item/request submission is disabled while compression is pending. Product photo management compresses before its existing upload/register flow.
- Prepared Files are reused at upload, avoiding a second lossy conversion. Files process sequentially. Multiple selection, main/order/removal, the three-photo limit and partial successes retain their existing behavior.
- Server registration rejects declared or actual files above 2 MiB, unsupported MIME types, empty files, invalid signatures, signature/MIME mismatches and metadata inconsistencies. Actual bytes come from authenticated Storage download after ownership/permission/count and Storage-info checks; browser-supplied claims alone are insufficient.
- Existing uploaded files, object paths, reports, signed links, permissions and database behavior are unchanged. New WebP filenames use .webp, or .jpg for fallback, inside the existing products/requests + owner + random UUID path structure.

## Verification

- Inventory unit/UI/report and existing disposable SQL contract suite: **220 passed, 0 failed** (`artifacts/task-10b-tests-final.log`).
- Typecheck and scoped Inventory lint passed; final outputs are in `artifacts/task-10b-typecheck-final.log` and `artifacts/task-10b-lint-final.log`.
- Mobile Chromium preview passed at **360, 390 and 430 px**, including compression state, disabled save, size labels, three selected photos, main-photo reorder, removal, limit rejection, corrupt-photo recovery and product-photo management.
- Synthetic 35,345,350-byte PNG became **1,603,168-byte WebP at 2000 x 1333**.
- A synthetic EXIF-orientation-6 JPEG produced 64 x 128 output with red above blue, verified by pixels. Tested native bitmap decoding and forced HTMLImageElement + JPEG encoder fallbacks.
- Unit tests cover quality and dimension retries, 2 MiB inclusive boundary, bounded impossible-fit failure, unsupported/throwing encoders, empty output, bad dimensions, decode cleanup, no duplicate conversion, server size/type/signature checks and positive WebP/PNG registration.
- Independent review found no important implementation bugs. `git diff --check` passed.

No live uploads, changes to existing photos or connected database writes were performed. Existing SQL contracts ran only in disposable in-memory PGlite. The full unrelated repository suite was not rerun for Task 10b; Task 10a documents its existing main-branch failures.

## Not tested

- **Real phone photos/devices:** no physical iPhone/Android camera or real device Safari/Firefox testing. Phone orientation used a synthetic tagged JPEG. HEIC/RAW inputs are outside the existing JPEG/PNG/WebP picker support.
- **Large photos:** tested a synthetic 35 MB, 4200 x 2800 image. Larger resolutions, device-specific memory limits, unusual color profiles and sustained low-memory phone behavior were not tested.
- **Many photos:** tested three together and rejection beyond the existing three-photo limit. Long repeated camera/gallery sessions and large batches above that supported limit were not tested.
- No authenticated live Storage upload/registration, mobile network interruption test, production build or deployment. Server tests use the real action logic with mocked Storage transport. Browser tests use the existing preview and perform no uploads.

## Decisions made

- 2 MB means **2 * 1024 * 1024 bytes**, consistent with existing storage units; the exact boundary is accepted.
- Quality steps: 0.82, 0.74, 0.66, 0.58, 0.50, 0.42. Retry up to five 20% dimension reductions, restarting at 0.82 each time, then give a clear error.
- Keep processing sequential to bound peak memory. Preserve WebP transparency; JPEG fallback uses white.
- Keep the existing direct signed-in Storage upload architecture, object path structure and registration transaction. The server independently checks stored bytes before linking photos to Inventory. Bucket-level limits/policies were not changed, as requested.
- Carry forward the user's explicit authorization to reuse PW Inventory UI patterns because frontend-design remains unavailable; no replacement design system was introduced.

## Files changed

- `components/inventory/product-photo-manager.tsx`
- `components/inventory/product-request-form.tsx`
- `components/inventory/request-photo-picker.tsx`
- `docs/superpowers/plans/2026-10-26-inventory-photo-compress.md`
- `docs/task-10b-photo-compress-report.md`
- `lib/inventory/action-validation.ts`
- `lib/inventory/actions.test.mts`
- `lib/inventory/actions.ts`
- `lib/inventory/photo-compress.test.mts`
- `lib/inventory/photo-compress.ts`
- `lib/inventory/photo-limits.test.mts`
- `lib/inventory/photo-limits.ts`
- `lib/inventory/photo-upload.test.mts`
- `lib/inventory/photo-upload.ts`
- `lib/inventory/ui.test.mts`

## Verification artifacts

- `artifacts/task-10b-browser-results.json`
- `artifacts/task-10b-request-360.png`, `artifacts/task-10b-request-390.png`, `artifacts/task-10b-request-430.png`
- `artifacts/task-10b-manager-360.png`, `artifacts/task-10b-manager-390.png`, `artifacts/task-10b-manager-430.png`

Synthetic source images and temporary browser script were removed after verification; no real user photos were used.
