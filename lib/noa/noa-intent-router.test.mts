import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNoaIntent,
  classifyNoaRoute,
  describeNoaPageContext,
  greetingResponseText,
  NOA_CAPABILITY_SUMMARY_TEXT,
  noaThinkingStatusText,
  normalizeNoaUserMessage,
  recordedQuotationFollowUpReference,
} from "./noa-intent-router.js";

function context(overrides: Partial<Parameters<typeof classifyNoaIntent>[1]> = {}) {
  return { pathname: "/dashboard", section: "dashboard" as const, ...overrides };
}

// A. Routing -----------------------------------------------------------------

test("product keywords route to Product", () => {
  assert.equal(
    classifyNoaIntent("What is the supplier code for this template?", context()),
    "Product",
  );
});

test("quotation keywords route to Quotation", () => {
  assert.equal(
    classifyNoaIntent("What's the total for this quotation?", context()),
    "Quotation",
  );
});

test("conversation greetings route to greeting and stay concise", () => {
  for (const message of ["hey noa", "hi", "good morning"]) {
    assert.equal(classifyNoaRoute(message, context()), "greeting", message);
  }
  assert.equal(greetingResponseText("hey noa", " Junais "), "Hey Junais 👋 How can I help?");
  assert.equal(greetingResponseText("hey noa", " Junais KP "), "Hey Junais 👋 How can I help?");
  assert.equal(greetingResponseText("hey noa", "   "), "Hey 👋 How can I help?");
  assert.equal(greetingResponseText("hi"), "Hey 👋 How can I help?");
  assert.ok(!greetingResponseText("hey noa", "Junais").includes("products and pricing"));
});

test("explicit capability questions route to the implemented-capabilities summary only", () => {
  assert.equal(classifyNoaRoute("what can you do", context()), "capabilities");
  assert.equal(classifyNoaRoute("what are your capabilities", context()), "capabilities");
  assert.match(NOA_CAPABILITY_SUMMARY_TEXT, /products and pricing.*quotations.*projects.*clients.*procurement.*activity.*admin.*insights/i);
  assert.doesNotMatch(NOA_CAPABILITY_SUMMARY_TEXT, /attendance|sales\/enquiry|configuration planner/i);
});

test("B2 quotation client/project/usage and comparison phrases route to Quotation", () => {
  for (const message of ["quotations for client Acme", "show quotations for project Lobby", "quotation total for client Acme", "which quotations used product OXI", "compare Q-101 and Q-104"]) {
    assert.equal(classifyNoaIntent(message, context()), "Quotation", message);
  }
});

test("price keywords route to Price", () => {
  assert.equal(
    classifyNoaIntent("Is this product's price status current or due for a check?", context()),
    "Price",
  );
});

test("how-do-I phrasing routes to Help even when a domain noun is present", () => {
  assert.equal(
    classifyNoaIntent("How do I archive a product?", context()),
    "Help",
  );
});

test("page context influences ambiguous routing (no domain keyword matched)", () => {
  assert.equal(
    classifyNoaIntent("Why is this warning showing?", context({ pathname: "/quotations/abc", quotationId: "abc", section: "quotations" })),
    "Quotation",
  );
  assert.equal(
    classifyNoaIntent("Why is this warning showing?", context({ pathname: "/products/templates", section: "products" })),
    "Product",
  );
});

// B. Out-of-scope --------------------------------------------------------------

test("weather/trivia style prompts route to Help regardless of page context", () => {
  assert.equal(
    classifyNoaIntent("What's the weather like today?", context({ pathname: "/products/templates", section: "products" })),
    "Help",
  );
  assert.equal(
    classifyNoaIntent("Tell me a joke", context({ pathname: "/quotations/abc", quotationId: "abc", section: "quotations" })),
    "Help",
  );
});

test("an off-topic prompt never resolves to Product/Quotation/Price, so no capability is ever dispatched for it", () => {
  const domains = [
    classifyNoaIntent("What is the capital of France?", context({ section: "products" })),
    classifyNoaIntent("Write me a poem about the ocean", context({ section: "quotations" })),
  ];

  for (const domain of domains) {
    assert.notEqual(domain, "Product");
    assert.notEqual(domain, "Quotation");
    assert.notEqual(domain, "Price");
    assert.equal(domain, "Help");
  }
});

// Phase 1C - B. Context routing ------------------------------------------------

test("quotation page + ambiguous warning question -> Quotation, using context.quotationId", () => {
  const result = classifyNoaIntent(
    "Why is this warning showing?",
    context({ pathname: "/quotations/abc", quotationId: "abc", section: "quotations" }),
  );
  assert.equal(result, "Quotation");
});

test("product template context + explicit price question -> Price, beating the product page context", () => {
  const result = classifyNoaIntent(
    "What is the price status?",
    context({ pathname: "/products/templates", productTemplateId: "tpl-1", section: "products" }),
  );
  assert.equal(result, "Price");
});

test("product template context + generic 'tell me about this' -> Product", () => {
  const result = classifyNoaIntent(
    "Tell me about this product",
    context({ pathname: "/products/templates", productTemplateId: "tpl-1", section: "products" }),
  );
  assert.equal(result, "Product");
});

test("explicit product query on a quotation page -> Product, not forced to Quotation by section", () => {
  const result = classifyNoaIntent(
    "Find product OXI",
    context({ pathname: "/quotations/abc", quotationId: "abc", section: "quotations" }),
  );
  assert.equal(result, "Product");
});

test("explicit price query beats a generic product-context page", () => {
  const result = classifyNoaIntent(
    "Is the price current or does it need checking?",
    context({ pathname: "/products/templates", productTemplateId: "tpl-1", section: "products" }),
  );
  assert.equal(result, "Price");
});

// Phase 1C - D. Status ---------------------------------------------------------

test("Product pending status text", () => {
  assert.equal(noaThinkingStatusText("Product"), "Checking Product Library...");
});

test("Quotation pending status text", () => {
  assert.equal(noaThinkingStatusText("Quotation"), "Checking this quotation...");
});

test("Price pending status text", () => {
  assert.equal(noaThinkingStatusText("Price"), "Checking price status...");
});

test("Help pending status text uses ProjectWorkflow guidance wording", () => {
  assert.match(noaThinkingStatusText("Help"), /projectworkflow guidance/i);
});

// Phase 1D - real bug scenarios (PART 10) --------------------------------------

const productsPage = () => context({ pathname: "/products/manage", section: "products" as const });
const quotationsPage = (id = "Q-2026-0142") =>
  context({ pathname: `/quotations/${id}`, quotationId: id, section: "quotations" as const });
const productTemplatePage = (templateId = "tpl-1") =>
  context({ pathname: "/products/manage", productTemplateId: templateId, section: "products" as const });

test("1. Products page: 'are you on which page currently' -> context, NOT Product", () => {
  const route = classifyNoaRoute("are you on which page currently", productsPage());
  assert.equal(route, "context");
  assert.notEqual(route, "Product");
});

test("2. Products page: 'which page am I on?' -> context/self", () => {
  assert.equal(classifyNoaRoute("which page am I on?", productsPage()), "context");
});

test("3. /products/manage -> readable answer includes 'Product Management'", () => {
  const answer = describeNoaPageContext(productsPage());
  assert.match(answer, /Product Management/);
});

test("4. Products page: 'currently what project is running' -> Project, NOT Product", () => {
  const route = classifyNoaRoute("currently what project is running", productsPage());
  assert.equal(route, "Project");
  assert.notEqual(route, "Product");
});

test("5. Products page: 'show my active projects' -> Project", () => {
  assert.equal(classifyNoaRoute("show my active projects", productsPage()), "Project");
});

test("6. Products page: 'find Every' -> Product", () => {
  assert.equal(classifyNoaRoute("find Every", productsPage()), "Product");
});

test("7. Quotation page: 'why is this warning showing?' -> Quotation contextual fallback", () => {
  assert.equal(classifyNoaRoute("why is this warning showing?", quotationsPage()), "Quotation");
});

test("8. Product page: 'tell me about this' with productTemplateId -> Product contextual fallback", () => {
  assert.equal(classifyNoaRoute("tell me about this", productTemplatePage()), "Product");
});

test("9. Product page: 'what is the price status?' -> Price", () => {
  assert.equal(classifyNoaRoute("what is the price status?", productTemplatePage()), "Price");
});

test("10. Quotation page: 'find OXI' -> Product", () => {
  assert.equal(classifyNoaRoute("find OXI", quotationsPage()), "Product");
});

test("11. Product page: 'what project is active?' -> Project", () => {
  assert.equal(classifyNoaRoute("what project is active?", productsPage()), "Project");
});

test("a Quotation-domain message containing the bare word 'project' is not misrouted to unsupported (regression guard)", () => {
  assert.equal(classifyNoaRoute("what is the project quotation total?", quotationsPage()), "Quotation");
});

test("procurement keywords route to the Procurement domain (real domain since B5)", () => {
  assert.equal(classifyNoaRoute("show me the latest purchase order", productsPage()), "Procurement");
});

test("classifyNoaIntent still returns a public NoaDomain (collapses \"context\" to Help; \"Project\" is now a real supported domain since B3)", () => {
  assert.equal(classifyNoaIntent("are you on which page currently", productsPage()), "Help");
  assert.equal(classifyNoaIntent("currently what project is running", productsPage()), "Project");
});

// Phase 1E - imperfect English / typo tolerance (PART 10) ----------------------

// A. Real user case
test("1. the real bug-report question routes to Quotation", () => {
  assert.equal(classifyNoaRoute("can you check how many quotations pending and confirmed", context()), "Quotation");
});

test("2. reordered word-for-word still routes to Quotation", () => {
  assert.equal(classifyNoaRoute("quotation pending and confirmed how many", context()), "Quotation");
});

test("3. rough word order still routes to Quotation", () => {
  assert.equal(classifyNoaRoute("pending quotation how many", context()), "Quotation");
});

test("4. typo'd version of the same question still routes to Quotation", () => {
  assert.equal(classifyNoaRoute("qoutation pendng and confrimed how many", context()), "Quotation");
});

// B. Product
test("5. 'find every' -> Product", () => {
  assert.equal(classifyNoaRoute("find every", context()), "Product");
});

test("6. 'find prodcut oxi' (typo) -> Product", () => {
  assert.equal(classifyNoaRoute("find prodcut oxi", context()), "Product");
});

test("7. 'which model availble' (typo) on product context -> Product", () => {
  assert.equal(classifyNoaRoute("which model availble", productTemplatePage()), "Product");
});

// C. Price
test("8. 'price changed or no' -> Price", () => {
  assert.equal(classifyNoaRoute("price changed or no", context()), "Price");
});

test("9. 'check outdated pric' (typo) -> Price", () => {
  assert.equal(classifyNoaRoute("check outdated pric", context()), "Price");
});

test("10. 'curent price statuz' (typos) -> Price", () => {
  assert.equal(classifyNoaRoute("curent price statuz", context()), "Price");
});

// D. Context
test("11. 'which page i am' -> context", () => {
  assert.equal(classifyNoaRoute("which page i am", context()), "context");
});

test("12. 'what page current' -> context", () => {
  assert.equal(classifyNoaRoute("what page current", context()), "context");
});

// E. Project unsupported
test("13. 'what project running' -> Project", () => {
  assert.equal(classifyNoaRoute("what project running", context()), "Project");
});

test("14. 'which project active' -> Project", () => {
  assert.equal(classifyNoaRoute("which project active", context()), "Project");
});

// F. Precedence / regression
test("15. 'project quotation total' -> Quotation (unchanged precedence guard)", () => {
  assert.equal(classifyNoaRoute("project quotation total", context()), "Quotation");
});

test("16. 'find OXI' on a quotation page -> Product (explicit intent beats page context)", () => {
  assert.equal(classifyNoaRoute("find OXI", quotationsPage()), "Product");
});

test("17. 'quotation pending how many' on Products page -> Quotation, NOT Product (page context is not a language crutch)", () => {
  assert.equal(classifyNoaRoute("quotation pending how many", productsPage()), "Quotation");
});

test("18. 'what project active' on Products page -> Project", () => {
  assert.equal(classifyNoaRoute("what project active", productsPage()), "Project");
});

test("19. 'which page i am' on Products page -> context", () => {
  assert.equal(classifyNoaRoute("which page i am", productsPage()), "context");
});

// PART 11 - normalizeNoaUserMessage() direct tests -------------------------------

test("normalizeNoaUserMessage lowercases, trims, collapses whitespace, strips punctuation, and fixes typos", () => {
  const normalized = normalizeNoaUserMessage("  QOUTATION   pendng??  ");
  assert.ok(normalized.includes("quotation pending"), `expected "quotation pending" in "${normalized}"`);
  assert.equal(normalized, normalized.trim());
  assert.ok(!/\s{2,}/.test(normalized), "expected no repeated whitespace");
  assert.ok(!/[?!.,;:]/.test(normalized), "expected sentence punctuation stripped");
});

test("normalizeNoaUserMessage corrects each documented spelling variant as a whole token", () => {
  const cases: Array<[string, string]> = [
    ["quostion", "question"],
    ["qoutation", "quotation"],
    ["quatation", "quotation"],
    ["quotatoin", "quotation"],
    ["qoute", "quote"],
    ["quots", "quotes"],
    ["prodcut", "product"],
    ["prduct", "product"],
    ["pric", "price"],
    ["statuz", "status"],
    ["confimed", "confirmed"],
    ["confrimed", "confirmed"],
    ["pendng", "pending"],
    ["curent", "current"],
    ["currenly", "currently"],
    ["mange", "manage"],
    ["availble", "available"],
  ];

  for (const [typo, corrected] of cases) {
    assert.equal(normalizeNoaUserMessage(typo), corrected, `expected "${typo}" to normalize to "${corrected}"`);
  }
});

test("normalizeNoaUserMessage never corrupts an unrelated word that merely contains a variant as a substring", () => {
  // "pric" -> "price" is a whole-token rule; "pricing" must be left untouched.
  assert.equal(normalizeNoaUserMessage("pricing"), "pricing");
});

test("normalizeNoaUserMessage returns an empty string for empty/whitespace-only input", () => {
  assert.equal(normalizeNoaUserMessage(""), "");
  assert.equal(normalizeNoaUserMessage("   "), "");
});

// Phase B1 - Product + Price broad read routing --------------------------------

test("Product: 'show all chairs' on the Products page -> Product", () => {
  assert.equal(classifyNoaRoute("show all chairs", productsPage()), "Product");
});

test("Product: 'show LAS chairs' on the Products page -> Product", () => {
  assert.equal(classifyNoaRoute("show LAS chairs", productsPage()), "Product");
});

test("Product: 'how many chairs' on the Products page -> Product", () => {
  assert.equal(classifyNoaRoute("how many chairs", productsPage()), "Product");
});

test("Product: 'show archived desks' -> Product regardless of page (explicit lifecycle keyword)", () => {
  assert.equal(classifyNoaRoute("show archived desks", context()), "Product");
});

test("Product: 'show discontinued chairs' -> Product regardless of page (explicit lifecycle keyword)", () => {
  assert.equal(classifyNoaRoute("show discontinued chairs", context()), "Product");
});

test("Price: 'which chair prices need checking' -> Price", () => {
  assert.equal(classifyNoaRoute("which chair prices need checking", context()), "Price");
});

test("Price: 'which LAS products are due' -> Price", () => {
  assert.equal(classifyNoaRoute("which LAS products are due", context()), "Price");
});

test("Price: 'summarize chair price status' -> Price", () => {
  assert.equal(classifyNoaRoute("summarize chair price status", context()), "Price");
});

test("Price: 'check every chair price' -> Price", () => {
  assert.equal(classifyNoaRoute("check every chair price", context()), "Price");
});

// Regression: broad-read additions must not disturb existing routing ------------

test("regression: existing specific Product lookup still routes Product", () => {
  assert.equal(classifyNoaRoute("find OXI", context()), "Product");
});

test("regression: existing Price lookup still routes Price", () => {
  assert.equal(classifyNoaRoute("what is the price status?", productTemplatePage()), "Price");
});

test("regression: Quotation phrases remain Quotation despite the new broad-browsing words", () => {
  assert.equal(classifyNoaRoute("show pending quotations", context()), "Quotation");
  assert.equal(classifyNoaRoute("which quote is waiting", context()), "Quotation");
  assert.equal(classifyNoaRoute("how many quotations pending", context()), "Quotation");
});

test("regression: 'show my active projects' on the Products page routes to Project, not Product", () => {
  assert.equal(classifyNoaRoute("show my active projects", productsPage()), "Project");
});

test("regression: page-context self/context behavior unchanged ('which page am I on' still -> context)", () => {
  assert.equal(classifyNoaRoute("which page am I on", productsPage()), "context");
});

test("regression: a bare browsing verb with no domain noun and no relevant page context still falls to Help", () => {
  assert.equal(classifyNoaRoute("show all", context({ pathname: "/dashboard", section: "dashboard" })), "Help");
});

// Phase B3 - Project record and operational Project Order routing --------------

test("B3 Project record phrases route to Project", () => {
  for (const message of [
    "show active projects",
    "show projects on hold",
    "show completed projects",
    "show cancelled projects",
    "show archived projects",
    "how many projects",
    "project details for ABC",
    "project status for ABC",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Project", message);
  }
});

test("B3 Project Order phrases route to Project", () => {
  for (const message of [
    "show active project orders",
    "show completed project orders",
    "how many active project orders",
    "how many completed project orders",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Project", message);
  }
});

test("B3 routing regressions preserve Quotation, context, Procurement, Product, Price, and Help", () => {
  assert.equal(classifyNoaRoute("quotations for project X", context()), "Quotation");
  assert.equal(classifyNoaRoute("quotation total for project X", context()), "Quotation");
  assert.equal(classifyNoaRoute("find product OXI", context()), "Product");
  assert.equal(classifyNoaRoute("check current price", context()), "Price");
  assert.equal(classifyNoaRoute("which page am I on", context()), "context");
  assert.equal(classifyNoaRoute("show purchase orders", context()), "Procurement");
  assert.equal(classifyNoaRoute("tell me a joke", context()), "Help");
});

// Phase B4 - Client capability routing -------------------------------------------

test("B4 Client-intent phrases route to Client", () => {
  for (const message of [
    "show clients",
    "how many clients",
    "client details for ABC",
    "projects for client ABC",
    "recent clients",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Client", message);
  }
});

test("B4 routing regressions: Quotation-specific Client language is not stolen by Client routing", () => {
  assert.equal(classifyNoaRoute("show quotations for client ABC", context()), "Quotation");
  assert.equal(classifyNoaRoute("quotation total for client ABC", context()), "Quotation");
  assert.equal(classifyNoaRoute("which client is this quotation for", context()), "Quotation");
});

test("B4 routing regressions: Project, Product, Price, and page-context behavior unchanged", () => {
  assert.equal(classifyNoaRoute("show active projects", context()), "Project");
  assert.equal(classifyNoaRoute("which client is project X for", context()), "Project");
  assert.equal(classifyNoaRoute("find product OXI", context()), "Product");
  assert.equal(classifyNoaRoute("show LAS chairs", productsPage()), "Product");
  assert.equal(classifyNoaRoute("what is the price status?", productTemplatePage()), "Price");
  assert.equal(classifyNoaRoute("which page am I on", productsPage()), "context");
});

// Phase B5 - Procurement capability routing --------------------------------------

test("B5 Procurement-intent phrases route to Procurement", () => {
  for (const message of [
    "show me the latest purchase order",
    "list purchase orders",
    "which vendor is this rfq with",
    "procurement status for PW-2024-001",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Procurement", message);
  }
});

test("B5 Procurement is a real NoaDomain and gets its own thinking-status text", () => {
  assert.equal(noaThinkingStatusText("Procurement"), "Checking procurement orders...");
});

test("classifyNoaIntent returns Procurement directly (no longer collapsed to Help)", () => {
  assert.equal(classifyNoaIntent("show purchase orders", context()), "Procurement");
});

test("B5 routing regressions: Project, Client, Product, Price, Quotation, context, and Help unchanged", () => {
  assert.equal(classifyNoaRoute("show active projects", context()), "Project");
  assert.equal(classifyNoaRoute("show clients", context()), "Client");
  assert.equal(classifyNoaRoute("find product OXI", context()), "Product");
  assert.equal(classifyNoaRoute("what is the price status?", productTemplatePage()), "Price");
  assert.equal(classifyNoaRoute("quotations for project X", context()), "Quotation");
  assert.equal(classifyNoaRoute("which page am I on", context()), "context");
  assert.equal(classifyNoaRoute("tell me a joke", context()), "Help");
});

// Phase UA-1A - My Activity routing --------------------------------------------

test("UA-1A explicit own-activity phrases route to UserActivity", () => {
  for (const message of [
    "what did i work on today",
    "what i did today",
    "show my activity",
    "my last activity",
    "how many quotations did i work on this week",
    "what prices did i check today",
    "how many hours did i work",
    "am i online",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "UserActivity", message);
  }
});

test("UA-1A rough-English own-activity phrases route to UserActivity", () => {
  for (const message of [
    "what i work today",
    "show my last work",
    "how many quote i worked",
    "my activity today",
    "am i currently working",
    "when did i clock in",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "UserActivity", message);
  }
});

test("UA-1A explicit activity intent beats page context on Product/Quotation/Project pages", () => {
  assert.equal(classifyNoaRoute("what did i work on today", productsPage()), "UserActivity");
  assert.equal(classifyNoaRoute("what did i work on today", quotationsPage()), "UserActivity");
  assert.equal(classifyNoaRoute("what did i work on today", productTemplatePage()), "UserActivity");
});

test("UA-1A is a real NoaDomain and gets its own thinking-status text", () => {
  assert.equal(noaThinkingStatusText("UserActivity"), "Checking your ProjectWorkflow activity...");
  assert.equal(classifyNoaIntent("show my activity", context()), "UserActivity");
});

test("UA-1A routing regressions: ordinary domain questions are not stolen by UserActivity", () => {
  assert.equal(classifyNoaRoute("show quotations", context()), "Quotation");
  assert.equal(classifyNoaRoute("show products", context()), "Product");
  assert.equal(classifyNoaRoute("show active projects", context()), "Project");
  assert.equal(classifyNoaRoute("show purchase orders", context()), "Procurement");
  assert.equal(classifyNoaRoute("show clients", context()), "Client");
  assert.equal(classifyNoaRoute("which page am I on", context()), "context");
});

// Natural-language "my record/activity today" routing fix ----------------------

test("natural-language own-activity 'record' phrasing routes to UserActivity", () => {
  for (const message of [
    "what is my record today",
    "my record today",
    "show my record today",
    "show today record",
    "today's activity",
    "my activity today",
    "show my activity today",
    "what activity i have today",
    "what i did today",
    "show what i did today",
    "my work record today",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "UserActivity", message);
  }
});

test("natural-language 'record' routing regressions: domain-specific record requests are unaffected", () => {
  assert.equal(classifyNoaRoute("show client record", context()), "Client");
  assert.equal(classifyNoaRoute("show project record", context()), "Project");
  assert.equal(classifyNoaRoute("show quotation record", context()), "Quotation");
});

// Phase UA-1B - Team / other-user activity routing -----------------------------

test("UA-1B team/other-user activity phrases route to UserActivity", () => {
  for (const message of [
    "what did the team work on today",
    "who worked on quotations today",
    "who edited quotations today",
    "show Sarah activity",
    "what did Junais work on today",
    "who is active recently",
    "who is working currently",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "UserActivity", message);
  }
});

test("real UAT activity, presence, named-user, and ProjectWorkflow routing stays deterministic", () => {
  for (const message of [
    "What time was my first ProjectWorkflow activity today?",
    "Who is currently online?",
    "what yahya did today?",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "UserActivity", message);
  }
  assert.equal(classifyNoaRoute("show active projects", context()), "Project");
  assert.equal(classifyNoaRoute("show active users", context()), "Admin");
  assert.equal(classifyNoaRoute("show active procurement orders", context()), "Procurement");
  assert.equal(classifyNoaRoute("which products need price checking", context()), "Price");
  assert.equal(classifyNoaRoute("hey noa", context()), "greeting");
});

test("recorded quotation follow-up requires an immediately prior own recorded-activity request", () => {
  const activityHistory = [
    { role: "user" as const, text: "What did I work on today?" },
    { role: "assistant" as const, text: "Today you had 1 quotation-related recorded activity." },
  ];
  assert.equal(recordedQuotationFollowUpReference("which quotation?", activityHistory), "What did I work on today?");
  const quotationHistory = [
    { role: "user" as const, text: "show pending quotations" },
    { role: "assistant" as const, text: "I found pending quotations." },
  ];
  assert.equal(recordedQuotationFollowUpReference("which quotation?", quotationHistory), null);
});

test("UA-1B routing regressions: own activity, ordinary domain questions, and users-mention wording unchanged", () => {
  assert.equal(classifyNoaRoute("my activity today", context()), "UserActivity");
  assert.equal(classifyNoaRoute("what did i work on today", context()), "UserActivity");
  assert.equal(classifyNoaRoute("show quotations", context()), "Quotation");
  assert.equal(classifyNoaRoute("show projects", context()), "Project");
  assert.equal(classifyNoaRoute("show purchase orders", context()), "Procurement");
  // "users" mentioned with no activity verb must not be stolen by UserActivity.
  assert.notEqual(classifyNoaRoute("show users", context()), "UserActivity");
});

// Phase B6 - Admin/System routing ------------------------------------------------

test("B6 Admin/System phrases route to Admin", () => {
  for (const message of [
    "show users",
    "how many users",
    "show disabled users",
    "what role does Sarah have",
    "which AI providers are enabled",
    "what provider does Source QA use",
    "show AI agent settings",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Admin", message);
  }
});

test("B6 Admin is a real NoaDomain and gets its own thinking-status text", () => {
  assert.equal(noaThinkingStatusText("Admin"), "Checking system settings...");
  assert.equal(classifyNoaIntent("show users", context()), "Admin");
});

test("B6 routing regressions: UserActivity retains precedence over Admin for named-user activity/team questions", () => {
  assert.equal(classifyNoaRoute("what did Sarah work on today", context()), "UserActivity");
  assert.equal(classifyNoaRoute("what did the team work on today", context()), "UserActivity");
  assert.equal(classifyNoaRoute("who worked on quotations today", context()), "UserActivity");
});

test("B6 routing regressions: Product/Price/Quotation/Project/Client/Procurement and page context unchanged", () => {
  assert.equal(classifyNoaRoute("find product OXI", context()), "Product");
  assert.equal(classifyNoaRoute("what is the price status?", productTemplatePage()), "Price");
  assert.equal(classifyNoaRoute("show quotations", context()), "Quotation");
  assert.equal(classifyNoaRoute("show active projects", context()), "Project");
  assert.equal(classifyNoaRoute("show clients", context()), "Client");
  assert.equal(classifyNoaRoute("show purchase orders", context()), "Procurement");
  assert.equal(classifyNoaRoute("which page am I on", context()), "context");
});

// Phase B7 - Insights routing -----------------------------------------------------

test("B7 Insights analytics/summary/trend phrases route to Insights", () => {
  for (const message of [
    "show insights",
    "show ProjectWorkflow summary",
    "quotation trend this year",
    "quotation summary this month",
    "business summary this month",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Insights", message);
  }
});

test("B7 Insights is a real NoaDomain and gets its own thinking-status text", () => {
  assert.equal(noaThinkingStatusText("Insights"), "Calculating insights...");
  assert.equal(classifyNoaIntent("show insights", context()), "Insights");
});

test("B7 routing regressions: operational domain questions are not stolen by Insights", () => {
  assert.equal(classifyNoaRoute("show pending quotations", context()), "Quotation");
  assert.equal(classifyNoaRoute("how many quotations", context()), "Quotation");
  assert.equal(classifyNoaRoute("show active projects", context()), "Project");
  assert.equal(classifyNoaRoute("which products need price checking", context()), "Price");
  assert.equal(classifyNoaRoute("procurement status", context()), "Procurement");
});

test("B7 routing regressions: UserActivity and Admin unchanged", () => {
  assert.equal(classifyNoaRoute("what did i work on today", context()), "UserActivity");
  assert.equal(classifyNoaRoute("show users", context()), "Admin");
});
