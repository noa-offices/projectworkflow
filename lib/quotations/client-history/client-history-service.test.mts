/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake client and hostile input */
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";
const H1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const H2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const H3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const QUOTE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OLD_QUOTE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OLD_ROW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PIC = `quote-images:quotation-items/${OLD_QUOTE}/${OLD_ROW}/1700000000000-desk.webp`;
const NEW_ROW = "new-row_1";

type Row = Record<string, any>;
function makeWorld() {
  return {
    authMode: "ok" as "ok" | "redirect",
    role: "sales_designer",
    tables: { client_quote_history: [] as Row[], product_templates: [] as Row[], quotations: [] as Row[], quotation_items: [] as Row[] },
    files: new Map<string, { type: string; bytes: Uint8Array }>(),
    calls: [] as string[],
    selects: [] as Array<{ table: string; columns: string }>,
    ranges: [] as Array<[number, number]>,
    ors: [] as string[],
    eqs: [] as Array<[string, unknown]>,
    rpcCalls: [] as Array<{ name: string; args: any }>,
    rpc: {} as Record<string, (args: any) => { data: any; error: any }>,
    uploads: [] as string[],
    removed: [] as string[],
    updates: [] as Array<{ table: string; values: Row }>,
    signedFail: false,
    signedPaths: [] as string[],
    signedSeconds: 0,
    downloadError: null as any,
    adminCalls: 0,
    addCalls: [] as FormData[],
    forms: [] as string[],
  };
}
let world = makeWorld();

function buildClient() {
  class Query {
    private filters: Array<[string, unknown]> = [];
    private inFilter: [string, unknown[]] | null = null;
    private updateValues: Row | null = null;
    private wantCount = false;
    private from = 0;
    private to = Infinity;
    constructor(private table: keyof ReturnType<typeof makeWorld>["tables"]) {}
    select(columns: string, options?: { count?: string }) {
      world.selects.push({ table: this.table, columns });
      this.wantCount = Boolean(options?.count);
      return this;
    }
    update(values: Row) { this.updateValues = values; world.updates.push({ table: this.table, values }); return this; }
    eq(column: string, value: unknown) { world.eqs.push([column, value]); this.filters.push([column, value]); return this; }
    in(column: string, values: unknown[]) { this.inFilter = [column, values]; return this; }
    or(text: string) { world.ors.push(text); return this; }
    order() { return this; }
    range(from: number, to: number) { world.ranges.push([from, to]); this.from = from; this.to = to; return this; }
    private rows() {
      return world.tables[this.table].filter((row) => this.filters.every(([c, v]) => row[c] === v) && (!this.inFilter || this.inFilter[1].includes(row[this.inFilter[0]])));
    }
    maybeSingle() { world.calls.push(`select:${this.table}`); return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      world.calls.push(`${this.updateValues ? "update" : "select"}:${this.table}`);
      const all = this.rows();
      if (this.updateValues) { for (const row of all) Object.assign(row, this.updateValues); return Promise.resolve({ data: all.map((row) => ({ id: row.id })), error: null }).then(resolve, reject); }
      return Promise.resolve({ data: all.slice(this.from, this.to + 1), count: this.wantCount ? all.length : null, error: null }).then(resolve, reject);
    }
  }
  return {
    rpc: async (name: string, args: any) => {
      world.calls.push(`rpc:${name}`);
      world.rpcCalls.push({ name, args });
      return world.rpc[name] ? world.rpc[name](args) : { data: null, error: null };
    },
    from: (table: string) => new Query(table as any),
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], seconds: number) => {
          world.calls.push("sign");
          world.signedPaths.push(...paths);
          world.signedSeconds = seconds;
          if (world.signedFail) throw new Error("storage down");
          return { data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })), error: null };
        },
        download: async (path: string) => {
          world.calls.push(`download:${path}`);
          if (world.downloadError) return { data: null, error: world.downloadError };
          const file = world.files.get(`${bucket}/${path}`);
          if (!file) return { data: null, error: { message: "Object not found", statusCode: "404" } };
          return { data: new Blob([file.bytes as BlobPart], { type: file.type }), error: null };
        },
        upload: async (path: string, body: Uint8Array, options: any) => {
          world.calls.push(`upload:${path}`);
          world.uploads.push(path);
          world.files.set(`${bucket}/${path}`, { type: options?.contentType, bytes: body });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => { world.removed.push(...paths); return { data: [], error: null }; },
      }),
    },
  };
}

mock.module("@/lib/auth", { namedExports: {
  requireActiveUser: async () => {
    world.calls.push("auth");
    if (world.authMode === "redirect") throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    return { user: { id: "u1" }, profile: { role: world.role }, displayName: "Fixture" };
  },
  requireRecordsManager: async () => {
    world.calls.push("records-manager");
    if (world.role === "viewer") throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
    return { user: { id: "u1" }, profile: { role: world.role }, displayName: "Fixture" };
  },
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => buildClient() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { world.adminCalls += 1; return { error: "no admin", client: null }; } } });
mock.module("@/app/quotations/actions", { namedExports: { addHistoryItemToQuotation: async (form: FormData) => { world.addCalls.push(form); return { ok: true, itemId: "row-1", message: "History item added.", note: null }; } } });

const actions = await import("./client-history-actions");
const service = await import("./client-history-service");
const { CLIENT_HISTORY_MESSAGES } = await import("./client-history");

const historyRow = (extra: Row = {}): Row => ({
  id: H1, client_id: CLIENT, kind: "custom", template_id: null, item_name: "Meeting table", brand: "Acme", item_code: "MT-1", spec_short: "Solid oak top",
  unit_label: "Pc", qty: 2, currency: "AED", last_unit_price: 1200, last_prices: [{ price: 1200, currency: "AED", qty: 2, at: "2026-11-01T00:00:00Z", quotation_id: OLD_QUOTE, quotation_no: "QN-1" }],
  line_recipe: null, picture_ref: PIC, last_quotation_id: OLD_QUOTE, last_quotation_no: "QN-1", quoted_at: "2026-11-01T00:00:00Z", has_recipe: null, selected_image: null, ...extra,
});
const recipe = { recipe: { recipe_version: 1, template_id: TEMPLATE, selections: { modular_quantities: {}, pricing_accessory_quantities: {}, component_accessory_quantities: {}, skipped_accessory_group_ids: [], required_overrides: {}, component_option_selections: {}, accessory_category_choices: {} }, finishes: [], selected_image: null, linked: { instances: {}, selections: {} } }, spec_overrides: { specification_edited: false, edited_specification: null, generated_specification_hash: null } };
const webpBytes = new Uint8Array([82, 73, 70, 70, 1, 0, 0, 0, 87, 69, 66, 80]);
function reset() { world = makeWorld(); }

// ── list ───────────────────────────────────────────────────────────────────
test("list: 30 per page, newest first query, the recipe itself is never selected", async () => {
  reset();
  world.tables.client_quote_history = Array.from({ length: 45 }, (_, index) => historyRow({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`, picture_ref: null }));
  const page1 = await actions.listClientHistoryAction({ clientId: CLIENT, page: 1 });
  assert.equal(page1.ok, true);
  assert.equal((page1 as any).items.length, 30);
  assert.equal((page1 as any).total, 45);
  assert.equal((page1 as any).hasMore, true);
  assert.deepEqual(world.ranges[0], [0, 29]);
  const page2 = await actions.listClientHistoryAction({ clientId: CLIENT, page: 2 });
  assert.equal((page2 as any).items.length, 15);
  assert.equal((page2 as any).hasMore, false);
  assert.deepEqual(world.ranges[1], [30, 59]);
  const select = world.selects.find((entry) => entry.table === "client_quote_history")!.columns;
  assert.doesNotMatch(select.replace(/line_recipe->/g, ""), /line_recipe/, "line_recipe is only read through ->, never selected whole");
  assert.ok(world.eqs.some(([column, value]) => column === "client_id" && value === CLIENT));
  for (const item of (page1 as any).items) {
    assert.ok(!("line_recipe" in item) && !("lineRecipe" in item) && !("recipe" in item) && !("picture_ref" in item) && !("pictureRef" in item), "display fields only");
  }
});

test("list: search is escaped and goes through one filter over name, brand and code; an invalid kind is refused", async () => {
  reset();
  world.tables.client_quote_history = [historyRow({ picture_ref: null })];
  await actions.listClientHistoryAction({ clientId: CLIENT, query: "50%_off" });
  assert.equal(world.ors.length, 1);
  assert.match(world.ors[0], /item_name\.ilike\."%50\\\\%\\\\_off%",brand\.ilike\."%50\\\\%\\\\_off%",item_code\.ilike\."%50\\\\%\\\\_off%"/);
  const refused = await actions.listClientHistoryAction({ clientId: CLIENT, kind: "weird" });
  assert.deepEqual(refused, { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
  const badClient = await actions.listClientHistoryAction({ clientId: "nope" });
  assert.deepEqual(badClient, { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
  reset();
  world.tables.client_quote_history = [historyRow({ kind: "library", template_id: TEMPLATE, picture_ref: null })];
  world.tables.client_quote_history.push(historyRow({ id: H2, kind: "custom", picture_ref: null }));
  const onlyCustom = await actions.listClientHistoryAction({ clientId: CLIENT, kind: "custom" });
  assert.deepEqual((onlyCustom as any).items.map((item: any) => item.id), [H2]);
});

test("list pictures: product rows use the template picture, custom rows a short signed link, a signing failure means no picture", async () => {
  reset();
  world.tables.product_templates = [{ id: TEMPLATE, default_image_url: "product-templates/t/default.png", proposed_image_url_1: null, proposed_image_url_2: "product-templates/t/two.png" }];
  world.tables.client_quote_history = [
    historyRow({ id: H1, kind: "custom" }),
    historyRow({ id: H2, kind: "library", template_id: TEMPLATE, picture_ref: null }),
    historyRow({ id: H3, kind: "configured", template_id: TEMPLATE, picture_ref: null, has_recipe: TEMPLATE, selected_image: "product-templates/t/two.png" }),
  ];
  const result: any = await actions.listClientHistoryAction({ clientId: CLIENT });
  const byId = new Map(result.items.map((item: any) => [item.id, item]));
  assert.deepEqual((byId.get(H1) as any).picture, { kind: "signed", url: `https://signed.example/${PIC.slice("quote-images:".length)}` });
  assert.ok(world.signedSeconds > 0 && world.signedSeconds <= 600, "signed links last 10 minutes at most");
  assert.deepEqual((byId.get(H2) as any).picture, { kind: "template", path: "product-templates/t/default.png" });
  assert.deepEqual((byId.get(H3) as any).picture, { kind: "template", path: "product-templates/t/two.png" }, "the picture the user chose is kept when the template still has it");
  assert.equal((byId.get(H3) as any).hasRecipe, true);
  assert.equal((byId.get(H2) as any).hasRecipe, false);
  assert.equal(JSON.stringify(result).includes("quote-images:"), false, "no raw storage reference is returned for custom rows (only the signed link)");

  world.signedFail = true;
  const failed: any = await actions.listClientHistoryAction({ clientId: CLIENT });
  assert.equal(failed.ok, true, "a signing failure is never an error");
  assert.equal(failed.items.find((item: any) => item.id === H1).picture, null);
});

// ── add data ───────────────────────────────────────────────────────────────
test("add data: a row of another client is refused; unknown ids and bad input are friendly failures", async () => {
  reset();
  world.tables.client_quote_history = [historyRow()];
  const wrong = await actions.getClientHistoryItemForAddAction({ historyId: H1, clientId: OTHER_CLIENT });
  assert.deepEqual(wrong, { ok: false, message: CLIENT_HISTORY_MESSAGES.wrong_client });
  assert.deepEqual(await actions.getClientHistoryItemForAddAction({ historyId: H2, clientId: CLIENT }), { ok: false, message: CLIENT_HISTORY_MESSAGES.item_not_found });
  assert.deepEqual(await actions.getClientHistoryItemForAddAction({ historyId: "x", clientId: CLIENT }), { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
});

test("add data: custom -> field values and the picture reference; configured -> a My Collection-shaped setup; library -> the template", async () => {
  reset();
  world.tables.product_templates = [{ id: TEMPLATE, is_active: true, lifecycle_status: "active" }];
  world.tables.client_quote_history = [
    historyRow(),
    historyRow({ id: H2, kind: "configured", template_id: TEMPLATE, item_name: "EV211", picture_ref: null, line_recipe: recipe }),
    historyRow({ id: H3, kind: "library", template_id: TEMPLATE, item_name: "Chair", picture_ref: null }),
  ];
  const custom: any = await actions.getClientHistoryItemForAddAction({ historyId: H1, clientId: CLIENT });
  assert.deepEqual(custom.item, { kind: "custom", id: H1, itemName: "Meeting table", itemCode: "MT-1", brand: "Acme", specification: "Solid oak top", unitLabel: "Pc", price: 1200, currency: "AED", pictureRef: PIC });
  const configured: any = await actions.getClientHistoryItemForAddAction({ historyId: H2, clientId: CLIENT });
  assert.equal(configured.item.kind, "configured");
  assert.deepEqual(Object.keys(configured.item.setup).sort(), ["id", "recipe", "setupName", "specOverrides", "templateId"]);
  assert.equal(configured.item.setup.templateId, TEMPLATE);
  assert.equal(configured.item.setup.recipe.template_id, TEMPLATE);
  const library: any = await actions.getClientHistoryItemForAddAction({ historyId: H3, clientId: CLIENT });
  assert.deepEqual(library.item, { kind: "library", id: H3, templateId: TEMPLATE, itemName: "Chair", recipeUnavailable: false });
});

test("add data: an unreadable recipe falls back to opening the product; an inactive product is unavailable", async () => {
  reset();
  world.tables.product_templates = [{ id: TEMPLATE, is_active: true, lifecycle_status: "active" }];
  world.tables.client_quote_history = [historyRow({ kind: "configured", template_id: TEMPLATE, picture_ref: null, line_recipe: { recipe: { template_id: "other" }, spec_overrides: {} } })];
  const fallback: any = await actions.getClientHistoryItemForAddAction({ historyId: H1, clientId: CLIENT });
  assert.equal(fallback.item.kind, "library");
  assert.equal(fallback.item.recipeUnavailable, true);
  world.tables.product_templates = [{ id: TEMPLATE, is_active: true, lifecycle_status: "archived" }];
  assert.deepEqual(await actions.getClientHistoryItemForAddAction({ historyId: H1, clientId: CLIENT }), { ok: false, message: CLIENT_HISTORY_MESSAGES.product_unavailable });
});

// ── delete ─────────────────────────────────────────────────────────────────
test("delete: calls the database function and nothing else; failures are friendly", async () => {
  reset();
  world.rpc.client_quote_history_delete = () => ({ data: true, error: null });
  assert.deepEqual(await actions.deleteClientHistoryAction({ historyId: H1 }), { ok: true });
  assert.deepEqual(world.rpcCalls, [{ name: "client_quote_history_delete", args: { p_id: H1 } }]);
  assert.equal(world.updates.length, 0);
  world.rpc.client_quote_history_delete = () => ({ data: false, error: null });
  assert.deepEqual(await actions.deleteClientHistoryAction({ historyId: H1 }), { ok: false, message: CLIENT_HISTORY_MESSAGES.item_not_found });
  world.rpc.client_quote_history_delete = () => ({ data: null, error: { message: "Not allowed.", code: "P0001" } });
  assert.deepEqual(await actions.deleteClientHistoryAction({ historyId: H1 }), { ok: false, message: CLIENT_HISTORY_MESSAGES.not_allowed });
  world.rpc.client_quote_history_delete = () => ({ data: null, error: { message: "boom secret detail" } });
  const failed: any = await actions.deleteClientHistoryAction({ historyId: H1 });
  assert.equal(failed.message, CLIENT_HISTORY_MESSAGES.delete_failed);
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
  assert.deepEqual(await actions.deleteClientHistoryAction({ historyId: "nope" }), { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
});

// ── picture copy (server builder row and local builder) ────────────────────
test("picture: copied into the NEW row's own quote-images path, the row is updated once", async () => {
  reset();
  world.files.set(`quote-images/${PIC.slice("quote-images:".length)}`, { type: "image/webp", bytes: webpBytes });
  world.tables.quotation_items = [{ id: NEW_ROW, quotation_id: QUOTE, proposed_image_url_snapshot: null }];
  const result = await service.addHistoryPictureToQuoteRow({ ...buildClient() } as any, { pictureRef: PIC, quotationId: QUOTE, rowId: NEW_ROW });
  assert.deepEqual(result, { ok: true, attached: true });
  assert.equal(world.uploads.length, 1);
  assert.match(world.uploads[0], new RegExp(`^quotation-items/${QUOTE}/${NEW_ROW}/\\d+-desk\\.webp$`), "the new row's own path, never the old one");
  assert.ok(!world.uploads[0].includes(OLD_QUOTE));
  assert.equal(world.updates.filter((entry) => entry.table === "quotation_items").length, 1, "single write");
  assert.match(world.tables.quotation_items[0].proposed_image_url_snapshot, new RegExp(`^quote-images:quotation-items/${QUOTE}/${NEW_ROW}/`));
});

test("picture: a missing old file never fails the add (picture_gone), nothing is written", async () => {
  reset();
  world.tables.quotation_items = [{ id: NEW_ROW, quotation_id: QUOTE, proposed_image_url_snapshot: null }];
  const result = await service.addHistoryPictureToQuoteRow(buildClient() as any, { pictureRef: PIC, quotationId: QUOTE, rowId: NEW_ROW });
  assert.deepEqual(result, { ok: false, kind: "picture_gone" });
  assert.equal(world.uploads.length, 0);
  assert.equal(world.updates.length, 0);
  assert.equal((await service.addHistoryPictureToQuoteRow(buildClient() as any, { pictureRef: null, quotationId: QUOTE, rowId: NEW_ROW })).ok, true, "no picture: nothing to do");
  world.downloadError = { message: "storage hiccup", statusCode: "500" };
  assert.deepEqual(await service.addHistoryPictureToQuoteRow(buildClient() as any, { pictureRef: PIC, quotationId: QUOTE, rowId: NEW_ROW }), { ok: false, kind: "picture_failed" });
});

test("picture: only quote-row pictures can be read; a copied file is removed again when the row cannot be updated", async () => {
  reset();
  world.files.set(`quote-images/${PIC.slice("quote-images:".length)}`, { type: "image/webp", bytes: webpBytes });
  assert.deepEqual(await service.copyHistoryPictureToQuoteRow(buildClient() as any, { pictureRef: "quote-images:../../secret.webp", quotationId: QUOTE, rowId: NEW_ROW }), { ok: false, kind: "picture_failed" });
  assert.deepEqual(await service.copyHistoryPictureToQuoteRow(buildClient() as any, { pictureRef: "my-collection-images:u/x/1-a.webp", quotationId: QUOTE, rowId: NEW_ROW }), { ok: false, kind: "picture_failed" });
  assert.equal(world.calls.some((call) => call.startsWith("download:")), false, "nothing was read");
  world.tables.quotation_items = []; // the row does not exist: the update changes nothing
  const result = await service.addHistoryPictureToQuoteRow(buildClient() as any, { pictureRef: PIC, quotationId: QUOTE, rowId: NEW_ROW });
  assert.deepEqual(result, { ok: false, kind: "picture_failed" });
  assert.equal(world.removed.length, 1, "the copy is cleaned up");
});

test("local builder picture action: needs the quotation's own client, returns the new ref, a dead picture is a friendly failure", async () => {
  reset();
  world.tables.quotations = [{ id: QUOTE, client_id: CLIENT }];
  world.tables.client_quote_history = [historyRow()];
  world.files.set(`quote-images/${PIC.slice("quote-images:".length)}`, { type: "image/webp", bytes: webpBytes });
  const ok: any = await actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: NEW_ROW });
  assert.equal(ok.ok, true);
  assert.match(ok.ref, new RegExp(`^quote-images:quotation-items/${QUOTE}/${NEW_ROW}/\\d+-desk\\.webp$`));
  world.tables.quotations = [{ id: QUOTE, client_id: OTHER_CLIENT }];
  assert.deepEqual(await actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: NEW_ROW }), { ok: false, message: CLIENT_HISTORY_MESSAGES.wrong_client });
  world.tables.quotations = [{ id: QUOTE, client_id: CLIENT }];
  world.files.clear();
  assert.deepEqual(await actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: NEW_ROW }), { ok: false, message: CLIENT_HISTORY_MESSAGES.picture_gone });
  assert.deepEqual(await actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: "../bad" }), { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
});

// ── server builder add (wrapper) ───────────────────────────────────────────
test("server builder add: validates input, makes ONE call to the quotation add action with only the three fields", async () => {
  reset();
  const done: any = await actions.addHistoryItemToQuotationAction({ quotationId: QUOTE, sectionId: null, historyId: H1, price: 1, evil: "x" } as any);
  assert.deepEqual(done, { ok: true, itemId: "row-1", message: "History item added.", note: null });
  assert.equal(world.addCalls.length, 1, "single write: no double add");
  assert.deepEqual(Array.from(world.addCalls[0].keys()).sort(), ["history_id", "quotation_id"]);
  assert.deepEqual(await actions.addHistoryItemToQuotationAction({ quotationId: "bad", historyId: H1 }), { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
  assert.deepEqual(await actions.addHistoryItemToQuotationAction({ quotationId: QUOTE, sectionId: "bad", historyId: H1 }), { ok: false, message: CLIENT_HISTORY_MESSAGES.invalid_request });
  assert.equal(world.addCalls.length, 1);
});

// ── auth and never-throw ───────────────────────────────────────────────────
test("every action calls requireActiveUser first, uses no admin client, and never throws", async () => {
  const runs: Array<[string, () => Promise<unknown>]> = [
    ["list", () => actions.listClientHistoryAction({ clientId: CLIENT })],
    ["getForAdd", () => actions.getClientHistoryItemForAddAction({ historyId: H1, clientId: CLIENT })],
    ["delete", () => actions.deleteClientHistoryAction({ historyId: H1 })],
    ["add", () => actions.addHistoryItemToQuotationAction({ quotationId: QUOTE, historyId: H1 })],
    ["localPicture", () => actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: NEW_ROW })],
  ];
  for (const [name, run] of runs) {
    reset();
    await run();
    assert.equal(world.calls[0], "auth", `${name}: auth is the first call`);
    assert.equal(world.adminCalls, 0, `${name}: no admin client`);
    reset();
    world.authMode = "redirect";
    const denied: any = await run();
    assert.deepEqual(denied, { ok: false, message: CLIENT_HISTORY_MESSAGES.not_allowed }, `${name}: a sign-in redirect is a friendly failure`);
    assert.equal(world.calls.some((call) => call.startsWith("select:") || call.startsWith("rpc:")), false, `${name}: nothing was read or written without a user`);
  }
  reset();
  world.role = "viewer";
  assert.deepEqual(await actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: NEW_ROW }), { ok: false, message: CLIENT_HISTORY_MESSAGES.not_allowed }, "writing needs the quote builder permission");
});

test("failures never leak raw errors, and nothing logs a payload, price or recipe", async () => {
  reset();
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    world.tables.client_quote_history = [historyRow({ kind: "configured", template_id: TEMPLATE, line_recipe: recipe })];
    world.tables.product_templates = [{ id: TEMPLATE, is_active: true, lifecycle_status: "active" }];
    world.downloadError = { message: "secret price 1200 recipe", statusCode: "500" };
    world.tables.quotations = [{ id: QUOTE, client_id: CLIENT }];
    await actions.copyHistoryPictureToLocalRowAction({ historyId: H1, quotationId: QUOTE, rowId: NEW_ROW });
    await actions.getClientHistoryItemForAddAction({ historyId: H1, clientId: CLIENT });
  } finally {
    console.error = original;
  }
  for (const line of logged) assert.doesNotMatch(line, /1200|recipe_version|secret|template_id|quote-images/i, line);
});
