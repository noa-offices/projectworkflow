import assert from "node:assert/strict";
import test from "node:test";
import { FINAL_SPECIFICATION_STYLE_GUIDE } from "./final-specification-style";

test("the style guide has the rules and the four examples", () => {
  for (const expected of [
    "Start with the product type",
    "Never write brand, country, category, price, delivery, finish names or finish codes",
    "Do not write colour names, except when they are part of a feature name such as black soft double castors",
    "Do not write accessories that are only a colour or finish (for example \"Black Plastic Parts\"). Colour words stay allowed inside a feature name such as \"black soft double castors\".",
    "Generic material words are allowed: painted, powder coated, upholstered, mesh, wooden, marble",
    "Use \"and\", not \"&\"",
    "15 to 30 words",
    "Do not write dimensions",
    "Task chair, upholstered seat and mesh back with adjustable and removable headrest, 3D adjustable armrests, synchronous mechanism, lumbar support adjustment, sliding seat, gaslift mechanism, 5 star nylon base on castors.",
    "Coffee table, marble top and painted metal base.",
    "Three seater sofa, upholstered seat and back, with armrest, polyurethane foam padding, painted metal base.",
    "Executive desk, wooden top and wooden panel base, top access and cable tray, 3 drawers mobile pedestal with lock and soft-close.",
  ]) assert.ok(FINAL_SPECIFICATION_STYLE_GUIDE.includes(expected), expected);
});
