export class InventoryPageRangeError extends Error {
  constructor() { super("Inventory product page is out of range"); this.name = "InventoryPageRangeError"; }
}
