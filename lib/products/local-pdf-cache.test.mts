import assert from "node:assert/strict";
import test from "node:test";
import { pdfsToDelete } from "./local-pdf-cache";

test("only the 3 most recently opened PDFs are kept", () => {
  const items = [{ id: 1, lastOpened: 10 }, { id: 2, lastOpened: 50 }, { id: 3, lastOpened: 30 }, { id: 4, lastOpened: 40 }, { id: 5, lastOpened: 20 }];
  assert.deepEqual(pdfsToDelete(items).map((item) => item.id).sort(), [1, 5]);
  assert.deepEqual(pdfsToDelete(items.slice(0, 3)), []);
  assert.deepEqual(pdfsToDelete([]), []);
});
