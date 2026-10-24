# Inventory review edits and reservations

Phone previews use the actual inventory components at 390 × 844 pixels, with sample data and offline adapters for Next routing and image wrappers. Every server action is stubbed and external browser requests are blocked. These screenshots verify presentation and client interaction; they do not represent live database writes.

| Screen | Screenshot |
| --- | --- |
| Add item, including stock by location | [Full form](add-item-stock.png) |
| Review and approve | [Item details](review-and-approve.png), [stock by location](review-stock.png), [costs](review-costs.png) |
| Product detail with reservation | [Reservation](product-reservation.png) |
| Book form | [Project booking](book-form.png) |
| Hold form | [Hold until](hold-form.png) |

Verified interactions: location inputs update total quantity; the approval form retains all request fields and an archived brand; approval completes; the fulfil dialog opens; project-only and reference-only bookings complete; a future hold expiry completes. No horizontal overflow or browser exceptions occurred.

Validation results and offline limitations are recorded in [verification.md](verification.md).
