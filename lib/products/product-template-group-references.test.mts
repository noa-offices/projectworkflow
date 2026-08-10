import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductTemplatePricingGroupExists,
  compareProductTemplateGroupReferences,
  isProductTemplateGroupReferenceType,
  nextProductTemplateGroupReferenceDisplayOrder,
  normalizeProductTemplateGroupReferenceCaption,
  persistedProductTemplatePricingGroupScopeKeys,
  productTemplateGroupReferencePath,
  productTemplateGroupReferencePreview,
  reconcileStaleProductTemplateGroupReferences,
  removeReferenceWithCleanup,
  replaceReferenceWithCompensation,
  safeProductTemplateGroupReferenceFilename,
  staleProductTemplateGroupReferences,
  uploadReferenceWithCompensation,
  type ProductTemplateGroupReferenceRow,
} from "./product-template-group-references.js";

const pricing = {
  deskingSizePricing: [
    { id: "workstation-1", pricing_type: "workstation_group", group_name: "Standard", is_active: true, sort_order: 0, items: [] },
  ],
  categoryPricing: [
    { id: "finish-1", group_name: "Upholstery", items: [] },
    { id: "modular-1", pricing_type: "modular_group", group_name: "Modules", items: [] },
  ],
  accessoryPricing: [
    { id: "accessory-1", group_name: "Power", items: [] },
  ],
  variantPricing: [
    { id: "base-model-1", pricing_type: "base_model_group", group_name: "Executive", is_active: true, sort_order: 0, items: [] },
  ],
};

test("allows exactly the five schema pricing types", () => {
  for (const type of ["workstation", "base_model", "finish_category", "modular", "accessory"]) {
    assert.equal(isProductTemplateGroupReferenceType(type), true);
  }
  assert.equal(isProductTemplateGroupReferenceType("finish"), false);
});

test("validates explicit Finish/Category, Modular, Accessory, and Workstation group ids", () => {
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "workstation", groupId: "workstation-1" }));
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "finish_category", groupId: "finish-1" }));
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "modular", groupId: "modular-1" }));
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "accessory", groupId: "accessory-1" }));
});

test("rejects missing, mismatched, synthetic, and malformed groups", () => {
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "finish_category", groupId: "missing" }),
    /Finish \/ Category pricing group no longer exists/,
  );
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "finish_category", groupId: "modular-1" }),
    /Finish \/ Category pricing group no longer exists/,
  );
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ categoryPricing: [{ group_name: "Legacy", items: [] }], accessoryPricing: [], pricingType: "finish_category", groupId: "finish-group-0" }),
    /no longer exists/,
  );
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ categoryPricing: {}, accessoryPricing: [], pricingType: "finish_category", groupId: "finish-1" }),
    /pricing data is invalid/,
  );
});

test("validates only explicit persisted Workstation and Base / Model groups", () => {
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "workstation", groupId: "missing" }),
    /Workstation pricing group no longer exists/,
  );
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, deskingSizePricing: [{ id: "legacy-row", label: "120 x 60" }], pricingType: "workstation", groupId: "legacy-workstation-main" }),
    /Workstation pricing group no longer exists/,
  );
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({
    ...pricing,
    deskingSizePricing: [{ id: "legacy-workstation-main", pricing_type: "workstation_group", group_name: "Workstation Pricing", is_active: true, sort_order: 0, items: [] }],
    pricingType: "workstation",
    groupId: "legacy-workstation-main",
  }));
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, deskingSizePricing: [{ id: "bad", pricing_type: "workstation_group" }], pricingType: "workstation", groupId: "bad" }),
    /must contain an items array/,
  );
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "base_model", groupId: "base-model-1" }));
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, pricingType: "base_model", groupId: "missing" }),
    /Base \/ Model pricing group no longer exists/,
  );
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, variantPricing: [{ id: "row-1", variant_name: "Legacy" }], pricingType: "base_model", groupId: "legacy-base-model-main" }),
    /Base \/ Model pricing group no longer exists/,
  );
  assert.doesNotThrow(() => assertProductTemplatePricingGroupExists({
    ...pricing,
    variantPricing: [{ id: "legacy-base-model-main", pricing_type: "base_model_group", group_name: "Base / Model Pricing", is_active: true, sort_order: 0, items: [] }],
    pricingType: "base_model",
    groupId: "legacy-base-model-main",
  }));
  assert.throws(
    () => assertProductTemplatePricingGroupExists({ ...pricing, variantPricing: [{ id: "bad", pricing_type: "base_model_group" }], pricingType: "base_model", groupId: "bad" }),
    /must contain an items array/,
  );
});

test("builds the approved path with a safe MIME-derived filename", () => {
  assert.equal(
    safeProductTemplateGroupReferenceFilename("  My Manufacturer / Chair.PDF", "image/webp"),
    "my-manufacturer-chair.webp",
  );
  assert.equal(
    productTemplateGroupReferencePath({
      templateId: "template-1",
      pricingType: "base_model",
      groupId: "base-model-1",
      referenceId: "reference-1",
      filename: "diagram.png",
      mimeType: "image/png",
    }),
    "product-template-references/template-1/base_model/base-model-1/reference-1-diagram.png",
  );
  assert.equal(
    productTemplateGroupReferencePath({
      templateId: "template-1",
      pricingType: "finish_category",
      groupId: "group-1",
      referenceId: "reference-1",
      filename: "Chair Photo.JPG",
      mimeType: "image/jpeg",
    }),
    "product-template-references/template-1/finish_category/group-1/reference-1-chair-photo.jpg",
  );
  assert.throws(() => productTemplateGroupReferencePath({
    templateId: "template-1",
    pricingType: "finish_category",
    groupId: "../unsafe",
    referenceId: "reference-1",
    filename: "photo.png",
    mimeType: "image/png",
  }), /Pricing group id is invalid/);
  assert.equal(
    productTemplateGroupReferencePath({
      templateId: "template-1",
      pricingType: "workstation",
      groupId: "workstation-1",
      referenceId: "reference-1",
      filename: "plan.png",
      mimeType: "image/png",
    }),
    "product-template-references/template-1/workstation/workstation-1/reference-1-plan.png",
  );
});

test("normalizes captions and calculates the next display order", () => {
  assert.equal(normalizeProductTemplateGroupReferenceCaption("  Manufacturer view  "), "Manufacturer view");
  assert.equal(normalizeProductTemplateGroupReferenceCaption("   "), null);
  assert.equal(nextProductTemplateGroupReferenceDisplayOrder([]), 0);
  assert.equal(nextProductTemplateGroupReferenceDisplayOrder([2, 7, null]), 8);
});

test("upload DB failure attempts Storage cleanup", async () => {
  const events: string[] = [];
  await assert.rejects(() => uploadReferenceWithCompensation({
    uploadObject: async () => { events.push("upload"); },
    persistReference: async () => { events.push("insert"); throw new Error("db"); },
    cleanupUploadedObject: async () => { events.push("cleanup-new"); },
  }), /could not be saved/);
  assert.deepEqual(events, ["upload", "insert", "cleanup-new"]);
});

test("replacement updates DB before deleting the old object", async () => {
  const events: string[] = [];
  const result = await replaceReferenceWithCompensation({
    uploadNewObject: async () => { events.push("upload-new"); },
    updateReference: async () => { events.push("update-db"); return "updated"; },
    cleanupNewObject: async () => { events.push("cleanup-new"); },
    deleteOldObject: async () => { events.push("delete-old"); },
  });
  assert.deepEqual(events, ["upload-new", "update-db", "delete-old"]);
  assert.deepEqual(result, { value: "updated", cleanupWarning: null });
});

test("replacement DB failure cleans only the new object and preserves the old", async () => {
  const events: string[] = [];
  await assert.rejects(() => replaceReferenceWithCompensation({
    uploadNewObject: async () => { events.push("upload-new"); },
    updateReference: async () => { events.push("update-db"); throw new Error("db"); },
    cleanupNewObject: async () => { events.push("cleanup-new"); },
    deleteOldObject: async () => { events.push("delete-old"); },
  }), /could not be replaced/);
  assert.deepEqual(events, ["upload-new", "update-db", "cleanup-new"]);
});

test("removal DB failure never deletes Storage", async () => {
  const events: string[] = [];
  await assert.rejects(() => removeReferenceWithCleanup({
    deleteReference: async () => { events.push("delete-db"); throw new Error("db"); },
    deleteStorageObject: async () => { events.push("delete-storage"); },
  }), /db/);
  assert.deepEqual(events, ["delete-db"]);
});

test("removal DB success attempts Storage cleanup and reports failure", async () => {
  const events: string[] = [];
  const result = await removeReferenceWithCleanup({
    deleteReference: async () => { events.push("delete-db"); return true; },
    deleteStorageObject: async () => { events.push("delete-storage"); throw new Error("storage"); },
  });
  assert.deepEqual(events, ["delete-db", "delete-storage"]);
  assert.match(result.cleanupWarning ?? "", /Storage cleanup/);
});

test("list ordering is stable and signed URLs remain response-only", () => {
  const rows: ProductTemplateGroupReferenceRow[] = [
    { id: "b", template_id: "t", pricing_type: "accessory", group_id: "g", storage_path: "b", display_order: 1, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "a", template_id: "t", pricing_type: "accessory", group_id: "g", storage_path: "a", display_order: 1, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "c", template_id: "t", pricing_type: "accessory", group_id: "g", storage_path: "c", display_order: 0, caption: null, created_at: "2026-01-02", updated_at: "2026-01-02" },
  ];
  assert.deepEqual([...rows].sort(compareProductTemplateGroupReferences).map((row) => row.id), ["c", "a", "b"]);
  const response = productTemplateGroupReferencePreview(rows[0], "https://signed.example/preview");
  assert.equal(response.previewUrl, "https://signed.example/preview");
  assert.equal("preview_url" in rows[0], false);
  assert.equal("previewUrl" in rows[0], false);
});

test("collects explicit persisted group identities across all five pricing types", () => {
  const scopes = persistedProductTemplatePricingGroupScopeKeys({
    deskingSizePricing: [
      { id: "legacy-workstation-main", pricing_type: "workstation_group", group_name: "Workstation", is_active: true, sort_order: 0, items: [] },
    ],
    variantPricing: [
      { id: "legacy-base-model-main", pricing_type: "base_model_group", group_name: "Base / Model", is_active: true, sort_order: 0, items: [] },
    ],
    categoryPricing: [
      { id: "finish-1", group_name: "Fabric", items: [] },
      { id: "modular-1", pricing_type: "modular_group", group_name: "Modules", items: [] },
    ],
    accessoryPricing: [{ id: "accessory-1", group_name: "Power", items: [] }],
  });
  assert.deepEqual([...scopes].sort(), [
    "accessory\u0000accessory-1",
    "base_model\u0000legacy-base-model-main",
    "finish_category\u0000finish-1",
    "modular\u0000modular-1",
    "workstation\u0000legacy-workstation-main",
  ]);
  assert.deepEqual([...persistedProductTemplatePricingGroupScopeKeys({
    deskingSizePricing: [{ id: "row-1", label: "Legacy" }],
    variantPricing: [{ id: "row-2", variant_name: "Legacy" }],
    categoryPricing: [],
    accessoryPricing: [],
  })], []);
});

test("finds only stale references while retaining renamed, reordered, inactive, empty, and cross-type groups", () => {
  const references: ProductTemplateGroupReferenceRow[] = [
    { id: "keep-finish", template_id: "template-a", pricing_type: "finish_category", group_id: "same", storage_path: "keep-finish", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "keep-accessory", template_id: "template-a", pricing_type: "accessory", group_id: "same", storage_path: "keep-accessory", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "remove-one", template_id: "template-a", pricing_type: "base_model", group_id: "removed", storage_path: "remove-one", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "remove-two", template_id: "template-a", pricing_type: "workstation", group_id: "removed-too", storage_path: "remove-two", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
  ];
  const scopes = new Set(["finish_category\u0000same", "accessory\u0000same"]);
  assert.deepEqual(staleProductTemplateGroupReferences(references, scopes).map((reference) => reference.id), ["remove-one", "remove-two"]);
});

test("reconciles stale records DB-first, preserves valid records, and tolerates cleanup failures", async () => {
  const references: ProductTemplateGroupReferenceRow[] = [
    { id: "keep", template_id: "template-a", pricing_type: "base_model", group_id: "same", storage_path: "keep", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "remove", template_id: "template-a", pricing_type: "workstation", group_id: "gone", storage_path: "remove", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "db-failure", template_id: "template-a", pricing_type: "accessory", group_id: "gone-too", storage_path: "db-failure", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
    { id: "storage-failure", template_id: "template-a", pricing_type: "modular", group_id: "gone-three", storage_path: "storage-failure", display_order: 0, caption: null, created_at: "2026-01-01", updated_at: "2026-01-01" },
  ];
  const events: string[] = [];
  const warnings: string[] = [];
  const removedCount = await reconcileStaleProductTemplateGroupReferences({
    references,
    persistedScopeKeys: new Set(["base_model\u0000same"]),
    deleteReference: async (reference) => {
      events.push(`db:${reference.id}`);
      if (reference.id === "db-failure") throw new Error("db");
    },
    deleteStorageObject: async (reference) => {
      events.push(`storage:${reference.id}`);
      if (reference.id === "storage-failure") throw new Error("storage");
    },
    onReferenceDeleteError: (reference) => { warnings.push(`db:${reference.id}`); },
    onStorageDeleteError: (reference) => { warnings.push(`storage:${reference.id}`); },
  });
  assert.equal(removedCount, 2);
  assert.deepEqual(events, ["db:remove", "storage:remove", "db:db-failure", "db:storage-failure", "storage:storage-failure"]);
  assert.deepEqual(warnings, ["db:db-failure", "storage:storage-failure"]);
});
