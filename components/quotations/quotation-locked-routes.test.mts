import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isValidElement, type ReactElement } from "react";

const require = createRequire(import.meta.url);
const continued = new Error("continued to normal quotation data loading");
const LockedQuotationView = () => null;

function loadPage(path: string, locked: boolean, role = "designer") {
  const quotation = { id: "quote-1", client_id: "client-1", layout_settings: { locked } };
  const tables: string[] = [];
  const noop = () => undefined;
  const imports = new Proxy({}, { get: () => noop });
  const supabase = {
    from(table: string) {
      tables.push(table);
      if (table !== "quotations") throw continued;
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: quotation, error: null }),
        maybeSingle: async () => ({ data: { workspace_version: "version-1" }, error: null }),
      };
      return chain;
    },
  };
  const compiled = ts.transpileModule(readFileSync(resolve(path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { default?: (props: unknown) => Promise<ReactElement<{ quotation: typeof quotation; role: string }>> } = {};
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime" || name === "react") return require(name);
      if (name === "@/lib/auth") return { requireActiveUser: async () => ({ user: { id: "user-1" }, profile: { role } }), canManageProductLibrary: () => false };
      if (name === "@/lib/supabase/server") return { createClient: async () => supabase };
      if (name === "@/lib/quotations/quotation-lock") return { isQuotationLocked: (subject: typeof quotation) => subject.layout_settings.locked };
      if (name === "@/components/quotations/quotation-locked-view") return { LockedQuotationView };
      return imports;
    },
  });
  return { page: exports.default!, tables };
}

async function renderLockedView(role: string) {
  const PdfDocument = () => null;
  const actions = {
    createProjectVariation: async () => undefined,
    createQuotationOption: async () => undefined,
    duplicateQuotation: async () => undefined,
  };
  const quotation = { id: "quote-1", layout_settings: {} };
  const compiled = ts.transpileModule(readFileSync(resolve("components/quotations/quotation-locked-view.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { LockedQuotationView?: (props: unknown) => Promise<ReactElement> } = {};
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@/app/quotations/actions") return actions;
      if (name === "next/link") return { default: "a" };
      if (name.endsWith("/project-file")) return { projectFileFromLayoutSettings: () => ({ orderNo: "CO-0001-001" }) };
      if (name.endsWith("/quotation-lock")) return { quotationLockReason: () => "Project already created. Create a revision to make changes." };
      if (name.endsWith("/quotation-pdf-document-data")) return { loadQuotationPdfDocumentData: async () => ({}) };
      if (name.endsWith("/quotation-pdf-settings-store")) return { loadQuotationPdfSettings: async () => ({ success: true, settings: {} }) };
      if (name.endsWith("/quotation-pdf-settings")) return { DEFAULT_QUOTATION_PDF_SETTINGS: {} };
      if (name.endsWith("/quotation-pdf-document")) return { QuotationPdfDocument: PdfDocument };
      return new Proxy({}, { get: () => "button" });
    },
  });
  const elements: ReactElement<Record<string, unknown>>[] = [];
  function visit(node: unknown) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isValidElement<Record<string, unknown>>(node)) return;
    elements.push(node);
    visit(node.props.children);
  }
  visit(await exports.LockedQuotationView!({ quotation, role }));
  return { elements, actions, PdfDocument };
}

test("locked view exposes read-only document and exports without mutation forms for a viewer", async () => {
  const { elements, PdfDocument } = await renderLockedView("viewer");
  assert.equal(elements.filter((element) => element.type === "form").length, 0);
  assert.ok(elements.some((element) => element.props["aria-label"] === "Quotation read-only"));
  assert.ok(elements.some((element) => element.props.href === "/projects/orders/CO-0001-001"));
  assert.ok(elements.some((element) => element.props.href === "/quotations/quote-1/download-pdf"));
  assert.ok(elements.some((element) => element.type === PdfDocument && element.props.showToolbar === false));
});

test("locked view offers only new-row actions to a quotation manager", async () => {
  const { elements, actions } = await renderLockedView("designer");
  const forms = elements.filter((element) => element.type === "form");
  assert.deepEqual(forms.map((element) => element.props.action), Object.values(actions));
  assert.equal(elements.filter((element) => element.props.name === "quotation_id" && element.props.value === "quote-1").length, 3);
  assert.ok(elements.some((element) => element.props.name === "duplicate_destination_mode" && element.props.value === "create_new_enquiry"));
});

for (const suffix of ["page.tsx", "builder/page.tsx", "local-builder/page.tsx"]) {
  const path = `app/quotations/[id]/${suffix}`;
  test(`${suffix}: locked quotation returns read-only view before editable data or workspace loading`, async () => {
    const { page, tables } = loadPage(path, true);
    const element = await page({ params: Promise.resolve({ id: "quote-1" }) });
    assert.equal(element.type, LockedQuotationView);
    assert.equal(element.props.quotation.id, "quote-1");
    assert.equal(element.props.role, "designer");
    assert.ok(tables.every((table) => table === "quotations"));
  });
  test(`${suffix}: unlocked quotation continues normal data loading`, async () => {
    const { page, tables } = loadPage(path, false);
    await assert.rejects(page({ params: Promise.resolve({ id: "quote-1" }) }), (error) => error === continued);
    assert.ok(tables.includes("clients"));
  });
}
