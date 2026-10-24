/**
 * Table state lives in the URL (phase 05): one set of controls, shareable
 * links, old links still work. See docs/rework/TABLE_BUGS.md.
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("sf2g-sync-prompt-dismissed", "true");
    } catch {}
  });
});

test("one view switcher and one filter bar (T1, T13)", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.getByText("Ada Bayway").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Groups/ })).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "Skyline" })).toHaveCount(1);
  await expect(page.locator("#leaderboard-search")).toHaveCount(1);
});

test("mobile: the filters sheet holds the same controls", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/leaderboard");
  await expect(page.getByText("Ada Bayway").first()).toBeVisible();
  const skyline = page.getByRole("checkbox", { name: "Skyline" });
  await expect(skyline).toBeHidden();
  await page.getByRole("button", { name: "Toggle filters panel" }).click();
  await skyline.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("routes"))
    .toBe("skyline");
  await expect(page.getByText("Dee Reverse")).toHaveCount(0);
});

test("a shared link reproduces view, filters and sort in a fresh context", async ({
  page,
  browser,
}) => {
  await page.goto("/leaderboard");
  await expect(page.getByText("Ada Bayway").first()).toBeVisible();
  await page.getByRole("button", { name: /Rides/ }).click();
  await page.getByRole("checkbox", { name: "Bayway" }).click();
  await page.locator('th[data-column-id="distance_meters"] button').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBe("distance_meters");
  const shared = page.url();
  // Wait for the re-sorted data (not the previous order or skeletons), and
  // compare textContent on both sides: innerText depends on layout.
  await expect(page.locator(".data-table__skeleton-row")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  const firstRow = (await page.locator("tbody tr").first().textContent()) ?? "";
  expect(firstRow).not.toBe("");

  const context = await browser.newContext({ timezoneId: "Asia/Tokyo" });
  const other = await context.newPage();
  await other.addInitScript(() =>
    localStorage.setItem("sf2g-sync-prompt-dismissed", "true"),
  );
  await other.goto(shared);
  await expect(other.getByRole("button", { name: /Rides/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(other.getByRole("checkbox", { name: "Bayway" })).toBeChecked();
  await expect(
    other.locator('th[data-column-id="distance_meters"]'),
  ).toHaveAttribute("aria-sort", "descending");
  await expect(other.locator("tbody tr").first()).toHaveText(firstRow);
  await context.close();
});

test("old links (rSort/gSort, preset + dates) still open the intended view", async ({
  page,
}) => {
  await page.goto(
    "/leaderboard?view=groups&gSort=riderCount&gDir=asc&routes=skyline,bayway&datePreset=this-week&dateFrom=2020-01-01",
  );
  await expect(page.getByRole("button", { name: /Groups/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const params = new URL(page.url()).searchParams;
  expect(params.get("sort")).toBe("riderCount");
  expect(params.get("dir")).toBe("asc");
  expect(params.get("dateFrom")).toBeNull();
  expect(params.get("gSort")).toBeNull();
});
