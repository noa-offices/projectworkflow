import { expect, type Locator, type Page, test } from "playwright/test";

const BASE_URL = process.env.PW_BASE_URL ?? "http://127.0.0.1:3000";
const TEST_EMAIL = process.env.PW_TEST_EMAIL;
const TEST_PASSWORD = process.env.PW_TEST_PASSWORD;
const QUOTE_ID = process.env.PW_TEST_QUOTE_ID ?? "54633328-34a4-4e99-80e8-d9c1edf2095d";

test.skip(!TEST_EMAIL || !TEST_PASSWORD, "Set PW_TEST_EMAIL and PW_TEST_PASSWORD to run authenticated Local Builder tests.");

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });

  await page.locator('input[name="email"], input[type="email"]').first().fill(TEST_EMAIL ?? "");
  await page.locator('input[name="password"], input[type="password"]').first().fill(TEST_PASSWORD ?? "");

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 }),
    page.getByRole("button", { name: /sign in|login|log in/i }).click(),
  ]);
}

async function openLocalBuilder(page: Page) {
  await page.goto(`${BASE_URL}/quotations/${QUOTE_ID}/local-builder`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: "Downloads" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Columns" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More" }).first()).toBeVisible();
}

async function clickOutside(page: Page) {
  const tableTarget = page.locator("table").first();
  if (await tableTarget.isVisible().catch(() => false)) {
    const box = await tableTarget.boundingBox();
    if (box) {
      await page.mouse.click(box.x + Math.min(24, box.width / 2), box.y + Math.min(24, box.height / 2));
      return;
    }
  }

  await page.mouse.click(24, 180);
}

async function expectPanelStaysOpenAfterInsideClick(panel: Locator, insideTarget: Locator) {
  await expect(panel).toBeVisible();
  await insideTarget.click();
  await expect(panel).toBeVisible();
}

test.describe("Local Builder dropdown click-away", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openLocalBuilder(page);
  });

  test("Downloads closes on outside click", async ({ page }) => {
    await page.getByRole("button", { name: "Downloads" }).click();

    const downloadsPanel = page.getByText("Client Documents", { exact: true });
    await expectPanelStaysOpenAfterInsideClick(downloadsPanel, downloadsPanel);

    await clickOutside(page);
    await expect(downloadsPanel).toBeHidden();
  });

  test("Columns closes on outside click", async ({ page }) => {
    await page.getByRole("button", { name: "Columns" }).click();

    const columnsPanel = page.getByText("Local Column Settings", { exact: true });
    await expectPanelStaysOpenAfterInsideClick(columnsPanel, columnsPanel);

    await clickOutside(page);
    await expect(columnsPanel).toBeHidden();
  });

  test("Toolbar More closes on outside click", async ({ page }) => {
    await page.getByRole("button", { name: "More" }).first().click();

    const toolbarMorePanel = page.getByText("Fallback only", { exact: true });
    await expectPanelStaysOpenAfterInsideClick(toolbarMorePanel, toolbarMorePanel);

    await clickOutside(page);
    await expect(toolbarMorePanel).toBeHidden();
  });

  test("Row-level More closes on outside click", async ({ page }) => {
    const moreButtons = page.getByRole("button", { name: "More" });
    await expect.poll(() => moreButtons.count()).toBeGreaterThan(1);

    await moreButtons.nth(1).click();

    const rowMenu = page.getByText("Duplicate below", { exact: true }).first();
    await expect(rowMenu).toBeVisible();

    await clickOutside(page);
    await expect(rowMenu).toBeHidden();
  });

  test("Opening another toolbar dropdown closes the previous toolbar dropdown", async ({ page }) => {
    await page.getByRole("button", { name: "Downloads" }).click();
    await expect(page.getByText("Client Documents", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Columns" }).click();
    await expect(page.getByText("Client Documents", { exact: true })).toBeHidden();
    await expect(page.getByText("Local Column Settings", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "More" }).first().click();
    await expect(page.getByText("Local Column Settings", { exact: true })).toBeHidden();
    await expect(page.getByText("Fallback only", { exact: true })).toBeVisible();
  });
});
