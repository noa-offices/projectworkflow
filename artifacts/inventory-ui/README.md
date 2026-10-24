Phone previews at 390 x 844 pixels, captured with Playwright from the inventory preview page and its actual components using sample data.

- [All items](products-all.png)
- [Products](products-product.png)
- [Accessories](products-accessory.png)
- [Temporary](products-temporary.png)
- [Add item](add-item.png)

These are offline component previews: authentication, the application shell and Next.js navigation/image boundaries use local adapters. Server actions are blocked; no live database or external requests are used. Type tabs were scrolled horizontally to show the selected tab.

Browser checks cover tab counts, URL persistence after refresh, stock-ref search, two-column phone/four-column desktop cards, failed-image placeholders, no horizontal page overflow, and the read-only total remaining in FormData after location edits. Add and review submission totals are also checked in the shared-form browser harness.
